"""
agent/usage_tracker.py
Claude API のトークン使用量を記録・集計する。
"""
import json
import logging
import os
from datetime import date, timedelta

logger = logging.getLogger(__name__)

_LOG_FILE = "data/usage_log.jsonl"

# claude-sonnet-4 の料金 (USD per 1M tokens)
_PRICE_INPUT_PER_M = 3.0
_PRICE_OUTPUT_PER_M = 15.0


def record_usage(job: str, input_tokens: int, output_tokens: int):
    """API呼び出し1回分のトークン使用量を記録する。"""
    os.makedirs("data", exist_ok=True)
    entry = {
        "date": date.today().isoformat(),
        "job": job,
        "input_tokens": input_tokens,
        "output_tokens": output_tokens,
    }
    try:
        with open(_LOG_FILE, "a", encoding="utf-8") as f:
            f.write(json.dumps(entry) + "\n")
    except Exception:
        logger.exception("Failed to record usage")


def get_daily_summary(target_date: date) -> dict:
    """指定日の使用量合計を返す。"""
    total_input = 0
    total_output = 0
    call_count = 0
    by_job: dict[str, dict] = {}

    try:
        with open(_LOG_FILE, encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                entry = json.loads(line)
                if entry.get("date") != target_date.isoformat():
                    continue
                inp = entry.get("input_tokens", 0)
                out = entry.get("output_tokens", 0)
                job = entry.get("job", "unknown")
                total_input += inp
                total_output += out
                call_count += 1
                if job not in by_job:
                    by_job[job] = {"input_tokens": 0, "output_tokens": 0, "calls": 0}
                by_job[job]["input_tokens"] += inp
                by_job[job]["output_tokens"] += out
                by_job[job]["calls"] += 1
    except FileNotFoundError:
        pass
    except Exception:
        logger.exception("Failed to read usage log")

    cost_usd = (total_input / 1_000_000 * _PRICE_INPUT_PER_M
                + total_output / 1_000_000 * _PRICE_OUTPUT_PER_M)

    return {
        "date": target_date.isoformat(),
        "call_count": call_count,
        "total_input_tokens": total_input,
        "total_output_tokens": total_output,
        "cost_usd": cost_usd,
        "by_job": by_job,
    }


def send_cost_report():
    """前日のコストレポートを Telegram に送信する。"""
    from agent.telegram_notifier import send_message

    yesterday = date.today() - timedelta(days=1)
    summary = get_daily_summary(yesterday)

    if summary["call_count"] == 0:
        send_message(f"*💰 コストレポート {yesterday}*\n\nClaude API の呼び出しはありませんでした。")
        return

    lines = [f"*💰 コストレポート {yesterday}*\n"]
    lines.append(f"合計: ${summary['cost_usd']:.4f} USD")
    lines.append(f"API呼び出し: {summary['call_count']}回")
    lines.append(f"入力トークン: {summary['total_input_tokens']:,}")
    lines.append(f"出力トークン: {summary['total_output_tokens']:,}")

    if summary["by_job"]:
        lines.append("\n*ジョブ別内訳*")
        for job, stats in summary["by_job"].items():
            job_cost = (stats["input_tokens"] / 1_000_000 * _PRICE_INPUT_PER_M
                        + stats["output_tokens"] / 1_000_000 * _PRICE_OUTPUT_PER_M)
            lines.append(f"• `{job}`: {stats['calls']}回 / ${job_cost:.4f}")

    send_message("\n".join(lines))
    logger.info("Cost report sent for %s", yesterday)
