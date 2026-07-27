from datetime import datetime
from zoneinfo import ZoneInfo

from app.services.feed_editions import MORNING_BRIEF, is_edition_due


def test_edition_is_due_during_dispatch_window():
    now = datetime(2026, 7, 21, 7, 8, tzinfo=ZoneInfo("America/New_York"))

    assert is_edition_due(now, MORNING_BRIEF)


def test_edition_is_not_due_before_publish_time():
    now = datetime(2026, 7, 21, 6, 59, tzinfo=ZoneInfo("America/New_York"))

    assert not is_edition_due(now, MORNING_BRIEF)


def test_edition_is_not_due_at_next_dispatch_window():
    now = datetime(2026, 7, 21, 7, 15, tzinfo=ZoneInfo("America/New_York"))

    assert not is_edition_due(now, MORNING_BRIEF)
