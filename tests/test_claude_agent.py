import pytest
from agent.claude_agent import _extract_json_list


class TestExtractJsonList:
    def test_plain_json_array(self):
        text = '[{"title": "Task A", "due": null}]'
        result = _extract_json_list(text)
        assert result == [{"title": "Task A", "due": None}]

    def test_json_wrapped_in_markdown(self):
        text = '```json\n[{"title": "Task B"}]\n```'
        result = _extract_json_list(text)
        assert result == [{"title": "Task B"}]

    def test_empty_array(self):
        assert _extract_json_list("[]") == []

    def test_no_array_returns_empty(self):
        assert _extract_json_list("タスクはありません") == []

    def test_invalid_json_returns_empty(self):
        assert _extract_json_list("[{invalid}]") == []

    def test_multiple_fields(self):
        text = '[{"title": "T", "due": "2026-03-21", "priority": "high"}]'
        result = _extract_json_list(text)
        assert result[0]["priority"] == "high"
        assert result[0]["due"] == "2026-03-21"

    def test_multiple_tasks(self):
        text = '[{"title": "A"}, {"title": "B"}]'
        result = _extract_json_list(text)
        assert len(result) == 2
