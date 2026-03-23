"""
tests/test_gmail_handler.py
_load_processed_ids / _save_processed_id / スレッドマップのユニットテスト
"""
import datetime
import json
from unittest.mock import MagicMock, call, patch

import pytest

from agent.gmail_handler import _load_processed_ids, _save_processed_id, _load_thread_map, _save_thread_map


def _days_ago(n: int) -> str:
    return (datetime.date.today() - datetime.timedelta(days=n)).isoformat()


def _write(tmp_path, lines: list[str]):
    f = tmp_path / "processed_ids.txt"
    f.write_text("\n".join(lines) + "\n")
    return f


class TestLoadProcessedIds:
    def test_returns_empty_set_when_file_missing(self, tmp_path, monkeypatch):
        monkeypatch.setattr("agent.gmail_handler._PROCESSED_IDS_FILE", str(tmp_path / "missing.txt"))
        assert _load_processed_ids() == set()

    def test_loads_recent_ids(self, tmp_path, monkeypatch):
        f = _write(tmp_path, [
            f"{_days_ago(1)} id-recent",
            f"{_days_ago(5)} id-five",
        ])
        monkeypatch.setattr("agent.gmail_handler._PROCESSED_IDS_FILE", str(f))
        ids = _load_processed_ids()
        assert ids == {"id-recent", "id-five"}

    def test_excludes_ids_older_than_30_days(self, tmp_path, monkeypatch):
        f = _write(tmp_path, [
            f"{_days_ago(29)} id-ok",
            f"{_days_ago(31)} id-old",
        ])
        monkeypatch.setattr("agent.gmail_handler._PROCESSED_IDS_FILE", str(f))
        ids = _load_processed_ids()
        assert "id-ok" in ids
        assert "id-old" not in ids

    def test_rewrites_file_when_old_entries_removed(self, tmp_path, monkeypatch):
        f = _write(tmp_path, [
            f"{_days_ago(1)} id-keep",
            f"{_days_ago(40)} id-drop",
        ])
        monkeypatch.setattr("agent.gmail_handler._PROCESSED_IDS_FILE", str(f))
        _load_processed_ids()
        content = f.read_text()
        assert "id-keep" in content
        assert "id-drop" not in content

    def test_skips_legacy_format_lines(self, tmp_path, monkeypatch):
        f = _write(tmp_path, [
            "legacy-id-without-date",
            f"{_days_ago(1)} new-format-id",
        ])
        monkeypatch.setattr("agent.gmail_handler._PROCESSED_IDS_FILE", str(f))
        ids = _load_processed_ids()
        assert "legacy-id-without-date" not in ids
        assert "new-format-id" in ids

    def test_does_not_rewrite_file_when_no_old_entries(self, tmp_path, monkeypatch):
        f = _write(tmp_path, [
            f"{_days_ago(1)} id-a",
            f"{_days_ago(2)} id-b",
        ])
        monkeypatch.setattr("agent.gmail_handler._PROCESSED_IDS_FILE", str(f))
        mtime_before = f.stat().st_mtime
        _load_processed_ids()
        assert f.stat().st_mtime == mtime_before


class TestSaveProcessedId:
    def test_saves_with_today_prefix(self, tmp_path, monkeypatch):
        f = tmp_path / "processed_ids.txt"
        monkeypatch.setattr("agent.gmail_handler._PROCESSED_IDS_FILE", str(f))
        _save_processed_id("msg-xyz")
        today = datetime.date.today().isoformat()
        assert f.read_text().strip() == f"{today} msg-xyz"

    def test_appends_multiple_ids(self, tmp_path, monkeypatch):
        f = tmp_path / "processed_ids.txt"
        monkeypatch.setattr("agent.gmail_handler._PROCESSED_IDS_FILE", str(f))
        _save_processed_id("msg-1")
        _save_processed_id("msg-2")
        lines = [l for l in f.read_text().splitlines() if l]
        assert len(lines) == 2


