from __future__ import annotations

from dataclasses import dataclass, field

from campus_contracts.models_shared import (
    TemporalQueryMode,
    _validate_temporal_query_mode,
)
from campus_contracts.schema_metadata import schema_metadata


@dataclass(frozen=True, slots=True)
class TemporalQuery:
    mode: TemporalQueryMode = field(
        default="current",
        metadata=schema_metadata(description="Temporal query mode."),
    )
    as_of: str = field(
        default="",
        metadata=schema_metadata(description="Required only when mode is as_of."),
    )
    year_hint: str = field(
        default="",
        metadata=schema_metadata(description="Required only when mode is current_year."),
    )

    def __post_init__(self) -> None:
        _validate_temporal_query_mode(self.mode)
        normalized_as_of = self.as_of.strip()
        normalized_year_hint = self.year_hint.strip()
        if normalized_as_of != self.as_of:
            object.__setattr__(self, "as_of", normalized_as_of)
        if normalized_year_hint != self.year_hint:
            object.__setattr__(self, "year_hint", normalized_year_hint)
        if self.mode == "as_of":
            if not normalized_as_of:
                raise ValueError("as_of is required when temporal mode is as_of")
        elif normalized_as_of:
            raise ValueError("as_of is only allowed when temporal mode is as_of")
        if self.mode == "current_year":
            if not normalized_year_hint:
                raise ValueError("year_hint is required when temporal mode is current_year")
        elif normalized_year_hint:
            raise ValueError("year_hint is only allowed when temporal mode is current_year")


__all__ = [
    "TemporalQuery",
]
