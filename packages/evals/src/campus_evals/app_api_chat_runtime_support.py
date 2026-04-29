from __future__ import annotations

import base64
from string import Formatter

import httpx

_ALLOWED_CORRELATION_TEMPLATE_FIELDS = frozenset(
    {
        "case_id",
        "collection",
        "conversation_id",
        "corpus",
        "request_id",
        "selected_target",
        "status",
        "trace_id",
    }
)


def _validate_correlation_template(*, field: str, template: str) -> None:
    unsupported_fields = sorted(
        {
            name
            for _, name, _, _ in Formatter().parse(template)
            if name and name not in _ALLOWED_CORRELATION_TEMPLATE_FIELDS
        }
    )
    if unsupported_fields:
        joined = ", ".join(unsupported_fields)
        raise ValueError(f"{field} contains unsupported template fields: {joined}")


def _render_correlation_template(
    template: str | None,
    values: dict[str, str],
) -> str | None:
    if template is None:
        return None
    rendered = template.format(**values).strip()
    return rendered or None


def _optional_record(value: object) -> dict[str, object] | None:
    if value and isinstance(value, dict):
        return dict(value)
    return None


def _optional_list(value: object) -> list[object]:
    return list(value) if isinstance(value, list) else []


def _string_tuple(value: object) -> tuple[str, ...]:
    return tuple(
        item
        for item in (_optional_string(item) for item in _optional_list(value))
        if item is not None
    )


def _optional_bool(value: object) -> bool | None:
    return value if isinstance(value, bool) else None


def _optional_int(value: object) -> int | None:
    return int(value) if isinstance(value, int) and not isinstance(value, bool) else None


def _required_string(value: object, field: str) -> str:
    normalized = _optional_string(value)
    if normalized is None:
        raise ValueError(f"{field} is required")
    return normalized


def _optional_string(value: object) -> str | None:
    normalized = str(value or "").strip()
    return normalized or None


def _normalize_optional_string(value: object) -> str | None:
    normalized = str(value or "").strip()
    return normalized or None


def _encode_eval_header_value(value: str) -> str:
    normalized = value.strip()
    if not normalized:
        return ""
    try:
        normalized.encode("ascii")
    except UnicodeEncodeError:
        return f"b64:{base64.b64encode(normalized.encode('utf-8')).decode('ascii')}"
    return normalized


def _decode_json(response: httpx.Response) -> dict[str, object]:
    try:
        payload = response.json()
    except ValueError:
        return {}
    return dict(payload or {})
