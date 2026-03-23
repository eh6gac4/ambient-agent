"""
tests/test_telegram_handler.py
_handle_command のユニットテスト
"""
from unittest.mock import MagicMock, call, patch

import pytest

from agent.telegram_handler import _handle_command

MOCK_TASKS = [
    {"title": "タスクA", "page_id": "page-1", "due": "2026-03-25", "priority": "high"},
    {"title": "タスクB", "page_id": "page-2", "due": None, "priority": "medium"},
]


# ── /help ────────────────────────────────────────────────────────────────────

class TestHelpCommand:
    def test_sends_command_list(self, mock_send):
        _handle_command("/help")
        mock_send.assert_called_once()
        msg = mock_send.call_args[0][0]
        assert "/tasks" in msg
        assert "/done" in msg
        assert "/due" in msg
        assert "/briefing" in msg


# ── /briefing ─────────────────────────────────────────────────────────────────

class TestBriefingCommand:
    def test_calls_send_daily_briefing(self, mock_send, mock_briefing):
        _handle_command("/briefing")
        mock_briefing.assert_called_once()
        # 「生成中」メッセージを先に送る
        first_call = mock_send.call_args_list[0][0][0]
        assert "生成中" in first_call

    def test_sends_generating_message_first(self, mock_send, mock_briefing):
        _handle_command("/briefing")
        assert mock_send.call_count >= 1


# ── /due ──────────────────────────────────────────────────────────────────────

class TestDueCommand:
    def test_success(self, mock_send, mock_update_due, mock_load_cache):
        mock_load_cache.return_value = MOCK_TASKS
        _handle_command("/due 1 2026-04-01")
        mock_update_due.assert_called_once_with("page-1", "2026-04-01")
        msg = mock_send.call_args_list[-1][0][0]
        assert "タスクA" in msg
        assert "2026-04-01" in msg

    def test_no_arg_shows_usage(self, mock_send, mock_update_due, mock_load_cache):
        _handle_command("/due")
        mock_update_due.assert_not_called()
        assert "使い方" in mock_send.call_args[0][0]

    def test_invalid_index_format(self, mock_send, mock_update_due, mock_load_cache):
        _handle_command("/due abc 2026-04-01")
        mock_update_due.assert_not_called()
        assert "使い方" in mock_send.call_args[0][0]

    def test_invalid_date_format(self, mock_send, mock_update_due, mock_load_cache):
        mock_load_cache.return_value = MOCK_TASKS
        _handle_command("/due 1 04/01")
        mock_update_due.assert_not_called()
        assert "YYYY-MM-DD" in mock_send.call_args[0][0]

    def test_empty_cache(self, mock_send, mock_update_due, mock_load_cache):
        mock_load_cache.return_value = []
        _handle_command("/due 1 2026-04-01")
        mock_update_due.assert_not_called()
        assert "/tasks" in mock_send.call_args[0][0]

    def test_out_of_range(self, mock_send, mock_update_due, mock_load_cache):
        mock_load_cache.return_value = MOCK_TASKS
        _handle_command("/due 99 2026-04-01")
        mock_update_due.assert_not_called()
        assert "範囲外" in mock_send.call_args[0][0]


# ── 既存コマンドの基本動作確認 ────────────────────────────────────────────────

class TestDoneCommand:
    def test_success(self, mock_send, mock_complete_task, mock_delete_event, mock_load_cache):
        mock_load_cache.return_value = MOCK_TASKS
        _handle_command("/done 2")
        mock_complete_task.assert_called_once_with("page-2")
        mock_delete_event.assert_called_once_with("page-2")
        assert "タスクB" in mock_send.call_args[0][0]

    def test_non_digit_arg(self, mock_send, mock_complete_task, mock_delete_event, mock_load_cache):
        _handle_command("/done abc")
        mock_complete_task.assert_not_called()
        assert "使い方" in mock_send.call_args[0][0]

    def test_empty_cache(self, mock_send, mock_complete_task, mock_delete_event, mock_load_cache):
        mock_load_cache.return_value = []
        _handle_command("/done 1")
        mock_complete_task.assert_not_called()

    def test_out_of_range(self, mock_send, mock_complete_task, mock_delete_event, mock_load_cache):
        mock_load_cache.return_value = MOCK_TASKS
        _handle_command("/done 99")
        mock_complete_task.assert_not_called()


class TestAddCommand:
    def test_success(self, mock_send, mock_add_task):
        _handle_command("/add 報告書を書く")
        mock_add_task.assert_called_once()
        assert "報告書を書く" in mock_send.call_args[0][0]

    def test_no_arg(self, mock_send, mock_add_task):
        _handle_command("/add")
        mock_add_task.assert_not_called()
        assert "使い方" in mock_send.call_args[0][0]


class TestUnknownCommand:
    def test_shows_command_list(self, mock_send):
        _handle_command("/unknown")
        assert "/tasks" in mock_send.call_args[0][0]


# ── fixtures ──────────────────────────────────────────────────────────────────

@pytest.fixture
def mock_send():
    with patch("agent.telegram_handler.send_message") as m:
        yield m

@pytest.fixture
def mock_briefing():
    with patch("agent.telegram_handler.send_daily_briefing") as m:
        yield m

@pytest.fixture
def mock_update_due():
    with patch("agent.telegram_handler.update_task_due") as m:
        yield m

@pytest.fixture
def mock_load_cache():
    with patch("agent.telegram_handler._load_task_cache") as m:
        yield m

@pytest.fixture
def mock_complete_task():
    with patch("agent.telegram_handler.complete_task") as m:
        yield m

@pytest.fixture
def mock_delete_event():
    with patch("agent.telegram_handler.delete_calendar_event_for_task") as m:
        yield m

@pytest.fixture
def mock_add_task():
    with patch("agent.telegram_handler.add_task") as m:
        yield m
