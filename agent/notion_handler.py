"""
agent/notion_handler.py
Notion DB へのタスク追加・取得。
DB のプロパティ構成（最低限）:
  - タイトル (title)
  - Due (date)
  - Priority (select: high / medium / low)
  - Status (status: 未着手 / 完了)
  - Source (rich_text) … "Gmail" などの抽出元
"""
import datetime
import logging
import os
from notion_client import Client
from agent.google_calendar import add_calendar_event

logger = logging.getLogger(__name__)
_notion = Client(auth=os.getenv("NOTION_TOKEN"))
DB_ID = os.getenv("NOTION_TASKS_DB_ID", "")
_data_source_id: str | None = None


def _get_data_source_id() -> str | None:
    """DB_ID に対応する data_source_id をキャッシュして返す。"""
    global _data_source_id
    if _data_source_id:
        return _data_source_id
    if not DB_ID:
        return None
    db = _notion.databases.retrieve(database_id=DB_ID)
    sources = db.get("data_sources", [])
    if sources:
        _data_source_id = sources[0]["id"]
    return _data_source_id


def _query_db(filter_body: dict) -> dict:
    """data_sources.query を使ってDBをフィルタ検索する。"""
    ds_id = _get_data_source_id()
    if ds_id:
        return _notion.data_sources.query(data_source_id=ds_id, filter=filter_body)
    return _notion.request(
        path=f"databases/{DB_ID}/query",
        method="POST",
        body={"filter": filter_body},
    )


def _parse_task_page(page: dict) -> dict:
    """Notion ページオブジェクトからタスク辞書を生成する。"""
    props = page["properties"]
    title = props.get("タイトル", {}).get("title", [])
    title_text = title[0]["text"]["content"] if title else ""
    due_obj = props.get("Due", {}).get("date")
    due = due_obj["start"] if due_obj else None
    priority_obj = props.get("Priority", {}).get("select")
    priority = priority_obj["name"] if priority_obj else "medium"
    return {
        "title": title_text,
        "due": due,
        "priority": priority,
        "url": page.get("url", ""),
        "page_id": page["id"],
    }


def add_task(task: dict):
    """
    task = {"title": str, "due": "YYYY-MM-DD" or None, "priority": "high"|"medium"|"low", "source": str}
    """
    if not DB_ID:
        logger.warning("NOTION_TASKS_DB_ID is not set. Skipping.")
        return

    properties: dict = {
        "タイトル": {"title": [{"text": {"content": task.get("title", "")}}]},
        "Status": {"status": {"name": "未着手"}},
        "Source": {"rich_text": [{"text": {"content": task.get("source", "Gmail")}}]},
    }

    source_url = task.get("source_url")
    if source_url:
        properties["SourceURL"] = {"url": source_url}

    due = task.get("due")
    if due:
        properties["Due"] = {"date": {"start": due}}
        add_calendar_event(task.get("title", ""), due)

    priority = task.get("priority", "medium")
    if priority in ("high", "medium", "low"):
        properties["Priority"] = {"select": {"name": priority}}

    _notion.pages.create(
        parent={"database_id": DB_ID},
        properties=properties,
    )


def get_overdue_tasks() -> list[dict]:
    """期限切れ（Due < 今日）かつ未着手のタスク一覧を返す。"""
    if not DB_ID:
        return []
    today = datetime.date.today().isoformat()
    results = _query_db({
        "and": [
            {"property": "Status", "status": {"equals": "未着手"}},
            {"property": "Due", "date": {"before": today}},
        ]
    })
    return [_parse_task_page(p) for p in results.get("results", [])]


def get_pending_tasks() -> list[dict]:
    """Status = 未着手 のタスク一覧を返す。"""
    if not DB_ID:
        return []
    results = _query_db({"property": "Status", "status": {"equals": "未着手"}})
    return [_parse_task_page(p) for p in results.get("results", [])]


def escalate_priority_tasks() -> list[dict]:
    """期限3日以内の medium タスクを high に昇格し、変更したタスク一覧を返す。"""
    if not DB_ID:
        return []

    today = datetime.date.today()
    deadline = (today + datetime.timedelta(days=3)).isoformat()
    today_str = today.isoformat()

    results = _query_db({
        "and": [
            {"property": "Status", "status": {"equals": "未着手"}},
            {"property": "Priority", "select": {"equals": "medium"}},
            {"property": "Due", "date": {"on_or_before": deadline}},
            {"property": "Due", "date": {"on_or_after": today_str}},
        ]
    })

    escalated = []
    for page in results.get("results", []):
        task = _parse_task_page(page)
        _notion.pages.update(
            page_id=page["id"],
            properties={"Priority": {"select": {"name": "high"}}},
        )
        escalated.append(task)
    return escalated


def complete_task(page_id: str):
    """指定ページのステータスを完了に更新する。"""
    _notion.pages.update(
        page_id=page_id,
        properties={"Status": {"status": {"name": "完了"}}},
    )
