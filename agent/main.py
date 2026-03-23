"""
ambient-agent / main.py
スケジューラを起動し、各ジョブを登録する。
"""
import logging
import logging.handlers
import os
import signal
from dotenv import load_dotenv
from apscheduler.schedulers.blocking import BlockingScheduler
from apscheduler.events import EVENT_JOB_ERROR

from agent.config import OPERATING_START_HOUR, OPERATING_END_HOUR
from agent.gmail_handler import process_unread_emails
from agent.calendar_handler import send_daily_briefing, send_task_reminder, send_escalation_notice
from agent.google_calendar import sync_calendar
from agent.telegram_handler import run_listener
from agent.telegram_notifier import send_message
from agent.usage_tracker import send_cost_report

load_dotenv()

_LOG_FORMAT = "%(asctime)s [%(levelname)s] %(name)s: %(message)s"
_LOG_DIR = "data/logs"
os.makedirs(_LOG_DIR, exist_ok=True)

logging.basicConfig(level=logging.INFO, format=_LOG_FORMAT)

_file_handler = logging.handlers.TimedRotatingFileHandler(
    filename=os.path.join(_LOG_DIR, "agent.log"),
    when="midnight",
    backupCount=7,
    encoding="utf-8",
)
_file_handler.setFormatter(logging.Formatter(_LOG_FORMAT))
logging.getLogger().addHandler(_file_handler)

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

    # Telegram ロングポーリング（メッセージ着信時即時処理）
    run_listener()

    briefing_hour = int(os.getenv("DAILY_BRIEFING_HOUR", 8))
    pre_briefing_hour = briefing_hour - 1

    # Gmail → Notion タスク抽出（ブリーフィング5分前、まだ未読のメールに Claude を実行）
    scheduler.add_job(
        process_unread_emails,
        "cron",
        hour=pre_briefing_hour,
        minute=55,
        id="gmail_check",
    )

    # タスクリマインド（13:00）
    reminder_hours = os.getenv("TASK_REMINDER_HOURS", "13")
    scheduler.add_job(
        send_task_reminder,
        "cron",
        hour=reminder_hours,
        minute=0,
        id="task_reminder",
    )

    # カレンダー同期（完了済み削除 + 未着手タスク登録、ブリーフィング3分前）
    scheduler.add_job(
        sync_calendar,
        "cron",
        hour=pre_briefing_hour,
        minute=57,
        id="calendar_sync",
    )

    # 優先度昇格（毎朝ブリーフィング前）
    scheduler.add_job(
        send_escalation_notice,
        "cron",
        hour=pre_briefing_hour,
        minute=58,
        id="priority_escalation",
    )
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

    def _shutdown(signum, frame):
        scheduler.shutdown(wait=False)

    signal.signal(signal.SIGTERM, _shutdown)

    logger.info("Ambient Agent started.")
    try:
        scheduler.start()
    except (KeyboardInterrupt, SystemExit):
        logger.info("Shutting down.")


if __name__ == "__main__":
    main()
