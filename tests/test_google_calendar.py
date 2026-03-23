import json
import pytest
from datetime import date
from unittest.mock import MagicMock, patch
from agent.google_calendar import _load_store, _save_store, sync_calendar, delete_calendar_event_for_task


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


class TestSyncCalendar:
    def _setup(self, tmp_path, monkeypatch, store_data=None):
        store_file = tmp_path / "store.json"
        store_file.write_text(json.dumps(store_data or {}))
        monkeypatch.setattr("agent.google_calendar._SYNC_STORE", str(store_file))
        mock_service = MagicMock()
        mock_service.events.return_value.insert.return_value.execute.return_value = {"id": "new_ev"}
        return store_file, mock_service

    def test_overdue_task_gets_today_as_target(self, tmp_path, monkeypatch):
        today = date.today().isoformat()
        store_file, mock_service = self._setup(tmp_path, monkeypatch)
        tasks = [{"title": "Old task", "page_id": "p1", "due": "2026-01-01"}]

        with patch("agent.google_calendar.get_pending_tasks", return_value=tasks), \
             patch("agent.google_calendar.build", return_value=mock_service), \
             patch("agent.google_calendar.get_credentials"):
            sync_calendar()

        store = json.loads(store_file.read_text())
        assert store["p1"]["calendar_date"] == today

    def test_future_task_keeps_original_due(self, tmp_path, monkeypatch):
        future_due = "2099-12-31"
        store_file, mock_service = self._setup(tmp_path, monkeypatch)
        tasks = [{"title": "Future task", "page_id": "p2", "due": future_due}]

        with patch("agent.google_calendar.get_pending_tasks", return_value=tasks), \
             patch("agent.google_calendar.build", return_value=mock_service), \
             patch("agent.google_calendar.get_credentials"):
            sync_calendar()

        store = json.loads(store_file.read_text())
        assert store["p2"]["calendar_date"] == future_due

    def test_already_synced_today_is_skipped(self, tmp_path, monkeypatch):
        today = date.today().isoformat()
        store_data = {"p3": {"event_id": "ev3", "calendar_date": today}}
        store_file, mock_service = self._setup(tmp_path, monkeypatch, store_data)
        tasks = [{"title": "Task", "page_id": "p3", "due": today}]

        with patch("agent.google_calendar.get_pending_tasks", return_value=tasks), \
             patch("agent.google_calendar.build", return_value=mock_service), \
             patch("agent.google_calendar.get_credentials"):
            sync_calendar()

        mock_service.events.return_value.insert.assert_not_called()

    def test_deletes_event_for_task_not_in_pending(self, tmp_path, monkeypatch):
        """store にあるが get_pending_tasks に含まれない → 完了/削除済みとして削除"""
        store_data = {
            "page-done": {"event_id": "ev-done", "calendar_date": "2026-03-25"},
            "page-pending": {"event_id": "ev-pending", "calendar_date": "2099-12-31"},
        }
        store_file, mock_service = self._setup(tmp_path, monkeypatch, store_data)
        tasks = [{"title": "Pending task", "page_id": "page-pending", "due": "2099-12-31"}]

        with patch("agent.google_calendar.get_pending_tasks", return_value=tasks), \
             patch("agent.google_calendar.build", return_value=mock_service), \
             patch("agent.google_calendar.get_credentials"):
            sync_calendar()

        store = json.loads(store_file.read_text())
        assert "page-done" not in store
        assert "page-pending" in store

    def test_uses_single_service_build(self, tmp_path, monkeypatch):
        store_data = {"page-done": {"event_id": "ev-done", "calendar_date": "2026-03-25"}}
        store_file, mock_service = self._setup(tmp_path, monkeypatch, store_data)
        tasks = [{"title": "New task", "page_id": "page-new", "due": "2099-12-31"}]

        with patch("agent.google_calendar.get_pending_tasks", return_value=tasks), \
             patch("agent.google_calendar.build", return_value=mock_service) as mock_build, \
             patch("agent.google_calendar.get_credentials"):
            sync_calendar()

        mock_build.assert_called_once()

    def test_uses_single_get_pending_tasks_call(self, tmp_path, monkeypatch):
        """get_pending_tasks は1回だけ呼ばれる（N+1 解消の確認）"""
        store_file, mock_service = self._setup(tmp_path, monkeypatch)

        with patch("agent.google_calendar.get_pending_tasks", return_value=[]) as mock_get, \
             patch("agent.google_calendar.build", return_value=mock_service), \
             patch("agent.google_calendar.get_credentials"):
            sync_calendar()

        mock_get.assert_called_once()


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
