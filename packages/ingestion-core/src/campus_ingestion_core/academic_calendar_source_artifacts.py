from __future__ import annotations

import hashlib
import json
from datetime import UTC, datetime, timedelta
from typing import Any

OFFICIAL_WEB_CURATED_ACADEMIC_CALENDAR_SCHEMA_VERSION = "official_web_curated_academic_calendar.v1"
AUTHENTICATED_NOTICE_CALENDAR_ARRANGEMENT_SCHEMA_VERSION = (
    "authenticated_notice_calendar_arrangement.v1"
)
OFFICIAL_WEB_CURATED_ACADEMIC_CALENDAR_SOURCE_FAMILY = "official_web_curated_academic_calendar_v1"
AUTHENTICATED_NOTICE_CALENDAR_ARRANGEMENT_SOURCE_FAMILY = (
    "authenticated_notice_calendar_arrangement_v1"
)


def build_curated_academic_calendar_projection_bundle_payload(
    *,
    curated_source_truth_artifact: dict[str, Any],
    generated_at: str,
    projection_schema_version: str,
) -> dict[str, Any]:
    _parse_rfc3339(generated_at, "generated_at")
    artifact = _require_mapping(
        curated_source_truth_artifact,
        "curated_source_truth_artifact",
    )
    schema_version = str(artifact.get("schemaVersion") or "").strip()
    if schema_version != OFFICIAL_WEB_CURATED_ACADEMIC_CALENDAR_SCHEMA_VERSION:
        raise ValueError(f"unsupported curated academic calendar schemaVersion: {schema_version!r}")
    if not _required_text(artifact.get("projectionName")):
        raise ValueError("curated academic calendar projectionName is required")
    document_data = _require_mapping(artifact.get("documentData"), "documentData")
    records = _coerce_curated_academic_calendar_records(document_data)
    records = _with_derived_term_window_records(records)
    records.sort(
        key=lambda item: (
            str(item.get("academic_year_label") or ""),
            str(item.get("term_label") or ""),
            str(item.get("start_date") or ""),
            str(item.get("record_family") or ""),
            str(item.get("day_kind") or ""),
        )
    )
    return {
        "schema_version": projection_schema_version,
        "generated_at": generated_at,
        "source_families": [OFFICIAL_WEB_CURATED_ACADEMIC_CALENDAR_SOURCE_FAMILY],
        "source_documents": [
            {
                "title": _required_text(document_data.get("title")) or "academic calendar",
                "source_refs": _string_list(document_data.get("sourceRefs")),
            }
        ],
        "academic_calendar_records": records,
        "manual_review_sources": [],
    }


def build_notice_arrangement_projection_bundle_payload(
    *,
    notice_arrangement_artifact: dict[str, Any],
    generated_at: str,
    projection_schema_version: str,
) -> dict[str, Any]:
    _parse_rfc3339(generated_at, "generated_at")
    artifact = _require_mapping(
        notice_arrangement_artifact,
        "notice_arrangement_artifact",
    )
    schema_version = _required_text(artifact.get("schemaVersion"))
    if schema_version != AUTHENTICATED_NOTICE_CALENDAR_ARRANGEMENT_SCHEMA_VERSION:
        raise ValueError(
            f"unsupported notice calendar arrangement schemaVersion: {schema_version!r}"
        )
    document_data = _require_mapping(artifact.get("documentData"), "documentData")
    if _required_text(document_data.get("extractionStatus")) != "ready":
        raise ValueError("notice calendar arrangement extractionStatus must be ready")
    if bool(document_data.get("manualReviewRequired")):
        raise ValueError("notice calendar arrangement no longer supports manual review")
    if _string_list(document_data.get("manualReviewNotes")):
        raise ValueError("notice calendar arrangement no longer supports manual review notes")
    records = _coerce_notice_calendar_arrangement_records(document_data)
    records.sort(key=academic_calendar_record_sort_key)
    source_documents = _list_of_dicts(document_data.get("sourceDocuments"))
    return {
        "schema_version": projection_schema_version,
        "generated_at": generated_at,
        "source_families": [AUTHENTICATED_NOTICE_CALENDAR_ARRANGEMENT_SOURCE_FAMILY],
        "source_documents": source_documents,
        "academic_calendar_records": records,
        "manual_review_sources": [],
    }


