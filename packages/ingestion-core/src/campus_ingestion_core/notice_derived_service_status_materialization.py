from __future__ import annotations

import re
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import date, datetime, time, timedelta, timezone
from typing import Any, Protocol

from campus_ingestion_core.models import DocumentRegistryRecord
from campus_ingestion_core.notice_consumption_projection import (
    NOTICE_CONSUMPTION_STATUS_READY_FOR_TARGET,
    NOTICE_TARGET_SURFACE_SERVICE_STATUS_CANDIDATE,
    NoticeConsumptionProjectionEntry,
)
from campus_ingestion_core.registry import DocumentRegistry
from campus_ingestion_core.service_status_projection import (
    SERVICE_STATUS_PROJECTION_SCHEMA_VERSION,
    ServiceStatusProjectionBuildResult,
    validate_service_status_projection_bundle,
)

_SHANGHAI_TZ = timezone(timedelta(hours=8))
_FULL_EFFECTIVE_DATE_RE = re.compile(
    r"(?:自|从)?(20\d{2})[年\-/\.](\d{1,2})[月\-/\.](\d{1,2})日?(?:起|开始|执行|生效)"
)
_YEARLESS_EFFECTIVE_DATE_RE = re.compile(
    r"(?<!\d)(\d{1,2})月(\d{1,2})日[）)]?(?:起|开始|执行|生效)"
)
_YEARLESS_DATE_RE = re.compile(r"(?<!\d)(\d{1,2})月(\d{1,2})日")
_SPACE_RE = re.compile(r"\s+")
_SEGMENT_SPLIT_RE = re.compile(r"[\n。；;]")
_BOARDING_POINT_KEYWORDS = ("乘车点", "上车点", "下车点")
_CHANGE_KEYWORDS = ("更改", "调整", "优化", "变更")
_SUSPENSION_KEYWORDS = ("暂停运营", "暂停运行", "停止运营", "停运", "不运行")


class NoticeDerivedServiceStatusObjectStore(Protocol):
    def get_bytes(self, *, bucket: str, key: str) -> bytes: ...


@dataclass(frozen=True, slots=True)
class _ServiceStatusCandidate:
    subject_id: str
    display_name: str
    aliases: tuple[str, ...]
    campus_scope: str
    observed_status: str
    effective_from: str
    effective_until: str
    override_source_refs: tuple[str, ...]
    related_notice_refs: tuple[str, ...]
    status_note: str

    def to_record(self) -> dict[str, Any]:
        return {
            "subject_id": self.subject_id,
            "display_name": self.display_name,
            "aliases": list(self.aliases),
            "campus_scope": self.campus_scope,
            "observed_status": self.observed_status,
            "effective_from": self.effective_from,
            "effective_until": self.effective_until,
            "override_source_refs": list(self.override_source_refs),
            "related_notice_refs": list(self.related_notice_refs),
            "status_note": self.status_note,
        }


def build_notice_derived_service_status_projection_bundle(
    *,
    projection_entries: Sequence[NoticeConsumptionProjectionEntry],
    registry: DocumentRegistry,
    object_store: NoticeDerivedServiceStatusObjectStore,
    derived_bucket: str,
    generated_at: str,
) -> ServiceStatusProjectionBuildResult:
    generated_dt = _parse_datetime(generated_at, "generated_at")
    records_by_subject: dict[str, _ServiceStatusCandidate] = {}
    for entry in projection_entries:
        candidate = extract_notice_derived_service_status_record(
            projection_entry=entry,
            registry=registry,
            object_store=object_store,
            derived_bucket=derived_bucket,
            generated_at=generated_at,
        )
        if candidate is None:
            continue
        if not _effective_at(candidate, generated_dt):
            continue
        current = records_by_subject.get(candidate.subject_id)
        if current is None or candidate.effective_from > current.effective_from:
            records_by_subject[candidate.subject_id] = candidate
    records = [
        candidate.to_record()
        for candidate in sorted(records_by_subject.values(), key=lambda item: item.subject_id)
    ]
    bundle = {
        "schema_version": SERVICE_STATUS_PROJECTION_SCHEMA_VERSION,
        "service_status_records": records,
    }
    validation_report = validate_service_status_projection_bundle(bundle)
    return ServiceStatusProjectionBuildResult(bundle=bundle, validation_report=validation_report)


