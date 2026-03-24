"""
agent/google_calendar.py
Google Calendar への書き込み操作。
"""
import json
import logging
from datetime import date, datetime, timedelta
from googleapiclient.discovery import build

from agent.config import JST
from agent.google_auth import get_credentials
from agent.notion_handler import get_open_tasks

logger = logging.getLogger(__name__)
_SYNC_STORE = "data/calendar_sync.json"


def _load_store() -> dict:
    """{"page_id": {"event_id": str, "calendar_date": "YYYY-MM-DD"}}"""
    try:
        with open(_SYNC_STORE) as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return {}


def _save_store(store: dict):
    with open(_SYNC_STORE, "w") as f:
        json.dump(store, f, ensure_ascii=False, indent=2)


def sync_calendar():
    """完了済みタスクのイベントを削除し、未着手タスクをカレンダーに同期する。
    カレンダーサービスと store のロードを1回に集約。
    """
    try:
        service = build("calendar", "v3", credentials=get_credentials())
    except Exception:
        logger.exception("Failed to build calendar service")
        return

    store = _load_store()
    today = date.today().isoformat()
    tasks = get_open_tasks()
    pending_ids = {task["page_id"] for task in tasks}

    # Step 1: store にあるが未着手でない（完了/削除済み）→ カレンダーイベントを削除
    removed = 0
    for page_id in list(store.keys()):
        if page_id in pending_ids:
            continue
        event_id = store[page_id].get("event_id")
        if event_id:
            try:
                service.events().delete(calendarId="primary", eventId=event_id).execute()
                logger.info("Deleted calendar event %s for completed task %s", event_id, page_id)
            except Exception:
                logger.warning("Could not delete event %s", event_id)
        store.pop(page_id)
        removed += 1

    # Step 2: 未着手タスクを同期
    added = deleted = 0
    for task in tasks:
        due = task.get("due")
        if not due:
            continue
        page_id = task.get("page_id", "")
        due_date = due[:10]
        is_overdue = due_date < today
        target_date = today if is_overdue else due_date
        record = store.get(page_id)
        if record and record.get("calendar_date") == target_date:
            continue
        if record and record.get("event_id"):
            try:
                service.events().delete(calendarId="primary", eventId=record["event_id"]).execute()
                deleted += 1
                logger.info("Deleted old calendar event: %s", record["event_id"])
            except Exception:
                logger.warning("Could not delete event %s", record["event_id"])
        event_due = target_date if is_overdue else due
        event_id = _insert_event(service, task["title"], event_due)
        if page_id and event_id:
            store[page_id] = {"event_id": event_id, "calendar_date": target_date}
        added += 1

    _save_store(store)
    logger.info("Calendar sync done: %d removed, %d added, %d rescheduled.", removed, added, deleted)


def delete_calendar_event_for_task(page_id: str) -> bool:
    """タスク完了時に対応するカレンダーイベントを削除し、store から除去する。
    削除できた場合は True、対応イベントがない場合は False を返す。
    """
    store = _load_store()
    record = store.get(page_id)
    if not record or not record.get("event_id"):
        return False
    try:
        service = build("calendar", "v3", credentials=get_credentials())
        service.events().delete(calendarId="primary", eventId=record["event_id"]).execute()
        logger.info("Deleted calendar event for task %s: %s", page_id, record["event_id"])
    except Exception:
        logger.warning("Could not delete calendar event %s", record.get("event_id"))
    store.pop(page_id)
    _save_store(store)
    return True



def add_calendar_event(title: str, due: str) -> None:
    """単発でカレンダーにイベントを登録する（同期管理なし）。"""
    try:
        service = build("calendar", "v3", credentials=get_credentials())
        _insert_event(service, title, due)
    except Exception:
        logger.exception("Failed to add calendar event: %s", title)


def _insert_event(service, title: str, due: str) -> str | None:
    """イベントを挿入してイベント ID を返す。"""
    try:
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
        result = service.events().insert(calendarId="primary", body=body).execute()
        logger.info("Calendar event added: %s on %s", title, due)
        return result.get("id")
    except Exception:
        logger.exception("Failed to insert calendar event: %s", title)
        return None
