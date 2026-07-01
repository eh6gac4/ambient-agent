import { describe, it, expect, vi, beforeEach } from "vitest";
import worker from "../../src/index.js";
import { createMockEnv } from "../helpers/mocks.js";
import type { Region } from "../../src/types.js";

// ─── モック ──────────────────────────────────────────────────────────────────

vi.mock("../../src/utils/holiday.js", () => ({
  isHoliday: vi.fn().mockResolvedValue(false),
}));

vi.mock("../../src/clients/notion.js", () => ({
  getOpenTasks: vi.fn().mockResolvedValue([]),
}));

vi.mock("../../src/clients/gemini.js", () => ({
  selectHomeArrivalNotifications: vi.fn().mockResolvedValue([]),
  selectOfficeLeaveNotifications: vi.fn().mockResolvedValue([]),
}));

vi.mock("../../src/clients/telegram.js", () => ({
  sendMessage: vi.fn().mockResolvedValue(undefined),
  getFileUrl: vi.fn(),
  escapeMd: (t: string) => t,
}));

// ─── ヘルパー ─────────────────────────────────────────────────────────────────

/** 自宅リージョン: 東京駅付近 (lat=35.6812, lon=139.7671, radius=150m) */
const HOME_REGION: Region = {
  id: "home",
  lat: 35.6812,
  lon: 139.7671,
  radius_m: 150,
  onEnter: "home_arrival",
};

/** ジムリージョン: カスタム telegram_notify */
const GYM_REGION: Region = {
  id: "gym",
  lat: 35.6900,
  lon: 139.7500,
  radius_m: 100,
  onEnter: { action: "telegram_notify", message: "🏋️ ジムに到着" },
  onLeave: { action: "telegram_notify", message: "🏋️ ジムを退出" },
};

