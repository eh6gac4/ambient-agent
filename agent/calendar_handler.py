"""
agent/calendar_handler.py
当日のカレンダーイベントを取得し、日次ブリーフィングを Telegram に送信する。
"""
import logging
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime

from googleapiclient.discovery import build

from agent.config import JST
from agent.google_auth import get_credentials
from agent.notion_handler import get_pending_tasks, get_overdue_tasks, escalate_priority_tasks
from agent.claude_agent import summarize_day
from agent.telegram_notifier import send_message
from agent.task_formatter import format_task_list, fmt_due

logger = logging.getLogger(__name__)


def send_task_reminder():
    """未完了タスクを優先度グループ別に Telegram にリマインド送信する。"""
    logger.info("Sending task reminder...")
    try:
        tasks = get_pending_tasks()
        if not tasks:
            logger.info("No pending tasks.")
            return
        body = format_task_list(tasks)
        send_message(f"*📋 未完了タスク ({len(tasks)}件)*{body}")
        logger.info(f"Task reminder sent ({len(tasks)} tasks).")
    except Exception:
        logger.exception("Error in send_task_reminder")


def send_escalation_notice():
    """期限3日以内の medium タスクを high に昇格し、変更があれば Telegram に通知する。"""
    logger.info("Checking priority escalations...")
    try:
        escalated = escalate_priority_tasks()
        if not escalated:
            logger.info("No tasks escalated.")
            return
        lines = [f"• {t['title']}（期限: {fmt_due(t['due'])}）" for t in escalated]
        send_message(f"*⬆️ 優先度を high に昇格しました ({len(escalated)}件)*\n\n" + "\n".join(lines))
        logger.info(f"Escalated {len(escalated)} tasks.")
    except Exception:
        logger.exception("Error in send_escalation_notice")


def send_daily_briefing():
    """当日の予定 + Notion タスク（期限切れ含む）を要約して Telegram に送信する。"""
    logger.info("Generating daily briefing...")
    try:
        with ThreadPoolExecutor(max_workers=3) as ex:
            f_events = ex.submit(_get_todays_events)
            f_tasks = ex.submit(get_pending_tasks)
            f_overdue = ex.submit(get_overdue_tasks)
        events, tasks, overdue = f_events.result(), f_tasks.result(), f_overdue.result()
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

    return [
        {"summary": e.get("summary", ""), "start": e["start"].get("dateTime", e["start"].get("date", ""))}
        for e in result.get("items", [])
    ]
