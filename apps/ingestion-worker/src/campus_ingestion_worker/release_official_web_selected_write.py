from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
from collections.abc import Mapping, Sequence
from dataclasses import asdict, dataclass, is_dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Protocol

from campus_ingestion_core import (
    DEFAULT_BUCKET_SOURCE,
    ObjectStoreSettings,
    replay_official_web_source_truth_local,
)
from campus_ingestion_core.contact_directory_projection import (
    CONTACT_DIRECTORY_COLLECTION,
    CONTACT_DIRECTORY_CORPUS,
    CONTACT_DIRECTORY_PROJECTION_FILENAME,
    CONTACT_DIRECTORY_PROJECTION_SCHEMA_VERSION,
    assert_contact_directory_projection_release_ready,
    write_contact_directory_projection_release,
)
from campus_ingestion_core.local_rebuild import S3ObjectStoreAdmin
from campus_ingestion_core.object_store import build_index_release_artifact_key
from campus_ingestion_core.official_web_release_task import OfficialWebReleaseTask
from campus_ingestion_core.service_guide_projection import (
    OFFICIAL_WEB_CURATED_SERVICE_GUIDE_SOURCE_FAMILY,
    SERVICE_GUIDE_COLLECTION,
    SERVICE_GUIDE_CORPUS,
    SERVICE_GUIDE_PROJECTION_FILENAME,
    SERVICE_GUIDE_PROJECTION_SCHEMA_VERSION,
    assert_service_guide_projection_release_ready,
    write_service_guide_projection_release,
)
from campus_ingestion_core.structured_projection_postgres import (
    build_structured_projection_publisher_from_env,
    projection_artifact_checksum,
)

from campus_ingestion_worker.env_bootstrap import load_worker_env
from campus_ingestion_worker.official_web_handoff_consumer_runtime import materialize_replay_input


class OfficialWebSelectedWriteReleaseError(RuntimeError):
    def __init__(self, *, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code


class OfficialWebSelectedWriteObjectStore(Protocol):
    def get_bytes(self, *, bucket: str, key: str) -> bytes: ...

    def put_bytes(self, *, bucket: str, key: str, data: bytes, content_type: str) -> None: ...


class OfficialWebSelectedWriteProjectionReporter(Protocol):
    def report(self, *, snapshot: dict[str, object]) -> None: ...


class OfficialWebSelectedWritePublisher(Protocol):
    def publish_release(
        self,
        *,
        corpus: str,
        collection: str,
        release_id: str,
        generated_at: str,
        schema_version: str,
        artifact_object_key: str,
        artifact_checksum: str,
        bundle: Mapping[str, Any],
        validation_status: str,
    ) -> object: ...


@dataclass(frozen=True, slots=True)
class OfficialWebSelectedWriteResult:
    selected_write_id: str
    status: str
    corpus: str
    collection: str
    release_id: str
    record_count: int
    work_dir: str
    source_bundle_key: str


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Release one ingestion-owned official_web selected-write task.",
    )
    parser.add_argument("--release-task-path", required=True)
    parser.add_argument("--work-dir", default="./var/official-web-selected-write-releases")
    parser.add_argument("--source-bucket", default=DEFAULT_BUCKET_SOURCE)
    parser.add_argument("--derived-bucket")
    parser.add_argument("--declarations-path")
    return parser


