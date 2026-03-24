"""
scripts/run_simplify.py
/simplify を実行し、変更があれば PR を作成して URL を Telegram に送信する。
週次 cron から呼び出される。
"""
import subprocess
import sys
import os
from datetime import date
from pathlib import Path

# プロジェクトルートを sys.path に追加
ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from dotenv import load_dotenv
load_dotenv(ROOT / ".env")

from agent.telegram_notifier import send_message

MAX_CHARS = 4000  # Telegram メッセージ上限 4096 の余裕分


def _run(cmd: list[str], **kwargs) -> subprocess.CompletedProcess:
    return subprocess.run(cmd, capture_output=True, text=True, cwd=str(ROOT), **kwargs)


def main():
    # /simplify 実行
    result = _run(["claude", "-p", "/simplify", "--output-format", "text"])
    if result.returncode != 0:
        stderr = result.stderr.strip()
        send_message(f"⚠️ /simplify 実行エラー (exit {result.returncode})\n\n```\n{stderr[:MAX_CHARS]}\n```")
        return

    # 変更があるか確認
    diff = _run(["git", "diff", "--name-only"])
    changed_files = [f for f in diff.stdout.strip().splitlines() if f]
    if not changed_files:
        send_message("🔧 週次リファクタリング: 変更なし（コードは既にクリーンです）")
        return

    # ブランチ作成・コミット・プッシュ
    branch = f"simplify/{date.today().isoformat()}"
    _run(["git", "checkout", "-b", branch])
    _run(["git", "add"] + changed_files)
    _run(["git", "commit", "-m", f"週次リファクタリング {date.today().isoformat()}"])
    _run(["git", "push", "-u", "origin", branch])

    # PR 作成
    files_list = "\n".join(f"- `{f}`" for f in changed_files)
    output = result.stdout.strip()
    body_summary = output[:1500] + ("\n…（省略）" if len(output) > 1500 else "")
    pr_body = f"## サマリー\n{body_summary}\n\n## 変更ファイル\n{files_list}"

    pr_result = _run([
        "gh", "pr", "create",
        "--title", f"週次リファクタリング {date.today().isoformat()}",
        "--body", pr_body,
        "--base", "master",
        "--head", branch,
    ])

    if pr_result.returncode != 0:
        send_message(f"⚠️ PR 作成に失敗しました\n\n```\n{pr_result.stderr.strip()[:MAX_CHARS]}\n```")
        return

    pr_url = pr_result.stdout.strip()
    files_msg = "\n".join(f"• `{f}`" for f in changed_files)
    send_message(
        f"🔧 *週次リファクタリング PR を作成しました*\n\n"
        f"*変更ファイル*\n{files_msg}\n\n"
        f"*PR*\n{pr_url}"
    )

    # master ブランチに戻す
    _run(["git", "checkout", "master"])


if __name__ == "__main__":
    main()
