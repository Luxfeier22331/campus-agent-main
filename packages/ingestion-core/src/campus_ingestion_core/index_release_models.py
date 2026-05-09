from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True, slots=True)
class IndexReleaseValidationResult:
    status: str
    summary: dict[str, object]
