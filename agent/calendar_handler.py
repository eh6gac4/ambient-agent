"""
agent/calendar_handler.py
当日のカレンダーイベントを取得し、日次ブリーフィングをメール送信する。
"""
import base64
import logging
import os
from datetime import datetime, timezone, timedelta
from email.mime.text import MIMEText

from googleapiclient.discovery import build

from agent.google_auth import get_credentials
from agent.notion_handler import get_pending_tasks
from agent.claude_agent import summarize_day

logger = logging.getLogger(__name__)
JST = timezone(timedelta(hours=9))


def send_daily_briefing():
    """当日の予定 + Notion タスクを要約してメール送信する。"""
    logger.info("Generating daily briefing...")
    try:
        events = _get_todays_events()
        tasks = get_pending_tasks()
        summary = summarize_day(events, tasks)
        _send_email(
            subject=f"📅 日次ブリーフィング {datetime.now(JST).strftime('%Y-%m-%d')}",
            body=summary,
        )
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


def _send_email(subject: str, body: str):
    """自分自身にメールを送信する。"""
    service = build("gmail", "v1", credentials=get_credentials())
    to = os.getenv("BRIEFING_EMAIL", "me")
    message = MIMEText(body)
    message["to"] = to
    message["subject"] = subject
    raw = base64.urlsafe_b64encode(message.as_bytes()).decode()
    service.users().messages().send(
        userId="me", body={"raw": raw}
    ).execute()
