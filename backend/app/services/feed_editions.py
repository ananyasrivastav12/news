from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, time
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

MORNING_BRIEF = "morning_brief"
MIDDAY_CATCH_UP = "midday_catch_up"
DAILY_DIGEST = "daily_digest"

SUPPORTED_TIMEZONES = {
    "America/New_York",
    "Asia/Kolkata",
    "Asia/Calcutta",
}
DEFAULT_TIMEZONE = "America/New_York"


@dataclass(frozen=True)
class FeedEditionDefinition:
    edition_type: str
    title: str
    publish_time: time


EDITION_DEFINITIONS = [
    FeedEditionDefinition(MORNING_BRIEF, "Morning Brief", time(hour=7)),
    FeedEditionDefinition(MIDDAY_CATCH_UP, "Midday Catch-Up", time(hour=16)),
    FeedEditionDefinition(DAILY_DIGEST, "Daily Digest", time(hour=21)),
]

EDITION_BY_TYPE = {
    definition.edition_type: definition for definition in EDITION_DEFINITIONS
}


def normalize_timezone(value: str | None) -> str:
    if value == "Asia/Calcutta":
        return "Asia/Kolkata"
    if value in SUPPORTED_TIMEZONES:
        return value
    return DEFAULT_TIMEZONE


def get_timezone(value: str | None) -> ZoneInfo:
    timezone_name = normalize_timezone(value)
    try:
        return ZoneInfo(timezone_name)
    except ZoneInfoNotFoundError:
        return ZoneInfo(DEFAULT_TIMEZONE)


def local_now(timezone_name: str | None = None) -> datetime:
    return datetime.now(get_timezone(timezone_name))


def local_feed_date(timezone_name: str | None = None) -> date:
    return local_now(timezone_name).date()


def edition_publish_at(
    feed_date: date, edition_type: str, timezone_name: str | None = None
) -> datetime:
    definition = EDITION_BY_TYPE[edition_type]
    return datetime.combine(
        feed_date, definition.publish_time, get_timezone(timezone_name)
    )


def expected_edition_types(now: datetime) -> list[str]:
    return [
        definition.edition_type
        for definition in EDITION_DEFINITIONS
        if now.time() >= definition.publish_time
    ]


def latest_expected_edition_type(now: datetime) -> str:
    expected = expected_edition_types(now)
    return expected[-1] if expected else DAILY_DIGEST


def is_edition_due(now: datetime, edition_type: str) -> bool:
    definition = EDITION_BY_TYPE[edition_type]
    return (
        now.hour == definition.publish_time.hour
        and now.minute == definition.publish_time.minute
    )


def validate_edition_type(value: str) -> str:
    if value not in EDITION_BY_TYPE:
        supported = ", ".join(EDITION_BY_TYPE)
        raise ValueError(
            f"Unsupported feed edition '{value}'. Expected one of: {supported}."
        )
    return value
