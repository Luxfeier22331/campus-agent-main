from __future__ import annotations

from collections.abc import Mapping

from campus_ingestion_core.contact_directory_projection import (
    CONTACT_DIRECTORY_COLLECTION,
    CONTACT_DIRECTORY_CORPUS,
    CONTACT_DIRECTORY_PROJECTION_FILENAME,
    CONTACT_DIRECTORY_PROJECTION_SCHEMA_VERSION,
    assert_contact_directory_projection_release_ready,
)
from campus_ingestion_core.official_web_target_labeling import (
    choose_official_web_contact_display_name,
)

from campus_ingestion_worker.release_official_web_selected_write_common import (
    OfficialWebSelectedWriteObjectStore,
    _candidate_source_ref,
    _object_mapping,
    _require_text,
    _selected_write_field_review,
    _source_document,
    _stable_record_id,
    _string_list,
    _target_label,
    _unique_strings,
)
from campus_ingestion_worker.release_official_web_selected_write_io import (
    _load_current_projection_bundle,
    _merge_current_projection_bundle,
)


def _build_contact_directory_bundle(
    *,
    candidates: list[dict[str, object]],
    selected_write_task: dict[str, object],
    generated_at: str,
    object_store: OfficialWebSelectedWriteObjectStore,
    derived_bucket: str,
) -> dict[str, object]:
    bundle = {
        "schema_version": CONTACT_DIRECTORY_PROJECTION_SCHEMA_VERSION,
        "generated_at": generated_at,
        "source_families": ["official_web_contact_directory_candidate_v1"],
        "source_documents": [_source_document(selected_write_task=selected_write_task)],
        "contact_records": [
            _contact_record_from_candidate(
                candidate=candidate,
                selected_write_task=selected_write_task,
            )
            for candidate in candidates
        ],
        "conflict_records": [],
        "manual_review_sources": [],
    }
    bundle = _merge_current_projection_bundle(
        current_bundle=_load_current_projection_bundle(
            object_store=object_store,
            bucket=derived_bucket,
            corpus=CONTACT_DIRECTORY_CORPUS,
            collection=CONTACT_DIRECTORY_COLLECTION,
            filename=CONTACT_DIRECTORY_PROJECTION_FILENAME,
        ),
        new_bundle=bundle,
        records_field="contact_records",
        id_field="contact_id",
    )
    assert_contact_directory_projection_release_ready(bundle)
    return bundle


def _contact_record_from_candidate(
    *,
    candidate: dict[str, object],
    selected_write_task: dict[str, object],
) -> dict[str, object]:
    typed_candidate = _object_mapping(candidate.get("typed_candidate"))
    source_title = _require_text(
        typed_candidate.get("source_title") or typed_candidate.get("display_name"),
        "typed_candidate.source_title",
    )
    display_name = _require_text(
        choose_official_web_contact_display_name(
            source_title=source_title,
            target_label=_target_label(selected_write_task),
        )
        or typed_candidate.get("display_name")
        or typed_candidate.get("source_title"),
        "typed_candidate.display_name",
    )
    source_ref = _candidate_source_ref(candidate=candidate, selected_write_task=selected_write_task)
    contact_id = _stable_record_id(
        prefix="contact:official_web",
        seed={
            "display_name": display_name,
            "inventory_id": selected_write_task.get("inventoryId"),
            "source_ref": source_ref,
        },
    )
    selected_write_field_review = _selected_write_field_review(selected_write_task)
    contact_points = _contact_point_list(typed_candidate.get("contact_points"))
    phones = _string_list(typed_candidate.get("phones"))
    return {
        "contact_id": contact_id,
        "display_name": display_name,
        "aliases": _unique_strings(
            [
                display_name,
                source_title,
                _target_label(selected_write_task),
                *_official_web_contact_aliases(
                    display_name=display_name, source_title=source_title
                ),
                *_string_list(typed_candidate.get("aliases")),
            ]
        ),
        "contact_group": "official_web",
        "department": display_name,
        "phones": [
            {
                "phone_id": f"{contact_id}:phone:{index}",
                "label": _contact_point_label(contact_points=contact_points, phone=phone)
                or "电话号码",
                "number": phone,
                "source_refs": [source_ref],
            }
            for index, phone in enumerate(phones, start=1)
        ],
        "emails": [
            {
                "email_id": f"{contact_id}:email:{index}",
                "label": "电子邮箱",
                "address": email,
                "source_refs": [source_ref],
            }
            for index, email in enumerate(_string_list(typed_candidate.get("emails")), start=1)
        ],
        "location_refs": [
            {
                "label": "办公地点",
                "location_ref": location,
                "address_text": location,
                "location": location,
                "source_refs": [source_ref],
            }
            for location in _string_list(typed_candidate.get("locations"))
        ],
        "source_refs": [source_ref],
        "extraction_status": "ready",
        **selected_write_field_review,
    }


def _official_web_contact_aliases(*, display_name: str, source_title: str) -> list[str]:
    aliases: list[str] = []
    normalized_display = display_name.strip()
    normalized_source = source_title.strip()
    if "信息化服务" in normalized_display or "信息化服务" in normalized_source:
        aliases.append("信息化办")
    if "信息公开" in normalized_display or "信息公开" in normalized_source:
        aliases.append("信息公开")
    return _unique_strings(aliases)


def _contact_point_list(value: object) -> list[dict[str, str]]:
    if not isinstance(value, list):
        return []
    result: list[dict[str, str]] = []
    for item in value:
        if not isinstance(item, Mapping):
            continue
        label = str(item.get("label") or "").strip()
        phone = str(item.get("phone") or "").strip()
        if not label or not phone:
            continue
        result.append({"label": label, "phone": phone})
    return result


def _contact_point_label(*, contact_points: list[dict[str, str]], phone: str) -> str:
    for item in contact_points:
        if item["phone"] == phone:
            return item["label"]
    return ""
