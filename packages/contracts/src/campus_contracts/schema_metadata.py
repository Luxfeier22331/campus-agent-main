from __future__ import annotations

from collections.abc import Iterable
from typing import Any

SCHEMA_DESCRIPTION = "description"
SCHEMA_SEMANTIC_REQUIRED = "semantic_required"
SCHEMA_ENUM_VALUES = "enum_values"
SCHEMA_EXCLUDE = "schema_exclude"
SCHEMA_MINIMUM = "minimum"


def schema_metadata(
    *,
    description: str,
    semantic_required: bool = False,
    enum_values: Iterable[str] | None = None,
    exclude: bool = False,
    minimum: int | None = None,
) -> dict[str, Any]:
    metadata: dict[str, Any] = {
        SCHEMA_DESCRIPTION: description,
    }
    if semantic_required:
        metadata[SCHEMA_SEMANTIC_REQUIRED] = True
    if enum_values is not None:
        metadata[SCHEMA_ENUM_VALUES] = tuple(str(value) for value in enum_values)
    if exclude:
        metadata[SCHEMA_EXCLUDE] = True
    if minimum is not None:
        metadata[SCHEMA_MINIMUM] = int(minimum)
    return metadata


__all__ = [
    "SCHEMA_DESCRIPTION",
    "SCHEMA_ENUM_VALUES",
    "SCHEMA_EXCLUDE",
    "SCHEMA_MINIMUM",
    "SCHEMA_SEMANTIC_REQUIRED",
    "schema_metadata",
]
