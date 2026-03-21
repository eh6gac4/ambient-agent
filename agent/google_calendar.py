"""
agent/google_calendar.py
Google Calendar への書き込み操作。
"""
import logging
from googleapiclient.discovery import build

from agent.google_auth import get_credentials

logger = logging.getLogger(__name__)


def add_calendar_event(title: str, due: str) -> None:
    """カレンダーにイベントを登録する。
    due が YYYY-MM-DD なら終日イベント、YYYY-MM-DDTHH:MM なら1時間の時間指定イベント。
    """
    try:
        service = build("calendar", "v3", credentials=get_credentials())
        if "T" in due:
            # 時刻付き → JST として1時間イベント
            from datetime import datetime, timezone, timedelta
            JST = timezone(timedelta(hours=9))
            start_dt = datetime.fromisoformat(due).replace(tzinfo=JST)
            end_dt = start_dt + timedelta(hours=1)
            body = {
                "summary": title,
                "start": {"dateTime": start_dt.isoformat(), "timeZone": "Asia/Tokyo"},
                "end": {"dateTime": end_dt.isoformat(), "timeZone": "Asia/Tokyo"},
            }
        else:
            body = {
                "summary": title,
                "start": {"date": due},
                "end": {"date": due},
            }
        service.events().insert(calendarId="primary", body=body).execute()
        logger.info("Calendar event added: %s on %s", title, due)
    except Exception:
        logger.exception("Failed to add calendar event: %s", title)
