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
_MONTH_COLON_DAY_RE = re.compile(r"(?<!\d)(\d{1,2})月[:：]\s*(\d{1,2})日?")
_RANGE_SEPARATOR_RE = r"(?:至|到|-+|—+|－+)"
_FULL_DATETIME_RANGE_RE = re.compile(
    r"(20\d{2})年(\d{1,2})月(\d{1,2})日\s*([0-2]?\d)[:：]([0-5]\d)"
    rf"\s*{_RANGE_SEPARATOR_RE}\s*"
    r"(20\d{2})年(\d{1,2})月(\d{1,2})日\s*([0-2]?\d)[:：]([0-5]\d)"
)
_FULL_TO_YEARLESS_DATETIME_RANGE_RE = re.compile(
    r"(20\d{2})年(\d{1,2})月(\d{1,2})日\s*([0-2]?\d)[:：]([0-5]\d)"
    rf"\s*{_RANGE_SEPARATOR_RE}\s*"
    r"(\d{1,2})月(\d{1,2})日\s*([0-2]?\d)[:：]([0-5]\d)"
)
_YEARLESS_DATE_RANGE_WITH_TIME_RE = re.compile(
    rf"(?<!\d)(\d{{1,2}})月(\d{{1,2}})日\s*{_RANGE_SEPARATOR_RE}\s*"
    r"(\d{1,2})月(\d{1,2})日.*?([0-2]?\d)[:：]([0-5]\d)\s*"
    rf"{_RANGE_SEPARATOR_RE}\s*"
    r"([0-2]?\d)[:：]([0-5]\d)"
)
_FULL_TO_YEARLESS_DATE_RANGE_RE = re.compile(
    rf"(20\d{{2}})年(\d{{1,2}})月(\d{{1,2}})日\s*{_RANGE_SEPARATOR_RE}\s*"
    r"(\d{1,2})月(\d{1,2})日"
)
_YEARLESS_SAME_MONTH_DAY_RANGE_RE = re.compile(
    rf"(?<!\d)(\d{{1,2}})月(\d{{1,2}})日(?:[（(][^）)]*[）)])?\s*{_RANGE_SEPARATOR_RE}\s*"
    r"(\d{1,2})日"
)
_YEARLESS_DATE_RANGE_RE = re.compile(
    rf"(?<!\d)(\d{{1,2}})月(\d{{1,2}})日(?:[（(][^）)]*[）)])?\s*{_RANGE_SEPARATOR_RE}\s*"
    r"(\d{1,2})月(\d{1,2})日"
)
_RESTORE_YEARLESS_DATE_RE = re.compile(
    r"(?<!\d)(\d{1,2})月(\d{1,2})日[）)]?(?:起|开始)?[^，。；;]{0,8}?恢复"
)
_TIME_RANGE_RE = re.compile(
    rf"([0-2]?\d)[:：]([0-5]\d)\s*{_RANGE_SEPARATOR_RE}\s*([0-2]?\d)[:：]([0-5]\d)"
)
_MARKDOWN_HEADING_RE = re.compile(r"^#{1,6}\s*")
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


def _it_platform_subject(
    text: str,
    projection_entry: NoticeConsumptionProjectionEntry,
) -> dict[str, object]:
    title = str(projection_entry.role_metadata.get("notice_title") or "").strip()
    if "信息门户" in text:
        return {
            "subject_id": "it-platform:information-portal",
            "display_name": "信息门户",
            "aliases": ("信息门户", "网上办事大厅", title),
            "campus_scope": "",
        }
    if "一卡通" in text:
        return {
            "subject_id": "it-platform:campus-card",
            "display_name": "一卡通平台",
            "aliases": ("一卡通", "校园卡", title),
            "campus_scope": "",
        }
    if "校园网" in text:
        return {
            "subject_id": "it-platform:campus-network",
            "display_name": "校园网",
            "aliases": ("校园网", "网络服务", title),
            "campus_scope": "",
        }
    if "有线网" in text:
        return {
            "subject_id": "it-platform:campus-network",
            "display_name": "有线网",
            "aliases": ("有线网", "校园网", "网络服务", title),
            "campus_scope": "",
        }
    if "VPN" in text:
        return {
            "subject_id": "it-platform:vpn",
            "display_name": "VPN 服务",
            "aliases": ("VPN", "VPN服务", title),
            "campus_scope": "",
        }
    return {
        "subject_id": f"it-platform:notice:{projection_entry.source_notice_id}",
        "display_name": title or "信息化服务",
        "aliases": (title,) if title else (),
        "campus_scope": "",
    }


