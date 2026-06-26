import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMockEnv } from "../../helpers/mocks.js";

vi.mock("../../../src/handlers/home-arrival.js", () => ({
  handleHomeArrival: vi.fn().mockResolvedValue([]),
}));

vi.mock("../../../src/handlers/office-leave.js", () => ({
  handleOfficeLeave: vi.fn().mockResolvedValue([]),
}));

vi.mock("../../../src/clients/telegram.js", () => ({
  sendMessage: vi.fn().mockResolvedValue(undefined),
  getFileUrl: vi.fn(),
  escapeMd: (t: string) => t,
}));

// モック後に動的 import
async function getModule() {
  return import("../../../src/handlers/geofence-actions.js");
}

const baseCtx = {
  regionId: "home",
  transition: "enter" as const,
  location: { lat: 35.68, lon: 139.76, tst: 1718000000 },
};

describe("runGeofenceAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("spec が undefined のとき何もしない", async () => {
    const { runGeofenceAction } = await getModule();
    const env = createMockEnv();
    await expect(runGeofenceAction(env, undefined, baseCtx)).resolves.toBeUndefined();
  });

  it("文字列 'home_arrival' で handleHomeArrival を呼ぶ", async () => {
    const { runGeofenceAction } = await getModule();
    const { handleHomeArrival } = await import("../../../src/handlers/home-arrival.js");
    const env = createMockEnv();

    await runGeofenceAction(env, "home_arrival", baseCtx);
    expect(handleHomeArrival).toHaveBeenCalledWith(env);
  });

  it("文字列 'office_leave' で handleOfficeLeave を呼ぶ", async () => {
    const { runGeofenceAction } = await getModule();
    const { handleOfficeLeave } = await import("../../../src/handlers/office-leave.js");
    const env = createMockEnv();

    await runGeofenceAction(env, "office_leave", { ...baseCtx, regionId: "office", transition: "leave" });
    expect(handleOfficeLeave).toHaveBeenCalledWith(env);
  });

  it("オブジェクト形式 telegram_notify でカスタムメッセージを送る", async () => {
    const { runGeofenceAction } = await getModule();
    const { sendMessage } = await import("../../../src/clients/telegram.js");
    const env = createMockEnv();

    await runGeofenceAction(env, { action: "telegram_notify", message: "🏋️ ジムに到着" }, baseCtx);
    expect(sendMessage).toHaveBeenCalledWith(env, "🏋️ ジムに到着");
  });

  it("telegram_notify で message 未指定時はデフォルト文言を送る", async () => {
    const { runGeofenceAction } = await getModule();
    const { sendMessage } = await import("../../../src/clients/telegram.js");
    const env = createMockEnv();

    await runGeofenceAction(env, "telegram_notify", { ...baseCtx, regionId: "gym", transition: "enter" });
    expect(sendMessage).toHaveBeenCalledWith(env, "gym enter");
  });

  it("未知のアクション名は警告ログのみで例外を投げない", async () => {
    const { runGeofenceAction } = await getModule();
    const env = createMockEnv();
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    await expect(runGeofenceAction(env, "unknown_action", baseCtx)).resolves.toBeUndefined();
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});
