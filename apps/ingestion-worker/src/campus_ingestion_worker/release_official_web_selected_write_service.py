from __future__ import annotations

from datetime import datetime

from campus_ingestion_core.official_web_target_labeling import choose_official_web_service_name
from campus_ingestion_core.service_guide_projection import (
    OFFICIAL_WEB_CURATED_SERVICE_GUIDE_SOURCE_FAMILY,
    SERVICE_GUIDE_COLLECTION,
    SERVICE_GUIDE_CORPUS,
    SERVICE_GUIDE_PROJECTION_FILENAME,
    SERVICE_GUIDE_PROJECTION_SCHEMA_VERSION,
    assert_service_guide_projection_release_ready,
)

from campus_ingestion_worker.release_official_web_selected_write_common import (
    OfficialWebSelectedWriteObjectStore,
    _candidate_source_ref,
    _evidence,
    _mapping_list,
    _object_mapping,
    _public_source_refs_for_selected_write_task,
    _require_text,
    _selected_write_field_review,
    _stable_record_id,
    _string_list,
    _target_label,
    _unique_strings,
)
from campus_ingestion_worker.release_official_web_selected_write_io import (
    _load_current_projection_bundle,
    _merge_current_projection_bundle,
)
from campus_ingestion_worker.release_official_web_selected_write_service_helpers import (
    _candidate_field_source_refs,
    _merged_service_guide_contacts,
    _merged_service_guide_procedure_groups,
    _official_web_service_aliases,
    _selected_write_effective_from,
    _service_entry_url,
    _service_guide_contact_refs,
    _service_guide_items_by_source,
    _service_guide_procedure_groups,
    _service_guide_sections,
    _service_guide_sections_from_items,
    _with_public_service_guide_source_refs,
)


def _build_service_guide_bundle(
    *,
    candidates: list[dict[str, object]],
    selected_write_task: dict[str, object],
    task_created_at: datetime,
    generated_at: str,
    object_store: OfficialWebSelectedWriteObjectStore,
    derived_bucket: str,
) -> dict[str, object]:
    public_source_refs = _public_source_refs_for_selected_write_task(selected_write_task)
    bundle = {
        "schema_version": SERVICE_GUIDE_PROJECTION_SCHEMA_VERSION,
        "generated_at": generated_at,
        "source_families": [OFFICIAL_WEB_CURATED_SERVICE_GUIDE_SOURCE_FAMILY],
        "service_guide_records": [
            _service_guide_record_from_candidates(
                candidates=candidates,
                selected_write_task=selected_write_task,
                task_created_at=task_created_at,
                generated_at=generated_at,
                public_source_refs=public_source_refs,
            )
        ],
        "conflict_records": [],
        "manual_review_sources": [],
    }
    bundle["service_guide_records"] = [
        _with_public_service_guide_source_refs(
            record=record,
            selected_write_task=selected_write_task,
            public_source_refs=public_source_refs,
        )
        for record in _mapping_list(bundle.get("service_guide_records"))
    ]
    bundle = _merge_current_projection_bundle(
        current_bundle=_load_current_projection_bundle(
            object_store=object_store,
            bucket=derived_bucket,
            corpus=SERVICE_GUIDE_CORPUS,
            collection=SERVICE_GUIDE_COLLECTION,
            filename=SERVICE_GUIDE_PROJECTION_FILENAME,
        ),
        new_bundle=bundle,
        records_field="service_guide_records",
        id_field="service_id",
    )
    assert_service_guide_projection_release_ready(bundle)
    return bundle


