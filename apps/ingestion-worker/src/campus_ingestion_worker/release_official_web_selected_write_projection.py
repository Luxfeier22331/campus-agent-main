from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from pathlib import Path

from campus_ingestion_core.academic_calendar_projection import (
    ACADEMIC_CALENDAR_COLLECTION,
    ACADEMIC_CALENDAR_PROJECTION_SCHEMA_VERSION,
    write_academic_calendar_projection_release,
)
from campus_ingestion_core.contact_directory_projection import (
    CONTACT_DIRECTORY_COLLECTION,
    CONTACT_DIRECTORY_PROJECTION_SCHEMA_VERSION,
    write_contact_directory_projection_release,
)
from campus_ingestion_core.service_guide_projection import (
    SERVICE_GUIDE_COLLECTION,
    SERVICE_GUIDE_PROJECTION_SCHEMA_VERSION,
    write_service_guide_projection_release,
)
from campus_ingestion_core.structured_projection_postgres import projection_artifact_checksum

from campus_ingestion_worker.release_official_web_selected_write_common import (
    OfficialWebSelectedWriteObjectStore,
    OfficialWebSelectedWritePublisher,
    OfficialWebSelectedWriteReleaseError,
    _mapping_list,
    _PreparedSelectedWriteProjection,
)
from campus_ingestion_worker.release_official_web_selected_write_io import _release_record_lineage


@dataclass(frozen=True, slots=True)
class _ProjectionReleaseResult:
    corpus: str
    collection: str
    release_id: str
    record_count: int


def _publish_selected_write_projection(
    *,
    prepared: _PreparedSelectedWriteProjection,
    derived_object_store: OfficialWebSelectedWriteObjectStore,
    structured_projection_publisher: OfficialWebSelectedWritePublisher,
    output_dir: Path,
    release_id: str,
    generated_at: str,
    derived_bucket: str,
) -> _ProjectionReleaseResult:
    if prepared.collection == CONTACT_DIRECTORY_COLLECTION:
        return _publish_contact_directory_projection(
            prepared=prepared,
            derived_object_store=derived_object_store,
            structured_projection_publisher=structured_projection_publisher,
            output_dir=output_dir,
            release_id=release_id,
            generated_at=generated_at,
            derived_bucket=derived_bucket,
        )
    if prepared.collection == SERVICE_GUIDE_COLLECTION:
        return _publish_service_guide_projection(
            prepared=prepared,
            derived_object_store=derived_object_store,
            structured_projection_publisher=structured_projection_publisher,
            output_dir=output_dir,
            release_id=release_id,
            generated_at=generated_at,
            derived_bucket=derived_bucket,
        )
    if prepared.collection == ACADEMIC_CALENDAR_COLLECTION:
        return _publish_academic_calendar_projection(
            prepared=prepared,
            derived_object_store=derived_object_store,
            structured_projection_publisher=structured_projection_publisher,
            output_dir=output_dir,
            release_id=release_id,
            generated_at=generated_at,
            derived_bucket=derived_bucket,
        )
    raise OfficialWebSelectedWriteReleaseError(
        code="unsupported_selected_write_target",
        message=f"unsupported selected-write collection: {prepared.collection}",
    )


def _publish_contact_directory_projection(
    *,
    prepared: _PreparedSelectedWriteProjection,
    derived_object_store: OfficialWebSelectedWriteObjectStore,
    structured_projection_publisher: OfficialWebSelectedWritePublisher,
    output_dir: Path,
    release_id: str,
    generated_at: str,
    derived_bucket: str,
) -> _ProjectionReleaseResult:
    report = write_contact_directory_projection_release(
        bundle=prepared.bundle,
        output_dir=output_dir,
        release_id=release_id,
        generated_at=generated_at,
        manual_review_sources=[],
        object_store=derived_object_store,
        bucket=derived_bucket,
    )
    _publish_structured_projection(
        prepared=prepared,
        structured_projection_publisher=structured_projection_publisher,
        release_id=report.release_id,
        generated_at=generated_at,
        schema_version=CONTACT_DIRECTORY_PROJECTION_SCHEMA_VERSION,
        artifact_object_key=report.release_object_key,
    )
    return _ProjectionReleaseResult(
        corpus=prepared.corpus,
        collection=prepared.collection,
        release_id=report.release_id,
        record_count=len(_mapping_list(prepared.task_scope_bundle.get("contact_records"))),
    )


