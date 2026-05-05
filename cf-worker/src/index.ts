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

const JOBS: Record<string, (env: Env) => Promise<void>> = {
  hourlyGmail,
  morningPrep,
  morningBriefing,
  taskReminder: sendTaskReminder,
  staleTasksNotice: sendStaleTasksNotice,
};

const CRON_JOBS: Record<string, keyof typeof JOBS> = {
  "30 22-23,0-12 * * *": "hourlyGmail",  // 毎時30分 (JST 07:30-21:30): silent gmail batch
  "50 22 * * *": "morningPrep",          // 07:50 JST: learn→calendar→escalation
  "0 23 * * *": "morningBriefing",       // 08:00 JST: briefing→cost→due_soon→email_digest
  "0 4 * * *": "taskReminder",           // 13:00 JST
  "0 0 * * 1": "staleTasksNotice",       // 月 09:00 JST
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

    if (url.pathname === "/admin/run" && req.method === "POST") {
      const expected = env.ADMIN_TOKEN;
      if (!expected) return new Response("ADMIN_TOKEN not configured", { status: 503 });
      const auth = req.headers.get("authorization") ?? "";
      const provided = auth.startsWith("Bearer ") ? auth.slice(7) : "";
      if (provided !== expected) return new Response("unauthorized", { status: 401 });

      const jobName = url.searchParams.get("job") ?? "";
      const job = JOBS[jobName];
      if (!job) {
        return new Response(`unknown job: ${jobName}. valid: ${Object.keys(JOBS).join(", ")}`, { status: 400 });
      }
      try {
        await job(env);
        return new Response(`ok: ${jobName}\n`);
      } catch (err) {
        console.error(`admin/run ${jobName} failed:`, err);
        return new Response(`error: ${err}\n`, { status: 500 });
      }
    }

    return new Response("ambient-agent", { status: 200 });
  },

  async scheduled(event: ScheduledEvent, env: Env): Promise<void> {
    const jobName = CRON_JOBS[event.cron];
    if (!jobName) {
      console.warn("Unknown cron:", event.cron);
      return;
    }

    try {
      await JOBS[jobName](env);
    } catch (err) {
      const msg = `⚠️ *Ambient Agent エラー*\nJob: \`${jobName}\` (\`${event.cron}\`)\n\`\`\`\n${err}\n\`\`\``;
      console.error(msg, err);
      try {
        await sendMessage(env, msg);
      } catch {
        // ignore notification failure
      }
    }
  },
};
