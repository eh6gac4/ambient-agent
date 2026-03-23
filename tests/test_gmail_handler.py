"""
tests/test_gmail_handler.py
_load_processed_ids / _save_processed_id のユニットテスト
"""
import datetime
from unittest.mock import patch

import pytest

from agent.gmail_handler import _load_processed_ids, _save_processed_id


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
