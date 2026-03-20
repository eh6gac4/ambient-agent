"""
agent/claude_agent.py
Claude API を呼び出す薄いラッパー。
"""
import json
import os
import re
import anthropic
from agent.usage_tracker import record_usage

_client = anthropic.Anthropic(api_key=os.getenv("ANTHROPIC_API_KEY"))
MODEL = "claude-haiku-4-5-20251001"
_EXTRACT_TASKS_PROMPT: str | None = None


def _load_extract_tasks_prompt() -> str:
    global _EXTRACT_TASKS_PROMPT
    if _EXTRACT_TASKS_PROMPT is None:
        with open("prompts/extract_tasks.md", encoding="utf-8") as f:
            _EXTRACT_TASKS_PROMPT = f.read()
    return _EXTRACT_TASKS_PROMPT


def _extract_json_list(text: str) -> list[dict]:
    """レスポンステキストから JSON 配列を抽出して返す。"""
    match = re.search(r"\[.*\]", text, re.DOTALL)
    if not match:
        return []
    try:
        return json.loads(match.group())
    except json.JSONDecodeError:
        return []


def extract_tasks_from_email(subject: str, body: str) -> list[dict]:
    """メールからタスクを抽出し、リストで返す。"""
    response = _client.messages.create(
        model=MODEL,
        max_tokens=1024,
        system=_load_extract_tasks_prompt(),
        messages=[{"role": "user", "content": f"件名: {subject}\n\n本文:\n{body}"}],
    )
    record_usage("extract_tasks", response.usage.input_tokens, response.usage.output_tokens)
    return _extract_json_list(response.content[0].text)


def extract_tasks_from_url_content(url: str, content: str) -> list[dict]:
    """URL のページ内容からタスクを抽出し、リストで返す。"""
    response = _client.messages.create(
        model=MODEL,
        max_tokens=1024,
        system=_load_extract_tasks_prompt(),
        messages=[{"role": "user", "content": f"件名: {url}\n\n本文:\n{content[:3000]}"}],
    )
    record_usage("extract_tasks_url", response.usage.input_tokens, response.usage.output_tokens)
    return _extract_json_list(response.content[0].text)


def summarize_day(calendar_events: list[dict], notion_tasks: list[dict], overdue_tasks: list[dict] | None = None) -> str:
    """当日のカレンダーイベントと未完了タスク（期限切れ含む）を要約してブリーフィング文を生成する。"""
    events_text = "\n".join(f"- {e['start']} {e['summary']}" for e in calendar_events)
    tasks_text = "\n".join(
        f"- [{t.get('priority','?')}] {t['title']} (期限: {t.get('due','未定')})" for t in notion_tasks
    )
    overdue_text = "\n".join(
        f"- [{t.get('priority','?')}] {t['title']} (期限: {t.get('due','')})" for t in (overdue_tasks or [])
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
