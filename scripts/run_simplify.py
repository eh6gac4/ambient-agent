"""
scripts/run_simplify.py
/simplify を実行して結果を Telegram に送信する。
週次 cron から呼び出される。
"""
import subprocess
import sys
import os
from pathlib import Path

# プロジェクトルートを sys.path に追加
ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from dotenv import load_dotenv
load_dotenv(ROOT / ".env")

from agent.telegram_notifier import send_message

MAX_CHARS = 4000  # Telegram メッセージ上限 4096 の余裕分


def main():
    result = subprocess.run(
        ["claude", "-p", "/simplify", "--output-format", "text"],
        capture_output=True,
        text=True,
        cwd=str(ROOT),
    )
    output = result.stdout.strip()
    if result.returncode != 0:
        stderr = result.stderr.strip()
        send_message(f"⚠️ /simplify 実行エラー (exit {result.returncode})\n\n```\n{stderr[:MAX_CHARS]}\n```")
        return

    if not output:
        send_message("🔧 週次リファクタリング: 変更なし（コードは既にクリーンです）")
        return

    header = "🔧 *週次リファクタリング結果*\n\n"
    body = output[:MAX_CHARS - len(header)]
    if len(output) > MAX_CHARS - len(header):
        body += "\n…（省略）"
    send_message(header + body)


if __name__ == "__main__":
    main()