def release_official_web_selected_write(
    *,
    release_task: Mapping[str, object] | OfficialWebReleaseTask,
    object_store: OfficialWebSelectedWriteObjectStore,
    derived_object_store: OfficialWebSelectedWriteObjectStore,
    structured_projection_publisher: OfficialWebSelectedWritePublisher,
    projection_reporter: OfficialWebSelectedWriteProjectionReporter | None = None,
    work_dir: Path,
    object_store_settings: ObjectStoreSettings | None = None,
    source_bucket: str = DEFAULT_BUCKET_SOURCE,
    derived_bucket: str | None = None,
    declarations_path: Path | None = None,
) -> OfficialWebSelectedWriteResult:
    task = _release_task_model(release_task)
    _assert_selected_write_release_task(task)
    selected_write_task = _selected_write_task_from_release_task(task)
    selected_write_id = task.task_id
    settings = _resolve_object_store_settings(
        object_store_settings=object_store_settings,
        source_bucket=source_bucket,
    )
    runtime_derived_bucket = derived_bucket or settings.bucket_derived
    replay_input_dir = work_dir / "replay-input"
    projection_output_dir = work_dir / "projection-output"
    release_output_dir = work_dir / "release-output"
    _reset_dir(replay_input_dir)
    _reset_dir(projection_output_dir)
    _reset_dir(release_output_dir)

    source_bundle_key = ""
    try:
        _report_projection(
            projection_reporter=projection_reporter,
            task=task,
            snapshot={"status": "running", "updatedAt": _utcnow()},
        )
        source_bundle_key = _source_bundle_key(selected_write_task)
        bundle_payload = _download_source_truth_bundle(
            object_store=object_store,
            bucket=settings.bucket_source,
            key=source_bundle_key,
        )
        _write_json(replay_input_dir / "source-truth-bundle.json", bundle_payload)
        materialize_replay_input(
            replay_input_dir=replay_input_dir,
            bundle_payload=bundle_payload,
            object_store=object_store,
            bucket=settings.bucket_source,
        )
        replay_report = _as_mapping(
            replay_official_web_source_truth_local(
                output_dir=replay_input_dir,
                projection_output_dir=projection_output_dir,
                declarations_path=declarations_path,
            )
        )
        candidates = _matching_selected_write_candidates(
            replay_report=replay_report,
            selected_write_task=selected_write_task,
        )
        if not candidates:
            raise OfficialWebSelectedWriteReleaseError(
                code="missing_selected_write_candidate",
                message="selected-write task target produced no matching ready candidate.",
            )
        generated_at = _utcnow()
        release_id = _selected_write_release_id(
            selected_write_id=selected_write_id,
            generated_at=generated_at,
        )
        selected_write_target = _require_text(
            selected_write_task.get("selectedWriteTarget")
            or selected_write_task.get("selected_write_target"),
            "selectedWriteTarget",
        )
        if selected_write_target == "campus_services/contact_directory":
            result = _release_contact_directory_candidates(
                candidates=candidates,
                selected_write_task=selected_write_task,
                output_dir=release_output_dir,
                release_id=release_id,
                generated_at=generated_at,
                object_store=derived_object_store,
                derived_bucket=runtime_derived_bucket,
                structured_projection_publisher=structured_projection_publisher,
            )
        elif selected_write_target == "campus_services/service_guide":
            result = _release_service_guide_candidates(
                candidates=candidates,
                selected_write_task=selected_write_task,
                output_dir=release_output_dir,
                release_id=release_id,
                generated_at=generated_at,
                object_store=derived_object_store,
                derived_bucket=runtime_derived_bucket,
                structured_projection_publisher=structured_projection_publisher,
            )
        else:
            raise OfficialWebSelectedWriteReleaseError(
                code="unsupported_selected_write_target",
                message=f"unsupported selected-write target: {selected_write_target}",
            )
        _report_projection(
            projection_reporter=projection_reporter,
            task=task,
            snapshot={
                "execution": {
                    "collection": result.collection,
                    "corpus": result.corpus,
                    "recordCount": result.record_count,
                    "releaseId": result.release_id,
                },
                "status": "materialized",
                "updatedAt": _utcnow(),
            },
        )
        _report_projection(
            projection_reporter=projection_reporter,
            task=task,
            snapshot={
                "execution": {
                    "collection": result.collection,
                    "corpus": result.corpus,
                    "recordCount": result.record_count,
                    "releaseId": result.release_id,
                    "sourceBundleKey": source_bundle_key,
                },
                "status": "published",
                "updatedAt": _utcnow(),
            },
        )
        return OfficialWebSelectedWriteResult(
            selected_write_id=selected_write_id,
            status="published",
            corpus=result.corpus,
            collection=result.collection,
            release_id=result.release_id,
            record_count=result.record_count,
            work_dir=str(work_dir.resolve()),
            source_bundle_key=source_bundle_key,
        )
    except Exception as exc:
        _report_projection(
            projection_reporter=projection_reporter,
            task=task,
            snapshot={
                "error": {
                    "code": getattr(exc, "code", exc.__class__.__name__),
                    "message": str(exc),
                },
                "status": "failed",
                "updatedAt": _utcnow(),
            },
            suppress_errors=True,
        )
        raise


@dataclass(frozen=True, slots=True)
class _ProjectionReleaseResult:
    corpus: str
    collection: str
    release_id: str
    record_count: int


