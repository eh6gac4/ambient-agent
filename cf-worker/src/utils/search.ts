// メール検索のキーワード解析と LIKE 句の組み立て。
// Gmail API の検索は語の前方一致しかできないため、保管済みメールに対しては
// SQLite の LIKE '%kw%' で部分一致検索する。

const MAX_KEYWORDS = 5;
const SNIPPET_RADIUS = 40;

/**
 * 入力文字列をキーワードに分割する。空白区切りで、`"..."` で囲んだ部分は 1 語として扱う。
 */
export function parseKeywords(input: string): string[] {
  const keywords: string[] = [];
  const pattern = /"([^"]*)"|(\S+)/g;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(input)) !== null) {
    const word = (match[1] ?? match[2] ?? "").trim();
    if (word) keywords.push(word);
    if (keywords.length >= MAX_KEYWORDS) break;
  }

  return keywords;
}

/** LIKE パターン内で意味を持つ文字をエスケープする（ESCAPE '\' と併用する）。 */
export function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/**
 * 全キーワードを AND で結合した where 句を組み立てる。
 * 1 語につき件名・本文・送信者のいずれかに部分一致すればヒットとする。
 */
export function buildEmailSearchQuery(keywords: string[]): { where: string; binds: string[] } {
  const where = keywords
    .map(
      () =>
        "(subject LIKE ? ESCAPE '\\' OR body LIKE ? ESCAPE '\\' OR sender_email LIKE ? ESCAPE '\\')",
    )
    .join(" AND ");

  const binds = keywords.flatMap((k) => {
    const pattern = `%${escapeLike(k)}%`;
    return [pattern, pattern, pattern];
  });

  return { where, binds };
}

/** 本文から最初にヒットしたキーワードの周辺を抜き出す。ヒットしなければ先頭を返す。 */
export function extractSnippet(body: string, keywords: string[], radius = SNIPPET_RADIUS): string {
  const flat = body.replace(/\s+/g, " ").trim();
  if (!flat) return "";

  const lower = flat.toLowerCase();
  let hit = -1;
  for (const k of keywords) {
    const index = lower.indexOf(k.toLowerCase());
    if (index !== -1 && (hit === -1 || index < hit)) hit = index;
  }

  const start = hit === -1 ? 0 : Math.max(0, hit - radius);
  const end = Math.min(flat.length, start + radius * 2);
  const prefix = start > 0 ? "…" : "";
  const suffix = end < flat.length ? "…" : "";
  return `${prefix}${flat.slice(start, end)}${suffix}`;
}