def _service_guide_record_from_candidate(
    *,
    candidate: dict[str, object],
    selected_write_task: dict[str, object],
    task_created_at: datetime,
    generated_at: str,
) -> dict[str, object]:
    typed_candidate = _object_mapping(candidate.get("typed_candidate"))
    source_title = _require_text(
        typed_candidate.get("source_title") or typed_candidate.get("service_name"),
        "typed_candidate.source_title",
    )
    display_name = _require_text(
        choose_official_web_service_name(
            source_title=source_title,
            target_label=_target_label(selected_write_task),
        )
        or typed_candidate.get("service_name")
        or typed_candidate.get("source_title"),
        "typed_candidate.service_name",
    )
    source_ref = _candidate_source_ref(candidate=candidate, selected_write_task=selected_write_task)
    service_id = _stable_record_id(
        prefix="service:official_web",
        seed={
            "display_name": display_name,
            "inventory_id": selected_write_task.get("inventoryId"),
            "source_ref": source_ref,
        },
    )
    field_source_urls = _object_mapping(typed_candidate.get("field_source_urls"))
    contacts = _object_mapping(typed_candidate.get("contacts"))
    responsible_offices = _string_list(typed_candidate.get("responsible_office"))
    return _service_guide_record_payload(
        selected_write_task=selected_write_task,
        typed_candidate=typed_candidate,
        service_id=service_id,
        display_name=display_name,
        source_title=source_title,
        source_ref=source_ref,
        process_steps=_string_list(typed_candidate.get("process_steps")),
        procedure_groups=_mapping_list(typed_candidate.get("procedure_groups")),
        materials=_string_list(typed_candidate.get("materials")),
        entry_points=_string_list(typed_candidate.get("entry_points")),
        responsible_offices=responsible_offices,
        contacts=contacts,
        process_source_refs=_field_refs(field_source_urls, "process_steps", source_ref),
        procedure_group_source_refs=_field_refs(field_source_urls, "procedure_groups", source_ref),
        material_source_refs=_field_refs(field_source_urls, "materials", source_ref),
        entry_source_refs=_field_refs(field_source_urls, "entry_points", source_ref),
        office_source_refs=_field_refs(field_source_urls, "responsible_office", source_ref),
        contact_source_refs=_field_refs(field_source_urls, "contacts", source_ref),
        task_created_at=task_created_at,
        generated_at=generated_at,
        source_refs=_candidate_source_refs(
            candidate=candidate,
            selected_write_task=selected_write_task,
            source_ref=source_ref,
            typed_candidate=typed_candidate,
        ),
    )


def _field_refs(
    field_source_urls: dict[str, object], field_name: str, source_ref: str
) -> list[str]:
    return _candidate_field_source_refs(
        field_source_urls=field_source_urls,
        field_name=field_name,
        fallback_source_ref=source_ref,
    )


def _candidate_source_refs(
    *,
    candidate: dict[str, object],
    selected_write_task: dict[str, object],
    source_ref: str,
    typed_candidate: dict[str, object],
) -> list[str]:
    canonical_source_ref = _candidate_source_ref(
        candidate=candidate,
        selected_write_task=selected_write_task,
    )
    return _unique_strings(
        [
            canonical_source_ref,
            source_ref,
            *_string_list(typed_candidate.get("supporting_source_urls")),
            *_string_list(
                _evidence(selected_write_task).get("sourceUrls")
                or _evidence(selected_write_task).get("source_urls")
            ),
        ]
    )


def _service_guide_record_payload(
    *,
    selected_write_task: dict[str, object],
    typed_candidate: dict[str, object],
    service_id: str,
    display_name: str,
    source_title: str,
    source_ref: str,
    process_steps: list[str],
    procedure_groups: list[dict[str, object]],
    materials: list[str],
    entry_points: list[str],
    responsible_offices: list[str],
    contacts: dict[str, object],
    process_source_refs: list[str],
    procedure_group_source_refs: list[str],
    material_source_refs: list[str],
    entry_source_refs: list[str],
    office_source_refs: list[str],
    contact_source_refs: list[str],
    task_created_at: datetime,
    generated_at: str,
    source_refs: list[str],
) -> dict[str, object]:
    return {
        "service_id": service_id,
        "display_name": display_name,
        "aliases": _service_aliases(
            display_name, source_title, selected_write_task, typed_candidate
        ),
        "category": "campus_service",
        "campus_scope": "all",
        "audience": ["unknown"],
        "effective_from": _selected_write_effective_from(task_created_at, generated_at),
        "effective_until": "9999-12-31T23:59:59+00:00",
        "source_refs": source_refs,
        "guide_sections": _service_guide_sections(
            service_id=service_id,
            display_name=display_name,
            process_steps=process_steps,
            materials=materials,
            entry_points=entry_points,
            responsible_offices=responsible_offices,
            process_source_refs=process_source_refs,
            material_source_refs=material_source_refs,
            entry_source_refs=entry_source_refs,
            office_source_refs=office_source_refs,
            fallback_source_ref=source_ref,
        ),
        "procedure_groups": _service_guide_procedure_groups(
            service_id=service_id,
            procedure_groups=procedure_groups,
            fallback_source_refs=procedure_group_source_refs,
        ),
        "materials": _material_refs(service_id, materials, material_source_refs),
        "entry_refs": _entry_refs(service_id, entry_points, entry_source_refs),
        "office_hours": _office_hours(service_id, contacts, contact_source_refs),
        "contact_refs": _service_guide_contact_refs(
            contacts=contacts,
            display_name=display_name,
            responsible_offices=responsible_offices,
            service_id=service_id,
            source_ref=contact_source_refs[0],
        ),
        "eligibility_notes": [],
        "extraction_status": "ready",
        **_selected_write_field_review(selected_write_task),
    }


