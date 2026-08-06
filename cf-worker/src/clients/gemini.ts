import type { Env, ExtractedTask, EmailAnalysis, Task } from "../types.js";
import { recordUsage } from "../storage/kv.js";
import { jstDateStr } from "../utils/jst.js";

const MODEL = "gemini-3.6-flash";
const API_URL_BASE = "https://generativelanguage.googleapis.com/v1beta/models";

const EXTRACT_TASKS_PROMPT = `あなたはメールからタスクを抽出するアシスタントです。

以下のメールを読み、アクションが必要な項目を JSON 配列で返してください。
タスクが存在しない場合は空配列 \`[]\` を返してください。

## 出力フォーマット
Markdownのコードブロック（\`\`\`json）を使わず、直接JSON配列のみを出力してください。説明文は一切不要です。

[
  {
    "title": "タスクのタイトル（簡潔に）",
    "due": "YYYY-MM-DD または YYYY-MM-DDTHH:MM または null（時刻が明示されていれば時刻付きで返す）",
    "priority": "high | medium | low",
    "icon": "タスク内容を端的に表す絵文字を1文字（例: 📩 返信 / 📅 予定 / 💰 支払い / 📝 提出 / 🔍 確認 / 🛒 買い物）",
    "source": "Gmail"
  }
]

## 判断基準
- 返信・確認・提出・対応などのアクション動詞を含む文をタスクとして抽出する
- 期日が明示されていればそれを due に設定する（不明な場合は null）
- 緊急・至急・本日中 → high、それ以外は medium を基本とする
- icon: タスクの性質（返信・予定・支払い・確認・買い物 等）を最もよく表す絵文字を Unicode 1 文字だけ返す。迷ったら 📋
- 広告・通知・ニュースレターからはタスクを抽出しない`;

const ANALYZE_EMAIL_PROMPT = `あなたはメールを分析するアシスタントです。

以下のメールを読み、タスク一覧で使うタイトル・要約・アクションが必要なタスクを JSON で返してください。

## 出力フォーマット
Markdownのコードブロック（\`\`\`json）を使わず、直接JSONオブジェクトのみを出力してください。説明文は一切不要です。

{
  "task_title": "タスク一覧に並べたとき一目で内容が分かる短いタイトル（日本語・20文字程度）",
  "summary": "メールの内容を1〜2文で要約（日本語）",
  "tasks": [
    {
      "title": "タスクのタイトル（簡潔に）",
      "due": "YYYY-MM-DD または YYYY-MM-DDTHH:MM または null",
      "priority": "high | medium | low",
      "icon": "タスク内容を端的に表す絵文字を1文字（例: 📩 返信 / 📅 予定 / 💰 支払い / 📝 提出 / 🔍 確認 / 🛒 買い物）",
      "source": "Gmail"
    }
  ]
}

## 判断基準
- task_title: メール件名そのままにせず、誰から何の用件かが分かる短文にする。例「件名: 【重要なお知らせ】請求書発行のご連絡」→ task_title: 「ACME社4月分請求書の支払い」。社名・人物名が分かれば含めると良い。広告・通知でタスクが無い場合は「{送信元}からのお知らせ」程度で良い
- summary: 誰から何の用件か、重要ポイントを1〜2文で
- tasks: 返信・確認・提出・対応などのアクション動詞を含む文をタスクとして抽出する
- 期日が明示されていればそれを due に設定する（不明な場合は null）
- 緊急・至急・本日中 → high、それ以外は medium を基本とする
- icon: タスクの性質（返信・予定・支払い・確認・買い物 等）を最もよく表す絵文字を Unicode 1 文字だけ返す。迷ったら 📋
- 広告・通知・ニュースレターからはタスクを抽出せず tasks は []`;

interface GeminiResponse {
  candidates?: Array<{
    content?: {
      parts: Array<{ text?: string }>;
    };
  }>;
  usageMetadata?: {
    promptTokenCount: number;
    candidatesTokenCount: number;
  };
}

