"""
agent/task_formatter.py
タスク一覧の表示フォーマット共通ユーティリティ。
"""
import datetime

PRIORITY_ORDER = {"high": 0, "medium": 1, "low": 2}
PRIORITY_LABELS = {"high": "🔴", "medium": "🟡", "low": "🟢"}

STATUS_ORDER = {"未着手": 0, "進行中": 1, "確認中": 2, "一時中断": 3}
STATUS_LABELS = {"未着手": "📋 未着手", "進行中": "▶️ 進行中", "確認中": "🔍 確認中", "一時中断": "⏸ 一時中断"}


def fmt_due(d: str | None) -> str:
    if not d:
        return ""
    try:
        return datetime.date.fromisoformat(d[:10]).strftime("%Y年%m月%d日")
    except (ValueError, TypeError):
        return d


def sort_tasks(tasks: list[dict]) -> list[dict]:
    return sorted(
        tasks,
        key=lambda t: (
            STATUS_ORDER.get(t.get("status", "未着手"), 0),
            PRIORITY_ORDER.get(t.get("priority", "medium"), 1),
            t.get("due") or "9999",
        ),
    )


def format_task_list(tasks: list[dict], numbered: bool = False) -> str:
    """ステータスグループ別にタスクをフォーマットして返す（先頭の改行含む）。"""
    sorted_tasks = sort_tasks(tasks)
    current_status = None
    lines = []
    for i, t in enumerate(sorted_tasks, 1):
        status = t.get("status", "未着手")
        if status != current_status:
            current_status = status
            lines.append(f"\n*{STATUS_LABELS.get(status, status)}*")
        due = f"（{fmt_due(t['due'])}）" if t.get("due") else ""
        priority_icon = PRIORITY_LABELS.get(t.get("priority", "medium"), "")
        prefix = f"{i}. " if numbered else "• "
        lines.append(f"{prefix}{priority_icon} {t['title']}{due}")
    return "\n".join(lines)
