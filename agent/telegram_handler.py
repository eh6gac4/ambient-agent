"""
agent/telegram_handler.py
Telegram Bot のメッセージを取得し、タスクを抽出して Notion に登録する。
コマンド: /tasks, /done <番号>, /add <テキスト>
"""
import logging
import os
import json
import requests

from agent.claude_agent import extract_tasks_from_email
from agent.notion_handler import add_task, get_pending_tasks, complete_task
from agent.telegram_notifier import send_message

logger = logging.getLogger(__name__)

TELEGRAM_API_BASE = "https://api.telegram.org/bot{token}"
_OFFSET_FILE = "data/telegram_offset.json"
_TASK_CACHE_FILE = "data/task_cache.json"


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
        import datetime
        tasks = get_pending_tasks()
        if not tasks:
            send_message("✅ 未着手のタスクはありません")
            return

        def fmt_due(d):
            try:
                dt = datetime.date.fromisoformat(d[:10])
                return dt.strftime("%Y年%m月%d日")
            except (ValueError, TypeError):
                return d

        priority_order = {"high": 0, "medium": 1, "low": 2}
        priority_labels = {"high": "🔴 High", "medium": "🟡 Medium", "low": "🟢 Low"}

        sorted_tasks = sorted(tasks, key=lambda t: (priority_order.get(t.get("priority", "medium"), 1), t.get("due") or ""))
        _save_task_cache(sorted_tasks)

        current_group = None
        lines = []
        for i, t in enumerate(sorted_tasks, 1):
            grp = t.get("priority", "medium")
            if grp != current_group:
                current_group = grp
                lines.append(f"\n*{priority_labels.get(grp, grp)}*")
            due = f"（{fmt_due(t['due'])}）" if t.get("due") else ""
            lines.append(f"{i}. {t['title']}{due}")

        send_message(f"*📋 未着手タスク ({len(sorted_tasks)}件)*" + "\n".join(lines) + "\n\n`/done <番号>` で完了にできます")

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
        send_message(f"✅ 完了にしました\n\n*{task['title']}*")
        logger.info(f"Task completed: {task['title']}")

    elif command == "/add":
        if not arg:
            send_message("使い方: `/add 〇〇を確認する`")
            return
        add_task({"title": arg, "source": "Telegram", "priority": "medium"})
        send_message(f"✅ タスクを追加しました\n\n*{arg}*")
        logger.info(f"Task added via /add: {arg}")

    else:
        send_message("使えるコマンド:\n`/tasks` — タスク一覧\n`/done <番号>` — 完了にする\n`/add <タスク名>` — タスクを追加")


def _process_updates(updates: list):
    """受信した update リストを処理する。"""
    allowed_chat_id = os.getenv("TELEGRAM_CHAT_ID", "")
    for update in updates:
        message = update.get("message", {})
        text = message.get("text", "").strip()
        chat_id = str(message.get("chat", {}).get("id", ""))

        if chat_id != allowed_chat_id:
            continue

        if not text:
            continue

        if text.startswith("/"):
            _handle_command(text)
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
    import threading
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
                resp = requests.get(
                    url,
                    params={"offset": offset, "timeout": 30},
                    timeout=35,
                )
                resp.raise_for_status()
                updates = resp.json().get("result", [])
                if updates:
                    logger.info(f"Telegram: {len(updates)} update(s) received.")
                    _process_updates(updates)
                    offset = updates[-1]["update_id"] + 1
                    _save_offset(offset)
            except requests.exceptions.Timeout:
                pass  # タイムアウトは正常（メッセージなし）
            except Exception as e:
                logger.error("Telegram listener error: %s", e)
                stop_event.wait(5)  # エラー時は5秒待ってリトライ

    t = threading.Thread(target=loop, daemon=True, name="telegram-listener")
    t.start()
    return stop_event
