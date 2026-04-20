"""
agent/gmail_handler.py
未読メールを取得し、Claude でタスクを抽出して Notion に登録する。
"""
import base64
import datetime
import json
import logging
import os
from googleapiclient.discovery import build

from agent.google_auth import get_credentials
from agent.claude_agent import analyze_email
from agent.notion_handler import add_task, update_task_from_reply, get_task_status
from agent.telegram_notifier import send_message


def _escape_md(text: str) -> str:
    """Telegram Markdown の特殊文字（* _ ` [）をエスケープする。"""
    for ch in ("\\", "*", "_", "`", "["):
        text = text.replace(ch, "\\" + ch)
    return text

logger = logging.getLogger(__name__)

_PROCESSED_IDS_FILE = "data/processed_ids.txt"
_GMAIL_QUERY = "is:unread in:inbox -category:promotions"
_MAX_MESSAGES_PER_RUN = 200


def _parse_headers(payload: dict) -> dict[str, str]:
    return {h["name"]: h["value"] for h in payload.get("headers", [])}


_PROCESSED_IDS_RETENTION_DAYS = 30
_THREAD_MAP_FILE = "data/gmail_thread_map.json"
_SENDER_MAP_FILE = "data/task_sender_map.json"
_NO_TASK_SENDERS_FILE = "data/no_task_senders.txt"


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


def _load_sender_map() -> dict:
    """page_id → sender のマッピングを返す。"""
    try:
        with open(_SENDER_MAP_FILE) as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return {}


def _save_sender_map(sender_map: dict):
    with open(_SENDER_MAP_FILE, "w") as f:
        json.dump(sender_map, f, ensure_ascii=False, indent=2)


def get_sender_for_task(page_id: str) -> str | None:
    """page_id に対応する送信者メールアドレスを返す。"""
    return _load_sender_map().get(page_id)


def load_no_task_senders() -> set[str]:
    """タスク不要な送信者のメールアドレス一覧を返す。"""
    try:
        with open(_NO_TASK_SENDERS_FILE) as f:
            return {line.strip() for line in f if line.strip()}
    except FileNotFoundError:
        return set()


def add_no_task_sender(sender_email: str):
    """タスク不要な送信者を追加する。"""
    with open(_NO_TASK_SENDERS_FILE, "a") as f:
        f.write(f"{sender_email}\n")


def remove_no_task_sender(sender_email: str) -> bool:
    """ブロック済み送信者を解除する。解除できた場合 True を返す。"""
    senders = load_no_task_senders()
    if sender_email not in senders:
        return False
    senders.discard(sender_email)
    with open(_NO_TASK_SENDERS_FILE, "w") as f:
        f.writelines(f"{s}\n" for s in sorted(senders))
    return True


def learn_from_cancelled_tasks():
    """sender_map の page_id を Notion で確認し、中止になっていたら送信者をブロックリストに追加する。
    完了・中止・ページ無効（削除済み）のエントリは map から除去してサイズを抑える。"""
    sender_map = _load_sender_map()
    if not sender_map:
        return

    no_task_senders = load_no_task_senders()
    learned = []
    remaining = {}

    for page_id, sender_email in sender_map.items():
        status = get_task_status(page_id)
        if status == "中止":
            if sender_email not in no_task_senders:
                add_no_task_sender(sender_email)
                no_task_senders.add(sender_email)
                learned.append(sender_email)
                logger.info(f"Learned no-task sender from Notion: {sender_email}")
            # 学習済みは sender_map から削除
        elif status in (None, "完了"):
            # ページ削除済み or 完了タスク → スパムではないので学習不要、mapからは除去
            logger.info(f"Removing resolved entry from sender_map: {page_id} ({sender_email}, status={status})")
        else:
            # 未着手など進行中のタスクは残す
            remaining[page_id] = sender_email

    if len(remaining) < len(sender_map):
        _save_sender_map(remaining)

    if learned:
        from agent.telegram_notifier import send_message as _send
        _send("📚 *送信者ブロックを学習しました*\n\n" + "\n".join(f"• `{s}`" for s in learned))


def _extract_email(sender: str) -> str:
    """'Name <email>' 形式から email アドレスを抽出する。"""
    if "<" in sender and ">" in sender:
        return sender.split("<")[1].rstrip(">").strip().lower()
    return sender.strip().lower()


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
        messages = _list_all_messages(service, _GMAIL_QUERY, _MAX_MESSAGES_PER_RUN)
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
            lines.append(f"• {_escape_md(subject)}（{_escape_md(sender_name)}）")

        body = "\n".join(lines)
        send_message(f"*📧 未読メール {len(messages)}件*\n\n{body}")
        logger.info(f"Notified {len(messages)} unread email(s).")

    except Exception:
        logger.exception("Error in notify_unread_emails")


def _archive_message(service, msg_id: str):
    """メールを受信トレイからアーカイブする。"""
    service.users().messages().modify(
        userId="me", id=msg_id, body={"removeLabelIds": ["INBOX"]}
    ).execute()


def _finalize_message(service, msg_id: str):
    """メールをアーカイブして処理済みとして記録する。"""
    _archive_message(service, msg_id)
    _save_processed_id(msg_id)


_label_id_cache: dict[str, str] = {}