def reconciled_academic_calendar_records(records: list[dict[str, Any]]) -> list[dict[str, Any]]:
    winners: dict[tuple[str, str], dict[str, Any]] = {}
    for record in records:
        if _required_text(record.get("record_family")) != "normal_rest_day":
            continue
        if _required_text(record.get("source_family")) != (
            AUTHENTICATED_NOTICE_CALENDAR_ARRANGEMENT_SOURCE_FAMILY
        ):
            continue
        for day in _date_range_days(
            _required_text(record.get("start_date")),
            _required_text(record.get("end_date")),
        ):
            key = (_required_text(record.get("academic_year_label")), day)
            if source_precedence(record) >= source_precedence(winners.get(key)):
                winners[key] = record
    if not winners:
        return records
    return [record for record in records if not _is_overridden_baseline_class_day(record, winners)]


def source_precedence(record: dict[str, Any] | None) -> int:
    if not record:
        return -1
    value = record.get("source_precedence")
    return value if isinstance(value, int) else -1


def academic_calendar_record_sort_key(
    item: dict[str, Any],
) -> tuple[str, str, str, int, str, str]:
    return (
        str(item.get("academic_year_label") or ""),
        str(item.get("term_label") or ""),
        str(item.get("start_date") or ""),
        -source_precedence(item),
        str(item.get("record_family") or ""),
        str(item.get("day_kind") or ""),
    )


def _coerce_curated_academic_calendar_records(
    document_data: dict[str, Any],
) -> list[dict[str, Any]]:
    payload = _require_mapping(document_data, "documentData")
    if _required_text(payload.get("extractionStatus")) != "ready":
        raise ValueError("curated academic calendar extractionStatus must be ready")
    if bool(payload.get("manualReviewRequired")):
        raise ValueError("curated academic calendar no longer supports manual review")
    if _string_list(payload.get("manualReviewNotes")):
        raise ValueError("curated academic calendar no longer supports manual review notes")
    default_source_refs = _string_list(payload.get("sourceRefs"))
    if not default_source_refs:
        raise ValueError("curated academic calendar sourceRefs is required")
    source_title = _required_text(payload.get("title")) or "academic calendar"
    source_url = default_source_refs[0]
    records: list[dict[str, Any]] = []
    for index, raw_record in enumerate(_list_of_dicts(payload.get("records"))):
        notes = _string_list(raw_record.get("manualReviewNotes"))
        if notes:
            raise ValueError("curated academic calendar record no longer supports manual review")
        records.append(
            _curated_academic_calendar_record(
                raw_record,
                default_source_refs=default_source_refs,
                source_title=source_title,
                source_url=source_url,
                index=index,
            )
        )
    if not records:
        raise ValueError("curated academic calendar documentData.records has no usable records")
    return records


def _curated_academic_calendar_record(
    raw_record: dict[str, Any],
    *,
    default_source_refs: list[str],
    source_title: str,
    source_url: str,
    index: int,
) -> dict[str, Any]:
    academic_year_label = _required_text(raw_record.get("academicYearLabel"))
    term_label = _required_text(raw_record.get("termLabel"))
    start_date = _required_text(raw_record.get("startDate"))
    end_date = _required_text(raw_record.get("endDate"))
    day_kind = _required_text(raw_record.get("dayKind"))
    for field_name, value in (
        ("academicYearLabel", academic_year_label),
        ("termLabel", term_label),
        ("startDate", start_date),
        ("endDate", end_date),
        ("dayKind", day_kind),
    ):
        if not value:
            raise ValueError(f"documentData.records[{index}].{field_name} is required")
    week_index = _non_negative_int(
        raw_record.get("weekIndex"),
        f"documentData.records[{index}].weekIndex",
    )
    is_makeup_class = raw_record.get("isMakeupClass")
    if not isinstance(is_makeup_class, bool):
        raise ValueError(f"documentData.records[{index}].isMakeupClass must be a boolean")
    source_refs = _string_list(raw_record.get("sourceRefs")) or default_source_refs
    if not source_refs:
        raise ValueError(f"documentData.records[{index}].sourceRefs is required")
    holiday_name = _required_text(raw_record.get("holidayName")) or ""
    class_day_pattern = _required_text(raw_record.get("classDayPattern")) or ""
    record_family = _record_family(
        day_kind=day_kind,
        is_makeup_class=is_makeup_class,
        holiday_name=holiday_name,
    )
    record = {
        "record_family": record_family,
        "source_family": OFFICIAL_WEB_CURATED_ACADEMIC_CALENDAR_SOURCE_FAMILY,
        "source_precedence": 10,
        "source_notice_ids": [],
        "precedence_reason": "",
        "conflict_refs": [],
        "event_name": "",
        "event_type": "",
        "event_aliases": [],
        "event_alias_types": {},
        "event_start_date": "",
        "event_end_date_exclusive": _next_date(end_date),
        "display_start_date": start_date,
        "display_end_date": end_date,
        "applies_to": ["all"],
        "source_title": source_title,
        "source_url": source_url,
    }
    if record_family == "named_event":
        record.update(
            {
                "event_name": holiday_name,
                "event_type": "holiday",
                "event_aliases": _event_aliases(holiday_name),
                "event_alias_types": {},
                "event_start_date": start_date,
            }
        )
    return {
        "calendar_record_id": _calendar_record_id(
            {
                "academic_year_label": academic_year_label,
                "term_label": term_label,
                "start_date": start_date,
                "end_date": end_date,
                "day_kind": day_kind,
                "week_index": week_index,
                "holiday_name": holiday_name,
                "class_day_pattern": class_day_pattern,
            }
        ),
        **record,
        "academic_year_label": academic_year_label,
        "term_label": term_label,
        "start_date": start_date,
        "end_date": end_date,
        "week_index": week_index,
        "day_kind": day_kind,
        "class_day_pattern": class_day_pattern,
        "is_makeup_class": is_makeup_class,
        "holiday_name": holiday_name,
        "source_refs": _unique_strings(source_refs),
    }


