from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True, slots=True)
class ExtractedClaim:
    claim_type: str
    claim_text: str
    unsupported_summary_field: str


__all__ = ["ExtractedClaim"]
