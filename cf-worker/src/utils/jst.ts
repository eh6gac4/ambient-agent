// JST(Asia/Tokyo)に関する日時ヘルパー。
// 注意: utils/holiday.ts は独自実装の private ヘルパー（UTC オフセット加算方式）を
// 持つが、本ファイルは `toLocaleString` ベースの式を集約したもので実装が異なる。
// 値の意味が違うため両者は統合しない。

const TZ = "Asia/Tokyo";

/** 現在時刻を JST の壁時計として読める Date（getHours/setHours 等が JST 値になる）。 */
export function jstNow(): Date {
  return new Date(new Date().toLocaleString("en-US", { timeZone: TZ }));
}

/** 今日の日付を JST の YYYY-MM-DD で返す（sv-SE ロケール）。 */
export function jstDateStr(): string {
  return new Date().toLocaleDateString("sv-SE", { timeZone: TZ });
}

/** 現在時刻を JST の "YYYY/MM/DD HH:MM" 形式（ja-JP, 24 時間表記）で返す。 */
export function jstDateTimeStr(): string {
  return new Date().toLocaleString("ja-JP", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

/** Date を UTC 基準の YYYY-MM-DD 文字列に変換する。 */
export function toDateStr(d: Date): string {
  return d.toISOString().slice(0, 10);
}