def _coerce_notice_calendar_arrangement_records(
    document_data: dict[str, Any],
) -> list[dict[str, Any]]:
    default_source_refs = _string_list(document_data.get("sourceRefs"))
    if not default_source_refs:
        raise ValueError("notice calendar arrangement sourceRefs is required")
    source_documents = _list_of_dicts(document_data.get("sourceDocuments"))
    if not source_documents:
        raise ValueError("notice calendar arrangement sourceDocuments is required")
    records: list[dict[str, Any]] = []
    for index, raw_record in enumerate(_list_of_dicts(document_data.get("records"))):
        records.append(
            _notice_calendar_arrangement_record(
                raw_record,
                default_source_refs=default_source_refs,
                default_source_documents=source_documents,
                index=index,
            )
        )
    if not records:
        raise ValueError("notice calendar arrangement documentData.records has no usable records")
    return records


def _notice_calendar_arrangement_record(
    raw_record: dict[str, Any],
    *,
    default_source_refs: list[str],
    default_source_documents: list[dict[str, Any]],
    index: int,
) -> dict[str, Any]:
    academic_year_label = _required_text(raw_record.get("academicYearLabel"))
    term_label = _required_text(raw_record.get("termLabel"))
    record_family = _required_text(raw_record.get("recordFamily"))
    start_date = _required_text(raw_record.get("startDate"))
    end_date = _required_text(raw_record.get("endDate"))
    day_kind = _required_text(raw_record.get("dayKind")) or record_family
    if record_family not in {
        "course_suspension",
        "normal_rest_day",
        "workday_makeup",
        "named_event",
    }:
        raise ValueError(
            f"notice calendar arrangement records[{index}].recordFamily is unsupported"
        )
    for field_name, value in (
        ("academicYearLabel", academic_year_label),
        ("termLabel", term_label),
        ("startDate", start_date),
        ("endDate", end_date),
        ("dayKind", day_kind),
    ):
        if not value:
            raise ValueError(
                f"notice calendar arrangement records[{index}].{field_name} is required"
            )
    source_notice_ids = _string_list(raw_record.get("sourceNoticeIds"))
    if not source_notice_ids:
        raise ValueError(
            f"notice calendar arrangement records[{index}].sourceNoticeIds is required"
        )
    source_refs = _string_list(raw_record.get("sourceRefs")) or default_source_refs
    source_title = _required_text(raw_record.get("sourceTitle")) or _source_documents_title(
        default_source_documents
    )
    source_url = _required_text(raw_record.get("sourceUrl")) or source_refs[0]
    return {
        "calendar_record_id": _calendar_record_id(
            {
                "source_family": AUTHENTICATED_NOTICE_CALENDAR_ARRANGEMENT_SOURCE_FAMILY,
                "source_notice_ids": source_notice_ids,
                "record_family": record_family,
                "start_date": start_date,
                "end_date": end_date,
                "day_kind": day_kind,
            }
        ),
        "record_family": record_family,
        "source_family": AUTHENTICATED_NOTICE_CALENDAR_ARRANGEMENT_SOURCE_FAMILY,
        "source_precedence": _source_precedence_for_notice_record(record_family),
        "source_notice_ids": source_notice_ids,
        "precedence_reason": _required_text(raw_record.get("precedenceReason")),
        "conflict_refs": _string_list(raw_record.get("conflictRefs")),
        "academic_year_label": academic_year_label,
        "term_label": term_label,
        "start_date": start_date,
        "end_date": end_date,
        "week_index": _non_negative_int(raw_record.get("weekIndex"), "weekIndex"),
        "day_kind": day_kind,
        "class_day_pattern": _required_text(raw_record.get("classDayPattern")),
        "is_makeup_class": bool(raw_record.get("isMakeupClass")),
        "holiday_name": _required_text(raw_record.get("holidayName")),
        "source_refs": _unique_strings(source_refs),
        "event_name": _required_text(raw_record.get("eventName")),
        "event_type": _required_text(raw_record.get("eventType")) or record_family,
        "event_aliases": _unique_strings(_string_list(raw_record.get("eventAliases"))),
        "event_alias_types": _string_mapping(raw_record.get("eventAliasTypes")),
        "event_start_date": _required_text(raw_record.get("eventStartDate")) or start_date,
        "event_end_date_exclusive": _required_text(raw_record.get("eventEndDateExclusive"))
        or _next_date(end_date),
        "display_start_date": _required_text(raw_record.get("displayStartDate")) or start_date,
        "display_end_date": _required_text(raw_record.get("displayEndDate")) or end_date,
        "applies_to": _string_list(raw_record.get("appliesTo")) or ["all"],
        "source_title": source_title,
        "source_url": source_url,
    }


