from __future__ import annotations

import re
from collections.abc import Sequence
from datetime import datetime, timedelta, timezone
from typing import Protocol

from campus_ingestion_core.models import DocumentRegistryRecord
from campus_ingestion_core.notice_consumption_projection import (
    NOTICE_CONSUMPTION_STATUS_READY_FOR_TARGET,
    NOTICE_TARGET_SURFACE_SPECIAL_SERVICE_CANDIDATE,
    NoticeConsumptionProjectionEntry,
)
from campus_ingestion_core.notice_derived_transport_schedule_support import (
    reservation_open_time_segment,
)
from campus_ingestion_core.registry import DocumentRegistry
from campus_ingestion_core.service_guide_projection_constants import (
    NOTICE_DERIVED_SERVICE_GUIDE_SOURCE_FAMILY,
    SERVICE_GUIDE_PROJECTION_SCHEMA_VERSION,
)
from campus_ingestion_core.service_guide_projection_models import (
    ServiceGuideProjectionBuildResult,
)
from campus_ingestion_core.service_guide_projection_validation import (
    validate_service_guide_projection_bundle,
)

_SHANGHAI_TZ = timezone(timedelta(hours=8))
_DEFAULT_EFFECTIVE_UNTIL = "2099-12-31T23:59:59+08:00"
_TIME_RE = re.compile(r"(?<!\d)([01]?\d|2[0-3])[:：]([0-5]\d)(?!\d)")
_SENTENCE_SPLIT_RE = re.compile(r"[\n。；;]")
_MARKDOWN_HEADING_RE = re.compile(r"^\s{0,3}#{1,6}\s*")


class NoticeDerivedServiceGuideObjectStore(Protocol):
    def get_bytes(self, *, bucket: str, key: str) -> bytes: ...


def build_notice_derived_service_guide_projection_bundle(
    *,
    projection_entries: Sequence[NoticeConsumptionProjectionEntry],
    registry: DocumentRegistry,
    object_store: NoticeDerivedServiceGuideObjectStore,
    derived_bucket: str,
    generated_at: str,
) -> ServiceGuideProjectionBuildResult:
    _parse_datetime(generated_at, field_name="generated_at")
    records: list[dict[str, object]] = []
    for entry in projection_entries:
        if not _is_ready_transport_reservation_candidate(entry):
            continue
        parent_record = _resolve_registry_record(
            registry=registry,
            document_id=entry.source_notice_document_id,
        )
        body = _read_record_text(
            record=parent_record,
            object_store=object_store,
            derived_bucket=derived_bucket,
        )
        if not _contains_transport_reservation_instruction(body):
            continue
        records.append(
            _build_transport_reservation_record(
                entry=entry,
                body=body,
                generated_at=generated_at,
            )
        )

    ready_records = _latest_records_by_service_id(records)
    bundle = {
        "schema_version": SERVICE_GUIDE_PROJECTION_SCHEMA_VERSION,
        "generated_at": generated_at,
        "source_families": [NOTICE_DERIVED_SERVICE_GUIDE_SOURCE_FAMILY],
        "service_guide_records": ready_records,
        "conflict_records": [],
        "manual_review_sources": [],
    }
    validation_report = validate_service_guide_projection_bundle(bundle)
    return ServiceGuideProjectionBuildResult(
        bundle=bundle,
        validation_report=validation_report,
        manual_review_sources=[],
    )


def _is_ready_transport_reservation_candidate(entry: NoticeConsumptionProjectionEntry) -> bool:
    return (
        entry.target_surface == NOTICE_TARGET_SURFACE_SPECIAL_SERVICE_CANDIDATE
        and entry.consumption_status == NOTICE_CONSUMPTION_STATUS_READY_FOR_TARGET
        and str(entry.role_metadata.get("special_service_candidate_kind") or "")
        == "transport_reservation_instruction"
    )


def _resolve_registry_record(
    *,
    registry: DocumentRegistry,
    document_id: str,
) -> DocumentRegistryRecord | None:
    record = registry.current_version(
        document_id,
        preferred_revision_tracks=("source-faithful",),
    )
    if record is not None:
        return record
    versions = registry.list_versions(document_id, revision_track="source-faithful")
    if versions:
        return versions[0]
    versions = registry.list_versions(document_id)
    return versions[0] if versions else None


def _read_record_text(
    *,
    record: DocumentRegistryRecord | None,
    object_store: NoticeDerivedServiceGuideObjectStore,
    derived_bucket: str,
) -> str:
    if record is None or not record.canonical_markdown_object_key:
        return ""
    try:
        return object_store.get_bytes(
            bucket=derived_bucket,
            key=record.canonical_markdown_object_key,
        ).decode("utf-8")
    except Exception:
        return ""


