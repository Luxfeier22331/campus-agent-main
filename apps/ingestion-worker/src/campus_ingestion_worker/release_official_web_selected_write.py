from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
from collections.abc import Mapping, Sequence
from dataclasses import asdict, dataclass, is_dataclass
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any, Protocol

from campus_ingestion_core import (
    DEFAULT_BUCKET_SOURCE,
    ObjectStoreSettings,
    replay_official_web_source_truth_local,
)
from campus_ingestion_core.academic_calendar_projection import (
    ACADEMIC_CALENDAR_COLLECTION,
    ACADEMIC_CALENDAR_CORPUS,
    ACADEMIC_CALENDAR_PROJECTION_FILENAME,
    ACADEMIC_CALENDAR_PROJECTION_SCHEMA_VERSION,
    OFFICIAL_WEB_CURATED_ACADEMIC_CALENDAR_SOURCE_FAMILY,
    assert_academic_calendar_projection_release_ready,
    write_academic_calendar_projection_release,
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
from campus_ingestion_core.official_web_target_labeling import (
    choose_official_web_contact_display_name,
    choose_official_web_service_name,
)
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


_TARGET_INVENTORY_SOURCE_URLS_BY_ID: dict[str, list[str]] | None = None


@dataclass(frozen=True, slots=True)
class OfficialWebSelectedWriteResult:
    selected_write_id: str
    status: str
    corpus: str
    collection: str
    release_id: str
    record_count: int
    full_record_count: int
    task_scope_display_names: list[str]
    full_impact_display_names: list[str]
    work_dir: str
    source_bundle_key: str


@dataclass(frozen=True, slots=True)
class OfficialWebSelectedWritePreviewResult:
    selected_write_id: str
    status: str
    corpus: str
    collection: str
    record_count: int
    full_record_count: int
    work_dir: str
    source_bundle_key: str
    bundle: dict[str, object]
    full_bundle: dict[str, object]


@dataclass(frozen=True, slots=True)
class _PreparedSelectedWriteProjection:
    selected_write_id: str
    source_bundle_key: str
    generated_at: str
    corpus: str
    collection: str
    bundle: dict[str, object]
    task_scope_bundle: dict[str, object]


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
    prepared = _prepare_selected_write_projection(
        release_task=release_task,
        object_store=object_store,
        derived_object_store=derived_object_store,
        projection_reporter=projection_reporter,
        work_dir=work_dir,
        object_store_settings=object_store_settings,
        source_bucket=source_bucket,
        derived_bucket=derived_bucket,
        declarations_path=declarations_path,
    )
    release_output_dir = work_dir / "release-output"
    _reset_dir(release_output_dir)
    release_id = _selected_write_release_id(
        selected_write_id=prepared.selected_write_id,
        generated_at=prepared.generated_at,
    )
    result = _publish_selected_write_projection(
        prepared=prepared,
        derived_object_store=derived_object_store,
        structured_projection_publisher=structured_projection_publisher,
        output_dir=release_output_dir,
        release_id=release_id,
        generated_at=prepared.generated_at,
        derived_bucket=(
            derived_bucket
            or _resolve_object_store_settings(
                object_store_settings=object_store_settings,
                source_bucket=source_bucket,
            ).bucket_derived
        ),
    )
    _report_projection(
        projection_reporter=projection_reporter,
        task=_release_task_model(release_task),
        snapshot={
            "execution": {
                "collection": result.collection,
                "corpus": result.corpus,
                "fullImpactDisplayNames": _projection_display_names(
                    prepared.bundle,
                    prepared.collection,
                ),
                "fullRecordCount": _projection_record_count(prepared.bundle, prepared.collection),
                "recordCount": result.record_count,
                "releaseId": result.release_id,
                "sourceBundleKey": prepared.source_bundle_key,
                "taskScopeDisplayNames": _projection_display_names(
                    prepared.task_scope_bundle,
                    prepared.collection,
                ),
            },
            "status": "published",
            "updatedAt": _utcnow(),
        },
    )
    return OfficialWebSelectedWriteResult(
        selected_write_id=prepared.selected_write_id,
        status="published",
        corpus=result.corpus,
        collection=result.collection,
        release_id=result.release_id,
        record_count=result.record_count,
        full_record_count=_projection_record_count(prepared.bundle, prepared.collection),
        task_scope_display_names=_projection_display_names(
            prepared.task_scope_bundle,
            prepared.collection,
        ),
        full_impact_display_names=_projection_display_names(prepared.bundle, prepared.collection),
        work_dir=str(work_dir.resolve()),
        source_bundle_key=prepared.source_bundle_key,
    )


def preview_official_web_selected_write(
    *,
    release_task: Mapping[str, object] | OfficialWebReleaseTask,
    object_store: OfficialWebSelectedWriteObjectStore,
    work_dir: Path,
    projection_reporter: OfficialWebSelectedWriteProjectionReporter | None = None,
    object_store_settings: ObjectStoreSettings | None = None,
    source_bucket: str = DEFAULT_BUCKET_SOURCE,
    derived_bucket: str | None = None,
    declarations_path: Path | None = None,
) -> OfficialWebSelectedWritePreviewResult:
    preview_output_dir = work_dir / "preview-output"
    _reset_dir(preview_output_dir)
    prepared = _prepare_selected_write_projection(
        release_task=release_task,
        object_store=object_store,
        derived_object_store=object_store,
        projection_reporter=projection_reporter,
        work_dir=work_dir,
        object_store_settings=object_store_settings,
        source_bucket=source_bucket,
        derived_bucket=derived_bucket,
        declarations_path=declarations_path,
    )
    _write_json(preview_output_dir / "projection-bundle.json", prepared.task_scope_bundle)
    _write_json(preview_output_dir / "full-projection-bundle.json", prepared.bundle)
    _report_projection(
        projection_reporter=projection_reporter,
        task=_release_task_model(release_task),
        snapshot={
            "execution": {
                "collection": prepared.collection,
                "corpus": prepared.corpus,
                "recordCount": _projection_record_count(
                    prepared.task_scope_bundle, prepared.collection
                ),
                "fullRecordCount": _projection_record_count(prepared.bundle, prepared.collection),
                "sourceBundleKey": prepared.source_bundle_key,
            },
            "status": "previewed",
            "updatedAt": _utcnow(),
        },
    )
    return OfficialWebSelectedWritePreviewResult(
        selected_write_id=prepared.selected_write_id,
        status="previewed",
        corpus=prepared.corpus,
        collection=prepared.collection,
        record_count=_projection_record_count(prepared.task_scope_bundle, prepared.collection),
        full_record_count=_projection_record_count(prepared.bundle, prepared.collection),
        work_dir=str(work_dir.resolve()),
        source_bundle_key=prepared.source_bundle_key,
        bundle=prepared.task_scope_bundle,
        full_bundle=prepared.bundle,
    )


def _prepare_selected_write_projection(
    *,
    release_task: Mapping[str, object] | OfficialWebReleaseTask,
    object_store: OfficialWebSelectedWriteObjectStore,
    derived_object_store: OfficialWebSelectedWriteObjectStore,
    projection_reporter: OfficialWebSelectedWriteProjectionReporter | None,
    work_dir: Path,
    object_store_settings: ObjectStoreSettings | None,
    source_bucket: str,
    derived_bucket: str | None,
    declarations_path: Path | None,
) -> _PreparedSelectedWriteProjection:
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
    _reset_dir(replay_input_dir)
    _reset_dir(projection_output_dir)

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
        selected_write_target = _require_text(
            selected_write_task.get("selectedWriteTarget")
            or selected_write_task.get("selected_write_target"),
            "selectedWriteTarget",
        )
        if selected_write_target == "campus_services/contact_directory":
            bundle = _build_contact_directory_bundle(
                candidates=candidates,
                selected_write_task=selected_write_task,
                generated_at=generated_at,
                derived_bucket=runtime_derived_bucket,
                object_store=derived_object_store,
            )
            collection = CONTACT_DIRECTORY_COLLECTION
            corpus = CONTACT_DIRECTORY_CORPUS
        elif selected_write_target == "campus_services/service_guide":
            bundle = _build_service_guide_bundle(
                candidates=candidates,
                selected_write_task=selected_write_task,
                task_created_at=task.created_at,
                generated_at=generated_at,
                derived_bucket=runtime_derived_bucket,
                object_store=derived_object_store,
            )
            collection = SERVICE_GUIDE_COLLECTION
            corpus = SERVICE_GUIDE_CORPUS
        elif selected_write_target == "calendar/academic_calendar":
            bundle = _build_academic_calendar_bundle(
                candidates=candidates,
                selected_write_task=selected_write_task,
                generated_at=generated_at,
                object_store=derived_object_store,
                derived_bucket=runtime_derived_bucket,
            )
            collection = ACADEMIC_CALENDAR_COLLECTION
            corpus = ACADEMIC_CALENDAR_CORPUS
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
                    "collection": collection,
                    "corpus": corpus,
                    "recordCount": _projection_record_count(bundle, collection),
                },
                "status": "materialized",
                "updatedAt": _utcnow(),
            },
        )
        return _PreparedSelectedWriteProjection(
            selected_write_id=selected_write_id,
            source_bundle_key=source_bundle_key,
            generated_at=generated_at,
            corpus=corpus,
            collection=collection,
            bundle=bundle,
            task_scope_bundle=_task_scope_preview_bundle(
                full_bundle=bundle,
                records_field=_records_field_for_collection(collection),
            ),
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
        report = write_contact_directory_projection_release(
            bundle=prepared.bundle,
            output_dir=output_dir,
            release_id=release_id,
            generated_at=generated_at,
            manual_review_sources=[],
            object_store=derived_object_store,
            bucket=derived_bucket,
        )
        structured_projection_publisher.publish_release(
            corpus=prepared.corpus,
            collection=prepared.collection,
            release_id=report.release_id,
            generated_at=generated_at,
            schema_version=CONTACT_DIRECTORY_PROJECTION_SCHEMA_VERSION,
            artifact_object_key=report.release_object_key,
            artifact_checksum=projection_artifact_checksum(prepared.bundle),
            bundle=prepared.bundle,
            validation_status="valid",
        )
        return _ProjectionReleaseResult(
            corpus=prepared.corpus,
            collection=prepared.collection,
            release_id=report.release_id,
            record_count=len(_mapping_list(prepared.task_scope_bundle.get("contact_records"))),
        )
    if prepared.collection == SERVICE_GUIDE_COLLECTION:
        report = write_service_guide_projection_release(
            bundle=prepared.bundle,
            output_dir=output_dir,
            release_id=release_id,
            generated_at=generated_at,
            manual_review_sources=[],
            object_store=derived_object_store,
            bucket=derived_bucket,
        )
        structured_projection_publisher.publish_release(
            corpus=prepared.corpus,
            collection=prepared.collection,
            release_id=report.release_id,
            generated_at=generated_at,
            schema_version=SERVICE_GUIDE_PROJECTION_SCHEMA_VERSION,
            artifact_object_key=report.release_object_key,
            artifact_checksum=projection_artifact_checksum(prepared.bundle),
            bundle=prepared.bundle,
            validation_status="valid",
        )
        return _ProjectionReleaseResult(
            corpus=prepared.corpus,
            collection=prepared.collection,
            release_id=report.release_id,
            record_count=len(
                _mapping_list(prepared.task_scope_bundle.get("service_guide_records"))
            ),
        )
    if prepared.collection == ACADEMIC_CALENDAR_COLLECTION:
        report = write_academic_calendar_projection_release(
            bundle=prepared.bundle,
            output_dir=output_dir,
            release_id=release_id,
            generated_at=generated_at,
            manual_review_sources=[],
            object_store=derived_object_store,
            bucket=derived_bucket,
        )
        structured_projection_publisher.publish_release(
            corpus=prepared.corpus,
            collection=prepared.collection,
            release_id=report.release_id,
            generated_at=generated_at,
            schema_version=ACADEMIC_CALENDAR_PROJECTION_SCHEMA_VERSION,
            artifact_object_key=report.release_object_key,
            artifact_checksum=projection_artifact_checksum(prepared.bundle),
            bundle=prepared.bundle,
            validation_status="valid",
        )
        return _ProjectionReleaseResult(
            corpus=prepared.corpus,
            collection=prepared.collection,
            release_id=report.release_id,
            record_count=len(
                _mapping_list(prepared.task_scope_bundle.get("academic_calendar_records"))
            ),
        )
    raise OfficialWebSelectedWriteReleaseError(
        code="unsupported_selected_write_target",
        message=f"unsupported selected-write collection: {prepared.collection}",
    )


def _projection_record_count(bundle: Mapping[str, object], collection: str) -> int:
    if collection == CONTACT_DIRECTORY_COLLECTION:
        return len(_mapping_list(bundle.get("contact_records")))
    if collection == SERVICE_GUIDE_COLLECTION:
        return len(_mapping_list(bundle.get("service_guide_records")))
    if collection == ACADEMIC_CALENDAR_COLLECTION:
        return len(_mapping_list(bundle.get("academic_calendar_records")))
    return 0


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
    bundle = _build_contact_directory_bundle(
        candidates=candidates,
        selected_write_task=selected_write_task,
        generated_at=generated_at,
        object_store=object_store,
        derived_bucket=derived_bucket,
    )
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


def _release_service_guide_candidates(
    *,
    candidates: list[dict[str, object]],
    selected_write_task: dict[str, object],
    task_created_at: datetime,
    output_dir: Path,
    release_id: str,
    generated_at: str,
    object_store: OfficialWebSelectedWriteObjectStore,
    derived_bucket: str,
    structured_projection_publisher: OfficialWebSelectedWritePublisher,
) -> _ProjectionReleaseResult:
    bundle = _build_service_guide_bundle(
        candidates=candidates,
        selected_write_task=selected_write_task,
        task_created_at=task_created_at,
        generated_at=generated_at,
        object_store=object_store,
        derived_bucket=derived_bucket,
    )
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


def _build_service_guide_bundle(
    *,
    candidates: list[dict[str, object]],
    selected_write_task: dict[str, object],
    task_created_at: datetime,
    generated_at: str,
    object_store: OfficialWebSelectedWriteObjectStore,
    derived_bucket: str,
) -> dict[str, object]:
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
            )
        ],
        "conflict_records": [],
        "manual_review_sources": [],
    }
    bundle["service_guide_records"] = [
        _with_public_service_guide_source_refs(
            record=record,
            selected_write_task=selected_write_task,
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
        _with_carried_forward_source_urls(
            record={**record, "release_record_state": "carried_forward"}
        )
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
    if not source_ref.startswith("official_web:"):
        return ""
    parts = source_ref.split(":", 2)
    if len(parts) < 3:
        return ""
    return parts[1].strip()


def _with_carried_forward_source_urls(*, record: dict[str, object]) -> dict[str, object]:
    source_urls = _public_source_urls_for_record(record)
    if not source_urls:
        return record

    def patch_mapping(value: object) -> object:
        if isinstance(value, list):
            return [patch_mapping(item) for item in value]
        if not isinstance(value, dict):
            return value
        patched = {key: patch_mapping(item) for key, item in value.items()}
        source_refs = _string_list(patched.get("source_refs"))
        if source_refs:
            patched["source_refs"] = _unique_strings([*source_refs, *source_urls])
        return patched

    patched_record = patch_mapping(record)
    return dict(patched_record) if isinstance(patched_record, dict) else record


def _public_source_urls_for_record(record: Mapping[str, object]) -> list[str]:
    urls: list[str] = []
    for source_ref in _string_list(record.get("source_refs")):
        inventory_id = _official_web_inventory_id_from_source_ref(source_ref)
        if not inventory_id:
            continue
        urls.extend(_source_urls_for_inventory_id(inventory_id))
    return _unique_strings(urls)


def _source_urls_for_inventory_id(inventory_id: str) -> list[str]:
    global _TARGET_INVENTORY_SOURCE_URLS_BY_ID
    if _TARGET_INVENTORY_SOURCE_URLS_BY_ID is not None:
        return list(_TARGET_INVENTORY_SOURCE_URLS_BY_ID.get(inventory_id, []))
    inventory_path = (
        Path(__file__).resolve().parents[4]
        / "configs"
        / "sources"
        / "official_web"
        / "muc_public"
        / "target-inventory.json"
    )
    try:
        inventory = json.loads(inventory_path.read_text(encoding="utf-8"))
    except Exception:
        _TARGET_INVENTORY_SOURCE_URLS_BY_ID = {}
        return []
    urls_by_id: dict[str, list[str]] = {}
    for entry in _mapping_list(inventory.get("entries")):
        entry_inventory_id = str(entry.get("inventory_id") or "").strip()
        if entry_inventory_id:
            urls_by_id[entry_inventory_id] = _string_list(entry.get("source_urls"))
    _TARGET_INVENTORY_SOURCE_URLS_BY_ID = urls_by_id
    return list(urls_by_id.get(inventory_id, []))


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
    process_steps = _string_list(typed_candidate.get("process_steps"))
    procedure_groups = _mapping_list(typed_candidate.get("procedure_groups"))
    materials = _string_list(typed_candidate.get("materials"))
    entry_points = _string_list(typed_candidate.get("entry_points"))
    responsible_offices = _string_list(typed_candidate.get("responsible_office"))
    field_source_urls = _object_mapping(typed_candidate.get("field_source_urls"))
    process_source_refs = _candidate_field_source_refs(
        field_source_urls=field_source_urls,
        field_name="process_steps",
        fallback_source_ref=source_ref,
    )
    procedure_group_source_refs = _candidate_field_source_refs(
        field_source_urls=field_source_urls,
        field_name="procedure_groups",
        fallback_source_ref=source_ref,
    )
    material_source_refs = _candidate_field_source_refs(
        field_source_urls=field_source_urls,
        field_name="materials",
        fallback_source_ref=source_ref,
    )
    entry_source_refs = _candidate_field_source_refs(
        field_source_urls=field_source_urls,
        field_name="entry_points",
        fallback_source_ref=source_ref,
    )
    office_source_refs = _candidate_field_source_refs(
        field_source_urls=field_source_urls,
        field_name="responsible_office",
        fallback_source_ref=source_ref,
    )
    contact_source_refs = _candidate_field_source_refs(
        field_source_urls=field_source_urls,
        field_name="contacts",
        fallback_source_ref=source_ref,
    )
    contacts = _object_mapping(typed_candidate.get("contacts"))
    office_hours = _string_list(contacts.get("office_hours"))
    canonical_source_ref = _candidate_source_ref(
        candidate=candidate,
        selected_write_task=selected_write_task,
    )
    public_source_refs = _unique_strings(
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
    contact_refs = _service_guide_contact_refs(
        contacts=contacts,
        display_name=display_name,
        responsible_offices=responsible_offices,
        service_id=service_id,
        source_ref=contact_source_refs[0],
    )
    guide_sections = _service_guide_sections(
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
    )
    selected_write_field_review = _selected_write_field_review(selected_write_task)
    return {
        "service_id": service_id,
        "display_name": display_name,
        "aliases": _unique_strings(
            [
                display_name,
                source_title,
                _target_label(selected_write_task),
                *_official_web_service_aliases(
                    display_name=display_name, source_title=source_title
                ),
                *_string_list(typed_candidate.get("aliases")),
            ]
        ),
        "category": "campus_service",
        "campus_scope": "all",
        "audience": ["unknown"],
        "effective_from": _selected_write_effective_from(task_created_at, generated_at),
        "effective_until": "9999-12-31T23:59:59+00:00",
        "source_refs": public_source_refs,
        "guide_sections": guide_sections,
        "procedure_groups": _service_guide_procedure_groups(
            service_id=service_id,
            procedure_groups=procedure_groups,
            fallback_source_refs=procedure_group_source_refs,
        ),
        "materials": [
            {
                "material_id": f"{service_id}:material:{index}",
                "name": material,
                "required": True,
                "note": "",
                "source_refs": material_source_refs,
            }
            for index, material in enumerate(materials, start=1)
        ],
        "entry_refs": [
            {
                "entry_id": f"{service_id}:entry:{index}",
                "label": entry,
                "entry_type": "online_url" if _service_entry_url(entry) else "web_page",
                "url": _service_entry_url(entry),
                "location_ref": "",
                "source_refs": entry_source_refs,
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
                "source_refs": contact_source_refs,
            }
            for index, hours in enumerate(office_hours, start=1)
        ],
        "contact_refs": contact_refs,
        "eligibility_notes": [],
        "extraction_status": "ready",
        **selected_write_field_review,
    }


def _service_guide_record_from_candidates(
    *,
    candidates: list[dict[str, object]],
    selected_write_task: dict[str, object],
    task_created_at: datetime,
    generated_at: str,
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
        )
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
    source_refs = _public_source_refs_for_selected_write_task(selected_write_task)
    source_ref = source_refs[0]
    service_id = _stable_record_id(
        prefix="service:official_web",
        seed={
            "display_name": display_name,
            "inventory_id": selected_write_task.get("inventoryId"),
            "source_refs": source_refs,
        },
    )
    process_items = _service_guide_items_by_source(
        candidates=candidates,
        field_name="process_steps",
        fallback_source_ref=source_ref,
    )
    procedure_groups = _merged_service_guide_procedure_groups(
        candidates=candidates,
        fallback_source_ref=source_ref,
    )
    material_items = _service_guide_items_by_source(
        candidates=candidates,
        field_name="materials",
        fallback_source_ref=source_ref,
    )
    entry_items = _service_guide_items_by_source(
        candidates=candidates,
        field_name="entry_points",
        fallback_source_ref=source_ref,
    )
    office_items = _service_guide_items_by_source(
        candidates=candidates,
        field_name="responsible_office",
        fallback_source_ref=source_ref,
    )
    contacts = _merged_service_guide_contacts(candidates)
    contact_refs = _service_guide_contact_refs(
        contacts=contacts,
        display_name=display_name,
        responsible_offices=[item["text"] for item in office_items],
        service_id=service_id,
        source_ref=source_ref,
    )
    selected_write_field_review = _selected_write_field_review(selected_write_task)
    return {
        "service_id": service_id,
        "display_name": display_name,
        "aliases": _unique_strings(
            [
                display_name,
                source_title,
                _target_label(selected_write_task),
                *_official_web_service_aliases(
                    display_name=display_name, source_title=source_title
                ),
                *[
                    alias
                    for typed in typed_candidates
                    for alias in _string_list(typed.get("aliases"))
                ],
            ]
        ),
        "category": "campus_service",
        "campus_scope": "all",
        "audience": ["unknown"],
        "effective_from": _selected_write_effective_from(task_created_at, generated_at),
        "effective_until": "9999-12-31T23:59:59+00:00",
        "source_refs": source_refs,
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
            procedure_groups=procedure_groups,
            fallback_source_refs=source_refs,
        ),
        "materials": [
            {
                "material_id": f"{service_id}:material:{index}",
                "name": item["text"],
                "required": True,
                "note": "",
                "source_refs": [item["source_ref"]],
            }
            for index, item in enumerate(material_items, start=1)
        ],
        "entry_refs": [
            {
                "entry_id": f"{service_id}:entry:{index}",
                "label": item["text"],
                "entry_type": "online_url" if _service_entry_url(item["text"]) else "web_page",
                "url": _service_entry_url(item["text"]),
                "location_ref": "",
                "source_refs": [item["source_ref"]],
            }
            for index, item in enumerate(entry_items, start=1)
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
            for index, hours in enumerate(_string_list(contacts.get("office_hours")), start=1)
        ],
        "contact_refs": contact_refs,
        "eligibility_notes": [],
        "extraction_status": "ready",
        **selected_write_field_review,
    }


def _with_public_service_guide_source_refs(
    *,
    record: dict[str, object],
    selected_write_task: dict[str, object],
) -> dict[str, object]:
    source_refs = _unique_strings(
        [
            *_string_list(record.get("source_refs")),
            *_public_source_refs_for_selected_write_task(selected_write_task),
        ]
    )
    primary_source_ref = source_refs[0]

    def replace_item_sources(value: object) -> list[dict[str, object]]:
        return [
            {
                **item,
                "source_refs": _public_item_source_refs(
                    item=item,
                    public_source_refs=source_refs,
                    fallback_source_ref=primary_source_ref,
                ),
            }
            for item in _mapping_list(value)
        ]

    def replace_procedure_group_sources(value: object) -> list[dict[str, object]]:
        groups: list[dict[str, object]] = []
        for group in _mapping_list(value):
            steps = [
                {
                    **step,
                    "source_refs": _public_item_source_refs(
                        item=step,
                        public_source_refs=source_refs,
                        fallback_source_ref=primary_source_ref,
                    ),
                }
                for step in _mapping_list(group.get("steps"))
            ]
            groups.append(
                {
                    **group,
                    "steps": steps,
                    "source_refs": _public_item_source_refs(
                        item=group,
                        public_source_refs=source_refs,
                        fallback_source_ref=primary_source_ref,
                    ),
                }
            )
        return groups

    return {
        **record,
        "source_refs": source_refs,
        "guide_sections": replace_item_sources(record.get("guide_sections")),
        "procedure_groups": replace_procedure_group_sources(record.get("procedure_groups")),
        "materials": replace_item_sources(record.get("materials")),
        "entry_refs": replace_item_sources(record.get("entry_refs")),
        "office_hours": replace_item_sources(record.get("office_hours")),
        "contact_refs": replace_item_sources(record.get("contact_refs")),
    }


def _candidate_field_source_refs(
    *,
    field_source_urls: Mapping[str, object],
    field_name: str,
    fallback_source_ref: str,
) -> list[str]:
    return _unique_strings(_string_list(field_source_urls.get(field_name)) or [fallback_source_ref])


def _public_item_source_refs(
    *,
    item: Mapping[str, object],
    public_source_refs: Sequence[str],
    fallback_source_ref: str,
) -> list[str]:
    source_refs = _string_list(item.get("source_refs"))
    if not source_refs:
        return [fallback_source_ref]
    public_ref_set = set(public_source_refs)
    public_refs = [source_ref for source_ref in source_refs if source_ref in public_ref_set]
    return _unique_strings(public_refs or [fallback_source_ref])


def _selected_write_effective_from(
    task_created_at: datetime,
    generated_at: str,
) -> str:
    if task_created_at.tzinfo is not None:
        return (
            task_created_at.astimezone(UTC)
            .replace(
                hour=0,
                minute=0,
                second=0,
                microsecond=0,
            )
            .isoformat()
        )
    return generated_at


def _service_entry_url(entry: str) -> str:
    normalized = entry.strip()
    if normalized.startswith(("http://", "https://")):
        return normalized
    if normalized.lower() in {"rz.muc.edu.cn", "mail.muc.edu.cn", "vpn.muc.edu.cn"}:
        return f"https://{normalized.lower()}"
    return ""


def _official_web_service_aliases(*, display_name: str, source_title: str) -> list[str]:
    aliases: list[str] = []
    normalized_display = display_name.strip()
    normalized_source = source_title.strip()
    if "电子邮件" in normalized_display or "电子邮件" in normalized_source:
        aliases.append("校园邮箱")
    if "校园网认证" in normalized_display or "校园网新版认证系统" in normalized_source:
        aliases.extend(["校园网认证", "上网认证"])
    if "VPN" in normalized_display or "VPN" in normalized_source.upper():
        aliases.extend(["VPN", "vpn"])
    if "信息公开" in normalized_display or "信息公开" in normalized_source:
        aliases.extend(["信息公开申请流程", "信息公开申请"])
    if "校园卡" in normalized_display or "校园卡" in normalized_source:
        aliases.extend(["校园卡", "一卡通", "校园卡补办", "校园卡挂失"])
    return _unique_strings(aliases)


def _official_web_contact_aliases(*, display_name: str, source_title: str) -> list[str]:
    aliases: list[str] = []
    normalized_display = display_name.strip()
    normalized_source = source_title.strip()
    if "信息化服务" in normalized_display or "信息化服务" in normalized_source:
        aliases.append("信息化办")
    if "信息公开" in normalized_display or "信息公开" in normalized_source:
        aliases.append("信息公开")
    return _unique_strings(aliases)


def _service_guide_sections(
    *,
    service_id: str,
    display_name: str,
    process_steps: list[str],
    materials: list[str],
    entry_points: list[str],
    responsible_offices: list[str],
    process_source_refs: list[str],
    material_source_refs: list[str],
    entry_source_refs: list[str],
    office_source_refs: list[str],
    fallback_source_ref: str,
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
                "source_refs": process_source_refs,
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
                "source_refs": material_source_refs,
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
                "source_refs": entry_source_refs,
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
                "source_refs": office_source_refs,
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
            "source_refs": [fallback_source_ref],
        }
    ]


def _service_guide_sections_from_items(
    *,
    service_id: str,
    display_name: str,
    process_items: list[dict[str, str]],
    material_items: list[dict[str, str]],
    entry_items: list[dict[str, str]],
    office_items: list[dict[str, str]],
    fallback_source_ref: str,
) -> list[dict[str, object]]:
    sections: list[dict[str, object]] = []
    if process_items:
        sections.append(
            {
                "section_id": f"{service_id}:section:procedure",
                "section_type": "procedure",
                "title": display_name,
                "content": "\n".join(
                    f"{index}. {item['text']}" for index, item in enumerate(process_items, start=1)
                ),
                "order": 1,
                "source_refs": _unique_strings([item["source_ref"] for item in process_items]),
            }
        )
    if material_items:
        sections.append(
            {
                "section_id": f"{service_id}:section:required_materials",
                "section_type": "required_materials",
                "title": "申请材料",
                "content": "\n".join(item["text"] for item in material_items),
                "order": 2,
                "source_refs": _unique_strings([item["source_ref"] for item in material_items]),
            }
        )
    if entry_items:
        sections.append(
            {
                "section_id": f"{service_id}:section:entry",
                "section_type": "entry",
                "title": "办理入口",
                "content": "\n".join(item["text"] for item in entry_items),
                "order": 3,
                "source_refs": _unique_strings([item["source_ref"] for item in entry_items]),
            }
        )
    if office_items:
        sections.append(
            {
                "section_id": f"{service_id}:section:contact",
                "section_type": "contact",
                "title": "负责部门",
                "content": "\n".join(item["text"] for item in office_items),
                "order": 4,
                "source_refs": _unique_strings([item["source_ref"] for item in office_items]),
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
            "source_refs": [fallback_source_ref],
        }
    ]


def _service_guide_items_by_source(
    *,
    candidates: Sequence[Mapping[str, object]],
    field_name: str,
    fallback_source_ref: str,
) -> list[dict[str, str]]:
    items: list[dict[str, str]] = []
    seen: set[tuple[str, str]] = set()
    for candidate in candidates:
        typed_candidate = _object_mapping(candidate.get("typed_candidate"))
        source_ref = _candidate_public_source_ref(candidate) or fallback_source_ref
        for text in _string_list(typed_candidate.get(field_name)):
            key = (text, source_ref)
            if key in seen:
                continue
            seen.add(key)
            items.append({"text": text, "source_ref": source_ref})
    return items


def _merged_service_guide_procedure_groups(
    *,
    candidates: Sequence[Mapping[str, object]],
    fallback_source_ref: str,
) -> list[dict[str, object]]:
    merged: list[dict[str, object]] = []
    seen: set[str] = set()
    for candidate in candidates:
        typed_candidate = _object_mapping(candidate.get("typed_candidate"))
        for group in _mapping_list(typed_candidate.get("procedure_groups")):
            group_id = str(group.get("group_id") or "").strip()
            if not group_id or group_id in seen:
                continue
            seen.add(group_id)
            merged.append(
                {
                    **group,
                    "source_refs": _unique_strings(
                        _string_list(group.get("source_refs"))
                        or [_candidate_public_source_ref(candidate) or fallback_source_ref]
                    ),
                }
            )
    return merged


def _service_guide_procedure_groups(
    *,
    service_id: str,
    procedure_groups: Sequence[Mapping[str, object]],
    fallback_source_refs: Sequence[str],
) -> list[dict[str, object]]:
    groups: list[dict[str, object]] = []
    for order, group in enumerate(procedure_groups, start=1):
        group_id = (
            str(group.get("group_id") or "").strip() or f"{service_id}:procedure_group:{order}"
        )
        title = str(group.get("title") or "").strip()
        if not title:
            continue
        raw_steps = _mapping_list(group.get("steps"))
        steps: list[dict[str, object]] = []
        for step_order, raw_step in enumerate(raw_steps, start=1):
            content = str(raw_step.get("content") or "").strip()
            if not content:
                continue
            step_id = str(raw_step.get("step_id") or "").strip() or f"{group_id}:step:{step_order}"
            steps.append(
                {
                    "step_id": step_id,
                    "content": content,
                    "order": step_order,
                    "source_refs": _unique_strings(
                        _string_list(raw_step.get("source_refs")) or list(fallback_source_refs)
                    ),
                }
            )
        if not steps:
            continue
        groups.append(
            {
                "group_id": group_id,
                "title": title,
                "focus_tags": _string_list(group.get("focus_tags")),
                "order": int(group.get("order") or order),
                "steps": steps,
                "source_refs": _unique_strings(
                    _string_list(group.get("source_refs")) or list(fallback_source_refs)
                ),
            }
        )
    return groups


def _merged_service_guide_contacts(
    candidates: Sequence[Mapping[str, object]],
) -> dict[str, object]:
    merged: dict[str, list[str]] = {
        "emails": [],
        "locations": [],
        "office_hours": [],
        "phones": [],
    }
    for candidate in candidates:
        contacts = _object_mapping(
            _object_mapping(candidate.get("typed_candidate")).get("contacts")
        )
        for key in merged:
            merged[key].extend(_string_list(contacts.get(key)))
    return {key: _unique_strings(values) for key, values in merged.items()}


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


def _candidate_public_source_ref(candidate: Mapping[str, object]) -> str:
    typed_candidate = _object_mapping(candidate.get("typed_candidate"))
    return str(
        typed_candidate.get("source_url") or candidate.get("normalized_canonical_url") or ""
    ).strip()


def _public_source_refs_for_selected_write_task(
    selected_write_task: dict[str, object],
) -> list[str]:
    evidence = _evidence(selected_write_task)
    urls = _string_list(evidence.get("sourceUrls") or evidence.get("source_urls"))
    refs = []
    for item in _mapping_list(evidence.get("sourceRefs") or evidence.get("source_refs")):
        ref_url = str(
            item.get("normalized_canonical_url") or item.get("normalizedCanonicalUrl") or ""
        ).strip()
        if ref_url:
            refs.append(ref_url)
    return _unique_strings([*urls, *refs])


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
        "official_web_selected_write_academic_calendar",
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
        "createdAt": task.created_at.isoformat(),
        "evidenceJson": dict(task.input_ref),
        "inventoryId": task.inventory_id,
        "jobId": task.job_id,
        "runId": task.run_id,
        "selectedWriteId": task.task_id,
        "selectedWriteTarget": _selected_write_target_from_task(task),
        "updatedAt": task.updated_at.isoformat(),
    }


def _selected_write_target_from_task(task: OfficialWebReleaseTask) -> str:
    if task.selected_write_target:
        return task.selected_write_target
    if task.task_type == "official_web_selected_write_contact_directory":
        return "campus_services/contact_directory"
    if task.task_type == "official_web_selected_write_service_guide":
        return "campus_services/service_guide"
    if task.task_type == "official_web_selected_write_academic_calendar":
        return "calendar/academic_calendar"
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
    "OfficialWebSelectedWritePreviewResult",
    "OfficialWebSelectedWriteResult",
    "build_parser",
    "main",
    "preview_official_web_selected_write",
    "release_official_web_selected_write",
]


if __name__ == "__main__":
    main()
