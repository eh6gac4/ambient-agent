"""
agent/notion_handler.py
Notion DB へのタスク追加・取得。
DB のプロパティ構成（最低限）:
  - Name (title)
  - Due (date)
  - Priority (select: high / medium / low)
  - Status (status: 未着手 / ...)
  - Source (rich_text) … "Gmail" などの抽出元
"""
import logging
import os
from notion_client import Client

logger = logging.getLogger(__name__)
_notion = Client(auth=os.getenv("NOTION_TOKEN"))
DB_ID = os.getenv("NOTION_TASKS_DB_ID", "")


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

    due = task.get("due")
    if due:
        properties["Due"] = {"date": {"start": due}}

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

    today = __import__("datetime").date.today().isoformat()
    results = _notion.databases.query(
        database_id=DB_ID,
        filter={
            "and": [
                {"property": "Status", "status": {"equals": "未着手"}},
                {"property": "Due", "date": {"before": today}},
            ]
        },
    )
    tasks = []
    for page in results.get("results", []):
        props = page["properties"]
        title = props.get("タイトル", {}).get("title", [])
        title_text = title[0]["text"]["content"] if title else ""
        due_obj = props.get("Due", {}).get("date")
        due = due_obj["start"] if due_obj else None
        priority_obj = props.get("Priority", {}).get("select")
        priority = priority_obj["name"] if priority_obj else "medium"
        tasks.append({"title": title_text, "due": due, "priority": priority, "url": page.get("url", ""), "page_id": page["id"]})
    return tasks


def get_pending_tasks() -> list[dict]:
    """Status = pending のタスク一覧を返す。"""
    if not DB_ID:
        return []

    results = _notion.databases.query(
        database_id=DB_ID,
        filter={"property": "Status", "status": {"equals": "未着手"}},
    )
    tasks = []
    for page in results.get("results", []):
        props = page["properties"]
        title = props.get("タイトル", {}).get("title", [])
        title_text = title[0]["text"]["content"] if title else ""
        due_obj = props.get("Due", {}).get("date")
        due = due_obj["start"] if due_obj else None
        priority_obj = props.get("Priority", {}).get("select")
        priority = priority_obj["name"] if priority_obj else "medium"
        tasks.append({"title": title_text, "due": due, "priority": priority, "url": page.get("url", ""), "page_id": page["id"]})
    return tasks


def complete_task(page_id: str):
    """指定ページのステータスを完了に更新する。"""
    _notion.pages.update(
        page_id=page_id,
        properties={"Status": {"status": {"name": "完了"}}},
    )