class TestThreadMap:
    def test_load_returns_empty_when_missing(self, tmp_path, monkeypatch):
        monkeypatch.setattr("agent.gmail_handler._THREAD_MAP_FILE", str(tmp_path / "missing.json"))
        assert _load_thread_map() == {}

    def test_load_and_save_roundtrip(self, tmp_path, monkeypatch):
        f = tmp_path / "thread_map.json"
        monkeypatch.setattr("agent.gmail_handler._THREAD_MAP_FILE", str(f))
        data = {"thread-1": "page-abc", "thread-2": "page-xyz"}
        _save_thread_map(data)
        assert _load_thread_map() == data


class TestProcessUnreadEmailsThreading:
    """返信メール検出（threadId）のテスト"""

    def _make_msg(self, msg_id, thread_id, subject, body=""):
        return {
            "id": msg_id,
            "threadId": thread_id,
            "payload": {
                "headers": [
                    {"name": "Subject", "value": subject},
                    {"name": "From", "value": "sender@example.com"},
                ],
                "mimeType": "text/plain",
                "body": {"data": ""},
                "parts": [],
            },
        }

    def test_reply_updates_existing_task(self, tmp_path, monkeypatch):
        """同じ threadId のメールは既存タスクを更新する"""
        ids_file = tmp_path / "processed_ids.txt"
        ids_file.write_text("")
        thread_file = tmp_path / "thread_map.json"
        thread_file.write_text(json.dumps({"thread-1": "existing-page-id"}))

        monkeypatch.setattr("agent.gmail_handler._PROCESSED_IDS_FILE", str(ids_file))
        monkeypatch.setattr("agent.gmail_handler._THREAD_MAP_FILE", str(thread_file))

        mock_service = MagicMock()
        mock_service.users.return_value.messages.return_value.list.return_value.execute.return_value = {
            "messages": [{"id": "msg-reply", "threadId": "thread-1"}]
        }
        mock_service.users.return_value.messages.return_value.get.return_value.execute.return_value = \
            self._make_msg("msg-reply", "thread-1", "Re: 元のタスク")

        analysis = {"summary": "返信の要約", "tasks": [{"title": "追加アクション", "priority": "medium", "due": None}]}

        with patch("agent.gmail_handler.build", return_value=mock_service), \
             patch("agent.gmail_handler.get_credentials"), \
             patch("agent.gmail_handler.analyze_email", return_value=analysis), \
             patch("agent.gmail_handler.update_task_from_reply") as mock_update, \
             patch("agent.gmail_handler.add_task") as mock_add, \
             patch("agent.gmail_handler.send_message"):
            from agent.gmail_handler import process_unread_emails
            process_unread_emails()

        mock_update.assert_called_once_with(
            "existing-page-id",
            checklist=["追加アクション"],
            priority="medium",
            due=None,
        )
        mock_add.assert_not_called()

    def test_new_thread_creates_task_and_saves_map(self, tmp_path, monkeypatch):
        """新規 threadId はタスク作成してマップに登録する"""
        ids_file = tmp_path / "processed_ids.txt"
        ids_file.write_text("")
        thread_file = tmp_path / "thread_map.json"
        thread_file.write_text("{}")

        monkeypatch.setattr("agent.gmail_handler._PROCESSED_IDS_FILE", str(ids_file))
        monkeypatch.setattr("agent.gmail_handler._THREAD_MAP_FILE", str(thread_file))

        mock_service = MagicMock()
        mock_service.users.return_value.messages.return_value.list.return_value.execute.return_value = {
            "messages": [{"id": "msg-new", "threadId": "thread-new"}]
        }
        mock_service.users.return_value.messages.return_value.get.return_value.execute.return_value = \
            self._make_msg("msg-new", "thread-new", "新規タスク")

        analysis = {"summary": "新規の要約", "tasks": [{"title": "やること", "priority": "high", "due": None}]}

        with patch("agent.gmail_handler.build", return_value=mock_service), \
             patch("agent.gmail_handler.get_credentials"), \
             patch("agent.gmail_handler.analyze_email", return_value=analysis), \
             patch("agent.gmail_handler.add_task", return_value="new-page-id") as mock_add, \
             patch("agent.gmail_handler.update_task_from_reply") as mock_update, \
             patch("agent.gmail_handler.send_message"):
            from agent.gmail_handler import process_unread_emails
            process_unread_emails()

        mock_add.assert_called_once()
        mock_update.assert_not_called()
        saved = json.loads(thread_file.read_text())
        assert saved.get("thread-new") == "new-page-id"
