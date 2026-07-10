import type { Env } from "../types.js";
import { haversineMeters, isInside, detectTransition } from "../utils/geofence.js";
import { withRetry } from "../utils/retry.js";
import { getRegions, getGeofenceState, setGeofenceState } from "../storage/kv.js";
import { insertLocation, insertAppLog } from "../storage/d1.js";
import { runGeofenceAction } from "./geofence-actions.js";
import { getMapboxPoi } from "../clients/mapbox.js";
import { getOpenTasks } from "../clients/notion.js";
import { selectPoiTasks } from "../clients/gemini.js";
import { sendMessage } from "../clients/telegram.js";

/** OwnTracks の location ペイロード（最小限の型定義）。 */
interface OwnTracksPayload {
  _type: string;
  lat?: number;
  lon?: number;
  tst?: number;
  acc?: number;
  vel?: number; // 速度 (km/h)
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
  await insertAppLog(env, "info", "handleOwnTracksLocation: getRegions result", { regionsCount: regions.length, regions });

  await Promise.all(
    regions.map(async (region) => {
      const distanceM = haversineMeters(lat, lon, region.lat, region.lon);
      const current = isInside(distanceM, region.radius_m) ? "inside" : "outside";
      const prev = await getGeofenceState(env, region.id);
      const transition = detectTransition(prev, current);
      
      await insertAppLog(env, "info", `geofence eval for ${region.id}`, { distanceM, current, prev, transition });

      // 状態が変化した時だけ KV へ書き込む（KV 書き込み無料枠の節約）
      // null（初回）→ "inside"/"outside" も current !== prev として必ず1回保存される
      if (current !== prev) {
        await insertAppLog(env, "info", `setting state for ${region.id}`, { current });
        try {
          await withRetry(() => setGeofenceState(env, region.id, current));
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : String(err);
          await insertAppLog(env, "error", `failed to set state for ${region.id}`, { error: errMsg });
          console.error(`owntracks: failed to set geofence state for ${region.id}`, err);
          // If we fail to save state, we still proceed with action to not miss notifications,
          // but next time it might trigger again.
        }
      }

      if (!transition) return;

      console.log(
        JSON.stringify({
          event: "geofence_transition",
          regionId: region.id,
          transition,
          distanceM: Math.round(distanceM),
          lat,
          lon,
          tst,
        }),
      );

      const ctx = { regionId: region.id, transition, location: { lat, lon, tst } };
      const spec = transition === "enter" ? region.onEnter : region.onLeave;

      try {
        await insertAppLog(env, "info", `running action for ${region.id}`, { spec, transition });
        await withRetry(() => runGeofenceAction(env, spec, ctx), 2);
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        await insertAppLog(env, "error", `action failed for ${region.id}`, { error: errMsg, transition });
        console.error(`owntracks: action failed for region "${region.id}" (${transition}):`, err);
      }
    }),
  );

  // 3. Mapbox POI ベースのタスク提案 (停止時のみ)
  // vel が 0 〜 5 km/h であれば、ほぼ停止しているとみなす
  if (payload.vel != null && payload.vel < 5) {
    const poiKey = device ? `poi_check_${device}` : `poi_check_default`;
    const lastCheckStr = await env.AGENT_KV.get(poiKey);
    let shouldCheck = false;
    
    if (lastCheckStr) {
      try {
        const lastCheck = JSON.parse(lastCheckStr);
        const dist = haversineMeters(lat, lon, lastCheck.lat, lastCheck.lon);
        // 前回チェックした地点から200m以上離れて停止したら再チェック
        if (dist > 200) {
          shouldCheck = true;
        }
      } catch (e) {
        shouldCheck = true;
      }
    } else {
      shouldCheck = true;
    }

    if (shouldCheck) {
      // 連続で呼ばれないよう、即座に位置を記録
      await env.AGENT_KV.put(poiKey, JSON.stringify({ lat, lon, tst }));

      // Mapbox で周辺の施設を取得
      const poi = await getMapboxPoi(env, lat, lon);
      if (poi && poi.name) {
        await insertAppLog(env, "info", `Mapbox POI detected for ${device || "unknown"}`, { poi });
        
        // Notion から未完了タスクを取得
        const openTasks = await getOpenTasks(env);

        // Gemini にタスクの関連性を判定させる
        const relatedTasks = await selectPoiTasks(env, openTasks, poi.name, poi.category);

        if (relatedTasks.length > 0) {
          const lines = [`📍 **${poi.name}** 付近にいるみたいやね！\nここでできそうなタスクがあるで：\n`];
          for (const rt of relatedTasks) {
            lines.push(`- ${rt.title}\n  (_${rt.reason}_)`);
          }
          await sendMessage(env, lines.join("\n"));
          await insertAppLog(env, "info", "Sent POI task suggestion", { poi, relatedTasks });
        }
      }
    }
  }
}
