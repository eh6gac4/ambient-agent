"""
agent/telegram_notifier.py
Telegram Bot API でメッセージを送信する。
"""
import logging
import os
import requests

logger = logging.getLogger(__name__)

TELEGRAM_API = "https://api.telegram.org/bot{token}/sendMessage"


def send_message(text: str):
    """TELEGRAM_BOT_TOKEN と TELEGRAM_CHAT_ID を使ってメッセージを送信する。"""
    token = os.getenv("TELEGRAM_BOT_TOKEN")
    chat_id = os.getenv("TELEGRAM_CHAT_ID")

    if not token or not chat_id:
        logger.error("TELEGRAM_BOT_TOKEN または TELEGRAM_CHAT_ID が未設定です。")
        return

    url = TELEGRAM_API.format(token=token)
    resp = requests.post(
        url,
        json={"chat_id": chat_id, "text": text, "parse_mode": "Markdown"},
        timeout=10,
    )
    resp.raise_for_status()
    logger.info("Telegram message sent.")
