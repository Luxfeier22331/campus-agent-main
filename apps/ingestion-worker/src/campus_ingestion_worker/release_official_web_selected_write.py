from __future__ import annotations

import argparse
import json
import os
from collections.abc import Mapping, Sequence
from dataclasses import asdict
from pathlib import Path

from campus_ingestion_core import (
    DEFAULT_BUCKET_SOURCE,
    ObjectStoreSettings,
    replay_official_web_source_truth_local,
)
from campus_ingestion_core.academic_calendar_projection import (
    ACADEMIC_CALENDAR_COLLECTION,
    ACADEMIC_CALENDAR_CORPUS,
)
from campus_ingestion_core.contact_directory_projection import (
    CONTACT_DIRECTORY_COLLECTION,
    CONTACT_DIRECTORY_CORPUS,
)
from campus_ingestion_core.local_rebuild import S3ObjectStoreAdmin
from campus_ingestion_core.official_web_release_task import OfficialWebReleaseTask
from campus_ingestion_core.service_guide_projection import (
    SERVICE_GUIDE_COLLECTION,
    SERVICE_GUIDE_CORPUS,
)
from campus_ingestion_core.structured_projection_postgres import (
    build_structured_projection_publisher_from_env,
)

from campus_ingestion_worker.env_bootstrap import load_worker_env
from campus_ingestion_worker.official_web_handoff_consumer_runtime import materialize_replay_input
from campus_ingestion_worker.release_official_web_selected_write_calendar import (
    _build_academic_calendar_bundle,
)
from campus_ingestion_worker.release_official_web_selected_write_candidates import (
    _matching_selected_write_candidates,
)
from campus_ingestion_worker.release_official_web_selected_write_common import (
    OfficialWebSelectedWriteObjectStore,
    OfficialWebSelectedWritePreviewResult,
    OfficialWebSelectedWriteProjectionReporter,
    OfficialWebSelectedWritePublisher,
    OfficialWebSelectedWriteReleaseError,
    OfficialWebSelectedWriteResult,
    _as_mapping,
    _assert_selected_write_release_task,
    _PreparedSelectedWriteProjection,
    _release_task_model,
    _require_text,
    _selected_write_task_from_release_task,
)
from campus_ingestion_worker.release_official_web_selected_write_contact import (
    _build_contact_directory_bundle,
)
from campus_ingestion_worker.release_official_web_selected_write_io import (
    _download_source_truth_bundle,
    _read_json_object,
    _report_projection,
    _reset_dir,
    _resolve_object_store_settings,
    _selected_write_release_id,
    _source_bundle_key,
    _utcnow,
    _write_json,
)
from campus_ingestion_worker.release_official_web_selected_write_projection import (
    _projection_display_names,
    _projection_record_count,
    _publish_selected_write_projection,
    _records_field_for_collection,
    _task_scope_preview_bundle,
)
from campus_ingestion_worker.release_official_web_selected_write_service import (
    _build_service_guide_bundle,
)


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


# Implementation details live in focused sibling modules; this file remains the CLI and
# selected-write orchestration facade.


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
