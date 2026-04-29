import type { Env } from "./types.js";
import { checkGmail, learnFromCancelled } from "./handlers/gmail.js";
import { syncCalendar, sendDueSoonNotice, sendTaskReminder } from "./handlers/calendar.js";
import { sendDailyBriefing, sendCostReport, sendEmailDigest } from "./handlers/briefing.js";
import { sendEscalationNotice, sendStaleTasksNotice } from "./handlers/escalation.js";
import { handleTelegramWebhook } from "./handlers/telegram.js";
import { sendMessage } from "./clients/telegram.js";

// 無料プランの Cron 上限（5個）に合わせて5ジョブに統合
async function hourlyGmail(env: Env): Promise<void> {
  await checkGmail(env, { silent: true });
}

async function morningPrep(env: Env): Promise<void> {
  await learnFromCancelled(env);
  await syncCalendar(env);
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
  "0 4 * * *": sendTaskReminder,       // 13:00 JST
  "0 0 * * 1": sendStaleTasksNotice,   // 月 09:00 JST
};

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

    return new Response("ambient-agent", { status: 200 });
  },

  async scheduled(event: ScheduledEvent, env: Env): Promise<void> {
    const job = CRON_JOBS[event.cron];
    if (!job) {
      console.warn("Unknown cron:", event.cron);
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
