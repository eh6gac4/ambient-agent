"""
agent/google_calendar.py
Google Calendar への書き込み操作。
"""
import logging
from datetime import datetime, timezone, timedelta
from googleapiclient.discovery import build

from agent.google_auth import get_credentials

logger = logging.getLogger(__name__)

JST = timezone(timedelta(hours=9))
_SYNCED_IDS_FILE = "data/calendar_synced_ids.txt"


def _load_synced_ids() -> set[str]:
    try:
        with open(_SYNCED_IDS_FILE) as f:
            return set(line.strip() for line in f if line.strip())
    except FileNotFoundError:
        return set()


def _save_synced_id(page_id: str):
    with open(_SYNCED_IDS_FILE, "a") as f:
        f.write(page_id + "\n")


def sync_tasks_to_calendar():
    """Notion の未着手タスク（due あり）をカレンダーに同期する。未同期のものだけ登録。"""
    from agent.notion_handler import get_pending_tasks
    try:
        tasks = get_pending_tasks()
        synced_ids = _load_synced_ids()
        count = 0
        for task in tasks:
            if not task.get("due"):
                continue
            page_id = task.get("page_id", "")
            if page_id in synced_ids:
                continue
            add_calendar_event(task["title"], task["due"])
            if page_id:
                _save_synced_id(page_id)
            count += 1
        logger.info("Calendar sync done: %d event(s) added.", count)
    except Exception:
        logger.exception("Error in sync_tasks_to_calendar")


def add_calendar_event(title: str, due: str) -> None:
    """カレンダーにイベントを登録する。
    due が YYYY-MM-DD なら終日イベント、YYYY-MM-DDTHH:MM なら1時間の時間指定イベント。
    """
    try:
        service = build("calendar", "v3", credentials=get_credentials())
        if "T" in due:
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
