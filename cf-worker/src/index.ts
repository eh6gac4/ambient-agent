import type { Env } from "./types.js";
import { checkGmail, learnFromCancelled } from "./handlers/gmail.js";
import { syncCalendar, sendDueSoonNotice, sendTaskReminder } from "./handlers/calendar.js";
import { sendDailyBriefing, sendCostReport } from "./handlers/briefing.js";
import { sendEscalationNotice, sendStaleTasksNotice } from "./handlers/escalation.js";
import { handleTelegramWebhook } from "./handlers/telegram.js";
import { sendMessage } from "./clients/telegram.js";

// Cron → job mapping (UTC cron expressions from wrangler.toml)
const CRON_JOBS: Record<string, (env: Env) => Promise<void>> = {
  "50 22 * * *": learnFromCancelled,   // 07:50 JST
  "55 22 * * *": checkGmail,           // 07:55 JST
  "57 22 * * *": syncCalendar,         // 07:57 JST
  "58 22 * * *": sendEscalationNotice, // 07:58 JST
  "0 23 * * *": sendDailyBriefing,     // 08:00 JST
  "5 23 * * *": sendCostReport,        // 08:05 JST
  "10 23 * * *": sendDueSoonNotice,    // 08:10 JST
  "0 4 * * *": sendTaskReminder,       // 13:00 JST
  "0 0 * * 1": sendStaleTasksNotice,   // Mon 09:00 JST
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
