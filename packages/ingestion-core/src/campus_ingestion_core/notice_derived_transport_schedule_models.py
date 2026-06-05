from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol


class NoticeDerivedTransportScheduleObjectStore(Protocol):
    def get_bytes(self, *, bucket: str, key: str) -> bytes: ...


@dataclass(frozen=True, slots=True)
class NoticeDerivedTransportScheduleRow:
    source_notice_id: str
    source_ref: str
    source_attachment_document_id: str
    weekday_scope: str
    route_direction: str
    route_id: str
    departure_time: str
    rider_type: str
    remarks: str
    effective_from: str
    schedule_scope: str
    service_date_ranges: tuple[tuple[str, str], ...]
    precedence: int


@dataclass(frozen=True, slots=True)
class NoticeDerivedTransportServiceException:
    source_notice_id: str
    source_ref: str
    route_id: str
    service_date: str
    service_status: str
    operational_comment: str
    effective_from: str
    schedule_scope: str
    service_date_ranges: tuple[tuple[str, str], ...]
    precedence: int


@dataclass(frozen=True, slots=True)
class NoticeDerivedTransportOperationalNotice:
    source_notice_id: str
    source_ref: str
    notice_kind: str
    route_ids: tuple[str, ...]
    effective_from: str
    effective_until: str
    operational_comment: str
