"""
agent/calendar_handler.py
当日のカレンダーイベントを取得し、日次ブリーフィングを Telegram に送信する。
"""
import logging
from datetime import datetime, timezone, timedelta

from googleapiclient.discovery import build

from agent.google_auth import get_credentials
from agent.notion_handler import get_pending_tasks, get_overdue_tasks
from agent.claude_agent import summarize_day
from agent.telegram_notifier import send_message

logger = logging.getLogger(__name__)
JST = timezone(timedelta(hours=9))


def send_task_reminder():
    """未完了タスクを Telegram にリマインド送信する。"""
    logger.info("Sending task reminder...")
    try:
        tasks = get_pending_tasks()
        if not tasks:
            logger.info("No pending tasks.")
            return
        lines = []
        for t in tasks:
            due = f" (期限: {t['due']})" if t.get("due") else ""
            url = t.get("url", "")
            link = f" [開く]({url})" if url else ""
            lines.append(f"• [{t.get('priority', '?')}] {t['title']}{due}{link}")
        body = "\n".join(lines)
        send_message(f"*📋 未完了タスク ({len(tasks)}件)*\n\n{body}")
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


