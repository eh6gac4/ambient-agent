import type { Env } from "../types.js";
import { sendMessage } from "../clients/telegram.js";

// home server の監視層(Uptime Kuma / Beszel)から送られる死活・リソースアラートを
// 受け取り Telegram へ通知する。
//
// Phase 1: 推論なし。受領ペイロードを整形して即転送するのみ。
// Phase 2(別 PR)で Claude による重複排除・重大度判定・復旧提案を追加予定。

// 正規化コントラクト(監視側の Custom Body / shoutrrr テンプレートをこれに合わせる)。
interface AlertPayload {
  source?: string; // "uptime-kuma" | "beszel" など送信元
  status?: string; // "down"|"up"|"alert"|"resolved" など
  title?: string; // 対象名(コンテナ名・モニター名)
  detail?: string; // 詳細メッセージ
}

// 復旧系(緑)以外はすべて異常(赤)として扱う。
function isDown(status?: string): boolean {
  if (!status) return true;
  return !/^(up|resolved|ok|healthy|1)$/i.test(status.trim());
}

export function formatAlert(body: unknown): string {
  const p: AlertPayload & Record<string, unknown> =
    body && typeof body === "object" ? (body as AlertPayload & Record<string, unknown>) : {};

  let { source, status, title, detail } = p;

  // フォールバック: Uptime Kuma ネイティブ payload { heartbeat, monitor, msg }
  if (!title && p.monitor && typeof p.monitor === "object") {
    const m = p.monitor as Record<string, unknown>;
    if (typeof m.name === "string") title = m.name;
    source = source ?? "uptime-kuma";
  }
  if (status === undefined && p.heartbeat && typeof p.heartbeat === "object") {
    const h = p.heartbeat as Record<string, unknown>;
    if (typeof h.status === "number") status = h.status === 1 ? "up" : "down";
  }
  if (!detail && typeof p.msg === "string") detail = p.msg;
  // フォールバック: shoutrrr generic のデフォルト body { title, message }
  if (!detail && typeof p.message === "string") detail = p.message;

  source = source ?? "monitor";
  title = title ?? "(no title)";
  detail = detail ?? (typeof body === "string" ? body : JSON.stringify(body));

  const icon = isDown(status) ? "🔴" : "🟢";
  return `${icon} *[${source}] ${title}*\n${detail}`;
}

export async function handleAlert(env: Env, body: unknown): Promise<void> {
  await sendMessage(env, formatAlert(body));
}
