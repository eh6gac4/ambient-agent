"""
ambient-agent / main.py
スケジューラを起動し、各ジョブを登録する。
"""
import logging
import os
from dotenv import load_dotenv
from apscheduler.schedulers.blocking import BlockingScheduler
from apscheduler.events import EVENT_JOB_ERROR

from agent.gmail_handler import process_unread_emails
from agent.calendar_handler import send_daily_briefing, send_task_reminder, send_overdue_alert
from agent.telegram_handler import process_telegram_messages
from agent.telegram_notifier import send_message
from agent.usage_tracker import send_cost_report

load_dotenv()
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger(__name__)


def _on_job_error(event):
    exc = event.exception
    msg = f"⚠️ *Ambient Agent エラー*\nJob: `{event.job_id}`\n```\n{type(exc).__name__}: {exc}\n```"
    logger.error("Job %s failed: %s", event.job_id, exc)
    try:
        send_message(msg)
    except Exception as e:
        logger.error("Failed to send error notification: %s", e)


def main():
    scheduler = BlockingScheduler(timezone="Asia/Tokyo")
    scheduler.add_listener(_on_job_error, EVENT_JOB_ERROR)

    # Telegram メッセージ取得・タスク抽出（1分毎）
    scheduler.add_job(
        process_telegram_messages,
        "interval",
        minutes=1,
        id="telegram_check",
    )

    # Gmail → Notion タスク抽出（15分毎）
    interval_min = int(os.getenv("GMAIL_CHECK_INTERVAL_MINUTES", 15))
    scheduler.add_job(
        process_unread_emails,
        "interval",
        minutes=interval_min,
        id="gmail_check",
    )

    # タスクリマインド（指定時間毎）
    reminder_hours = int(os.getenv("TASK_REMINDER_INTERVAL_HOURS", 3))
    scheduler.add_job(
        send_task_reminder,
        "interval",
        hours=reminder_hours,
        id="task_reminder",
    )

    # 期限切れタスクアラート（毎朝指定時刻）
    overdue_alert_hour = int(os.getenv("OVERDUE_ALERT_HOUR", 9))
    scheduler.add_job(
        send_overdue_alert,
        "cron",
        hour=overdue_alert_hour,
        minute=0,
        id="overdue_alert",
    )

    # 日次ブリーフィング（毎朝指定時刻）
    briefing_hour = int(os.getenv("DAILY_BRIEFING_HOUR", 8))
    scheduler.add_job(
        send_daily_briefing,
        "cron",
        hour=briefing_hour,
        minute=0,
        id="daily_briefing",
    )

    # コストレポート（毎朝日次ブリーフィングの直後）
    cost_report_hour = int(os.getenv("COST_REPORT_HOUR", briefing_hour))
    scheduler.add_job(
        send_cost_report,
        "cron",
        hour=cost_report_hour,
        minute=5,
        id="cost_report",
    )

    logger.info("Ambient Agent started.")
    try:
        scheduler.start()
    except (KeyboardInterrupt, SystemExit):
        logger.info("Shutting down.")


if __name__ == "__main__":
    main()
