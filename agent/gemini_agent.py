"""
agent/gemini_agent.py
Gemini API を呼び出す薄いラッパー。
"""
import base64
import json
import os
import re
from google import genai
from google.genai import types
from agent.usage_tracker import record_usage

_client = genai.Client(api_key=os.getenv("GEMINI_API_KEY", "dummy_key_for_test"))
MODEL = "gemini-3.5-flash"
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
    response = _client.models.generate_content(
        model=MODEL,
        contents=user_content,
        config=types.GenerateContentConfig(
            system_instruction=_load_extract_tasks_prompt(),
            max_output_tokens=1024,
        )
    )
    usage = response.usage_metadata
    record_usage(label, usage.prompt_token_count, usage.candidates_token_count)
    return _extract_json_list(response.text)


def extract_tasks_from_email(subject: str, body: str) -> list[dict]:
    return _extract_tasks("extract_tasks", f"件名: {subject}\n\n本文:\n{body}")


def analyze_email(subject: str, body: str) -> dict:
    """メールを要約してタスクを抽出する。{"summary": str, "tasks": list} を返す。"""
    response = _client.models.generate_content(
        model=MODEL,
        contents=f"件名: {subject}\n\n本文:\n{body[:3000]}",
        config=types.GenerateContentConfig(
            system_instruction=_load_analyze_email_prompt(),
            max_output_tokens=1024,
        )
    )
    usage = response.usage_metadata
    record_usage("analyze_email", usage.prompt_token_count, usage.candidates_token_count)
    text = response.text
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
    response = _client.models.generate_content(
        model=MODEL,
        contents=[
            types.Part.from_bytes(data=image_data, mime_type=media_type),
            "この画像からアクションが必要なタスクを抽出してください。"
        ],
        config=types.GenerateContentConfig(
            system_instruction=_load_extract_tasks_prompt(),
            max_output_tokens=1024,
        )
    )
    usage = response.usage_metadata
    record_usage("extract_tasks_image", usage.prompt_token_count, usage.candidates_token_count)
    return _extract_json_list(response.text)


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

    response = _client.models.generate_content(
        model=MODEL,
        contents=prompt,
        config=types.GenerateContentConfig(
            max_output_tokens=512,
        )
    )
    usage = response.usage_metadata
    record_usage("summarize_day", usage.prompt_token_count, usage.candidates_token_count)
    return response.text