def _release_contact_directory_candidates(
    *,
    candidates: list[dict[str, object]],
    selected_write_task: dict[str, object],
    output_dir: Path,
    release_id: str,
    generated_at: str,
    object_store: OfficialWebSelectedWriteObjectStore,
    derived_bucket: str,
    structured_projection_publisher: OfficialWebSelectedWritePublisher,
) -> _ProjectionReleaseResult:
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
    report = write_contact_directory_projection_release(
        bundle=bundle,
        output_dir=output_dir,
        release_id=release_id,
        generated_at=generated_at,
        manual_review_sources=[],
        object_store=object_store,
        bucket=derived_bucket,
    )
    structured_projection_publisher.publish_release(
        corpus=CONTACT_DIRECTORY_CORPUS,
        collection=CONTACT_DIRECTORY_COLLECTION,
        release_id=report.release_id,
        generated_at=generated_at,
        schema_version=CONTACT_DIRECTORY_PROJECTION_SCHEMA_VERSION,
        artifact_object_key=report.release_object_key,
        artifact_checksum=projection_artifact_checksum(bundle),
        bundle=bundle,
        validation_status="valid",
    )
    return _ProjectionReleaseResult(
        corpus=CONTACT_DIRECTORY_CORPUS,
        collection=CONTACT_DIRECTORY_COLLECTION,
        release_id=report.release_id,
        record_count=len(bundle["contact_records"]),
    )