def extract_notice_derived_service_status_record(
    *,
    projection_entry: NoticeConsumptionProjectionEntry,
    registry: DocumentRegistry,
    object_store: NoticeDerivedServiceStatusObjectStore,
    derived_bucket: str,
    generated_at: str,
) -> _ServiceStatusCandidate | None:
    if not _is_ready_service_status_candidate(projection_entry):
        return None
    parent_record = _resolve_registry_record(
        registry=registry,
        document_id=projection_entry.source_notice_document_id,
    )
    parent_text = _read_record_text(
        record=parent_record,
        object_store=object_store,
        derived_bucket=derived_bucket,
    )
    source_ref = _source_ref(projection_entry)
    release_dt = _parse_release_time(projection_entry.source_notice_release_time, generated_at)
    return _transport_service_status_candidate(
        text=parent_text,
        projection_entry=projection_entry,
        source_ref=source_ref,
        release_dt=release_dt,
    )


def _transport_service_status_candidate(
    *,
    text: str,
    projection_entry: NoticeConsumptionProjectionEntry,
    source_ref: str,
    release_dt: datetime,
) -> _ServiceStatusCandidate | None:
    normalized = _clean_text(text)
    if not normalized:
        return None
    if _contains_boarding_point_change(normalized):
        effective_from = _start_of_day(_resolve_effective_date(normalized, release_dt))
        return _ServiceStatusCandidate(
            **_transport_subject(normalized, projection_entry),
            observed_status="limited_service",
            effective_from=effective_from.isoformat(),
            effective_until="2099-12-31T23:59:59+08:00",
            override_source_refs=(source_ref,),
            related_notice_refs=(source_ref,),
            status_note=_status_note(text),
        )
    if _contains_suspension(normalized):
        effective_from = _start_of_day(_resolve_effective_date(normalized, release_dt))
        return _ServiceStatusCandidate(
            **_transport_subject(normalized, projection_entry),
            observed_status="temporarily_closed",
            effective_from=effective_from.isoformat(),
            effective_until=(effective_from + timedelta(days=1)).isoformat(),
            override_source_refs=(source_ref,),
            related_notice_refs=(source_ref,),
            status_note=_status_note(text),
        )
    return None


def _transport_subject(
    text: str,
    projection_entry: NoticeConsumptionProjectionEntry,
) -> dict[str, object]:
    title = str(projection_entry.role_metadata.get("notice_title") or "").strip()
    if "通勤班车" in text and any(keyword in text for keyword in _BOARDING_POINT_KEYWORDS):
        return {
            "subject_id": "transport:intercampus-commute:boarding-point:fengtai",
            "display_name": "两校区通勤班车丰台校区乘车点",
            "aliases": (
                "通勤班车丰台校区乘车点",
                "两校区通勤班车乘车点",
                "两校区通勤班车",
                "通勤班车",
                title,
            ),
            "campus_scope": "fengtai",
        }
    if "地铁接驳车" in text and any(keyword in text for keyword in _BOARDING_POINT_KEYWORDS):
        return {
            "subject_id": "transport:subway-shuttle:boarding-point:fengtai",
            "display_name": "丰台校区地铁接驳车乘车点",
            "aliases": (
                "地铁接驳车乘车点",
                "丰台校区地铁接驳车",
                "地铁接驳车",
                title,
            ),
            "campus_scope": "fengtai",
        }
    notice_id = projection_entry.source_notice_id
    return {
        "subject_id": f"notice-derived-service-status:{notice_id}",
        "display_name": title or f"通知 {notice_id} 服务状态",
        "aliases": (title,) if title else (),
        "campus_scope": "",
    }


def _is_ready_service_status_candidate(entry: NoticeConsumptionProjectionEntry) -> bool:
    return (
        entry.target_surface == NOTICE_TARGET_SURFACE_SERVICE_STATUS_CANDIDATE
        and entry.consumption_status == NOTICE_CONSUMPTION_STATUS_READY_FOR_TARGET
    )


