"""
agent/task_formatter.py
タスク一覧の表示フォーマット共通ユーティリティ。
"""
import datetime

PRIORITY_ORDER = {"high": 0, "medium": 1, "low": 2}
PRIORITY_LABELS = {"high": "🔴 High", "medium": "🟡 Medium", "low": "🟢 Low"}


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
        key=lambda t: (PRIORITY_ORDER.get(t.get("priority", "medium"), 1), t.get("due") or "9999"),
    )


def format_task_list(tasks: list[dict], numbered: bool = False) -> str:
    """優先度グループ別にタスクをフォーマットして返す（先頭の改行含む）。"""
    sorted_tasks = sort_tasks(tasks)
    current_group = None
    lines = []
    for i, t in enumerate(sorted_tasks, 1):
        grp = t.get("priority", "medium")
        if grp != current_group:
            current_group = grp
            lines.append(f"\n*{PRIORITY_LABELS.get(grp, grp)}*")
        due = f"（{fmt_due(t['due'])}）" if t.get("due") else ""
        prefix = f"{i}. " if numbered else "• "
        lines.append(f"{prefix}{t['title']}{due}")
    return "\n".join(lines)
