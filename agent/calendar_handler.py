"""
agent/calendar_handler.py
当日のカレンダーイベントを取得し、日次ブリーフィングを Telegram に送信する。
"""
import logging
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, date, timedelta

from googleapiclient.discovery import build

from agent.config import JST
from agent.google_auth import get_credentials
from agent.notion_handler import get_open_tasks, escalate_priority_tasks
from agent.claude_agent import summarize_day
from agent.telegram_notifier import send_message
from agent.task_formatter import format_task_list, fmt_due

logger = logging.getLogger(__name__)


def send_due_soon_notice():
    """当日・翌日期限のタスクを Telegram に通知する。"""
    logger.info("Checking due-soon tasks...")
    try:
        tasks = get_open_tasks()
        today = datetime.now(JST).date()
        tomorrow = today + timedelta(days=1)
        today_str = today.isoformat()
        tomorrow_str = tomorrow.isoformat()

        due_today = [t for t in tasks if t.get("due") and t["due"][:10] == today_str]
        due_tomorrow = [t for t in tasks if t.get("due") and t["due"][:10] == tomorrow_str]

        if not due_today and not due_tomorrow:
            logger.info("No due-soon tasks.")
            return

        sections = []
        if due_today:
            lines = "\n".join(f"• {t['title']}" for t in due_today)
            sections.append(f"*📅 今日期限 ({len(due_today)}件)*\n{lines}")
        if due_tomorrow:
            lines = "\n".join(f"• {t['title']}" for t in due_tomorrow)
            sections.append(f"*📅 明日期限 ({len(due_tomorrow)}件)*\n{lines}")

        send_message("*⏰ 期限間近タスク*\n\n" + "\n\n".join(sections))
        logger.info(f"Due-soon notice sent (today: {len(due_today)}, tomorrow: {len(due_tomorrow)}).")
    except Exception:
        logger.exception("Error in send_due_soon_notice")


_STALE_DAYS = 14


def send_stale_tasks_notice():
    """14日以上更新のないタスクを Telegram に通知する。"""
    logger.info("Checking stale tasks...")
    try:
        tasks = get_open_tasks()
        cutoff = (datetime.now(JST).date() - timedelta(days=_STALE_DAYS)).isoformat()
        stale = [t for t in tasks if t.get("last_edited") and t["last_edited"] <= cutoff]

        if not stale:
            logger.info("No stale tasks.")
            return

        lines = "\n".join(f"• {t['title']}（最終更新: {t['last_edited']}）" for t in stale)
        send_message(f"*🕰 長期未更新タスク ({len(stale)}件)*\n\n{lines}\n\n対応不要なら `/skip` で中止にしてください")
        logger.info(f"Stale tasks notice sent ({len(stale)} tasks).")
    except Exception:
        logger.exception("Error in send_stale_tasks_notice")


def send_task_reminder():
    """未完了タスクを優先度グループ別に Telegram にリマインド送信する。"""
    logger.info("Sending task reminder...")
    try:
        tasks = get_open_tasks()
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
        with ThreadPoolExecutor(max_workers=2) as ex:
            f_events = ex.submit(_get_todays_events)
            f_tasks = ex.submit(get_open_tasks)
        events, tasks = f_events.result(), f_tasks.result()
        today = datetime.now(JST).date().isoformat()
        overdue = [t for t in tasks if t.get("due") and t["due"][:10] < today]
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
