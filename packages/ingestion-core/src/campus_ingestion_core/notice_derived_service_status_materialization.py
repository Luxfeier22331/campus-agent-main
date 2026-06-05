from __future__ import annotations

from collections.abc import Sequence
from datetime import datetime, timedelta
from typing import Any

from campus_ingestion_core.notice_consumption_projection import (
    NoticeConsumptionProjectionEntry,
)
from campus_ingestion_core.notice_derived_service_status_models import (
    NoticeDerivedServiceStatusObjectStore,
    _ServiceStatusCandidate,
)
from campus_ingestion_core.notice_derived_service_status_sources import (
    _is_ready_service_status_candidate,
    _read_record_text,
    _rejected_source,
    _resolve_registry_record,
    _source_ref,
)
from campus_ingestion_core.notice_derived_service_status_subjects import (
    _facility_subject,
    _it_platform_subject,
    _library_subject,
    _service_counter_subject,
    _transport_subject,
)
from campus_ingestion_core.notice_derived_service_status_text import (
    _clean_text,
    _contains_boarding_point_change,
    _contains_suspension,
    _service_counter_relevant_text,
    _status_note,
)
from campus_ingestion_core.notice_derived_service_status_time import (
    _SHANGHAI_TZ,
    _effective_at,
    _parse_datetime,
    _parse_release_time,
    _resolve_datetime_window,
    _resolve_effective_date,
    _resolve_restore_date,
    _resolve_service_counter_window,
    _start_of_day,
)
from campus_ingestion_core.registry import DocumentRegistry
from campus_ingestion_core.service_status_projection import (
    SERVICE_STATUS_PROJECTION_SCHEMA_VERSION,
    ServiceStatusProjectionBuildResult,
    validate_service_status_projection_bundle,
)


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
    rejected_sources: list[dict[str, Any]] = []
    for entry in projection_entries:
        candidate = extract_notice_derived_service_status_record(
            projection_entry=entry,
            registry=registry,
            object_store=object_store,
            derived_bucket=derived_bucket,
            generated_at=generated_at,
        )
        if candidate is None:
            if _is_ready_service_status_candidate(entry):
                rejected_sources.append(_rejected_source(entry))
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
        "service_status_rejected_sources": rejected_sources,
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
    for resolver in (
        _it_platform_service_status_candidate,
        _library_service_status_candidate,
        _service_counter_status_candidate,
        _facility_service_status_candidate,
        _transport_service_status_candidate,
    ):
        candidate = resolver(
            text=parent_text,
            projection_entry=projection_entry,
            source_ref=source_ref,
            release_dt=release_dt,
        )
        if candidate is not None:
            return candidate
    return None


def _it_platform_service_status_candidate(
    *,
    text: str,
    projection_entry: NoticeConsumptionProjectionEntry,
    source_ref: str,
    release_dt: datetime,
) -> _ServiceStatusCandidate | None:
    normalized = _clean_text(text)
    if not any(
        keyword in normalized
        for keyword in ("信息门户", "校园网", "有线网", "一卡通", "网费", "电费", "VPN", "服务门户")
    ):
        return None
    if not any(
        keyword in normalized
        for keyword in ("维护", "暂停访问", "暂停使用", "升级", "停用", "关闭", "停止使用")
    ):
        return None
    window = _resolve_datetime_window(normalized, release_dt)
    if window is None:
        return None
    effective_from, effective_until = window
    return _ServiceStatusCandidate(
        **_it_platform_subject(normalized, projection_entry),
        service_family="it_platform",
        observed_status="temporarily_closed",
        effective_from=effective_from.isoformat(),
        effective_until=effective_until.isoformat(),
        affected_scope="线上服务",
        severity="high",
        override_source_refs=(source_ref,),
        related_notice_refs=(source_ref,),
        status_note=_status_note(text),
    )


def _library_service_status_candidate(
    *,
    text: str,
    projection_entry: NoticeConsumptionProjectionEntry,
    source_ref: str,
    release_dt: datetime,
) -> _ServiceStatusCandidate | None:
    normalized = _clean_text(text)
    if "图书馆" not in normalized or not any(
        keyword in normalized
        for keyword in ("开放时间", "闭馆", "关闭", "调整", "工作安排", "放假")
    ):
        return None
    window = _resolve_datetime_window(normalized, release_dt)
    if window is None:
        return None
    effective_from, effective_until = window
    has_closure = any(keyword in normalized for keyword in ("闭馆", "关闭", "暂停开放"))
    has_open = any(keyword in normalized for keyword in ("开放", "开馆", "正常使用", "正常开放"))
    observed_status = "temporarily_closed" if has_closure and not has_open else "limited_service"
    return _ServiceStatusCandidate(
        **_library_subject(normalized, projection_entry),
        service_family="library",
        observed_status=observed_status,
        effective_from=effective_from.isoformat(),
        effective_until=effective_until.isoformat(),
        affected_scope="图书馆",
        severity="medium",
        override_source_refs=(source_ref,),
        related_notice_refs=(source_ref,),
        status_note=_status_note(text),
    )


