import type { Env } from "../types.js";
import { searchEmails } from "../storage/d1.js";
import { searchMessages, getMessageHeaders, parseMessage } from "../clients/gmail-api.js";
import { escapeMd } from "../clients/telegram.js";
import { parseKeywords, extractSnippet } from "../utils/search.js";
import { toJstDateStr } from "../utils/jst.js";

const GMAIL_FALLBACK_LIMIT = 5;
// 保管メールのヒットがこの件数未満なら Gmail 側も引く（保管は導入以降のメールのみのため）。
const FALLBACK_THRESHOLD = 3;

export const MAIL_USAGE = '使い方: `/mail 請求書 3月`（複数語は AND、`"..."` でフレーズ指定）';

interface Hit {
  subject: string;
  senderEmail: string;
  gmailUrl: string;
  date?: string;
  snippet?: string;
}

function formatHit(hit: Hit): string {
  const meta = hit.date ? `${escapeMd(hit.senderEmail)} ・ ${hit.date}` : escapeMd(hit.senderEmail);
  const snippet = hit.snippet ? `\n  ${escapeMd(hit.snippet)}` : "";
  return `• *${escapeMd(hit.subject)}*\n  ${meta}${snippet}\n  [📧 Gmail で開く](${hit.gmailUrl})`;
}

async function searchGmailFallback(env: Env, keywords: string[]): Promise<string[]> {
  const metas = await searchMessages(env, keywords.join(" "), GMAIL_FALLBACK_LIMIT);
  const hits = await Promise.all(
    metas.map(async (meta) => parseMessage(await getMessageHeaders(env, meta.id), env)),
  );
  return hits.map((h) => formatHit({ subject: h.subject, senderEmail: h.senderEmail, gmailUrl: h.gmailUrl }));
}

/** `/mail` の本体。保管済みメールを部分一致で検索し、不足分を Gmail 検索で補う。 */
export async function searchMail(env: Env, input: string): Promise<string> {
  const keywords = parseKeywords(input);
  if (!keywords.length) return MAIL_USAGE;

  const hits = await searchEmails(env, keywords);
  const header = `*🔍 メール検索: ${escapeMd(keywords.join(" "))}*`;
  const sections: string[] = [];

  if (hits.length) {
    const lines = hits.map((hit) =>
      formatHit({
        subject: hit.subject,
        senderEmail: hit.senderEmail,
        gmailUrl: hit.gmailUrl,
        date: toJstDateStr(new Date(hit.receivedAt * 1000)),
        snippet: extractSnippet(hit.body, keywords),
      }),
    );
    sections.push(`*保管メール (${hits.length}件)*\n` + lines.join("\n"));
  }

  if (hits.length < FALLBACK_THRESHOLD) {
    try {
      const fallback = await searchGmailFallback(env, keywords);
      if (fallback.length) {
        sections.push("*Gmail 検索の結果*\n_Gmail 側は語の前方一致のみ_\n" + fallback.join("\n"));
      }
    } catch (err) {
      console.error("searchMail: Gmail fallback failed:", err);
      sections.push("_Gmail 側の検索に失敗しました_");
    }
  }

  if (!sections.length) return `${header}\n\n該当するメールはありません`;
  return `${header}\n\n${sections.join("\n\n")}`;
}
