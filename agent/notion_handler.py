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

logger = logging.getLogger(__name__)
_notion = Client(auth=os.getenv("NOTION_TOKEN"))
DB_ID = os.getenv("NOTION_TASKS_DB_ID", "")
_data_source_id: str | None = None

_STATUS_PENDING = "未着手"
_STATUS_IN_PROGRESS_GROUP = ["進行中", "確認中", "一時中断"]
_STATUS_DONE = "完了"
_STATUS_CANCELLED = "中止"


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
    status_obj = props.get("Status", {}).get("status")
    status = status_obj["name"] if status_obj else _STATUS_PENDING
    last_edited = page.get("last_edited_time", "")[:10] if page.get("last_edited_time") else None
    return {
        "title": title_text,
        "due": due,
        "priority": priority,
        "status": status,
        "last_edited": last_edited,
        "url": page.get("url", ""),
        "page_id": page["id"],
    }


def add_task(task: dict, checklist: list[str] | None = None) -> str | None:
    """
    task = {"title": str, "due": "YYYY-MM-DD" or None, "priority": "high"|"medium"|"low", "source": str}
    checklist: ページ本文に to_do ブロックとして追加するアイテムのリスト（省略可）
    作成したページの ID を返す。
    """
    if not DB_ID:
        logger.warning("NOTION_TASKS_DB_ID is not set. Skipping.")
        return None

    properties: dict = {
        "タイトル": {"title": [{"text": {"content": task.get("title", "")}}]},
        "Status": {"status": {"name": _STATUS_PENDING}},
        "Source": {"rich_text": [{"text": {"content": task.get("source", "Gmail")}}]},
    }

    source_url = task.get("source_url")
    if source_url:
        properties["SourceURL"] = {"url": source_url}

    due = task.get("due")
    if due:
        notion_due = due if "T" not in due else due + "+09:00"
        properties["Due"] = {"date": {"start": notion_due}}

    priority = task.get("priority", "medium")
    if priority in ("high", "medium", "low"):
        properties["Priority"] = {"select": {"name": priority}}

    kwargs: dict = {
        "parent": {"database_id": DB_ID},
        "properties": properties,
    }
    if checklist:
        kwargs["children"] = [
            {
                "object": "block",
                "type": "to_do",
                "to_do": {
                    "rich_text": [{"type": "text", "text": {"content": item}}],
                    "checked": False,
                },
            }
            for item in checklist
        ]

    page = _notion.pages.create(**kwargs)
    return page.get("id")



def get_open_tasks() -> list[dict]:
    """Status = 未着手 または 進行中グループ のタスク一覧を返す。"""
    if not DB_ID:
        return []
    status_filters = [{"property": "Status", "status": {"equals": s}}
                      for s in [_STATUS_PENDING] + _STATUS_IN_PROGRESS_GROUP]
    results = _query_db({"or": status_filters})
    return [_parse_task_page(p) for p in results.get("results", [])]


def escalate_priority_tasks() -> list[dict]:
    """期限3日以内の medium タスクを high に昇格し、変更したタスク一覧を返す。"""
    if not DB_ID:
        return []

    today = datetime.date.today()
    deadline = (today + datetime.timedelta(days=3)).isoformat()
    today_str = today.isoformat()

    status_filters = [{"property": "Status", "status": {"equals": s}}
                      for s in [_STATUS_PENDING] + _STATUS_IN_PROGRESS_GROUP]
    results = _query_db({
        "and": [
            {"or": status_filters},
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
        properties={"Status": {"status": {"name": _STATUS_DONE}}},
    )


def cancel_task(page_id: str):
    """指定ページのステータスを中止に更新する。"""
    _notion.pages.update(
        page_id=page_id,
        properties={"Status": {"status": {"name": _STATUS_CANCELLED}}},
    )


def get_task_status(page_id: str) -> str | None:
    """指定ページのステータス名を返す。取得失敗時は None。"""
    try:
        page = _notion.pages.retrieve(page_id=page_id)
        status_obj = page["properties"].get("Status", {}).get("status")
        return status_obj["name"] if status_obj else None
    except Exception:
        return None


def update_task_due(page_id: str, due: str):
    """指定ページの期限を更新する。due は 'YYYY-MM-DD' 形式。"""
    _notion.pages.update(
        page_id=page_id,
        properties={"Due": {"date": {"start": due}}},
    )


def update_task_from_reply(page_id: str, checklist: list[str], priority: str, due: str | None):
    """返信メールによるタスク更新。チェックリスト追記・優先度昇格・期限前倒しを行う。"""
    _priority_order = {"high": 0, "medium": 1, "low": 2}

    # 現在のタスク情報を取得
    page = _notion.pages.retrieve(page_id=page_id)
    props = page["properties"]
    current_priority = (props.get("Priority", {}).get("select") or {}).get("name", "medium")
    current_due_obj = props.get("Due", {}).get("date")
    current_due = current_due_obj["start"][:10] if current_due_obj else None

    updates: dict = {}

    # 優先度は高い方を採用
    if _priority_order.get(priority, 1) < _priority_order.get(current_priority, 1):
        updates["Priority"] = {"select": {"name": priority}}

    # 期限は早い方を採用
    if due:
        due_date = due[:10]
        if current_due is None or due_date < current_due:
            updates["Due"] = {"date": {"start": due_date}}

    if updates:
        _notion.pages.update(page_id=page_id, properties=updates)

    # チェックリスト追記
    if checklist:
        _notion.blocks.children.append(
            block_id=page_id,
            children=[
                {
                    "object": "block",
                    "type": "to_do",
                    "to_do": {
                        "rich_text": [{"type": "text", "text": {"content": item}}],
                        "checked": False,
                    },
                }
                for item in checklist
            ],
        )


