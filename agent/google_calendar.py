"""
agent/google_calendar.py
Google Calendar への書き込み操作。
"""
import logging
from googleapiclient.discovery import build

from agent.google_auth import get_credentials

logger = logging.getLogger(__name__)


def add_calendar_event(title: str, date: str) -> None:
    """終日イベントとしてカレンダーに登録する。date は YYYY-MM-DD 形式。"""
    try:
        service = build("calendar", "v3", credentials=get_credentials())
        service.events().insert(
            calendarId="primary",
            body={
                "summary": title,
                "start": {"date": date},
                "end": {"date": date},
            },
        ).execute()
        logger.info("Calendar event added: %s on %s", title, date)
    except Exception:
        logger.exception("Failed to add calendar event: %s", title)
