import json
import pytest
from datetime import date
from unittest.mock import MagicMock, patch, mock_open
from agent.google_calendar import _load_store, _save_store, sync_tasks_to_calendar, delete_calendar_event_for_task


class TestLoadStore:
    def test_returns_empty_dict_if_missing(self, tmp_path, monkeypatch):
        monkeypatch.setattr("agent.google_calendar._SYNC_STORE", str(tmp_path / "nonexistent.json"))
        assert _load_store() == {}

    def test_returns_empty_dict_on_invalid_json(self, tmp_path, monkeypatch):
        f = tmp_path / "store.json"
        f.write_text("not json")
        monkeypatch.setattr("agent.google_calendar._SYNC_STORE", str(f))
        assert _load_store() == {}

    def test_loads_existing_store(self, tmp_path, monkeypatch):
        data = {"page1": {"event_id": "ev1", "calendar_date": "2026-03-21"}}
        f = tmp_path / "store.json"
        f.write_text(json.dumps(data))
        monkeypatch.setattr("agent.google_calendar._SYNC_STORE", str(f))
        assert _load_store() == data


class TestOverdueDetermination:
    """sync_tasks_to_calendarの期限切れ判定ロジックをテスト"""

    def test_overdue_task_gets_today_as_target(self, tmp_path, monkeypatch):
        today = date.today().isoformat()
        past_due = "2026-01-01"
        store_file = tmp_path / "store.json"
        store_file.write_text("{}")

        monkeypatch.setattr("agent.google_calendar._SYNC_STORE", str(store_file))

        tasks = [{"title": "Old task", "page_id": "p1", "due": past_due}]
        mock_service = MagicMock()
        mock_service.events().insert().execute.return_value = {"id": "new_ev"}

        with patch("agent.google_calendar.get_pending_tasks", return_value=tasks), \
             patch("agent.google_calendar.build", return_value=mock_service), \
             patch("agent.google_calendar.get_credentials"):
            sync_tasks_to_calendar()

        store = json.loads(store_file.read_text())
        assert store["p1"]["calendar_date"] == today

    def test_future_task_keeps_original_due(self, tmp_path, monkeypatch):
        future_due = "2099-12-31"
        store_file = tmp_path / "store.json"
        store_file.write_text("{}")

        monkeypatch.setattr("agent.google_calendar._SYNC_STORE", str(store_file))

        tasks = [{"title": "Future task", "page_id": "p2", "due": future_due}]
        mock_service = MagicMock()
        mock_service.events().insert().execute.return_value = {"id": "ev2"}

        with patch("agent.google_calendar.get_pending_tasks", return_value=tasks), \
             patch("agent.google_calendar.build", return_value=mock_service), \
             patch("agent.google_calendar.get_credentials"):
            sync_tasks_to_calendar()

        store = json.loads(store_file.read_text())
        assert store["p2"]["calendar_date"] == future_due

    def test_already_synced_today_is_skipped(self, tmp_path, monkeypatch):
        today = date.today().isoformat()
        store_file = tmp_path / "store.json"
        existing = {"p3": {"event_id": "ev3", "calendar_date": today}}
        store_file.write_text(json.dumps(existing))

        monkeypatch.setattr("agent.google_calendar._SYNC_STORE", str(store_file))

        tasks = [{"title": "Task", "page_id": "p3", "due": today}]
        mock_service = MagicMock()

        with patch("agent.google_calendar.get_pending_tasks", return_value=tasks), \
             patch("agent.google_calendar.build", return_value=mock_service), \
             patch("agent.google_calendar.get_credentials"):
            sync_tasks_to_calendar()

        mock_service.events().insert.assert_not_called()


class TestDeleteCalendarEventForTask:
    def test_deletes_event_and_removes_from_store(self, tmp_path, monkeypatch):
        store_data = {"page-1": {"event_id": "ev-abc", "calendar_date": "2026-03-25"}}
        store_file = tmp_path / "store.json"
        store_file.write_text(json.dumps(store_data))
        monkeypatch.setattr("agent.google_calendar._SYNC_STORE", str(store_file))

        mock_service = MagicMock()
        with patch("agent.google_calendar.build", return_value=mock_service), \
             patch("agent.google_calendar.get_credentials"):
            result = delete_calendar_event_for_task("page-1")

        assert result is True
        mock_service.events().delete.assert_called_once_with(calendarId="primary", eventId="ev-abc")
        store = json.loads(store_file.read_text())
        assert "page-1" not in store

    def test_returns_false_when_no_record(self, tmp_path, monkeypatch):
        store_file = tmp_path / "store.json"
        store_file.write_text("{}")
        monkeypatch.setattr("agent.google_calendar._SYNC_STORE", str(store_file))

        result = delete_calendar_event_for_task("page-999")

        assert result is False

    def test_removes_from_store_even_if_api_fails(self, tmp_path, monkeypatch):
        store_data = {"page-2": {"event_id": "ev-xyz", "calendar_date": "2026-03-25"}}
        store_file = tmp_path / "store.json"
        store_file.write_text(json.dumps(store_data))
        monkeypatch.setattr("agent.google_calendar._SYNC_STORE", str(store_file))

        mock_service = MagicMock()
        mock_service.events().delete().execute.side_effect = Exception("API error")
        with patch("agent.google_calendar.build", return_value=mock_service), \
             patch("agent.google_calendar.get_credentials"):
            result = delete_calendar_event_for_task("page-2")

        assert result is True
        store = json.loads(store_file.read_text())
        assert "page-2" not in store