def _resolve_registry_record(
    *,
    registry: DocumentRegistry,
    document_id: str,
) -> DocumentRegistryRecord:
    current = registry.current_version(
        document_id,
        preferred_revision_tracks=("source-faithful", "semantic-enriched"),
    )
    if current is not None:
        return current
    latest = registry.latest_versions(document_id)
    if latest:
        return latest[0]
    raise ValueError(f"document registry record not found: {document_id}")


def _read_record_text(
    *,
    record: DocumentRegistryRecord,
    object_store: NoticeDerivedServiceStatusObjectStore,
    derived_bucket: str,
) -> str:
    key = str(record.canonical_markdown_object_key or "").strip()
    if not key:
        return ""
    return object_store.get_bytes(bucket=derived_bucket, key=key).decode("utf-8")


def _contains_boarding_point_change(text: str) -> bool:
    return any(keyword in text for keyword in _BOARDING_POINT_KEYWORDS) and any(
        keyword in text for keyword in _CHANGE_KEYWORDS
    )


def _contains_suspension(text: str) -> bool:
    return any(keyword in text for keyword in _SUSPENSION_KEYWORDS)


def _resolve_effective_date(text: str, release_dt: datetime) -> date:
    full_match = _FULL_EFFECTIVE_DATE_RE.search(text)
    if full_match is not None:
        return date(
            int(full_match.group(1)),
            int(full_match.group(2)),
            int(full_match.group(3)),
        )
    effective_match = _YEARLESS_EFFECTIVE_DATE_RE.search(text)
    if effective_match is not None:
        return _yearless_date(
            int(effective_match.group(1)),
            int(effective_match.group(2)),
            release_dt,
        )
    first_match = _YEARLESS_DATE_RE.search(text)
    if first_match is not None:
        return _yearless_date(
            int(first_match.group(1)),
            int(first_match.group(2)),
            release_dt,
        )
    return release_dt.date()


def _yearless_date(month: int, day: int, release_dt: datetime) -> date:
    candidate = date(release_dt.year, month, day)
    if candidate < release_dt.date() - timedelta(days=180):
        candidate = date(release_dt.year + 1, month, day)
    return candidate


def _start_of_day(value: date) -> datetime:
    return datetime.combine(value, time.min, _SHANGHAI_TZ)


def _parse_release_time(value: str | None, generated_at: str) -> datetime:
    if value:
        return _parse_datetime(value, "source_notice_release_time")
    return _parse_datetime(generated_at, "generated_at")


def _parse_datetime(value: str, field_name: str) -> datetime:
    normalized = str(value or "").strip()
    if not normalized:
        raise ValueError(f"{field_name} is required")
    candidates = [normalized]
    if " " in normalized and "T" not in normalized:
        candidates.append(normalized.replace(" ", "T"))
    for candidate in candidates:
        try:
            parsed = datetime.fromisoformat(candidate)
            if parsed.tzinfo is None:
                parsed = parsed.replace(tzinfo=_SHANGHAI_TZ)
            return parsed.astimezone(_SHANGHAI_TZ)
        except ValueError:
            continue
    raise ValueError(f"{field_name} must be an ISO datetime")


def _effective_at(candidate: _ServiceStatusCandidate, generated_dt: datetime) -> bool:
    effective_from = _parse_datetime(candidate.effective_from, "effective_from")
    effective_until = _parse_datetime(candidate.effective_until, "effective_until")
    return not generated_dt < effective_from and generated_dt < effective_until


def _status_note(text: str) -> str:
    for segment in _SEGMENT_SPLIT_RE.split(text):
        cleaned = _clean_text(segment)
        if not cleaned:
            continue
        if cleaned.startswith("#"):
            continue
        if _contains_boarding_point_change(cleaned) or _contains_suspension(cleaned):
            return cleaned
    return text[:240]


def _source_ref(entry: NoticeConsumptionProjectionEntry) -> str:
    return f"notice:muc_internal_portal:{entry.source_notice_id}"


def _clean_text(value: object) -> str:
    return _SPACE_RE.sub(" ", str(value or "").strip())


__all__ = [
    "build_notice_derived_service_status_projection_bundle",
    "extract_notice_derived_service_status_record",
]