def _with_derived_term_window_records(records: list[dict[str, Any]]) -> list[dict[str, Any]]:
    grouped: dict[tuple[str, str], list[dict[str, Any]]] = {}
    for record in records:
        if record.get("record_family") != "teaching_week":
            continue
        key = (
            _required_text(record.get("academic_year_label")),
            _required_text(record.get("term_label")),
        )
        if key[1] not in {"秋季学期", "春季学期"}:
            continue
        grouped.setdefault(key, []).append(record)
    term_records: list[dict[str, Any]] = []
    for (academic_year_label, term_label), term_week_records in grouped.items():
        ordered = sorted(term_week_records, key=lambda item: str(item.get("start_date") or ""))
        first = ordered[0]
        last = max(ordered, key=lambda item: str(item.get("end_date") or ""))
        start_date = _required_text(first.get("start_date"))
        end_date = _required_text(last.get("end_date"))
        source_refs = _unique_strings(
            [ref for record in ordered for ref in _string_list(record.get("source_refs"))]
        )
        term_records.append(
            {
                "calendar_record_id": _calendar_record_id(
                    {
                        "academic_year_label": academic_year_label,
                        "term_label": term_label,
                        "record_family": "term_window",
                        "start_date": start_date,
                        "end_date": end_date,
                    }
                ),
                "record_family": "term_window",
                "source_family": OFFICIAL_WEB_CURATED_ACADEMIC_CALENDAR_SOURCE_FAMILY,
                "source_precedence": 10,
                "source_notice_ids": [],
                "precedence_reason": "",
                "conflict_refs": [],
                "academic_year_label": academic_year_label,
                "term_label": term_label,
                "start_date": start_date,
                "end_date": end_date,
                "week_index": 0,
                "day_kind": "term_window",
                "class_day_pattern": "",
                "is_makeup_class": False,
                "holiday_name": "",
                "source_refs": source_refs,
                "event_name": term_label,
                "event_type": "term_window",
                "event_aliases": [term_label, "本学期"],
                "event_alias_types": {},
                "event_start_date": start_date,
                "event_end_date_exclusive": _next_date(end_date),
                "display_start_date": start_date,
                "display_end_date": end_date,
                "applies_to": ["all"],
                "source_title": _required_text(first.get("source_title")),
                "source_url": _required_text(first.get("source_url")),
            }
        )
    return [*records, *term_records]