async function callGemini(
  env: Env,
  job: string,
  system: string,
  userContent: any[],
  maxTokens = 1024,
  responseMimeType?: string,
  enableGoogleSearch = false,
): Promise<string> {
  const url = `${API_URL_BASE}/${MODEL}:generateContent?key=${env.GEMINI_API_KEY}`;
  
  const body: any = {
    contents: [
      {
        role: "user",
        parts: userContent,
      },
    ],
    generationConfig: {
      maxOutputTokens: maxTokens,
      ...(responseMimeType ? { responseMimeType } : {}),
    },
  };

  if (enableGoogleSearch) {
    body.tools = [{ googleSearch: {} }];
  }

  if (system && system.length > 0) {
    body.systemInstruction = {
      parts: [{ text: system }],
    };
  }

  const resp = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    const errorBody = await resp.text();
    throw new Error(`Gemini API failed: ${resp.status} ${errorBody}`);
  }

  const data = await resp.json<GeminiResponse>();
  const inputTokens = data.usageMetadata?.promptTokenCount ?? 0;
  const outputTokens = data.usageMetadata?.candidatesTokenCount ?? 0;
  
  const parts = data.candidates?.[0]?.content?.parts;
  const responseText = parts ? parts.map(p => p.text || "").join("") : "";

  await recordUsage(env, job, inputTokens, outputTokens, responseText);
  
  return responseText;
}

/** LLM 応答テキストから最初の JSON 配列を取り出す。見つからない/パース失敗時は空配列。 */
function extractJsonArray<T>(text: string): T[] {
  const cleaned = text.replace(/```(?:json)?\n?/gi, '').trim();
  const match = cleaned.match(/\[[\s\S]*\]/);
  if (!match) return [];
  try {
    return JSON.parse(match[0]) as T[];
  } catch {
    return [];
  }
}

/** LLM 応答テキストから最初の JSON オブジェクトを取り出す。見つからない/パース失敗時は null。 */
function extractJsonObject<T>(text: string): T | null {
  const cleaned = text.replace(/```(?:json)?\n?/gi, '').trim();
  const match = cleaned.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    return JSON.parse(match[0]) as T;
  } catch {
    return null;
  }
}

export async function extractTasksFromText(env: Env, label: string, subject: string, body: string): Promise<ExtractedTask[]> {
  const text = await callGemini(env, label, EXTRACT_TASKS_PROMPT, [{ text: `件名: ${subject}\n\n本文:\n${body}` }], 1024, "application/json");
  return extractJsonArray<ExtractedTask>(text);
}