def _service_aliases(
    display_name: str,
    source_title: str,
    selected_write_task: dict[str, object],
    typed_candidate: dict[str, object],
) -> list[str]:
    return _unique_strings(
        [
            display_name,
            source_title,
            _target_label(selected_write_task),
            *_official_web_service_aliases(display_name=display_name, source_title=source_title),
            *_string_list(typed_candidate.get("aliases")),
        ]
    )


def _material_refs(
    service_id: str,
    materials: list[str],
    material_source_refs: list[str],
) -> list[dict[str, object]]:
    return [
        {
            "material_id": f"{service_id}:material:{index}",
            "name": material,
            "required": True,
            "note": "",
            "source_refs": material_source_refs,
        }
        for index, material in enumerate(materials, start=1)
    ]


def _entry_refs(
    service_id: str,
    entry_points: list[str],
    entry_source_refs: list[str],
) -> list[dict[str, object]]:
    return [
        {
            "entry_id": f"{service_id}:entry:{index}",
            "label": entry,
            "entry_type": "online_url" if _service_entry_url(entry) else "web_page",
            "url": _service_entry_url(entry),
            "location_ref": "",
            "source_refs": entry_source_refs,
        }
        for index, entry in enumerate(entry_points, start=1)
    ]


def _office_hours(
    service_id: str,
    contacts: dict[str, object],
    contact_source_refs: list[str],
) -> list[dict[str, object]]:
    return [
        {
            "hours_id": f"{service_id}:hours:{index}",
            "label": hours,
            "day_pattern": "",
            "time_range": "",
            "effective_note": "",
            "source_refs": contact_source_refs,
        }
        for index, hours in enumerate(_string_list(contacts.get("office_hours")), start=1)
    ]


def _service_guide_record_from_candidates(
    *,
    candidates: list[dict[str, object]],
    selected_write_task: dict[str, object],
    task_created_at: datetime,
    generated_at: str,
    public_source_refs: list[str],
) -> dict[str, object]:
    if len(candidates) == 1:
        single = _service_guide_record_from_candidate(
            candidate=candidates[0],
            selected_write_task=selected_write_task,
            task_created_at=task_created_at,
            generated_at=generated_at,
        )
        return _with_public_service_guide_source_refs(
            record=single,
            selected_write_task=selected_write_task,
            public_source_refs=public_source_refs,
        )
    return _merged_service_guide_record(
        candidates=candidates,
        selected_write_task=selected_write_task,
        task_created_at=task_created_at,
        generated_at=generated_at,
        public_source_refs=public_source_refs,
    )


