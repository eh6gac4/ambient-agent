"""
agent/telegram_notifier.py
Telegram Bot API でメッセージを送信する。
"""
import logging
import os
import requests

logger = logging.getLogger(__name__)

TELEGRAM_API = "https://api.telegram.org/bot{token}/sendMessage"


_MAX_LENGTH = 4096


def _split_by_lines(text: str, max_len: int) -> list[str]:
    """行単位で max_len を超えないようにテキストを分割する。"""
    chunks: list[str] = []
    current_lines: list[str] = []
    current_len = 0
    for line in text.splitlines(keepends=True):
        if current_len + len(line) > max_len and current_lines:
            chunks.append("".join(current_lines))
            current_lines = []
            current_len = 0
        if len(line) > max_len:
            # 1行が上限を超える場合のみ文字単位で強制分割
            for i in range(0, len(line), max_len):
                chunks.append(line[i:i + max_len])
        else:
            current_lines.append(line)
            current_len += len(line)
    if current_lines:
        chunks.append("".join(current_lines))
    return chunks


def send_message(text: str):
    """TELEGRAM_BOT_TOKEN と TELEGRAM_CHAT_ID を使ってメッセージを送信する。4096文字超の場合は分割送信。"""
    token = os.getenv("TELEGRAM_BOT_TOKEN")
    chat_id = os.getenv("TELEGRAM_CHAT_ID")

    if not token or not chat_id:
        logger.error("TELEGRAM_BOT_TOKEN または TELEGRAM_CHAT_ID が未設定です。")
        return

    url = TELEGRAM_API.format(token=token)
    chunks = _split_by_lines(text, _MAX_LENGTH)
    for chunk in chunks:
        resp = requests.post(
            url,
            json={"chat_id": chat_id, "text": chunk, "parse_mode": "Markdown"},
            timeout=10,
        )
        resp.raise_for_status()
    logger.info("Telegram message sent.")
