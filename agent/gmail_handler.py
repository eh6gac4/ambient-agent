"""
agent/gmail_handler.py
未読メールを取得し、Claude でタスクを抽出して Notion に登録する。
"""
import base64
import logging
from googleapiclient.discovery import build

from agent.google_auth import get_credentials
from agent.claude_agent import extract_tasks_from_email
from agent.notion_handler import add_task
from agent.telegram_notifier import send_message

logger = logging.getLogger(__name__)

_PROCESSED_IDS_FILE = "data/processed_ids.txt"
_GMAIL_QUERY = "is:unread in:inbox -category:promotions -category:social"


def _parse_headers(payload: dict) -> dict[str, str]:
    return {h["name"]: h["value"] for h in payload.get("headers", [])}


def _load_processed_ids() -> set[str]:
    try:
        with open(_PROCESSED_IDS_FILE) as f:
            return set(line.strip() for line in f if line.strip())
    except FileNotFoundError:
        return set()


def _save_processed_id(msg_id: str):
    with open(_PROCESSED_IDS_FILE, "a") as f:
        f.write(msg_id + "\n")


def notify_unread_emails():
    """未読メールの件名・送信者を Telegram に通知する（Claude 呼び出しなし）。"""
    logger.info("Notifying unread emails...")
    try:
        service = build("gmail", "v1", credentials=get_credentials())
        results = service.users().messages().list(
            userId="me", q=_GMAIL_QUERY, maxResults=20,
        ).execute()

        messages = results.get("messages", [])
        if not messages:
            logger.info("No unread messages.")
            return

        lines = []
        for msg_meta in messages:
            msg = service.users().messages().get(
                userId="me", id=msg_meta["id"], format="metadata",
                metadataHeaders=["Subject", "From"],
            ).execute()
            headers = _parse_headers(msg["payload"])
            subject = headers.get("Subject", "(件名なし)")
            sender = headers.get("From", "")
            sender_name = sender.split("<")[0].strip().strip('"') or sender
            lines.append(f"• {subject}（{sender_name}）")

        body = "\n".join(lines)
        send_message(f"*📧 未読メール {len(messages)}件*\n\n{body}")
        logger.info(f"Notified {len(messages)} unread email(s).")

    except Exception:
        logger.exception("Error in notify_unread_emails")


def process_unread_emails():
    """未読メールをスキャンしてタスクを抽出・Notion 登録する。"""
    logger.info("Checking unread emails...")
    try:
        service = build("gmail", "v1", credentials=get_credentials())
        results = service.users().messages().list(
            userId="me", q=_GMAIL_QUERY, maxResults=20,
        ).execute()

        messages = results.get("messages", [])
        logger.info(f"Found {len(messages)} unread message(s).")

        processed_ids = _load_processed_ids()

        for msg_meta in messages:
            msg_id = msg_meta["id"]
            if msg_id in processed_ids:
                continue

            msg = service.users().messages().get(
                userId="me", id=msg_id, format="full"
            ).execute()

            subject, body = _parse_message(msg)
            body = body[:3000]
            tasks = extract_tasks_from_email(subject, body)

            gmail_url = f"https://mail.google.com/mail/u/0/#all/{msg_id}"
            for task in tasks:
                task["source_url"] = gmail_url
                add_task(task)
                logger.info(f"Task added: {task.get('title')}")

            _save_processed_id(msg_id)

    except Exception:
        logger.exception("Error in process_unread_emails")


def _parse_message(msg: dict) -> tuple[str, str]:
    """Gmail API レスポンスから件名と本文テキストを取り出す。"""
    headers = _parse_headers(msg["payload"])
    subject = headers.get("Subject", "(no subject)")
    body = _extract_body(msg["payload"])
    return subject, body


def _extract_body(payload: dict) -> str:
    """マルチパートを再帰的に辿って text/plain を返す。"""
    mime = payload.get("mimeType", "")
    if mime == "text/plain":
        data = payload.get("body", {}).get("data", "")
        return base64.urlsafe_b64decode(data + "==").decode("utf-8", errors="replace")
    for part in payload.get("parts", []):
        result = _extract_body(part)
        if result:
            return result
    return ""