def _contains_transport_reservation_instruction(body: str) -> bool:
    compact = "".join(str(body or "").split())
    if "预约" not in compact:
        return False
    if not any(keyword in compact for keyword in ("接驳车", "班车", "校车", "通勤车")):
        return False
    return any(keyword in compact for keyword in ("开放预约", "释放", "可预约资源", "预约系统"))


def _build_transport_reservation_record(
    *,
    entry: NoticeConsumptionProjectionEntry,
    body: str,
    generated_at: str,
) -> dict[str, object]:
    source_ref = _source_ref(entry)
    identity = _resolve_transport_reservation_identity(entry=entry, body=body)
    effective_from = _effective_from(entry.source_notice_release_time, generated_at)
    open_segment = _reservation_open_segment(body)
    open_time = _extract_time(open_segment)
    day_pattern = _open_day_pattern(open_segment)
    entry_labels = _entry_labels(body)
    constraint_text = _constraint_text(body)
    procedure_lines = _procedure_lines(
        entry_labels=entry_labels,
        open_segment=open_segment,
        constraint_text=constraint_text,
    )
    guide_sections = [
        {
            "section_id": f"{identity['service_id']}:section:overview",
            "section_type": "overview",
            "title": f"{identity['display_name']}概览",
            "content": f"{identity['display_name']}用于说明通知中的预约入口、开放时间和使用约束。",
            "order": 1,
            "source_refs": [source_ref],
        },
        {
            "section_id": f"{identity['service_id']}:section:procedure",
            "section_type": "procedure",
            "title": f"{identity['display_name'].removesuffix('说明')}流程",
            "content": "\n".join(procedure_lines),
            "order": 2,
            "source_refs": [source_ref],
        },
    ]
    if entry_labels:
        guide_sections.append(
            {
                "section_id": f"{identity['service_id']}:section:entry",
                "section_type": "entry",
                "title": "预约入口",
                "content": "、".join(entry_labels),
                "order": 3,
                "source_refs": [source_ref],
            }
        )
    office_hours = []
    if open_segment and open_time:
        guide_sections.append(
            {
                "section_id": f"{identity['service_id']}:section:office-hours",
                "section_type": "office_hours",
                "title": "预约开放时间",
                "content": open_segment,
                "order": 4,
                "source_refs": [source_ref],
            }
        )
        office_hours.append(
            {
                "hours_id": f"{identity['service_id']}:hours:reservation-open",
                "label": "预约开放时间",
                "day_pattern": day_pattern,
                "time_range": open_time,
                "effective_note": open_segment,
                "source_refs": [source_ref],
            }
        )
    return {
        "service_id": identity["service_id"],
        "display_name": identity["display_name"],
        "aliases": identity["aliases"],
        "category": "transport_reservation",
        "campus_scope": _campus_scope(body),
        "audience": _audience(body),
        "effective_from": effective_from,
        "effective_until": _DEFAULT_EFFECTIVE_UNTIL,
        "source_refs": [source_ref],
        "guide_sections": guide_sections,
        "materials": [],
        "entry_refs": [
            {
                "entry_id": f"{identity['service_id']}:entry:{_slug(label)}",
                "label": label,
                "entry_type": "instructions_only",
                "url": "",
                "location_ref": "",
                "source_refs": [source_ref],
            }
            for label in entry_labels
        ],
        "office_hours": office_hours,
        "contact_refs": [],
        "eligibility_notes": [],
        "extraction_status": "ready",
    }


def _resolve_transport_reservation_identity(
    *,
    entry: NoticeConsumptionProjectionEntry,
    body: str,
) -> dict[str, object]:
    metadata = dict(entry.role_metadata or {})
    title = str(metadata.get("notice_title") or "")
    compact = "".join(f"{title}\n{body}".split())
    if "接驳车" in compact or "地铁" in compact:
        return {
            "service_id": "service:transport-reservation:subway-shuttle",
            "display_name": "地铁接驳车预约说明",
            "aliases": [
                "地铁接驳车预约说明",
                "地铁接驳车预约",
                "接驳车预约",
                "接驳车预约系统",
            ],
        }
    if any(keyword in compact for keyword in ("通勤班车", "两校区", "班车", "校车")):
        return {
            "service_id": "service:transport-reservation:commute-bus",
            "display_name": "通勤班车预约说明",
            "aliases": [
                "通勤班车预约说明",
                "通勤班车预约",
                "校车预约",
                "班车预约",
            ],
        }
    return {
        "service_id": f"service:transport-reservation:temporary-special-shuttle:{entry.source_notice_id}",
        "display_name": "临时班车预约说明",
        "aliases": ["临时班车预约说明", "临时班车预约"],
    }


def _source_ref(entry: NoticeConsumptionProjectionEntry) -> str:
    if entry.source_notice_document_id.startswith("notice:"):
        return entry.source_notice_document_id
    return f"notice:muc_internal_portal:{entry.source_notice_id}"


