/** Haversine 公式で2点間の距離（メートル）を返す。 */
export function haversineMeters(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const R = 6_371_000; // 地球半径(m)
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** 距離がリージョン半径以内かどうかを返す。 */
export function isInside(distanceM: number, radiusM: number): boolean {
  return distanceM <= radiusM;
}

/**
 * 前回状態と現在状態から遷移を検出する。
 * - null(初回) → inside  : "enter"
 * - outside    → inside  : "enter"
 * - null(初回) → outside : null (初回圏外は遷移なし)
 * - inside     → outside : "leave"
 * - 変化なし              : null
 */
export function detectTransition(
  prev: "inside" | "outside" | null,
  current: "inside" | "outside",
): "enter" | "leave" | null {
  if (current === "inside" && prev !== "inside") return "enter";
  if (current === "outside" && prev === "inside") return "leave";
  return null;
}
