import type { Env } from "../types.js";
import { haversineMeters, isInside, detectTransition } from "../utils/geofence.js";
import { getRegions, getGeofenceState, setGeofenceState } from "../storage/kv.js";
import { insertLocation } from "../storage/d1.js";
import { runGeofenceAction } from "./geofence-actions.js";

/** OwnTracks の location ペイロード（最小限の型定義）。 */
interface OwnTracksPayload {
  _type: string;
  lat?: number;
  lon?: number;
  tst?: number;
  acc?: number;
  /** トピック `owntracks/<user>/<device>` の device 部分。ブローカー側で埋める想定。 */
  topic?: string;
}

/**
 * OwnTracks からの位置情報を処理する。
 * - D1 に履歴保存
 * - 各リージョンに対してジオフェンス判定 → 遷移時にアクション実行
 */
export async function handleOwnTracksLocation(
  env: Env,
  payload: OwnTracksPayload,
): Promise<void> {
  if (payload._type !== "location") return;

  const lat = payload.lat;
  const lon = payload.lon;
  const tst = payload.tst ?? Math.floor(Date.now() / 1000);

  // 座標が取れない場合はスキップ
  if (lat == null || lon == null) {
    console.warn("owntracks: missing lat/lon, skipping");
    return;
  }

  // device をトピック文字列から抽出（例: "owntracks/user/device" → "device"）
  const device = payload.topic ? payload.topic.split("/").at(-1) ?? null : null;

  // 1. 位置履歴を D1 に保存
  try {
    await insertLocation(env, { tst, lat, lon, acc: payload.acc, device });
  } catch (err) {
    // 履歴保存の失敗はアクション実行を止めない
    console.error("owntracks: insertLocation failed:", err);
  }

  // 2. 各リージョンに対してジオフェンス判定
  const regions = await getRegions(env);

  await Promise.all(
    regions.map(async (region) => {
      const distanceM = haversineMeters(lat, lon, region.lat, region.lon);
      const current = isInside(distanceM, region.radius_m) ? "inside" : "outside";
      const prev = await getGeofenceState(env, region.id);
      const transition = detectTransition(prev, current);

      // 状態が変化した時だけ KV へ書き込む（KV 書き込み無料枠の節約）
      // null（初回）→ "inside"/"outside" も current !== prev として必ず1回保存される
      if (current !== prev) {
        await setGeofenceState(env, region.id, current);
      }

      if (!transition) return;

      const ctx = { regionId: region.id, transition, location: { lat, lon, tst } };
      const spec = transition === "enter" ? region.onEnter : region.onLeave;

      try {
        await runGeofenceAction(env, spec, ctx);
      } catch (err) {
        console.error(`owntracks: action failed for region "${region.id}" (${transition}):`, err);
      }
    }),
  );
}