def _release_service_guide_candidates(
    *,
    candidates: list[dict[str, object]],
    selected_write_task: dict[str, object],
    output_dir: Path,
    release_id: str,
    generated_at: str,
    object_store: OfficialWebSelectedWriteObjectStore,
    derived_bucket: str,
    structured_projection_publisher: OfficialWebSelectedWritePublisher,
) -> _ProjectionReleaseResult:
    bundle = {
        "schema_version": SERVICE_GUIDE_PROJECTION_SCHEMA_VERSION,
        "generated_at": generated_at,
        "source_families": [OFFICIAL_WEB_CURATED_SERVICE_GUIDE_SOURCE_FAMILY],
        "service_guide_records": [
            _service_guide_record_from_candidate(
                candidate=candidate,
                selected_write_task=selected_write_task,
                generated_at=generated_at,
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
            corpus=SERVICE_GUIDE_CORPUS,
            collection=SERVICE_GUIDE_COLLECTION,
            filename=SERVICE_GUIDE_PROJECTION_FILENAME,
        ),
        new_bundle=bundle,
        records_field="service_guide_records",
        id_field="service_id",
    )
    assert_service_guide_projection_release_ready(bundle)
    report = write_service_guide_projection_release(
        bundle=bundle,
        output_dir=output_dir,
        release_id=release_id,
        generated_at=generated_at,
        manual_review_sources=[],
        object_store=object_store,
        bucket=derived_bucket,
    )
    structured_projection_publisher.publish_release(
        corpus=SERVICE_GUIDE_CORPUS,
        collection=SERVICE_GUIDE_COLLECTION,
        release_id=report.release_id,
        generated_at=generated_at,
        schema_version=SERVICE_GUIDE_PROJECTION_SCHEMA_VERSION,
        artifact_object_key=report.release_object_key,
        artifact_checksum=projection_artifact_checksum(bundle),
        bundle=bundle,
        validation_status="valid",
    )
    return _ProjectionReleaseResult(
        corpus=SERVICE_GUIDE_CORPUS,
        collection=SERVICE_GUIDE_COLLECTION,
        release_id=report.release_id,
        record_count=len(bundle["service_guide_records"]),
    )


def _load_current_projection_bundle(
    *,
    object_store: OfficialWebSelectedWriteObjectStore,
    bucket: str,
    corpus: str,
    collection: str,
    filename: str,
) -> dict[str, object] | None:
    key = build_index_release_artifact_key(
        corpus=corpus,
        collection=collection,
        release_id="current",
        filename=filename,
    )
    try:
        payload = json.loads(object_store.get_bytes(bucket=bucket, key=key).decode("utf-8"))
    except Exception as exc:
        if _is_missing_object_error(exc):
            return None
        raise OfficialWebSelectedWriteReleaseError(
            code="current_projection_read_failed",
            message=f"failed to read current {corpus}/{collection} projection: {exc}",
        ) from exc
    if not isinstance(payload, dict):
        raise OfficialWebSelectedWriteReleaseError(
            code="invalid_current_projection",
            message=f"current {corpus}/{collection} projection must be a JSON object.",
        )
    return payload


def _is_missing_object_error(exc: Exception) -> bool:
    if isinstance(exc, KeyError | FileNotFoundError):
        return True
    response = getattr(exc, "response", None)
    if not isinstance(response, Mapping):
        return False
    error = response.get("Error")
    if not isinstance(error, Mapping):
        return False
    return str(error.get("Code") or "").strip() in {
        "404",
        "NoSuchKey",
        "NotFound",
    }


def _merge_current_projection_bundle(
    *,
    current_bundle: Mapping[str, object] | None,
    new_bundle: dict[str, object],
    records_field: str,
    id_field: str,
) -> dict[str, object]:
    new_records = [
        {**record, "release_record_state": "newly_selected"}
        for record in _mapping_list(new_bundle.get(records_field))
    ]
    new_bundle = {
        **new_bundle,
        records_field: new_records,
        "release_record_lineage": _release_record_lineage(new_records),
    }
    if current_bundle is None:
        return new_bundle
    if current_bundle.get("schema_version") != new_bundle.get("schema_version"):
        raise OfficialWebSelectedWriteReleaseError(
            code="current_projection_schema_mismatch",
            message="current projection schema does not match selected-write projection schema.",
        )
    current_records = _mapping_list(current_bundle.get(records_field))
    replacement_ids = {str(record.get(id_field) or "").strip() for record in new_records}
    replacement_inventory_ids = _record_inventory_ids(new_records)
    carried_records = [
        {**record, "release_record_state": "carried_forward"}
        for record in current_records
        if str(record.get(id_field) or "").strip() not in replacement_ids
        and not (_record_inventory_ids([record]) & replacement_inventory_ids)
    ]
    merged_records = [*carried_records, *new_records]
    return {
        **new_bundle,
        "source_families": _unique_strings(
            [
                *_string_list(current_bundle.get("source_families")),
                *_string_list(new_bundle.get("source_families")),
            ]
        ),
        "source_documents": _merge_source_documents(
            current_bundle.get("source_documents"),
            new_bundle.get("source_documents"),
        ),
        records_field: merged_records,
        "release_record_lineage": _release_record_lineage(merged_records),
        "conflict_records": [
            *_mapping_list(current_bundle.get("conflict_records")),
            *_mapping_list(new_bundle.get("conflict_records")),
        ],
        "manual_review_sources": [
            *_mapping_list(current_bundle.get("manual_review_sources")),
            *_mapping_list(new_bundle.get("manual_review_sources")),
        ],
    }


def _release_record_lineage(records: Sequence[Mapping[str, object]]) -> dict[str, int]:
    counts = {"carried_forward": 0, "newly_selected": 0}
    for record in records:
        state = str(record.get("release_record_state") or "").strip()
        if state in counts:
            counts[state] += 1
    return counts


def _merge_source_documents(
    current_value: object,
    new_value: object,
) -> list[dict[str, object]]:
    documents_by_title: dict[str, dict[str, object]] = {}
    for document in [*_mapping_list(current_value), *_mapping_list(new_value)]:
        title = str(document.get("title") or "").strip()
        if not title:
            continue
        existing = documents_by_title.get(title)
        if existing is None:
            documents_by_title[title] = {
                **document,
                "source_refs": _string_list(document.get("source_refs")),
            }
            continue
        existing["source_refs"] = _unique_strings(
            [
                *_string_list(existing.get("source_refs")),
                *_string_list(document.get("source_refs")),
            ]
        )
    return list(documents_by_title.values())


def _mapping_list(value: object) -> list[dict[str, object]]:
    if not isinstance(value, list):
        return []
    return [dict(item) for item in value if isinstance(item, dict)]


def _record_inventory_ids(records: Sequence[Mapping[str, object]]) -> set[str]:
    inventory_ids: set[str] = set()
    for record in records:
        for source_ref in _string_list(record.get("source_refs")):
            inventory_id = _official_web_inventory_id_from_source_ref(source_ref)
            if inventory_id:
                inventory_ids.add(inventory_id)
    return inventory_ids


def _official_web_inventory_id_from_source_ref(source_ref: str) -> str:
    parts = source_ref.split(":", 2)
    if len(parts) < 3 or parts[0] != "official_web":
        return ""
    return parts[1].strip()


def _contact_record_from_candidate(
    *,
    candidate: dict[str, object],
    selected_write_task: dict[str, object],
) -> dict[str, object]:
    typed_candidate = _object_mapping(candidate.get("typed_candidate"))
    display_name = _require_text(
        typed_candidate.get("display_name") or typed_candidate.get("source_title"),
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
    return {
        "contact_id": contact_id,
        "display_name": display_name,
        "aliases": _unique_strings(
            [
                display_name,
                _target_label(selected_write_task),
                *_string_list(typed_candidate.get("aliases")),
            ]
        ),
        "contact_group": "official_web",
        "department": display_name,
        "phones": [
            {
                "phone_id": f"{contact_id}:phone:{index}",
                "label": "电话号码",
                "number": phone,
                "source_refs": [source_ref],
            }
            for index, phone in enumerate(_string_list(typed_candidate.get("phones")), start=1)
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


def _service_guide_record_from_candidate(
    *,
    candidate: dict[str, object],
    selected_write_task: dict[str, object],
    generated_at: str,
) -> dict[str, object]:
    typed_candidate = _object_mapping(candidate.get("typed_candidate"))
    display_name = _require_text(
        typed_candidate.get("service_name") or typed_candidate.get("source_title"),
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
    process_steps = _string_list(typed_candidate.get("process_steps"))
    materials = _string_list(typed_candidate.get("materials"))
    entry_points = _string_list(typed_candidate.get("entry_points"))
    responsible_offices = _string_list(typed_candidate.get("responsible_office"))
    contacts = _object_mapping(typed_candidate.get("contacts"))
    office_hours = _string_list(contacts.get("office_hours"))
    contact_refs = _service_guide_contact_refs(
        contacts=contacts,
        display_name=display_name,
        responsible_offices=responsible_offices,
        service_id=service_id,
        source_ref=source_ref,
    )
    guide_sections = _service_guide_sections(
        service_id=service_id,
        display_name=display_name,
        process_steps=process_steps,
        materials=materials,
        entry_points=entry_points,
        responsible_offices=responsible_offices,
        source_ref=source_ref,
    )
    selected_write_field_review = _selected_write_field_review(selected_write_task)
    return {
        "service_id": service_id,
        "display_name": display_name,
        "aliases": _unique_strings(
            [
                display_name,
                _target_label(selected_write_task),
                *_string_list(typed_candidate.get("aliases")),
            ]
        ),
        "category": "campus_service",
        "campus_scope": "all",
        "audience": ["unknown"],
        "effective_from": generated_at,
        "effective_until": "9999-12-31T23:59:59+00:00",
        "source_refs": [source_ref],
        "guide_sections": guide_sections,
        "materials": [
            {
                "material_id": f"{service_id}:material:{index}",
                "name": material,
                "required": True,
                "note": "",
                "source_refs": [source_ref],
            }
            for index, material in enumerate(materials, start=1)
        ],
        "entry_refs": [
            {
                "entry_id": f"{service_id}:entry:{index}",
                "label": entry,
                "entry_type": "online_url"
                if entry.startswith(("http://", "https://"))
                else "web_page",
                "url": entry if entry.startswith(("http://", "https://")) else "",
                "location_ref": "",
                "source_refs": [source_ref],
            }
            for index, entry in enumerate(entry_points, start=1)
        ],
        "office_hours": [
            {
                "hours_id": f"{service_id}:hours:{index}",
                "label": hours,
                "day_pattern": "",
                "time_range": "",
                "effective_note": "",
                "source_refs": [source_ref],
            }
            for index, hours in enumerate(office_hours, start=1)
        ],
        "contact_refs": contact_refs,
        "eligibility_notes": [],
        "extraction_status": "ready",
        **selected_write_field_review,
    }


def _service_guide_sections(
    *,
    service_id: str,
    display_name: str,
    process_steps: list[str],
    materials: list[str],
    entry_points: list[str],
    responsible_offices: list[str],
    source_ref: str,
) -> list[dict[str, object]]:
    sections: list[dict[str, object]] = []
    if process_steps:
        sections.append(
            {
                "section_id": f"{service_id}:section:procedure",
                "section_type": "procedure",
                "title": display_name,
                "content": "\n".join(
                    f"{index}. {step}" for index, step in enumerate(process_steps, start=1)
                ),
                "order": 1,
                "source_refs": [source_ref],
            }
        )
    if materials:
        sections.append(
            {
                "section_id": f"{service_id}:section:required_materials",
                "section_type": "required_materials",
                "title": "申请材料",
                "content": "\n".join(materials),
                "order": 2,
                "source_refs": [source_ref],
            }
        )
    if entry_points:
        sections.append(
            {
                "section_id": f"{service_id}:section:entry",
                "section_type": "entry",
                "title": "办理入口",
                "content": "\n".join(entry_points),
                "order": 3,
                "source_refs": [source_ref],
            }
        )
    if responsible_offices:
        sections.append(
            {
                "section_id": f"{service_id}:section:contact",
                "section_type": "contact",
                "title": "负责部门",
                "content": "\n".join(responsible_offices),
                "order": 4,
                "source_refs": [source_ref],
            }
        )
    if sections:
        return sections
    return [
        {
            "section_id": f"{service_id}:section:overview",
            "section_type": "overview",
            "title": display_name,
            "content": display_name,
            "order": 1,
            "source_refs": [source_ref],
        }
    ]


def _service_guide_contact_refs(
    *,
    contacts: Mapping[str, object],
    display_name: str,
    responsible_offices: list[str],
    service_id: str,
    source_ref: str,
) -> list[dict[str, object]]:
    phones = _string_list(contacts.get("phones"))
    emails = _string_list(contacts.get("emails"))
    locations = _string_list(contacts.get("locations"))
    contact_count = max(len(responsible_offices), len(phones), len(emails), len(locations))
    return [
        {
            "contact_id": f"{service_id}:contact:{index}",
            "label": _indexed_value(responsible_offices, offset) or display_name,
            "department": _indexed_value(responsible_offices, offset) or display_name,
            "phone": _indexed_value(phones, offset),
            "email": _indexed_value(emails, offset),
            "location_ref": _indexed_value(locations, offset),
            "source_refs": [source_ref],
        }
        for offset, index in enumerate(range(1, contact_count + 1))
    ]


def _indexed_value(values: list[str], offset: int) -> str:
    if offset < len(values):
        return values[offset]
    return ""


def _matching_selected_write_candidates(
    *,
    replay_report: Mapping[str, object],
    selected_write_task: dict[str, object],
) -> list[dict[str, object]]:
    selected_write_target = _require_text(
        selected_write_task.get("selectedWriteTarget")
        or selected_write_task.get("selected_write_target"),
        "selectedWriteTarget",
    )
    job_id = _require_text(
        selected_write_task.get("jobId") or selected_write_task.get("job_id"), "jobId"
    )
    source_urls = _string_list(_evidence(selected_write_task).get("sourceUrls"))
    candidates = replay_report.get("consumer_candidate_pages")
    if not isinstance(candidates, list):
        raise OfficialWebSelectedWriteReleaseError(
            code="invalid_replay_report",
            message="replay report consumer_candidate_pages must be an array.",
        )
    matched: list[dict[str, object]] = []
    for item in candidates:
        candidate = _object_mapping(item)
        if candidate.get("target_job_id") != job_id:
            continue
        if candidate.get("selected_write_target") != selected_write_target:
            continue
        if source_urls and candidate.get("normalized_canonical_url") not in source_urls:
            continue
        if candidate.get("materialization_policy") != "candidate_only":
            continue
        if _object_mapping(candidate.get("quality_gate")).get("decision") != "pass":
            continue
        if not _object_mapping(candidate.get("typed_candidate")):
            continue
        matched.append(candidate)
    return matched


def _source_document(*, selected_write_task: dict[str, object]) -> dict[str, object]:
    evidence = _evidence(selected_write_task)
    return {
        "title": selected_write_task.get("inventoryId") or selected_write_task.get("inventory_id"),
        "source_refs": _string_list(evidence.get("sourceUrls")),
    }


def _selected_write_field_review(selected_write_task: dict[str, object]) -> dict[str, object]:
    evidence = _evidence(selected_write_task)
    return {
        "field_status": {
            str(key).strip(): str(value).strip()
            for key, value in _object_mapping(
                evidence.get("fieldStatus") or evidence.get("field_status")
            ).items()
            if str(key).strip() and str(value).strip()
        },
        "required_fields": _string_list(
            evidence.get("requiredFields") or evidence.get("required_fields")
        ),
        "optional_fields": _string_list(
            evidence.get("optionalFields") or evidence.get("optional_fields")
        ),
    }


def _target_label(selected_write_task: dict[str, object]) -> str:
    return str(
        _evidence(selected_write_task).get("targetLabel")
        or _evidence(selected_write_task).get("target_label")
        or ""
    ).strip()


def _candidate_source_ref(
    *,
    candidate: dict[str, object],
    selected_write_task: dict[str, object],
) -> str:
    inventory_id = _require_text(
        selected_write_task.get("inventoryId") or selected_write_task.get("inventory_id"),
        "inventoryId",
    )
    raw_version_id = _require_text(candidate.get("raw_version_id"), "candidate.raw_version_id")
    return f"official_web:{inventory_id}:{raw_version_id}"


def _release_task_model(
    release_task: Mapping[str, object] | OfficialWebReleaseTask,
) -> OfficialWebReleaseTask:
    return (
        release_task
        if isinstance(release_task, OfficialWebReleaseTask)
        else OfficialWebReleaseTask.from_payload(release_task)
    )


def _assert_selected_write_release_task(task: OfficialWebReleaseTask) -> None:
    if task.task_type not in {
        "official_web_selected_write_contact_directory",
        "official_web_selected_write_service_guide",
    }:
        raise OfficialWebSelectedWriteReleaseError(
            code="unsupported_selected_write_release_task_type",
            message=f"unsupported selected-write release task type: {task.task_type}",
        )
    if task.status not in {"claimed", "running"}:
        raise OfficialWebSelectedWriteReleaseError(
            code="selected_write_release_task_not_claimed",
            message="selected-write release task must already be claimed or running.",
        )
    _require_text(_selected_write_target_from_task(task), "selectedWriteTarget")
    _require_text(task.job_id, "jobId")
    _assert_machine_field_review_ready(task.input_ref)


def _assert_machine_field_review_ready(input_ref: Mapping[str, object]) -> None:
    field_status = _object_mapping(input_ref.get("fieldStatus") or input_ref.get("field_status"))
    if not field_status:
        raise OfficialWebSelectedWriteReleaseError(
            code="missing_machine_field_review",
            message="selected-write task evidence must include fieldStatus.",
        )
    required_fields = _string_list(
        input_ref.get("requiredFields") or input_ref.get("required_fields")
    )
    optional_fields = _string_list(
        input_ref.get("optionalFields") or input_ref.get("optional_fields")
    )
    missing_required = [
        field_name
        for field_name in required_fields
        if str(field_status.get(field_name) or "").strip() != "present"
    ]
    if missing_required:
        raise OfficialWebSelectedWriteReleaseError(
            code="machine_field_review_not_ready",
            message=(
                "selected-write task required fieldStatus is not ready: "
                + ", ".join(sorted(missing_required))
            ),
        )
    unsupported_optional = [
        field_name
        for field_name in optional_fields
        if str(field_status.get(field_name) or "").strip()
        not in {"present", "source_not_provided", "not_applicable"}
    ]
    if unsupported_optional:
        raise OfficialWebSelectedWriteReleaseError(
            code="machine_field_review_not_ready",
            message=(
                "selected-write task optional fieldStatus is not ready: "
                + ", ".join(sorted(unsupported_optional))
            ),
        )
    if not required_fields:
        raise OfficialWebSelectedWriteReleaseError(
            code="missing_machine_field_review_required_fields",
            message="selected-write task evidence must include requiredFields.",
        )


def _selected_write_task_from_release_task(task: OfficialWebReleaseTask) -> dict[str, object]:
    return {
        "evidenceJson": dict(task.input_ref),
        "inventoryId": task.inventory_id,
        "jobId": task.job_id,
        "runId": task.run_id,
        "selectedWriteId": task.task_id,
        "selectedWriteTarget": _selected_write_target_from_task(task),
    }


def _selected_write_target_from_task(task: OfficialWebReleaseTask) -> str:
    if task.selected_write_target:
        return task.selected_write_target
    if task.task_type == "official_web_selected_write_contact_directory":
        return "campus_services/contact_directory"
    if task.task_type == "official_web_selected_write_service_guide":
        return "campus_services/service_guide"
    return ""


def _resolve_object_store_settings(
    *,
    object_store_settings: ObjectStoreSettings | None,
    source_bucket: str,
) -> ObjectStoreSettings:
    settings = object_store_settings or ObjectStoreSettings(
        endpoint="http://127.0.0.1:9000",
        access_key="local",
        secret_key="local",
        bucket_source=source_bucket,
    )
    if settings.bucket_source == source_bucket:
        return settings
    return ObjectStoreSettings(
        endpoint=settings.endpoint,
        access_key=settings.access_key,
        secret_key=settings.secret_key,
        region=settings.region,
        bucket_source=source_bucket,
        bucket_derived=settings.bucket_derived,
        secure=settings.secure,
        source_access_key=settings.source_access_key,
        source_secret_key=settings.source_secret_key,
        derived_access_key=settings.derived_access_key,
        derived_secret_key=settings.derived_secret_key,
    )


def _source_bundle_key(selected_write_task: dict[str, object]) -> str:
    source_keys = _string_list(_evidence(selected_write_task).get("sourceObjectKeys"))
    for key in source_keys:
        if key.endswith("source-truth-bundle.json"):
            return key
    if source_keys:
        return source_keys[0]
    raise OfficialWebSelectedWriteReleaseError(
        code="missing_source_truth_bundle_key",
        message="selected-write task evidence has no sourceObjectKeys.",
    )


def _download_source_truth_bundle(
    *, object_store: OfficialWebSelectedWriteObjectStore, bucket: str, key: str
) -> dict[str, object]:
    payload = json.loads(object_store.get_bytes(bucket=bucket, key=key).decode("utf-8"))
    if not isinstance(payload, dict):
        raise OfficialWebSelectedWriteReleaseError(
            code="invalid_source_truth_bundle",
            message="source truth bundle must be a JSON object.",
        )
    return payload


def _read_json_object(path: Path) -> dict[str, object]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        raise OfficialWebSelectedWriteReleaseError(
            code="invalid_json",
            message=f"{path} must contain a JSON object.",
        )
    return payload


def _report_projection(
    *,
    projection_reporter: OfficialWebSelectedWriteProjectionReporter | None,
    task: OfficialWebReleaseTask,
    snapshot: dict[str, object],
    suppress_errors: bool = False,
) -> None:
    if projection_reporter is None:
        return
    payload = {
        "inventoryId": task.inventory_id,
        "jobId": task.job_id,
        "releaseId": task.release_id,
        "runId": task.run_id,
        "selectedWriteTarget": _selected_write_target_from_task(task),
        "sourceChannel": "official_web",
        "taskId": task.task_id,
        "taskType": task.task_type,
        **snapshot,
    }
    try:
        projection_reporter.report(snapshot=payload)
    except Exception:
        if not suppress_errors:
            raise


def _write_json(path: Path, payload: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def _object_mapping(value: object) -> dict[str, object]:
    return dict(value) if isinstance(value, dict) else {}


def _as_mapping(value: object) -> dict[str, object]:
    if is_dataclass(value):
        return asdict(value)
    return _object_mapping(value)


def _evidence(selected_write_task: dict[str, object]) -> dict[str, object]:
    return _object_mapping(
        selected_write_task.get("evidenceJson") or selected_write_task.get("evidence")
    )


def _string_list(value: object) -> list[str]:
    if isinstance(value, str):
        return [value] if value.strip() else []
    if isinstance(value, list):
        return [str(item).strip() for item in value if str(item).strip()]
    return []


def _unique_strings(values: Sequence[str]) -> list[str]:
    result: list[str] = []
    for value in values:
        normalized = str(value).strip()
        if normalized and normalized not in result:
            result.append(normalized)
    return result


def _require_text(value: object, field_name: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise OfficialWebSelectedWriteReleaseError(
            code="invalid_payload",
            message=f"{field_name} must be a non-empty string.",
        )
    return value.strip()


def _stable_record_id(*, prefix: str, seed: Mapping[str, object]) -> str:
    digest = hashlib.sha1(
        json.dumps(seed, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")
    ).hexdigest()[:16]
    return f"{prefix}:{digest}"


def _selected_write_release_id(*, selected_write_id: str, generated_at: str) -> str:
    timestamp = (
        generated_at.replace("-", "")
        .replace(":", "")
        .replace("+", "_")
        .replace(".", "_")
        .replace("T", "_")
    )
    return f"{selected_write_id}_{timestamp}"


def _reset_dir(path: Path) -> None:
    if path.exists():
        shutil.rmtree(path)
    path.mkdir(parents=True, exist_ok=True)


def _utcnow() -> str:
    return datetime.now(UTC).isoformat()


def main(argv: Sequence[str] | None = None) -> None:
    load_worker_env()
    args = build_parser().parse_args(list(argv) if argv is not None else None)
    settings = _resolve_object_store_settings(
        object_store_settings=ObjectStoreSettings.from_env(),
        source_bucket=args.source_bucket,
    )
    object_store = S3ObjectStoreAdmin(settings)
    release_task = _read_json_object(Path(args.release_task_path).resolve())
    task_id = _require_text(release_task.get("taskId") or release_task.get("task_id"), "taskId")
    result = release_official_web_selected_write(
        release_task=release_task,
        object_store=object_store,
        derived_object_store=object_store,
        structured_projection_publisher=build_structured_projection_publisher_from_env(
            dict(os.environ)
        ),
        work_dir=Path(args.work_dir).resolve() / task_id,
        object_store_settings=settings,
        source_bucket=args.source_bucket,
        derived_bucket=args.derived_bucket,
        declarations_path=Path(args.declarations_path).resolve()
        if args.declarations_path
        else None,
    )
    print(json.dumps(asdict(result), ensure_ascii=False, indent=2))


__all__ = [
    "OfficialWebSelectedWriteResult",
    "build_parser",
    "main",
    "release_official_web_selected_write",
]


if __name__ == "__main__":
    main()
