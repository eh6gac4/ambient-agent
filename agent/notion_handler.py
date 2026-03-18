"""
agent/notion_handler.py
Notion DB へのタスク追加・取得。
DB のプロパティ構成（最低限）:
  - Name (title)
  - Due (date)
  - Priority (select: high / medium / low)
  - Status (select: pending / done)
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
        "Name": {"title": [{"text": {"content": task.get("title", "")}}]},
        "Status": {"select": {"name": "pending"}},
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


def get_pending_tasks() -> list[dict]:
    """Status = pending のタスク一覧を返す。"""
    if not DB_ID:
        return []

    results = _notion.databases.query(
        database_id=DB_ID,
        filter={"property": "Status", "select": {"equals": "pending"}},
    )
    tasks = []
    for page in results.get("results", []):
        props = page["properties"]
        title = props.get("Name", {}).get("title", [])
        title_text = title[0]["text"]["content"] if title else ""
        due_obj = props.get("Due", {}).get("date")
        due = due_obj["start"] if due_obj else None
        priority_obj = props.get("Priority", {}).get("select")
        priority = priority_obj["name"] if priority_obj else "medium"
        tasks.append({"title": title_text, "due": due, "priority": priority})
    return tasks
