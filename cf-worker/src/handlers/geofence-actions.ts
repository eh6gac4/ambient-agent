import type { Env, GeofenceContext, GeofenceActionSpec } from "../types.js";
import { handleHomeArrival } from "./home-arrival.js";
import { handleOfficeLeave } from "./office-leave.js";
import { sendMessage } from "../clients/telegram.js";

type GeofenceAction = (env: Env, ctx: GeofenceContext) => Promise<void>;

/**
 * 名前付きアクションのレジストリ。
 * 新しいアクションを追加するには ACTIONS にエントリを追加するだけでよい。
 */
const ACTIONS: Record<string, GeofenceAction> = {
  /** 帰宅通知（既存フローを再利用）。 */
  home_arrival: async (env) => {
    await handleHomeArrival(env);
  },

  /** 退社通知（既存フローを再利用）。 */
  office_leave: async (env) => {
    await handleOfficeLeave(env);
  },

  /**
   * 任意の Telegram メッセージを送信する。
   * params.message に送信テキストを指定する。未指定時は "{regionId} {transition}"。
   */
  telegram_notify: async (env, ctx) => {
    const text = String(ctx.params.message ?? `${ctx.regionId} ${ctx.transition}`);
    await sendMessage(env, text);
  },
};

/**
 * ジオフェンス遷移時にアクションを実行する。
 * spec が未指定の場合は何もしない。未知のアクション名は警告ログのみ。
 */
export async function runGeofenceAction(
  env: Env,
  spec: GeofenceActionSpec | undefined,
  ctx: Omit<GeofenceContext, "params">,
): Promise<void> {
  if (!spec) return;

  const name = typeof spec === "string" ? spec : spec.action;
  const params: Record<string, unknown> =
    typeof spec === "string" ? {} : Object.fromEntries(
      Object.entries(spec).filter(([k]) => k !== "action"),
    );

  const fn = ACTIONS[name];
  if (!fn) {
    console.warn(`geofence-actions: unknown action "${name}" for region "${ctx.regionId}"`);
    return;
  }

  await fn(env, { ...ctx, params });
}
