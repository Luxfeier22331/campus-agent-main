from __future__ import annotations

from collections.abc import Mapping
from datetime import datetime, timedelta

from campus_ingestion_core.academic_calendar_projection import (
    ACADEMIC_CALENDAR_COLLECTION,
    ACADEMIC_CALENDAR_CORPUS,
    ACADEMIC_CALENDAR_PROJECTION_FILENAME,
    ACADEMIC_CALENDAR_PROJECTION_SCHEMA_VERSION,
    assert_academic_calendar_projection_release_ready,
)
from campus_ingestion_core.academic_calendar_source_artifacts import (
    OFFICIAL_WEB_CURATED_ACADEMIC_CALENDAR_SOURCE_FAMILY,
)

from campus_ingestion_worker.release_official_web_selected_write_common import (
    OfficialWebSelectedWriteObjectStore,
    OfficialWebSelectedWriteReleaseError,
    _candidate_source_ref,
    _mapping_list,
    _object_mapping,
    _public_source_refs_for_selected_write_task,
    _require_text,
    _selected_write_field_review,
    _source_document,
    _stable_record_id,
    _string_list,
    _unique_strings,
)
from campus_ingestion_worker.release_official_web_selected_write_io import (
    _load_current_projection_bundle,
    _merge_current_projection_bundle,
)


def _build_academic_calendar_bundle(
    *,
    candidates: list[dict[str, object]],
    selected_write_task: dict[str, object],
    generated_at: str,
    object_store: OfficialWebSelectedWriteObjectStore,
    derived_bucket: str,
) -> dict[str, object]:
    bundle = {
        "schema_version": ACADEMIC_CALENDAR_PROJECTION_SCHEMA_VERSION,
        "generated_at": generated_at,
        "source_families": [OFFICIAL_WEB_CURATED_ACADEMIC_CALENDAR_SOURCE_FAMILY],
        "source_documents": [_source_document(selected_write_task=selected_write_task)],
        "academic_calendar_records": [
            record
            for candidate in candidates
            for record in _academic_calendar_records_from_candidate(
                candidate=candidate,
                selected_write_task=selected_write_task,
            )
        ],
        "manual_review_sources": [],
    }
    bundle = _merge_current_projection_bundle(
        current_bundle=_load_current_projection_bundle(
            object_store=object_store,
            bucket=derived_bucket,
            corpus=ACADEMIC_CALENDAR_CORPUS,
            collection=ACADEMIC_CALENDAR_COLLECTION,
            filename=ACADEMIC_CALENDAR_PROJECTION_FILENAME,
        ),
        new_bundle=bundle,
        records_field="academic_calendar_records",
        id_field="calendar_record_id",
    )
    assert_academic_calendar_projection_release_ready(bundle)
    return bundle


def _academic_calendar_records_from_candidate(
    *,
    candidate: dict[str, object],
    selected_write_task: dict[str, object],
) -> list[dict[str, object]]:
    typed_candidate = _object_mapping(candidate.get("typed_candidate"))
    raw_records = _mapping_list(typed_candidate.get("records"))
    if raw_records:
        return [
            _academic_calendar_record_payload(
                raw_record=raw_record,
                candidate=candidate,
                selected_write_task=selected_write_task,
            )
            for raw_record in raw_records
        ]
    return [
        _academic_calendar_record_payload(
            raw_record=typed_candidate,
            candidate=candidate,
            selected_write_task=selected_write_task,
        )
    ]


def _academic_calendar_record_from_candidate(
    *,
    candidate: dict[str, object],
    selected_write_task: dict[str, object],
) -> dict[str, object]:
    records = _academic_calendar_records_from_candidate(
        candidate=candidate,
        selected_write_task=selected_write_task,
    )
    if not records:
        raise OfficialWebSelectedWriteReleaseError(
            code="missing_selected_write_candidate",
            message="academic calendar selected-write candidate produced no records.",
        )
    return records[0]


