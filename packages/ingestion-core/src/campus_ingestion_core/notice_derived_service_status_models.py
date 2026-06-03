from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Protocol


class NoticeDerivedServiceStatusObjectStore(Protocol):
    def get_bytes(self, *, bucket: str, key: str) -> bytes: ...


@dataclass(frozen=True, slots=True)
class _ServiceStatusCandidate:
    subject_id: str
    display_name: str
    service_family: str
    aliases: tuple[str, ...]
    campus_scope: str
    observed_status: str
    effective_from: str
    effective_until: str
    affected_scope: str
    severity: str
    override_source_refs: tuple[str, ...]
    related_notice_refs: tuple[str, ...]
    status_note: str

    def to_record(self) -> dict[str, Any]:
        return {
            "subject_id": self.subject_id,
            "display_name": self.display_name,
            "service_family": self.service_family,
            "aliases": list(self.aliases),
            "campus_scope": self.campus_scope,
            "observed_status": self.observed_status,
            "effective_from": self.effective_from,
            "effective_until": self.effective_until,
            "affected_scope": self.affected_scope,
            "severity": self.severity,
            "override_source_refs": list(self.override_source_refs),
            "related_notice_refs": list(self.related_notice_refs),
            "status_note": self.status_note,
            "extraction_status": "ready",
        }
