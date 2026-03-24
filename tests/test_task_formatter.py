import pytest
from agent.task_formatter import fmt_due, sort_tasks, format_task_list


class TestFmtDue:
    def test_none(self):
        assert fmt_due(None) == ""

    def test_empty(self):
        assert fmt_due("") == ""

    def test_date(self):
        assert fmt_due("2026-03-21") == "2026年03月21日"

    def test_datetime_truncates_to_date(self):
        assert fmt_due("2026-03-21T14:00") == "2026年03月21日"

    def test_invalid_returns_original(self):
        assert fmt_due("not-a-date") == "not-a-date"


class TestSortTasks:
    def test_sorts_by_priority(self):
        tasks = [
            {"title": "A", "priority": "low"},
            {"title": "B", "priority": "high"},
            {"title": "C", "priority": "medium"},
        ]
        result = sort_tasks(tasks)
        assert [t["title"] for t in result] == ["B", "C", "A"]

    def test_same_priority_sorts_by_due(self):
        tasks = [
            {"title": "A", "priority": "high", "due": "2026-03-25"},
            {"title": "B", "priority": "high", "due": "2026-03-22"},
        ]
        result = sort_tasks(tasks)
        assert [t["title"] for t in result] == ["B", "A"]

    def test_missing_priority_treated_as_medium(self):
        tasks = [
            {"title": "A"},
            {"title": "B", "priority": "high"},
        ]
        result = sort_tasks(tasks)
        assert result[0]["title"] == "B"

    def test_none_due_sorts_last_within_priority(self):
        tasks = [
            {"title": "A", "priority": "high", "due": None},
            {"title": "B", "priority": "high", "due": "2026-03-22"},
        ]
        result = sort_tasks(tasks)
        assert result[0]["title"] == "B"


class TestFormatTaskList:
    def test_empty(self):
        assert format_task_list([]) == ""

    def test_groups_by_status(self):
        tasks = [
            {"title": "H", "priority": "high", "status": "未着手"},
            {"title": "L", "priority": "low", "status": "進行中"},
        ]
        result = format_task_list(tasks)
        assert "📋 未着手" in result
        assert "▶️ 進行中" in result
        assert result.index("未着手") < result.index("進行中")

    def test_bullet_prefix(self):
        tasks = [{"title": "T", "priority": "medium", "status": "未着手"}]
        result = format_task_list(tasks)
        assert "• 🟡 T" in result

    def test_numbered_prefix(self):
        tasks = [{"title": "T", "priority": "medium", "status": "未着手"}]
        result = format_task_list(tasks, numbered=True)
        assert "1. 🟡 T" in result

    def test_due_included(self):
        tasks = [{"title": "T", "priority": "medium", "due": "2026-03-21"}]
        result = format_task_list(tasks)
        assert "2026年03月21日" in result
