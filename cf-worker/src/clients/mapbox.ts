import type { Env } from "../types.js";

export interface MapboxPoi {
  name: string;
  category: string;
}

/**
 * 緯度・経度から最も近い POI（店舗・施設）の情報を取得する
 */
export async function getMapboxPoi(env: Env, lat: number, lon: number): Promise<MapboxPoi | null> {
  if (!env.MAPBOX_ACCESS_TOKEN) return null;

  const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${lon},${lat}.json?types=poi&access_token=${env.MAPBOX_ACCESS_TOKEN}&language=ja`;
  
  try {
    const res = await fetch(url);
    if (!res.ok) {
      console.error(`Mapbox API error: ${res.status} ${res.statusText}`);
      return null;
    }
    const data = await res.json() as any;
    if (data.features && data.features.length > 0) {
      // 一番近いPOIを取得
      const feature = data.features[0];
      const category = feature.properties?.category || "poi";
      return {
        name: feature.text,
        category,
      };
    }
    return null;
  } catch (err) {
    console.error("Failed to fetch from Mapbox API", err);
    return null;
  }
}
