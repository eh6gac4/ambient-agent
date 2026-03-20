#!/usr/bin/env python3
"""
scripts/watchdog.py
ambient-agent コンテナの死活監視。
コンテナが停止していたら Telegram に通知する。
連続通知防止のため、一度通知したら復旧まで再通知しない。
"""
import os
import subprocess
import sys

_FLAG_FILE = "/tmp/ambient-agent-down-notified"
_ENV_FILE = os.path.join(os.path.dirname(__file__), "../.env")


def _load_env():
    if not os.path.exists(_ENV_FILE):
        return
    with open(_ENV_FILE) as f:
        for line in f:
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                key, _, val = line.partition("=")
                os.environ.setdefault(key.strip(), val.strip())


def _is_container_running() -> bool:
    result = subprocess.run(
        ["docker", "inspect", "--format", "{{.State.Running}}", "ambient-agent"],
        capture_output=True,
        text=True,
    )
    return result.stdout.strip() == "true"


def _send_telegram(message: str):
    import urllib.request
    import urllib.parse
    token = os.environ.get("TELEGRAM_BOT_TOKEN", "")
    chat_id = os.environ.get("TELEGRAM_CHAT_ID", "")
    if not token or not chat_id:
        print("TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID not set", file=sys.stderr)
        return
    data = urllib.parse.urlencode({"chat_id": chat_id, "text": message, "parse_mode": "Markdown"}).encode()
    req = urllib.request.Request(f"https://api.telegram.org/bot{token}/sendMessage", data=data)
    urllib.request.urlopen(req, timeout=10)


def main():
    _load_env()
    running = _is_container_running()

    if running:
        # 復旧していたらフラグを消す
        if os.path.exists(_FLAG_FILE):
            os.remove(_FLAG_FILE)
    else:
        # 停止中かつ未通知なら通知
        if not os.path.exists(_FLAG_FILE):
            try:
                _send_telegram("🚨 *Ambient Agent が停止しています*")
                open(_FLAG_FILE, "w").close()
                print("Alert sent.")
            except Exception as e:
                print(f"Failed to send alert: {e}", file=sys.stderr)
                sys.exit(1)
        else:
            print("Already notified, skipping.")


if __name__ == "__main__":
    main()
