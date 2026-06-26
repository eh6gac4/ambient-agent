import type { Env } from "./types.js";
import { checkGmail, learnFromCancelled } from "./handlers/gmail.js";
import { syncCalendar, sendDueSoonNotice } from "./handlers/calendar.js";
import { sendDailyBriefing, sendCostReport, sendEmailDigest } from "./handlers/briefing.js";
import { sendBacklogPromotionNotice, sendEscalationNotice, sendStaleTasksNotice } from "./handlers/escalation.js";
import { handleTelegramWebhook } from "./handlers/telegram.js";
import { handleHomeArrival } from "./handlers/home-arrival.js";
import { handleOfficeLeave } from "./handlers/office-leave.js";
import { handleOwnTracksLocation } from "./handlers/location.js";
import { sendMessage } from "./clients/telegram.js";
import { isHoliday } from "./utils/holiday.js";

// 無料プランの Cron 上限（5個）に合わせて5ジョブに統合
async function hourlyGmail(env: Env): Promise<void> {
  await checkGmail(env, { silent: true });
  // Notion で日時が編集されたタスクをカレンダーへ反映。
  // 失敗してもメール処理結果には影響させない。
  try {
    await syncCalendar(env);
  } catch (err) {
    console.error("hourlyGmail: syncCalendar failed:", err);
  }
}

async function morningPrep(env: Env): Promise<void> {
  await learnFromCancelled(env);
  await syncCalendar(env);
  await sendBacklogPromotionNotice(env);
  await sendEscalationNotice(env);
}

async function morningBriefing(env: Env): Promise<void> {
  await sendDailyBriefing(env);
  await sendCostReport(env);
  await sendDueSoonNotice(env);
  await sendEmailDigest(env);
}

const CRON_JOBS: Record<string, (env: Env) => Promise<void>> = {
  "30 22-23,0-12 * * *": hourlyGmail,  // 毎時30分 (JST 07:30-21:30): silent gmail batch
  "50 22 * * *": morningPrep,          // 07:50 JST: learn→calendar→escalation
  "0 23 * * *": morningBriefing,       // 08:00 JST: briefing→cost→due_soon→email_digest
  "0 0 * * 1": sendStaleTasksNotice,   // 月 09:00 JST
};

// 休日（土日・祝日）にスキップするジョブ。hourlyGmail はサイレント処理なので除外。
const SKIP_ON_HOLIDAY = new Set([
  "50 22 * * *",
  "0 23 * * *",
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
        console.error("Webhook error:", err);
      }
      return new Response("OK");
    }

    // iPhone ショートカット（帰宅Wi-Fi接続時）から呼ばれる帰宅トリガー。Bearer トークンで認証。
    if (url.pathname === "/home-arrival" && req.method === "GET") {
      const auth = req.headers.get("Authorization");
      if (!env.ALERT_TOKEN || auth !== `Bearer ${env.ALERT_TOKEN}`) {
        return new Response("Unauthorized", { status: 401 });
      }
      try {
        const notifications = await handleHomeArrival(env);
        return new Response(JSON.stringify({ notifications }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      } catch (err) {
        console.error("home-arrival error:", err);
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
      try {
        const notifications = await handleOfficeLeave(env);
        return new Response(JSON.stringify({ notifications }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      } catch (err) {
        console.error("office-leave error:", err);
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
        const body = await req.json();
        await handleOwnTracksLocation(env, body);
      } catch (err) {
        console.error("owntracks error:", err);
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
      const msg = `⚠️ *Ambient Agent エラー*\nJob: \`${jobName}\`\n\`\`\`\n${err}\n\`\`\``;
      console.error(msg, err);
      try {
        await sendMessage(env, msg);
      } catch {
        // ignore notification failure
      }
    }
  },
};
