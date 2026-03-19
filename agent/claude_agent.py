"""
agent/claude_agent.py
Claude API を呼び出す薄いラッパー。
"""
import os
import anthropic
from agent.usage_tracker import record_usage

_client = anthropic.Anthropic(api_key=os.getenv("ANTHROPIC_API_KEY"))
MODEL = "claude-sonnet-4-20250514"


def extract_tasks_from_email(subject: str, body: str) -> list[dict]:
    """
    メールからタスクを抽出し、リストで返す。
    返り値例: [{"title": "...", "due": "2024-06-01", "priority": "high"}]
    """
    prompt_path = "prompts/extract_tasks.md"
    with open(prompt_path, encoding="utf-8") as f:
        system_prompt = f.read()

    user_message = f"件名: {subject}\n\n本文:\n{body}"

    response = _client.messages.create(
        model=MODEL,
        max_tokens=1024,
        system=system_prompt,
        messages=[{"role": "user", "content": user_message}],
    )
    record_usage("extract_tasks", response.usage.input_tokens, response.usage.output_tokens)

    import json, re
    text = response.content[0].text
    # JSON ブロックを抽出
    match = re.search(r"\[.*\]", text, re.DOTALL)
    if not match:
        return []
    try:
        return json.loads(match.group())
    except json.JSONDecodeError:
        return []


def summarize_day(calendar_events: list[dict], notion_tasks: list[dict], overdue_tasks: list[dict] | None = None) -> str:
    """
    当日のカレンダーイベントと未完了タスク（期限切れ含む）を要約してブリーフィング文を生成する。
    """
    events_text = "\n".join(
        f"- {e['start']} {e['summary']}" for e in calendar_events
    )
    tasks_text = "\n".join(
        f"- [{t.get('priority','?')}] {t['title']} (期限: {t.get('due','未定')})"
        for t in notion_tasks
    )
    overdue_text = "\n".join(
        f"- [{t.get('priority','?')}] {t['title']} (期限: {t.get('due','')})"
        for t in (overdue_tasks or [])
    )

    prompt = f"""今日の予定とタスクをもとに、簡潔な日次ブリーフィングを日本語で作成してください。

## 今日の予定
{events_text or '（なし）'}

## 未完了タスク
{tasks_text or '（なし）'}

## 期限切れタスク
{overdue_text or '（なし）'}

ブリーフィングは3〜5文程度にまとめてください。期限切れタスクがある場合は必ず言及してください。"""

    response = _client.messages.create(
        model=MODEL,
        max_tokens=512,
        messages=[{"role": "user", "content": prompt}],
    )
    record_usage("summarize_day", response.usage.input_tokens, response.usage.output_tokens)
    return response.content[0].text
