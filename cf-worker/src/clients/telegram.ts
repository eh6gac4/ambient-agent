import type { Env } from "../types.js";

const MAX_LENGTH = 4096;

function apiUrl(token: string, method: string): string {
  return `https://api.telegram.org/bot${token}/${method}`;
}

function postMessage(env: Env, url: string, text: string, parseMode?: "Markdown"): Promise<Response> {
  const payload: Record<string, unknown> = { chat_id: env.TELEGRAM_CHAT_ID, text };
  if (parseMode) payload.parse_mode = parseMode;
  return fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export async function sendMessage(env: Env, text: string): Promise<void> {
  const url = apiUrl(env.TELEGRAM_BOT_TOKEN, "sendMessage");
  const chunks: string[] = [];
  for (let i = 0; i < text.length; i += MAX_LENGTH) {
    chunks.push(text.slice(i, i + MAX_LENGTH));
  }
  for (const chunk of chunks) {
    const resp = await postMessage(env, url, chunk, "Markdown");
    if (resp.ok) continue;

    const body = await resp.text();
    // レガシー Markdown はエスケープ漏れ 1 文字で 400 になる。
    // パース失敗時は parse_mode なし（プレーンテキスト）で再送し、配信を死守する。
    if (resp.status === 400 && body.includes("can't parse entities")) {
      console.error(`Telegram Markdown parse failed, retrying as plain text: ${body}`);
      const retry = await postMessage(env, url, chunk);
      if (retry.ok) continue;
      const retryBody = await retry.text();
      throw new Error(`Telegram sendMessage failed (plain retry): ${retry.status} ${retryBody}`);
    }
    throw new Error(`Telegram sendMessage failed: ${resp.status} ${body}`);
  }
}

export async function getFileUrl(env: Env, fileId: string): Promise<string> {
  const resp = await fetch(apiUrl(env.TELEGRAM_BOT_TOKEN, "getFile"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ file_id: fileId }),
  });
  if (!resp.ok) throw new Error(`getFile failed: ${resp.status}`);
  const data = await resp.json<{ ok: boolean; result: { file_path: string } }>();
  return `https://api.telegram.org/file/bot${env.TELEGRAM_BOT_TOKEN}/${data.result.file_path}`;
}

export function escapeMd(text: string): string {
  for (const ch of ["\\", "*", "_", "`", "["]) {
    text = text.replaceAll(ch, `\\${ch}`);
  }
  return text;
}