export async function analyzeEmail(env: Env, subject: string, body: string): Promise<EmailAnalysis> {
  const text = await callGemini(env, "analyze_email", ANALYZE_EMAIL_PROMPT, [{ text: `件名: ${subject}\n\n本文:\n${body.slice(0, 3000)}` }], 1024, "application/json");
  const result = extractJsonObject<EmailAnalysis>(text);
  if (!result) {
    let fallback = text.trim();
    const summaryMatch = text.match(/"summary"\s*:\s*"([^"\\]*(?:\\.[^"\\]*)*)("?)/);
    if (summaryMatch) {
      fallback = summaryMatch[1].replace(/\\n/g, '\n').replace(/\\"/g, '"');
    } else {
      fallback = fallback.replace(/```(?:json)?\n?/gi, '').replace(/[\{\}]/g, '').trim();
    }
    return { summary: fallback, tasks: [] };
  }
  result.tasks ??= [];
  result.summary ??= "";
  return result;
}

/** Notion ページのタイトル候補。LLM が task_title を返さなければ件名にフォールバック。 */
export function pickTaskTitle(analysis: EmailAnalysis, subject: string): string {
  const t = analysis.task_title?.trim();
  return t && t.length > 0 ? t : subject;
}

export async function extractTasksFromUrlContent(env: Env, url: string, content: string): Promise<ExtractedTask[]> {
  const text = await callGemini(env, "extract_tasks_url", EXTRACT_TASKS_PROMPT, [{ text: `件名: ${url}\n\n本文:\n${content.slice(0, 3000)}` }], 1024, "application/json");
  return extractJsonArray<ExtractedTask>(text);
}

function imageToBase64(imageData: ArrayBuffer): string {
  let bin = "";
  const bytes = new Uint8Array(imageData);
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

const ANALYZE_IMAGE_PROMPT = `あなたは画像からタスクを分析するアシスタントです。

画像（レシート・ホワイトボード・メモ・スクリーンショット等）を読み、要約と実行が必要なタスクを JSON で返してください。

## 出力フォーマット
Markdownのコードブロック（\`\`\`json）を使わず、直接JSONオブジェクトのみを出力してください。説明文は一切不要です。

{
  "summary": "画像の内容を1文で要約（タスクのタイトルとして使う）",
  "tasks": [
    {
      "title": "具体的にやること（簡潔に）",
      "due": "YYYY-MM-DD または null",
      "priority": "high | medium | low",
      "icon": "タスク内容を端的に表す絵文字を1文字（例: 🧾 レシート / 📝 メモ / 🛒 買い物 / 💰 支払い / 📅 予定 / 🔍 確認）",
      "source": "Telegram"
    }
  ]
}

## 判断基準
- summary: 「何の画像か / なぜ撮ったと考えられるか」を1文に。タスク登録時のタイトルになるので具体的に
- tasks: 関連する一連のアクションは細切れにせず、できるだけ少ない数にまとめる
- 期日が画像内に明示されていれば due に設定する（不明なら null）
- 緊急・至急 → high、通常 → medium
- icon: タスクの性質（レシート整理・メモ転記・買い物・支払い・予定登録 等）を最もよく表す絵文字を Unicode 1 文字だけ返す。迷ったら 📋`;

export async function analyzeImage(env: Env, imageData: ArrayBuffer, mediaType: string): Promise<EmailAnalysis> {
  const userContent = [
    { inlineData: { mimeType: mediaType, data: imageToBase64(imageData) } },
    { text: "この画像を分析してください。" },
  ];
  const text = await callGemini(env, "analyze_image", ANALYZE_IMAGE_PROMPT, userContent, 1024, "application/json");
  const result = extractJsonObject<EmailAnalysis>(text);
  if (!result) {
    let fallback = text.trim();
    const summaryMatch = text.match(/"summary"\s*:\s*"([^"\\]*(?:\\.[^"\\]*)*)("?)/);
    if (summaryMatch) {
      fallback = summaryMatch[1].replace(/\\n/g, '\n').replace(/\\"/g, '"');
    } else {
      fallback = fallback.replace(/```(?:json)?\n?/gi, '').replace(/[\{\}]/g, '').trim();
    }
    return { summary: fallback, tasks: [] };
  }
  result.tasks ??= [];
  result.summary ??= "";
  return result;
}

const HOME_ARRIVAL_PROMPT = `あなたは帰宅時のタスク通知を選ぶアシスタントです。

ユーザーが帰宅しました。以下のタスク一覧から、今この瞬間に通知すべきタスクを最大5件選んでください。

## 選定基準
- 期限切れ・今日・明日期限のタスクを優先する
- 夕方〜夜の帰宅に関連する行動（子ども関連・買い物・家事・連絡）を優先する
- 優先度 high のタスクは必ず含める（多すぎる場合は最重要のみ）
- 仕事中にしかできないタスク（会議準備・業務連絡 等）は夜間帰宅時は除外する

## 出力フォーマット
Markdownのコードブロック（\`\`\`json）を使わず、直接JSON配列のみを出力してください。説明文は一切不要です。

[
  {"title": "通知タイトル（簡潔に20文字以内）", "priority": "high | medium | low"}
]

タスクが0件の場合は \`[]\` を返す。`;

export interface HomeArrivalNotification {
  title: string;
  priority: "high" | "medium" | "low";
}

/** 帰宅/退社など「現在地を離れた」タイミングのタスク通知を LLM に選ばせる共通処理。 */
async function selectNotifications(
  env: Env,
  job: string,
  prompt: string,
  tasks: Array<{ title: string; priority: string; due: string | null; status: string }>,
  currentJstDatetime: string,
): Promise<HomeArrivalNotification[]> {
  const today = jstDateStr();
  const taskList = tasks
    .map((t) => `- [${t.priority}] ${t.title} (期限: ${t.due ?? "未定"}, ステータス: ${t.status})`)
    .join("\n");

  const userContent = [{ text: `現在時刻: ${currentJstDatetime} (JST)\n今日の日付: ${today}\n\n## タスク一覧\n${taskList}` }];
  const text = await callGemini(env, job, prompt, userContent, 512, "application/json");
  return extractJsonArray<HomeArrivalNotification>(text);
}

export async function selectHomeArrivalNotifications(
  env: Env,
  tasks: Array<{ title: string; priority: string; due: string | null; status: string }>,
  currentJstDatetime: string,
): Promise<HomeArrivalNotification[]> {
  return selectNotifications(env, "home_arrival", HOME_ARRIVAL_PROMPT, tasks, currentJstDatetime);
}

const OFFICE_LEAVE_PROMPT = `あなたは退社時のタスク通知を選ぶアシスタントです。

ユーザーが会社を出ました。以下のタスク一覧から、今この瞬間に通知すべきタスクを最大5件選んでください。

## 選定基準
- 今日中・明日期限のタスクを優先する
- 帰宅途中にできること（買い物・立ち寄り・連絡）を優先する
- 業務時間内に残してきた未完了の重要タスク（翌朝一番に着手すべきもの）を含める
- 家に帰ってからでないとできないタスク（家事・家族関連）は除外する
- 優先度 high のタスクは必ず含める（多すぎる場合は最重要のみ）

## 出力フォーマット
Markdownのコードブロック（\`\`\`json）を使わず、直接JSON配列のみを出力してください。説明文は一切不要です。

[
  {"title": "通知タイトル（簡潔に20文字以内）", "priority": "high | medium | low"}
]

タスクが0件の場合は \`[]\` を返す。`;

export async function selectOfficeLeaveNotifications(
  env: Env,
  tasks: Array<{ title: string; priority: string; due: string | null; status: string }>,
  currentJstDatetime: string,
): Promise<HomeArrivalNotification[]> {
  return selectNotifications(env, "office_leave", OFFICE_LEAVE_PROMPT, tasks, currentJstDatetime);
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

  const prompt = `今日の予定とタスクをもとに、ユーザーへの短いコメントを日本語で作成してください。

## 今日の予定
${eventsText}

## 未完了タスク
${tasksText}

## 期限切れタスク
${overdueText}

## 出力ルール
- 予定とタスクの具体的なリストは別途表示するので、ここでは羅列しない
- 全体感（忙しさ・優先すべきポイント・期限切れの注意喚起など）を 1〜2 文で簡潔に
- 期限切れタスクがある場合は必ず触れる
- 装飾やマークダウン記号は使わず、プレーンな文章のみ`;

  return callGemini(env, "summarize_day", "", [{ text: prompt }], 1024);
}

const ANALYZE_ERROR_PROMPT = `あなたはシステムのデバッグを支援するAIアシスタントです。
提供されたエラーログとコンテキストから、エラーの根本原因を推測し、対応方法を提案してください。

## 出力ルール
- 原因: （簡潔な説明）
- 提案: （具体的な解決策や確認すべきこと）
- 全体で200文字程度のプレーンテキスト（Markdown可）で短く返信してください。`;

export async function analyzeError(env: Env, context: string, errorMessage: string): Promise<string> {
  const prompt = `コンテキスト: ${context}\n\nエラー内容:\n${errorMessage.slice(0, 2000)}`;
  return callGemini(env, "analyze_error", ANALYZE_ERROR_PROMPT, [{ text: prompt }], 512);
}


const SELECT_POI_TASKS_PROMPT = `あなたはタスク管理アシスタントです。
ユーザーが特定の施設・場所に滞在しています。
現在の未完了タスクリストの中から、**その場所で実行可能・関連性の高いタスク**を選別してください。

【現在の場所】
名前: {POI_NAME}
カテゴリ: {POI_CATEGORY}

【タスク一覧】
{TASKS_JSON}

## 出力フォーマット
Markdownのコードブロック（\`\`\`json）を使わず、直接JSON配列のみを出力してください。
関連タスクがない場合は空配列 \`[]\` を出力してください。
各タスクについて、なぜその場所で実行可能かを示す簡単な理由（reason）も付与してください。

[
  {
    "title": "タスクのタイトル",
    "reason": "この場所で実行できる理由（例: ここは薬局なので、洗剤を購入できるため）"
  }
]
`;

export async function selectPoiTasks(env: Env, tasks: Task[], poiName: string, poiCategory: string): Promise<{ title: string; reason: string }[]> {
  if (tasks.length === 0) return [];
  const prompt = SELECT_POI_TASKS_PROMPT
    .replace("{POI_NAME}", poiName)
    .replace("{POI_CATEGORY}", poiCategory)
    .replace("{TASKS_JSON}", JSON.stringify(tasks.map(t => ({ title: t.title, status: t.status, priority: t.priority })), null, 2));

  const text = await callGemini(env, "select_poi_tasks", prompt, [{ text: "関連タスクを抽出してください。" }], 1024, "application/json");
  return extractJsonArray<{ title: string; reason: string }>(text);
}

const SEARCH_AI_NEWS_PROMPT = `あなたはAI関連の最新ニュースを収集し、ユーザーに配信するアシスタントです。
最新のAI関連ニュースおよび、OpenAI、Anthropic、Googleなどの主要AI企業の最新公式リリース情報をウェブ検索してください。
主要なトピックをいくつかピックアップし、要約して出力してください。
各トピックのタイトルには、必ず情報元のURLをMarkdownリンクとして埋め込んでください。
全体を関西弁で親しみやすく出力してください。`;

export async function searchAiNews(env: Env): Promise<string> {
  const today = jstDateStr();
  const userContent = [{ text: `今日の日付: ${today}\n最新のAIニュースを検索してまとめてください。` }];
  return callGemini(env, "search_ai_news", SEARCH_AI_NEWS_PROMPT, userContent, 2048, undefined, true);
}
