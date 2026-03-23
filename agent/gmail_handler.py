"""
agent/gmail_handler.py
未読メールを取得し、Claude でタスクを抽出して Notion に登録する。
"""
import base64
import datetime
import json
import logging
from googleapiclient.discovery import build

from agent.google_auth import get_credentials
from agent.claude_agent import analyze_email
from agent.notion_handler import add_task, update_task_from_reply
from agent.telegram_notifier import send_message

logger = logging.getLogger(__name__)

_PROCESSED_IDS_FILE = "data/processed_ids.txt"
_GMAIL_QUERY = "is:unread in:inbox -category:promotions -category:social"


def _parse_headers(payload: dict) -> dict[str, str]:
    return {h["name"]: h["value"] for h in payload.get("headers", [])}


_PROCESSED_IDS_RETENTION_DAYS = 30
_THREAD_MAP_FILE = "data/gmail_thread_map.json"


def _load_thread_map() -> dict:
    """threadId → Notion page_id のマッピングを返す。"""
    try:
        with open(_THREAD_MAP_FILE) as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return {}


def _save_thread_map(thread_map: dict):
    with open(_THREAD_MAP_FILE, "w") as f:
        json.dump(thread_map, f, ensure_ascii=False, indent=2)


def _load_processed_ids() -> set[str]:
    """処理済み ID を返す。30日以上古いエントリは除去してファイルを更新する。
    フォーマット: 'YYYY-MM-DD msg_id'（旧形式の行は無視）
    """
    cutoff = (datetime.date.today() - datetime.timedelta(days=_PROCESSED_IDS_RETENTION_DAYS)).isoformat()
    valid_lines: list[str] = []
    ids: set[str] = set()
    total = 0
    try:
        with open(_PROCESSED_IDS_FILE) as f:
            for line in f:
                parts = line.strip().split(" ", 1)
                if len(parts) != 2:
                    continue  # 旧形式はスキップ
                total += 1
                date_str, msg_id = parts
                if date_str >= cutoff:
                    valid_lines.append(line.rstrip())
                    ids.add(msg_id)
    except FileNotFoundError:
        return set()

    # 古いエントリがあればファイルを書き直す
    if len(valid_lines) < total:
        with open(_PROCESSED_IDS_FILE, "w") as f:
            f.write("\n".join(valid_lines) + ("\n" if valid_lines else ""))
        logger.info("processed_ids trimmed: %d → %d entries", total, len(valid_lines))

    return ids


def _save_processed_id(msg_id: str):
    today = datetime.date.today().isoformat()
    with open(_PROCESSED_IDS_FILE, "a") as f:
        f.write(f"{today} {msg_id}\n")


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


def _archive_message(service, msg_id: str):
    """メールを受信トレイから削除（アーカイブ）する。"""
    service.users().messages().modify(
        userId="me", id=msg_id, body={"removeLabelIds": ["INBOX"]}
    ).execute()


def process_unread_emails():
    """未読メールを要約・タスク抽出し、タスクがなければアーカイブする。結果を Telegram に通知する。"""
    logger.info("Checking unread emails...")
    try:
        service = build("gmail", "v1", credentials=get_credentials())
        results = service.users().messages().list(
            userId="me", q=_GMAIL_QUERY, maxResults=20,
        ).execute()

        messages = results.get("messages", [])
        logger.info(f"Found {len(messages)} unread message(s).")

        processed_ids = _load_processed_ids()
        thread_map = _load_thread_map()
        task_lines = []
        archived_lines = []

        for msg_meta in messages:
            msg_id = msg_meta["id"]
            if msg_id in processed_ids:
                continue

            msg = service.users().messages().get(
                userId="me", id=msg_id, format="full"
            ).execute()

            subject, body = _parse_message(msg)
            analysis = analyze_email(subject, body)
            summary = analysis.get("summary", "")
            tasks = analysis.get("tasks", [])
            thread_id = msg.get("threadId", "")

            gmail_url = f"https://mail.google.com/mail/u/0/#all/{msg_id}"
            if tasks:
                _priority_order = {"high": 0, "medium": 1, "low": 2}
                best = min(tasks, key=lambda t: _priority_order.get(t.get("priority", "medium"), 1))
                dues = sorted(t["due"] for t in tasks if t.get("due"))
                checklist = [t["title"] for t in tasks]
                existing_page_id = thread_map.get(thread_id)

                if existing_page_id:
                    # 返信メール → 既存タスクを更新
                    update_task_from_reply(
                        existing_page_id,
                        checklist=checklist,
                        priority=best.get("priority", "medium"),
                        due=dues[0] if dues else None,
                    )
                    logger.info(f"Task updated (reply): {subject} ({len(tasks)} items)")
                    task_lines.append(f"• *{subject}*（更新）\n  {summary}\n  → " + "、".join(checklist))
                else:
                    # 新規メール → タスク作成
                    page_task = {
                        "title": subject,
                        "due": dues[0] if dues else None,
                        "priority": best.get("priority", "medium"),
                        "source": "Gmail",
                        "source_url": gmail_url,
                    }
                    page_id = add_task(page_task, checklist=checklist)
                    if page_id and thread_id:
                        thread_map[thread_id] = page_id
                    logger.info(f"Task added: {subject} ({len(tasks)} items)")
                    task_lines.append(f"• *{subject}*\n  {summary}\n  → " + "、".join(checklist))
            else:
                archived_lines.append(f"• *{subject}*\n  {summary}")
                logger.info(f"No tasks: {subject}")

            _archive_message(service, msg_id)
            _save_processed_id(msg_id)

        _save_thread_map(thread_map)

        if not task_lines and not archived_lines:
            return

        sections = []
        if task_lines:
            sections.append("✅ *タスク登録*\n" + "\n".join(task_lines))
        if archived_lines:
            sections.append("📦 *アーカイブ済み*\n" + "\n".join(archived_lines))
        send_message("*📧 メール処理完了*\n\n" + "\n\n".join(sections))

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
