"""
agent/calendar_handler.py
当日のカレンダーイベントを取得し、日次ブリーフィングを Telegram に送信する。
"""
import logging
from datetime import datetime, timezone, timedelta

from googleapiclient.discovery import build

from agent.google_auth import get_credentials
from agent.notion_handler import get_pending_tasks, get_overdue_tasks, escalate_priority_tasks
from agent.claude_agent import summarize_day
from agent.telegram_notifier import send_message

logger = logging.getLogger(__name__)
JST = timezone(timedelta(hours=9))


def send_task_reminder():
    """未完了タスクを優先度グループ別に Telegram にリマインド送信する。"""
    import datetime
    logger.info("Sending task reminder...")
    try:
        tasks = get_pending_tasks()
        if not tasks:
            logger.info("No pending tasks.")
            return

        def fmt_due(d):
            try:
                return datetime.date.fromisoformat(d[:10]).strftime("%Y年%m月%d日")
            except (ValueError, TypeError):
                return d

        priority_order = {"high": 0, "medium": 1, "low": 2}
        priority_labels = {"high": "🔴 High", "medium": "🟡 Medium", "low": "🟢 Low"}
        sorted_tasks = sorted(tasks, key=lambda t: (priority_order.get(t.get("priority", "medium"), 1), t.get("due") or ""))

        current_group = None
        lines = []
        for t in sorted_tasks:
            grp = t.get("priority", "medium")
            if grp != current_group:
                current_group = grp
                lines.append(f"\n*{priority_labels.get(grp, grp)}*")
            due = f"（{fmt_due(t['due'])}）" if t.get("due") else ""
            lines.append(f"• {t['title']}{due}")

        send_message(f"*📋 未完了タスク ({len(tasks)}件)*" + "\n".join(lines))
        logger.info(f"Task reminder sent ({len(tasks)} tasks).")
    except Exception:
        logger.exception("Error in send_task_reminder")


def send_overdue_alert():
    """期限切れタスクを Telegram にアラート送信する。"""
    logger.info("Checking overdue tasks...")
    try:
        tasks = get_overdue_tasks()
        if not tasks:
            logger.info("No overdue tasks.")
            return
        lines = []
        for t in tasks:
            url = t.get("url", "")
            link = f" [開く]({url})" if url else ""
            lines.append(f"• [{t.get('priority', '?')}] {t['title']} (期限: {t['due']}){link}")
        body = "\n".join(lines)
        send_message(f"*⚠️ 期限切れタスク ({len(tasks)}件)*\n\n{body}")
        logger.info(f"Overdue alert sent ({len(tasks)} tasks).")
    except Exception:
        logger.exception("Error in send_overdue_alert")


def send_escalation_notice():
    """期限3日以内の medium タスクを high に昇格し、変更があれば Telegram に通知する。"""
    logger.info("Checking priority escalations...")
    try:
        escalated = escalate_priority_tasks()
        if not escalated:
            logger.info("No tasks escalated.")
            return
        lines = [f"• {t['title']}（期限: {t['due']}）" for t in escalated]
        send_message(f"*⬆️ 優先度を high に昇格しました ({len(escalated)}件)*\n\n" + "\n".join(lines))
        logger.info(f"Escalated {len(escalated)} tasks.")
    except Exception:
        logger.exception("Error in send_escalation_notice")


def send_daily_briefing():
    """当日の予定 + Notion タスク（期限切れ含む）を要約して Telegram に送信する。"""
    logger.info("Generating daily briefing...")
    try:
        events = _get_todays_events()
        tasks = get_pending_tasks()
        overdue = get_overdue_tasks()
        summary = summarize_day(events, tasks, overdue)
        date_str = datetime.now(JST).strftime('%Y-%m-%d')
        send_message(f"*📅 日次ブリーフィング {date_str}*\n\n{summary}")
        logger.info("Daily briefing sent.")
    except Exception:
        logger.exception("Error in send_daily_briefing")


def _get_todays_events() -> list[dict]:
    """今日 00:00〜23:59 のカレンダーイベントを返す。"""
    service = build("calendar", "v3", credentials=get_credentials())
    now = datetime.now(JST)
    time_min = now.replace(hour=0, minute=0, second=0, microsecond=0).isoformat()
    time_max = now.replace(hour=23, minute=59, second=59, microsecond=0).isoformat()

    result = service.events().list(
        calendarId="primary",
        timeMin=time_min,
        timeMax=time_max,
        singleEvents=True,
        orderBy="startTime",
    ).execute()

    events = []
    for e in result.get("items", []):
        start = e["start"].get("dateTime", e["start"].get("date", ""))
        events.append({"summary": e.get("summary", ""), "start": start})
    return events


