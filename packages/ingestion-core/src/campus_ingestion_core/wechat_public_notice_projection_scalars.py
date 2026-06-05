from __future__ import annotations

import json
from collections.abc import Mapping, Sequence
from datetime import datetime
from typing import Any

from campus_ingestion_core.wechat_public_notice_projection_constants import (
    _FORBIDDEN_SOURCE_TRUTH_FIELDS,
)


def _load_json_object(payload: bytes, *, field_name: str) -> dict[str, Any]:
    data = json.loads(payload.decode("utf-8"))
    if not isinstance(data, dict):
        raise ValueError(f"{field_name} payload must be a JSON object")
    return dict(data)


def _load_jsonl_rows(payload: bytes, *, field_name: str) -> tuple[dict[str, Any], ...]:
    rows: list[dict[str, Any]] = []
    for index, line in enumerate(payload.decode("utf-8").splitlines(), start=1):
        normalized = line.strip()
        if not normalized:
            continue
        data = json.loads(normalized)
        if not isinstance(data, dict):
            raise ValueError(f"{field_name} line {index} must be a JSON object")
        rows.append(dict(data))
    return tuple(rows)


def _ensure_forbidden_fields_absent(value: object) -> None:
    found = _find_forbidden_fields(value)
    if found:
        ordered = ", ".join(sorted(found))
        raise ValueError(f"wechat source-truth contains forbidden fields: {ordered}")


def _find_forbidden_fields(value: object) -> set[str]:
    found: set[str] = set()
    if isinstance(value, dict):
        for key, nested in value.items():
            if key in _FORBIDDEN_SOURCE_TRUTH_FIELDS:
                found.add(key)
            found.update(_find_forbidden_fields(nested))
    elif isinstance(value, list):
        for item in value:
            found.update(_find_forbidden_fields(item))
    return found


def _required_text(payload: Mapping[str, Any], field_name: str) -> str:
    value = _text(payload.get(field_name))
    if not value:
        raise ValueError(f"{field_name} is required in wechat source-truth manifest")
    return value


def _to_publish_day(value: str) -> str:
    normalized = value.strip()
    if not normalized:
        return ""
    try:
        return datetime.fromisoformat(normalized.replace("Z", "+00:00")).date().isoformat()
    except ValueError:
        return normalized[:10]


def _format_front_matter_value(value: object) -> str:
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, (int, float)):
        return str(value)
    text = str(value)
    if not text:
        return '""'
    if any(ch in text for ch in ["#", "[", "]", "{", "}", ","]) or text != text.strip():
        return json.dumps(text, ensure_ascii=False)
    return text


def _text(value: object) -> str:
    return value.strip() if isinstance(value, str) else ""


def _string_tuple(values: Sequence[object]) -> tuple[str, ...]:
    return tuple(item for item in (_text(value) for value in values) if item)


def _to_non_negative_int(value: object, *, field_name: str) -> int | None:
    if value is None or value == "":
        return None
    if isinstance(value, bool):
        raise ValueError(f"{field_name} must be a non-negative integer")
    if isinstance(value, int):
        parsed = value
    elif isinstance(value, str):
        normalized = value.strip()
        if not normalized:
            return None
        try:
            parsed = int(normalized)
        except ValueError as exc:
            raise ValueError(f"{field_name} must be a non-negative integer") from exc
    else:
        raise ValueError(f"{field_name} must be a non-negative integer")
    if parsed < 0:
        raise ValueError(f"{field_name} must be a non-negative integer")
    return parsed
