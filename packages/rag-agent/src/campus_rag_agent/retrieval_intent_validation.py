from __future__ import annotations


def _normalize_and_validate_literal(
    instance: object,
    *,
    field_name: str,
    allowed: tuple[str, ...],
    label: str,
) -> None:
    _normalize_str_field(instance, field_name)
    value = getattr(instance, field_name)
    if value not in allowed:
        raise ValueError(f"unsupported {label}: {value}")


def _normalize_str_field(instance: object, field_name: str) -> None:
    value = getattr(instance, field_name)
    normalized = value.strip() if isinstance(value, str) else value
    if normalized != value:
        object.__setattr__(instance, field_name, normalized)


def _normalize_tuple_field(instance: object, field_name: str) -> None:
    value = getattr(instance, field_name)
    normalized = tuple(item.strip() for item in value if isinstance(item, str) and item.strip())
    if normalized != value:
        object.__setattr__(instance, field_name, normalized)


__all__ = [
    "_normalize_and_validate_literal",
    "_normalize_str_field",
    "_normalize_tuple_field",
]