def _merged_service_guide_record(
    *,
    candidates: list[dict[str, object]],
    selected_write_task: dict[str, object],
    task_created_at: datetime,
    generated_at: str,
    public_source_refs: list[str],
) -> dict[str, object]:
    typed_candidates = [
        _object_mapping(candidate.get("typed_candidate")) for candidate in candidates
    ]
    source_title = _require_text(
        next(
            (
                typed.get("source_title") or typed.get("service_name")
                for typed in typed_candidates
                if typed.get("source_title") or typed.get("service_name")
            ),
            "",
        ),
        "typed_candidate.source_title",
    )
    display_name = _require_text(
        _target_label(selected_write_task)
        or choose_official_web_service_name(
            source_title=source_title,
            target_label=_target_label(selected_write_task),
        ),
        "typed_candidate.service_name",
    )
    source_ref = public_source_refs[0]
    service_id = _stable_record_id(
        prefix="service:official_web",
        seed={
            "display_name": display_name,
            "inventory_id": selected_write_task.get("inventoryId"),
            "source_refs": public_source_refs,
        },
    )
    process_items = _items(candidates, "process_steps", source_ref)
    material_items = _items(candidates, "materials", source_ref)
    entry_items = _items(candidates, "entry_points", source_ref)
    office_items = _items(candidates, "responsible_office", source_ref)
    contacts = _merged_service_guide_contacts(candidates)
    return {
        "service_id": service_id,
        "display_name": display_name,
        "aliases": _merged_aliases(
            display_name, source_title, selected_write_task, typed_candidates
        ),
        "category": "campus_service",
        "campus_scope": "all",
        "audience": ["unknown"],
        "effective_from": _selected_write_effective_from(task_created_at, generated_at),
        "effective_until": "9999-12-31T23:59:59+00:00",
        "source_refs": public_source_refs,
        "guide_sections": _service_guide_sections_from_items(
            service_id=service_id,
            display_name=display_name,
            process_items=process_items,
            material_items=material_items,
            entry_items=entry_items,
            office_items=office_items,
            fallback_source_ref=source_ref,
        ),
        "procedure_groups": _service_guide_procedure_groups(
            service_id=service_id,
            procedure_groups=_merged_service_guide_procedure_groups(
                candidates=candidates,
                fallback_source_ref=source_ref,
            ),
            fallback_source_refs=public_source_refs,
        ),
        "materials": _item_materials(service_id, material_items),
        "entry_refs": _item_entries(service_id, entry_items),
        "office_hours": _item_office_hours(service_id, contacts, source_ref),
        "contact_refs": _service_guide_contact_refs(
            contacts=contacts,
            display_name=display_name,
            responsible_offices=[item["text"] for item in office_items],
            service_id=service_id,
            source_ref=source_ref,
        ),
        "eligibility_notes": [],
        "extraction_status": "ready",
        **_selected_write_field_review(selected_write_task),
    }


def _items(
    candidates: list[dict[str, object]],
    field_name: str,
    fallback_source_ref: str,
) -> list[dict[str, str]]:
    return _service_guide_items_by_source(
        candidates=candidates,
        field_name=field_name,
        fallback_source_ref=fallback_source_ref,
    )


def _merged_aliases(
    display_name: str,
    source_title: str,
    selected_write_task: dict[str, object],
    typed_candidates: list[dict[str, object]],
) -> list[str]:
    return _unique_strings(
        [
            display_name,
            source_title,
            _target_label(selected_write_task),
            *_official_web_service_aliases(display_name=display_name, source_title=source_title),
            *[alias for typed in typed_candidates for alias in _string_list(typed.get("aliases"))],
        ]
    )


def _item_materials(
    service_id: str,
    material_items: list[dict[str, str]],
) -> list[dict[str, object]]:
    return [
        {
            "material_id": f"{service_id}:material:{index}",
            "name": item["text"],
            "required": True,
            "note": "",
            "source_refs": [item["source_ref"]],
        }
        for index, item in enumerate(material_items, start=1)
    ]


def _item_entries(
    service_id: str,
    entry_items: list[dict[str, str]],
) -> list[dict[str, object]]:
    return [
        {
            "entry_id": f"{service_id}:entry:{index}",
            "label": item["text"],
            "entry_type": "online_url" if _service_entry_url(item["text"]) else "web_page",
            "url": _service_entry_url(item["text"]),
            "location_ref": "",
            "source_refs": [item["source_ref"]],
        }
        for index, item in enumerate(entry_items, start=1)
    ]


def _item_office_hours(
    service_id: str,
    contacts: dict[str, object],
    source_ref: str,
) -> list[dict[str, object]]:
    return [
        {
            "hours_id": f"{service_id}:hours:{index}",
            "label": hours,
            "day_pattern": "",
            "time_range": "",
            "effective_note": "",
            "source_refs": [source_ref],
        }
        for index, hours in enumerate(_string_list(contacts.get("office_hours")), start=1)
    ]
