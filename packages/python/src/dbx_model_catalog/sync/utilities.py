from __future__ import annotations

import json
from datetime import UTC, date, datetime
from typing import Any

from dateutil.parser import parse


def parse_flexible_date(value: date | datetime | str) -> datetime:
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=UTC)
    if isinstance(value, date):
        return datetime(value.year, value.month, value.day, tzinfo=UTC)
    normalized = f"{value}-01" if len(value) == 7 and value[4] == "-" else value
    result = parse(normalized)
    return result.astimezone(UTC) if result.tzinfo else result.replace(tzinfo=UTC)


def stringify_json(value: Any, *, indent: int | None = None) -> str:
    return json.dumps(value, default=_json_default, indent=indent, separators=None if indent else (",", ":"))


def _json_default(value: Any) -> object:
    if isinstance(value, (date, datetime)):
        return value.isoformat().replace("+00:00", "Z")
    model_dump = getattr(value, "model_dump", None)
    if callable(model_dump):
        return model_dump(mode="json")
    raise TypeError(f"Object of type {type(value).__name__} is not JSON serializable")
