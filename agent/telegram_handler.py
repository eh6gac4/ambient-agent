"""
agent/telegram_handler.py
Telegram Bot のメッセージを取得し、タスクを抽出して Notion に登録する。
コマンド: /tasks, /done <番号>, /add <テキスト>
"""
import datetime
import json
from datetime import datetime as dt
import logging
import os
import re
import threading

import requests
from bs4 import BeautifulSoup

from agent.calendar_handler import send_daily_briefing
from agent.claude_agent import extract_tasks_from_email, extract_tasks_from_url_content
from agent.config import JST, OPERATING_START_HOUR, OPERATING_END_HOUR
from agent.google_calendar import delete_calendar_event_for_task
from agent.notion_handler import add_task, get_open_tasks, complete_task, update_task_due
from agent.task_formatter import format_task_list, sort_tasks
from agent.telegram_notifier import send_message

logger = logging.getLogger(__name__)

TELEGRAM_API_BASE = "https://api.telegram.org/bot{token}"
_OFFSET_FILE = "data/telegram_offset.json"
_TASK_CACHE_FILE = "data/task_cache.json"
_URL_PATTERN = re.compile(r"https?://\S+")


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


def _save_task_cache(tasks: list[dict]):
    with open(_TASK_CACHE_FILE, "w") as f:
        json.dump(tasks, f, ensure_ascii=False)


def _load_task_cache() -> list[dict]:
    try:
        with open(_TASK_CACHE_FILE) as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return []


def _handle_command(text: str):
    """コマンドを解析して処理する。"""
    parts = text.strip().split(None, 1)
    command = parts[0].lower()
    arg = parts[1].strip() if len(parts) > 1 else ""

    if command == "/tasks":
        tasks = get_open_tasks()
        if not tasks:
            send_message("✅ 未着手のタスクはありません")
            return
        sorted_tasks = sort_tasks(tasks)
        _save_task_cache(sorted_tasks)
        body = format_task_list(tasks, numbered=True)
        send_message(f"*📋 未着手タスク ({len(sorted_tasks)}件)*{body}\n\n`/done <番号>` で完了にできます")

    elif command == "/done":
        if not arg.isdigit():
            send_message("使い方: `/done 2`（番号は `/tasks` で確認）")
            return
        index = int(arg) - 1
        tasks = _load_task_cache()
        if not tasks:
            send_message("先に `/tasks` でタスク一覧を取得してください")
            return
        if index < 0 or index >= len(tasks):
            send_message(f"番号が範囲外です（1〜{len(tasks)}）")
            return
        task = tasks[index]
        complete_task(task["page_id"])
        delete_calendar_event_for_task(task["page_id"])
        send_message(f"✅ 完了にしました\n\n*{task['title']}*")
        logger.info(f"Task completed: {task['title']}")

    elif command == "/add":
        if not arg:
            send_message("使い方: `/add 〇〇を確認する`")
            return
        add_task({"title": arg, "source": "Telegram", "priority": "medium"})
        send_message(f"✅ タスクを追加しました\n\n*{arg}*")
        logger.info(f"Task added via /add: {arg}")

    elif command == "/help":
        send_message(
            "*使えるコマンド*\n\n"
            "`/tasks` — 未着手タスク一覧\n"
            "`/done <番号>` — タスクを完了にする\n"
            "`/add <タスク名>` — タスクを追加\n"
            "`/due <番号> <日付>` — 期限を変更（例: `/due 3 2026-03-25`）\n"
            "`/briefing` — 今すぐブリーフィングを実行\n\n"
            "URL・テキスト・転送メッセージを送るとタスクを自動抽出します"
        )

    elif command == "/briefing":
        send_message("⏳ ブリーフィングを生成中...")
        send_daily_briefing()

    elif command == "/due":
        parts2 = arg.split(None, 1)
        if len(parts2) != 2 or not parts2[0].isdigit():
            send_message("使い方: `/due 2 2026-03-25`（番号は `/tasks` で確認）")
            return
        index = int(parts2[0]) - 1
        due_str = parts2[1].strip()
        try:
            datetime.date.fromisoformat(due_str)
        except ValueError:
            send_message("日付は `YYYY-MM-DD` 形式で指定してください")
            return
        tasks = _load_task_cache()
        if not tasks:
            send_message("先に `/tasks` でタスク一覧を取得してください")
            return
        if index < 0 or index >= len(tasks):
            send_message(f"番号が範囲外です（1〜{len(tasks)}）")
            return
        task = tasks[index]
        update_task_due(task["page_id"], due_str)
        send_message(f"📅 期限を更新しました\n\n*{task['title']}*\n→ {due_str}")
        logger.info(f"Task due updated: {task['title']} -> {due_str}")

    else:
        send_message("使えるコマンド:\n`/tasks` — タスク一覧\n`/done <番号>` — 完了にする\n`/add <タスク名>` — タスクを追加\n`/due <番号> <日付>` — 期限を変更\n`/briefing` — 今すぐブリーフィング")


