"""
agent/claude_agent.py
Claude API を呼び出す薄いラッパー。
"""
import base64
import json
import os
import re
import anthropic
from agent.usage_tracker import record_usage

_client = anthropic.Anthropic(api_key=os.getenv("ANTHROPIC_API_KEY"))
MODEL = "claude-haiku-4-5-20251001"
_EXTRACT_TASKS_PROMPT: str | None = None
_ANALYZE_EMAIL_PROMPT: str | None = None


def _load_extract_tasks_prompt() -> str:
    global _EXTRACT_TASKS_PROMPT
    if _EXTRACT_TASKS_PROMPT is None:
        with open("prompts/extract_tasks.md", encoding="utf-8") as f:
            _EXTRACT_TASKS_PROMPT = f.read()
    return _EXTRACT_TASKS_PROMPT


def _load_analyze_email_prompt() -> str:
    global _ANALYZE_EMAIL_PROMPT
    if _ANALYZE_EMAIL_PROMPT is None:
        with open("prompts/analyze_email.md", encoding="utf-8") as f:
            _ANALYZE_EMAIL_PROMPT = f.read()
    return _ANALYZE_EMAIL_PROMPT


def _extract_json_list(text: str) -> list[dict]:
    """レスポンステキストから JSON 配列を抽出して返す。"""
    match = re.search(r"\[.*\]", text, re.DOTALL)
    if not match:
        return []
    try:
        return json.loads(match.group())
    except json.JSONDecodeError:
        return []


def _extract_tasks(label: str, user_content: str) -> list[dict]:
    response = _client.messages.create(
        model=MODEL,
        max_tokens=1024,
        system=_load_extract_tasks_prompt(),
        messages=[{"role": "user", "content": user_content}],
    )
    record_usage(label, response.usage.input_tokens, response.usage.output_tokens)
    return _extract_json_list(response.content[0].text)


def extract_tasks_from_email(subject: str, body: str) -> list[dict]:
    return _extract_tasks("extract_tasks", f"件名: {subject}\n\n本文:\n{body}")


def analyze_email(subject: str, body: str) -> dict:
    """メールを要約してタスクを抽出する。{"summary": str, "tasks": list} を返す。"""
    response = _client.messages.create(
        model=MODEL,
        max_tokens=1024,
        system=_load_analyze_email_prompt(),
        messages=[{"role": "user", "content": f"件名: {subject}\n\n本文:\n{body[:3000]}"}],
    )
    record_usage("analyze_email", response.usage.input_tokens, response.usage.output_tokens)
    text = response.content[0].text
    match = re.search(r"\{.*\}", text, re.DOTALL)
    if not match:
        return {"summary": text.strip(), "tasks": []}
    try:
        result = json.loads(match.group())
        result.setdefault("tasks", [])
        result.setdefault("summary", "")
        return result
    except json.JSONDecodeError:
        return {"summary": text.strip(), "tasks": []}


def extract_tasks_from_url_content(url: str, content: str) -> list[dict]:
    return _extract_tasks("extract_tasks_url", f"件名: {url}\n\n本文:\n{content[:3000]}")


def extract_tasks_from_image(image_data: bytes, media_type: str = "image/jpeg") -> list[dict]:
    """画像からタスクを抽出する。"""
    b64 = base64.standard_b64encode(image_data).decode()
    response = _client.messages.create(
        model=MODEL,
        max_tokens=1024,
        system=_load_extract_tasks_prompt(),
        messages=[{
            "role": "user",
            "content": [
                {
                    "type": "image",
                    "source": {"type": "base64", "media_type": media_type, "data": b64},
                },
                {
                    "type": "text",
                    "text": "この画像からアクションが必要なタスクを抽出してください。",
                },
            ],
        }],
    )
    record_usage("extract_tasks_image", response.usage.input_tokens, response.usage.output_tokens)
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