def _academic_calendar_record_payload(
    *,
    raw_record: Mapping[str, object],
    candidate: dict[str, object],
    selected_write_task: dict[str, object],
) -> dict[str, object]:
    source_ref = _candidate_source_ref(candidate=candidate, selected_write_task=selected_write_task)
    typed_candidate = _object_mapping(candidate.get("typed_candidate"))
    selected_write_field_review = _selected_write_field_review(selected_write_task)
    academic_year_label = _require_text(
        raw_record.get("academic_year_label") or typed_candidate.get("academic_year_label"),
        "typed_candidate.academic_year_label",
    )
    term_label = _require_text(
        raw_record.get("term_label") or typed_candidate.get("term_label"),
        "typed_candidate.term_label",
    )
    start_date = _require_text(raw_record.get("start_date"), "typed_candidate.start_date")
    end_date = _require_text(raw_record.get("end_date"), "typed_candidate.end_date")
    day_kind = _require_text(raw_record.get("day_kind"), "typed_candidate.day_kind")
    week_index = int(raw_record.get("week_index") or 0)
    class_day_pattern = str(raw_record.get("class_day_pattern") or "").strip()
    holiday_name = str(raw_record.get("holiday_name") or "").strip()
    is_makeup_class = bool(raw_record.get("is_makeup_class") is True)
    record_family = str(
        raw_record.get("record_family") or ""
    ).strip() or _academic_calendar_record_family(
        day_kind=day_kind,
        holiday_name=holiday_name,
        is_makeup_class=is_makeup_class,
    )
    source_title = str(typed_candidate.get("source_title") or "").strip()
    source_url = str(typed_candidate.get("source_url") or "").strip()
    calendar_record_id = _stable_record_id(
        prefix="calendar:official_web",
        seed={
            "inventory_id": selected_write_task.get("inventoryId"),
            "academic_year_label": academic_year_label,
            "term_label": term_label,
            "start_date": start_date,
            "end_date": end_date,
            "day_kind": day_kind,
            "week_index": week_index,
            "holiday_name": holiday_name,
            "class_day_pattern": class_day_pattern,
        },
    )
    return {
        "calendar_record_id": calendar_record_id,
        "record_family": record_family,
        "source_family": OFFICIAL_WEB_CURATED_ACADEMIC_CALENDAR_SOURCE_FAMILY,
        "source_precedence": 10,
        "source_notice_ids": [],
        "precedence_reason": "",
        "conflict_refs": [],
        "academic_year_label": academic_year_label,
        "term_label": term_label,
        "start_date": start_date,
        "end_date": end_date,
        "week_index": week_index,
        "day_kind": day_kind,
        "class_day_pattern": class_day_pattern,
        "is_makeup_class": is_makeup_class,
        "holiday_name": holiday_name,
        "event_name": str(raw_record.get("event_name") or "").strip()
        or (holiday_name if record_family == "named_event" else ""),
        "event_type": str(raw_record.get("event_type") or "").strip()
        or ("holiday" if record_family == "named_event" else ""),
        "event_aliases": _string_list(raw_record.get("event_aliases"))
        or _academic_calendar_event_aliases(holiday_name),
        "event_start_date": str(raw_record.get("event_start_date") or "").strip()
        or (start_date if record_family == "named_event" else ""),
        "event_end_date_exclusive": str(raw_record.get("event_end_date_exclusive") or "").strip()
        or _academic_calendar_next_date(end_date),
        "display_start_date": str(raw_record.get("display_start_date") or "").strip() or start_date,
        "display_end_date": str(raw_record.get("display_end_date") or "").strip() or end_date,
        "applies_to": _string_list(raw_record.get("applies_to")) or ["all"],
        "source_title": source_title,
        "source_url": source_url,
        "source_refs": _unique_strings(
            [
                source_ref,
                *_string_list(raw_record.get("source_refs")),
                *_public_source_refs_for_selected_write_task(selected_write_task),
            ]
        ),
        **selected_write_field_review,
    }


def _academic_calendar_record_family(
    *,
    day_kind: str,
    holiday_name: str,
    is_makeup_class: bool,
) -> str:
    if is_makeup_class or day_kind == "makeup_class_day":
        return "class_day_override"
    if holiday_name or day_kind == "holiday":
        return "named_event"
    return "teaching_week"


def _academic_calendar_next_date(value: str) -> str:
    return (datetime.strptime(value, "%Y-%m-%d") + timedelta(days=1)).strftime("%Y-%m-%d")


def _academic_calendar_event_aliases(event_name: str) -> list[str]:
    aliases = [event_name] if event_name else []
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
