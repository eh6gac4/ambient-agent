import pytest
from agent.notion_handler import _parse_task_page


def _make_page(title="Test", due=None, priority="medium", page_id="abc123", url="https://notion.so/abc"):
    props = {
        "タイトル": {"title": [{"text": {"content": title}}]},
        "Priority": {"select": {"name": priority}},
        "Status": {"status": {"name": "未着手"}},
    }
    if due:
        props["Due"] = {"date": {"start": due}}
    else:
        props["Due"] = {"date": None}
    return {"id": page_id, "url": url, "properties": props}


class TestParseTaskPage:
    def test_basic_fields(self):
        page = _make_page(title="Buy milk", priority="high", due="2026-03-25")
        task = _parse_task_page(page)
        assert task["title"] == "Buy milk"
        assert task["priority"] == "high"
        assert task["due"] == "2026-03-25"
        assert task["page_id"] == "abc123"

    def test_no_due(self):
        page = _make_page()
        task = _parse_task_page(page)
        assert task["due"] is None

    def test_empty_title(self):
        page = _make_page()
        page["properties"]["タイトル"]["title"] = []
        task = _parse_task_page(page)
        assert task["title"] == ""

    def test_missing_priority_defaults_to_medium(self):
        page = _make_page()
        page["properties"]["Priority"]["select"] = None
        task = _parse_task_page(page)
        assert task["priority"] == "medium"

    def test_url_included(self):
        page = _make_page(url="https://notion.so/xyz")
        task = _parse_task_page(page)
        assert task["url"] == "https://notion.so/xyz"