def _effective_from(value: str | None, generated_at: str) -> str:
    text = str(value or "").strip()
    if not text:
        return generated_at
    try:
        parsed = datetime.fromisoformat(text.replace(" ", "T"))
    except ValueError:
        return generated_at
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=_SHANGHAI_TZ)
    return parsed.isoformat(timespec="seconds")


def _reservation_open_segment(body: str) -> str:
    for segment in _sentences(body):
        if reservation_open_time_segment("".join(segment.split())):
            return segment
    return ""


def _sentences(body: str) -> tuple[str, ...]:
    normalized = str(body or "").replace("：", ":")
    sentences: list[str] = []
    for raw_line in _SENTENCE_SPLIT_RE.split(normalized):
        line = _MARKDOWN_HEADING_RE.sub("", raw_line).strip()
        line = line.strip(" -　\t\r")
        if line:
            sentences.append(line)
    return tuple(sentences)


def _extract_time(segment: str) -> str:
    match = _TIME_RE.search(segment)
    if match is None:
        return ""
    return f"{int(match.group(1)):02d}:{match.group(2)}"


def _open_day_pattern(segment: str) -> str:
    compact = "".join(segment.split())
    if "发车前一天" in compact:
        return "发车前一天"
    if "前一天" in compact:
        return "前一天"
    if "当天" in compact:
        return "当天"
    return ""


def _entry_labels(body: str) -> list[str]:
    labels: list[str] = []
    for label in ("服务门户", "企业微信", "民大通", "接驳车预约系统"):
        if label in body and label not in labels:
            labels.append(label)
    return labels


def _constraint_text(body: str) -> str:
    constraints: list[str] = []
    for keyword in ("约满即止", "取消预约", "扫码签到", "提前到达"):
        if keyword in body and keyword not in constraints:
            constraints.append(keyword)
    return "、".join(constraints)


def _procedure_lines(
    *,
    entry_labels: Sequence[str],
    open_segment: str,
    constraint_text: str,
) -> list[str]:
    lines: list[str] = []
    if entry_labels:
        lines.append(f"{len(lines) + 1}. 通过{'、'.join(entry_labels)}进入预约入口。")
    if open_segment:
        lines.append(f"{len(lines) + 1}. {open_segment}")
    if constraint_text:
        lines.append(f"{len(lines) + 1}. 遵守通知约束：{constraint_text}。")
    if not lines:
        lines.append("1. 按通知中的预约说明办理。")
    return lines


def _campus_scope(body: str) -> str:
    if "丰台" in body and "海淀" not in body:
        return "fengtai"
    if "海淀" in body and "丰台" not in body:
        return "haidian"
    return "all"


def _audience(body: str) -> list[str]:
    values: list[str] = []
    if any(keyword in body for keyword in ("学生", "同学")):
        values.append("student")
    if any(keyword in body for keyword in ("教师", "教职工", "老师")):
        values.append("faculty")
    if "师生" in body:
        values.extend(["student", "faculty"])
    if not values:
        values.extend(["student", "faculty", "unknown"])
    return list(dict.fromkeys(values))


def _latest_records_by_service_id(records: Sequence[dict[str, object]]) -> list[dict[str, object]]:
    by_service_id: dict[str, dict[str, object]] = {}
    for record in records:
        service_id = str(record.get("service_id") or "")
        current = by_service_id.get(service_id)
        if current is None or _record_sort_key(record) >= _record_sort_key(current):
            by_service_id[service_id] = dict(record)
    return [
        by_service_id[service_id]
        for service_id in sorted(
            by_service_id, key=lambda item: str(by_service_id[item]["source_refs"][0])
        )
    ]


def _record_sort_key(record: dict[str, object]) -> tuple[datetime, str]:
    source_refs = record.get("source_refs")
    source_ref = ""
    if isinstance(source_refs, list) and source_refs:
        source_ref = str(source_refs[0])
    return (
        _parse_datetime(str(record.get("effective_from") or ""), field_name="effective_from"),
        source_ref,
    )


def _parse_datetime(value: str, *, field_name: str) -> datetime:
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError as exc:
        raise ValueError(f"{field_name} must be RFC3339 datetime") from exc
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=_SHANGHAI_TZ)
    return parsed


def _slug(value: str) -> str:
    mapping = {
        "服务门户": "service-portal",
        "企业微信": "enterprise-wechat",
        "民大通": "min-da-tong",
        "接驳车预约系统": "shuttle-reservation-system",
    }
    return mapping.get(value, re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-") or "entry")


__all__ = [
    "NoticeDerivedServiceGuideObjectStore",
    "build_notice_derived_service_guide_projection_bundle",
]