def _handle_url(url: str):
    """URL のページ内容を取得し、タスクを抽出して Notion に登録する。"""
    try:
        resp = requests.get(url, timeout=10, headers={"User-Agent": "Mozilla/5.0"})
        resp.raise_for_status()
        soup = BeautifulSoup(resp.text, "html.parser")
        for tag in soup(["script", "style", "nav", "footer", "header"]):
            tag.decompose()
        content = soup.get_text(separator="\n", strip=True)
    except Exception as e:
        send_message(f"⚠️ URL の取得に失敗しました\n`{e}`")
        logger.error("Failed to fetch URL %s: %s", url, e)
        return

    tasks = extract_tasks_from_url_content(url, content)
    if not tasks:
        title_tag = soup.find("title")
        page_title = title_tag.get_text(strip=True) if title_tag else url
        tasks = [{"title": f"{page_title}を確認する", "due": None, "priority": "medium"}]
        logger.info(f"No tasks extracted from URL, falling back to page title: {page_title}")

    for task in tasks:
        task["source"] = "URL"
        task["source_url"] = url
        add_task(task)
        logger.info(f"Task added from URL: {task.get('title')}")
    titles = "\n".join(f"• {t['title']}" for t in tasks)
    send_message(f"✅ タスクを登録しました\n\n{titles}")


def _process_updates(updates: list):
    """受信した update リストを処理する。"""
    allowed_chat_id = os.getenv("TELEGRAM_CHAT_ID", "")
    for update in updates:
        message = update.get("message", {})
        text = message.get("text", "").strip()
        chat_id = str(message.get("chat", {}).get("id", ""))

        if chat_id != allowed_chat_id or not text:
            continue

        if text.startswith("/"):
            _handle_command(text)
            continue

        hour = dt.now(JST).hour
        if not (OPERATING_START_HOUR <= hour < OPERATING_END_HOUR):
            send_message(f"🌙 夜間はタスク抽出を停止中です（{OPERATING_START_HOUR}:00-{OPERATING_END_HOUR}:00 に受け付けます）")
            continue

        url_match = _URL_PATTERN.match(text)
        if url_match:
            _handle_url(url_match.group())
            continue

        is_forwarded = "forward_origin" in message or "forward_from" in message or "forward_from_chat" in message
        subject = "転送メッセージ" if is_forwarded else "Telegram メッセージ"

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


def run_listener():
    """ロングポーリングでメッセージを常時待機し、届いた瞬間に処理する。"""
    token = _get_token()
    if not token:
        logger.error("TELEGRAM_BOT_TOKEN が未設定です。")
        return

    url = f"{TELEGRAM_API_BASE.format(token=token)}/getUpdates"
    offset = _load_offset()
    logger.info("Telegram listener started (long polling).")

    stop_event = threading.Event()

    def loop():
        nonlocal offset
        while not stop_event.is_set():
            try:
                resp = requests.get(url, params={"offset": offset, "timeout": 30}, timeout=35)
                resp.raise_for_status()
                updates = resp.json().get("result", [])
                if updates:
                    logger.info(f"Telegram: {len(updates)} update(s) received.")
                    _process_updates(updates)
                    offset = updates[-1]["update_id"] + 1
                    _save_offset(offset)
            except requests.exceptions.Timeout:
                pass
            except Exception as e:
                logger.error("Telegram listener error: %s", e)
                stop_event.wait(5)

    t = threading.Thread(target=loop, daemon=True, name="telegram-listener")
    t.start()
    return stop_event
