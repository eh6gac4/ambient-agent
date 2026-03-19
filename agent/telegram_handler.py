"""
agent/telegram_handler.py
Telegram Bot のメッセージを取得し、タスクを抽出して Notion に登録する。
"""
import logging
import os
import json
import requests

from agent.claude_agent import extract_tasks_from_email
from agent.notion_handler import add_task
from agent.telegram_notifier import send_message

logger = logging.getLogger(__name__)

TELEGRAM_API_BASE = "https://api.telegram.org/bot{token}"
_OFFSET_FILE = "data/telegram_offset.json"


def _get_token() -> str:
    return os.getenv("TELEGRAM_BOT_TOKEN", "")


def _load_offset() -> int:
    try:
        with open(_OFFSET_FILE) as f:
            return json.load(f).get("offset", 0)
    except (FileNotFoundError, json.JSONDecodeError):
        return 0


def _save_offset(offset: int):
    with open(_OFFSET_FILE, "w") as f:
        json.dump({"offset": offset}, f)


def process_telegram_messages():
    """未読メッセージを取得してタスク抽出・Notion 登録する。"""
    token = _get_token()
    if not token:
        logger.error("TELEGRAM_BOT_TOKEN が未設定です。")
        return

    offset = _load_offset()
    url = f"{TELEGRAM_API_BASE.format(token=token)}/getUpdates"
    resp = requests.get(url, params={"offset": offset, "timeout": 5}, timeout=10)
    resp.raise_for_status()
    updates = resp.json().get("result", [])

    if not updates:
        return

    logger.info(f"Telegram: {len(updates)} update(s) received.")
    for update in updates:
        message = update.get("message", {})
        text = message.get("text", "").strip()
        chat_id = str(message.get("chat", {}).get("id", ""))
        allowed_chat_id = os.getenv("TELEGRAM_CHAT_ID", "")

        # 自分のチャット以外は無視
        if chat_id != allowed_chat_id:
            continue

        # 転送メッセージはその旨を件名に含める
        is_forwarded = "forward_origin" in message or "forward_from" in message or "forward_from_chat" in message
        subject = "転送メッセージ" if is_forwarded else "Telegram メッセージ"

        if text:
            tasks = extract_tasks_from_email(subject, text)
            if tasks:
                for task in tasks:
                    task["source"] = "Telegram"
                    add_task(task)
                    logger.info(f"Task added from Telegram: {task.get('title')}")
                titles = "\n".join(f"• {t['title']}" for t in tasks)
                send_message(f"✅ タスクを登録しました\n\n{titles}")
            else:
                send_message("ℹ️ タスクは見つかりませんでした")
                logger.info("Telegram: no tasks extracted.")

    # 次回から処理済みをスキップ
    last_update_id = updates[-1]["update_id"]
    _save_offset(last_update_id + 1)