function ownTracksRequest(body: unknown, token?: string): Request {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  return new Request("https://example.com/owntracks", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

/** 自宅から 1km 圏外の座標（約 1km 北） */
const OUTSIDE_HOME = { lat: 35.6902, lon: 139.7671 };
/** 自宅から 50m 圏内の座標 */
const INSIDE_HOME = { lat: 35.6813, lon: 139.7671 };

/** ジムから 50m 圏内 */
const INSIDE_GYM = { lat: 35.6901, lon: 139.7501 };
/** ジムから 500m 圏外 */
const OUTSIDE_GYM = { lat: 35.6860, lon: 139.7450 };

function locationPayload(lat: number, lon: number): unknown {
  return { _type: "location", lat, lon, tst: Math.floor(Date.now() / 1000), acc: 10 };
}

// ─── テスト ───────────────────────────────────────────────────────────────────

describe("POST /owntracks", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("トークンなしは 401", async () => {
    const env = createMockEnv();
    const resp = await worker.fetch(ownTracksRequest(locationPayload(0, 0)), env);
    expect(resp.status).toBe(401);
  });

  it("誤ったトークンは 401", async () => {
    const env = createMockEnv();
    const resp = await worker.fetch(ownTracksRequest(locationPayload(0, 0), "wrong"), env);
    expect(resp.status).toBe(401);
  });

  it("正しいトークンで 200 を返す", async () => {
    const env = createMockEnv();
    // リージョン未設定なのでアクション不発だが 200
    const resp = await worker.fetch(
      ownTracksRequest(locationPayload(0, 0), env.OWNTRACKS_TOKEN),
      env,
    );
    expect(resp.status).toBe(200);
  });

  it("_type が location 以外は 200 で無視", async () => {
    const env = createMockEnv();
    const { sendMessage } = await import("../../src/clients/telegram.js");

    const resp = await worker.fetch(
      ownTracksRequest({ _type: "waypoint", lat: 35.68, lon: 139.76 }, env.OWNTRACKS_TOKEN),
      env,
    );
    expect(resp.status).toBe(200);
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it("圏外→圏内の遷移で home_arrival (handleHomeArrival) が発火する", async () => {
    const { getOpenTasks } = await import("../../src/clients/notion.js");
    const { selectHomeArrivalNotifications } = await import("../../src/clients/gemini.js");
    const { sendMessage } = await import("../../src/clients/telegram.js");

    (getOpenTasks as ReturnType<typeof vi.fn>).mockResolvedValue([
      { title: "タスク1", priority: "high", due: null, status: "未着手" },
    ]);
    (selectHomeArrivalNotifications as ReturnType<typeof vi.fn>).mockResolvedValue([
      { title: "タスク1", priority: "high" },
    ]);

    const env = createMockEnv();
    // KV に home リージョンを登録
    await env.AGENT_KV.put("geofence:regions", JSON.stringify([HOME_REGION]));

    // 1通目: 圏外
    await worker.fetch(
      ownTracksRequest(locationPayload(OUTSIDE_HOME.lat, OUTSIDE_HOME.lon), env.OWNTRACKS_TOKEN),
      env,
    );
    expect(sendMessage).not.toHaveBeenCalled();

    // 2通目: 圏内 → enter 遷移
    await worker.fetch(
      ownTracksRequest(locationPayload(INSIDE_HOME.lat, INSIDE_HOME.lon), env.OWNTRACKS_TOKEN),
      env,
    );
    expect(sendMessage).toHaveBeenCalledWith(env, expect.stringContaining("帰宅通知"));
  });

  it("圏内→圏内では再発火しない", async () => {
    const { getOpenTasks } = await import("../../src/clients/notion.js");
    const { selectHomeArrivalNotifications } = await import("../../src/clients/gemini.js");
    const { sendMessage } = await import("../../src/clients/telegram.js");

    (getOpenTasks as ReturnType<typeof vi.fn>).mockResolvedValue([
      { title: "タスク1", priority: "high", due: null, status: "未着手" },
    ]);
    (selectHomeArrivalNotifications as ReturnType<typeof vi.fn>).mockResolvedValue([
      { title: "タスク1", priority: "high" },
    ]);

    const env = createMockEnv();
    await env.AGENT_KV.put("geofence:regions", JSON.stringify([HOME_REGION]));

    // 圏外→圏内 (enter 発火)
    await worker.fetch(
      ownTracksRequest(locationPayload(OUTSIDE_HOME.lat, OUTSIDE_HOME.lon), env.OWNTRACKS_TOKEN),
      env,
    );
    await worker.fetch(
      ownTracksRequest(locationPayload(INSIDE_HOME.lat, INSIDE_HOME.lon), env.OWNTRACKS_TOKEN),
      env,
    );
    const callCountAfterEnter = (sendMessage as ReturnType<typeof vi.fn>).mock.calls.length;

    // さらに圏内のまま更新 → 再発火しない
    await worker.fetch(
      ownTracksRequest(locationPayload(INSIDE_HOME.lat, INSIDE_HOME.lon), env.OWNTRACKS_TOKEN),
      env,
    );
    expect((sendMessage as ReturnType<typeof vi.fn>).mock.calls.length).toBe(callCountAfterEnter);
  });

  it("同一状態が続く場合は KV へ書き込まない（write 最適化）", async () => {
    const env = createMockEnv();
    await env.AGENT_KV.put("geofence:regions", JSON.stringify([HOME_REGION]));

    const putSpy = vi.spyOn(env.AGENT_KV, "put");

    // 1通目（圏外）: 初回なので geofence:state:home への書き込みが発生する
    await worker.fetch(
      ownTracksRequest(locationPayload(OUTSIDE_HOME.lat, OUTSIDE_HOME.lon), env.OWNTRACKS_TOKEN),
      env,
    );
    const writesAfterFirst = putSpy.mock.calls.filter((c) =>
      String(c[0]).startsWith("geofence:state:"),
    ).length;
    expect(writesAfterFirst).toBe(1); // 初回は必ず書く

    // 2通目・3通目（同じく圏外）: 状態変化なし → 書き込みなし
    await worker.fetch(
      ownTracksRequest(locationPayload(OUTSIDE_HOME.lat, OUTSIDE_HOME.lon), env.OWNTRACKS_TOKEN),
      env,
    );
    await worker.fetch(
      ownTracksRequest(locationPayload(OUTSIDE_HOME.lat, OUTSIDE_HOME.lon), env.OWNTRACKS_TOKEN),
      env,
    );
    const writesAfterRepeat = putSpy.mock.calls.filter((c) =>
      String(c[0]).startsWith("geofence:state:"),
    ).length;
    expect(writesAfterRepeat).toBe(1); // 増えていない
  });

  it("gym リージョンの telegram_notify がカスタム文言で送られる", async () => {
    const { sendMessage } = await import("../../src/clients/telegram.js");

    const env = createMockEnv();
    await env.AGENT_KV.put("geofence:regions", JSON.stringify([GYM_REGION]));

    // 圏外→圏内 (enter)
    await worker.fetch(
      ownTracksRequest(locationPayload(OUTSIDE_GYM.lat, OUTSIDE_GYM.lon), env.OWNTRACKS_TOKEN),
      env,
    );
    await worker.fetch(
      ownTracksRequest(locationPayload(INSIDE_GYM.lat, INSIDE_GYM.lon), env.OWNTRACKS_TOKEN),
      env,
    );
    expect(sendMessage).toHaveBeenCalledWith(env, "🏋️ ジムに到着");

    vi.clearAllMocks();

    // 圏内→圏外 (leave)
    await worker.fetch(
      ownTracksRequest(locationPayload(OUTSIDE_GYM.lat, OUTSIDE_GYM.lon), env.OWNTRACKS_TOKEN),
      env,
    );
    expect(sendMessage).toHaveBeenCalledWith(env, "🏋️ ジムを退出");
  });
});