def _is_overridden_baseline_class_day(
    record: dict[str, Any],
    winners: dict[tuple[str, str], dict[str, Any]],
) -> bool:
    if _required_text(record.get("source_family")) != (
        OFFICIAL_WEB_CURATED_ACADEMIC_CALENDAR_SOURCE_FAMILY
    ):
        return False
    if _required_text(record.get("record_family")) != "class_day_override":
        return False
    if _required_text(record.get("day_kind")) != "makeup_class_day":
        return False
    for day in _date_range_days(
        _required_text(record.get("start_date")),
        _required_text(record.get("end_date")),
    ):
        winning_record = winners.get((_required_text(record.get("academic_year_label")), day))
        if winning_record and source_precedence(winning_record) > source_precedence(record):
            return True
    return False


def _source_documents_title(source_documents: list[dict[str, Any]]) -> str:
    titles = [title for item in source_documents if (title := _required_text(item.get("title")))]
    return "；".join(titles)


def _source_precedence_for_notice_record(record_family: str) -> int:
    if record_family in {"normal_rest_day", "workday_makeup"}:
        return 90
    return 80


def _record_family(
    *,
    day_kind: str,
    is_makeup_class: bool,
    holiday_name: str,
) -> str:
    if is_makeup_class or day_kind == "makeup_class_day":
        return "class_day_override"
    if holiday_name or day_kind == "holiday":
        return "named_event"
    return "teaching_week"


def _event_aliases(event_name: str) -> list[str]:
    aliases = [event_name]
    if "劳动节" in event_name:
        aliases.extend(["劳动节", "五一"])
    if "国庆" in event_name:
        aliases.extend(["国庆", "十一"])
    if "中秋" in event_name:
        aliases.append("中秋")
    if "清明" in event_name:
        aliases.append("清明")
    if "端午" in event_name:
        aliases.append("端午")
    if "元旦" in event_name:
        aliases.append("元旦")
    if "寒假" in event_name:
        aliases.append("寒假")
    if "暑假" in event_name:
        aliases.append("暑假")
    return _unique_strings(aliases)


def _date_range_days(start_date: str, end_date: str) -> list[str]:
    start = _parse_date(start_date, "start_date")
    end = _parse_date(end_date, "end_date")
    if end < start:
        return []
    days: list[str] = []
    current = start
    while current <= end:
        days.append(current.strftime("%Y-%m-%d"))
        current += timedelta(days=1)
    return days


def _calendar_record_id(seed: dict[str, Any]) -> str:
    encoded = json.dumps(seed, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode(
        "utf-8"
    )
    return "calendar:official_web:" + hashlib.sha1(encoded).hexdigest()[:16]


def _parse_rfc3339(value: str, field_name: str) -> datetime:
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError as exc:
        raise ValueError(f"{field_name} must be RFC3339 datetime") from exc
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=UTC)
    return parsed


def _parse_date(value: str, field_name: str) -> datetime:
    try:
        return datetime.strptime(str(value), "%Y-%m-%d").replace(tzinfo=UTC)
    except ValueError as exc:
        raise ValueError(f"{field_name} must be YYYY-MM-DD date") from exc


def _next_date(value: str) -> str:
    return (_parse_date(value, "date") + timedelta(days=1)).strftime("%Y-%m-%d")


def _require_mapping(value: object, label: str) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise ValueError(f"{label} must be an object")
    return dict(value)


def _required_text(value: object) -> str:
    return str(value or "").strip()


def _non_negative_int(value: object, field_name: str) -> int:
    if isinstance(value, bool):
        raise ValueError(f"{field_name} must be a non-negative integer")
    try:
        parsed = int(str(value or "0"))
    except ValueError as exc:
        raise ValueError(f"{field_name} must be a non-negative integer") from exc
    if parsed < 0:
        raise ValueError(f"{field_name} must be a non-negative integer")
    return parsed


def _string_list(value: object) -> list[str]:
    if not isinstance(value, list):
        return []
    return [text for item in value if (text := str(item or "").strip())]


def _string_mapping(value: object) -> dict[str, str]:
    if not isinstance(value, dict):
        return {}
    return {
        str(key).strip(): str(item).strip()
        for key, item in value.items()
        if str(key).strip() and str(item).strip()
    }


def _list_of_dicts(value: object) -> list[dict[str, Any]]:
    if not isinstance(value, list):
        return []
    return [dict(item) for item in value if isinstance(item, dict)]


def _unique_strings(values: list[str]) -> list[str]:
    unique: list[str] = []
    for value in values:
        normalized = str(value or "").strip()
        if normalized and normalized not in unique:
            unique.append(normalized)
    return unique
