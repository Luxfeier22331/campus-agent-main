from __future__ import annotations

from dataclasses import dataclass
from typing import Any


@dataclass(frozen=True, slots=True)
class CollectedNoticeRegulationOwnerTextRecoveryPreview:
    batch_manifest: dict[str, Any]
    attempt_plan: dict[str, Any]
    searchable_merge_contract: dict[str, Any]
    readiness_gap_report: dict[str, Any]
