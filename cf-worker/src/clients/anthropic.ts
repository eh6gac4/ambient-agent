import type { Env, ExtractedTask, EmailAnalysis } from "../types.js";
import { recordUsage } from "../storage/kv.js";

const MODEL = "claude-haiku-4-5-20251001";
const API_URL = "https://api.anthropic.com/v1/messages";

const EXTRACT_TASKS_PROMPT = `あなたはメールからタスクを抽出するアシスタントです。

以下のメールを読み、アクションが必要な項目を JSON 配列で返してください。
タスクが存在しない場合は空配列 \`[]\` を返してください。

## 出力フォーマット（JSON のみ、説明文不要）

\`\`\`json
[
  {
    "title": "タスクのタイトル（簡潔に）",
    "due": "YYYY-MM-DD または YYYY-MM-DDTHH:MM または null（時刻が明示されていれば時刻付きで返す）",
    "priority": "high | medium | low",
    "source": "Gmail"
  }
]
\`\`\`

## 判断基準
- 返信・確認・提出・対応などのアクション動詞を含む文をタスクとして抽出する
- 期日が明示されていればそれを due に設定する（不明な場合は null）
- 緊急・至急・本日中 → high、それ以外は medium を基本とする
- 広告・通知・ニュースレターからはタスクを抽出しない`;

const ANALYZE_EMAIL_PROMPT = `あなたはメールを分析するアシスタントです。

以下のメールを読み、要約とアクションが必要なタスクを JSON で返してください。

## 出力フォーマット（JSON のみ、説明文不要）

\`\`\`json
{
  "summary": "メールの内容を1〜2文で要約（日本語）",
  "tasks": [
    {
      "title": "タスクのタイトル（簡潔に）",
      "due": "YYYY-MM-DD または YYYY-MM-DDTHH:MM または null",
      "priority": "high | medium | low",
      "source": "Gmail"
    }
  ]
}
\`\`\`

## 判断基準
- summary: 誰から何の用件か、重要ポイントを1〜2文で
- tasks: 返信・確認・提出・対応などのアクション動詞を含む文をタスクとして抽出する
- 期日が明示されていればそれを due に設定する（不明な場合は null）
- 緊急・至急・本日中 → high、それ以外は medium を基本とする
- 広告・通知・ニュースレターからはタスクを抽出せず tasks は []`;

interface AnthropicResponse {
  content: Array<{ type: string; text: string }>;
  usage: { input_tokens: number; output_tokens: number };
}

async function callClaude(
  env: Env,
  job: string,
  system: string,
  userContent: string | unknown[],
  maxTokens = 1024,
): Promise<string> {
  const resp = await fetch(API_URL, {
    method: "POST",
    headers: {
      "x-api-key": env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: maxTokens,
      system,
      messages: [{ role: "user", content: userContent }],
    }),
  });

  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(`Anthropic API failed: ${resp.status} ${body}`);
  }

  const data = await resp.json<AnthropicResponse>();
  await recordUsage(env, job, data.usage.input_tokens, data.usage.output_tokens);
  return data.content[0]?.text ?? "";
}

function extractJsonList(text: string): ExtractedTask[] {
  const match = text.match(/\[[\s\S]*\]/);
  if (!match) return [];
  try {
    return JSON.parse(match[0]) as ExtractedTask[];
  } catch {
    return [];
  }
}

export async function extractTasksFromText(env: Env, label: string, subject: string, body: string): Promise<ExtractedTask[]> {
  const text = await callClaude(env, label, EXTRACT_TASKS_PROMPT, `件名: ${subject}\n\n本文:\n${body}`);
  return extractJsonList(text);
}

export async function analyzeEmail(env: Env, subject: string, body: string): Promise<EmailAnalysis> {
  const text = await callClaude(env, "analyze_email", ANALYZE_EMAIL_PROMPT, `件名: ${subject}\n\n本文:\n${body.slice(0, 3000)}`);
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return { summary: text.trim(), tasks: [] };
  try {
    const result = JSON.parse(match[0]) as EmailAnalysis;
    result.tasks ??= [];
    result.summary ??= "";
    return result;
  } catch {
    return { summary: text.trim(), tasks: [] };
  }
}

export async function extractTasksFromUrlContent(env: Env, url: string, content: string): Promise<ExtractedTask[]> {
  const text = await callClaude(env, "extract_tasks_url", EXTRACT_TASKS_PROMPT, `件名: ${url}\n\n本文:\n${content.slice(0, 3000)}`);
  return extractJsonList(text);
}

export async function extractTasksFromImage(env: Env, imageData: ArrayBuffer, mediaType: string): Promise<ExtractedTask[]> {
  const b64 = btoa(String.fromCharCode(...new Uint8Array(imageData)));
  const userContent = [
    { type: "image", source: { type: "base64", media_type: mediaType, data: b64 } },
    { type: "text", text: "この画像からアクションが必要なタスクを抽出してください。" },
  ];
  const text = await callClaude(env, "extract_tasks_image", EXTRACT_TASKS_PROMPT, userContent);
  return extractJsonList(text);
}

export async function summarizeDay(
  env: Env,
  calendarEvents: Array<{ summary: string; start: string }>,
  tasks: Array<{ title: string; priority: string; due: string | null }>,
  overdueTasks: Array<{ title: string; priority: string; due: string | null }>,
): Promise<string> {
  const eventsText = calendarEvents.map((e) => `- ${e.start} ${e.summary}`).join("\n") || "（なし）";
  const tasksText = tasks.map((t) => `- [${t.priority}] ${t.title} (期限: ${t.due ?? "未定"})`).join("\n") || "（なし）";
  const overdueText = overdueTasks.map((t) => `- [${t.priority}] ${t.title} (期限: ${t.due ?? ""})`).join("\n") || "（なし）";

  const prompt = `今日の予定とタスクをもとに、簡潔な日次ブリーフィングを日本語で作成してください。

## 今日の予定
${eventsText}

## 未完了タスク
${tasksText}

## 期限切れタスク
${overdueText}

ブリーフィングは3〜5文程度にまとめてください。期限切れタスクがある場合は必ず言及してください。`;

  return callClaude(env, "summarize_day", "", prompt, 512);
}