def _service_counter_status_candidate(
    *,
    text: str,
    projection_entry: NoticeConsumptionProjectionEntry,
    source_ref: str,
    release_dt: datetime,
) -> _ServiceStatusCandidate | None:
    relevant = _service_counter_relevant_text(text)
    if not any(keyword in relevant for keyword in ("综合服务大厅", "一站式服务中心", "校医院")):
        return None
    if not any(
        keyword in relevant
        for keyword in (
            "暂停办理",
            "暂停服务",
            "恢复办理",
            "开放时间",
            "调整开放时间",
            "服务日期",
            "服务时间",
            "门诊时间",
            "开诊时间",
            "值班安排",
            "增开",
        )
    ):
        return None
    window = _resolve_service_counter_window(relevant, release_dt)
    if window is None:
        return None
    effective_from, effective_until = window
    observed_status = (
        "temporarily_closed"
        if any(keyword in relevant for keyword in ("暂停办理", "暂停服务", "停诊"))
        and not any(keyword in relevant for keyword in ("增开", "开诊时间", "门诊时间", "服务时间"))
        else "limited_service"
    )
    return _ServiceStatusCandidate(
        **_service_counter_subject(relevant, projection_entry),
        service_family="service_counter",
        observed_status=observed_status,
        effective_from=effective_from.isoformat(),
        effective_until=effective_until.isoformat(),
        affected_scope="线下办理",
        severity="high" if observed_status == "temporarily_closed" else "medium",
        override_source_refs=(source_ref,),
        related_notice_refs=(source_ref,),
        status_note=_status_note(relevant),
    )


def _facility_service_status_candidate(
    *,
    text: str,
    projection_entry: NoticeConsumptionProjectionEntry,
    source_ref: str,
    release_dt: datetime,
) -> _ServiceStatusCandidate | None:
    normalized = _clean_text(text)
    if not any(keyword in normalized for keyword in ("自习室", "教室", "体育馆", "场馆", "浴室")):
        return None
    closure_signal = any(keyword in normalized for keyword in ("临时关闭", "暂停开放", "关闭"))
    limited_service_signal = any(
        keyword in normalized
        for keyword in ("试运行", "开放时间", "调整开放时间", "开放运营", "恢复开放")
    )
    if not closure_signal and not limited_service_signal:
        return None
    effective_from = _start_of_day(_resolve_effective_date(normalized, release_dt))
    restore = _resolve_restore_date(normalized, release_dt)
    effective_until = (
        _start_of_day(restore)
        if restore is not None
        else datetime(2099, 12, 31, 23, 59, 59, tzinfo=_SHANGHAI_TZ)
    )
    observed_status = "temporarily_closed" if closure_signal else "limited_service"
    return _ServiceStatusCandidate(
        **_facility_subject(normalized, projection_entry),
        service_family="facility",
        observed_status=observed_status,
        effective_from=effective_from.isoformat(),
        effective_until=effective_until.isoformat(),
        affected_scope="",
        severity="medium",
        override_source_refs=(source_ref,),
        related_notice_refs=(source_ref,),
        status_note=_status_note(text),
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
            service_family="transport_adjacent",
            observed_status="limited_service",
            effective_from=effective_from.isoformat(),
            effective_until="2099-12-31T23:59:59+08:00",
            affected_scope="丰台校区",
            severity="medium",
            override_source_refs=(source_ref,),
            related_notice_refs=(source_ref,),
            status_note=_status_note(text),
        )
    if _contains_suspension(normalized):
        effective_from = _start_of_day(_resolve_effective_date(normalized, release_dt))
        return _ServiceStatusCandidate(
            **_transport_subject(normalized, projection_entry),
            service_family="transport_adjacent",
            observed_status="temporarily_closed",
            effective_from=effective_from.isoformat(),
            effective_until=(effective_from + timedelta(days=1)).isoformat(),
            affected_scope="",
            severity="high",
            override_source_refs=(source_ref,),
            related_notice_refs=(source_ref,),
            status_note=_status_note(text),
        )
    return None


__all__ = [
    "build_notice_derived_service_status_projection_bundle",
    "extract_notice_derived_service_status_record",
]
