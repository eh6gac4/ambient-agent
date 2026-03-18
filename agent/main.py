"""
ambient-agent / main.py
スケジューラを起動し、各ジョブを登録する。
"""
import logging
import os
from dotenv import load_dotenv
from apscheduler.schedulers.blocking import BlockingScheduler

from agent.gmail_handler import process_unread_emails
from agent.calendar_handler import send_daily_briefing

load_dotenv()
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger(__name__)


def main():
    scheduler = BlockingScheduler(timezone="Asia/Tokyo")

    # Gmail → Notion タスク抽出（15分毎）
    interval_min = int(os.getenv("GMAIL_CHECK_INTERVAL_MINUTES", 15))
    scheduler.add_job(
        process_unread_emails,
        "interval",
        minutes=interval_min,
        id="gmail_check",
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

    logger.info("Ambient Agent started.")
    try:
        scheduler.start()
    except (KeyboardInterrupt, SystemExit):
        logger.info("Shutting down.")


if __name__ == "__main__":
    main()
