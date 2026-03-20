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

logger = logging.getLogger(__name__)

_PROCESSED_IDS_FILE = "data/processed_ids.txt"


def _load_processed_ids() -> set[str]:
    try:
        with open(_PROCESSED_IDS_FILE) as f:
            return set(line.strip() for line in f if line.strip())
    except FileNotFoundError:
        return set()


def _save_processed_id(msg_id: str):
    with open(_PROCESSED_IDS_FILE, "a") as f:
        f.write(msg_id + "\n")


def process_unread_emails():
    """未読メールをスキャンしてタスクを抽出・Notion 登録する。"""
    logger.info("Checking unread emails...")
    try:
        service = build("gmail", "v1", credentials=get_credentials())
        results = service.users().messages().list(
            userId="me",
            q="is:unread -category:promotions -category:social",
            maxResults=20,
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
            tasks = extract_tasks_from_email(subject, body)

            for task in tasks:
                add_task(task)
                logger.info(f"Task added: {task.get('title')}")

            _save_processed_id(msg_id)

    except Exception:
        logger.exception("Error in process_unread_emails")


def _parse_message(msg: dict) -> tuple[str, str]:
    """Gmail API レスポンスから件名と本文テキストを取り出す。"""
    headers = {h["name"]: h["value"] for h in msg["payload"].get("headers", [])}
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
