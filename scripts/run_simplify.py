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

# cron 実行時の PATH に claude のディレクトリを追加
os.environ["PATH"] = "/home/ctoshiki/.local/bin:" + os.environ.get("PATH", "")

from dotenv import load_dotenv
load_dotenv(ROOT / ".env")

from agent.telegram_notifier import send_message

MAX_CHARS = 4000  # Telegram メッセージ上限 4096 の余裕分
TAIL_CHARS = 1500  # stdout/stderr ごとの抜粋上限

_ERROR_PATTERNS: list[tuple[tuple[str, ...], str]] = [
    (("credit balance", "billing_error"), "💳 Anthropic API クレジット残高不足 (console.anthropic.com でチャージ)"),
    (("rate_limit", "rate limit", "429"), "⏱️ Anthropic API レート制限"),
    (("invalid_api_key", "authentication_error", "401"), "🔐 認証エラー (ANTHROPIC_API_KEY を確認)"),
    (("messages are required for agent hooks",), "🪝 Agent hook バグ (.claude/settings.local.json の hooks を確認)"),
    (("context_length", "context window", "prompt is too long"), "📏 コンテキスト長超過"),
    (("overloaded",), "🚧 Anthropic API 過負荷"),
]


def _run(cmd: list[str], **kwargs) -> subprocess.CompletedProcess:
    return subprocess.run(cmd, capture_output=True, text=True, cwd=str(ROOT), **kwargs)


def _tail(text: str, n: int = TAIL_CHARS) -> str:
    return text if len(text) <= n else "…(省略)…\n" + text[-n:]


def _detect_cause(combined: str) -> str:
    if not combined:
        return ""
    low = combined.lower()
    for keywords, message in _ERROR_PATTERNS:
        if any(k in low for k in keywords):
            return message
    return ""


def _format_error(title: str, returncode: int, stdout: str, stderr: str) -> str:
    out = stdout.strip()
    err = stderr.strip()
    cause = _detect_cause(out + "\n" + err) if (out or err) else ""
    parts = [f"⚠️ *{title}* (exit {returncode})"]
    if cause:
        parts.append(f"原因: {cause}")
    if out:
        parts.append(f"*stdout*\n```\n{_tail(out)}\n```")
    if err:
        parts.append(f"*stderr*\n```\n{_tail(err)}\n```")
    if not out and not err:
        parts.append("_出力なし_")
    return "\n\n".join(parts)[:MAX_CHARS]


def main():
    # /simplify 実行
    result = _run(["/home/ctoshiki/.local/bin/claude", "-p", "/simplify\n\nすべての出力・コメント・説明は日本語で記述してください。", "--output-format", "text"])
    if result.returncode != 0:
        send_message(_format_error("/simplify 実行エラー", result.returncode, result.stdout, result.stderr))
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
        send_message(_format_error("PR 作成失敗", pr_result.returncode, pr_result.stdout, pr_result.stderr))
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