def _library_subject(
    text: str,
    projection_entry: NoticeConsumptionProjectionEntry,
) -> dict[str, object]:
    title = str(projection_entry.role_metadata.get("notice_title") or "").strip()
    campus_scope = "fengtai" if "丰台" in text else "haidian"
    display = "丰台校区图书馆" if campus_scope == "fengtai" else "海淀校区图书馆"
    return {
        "subject_id": f"library:{campus_scope}",
        "display_name": display,
        "aliases": ("图书馆", display, title),
        "campus_scope": campus_scope,
    }


def _service_counter_subject(
    text: str,
    projection_entry: NoticeConsumptionProjectionEntry,
) -> dict[str, object]:
    title = str(projection_entry.role_metadata.get("notice_title") or "").strip()
    if "校医院" in text:
        return {
            "subject_id": "service-counter:campus-hospital",
            "display_name": "校医院",
            "aliases": ("校医院", "校园医院", title),
            "campus_scope": "",
        }
    return {
        "subject_id": "service-counter:comprehensive-service-hall",
        "display_name": "综合服务大厅",
        "aliases": ("综合服务大厅", "一站式服务中心", title),
        "campus_scope": "",
    }


def _facility_subject(
    text: str,
    projection_entry: NoticeConsumptionProjectionEntry,
) -> dict[str, object]:
    title = str(projection_entry.role_metadata.get("notice_title") or "").strip()
    campus_scope = "fengtai" if "丰台" in text else ("haidian" if "海淀" in text else "")
    if "自习室" in text:
        suffix = f":{campus_scope}" if campus_scope else ""
        display = f"{'丰台校区' if campus_scope == 'fengtai' else '海淀校区' if campus_scope == 'haidian' else ''}公共自习室"
        return {
            "subject_id": f"facility:self-study-room{suffix}",
            "display_name": display or "公共自习室",
            "aliases": ("自习室", "公共自习室", title),
            "campus_scope": campus_scope,
        }
    if "体育馆" in text:
        return {
            "subject_id": f"facility:gymnasium:{campus_scope or 'unspecified'}",
            "display_name": "体育馆",
            "aliases": ("体育馆", "场馆", title),
            "campus_scope": campus_scope,
        }
    if "静园10号楼" in text and "浴室" in text:
        return {
            "subject_id": "facility:bathroom:jingyuan-10",
            "display_name": "静园10号楼负一层女浴室",
            "aliases": ("静园10号楼女浴室", "女浴室", "浴室", title),
            "campus_scope": "haidian",
        }
    if "浴室" in text:
        return {
            "subject_id": f"facility:bathroom:{campus_scope or 'unspecified'}",
            "display_name": f"{'丰台校区' if campus_scope == 'fengtai' else '海淀校区' if campus_scope == 'haidian' else ''}浴室"
            or "浴室",
            "aliases": ("浴室", title),
            "campus_scope": campus_scope,
        }
    return {
        "subject_id": f"facility:notice:{projection_entry.source_notice_id}",
        "display_name": title or f"通知 {projection_entry.source_notice_id} 涉及设施",
        "aliases": (title,) if title else (),
        "campus_scope": campus_scope,
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
    month_colon_match = _MONTH_COLON_DAY_RE.search(text)
    if month_colon_match is not None:
        return _yearless_date(
            int(month_colon_match.group(1)),
            int(month_colon_match.group(2)),
            release_dt,
        )
    return release_dt.date()


def _resolve_restore_date(text: str, release_dt: datetime) -> date | None:
    match = _RESTORE_YEARLESS_DATE_RE.search(text)
    if match is None:
        return None
    return _yearless_date(int(match.group(1)), int(match.group(2)), release_dt)


def _resolve_datetime_window(text: str, release_dt: datetime) -> tuple[datetime, datetime] | None:
    full = _FULL_DATETIME_RANGE_RE.search(text)
    if full is not None:
        start = datetime(
            int(full.group(1)),
            int(full.group(2)),
            int(full.group(3)),
            int(full.group(4)),
            int(full.group(5)),
            tzinfo=_SHANGHAI_TZ,
        )
        end = datetime(
            int(full.group(6)),
            int(full.group(7)),
            int(full.group(8)),
            int(full.group(9)),
            int(full.group(10)),
            tzinfo=_SHANGHAI_TZ,
        )
        return (start, end) if end > start else None
    full_to_yearless = _FULL_TO_YEARLESS_DATETIME_RANGE_RE.search(text)
    if full_to_yearless is not None:
        start = datetime(
            int(full_to_yearless.group(1)),
            int(full_to_yearless.group(2)),
            int(full_to_yearless.group(3)),
            int(full_to_yearless.group(4)),
            int(full_to_yearless.group(5)),
            tzinfo=_SHANGHAI_TZ,
        )
        end_date = date(
            start.year,
            int(full_to_yearless.group(6)),
            int(full_to_yearless.group(7)),
        )
        if end_date < start.date():
            end_date = date(start.year + 1, end_date.month, end_date.day)
        end = datetime.combine(
            end_date,
            time(int(full_to_yearless.group(8)), int(full_to_yearless.group(9))),
            _SHANGHAI_TZ,
        )
        return (start, end) if end > start else None
    yearless = _YEARLESS_DATE_RANGE_WITH_TIME_RE.search(text)
    if yearless is not None:
        start_date = _yearless_date(int(yearless.group(1)), int(yearless.group(2)), release_dt)
        end_date = _yearless_date(int(yearless.group(3)), int(yearless.group(4)), release_dt)
        start = datetime.combine(
            start_date,
            time(int(yearless.group(5)), int(yearless.group(6))),
            _SHANGHAI_TZ,
        )
        end = datetime.combine(
            end_date,
            time(int(yearless.group(7)), int(yearless.group(8))),
            _SHANGHAI_TZ,
        )
        return (start, end) if end > start else None
    full_to_yearless_date = _FULL_TO_YEARLESS_DATE_RANGE_RE.search(text)
    if full_to_yearless_date is not None:
        start_date = date(
            int(full_to_yearless_date.group(1)),
            int(full_to_yearless_date.group(2)),
            int(full_to_yearless_date.group(3)),
        )
        end_date = date(
            start_date.year,
            int(full_to_yearless_date.group(4)),
            int(full_to_yearless_date.group(5)),
        )
        if end_date < start_date:
            end_date = date(start_date.year + 1, end_date.month, end_date.day)
        return _start_of_day(start_date), _start_of_day(end_date + timedelta(days=1))
    same_month_day_range = _YEARLESS_SAME_MONTH_DAY_RANGE_RE.search(text)
    if same_month_day_range is not None:
        start_date = _yearless_date(
            int(same_month_day_range.group(1)),
            int(same_month_day_range.group(2)),
            release_dt,
        )
        end_date = _yearless_date(
            int(same_month_day_range.group(1)),
            int(same_month_day_range.group(3)),
            release_dt,
        )
        return _start_of_day(start_date), _start_of_day(end_date + timedelta(days=1))
    yearless_date_range = _YEARLESS_DATE_RANGE_RE.search(text)
    if yearless_date_range is not None:
        start_date = _yearless_date(
            int(yearless_date_range.group(1)),
            int(yearless_date_range.group(2)),
            release_dt,
        )
        end_date = _yearless_date(
            int(yearless_date_range.group(3)),
            int(yearless_date_range.group(4)),
            release_dt,
        )
        return _start_of_day(start_date), _start_of_day(end_date + timedelta(days=1))
    restore = _resolve_restore_date(text, release_dt)
    if restore is not None:
        start_date = _resolve_effective_date_before_restore(text, release_dt)
        start = _start_of_day(start_date)
        end = _start_of_day(restore)
        return (start, end) if end > start else None
    if any(keyword in text for keyword in ("暂停办理", "暂停服务", "暂停开放", "暂停访问")):
        start = _start_of_day(_resolve_effective_date(text, release_dt))
        return start, start + timedelta(days=1)
    return None


def _resolve_service_counter_window(
    text: str, release_dt: datetime
) -> tuple[datetime, datetime] | None:
    restore = _resolve_restore_date(text, release_dt)
    if restore is not None:
        start_date = _resolve_effective_date_before_restore(text, release_dt)
        start_time, _ = _first_time_range(text) or (time.min, time.min)
        return datetime.combine(start_date, start_time, _SHANGHAI_TZ), _start_of_day(restore)
    if any(keyword in text for keyword in ("寒假", "暑假", "值班安排")):
        date_only_window = _resolve_date_only_window(text, release_dt)
        if date_only_window is not None:
            return date_only_window
    explicit_window = _resolve_datetime_window(text, release_dt)
    if explicit_window is not None:
        return explicit_window
    if any(keyword in text for keyword in ("增开", "正式开诊", "开诊时间")):
        start = _start_of_day(_resolve_effective_date(text, release_dt))
        if start.date() != release_dt.date() or any(
            keyword in text for keyword in ("自", "起", "开诊时间")
        ):
            return start, datetime(2099, 12, 31, 23, 59, 59, tzinfo=_SHANGHAI_TZ)
    return None


def _first_time_range(text: str) -> tuple[time, time] | None:
    match = _TIME_RANGE_RE.search(text)
    if match is None:
        return None
    start = time(int(match.group(1)), int(match.group(2)))
    end = time(int(match.group(3)), int(match.group(4)))
    return start, end


def _resolve_date_only_window(text: str, release_dt: datetime) -> tuple[datetime, datetime] | None:
    full_to_yearless_date = _FULL_TO_YEARLESS_DATE_RANGE_RE.search(text)
    if full_to_yearless_date is not None:
        start_date = date(
            int(full_to_yearless_date.group(1)),
            int(full_to_yearless_date.group(2)),
            int(full_to_yearless_date.group(3)),
        )
        end_date = date(
            start_date.year,
            int(full_to_yearless_date.group(4)),
            int(full_to_yearless_date.group(5)),
        )
        if end_date < start_date:
            end_date = date(start_date.year + 1, end_date.month, end_date.day)
        return _start_of_day(start_date), _start_of_day(end_date + timedelta(days=1))
    same_month_day_range = _YEARLESS_SAME_MONTH_DAY_RANGE_RE.search(text)
    if same_month_day_range is not None:
        start_date = _yearless_date(
            int(same_month_day_range.group(1)),
            int(same_month_day_range.group(2)),
            release_dt,
        )
        end_date = _yearless_date(
            int(same_month_day_range.group(1)),
            int(same_month_day_range.group(3)),
            release_dt,
        )
        return _start_of_day(start_date), _start_of_day(end_date + timedelta(days=1))
    yearless_date_range = _YEARLESS_DATE_RANGE_RE.search(text)
    if yearless_date_range is None:
        return None
    start_date = _yearless_date(
        int(yearless_date_range.group(1)),
        int(yearless_date_range.group(2)),
        release_dt,
    )
    end_date = _yearless_date(
        int(yearless_date_range.group(3)),
        int(yearless_date_range.group(4)),
        release_dt,
    )
    return _start_of_day(start_date), _start_of_day(end_date + timedelta(days=1))


def _yearless_date(month: int, day: int, release_dt: datetime) -> date:
    candidate = date(release_dt.year, month, day)
    if candidate < release_dt.date() - timedelta(days=180):
        candidate = date(release_dt.year + 1, month, day)
    return candidate


def _resolve_effective_date_before_restore(text: str, release_dt: datetime) -> date:
    restore_match = _RESTORE_YEARLESS_DATE_RE.search(text)
    prefix = text[: restore_match.start()] if restore_match is not None else text
    first_match = _YEARLESS_DATE_RE.search(prefix)
    if first_match is not None:
        return _yearless_date(int(first_match.group(1)), int(first_match.group(2)), release_dt)
    month_colon_match = _MONTH_COLON_DAY_RE.search(prefix)
    if month_colon_match is not None:
        return _yearless_date(
            int(month_colon_match.group(1)),
            int(month_colon_match.group(2)),
            release_dt,
        )
    return _resolve_effective_date(text, release_dt)


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
    effective_until = _parse_datetime(candidate.effective_until, "effective_until")
    return generated_dt < effective_until


def _status_note(text: str) -> str:
    for segment in _SEGMENT_SPLIT_RE.split(text):
        cleaned = _clean_status_note_segment(segment)
        if not cleaned:
            continue
        if _is_status_note_title_segment(cleaned):
            continue
        if _looks_like_status_segment(cleaned):
            return cleaned
    return _clean_status_note_segment(text[:240])


def _clean_status_note_segment(value: object) -> str:
    return _MARKDOWN_HEADING_RE.sub("", _clean_text(value)).strip()


def _is_status_note_title_segment(text: str) -> bool:
    return text.startswith("关于") and text.endswith(("通知", "公告", "安排"))


def _looks_like_status_segment(text: str) -> bool:
    return (
        _contains_boarding_point_change(text)
        or _contains_suspension(text)
        or any(
            keyword in text
            for keyword in (
                "暂停访问",
                "暂停使用",
                "暂停办理",
                "暂停服务",
                "暂停开放",
                "升级维护",
                "关闭",
                "闭馆",
                "开馆",
                "停止使用",
                "正常开放",
                "正常使用",
                "开放时间",
                "临时关闭",
                "试运行",
                "恢复办理",
                "恢复开放",
                "放假期间",
                "服务日期",
                "服务时间",
                "门诊时间",
                "开诊时间",
                "值班安排",
                "增开",
            )
        )
    )


def _service_counter_relevant_text(text: str) -> str:
    text = _clean_text(_text_without_leading_markdown_title(text))
    service_hall_starts = [
        text.rfind(marker)
        for marker in ("综合服务大厅", "一站式服务中心")
        if text.rfind(marker) >= 0
    ]
    if service_hall_starts:
        start = max(service_hall_starts)
    else:
        hospital_start = text.find("校医院")
        if hospital_start < 0:
            return text
        start = 0
    tail = text[start:]
    end_markers = ("特此通知", "如有特殊情况", "中央民族大学校医院", "校医院 2026", "后勤保障处")
    ends = [tail.find(marker) for marker in end_markers if tail.find(marker) > 0]
    if ends:
        tail = tail[: min(ends)]
    return tail


def _text_without_leading_markdown_title(value: object) -> str:
    lines = str(value or "").splitlines()
    while lines and not lines[0].strip():
        lines = lines[1:]
    if lines and _MARKDOWN_HEADING_RE.match(lines[0].strip()):
        return "\n".join(lines[1:]).strip()
    return str(value or "")


def _rejected_source(entry: NoticeConsumptionProjectionEntry) -> dict[str, Any]:
    metadata = dict(entry.role_metadata or {})
    return {
        "schema_version": "service_status_rejected_sources.v1",
        "source_notice_id": entry.source_notice_id,
        "source_ref": _source_ref(entry),
        "notice_family": str(metadata.get("notice_family") or "").strip(),
        "candidate_kind": str(
            metadata.get("service_status_candidate_kind") or "service_status"
        ).strip(),
        "reason": "missing_effective_window_or_status_signal",
        "missing_fields": ["effective_window_or_status_signal"],
        "extracted_signals": {
            "notice_title": str(metadata.get("notice_title") or "").strip(),
        },
    }


def _source_ref(entry: NoticeConsumptionProjectionEntry) -> str:
    return f"notice:muc_internal_portal:{entry.source_notice_id}"


def _clean_text(value: object) -> str:
    return _SPACE_RE.sub(" ", str(value or "").strip())


__all__ = [
    "build_notice_derived_service_status_projection_bundle",
    "extract_notice_derived_service_status_record",
]