def _get_label_id(service, label_name: str) -> str | None:
    """ラベル名からラベルIDを返す。存在しない場合は作成して返す。"""
    if label_name in _label_id_cache:
        return _label_id_cache[label_name]
    try:
        labels = service.users().labels().list(userId="me").execute().get("labels", [])
        for label in labels:
            if label["name"] == label_name:
                _label_id_cache[label_name] = label["id"]
                return label["id"]
        # 存在しなければ作成
        new_label = service.users().labels().create(
            userId="me", body={"name": label_name}
        ).execute()
        _label_id_cache[label_name] = new_label["id"]
        logger.info(f"Created Gmail label: {label_name}")
        return new_label["id"]
    except Exception:
        logger.exception(f"Failed to get/create Gmail label: {label_name}")
        return None


def _add_label(service, msg_id: str, label_id: str):
    """メールにラベルを付与する。"""
    try:
        service.users().messages().modify(
            userId="me", id=msg_id, body={"addLabelIds": [label_id]}
        ).execute()
    except Exception:
        logger.exception(f"Failed to add label to message {msg_id}")


def _list_all_messages(service, query: str, max_results: int) -> list[dict]:
    """ページネーションで Gmail メッセージを一括取得する。"""
    messages = []
    page_token = None
    while len(messages) < max_results:
        batch = min(100, max_results - len(messages))
        kwargs = {"userId": "me", "q": query, "maxResults": batch}
        if page_token:
            kwargs["pageToken"] = page_token
        results = service.users().messages().list(**kwargs).execute()
        messages.extend(results.get("messages", []))
        page_token = results.get("nextPageToken")
        if not page_token:
            break
    return messages


def process_unread_emails():
    """未読メールを要約・タスク抽出し、タスクがなければアーカイブする。結果を Telegram に通知する。"""
    logger.info("Checking unread emails...")
    try:
        service = build("gmail", "v1", credentials=get_credentials())
        messages = _list_all_messages(service, _GMAIL_QUERY, _MAX_MESSAGES_PER_RUN)
        logger.info(f"Found {len(messages)} unread message(s).")

        processed_ids = _load_processed_ids()
        thread_map = _load_thread_map()
        sender_map = _load_sender_map()
        no_task_senders = load_no_task_senders()
        task_lines = []
        archived_lines = []

        task_label_name = os.getenv("GMAIL_TASK_LABEL", "タスク登録済み")
        task_label_id = _get_label_id(service, task_label_name)

        for msg_meta in messages:
            msg_id = msg_meta["id"]
            if msg_id in processed_ids:
                continue

            msg = service.users().messages().get(
                userId="me", id=msg_id, format="full"
            ).execute()

            if _is_calendar_invite(msg["payload"]):
                subject = _parse_headers(msg["payload"]).get("Subject", msg_id)
                logger.info(f"Skipped (calendar invite): {subject}")
                _finalize_message(service, msg_id)
                continue

            subject, body = _parse_message(msg)
            headers = _parse_headers(msg["payload"])
            sender_email = _extract_email(headers.get("From", ""))
            thread_id = msg.get("threadId", "")

            if sender_email in no_task_senders:
                logger.info(f"Skipped (blocked sender): {subject}")
                _finalize_message(service, msg_id)
                continue

            analysis = analyze_email(subject, body)
            summary = analysis.get("summary", "")
            tasks = analysis.get("tasks", [])

            gmail_url = f"https://mail.google.com/mail/u/0/#all/{thread_id}"
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
                    if task_label_id:
                        _add_label(service, msg_id, task_label_id)
                    logger.info(f"Task updated (reply): {subject} ({len(tasks)} items)")
                    task_lines.append(f"• *{_escape_md(subject)}*（更新）\n  {_escape_md(summary)}\n  → " + "、".join(_escape_md(t) for t in checklist))
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
                    if page_id:
                        if thread_id:
                            thread_map[thread_id] = page_id
                        sender_map[page_id] = sender_email
                        if task_label_id:
                            _add_label(service, msg_id, task_label_id)
                    logger.info(f"Task added: {subject} ({len(tasks)} items)")
                    task_lines.append(f"• *{_escape_md(subject)}*\n  {_escape_md(summary)}\n  → " + "、".join(_escape_md(t) for t in checklist))
            else:
                archived_lines.append(f"• *{_escape_md(subject)}*\n  {_escape_md(summary)}")
                logger.info(f"No tasks: {subject}")

            _finalize_message(service, msg_id)

        _save_thread_map(thread_map)
        _save_sender_map(sender_map)

        if not task_lines and not archived_lines:
            return

        sections = []
        if task_lines:
            sections.append("✅ *タスク登録*\n" + "\n".join(task_lines))
        if archived_lines:
            sections.append("📦 *アーカイブ済み*\n" + "\n".join(archived_lines))
        send_message("*📧 メール処理完了*\n\n" + "\n\n".join(sections))

    except Exception as e:
        logger.exception("Error in process_unread_emails")
        try:
            send_message(f"⚠️ Gmail処理エラー\n\n```\n{type(e).__name__}: {e}\n```")
        except Exception:
            pass


def _parse_message(msg: dict) -> tuple[str, str]:
    """Gmail API レスポンスから件名と本文テキストを取り出す。"""
    headers = _parse_headers(msg["payload"])
    subject = headers.get("Subject", "(no subject)")
    body = _extract_body(msg["payload"])
    return subject, body


def _is_calendar_invite(payload: dict) -> bool:
    """MIME ツリーに text/calendar が含まれる場合 True を返す。"""
    return payload.get("mimeType", "").startswith("text/calendar") or any(
        _is_calendar_invite(part) for part in payload.get("parts", [])
    )


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
