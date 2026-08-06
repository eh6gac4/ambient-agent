import type { Env } from "./types.js";
import { checkGmail, learnFromCancelled } from "./handlers/gmail.js";
import { syncCalendar } from "./handlers/calendar.js";
import { sendDailyBriefing, sendWeeklyCostReport } from "./handlers/briefing.js";
import { sendStaleTasksNotice } from "./handlers/escalation.js";
import { handleTelegramWebhook } from "./handlers/telegram.js";
import { handleHomeArrival } from "./handlers/home-arrival.js";
import { handleOfficeLeave } from "./handlers/office-leave.js";
import { handleOwnTracksLocation } from "./handlers/location.js";
import { sendMessage } from "./clients/telegram.js";
import { isHoliday } from "./utils/holiday.js";
import { cleanOldProcessed, cleanOldLocations, cleanOldAppLogs, insertAppLog } from "./storage/d1.js";
import { reportError } from "./handlers/error-handler.js";

// 無料プランの Cron 上限（5個）に合わせて5ジョブに統合
async function hourlyGmail(env: Env): Promise<void> {
  await checkGmail(env, { silent: true });
  // Notion で日時が編集されたタスクをカレンダーへ反映。
  // 失敗してもメール処理結果には影響させない。
  try {
    await syncCalendar(env);
  } catch (err) {
    await reportError(env, "hourlyGmail: syncCalendar", err);
  }
}

async function morningPrep(env: Env): Promise<void> {
  await learnFromCancelled(env);
  await syncCalendar(env);

  try {
    await cleanOldProcessed(env);
    await cleanOldLocations(env);
    await cleanOldAppLogs(env);
  } catch (err) {
    await reportError(env, "morningPrep: cleanup", err);
  }
}

async function morningBriefing(env: Env): Promise<void> {
  await sendDailyBriefing(env);
}

const CRON_JOBS: Record<string, (env: Env) => Promise<void>> = {
  "30 22-23,0-12 * * *": hourlyGmail,  // 毎時30分 (JST 07:30-21:30): silent gmail batch
  "20 20 * * *": morningPrep,          // 05:20 JST: learn→calendar
  "30 20 * * *": morningBriefing,       // 05:30 JST: briefing (events/tasks/escalations/digest)
  "30 20 * * SUN": sendWeeklyCostReport, // 日 05:30 JST: cost report
  "0 0 * * 1": sendStaleTasksNotice,   // 月 09:00 JST
};

// 休日（土日・祝日）にスキップするジョブ。hourlyGmail はサイレント処理なので除外。
const SKIP_ON_HOLIDAY = new Set([
  "20 20 * * *",
  "30 20 * * *",
  "30 20 * * SUN",
  "0 0 * * 1",
]);

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);

    if (url.pathname === "/webhook" && req.method === "POST") {
      try {
        const body = await req.json();
        await handleTelegramWebhook(env, body);
      } catch (err) {
        await reportError(env, "Webhook", err);
      }
      return new Response("OK");
    }

    // iPhone ショートカット（帰宅Wi-Fi接続時）から呼ばれる帰宅トリガー。Bearer トークンで認証。
    if (url.pathname === "/home-arrival" && req.method === "GET") {
      const auth = req.headers.get("Authorization");
      if (!env.ALERT_TOKEN || auth !== `Bearer ${env.ALERT_TOKEN}`) {
        return new Response("Unauthorized", { status: 401 });
      }
      await insertAppLog(env, "info", "API /home-arrival called", {});
      try {
        const notifications = await handleHomeArrival(env);
        return new Response(JSON.stringify({ notifications }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      } catch (err) {
        await reportError(env, "home-arrival", err);
        return new Response(JSON.stringify({ notifications: [] }), {
          status: 500,
          headers: { "Content-Type": "application/json" },
        });
      }
    }

    // iPhone ショートカット（会社Wi-Fi切断時）から呼ばれる退社トリガー。Bearer トークンで認証。
    if (url.pathname === "/office-leave" && req.method === "GET") {
      const auth = req.headers.get("Authorization");
      if (!env.ALERT_TOKEN || auth !== `Bearer ${env.ALERT_TOKEN}`) {
        return new Response("Unauthorized", { status: 401 });
      }
      await insertAppLog(env, "info", "API /office-leave called", {});
      try {
        const notifications = await handleOfficeLeave(env);
        return new Response(JSON.stringify({ notifications }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      } catch (err) {
        await reportError(env, "office-leave", err);
        return new Response(JSON.stringify({ notifications: [] }), {
          status: 500,
          headers: { "Content-Type": "application/json" },
        });
      }
    }

    // OwnTracks → マネージドMQTT(EMQX Cloud 等) → Webhook で呼ばれる位置情報受信エンドポイント。
    // Bearer トークンで認証。ブローカー側の再送ループを避けるため常に 200 を返す。
    if (url.pathname === "/owntracks" && req.method === "POST") {
      const auth = req.headers.get("Authorization");
      if (!env.OWNTRACKS_TOKEN || auth !== `Bearer ${env.OWNTRACKS_TOKEN}`) {
        return new Response("Unauthorized", { status: 401 });
      }
      try {
        const body = (await req.json()) as any;
        await handleOwnTracksLocation(env, body);
      } catch (err) {
        await reportError(env, "owntracks", err);
      }
      return new Response("OK");
    }

    return new Response("ambient-agent", { status: 200 });
  },

  async scheduled(event: ScheduledEvent, env: Env): Promise<void> {
    const job = CRON_JOBS[event.cron];
    if (!job) {
      console.warn("Unknown cron:", event.cron);
      return;
    }

    if (SKIP_ON_HOLIDAY.has(event.cron) && await isHoliday()) {
      console.log("Holiday: skipping job", event.cron);
      return;
    }

    try {
      await job(env);
    } catch (err) {
      const jobName = Object.entries(CRON_JOBS).find(([, fn]) => fn === job)?.[0] ?? event.cron;
      await reportError(env, `Scheduled Job: ${jobName}`, err);
    }
  },
};
