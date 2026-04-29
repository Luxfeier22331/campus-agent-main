from __future__ import annotations


def require_object(raw_value: object, *, field_name: str) -> dict[str, object]:
    if not isinstance(raw_value, dict):
        raise ValueError(f"{field_name} must be an object")
    return raw_value


def parse_optional_int(raw_value: object) -> int | None:
    if raw_value is None:
        return None
    if not isinstance(raw_value, int) or isinstance(raw_value, bool):
        raise ValueError("integer field must be an integer")
    return raw_value


def parse_optional_string(raw_value: object, *, field_name: str = "string field") -> str | None:
    if raw_value is None:
        return None
    if not isinstance(raw_value, str):
        raise ValueError(f"{field_name} must be a string")
    value = raw_value.strip()
    return value or None


def parse_requested_capability(
    raw_capability: object,
    *,
    field_name: str = "requested_capability",
) -> str | None:
    return parse_optional_string(raw_capability, field_name=field_name)


def parse_string_dict(raw_value: object, *, field_name: str) -> dict[str, str]:
    if raw_value is None:
        return {}
    if not isinstance(raw_value, dict):
        raise ValueError(f"{field_name} must be an object")
    values: dict[str, str] = {}
    for key, value in raw_value.items():
        if not isinstance(key, str) or not isinstance(value, str):
            raise ValueError(f"{field_name} must only contain string values")
        normalized_key = key.strip()
        normalized_value = value.strip()
        if normalized_key and normalized_value:
            values[normalized_key] = normalized_value
    return values


def parse_string_tuple(raw_value: object, *, field_name: str) -> tuple[str, ...]:
    if raw_value is None:
        return ()
    if not isinstance(raw_value, list):
        raise ValueError(f"{field_name} must be an array")

    values: list[str] = []
    for item in raw_value:
        if not isinstance(item, str):
            raise ValueError(f"{field_name} must only contain strings")
        normalized = item.strip()
        if normalized:
            values.append(normalized)
    return tuple(values)


def require_bool(raw_value: object, *, field_name: str) -> bool:
    if not isinstance(raw_value, bool):
        raise ValueError(f"{field_name} must be a boolean")
    return raw_value


def require_string(raw_value: object, *, field_name: str) -> str:
    value = parse_optional_string(raw_value, field_name=field_name)
    if value is None:
        raise ValueError(f"{field_name} must be a non-empty string")
    return value