def _publish_service_guide_projection(
    *,
    prepared: _PreparedSelectedWriteProjection,
    derived_object_store: OfficialWebSelectedWriteObjectStore,
    structured_projection_publisher: OfficialWebSelectedWritePublisher,
    output_dir: Path,
    release_id: str,
    generated_at: str,
    derived_bucket: str,
) -> _ProjectionReleaseResult:
    report = write_service_guide_projection_release(
        bundle=prepared.bundle,
        output_dir=output_dir,
        release_id=release_id,
        generated_at=generated_at,
        manual_review_sources=[],
        object_store=derived_object_store,
        bucket=derived_bucket,
    )
    _publish_structured_projection(
        prepared=prepared,
        structured_projection_publisher=structured_projection_publisher,
        release_id=report.release_id,
        generated_at=generated_at,
        schema_version=SERVICE_GUIDE_PROJECTION_SCHEMA_VERSION,
        artifact_object_key=report.release_object_key,
    )
    return _ProjectionReleaseResult(
        corpus=prepared.corpus,
        collection=prepared.collection,
        release_id=report.release_id,
        record_count=len(_mapping_list(prepared.task_scope_bundle.get("service_guide_records"))),
    )


def _publish_academic_calendar_projection(
    *,
    prepared: _PreparedSelectedWriteProjection,
    derived_object_store: OfficialWebSelectedWriteObjectStore,
    structured_projection_publisher: OfficialWebSelectedWritePublisher,
    output_dir: Path,
    release_id: str,
    generated_at: str,
    derived_bucket: str,
) -> _ProjectionReleaseResult:
    report = write_academic_calendar_projection_release(
        bundle=prepared.bundle,
        output_dir=output_dir,
        release_id=release_id,
        generated_at=generated_at,
        manual_review_sources=[],
        object_store=derived_object_store,
        bucket=derived_bucket,
    )
    _publish_structured_projection(
        prepared=prepared,
        structured_projection_publisher=structured_projection_publisher,
        release_id=report.release_id,
        generated_at=generated_at,
        schema_version=ACADEMIC_CALENDAR_PROJECTION_SCHEMA_VERSION,
        artifact_object_key=report.release_object_key,
    )
    return _ProjectionReleaseResult(
        corpus=prepared.corpus,
        collection=prepared.collection,
        release_id=report.release_id,
        record_count=len(
            _mapping_list(prepared.task_scope_bundle.get("academic_calendar_records"))
        ),
    )


def _publish_structured_projection(
    *,
    prepared: _PreparedSelectedWriteProjection,
    structured_projection_publisher: OfficialWebSelectedWritePublisher,
    release_id: str,
    generated_at: str,
    schema_version: str,
    artifact_object_key: str,
) -> object:
    return structured_projection_publisher.publish_release(
        corpus=prepared.corpus,
        collection=prepared.collection,
        release_id=release_id,
        generated_at=generated_at,
        schema_version=schema_version,
        artifact_object_key=artifact_object_key,
        artifact_checksum=projection_artifact_checksum(prepared.bundle),
        bundle=prepared.bundle,
        validation_status="valid",
    )


def _projection_record_count(bundle: Mapping[str, object], collection: str) -> int:
    return len(_mapping_list(bundle.get(_records_field_for_collection(collection))))


def _projection_display_names(bundle: Mapping[str, object], collection: str) -> list[str]:
    records_field = _records_field_for_collection(collection)
    return [
        str(record.get("display_name") or "").strip()
        for record in _mapping_list(bundle.get(records_field))
        if str(record.get("display_name") or "").strip()
    ]


def _records_field_for_collection(collection: str) -> str:
    if collection == CONTACT_DIRECTORY_COLLECTION:
        return "contact_records"
    if collection == SERVICE_GUIDE_COLLECTION:
        return "service_guide_records"
    if collection == ACADEMIC_CALENDAR_COLLECTION:
        return "academic_calendar_records"
    raise OfficialWebSelectedWriteReleaseError(
        code="unsupported_selected_write_target",
        message=f"unsupported selected-write collection: {collection}",
    )


def _task_scope_preview_bundle(
    *,
    full_bundle: Mapping[str, object],
    records_field: str,
) -> dict[str, object]:
    task_scope_records = [
        record
        for record in _mapping_list(full_bundle.get(records_field))
        if str(record.get("release_record_state") or "").strip() == "newly_selected"
    ]
    return {
        **dict(full_bundle),
        records_field: task_scope_records,
        "release_record_lineage": _release_record_lineage(task_scope_records),
    }
