from __future__ import annotations

import argparse
import json
import os
from collections.abc import Mapping, Sequence
from dataclasses import asdict
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Protocol

from campus_ingestion_core import ObjectStoreSettings
from campus_ingestion_core.internal_notice_consumer_admission_gate import (
    CONSUMER_ADMISSION_GATE_OPERATION_TYPED_MATERIALIZATION,
    ConsumerAdmissionGateRequest,
    check_internal_notice_consumer_admission_gate,
)
from campus_ingestion_core.internal_notice_consumer_admission_manifest import (
    InternalNoticeConsumerAdmissionManifest,
    load_internal_notice_consumer_admission_manifest,
)
from campus_ingestion_core.local_rebuild import S3ObjectStoreAdmin
from campus_ingestion_core.notice_consumption_projection import (
    NOTICE_CONSUMPTION_STATUS_READY_FOR_TARGET,
    NOTICE_TARGET_SURFACE_SERVICE_STATUS_CANDIDATE,
    NoticeConsumptionProjectionEntry,
    build_notice_consumption_projection_store_from_env,
    normalize_notice_ids,
)
from campus_ingestion_core.notice_derived_transport_schedule_materialization import (
    build_notice_derived_transport_schedule_projection_bundle,
)
from campus_ingestion_core.object_store import build_index_release_artifact_key
from campus_ingestion_core.registry import DocumentRegistry, build_document_registry_from_env
from campus_ingestion_core.structured_projection_postgres import (
    build_structured_projection_publisher_from_env,
    projection_artifact_checksum,
)
from campus_ingestion_core.transport_schedule_projection import (
    DEFAULT_TRANSPORT_SCHEDULE_HORIZON_DAYS,
    TRANSPORT_SCHEDULE_COLLECTION,
    TRANSPORT_SCHEDULE_CORPUS,
    TRANSPORT_SCHEDULE_PROJECTION_FILENAME,
    TRANSPORT_SCHEDULE_REJECTED_SOURCE_REPORT_FILENAME,
    build_transport_schedule_projection_bundle,
    write_transport_schedule_projection_release,
)

from campus_ingestion_worker.env_bootstrap import load_worker_env
from campus_ingestion_worker.internal_notice_selection import (
    build_internal_notice_selection_provenance,
)


class _SourceObjectStore(Protocol):
    def get_bytes(self, *, bucket: str, key: str) -> bytes: ...


class _DerivedObjectStore(Protocol):
    def put_bytes(
        self,
        *,
        bucket: str,
        key: str,
        data: bytes,
        content_type: str,
    ) -> None: ...


class _TransportProjectionObjectStore(_SourceObjectStore, _DerivedObjectStore, Protocol):
    pass


class _StructuredProjectionPublisher(Protocol):
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
        promote_current: bool = True,
    ) -> object: ...


class _ProjectionReleaseReport(Protocol):
    release_id: str
    release_object_key: str


_PUBLISH_MODE_PREVIEW = "preview"
_PUBLISH_MODE_STAGE = "stage"
_PUBLISH_MODE_PROMOTE = "promote"
_PUBLISH_MODES = frozenset(
    {
        _PUBLISH_MODE_PREVIEW,
        _PUBLISH_MODE_STAGE,
        _PUBLISH_MODE_PROMOTE,
    }
)
_SHANGHAI_TZ = timezone(timedelta(hours=8))


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Build campus_services transport_schedule projection from authenticated notice source truth.",
    )
    parser.add_argument("--source-truth-inventory")
    parser.add_argument("--source-truth-root")
    parser.add_argument(
        "--from-consumption-projection",
        action="store_true",
        help="Build from ready internal_notice consumption projection transport candidates.",
    )
    parser.add_argument(
        "--notice-id",
        action="append",
        default=[],
        help="Selected notice id for consumption-projection mode. Repeatable.",
    )
    parser.add_argument(
        "--selection-path",
        help="Selection manifest/path containing notice ids for consumption-projection mode.",
    )
    parser.add_argument(
        "--all-ready-transport-candidates",
        action="store_true",
        help=(
            "Build from all ready transport schedule candidates already present in "
            "notice_consumption_projection."
        ),
    )
    parser.add_argument(
        "--allow-multi-notice-release",
        action="store_true",
        help=(
            "Allow stage/promote from more than one transport notice or from the all-ready "
            "transport candidate selector. Preview mode is unaffected."
        ),
    )
    parser.add_argument("--work-dir", required=True)
    parser.add_argument("--release-id", required=True)
    parser.add_argument("--generated-at")
    parser.add_argument(
        "--service-horizon-days",
        type=int,
        default=DEFAULT_TRANSPORT_SCHEDULE_HORIZON_DAYS,
    )
    parser.add_argument("--source-bucket")
    parser.add_argument("--derived-bucket")
    parser.add_argument(
        "--publish-mode",
        default=_PUBLISH_MODE_PROMOTE,
        choices=sorted(_PUBLISH_MODES),
        help=(
            "preview writes local artifacts only; stage writes versioned artifact/read model "
            "without current; promote updates current. Defaults to promote for compatibility."
        ),
    )
    parser.add_argument("--consumer-admission-manifest-path")
    return parser


def build_transport_schedule_projection_release_from_inventory(
    *,
    source_truth_inventory_path: Path,
    source_truth_root: Path | None,
    work_dir: Path,
    release_id: str,
    generated_at: str,
    service_horizon_days: int,
    object_store: _DerivedObjectStore,
    derived_bucket: str,
    source_object_store: _SourceObjectStore | None = None,
    source_bucket: str | None = None,
    structured_projection_publisher: _StructuredProjectionPublisher | None = None,
    publish_mode: str = _PUBLISH_MODE_PROMOTE,
):
    normalized_publish_mode = _normalize_publish_mode(publish_mode)
    parents = _load_source_truth_parents(
        inventory_path=source_truth_inventory_path,
        source_truth_root=source_truth_root,
        source_object_store=source_object_store,
        source_bucket=source_bucket,
    )
    build_result = build_transport_schedule_projection_bundle(
        source_truth_parents=parents,
        generated_at=generated_at,
        service_horizon_days=service_horizon_days,
    )
    if not build_result.validation_report.valid:
        _write_json(work_dir / "validation-summary.json", asdict(build_result.validation_report))
        raise ValueError("transport schedule projection validation failed")
    if not build_result.bundle["transport_schedule_snapshots"]:
        _write_json(
            work_dir / TRANSPORT_SCHEDULE_REJECTED_SOURCE_REPORT_FILENAME,
            build_result.rejected_source_records,
        )
        raise ValueError("transport schedule projection produced no schedule snapshots")

    work_dir.mkdir(parents=True, exist_ok=True)
    rejected_source_path = work_dir / TRANSPORT_SCHEDULE_REJECTED_SOURCE_REPORT_FILENAME
    _write_json(rejected_source_path, build_result.rejected_source_records)
    report = write_transport_schedule_projection_release(
        bundle=build_result.bundle,
        output_dir=work_dir,
        release_id=release_id,
        generated_at=generated_at,
        object_store=object_store if _writes_versioned_artifacts(normalized_publish_mode) else None,
        bucket=derived_bucket,
        write_current=_promotes_current(normalized_publish_mode),
    )
    if _writes_versioned_artifacts(normalized_publish_mode):
        object_store.put_bytes(
            bucket=derived_bucket,
            key=build_index_release_artifact_key(
                corpus=TRANSPORT_SCHEDULE_CORPUS,
                collection=TRANSPORT_SCHEDULE_COLLECTION,
                release_id=release_id,
                filename=TRANSPORT_SCHEDULE_REJECTED_SOURCE_REPORT_FILENAME,
            ),
            data=rejected_source_path.read_bytes(),
            content_type="application/json",
        )
    _publish_structured_projection_release(
        structured_projection_publisher=structured_projection_publisher,
        bundle=build_result.bundle,
        report=report,
        generated_at=generated_at,
        promote_current=_promotes_current(normalized_publish_mode),
        enabled=_writes_structured_projection(normalized_publish_mode),
    )
    _write_json(work_dir / "build-report.json", asdict(report))
    return report


def build_transport_schedule_projection_release_from_consumption_projection(
    *,
    projection_entries: Sequence[NoticeConsumptionProjectionEntry],
    registry: DocumentRegistry,
    work_dir: Path,
    release_id: str,
    generated_at: str,
    service_horizon_days: int,
    object_store: _TransportProjectionObjectStore,
    derived_bucket: str,
    structured_projection_publisher: _StructuredProjectionPublisher | None = None,
    publish_mode: str = _PUBLISH_MODE_PROMOTE,
    admitted_at: str = "",
):
    normalized_publish_mode = _normalize_publish_mode(publish_mode)
    build_result = build_notice_derived_transport_schedule_projection_bundle(
        projection_entries=projection_entries,
        registry=registry,
        object_store=object_store,
        derived_bucket=derived_bucket,
        generated_at=generated_at,
        service_horizon_days=service_horizon_days,
    )
    if not build_result.validation_report.valid:
        _write_json(work_dir / "validation-summary.json", asdict(build_result.validation_report))
        raise ValueError("notice-derived transport schedule projection validation failed")
    if not build_result.bundle["transport_schedule_snapshots"]:
        _write_json(
            work_dir / TRANSPORT_SCHEDULE_REJECTED_SOURCE_REPORT_FILENAME,
            build_result.rejected_source_records,
        )
        raise ValueError("notice-derived transport schedule projection produced no snapshots")

    work_dir.mkdir(parents=True, exist_ok=True)
    build_result.bundle["transport_release_notices"] = _transport_release_notice_provenance_records(
        projection_entries=projection_entries,
        admitted_at=admitted_at,
        materialized_at=generated_at,
    )
    rejected_source_path = work_dir / TRANSPORT_SCHEDULE_REJECTED_SOURCE_REPORT_FILENAME
    _write_json(rejected_source_path, build_result.rejected_source_records)
    report = write_transport_schedule_projection_release(
        bundle=build_result.bundle,
        output_dir=work_dir,
        release_id=release_id,
        generated_at=generated_at,
        object_store=object_store if _writes_versioned_artifacts(normalized_publish_mode) else None,
        bucket=derived_bucket,
        write_current=_promotes_current(normalized_publish_mode),
    )
    if _writes_versioned_artifacts(normalized_publish_mode):
        object_store.put_bytes(
            bucket=derived_bucket,
            key=build_index_release_artifact_key(
                corpus=TRANSPORT_SCHEDULE_CORPUS,
                collection=TRANSPORT_SCHEDULE_COLLECTION,
                release_id=release_id,
                filename=TRANSPORT_SCHEDULE_REJECTED_SOURCE_REPORT_FILENAME,
            ),
            data=rejected_source_path.read_bytes(),
            content_type="application/json",
        )
    _publish_structured_projection_release(
        structured_projection_publisher=structured_projection_publisher,
        bundle=build_result.bundle,
        report=report,
        generated_at=generated_at,
        promote_current=_promotes_current(normalized_publish_mode),
        enabled=_writes_structured_projection(normalized_publish_mode),
    )
    _write_json(work_dir / "build-report.json", asdict(report))
    return report


def main(argv: Sequence[str] | None = None) -> None:
    load_worker_env()
    args = build_parser().parse_args(list(argv) if argv is not None else None)
    settings = ObjectStoreSettings.from_env()
    object_store = S3ObjectStoreAdmin(settings)
    generated_at = args.generated_at or _default_generated_at()
    source = dict(os.environ)
    structured_projection_publisher = build_structured_projection_publisher_from_env(source)
    publish_mode = _normalize_publish_mode(args.publish_mode)
    if args.from_consumption_projection:
        selection = build_internal_notice_selection_provenance(
            explicit_notice_ids=args.notice_id or (),
            selection_path=args.selection_path,
            extra_command_args={
                "all_ready_transport_candidates": bool(args.all_ready_transport_candidates),
            },
        )
        notice_ids = normalize_notice_ids(selection.notice_ids)
        if not notice_ids and not args.all_ready_transport_candidates:
            raise ValueError(
                "--notice-id, --selection-path, or --all-ready-transport-candidates is "
                "required with --from-consumption-projection"
            )
        projection_store = build_notice_consumption_projection_store_from_env(source)
        projection_entries = projection_store.list_by_scope(
            "campus_notices",
            "internal_notice",
            notice_ids=notice_ids,
        )
        if args.all_ready_transport_candidates:
            projection_entries = _ready_transport_projection_entries(projection_entries)
        _assert_transport_release_scope_allows(
            publish_mode=publish_mode,
            projection_entries=projection_entries,
            selected_notice_ids=notice_ids,
            all_ready_transport_candidates=bool(args.all_ready_transport_candidates),
            allow_multi_notice_release=bool(args.allow_multi_notice_release),
        )
        consumer_admission_manifest = _load_consumer_admission_manifest_for_transport(
            manifest_path=args.consumer_admission_manifest_path,
        )
        _assert_transport_consumer_admission_gate_allows(
            manifest=consumer_admission_manifest,
            notice_ids=notice_ids or tuple(entry.source_notice_id for entry in projection_entries),
        )
        report = build_transport_schedule_projection_release_from_consumption_projection(
            projection_entries=projection_entries,
            registry=build_document_registry_from_env(source),
            work_dir=Path(args.work_dir).resolve(),
            release_id=args.release_id,
            generated_at=generated_at,
            service_horizon_days=args.service_horizon_days,
            object_store=object_store,
            derived_bucket=args.derived_bucket or settings.bucket_derived,
            structured_projection_publisher=structured_projection_publisher,
            publish_mode=publish_mode,
            admitted_at=consumer_admission_manifest.created_at,
        )
    else:
        if not args.source_truth_inventory:
            raise ValueError("--source-truth-inventory is required without consumption mode")
        source_truth_root = (
            Path(args.source_truth_root).resolve() if args.source_truth_root else None
        )
        source_object_store = None if source_truth_root is not None else object_store
        report = build_transport_schedule_projection_release_from_inventory(
            source_truth_inventory_path=Path(args.source_truth_inventory).resolve(),
            source_truth_root=source_truth_root,
            work_dir=Path(args.work_dir).resolve(),
            release_id=args.release_id,
            generated_at=generated_at,
            service_horizon_days=args.service_horizon_days,
            object_store=object_store,
            derived_bucket=args.derived_bucket or settings.bucket_derived,
            source_object_store=source_object_store,
            source_bucket=args.source_bucket or settings.bucket_source,
            structured_projection_publisher=structured_projection_publisher,
            publish_mode=publish_mode,
        )
    print(json.dumps(asdict(report), ensure_ascii=False, indent=2))


def _publish_structured_projection_release(
    *,
    structured_projection_publisher: _StructuredProjectionPublisher | None,
    bundle: Mapping[str, Any],
    report: _ProjectionReleaseReport,
    generated_at: str,
    promote_current: bool,
    enabled: bool,
) -> None:
    if structured_projection_publisher is None or not enabled:
        return
    schema_version = _required_text(bundle.get("schema_version"))
    if schema_version is None:
        raise ValueError("transport schedule projection bundle schema_version is required")
    structured_projection_publisher.publish_release(
        corpus=TRANSPORT_SCHEDULE_CORPUS,
        collection=TRANSPORT_SCHEDULE_COLLECTION,
        release_id=report.release_id,
        generated_at=generated_at,
        schema_version=schema_version,
        artifact_object_key=report.release_object_key,
        artifact_checksum=projection_artifact_checksum(bundle),
        bundle=bundle,
        validation_status="valid",
        promote_current=promote_current,
    )


def _load_consumer_admission_manifest_for_transport(
    *,
    manifest_path: str | None,
) -> InternalNoticeConsumerAdmissionManifest:
    if not str(manifest_path or "").strip():
        raise ValueError(
            "consumer admission manifest is required before transport_schedule typed materialization"
        )
    return load_internal_notice_consumer_admission_manifest(Path(str(manifest_path)).resolve())


def _assert_transport_consumer_admission_gate_allows(
    *,
    manifest: InternalNoticeConsumerAdmissionManifest,
    notice_ids: Sequence[str],
) -> None:
    report = check_internal_notice_consumer_admission_gate(
        manifest=manifest,
        request=ConsumerAdmissionGateRequest(
            operation=CONSUMER_ADMISSION_GATE_OPERATION_TYPED_MATERIALIZATION,
            source_corpus="campus_notices",
            source_collection="internal_notice",
            selected_notice_ids=tuple(notice_ids),
            scope_write_mode="upsert_selected",
            target_surface=NOTICE_TARGET_SURFACE_SERVICE_STATUS_CANDIDATE,
            max_empty_body_count=0,
            max_unsupported_binary_count=0,
        ),
    )
    if not report.allowed:
        raise ValueError(
            "consumer admission manifest gate blocked transport_schedule materialization: "
            + ", ".join(report.reason_codes)
        )


def _transport_release_notice_provenance_records(
    *,
    projection_entries: Sequence[NoticeConsumptionProjectionEntry],
    admitted_at: str,
    materialized_at: str,
) -> list[dict[str, str]]:
    records: list[dict[str, str]] = []
    seen_notice_ids: set[str] = set()
    for entry in projection_entries:
        notice_id = str(entry.source_notice_id or "").strip()
        if not notice_id or notice_id in seen_notice_ids:
            continue
        seen_notice_ids.add(notice_id)
        records.append(
            {
                "source_notice_id": notice_id,
                "source_ref": _projection_source_ref(entry),
                "source_notice_release_time": _normalize_local_notice_timestamp(
                    entry.source_notice_release_time
                ),
                "admitted_at": admitted_at,
                "materialized_at": materialized_at,
            }
        )
    return records


def _projection_source_ref(entry: NoticeConsumptionProjectionEntry) -> str:
    parts = str(entry.source_notice_document_id or "").split(":")
    if len(parts) == 3 and parts[0] == "notice":
        return entry.source_notice_document_id
    return f"notice:muc_internal_portal:{entry.source_notice_id}"


def _normalize_local_notice_timestamp(value: object) -> str:
    normalized = str(value or "").strip()
    if not normalized:
        return ""
    candidates = [normalized.replace("Z", "+00:00")]
    if " " in normalized and "T" not in normalized:
        candidates.append(normalized.replace(" ", "T"))
    for candidate in candidates:
        try:
            parsed = datetime.fromisoformat(candidate)
            if parsed.tzinfo is None:
                parsed = parsed.replace(tzinfo=_SHANGHAI_TZ)
            return parsed.astimezone(_SHANGHAI_TZ).isoformat()
        except ValueError:
            pass
    for layout in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%d %H:%M", "%Y-%m-%d"):
        try:
            parsed = datetime.strptime(normalized, layout).replace(tzinfo=_SHANGHAI_TZ)
            return parsed.isoformat()
        except ValueError:
            pass
    return normalized


def _normalize_publish_mode(value: str) -> str:
    normalized = str(value or _PUBLISH_MODE_PROMOTE).strip().lower()
    if normalized not in _PUBLISH_MODES:
        raise ValueError(f"unsupported transport schedule publish mode: {value!r}")
    return normalized


def _writes_versioned_artifacts(publish_mode: str) -> bool:
    return publish_mode in {_PUBLISH_MODE_STAGE, _PUBLISH_MODE_PROMOTE}


def _writes_structured_projection(publish_mode: str) -> bool:
    return publish_mode in {_PUBLISH_MODE_STAGE, _PUBLISH_MODE_PROMOTE}


def _promotes_current(publish_mode: str) -> bool:
    return publish_mode == _PUBLISH_MODE_PROMOTE


def _ready_transport_projection_entries(
    entries: Sequence[NoticeConsumptionProjectionEntry],
) -> tuple[NoticeConsumptionProjectionEntry, ...]:
    return tuple(
        entry
        for entry in entries
        if entry.target_surface == NOTICE_TARGET_SURFACE_SERVICE_STATUS_CANDIDATE
        and entry.consumption_status == NOTICE_CONSUMPTION_STATUS_READY_FOR_TARGET
        and str(entry.role_metadata.get("service_status_candidate_kind") or "")
        == "transport_schedule"
    )


def _assert_transport_release_scope_allows(
    *,
    publish_mode: str,
    projection_entries: Sequence[NoticeConsumptionProjectionEntry],
    selected_notice_ids: Sequence[str],
    all_ready_transport_candidates: bool,
    allow_multi_notice_release: bool,
) -> None:
    if not _writes_structured_projection(publish_mode):
        return
    if allow_multi_notice_release:
        return
    if all_ready_transport_candidates:
        raise ValueError(
            "all-ready transport candidates cannot be staged or promoted without "
            "--allow-multi-notice-release; use explicit --notice-id for per-notice selected write"
        )
    release_notice_ids = normalize_notice_ids(
        selected_notice_ids or tuple(entry.source_notice_id for entry in projection_entries)
    )
    if len(release_notice_ids) != 1:
        raise ValueError(
            "transport schedule stage/promote from consumption projection requires exactly one "
            "selected notice id unless --allow-multi-notice-release is set"
        )


def _load_source_truth_parents(
    *,
    inventory_path: Path,
    source_truth_root: Path | None,
    source_object_store: _SourceObjectStore | None,
    source_bucket: str | None,
) -> tuple[dict[str, Any], ...]:
    inventory = _read_json(inventory_path)
    raw_parents = inventory.get("parents")
    if not isinstance(raw_parents, list):
        raise ValueError("source-truth inventory parents must be an array")
    parents: list[dict[str, Any]] = []
    for raw_parent in raw_parents:
        parent = _require_mapping(raw_parent, "parents[]")
        if isinstance(parent.get("notice_manifest"), dict) and isinstance(
            parent.get("content_blocks"), list
        ):
            parents.append(
                {
                    "notice_manifest": dict(parent["notice_manifest"]),
                    "content_blocks": [dict(row) for row in parent["content_blocks"]],
                }
            )
            continue
        manifest_key = _required_text(parent.get("notice_manifest_key"))
        blocks_key = _required_text(parent.get("content_blocks_key"))
        if manifest_key is None or blocks_key is None:
            raise ValueError(
                "source-truth parent requires embedded notice_manifest/content_blocks or "
                "notice_manifest_key/content_blocks_key"
            )
        parents.append(
            {
                "notice_manifest": _read_source_json(
                    key=manifest_key,
                    source_truth_root=source_truth_root,
                    source_object_store=source_object_store,
                    source_bucket=source_bucket,
                ),
                "content_blocks": _read_source_jsonl(
                    key=blocks_key,
                    source_truth_root=source_truth_root,
                    source_object_store=source_object_store,
                    source_bucket=source_bucket,
                ),
            }
        )
    return tuple(parents)


def _read_source_json(
    *,
    key: str,
    source_truth_root: Path | None,
    source_object_store: _SourceObjectStore | None,
    source_bucket: str | None,
) -> dict[str, Any]:
    payload = json.loads(
        _read_source_bytes(
            key=key,
            source_truth_root=source_truth_root,
            source_object_store=source_object_store,
            source_bucket=source_bucket,
        ).decode("utf-8")
    )
    return _require_mapping(payload, key)


def _read_source_jsonl(
    *,
    key: str,
    source_truth_root: Path | None,
    source_object_store: _SourceObjectStore | None,
    source_bucket: str | None,
) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for index, line in enumerate(
        _read_source_bytes(
            key=key,
            source_truth_root=source_truth_root,
            source_object_store=source_object_store,
            source_bucket=source_bucket,
        )
        .decode("utf-8")
        .splitlines(),
        start=1,
    ):
        if not line.strip():
            continue
        rows.append(_require_mapping(json.loads(line), f"{key}:{index}"))
    return rows


def _read_source_bytes(
    *,
    key: str,
    source_truth_root: Path | None,
    source_object_store: _SourceObjectStore | None,
    source_bucket: str | None,
) -> bytes:
    if source_truth_root is not None:
        return (source_truth_root / key).read_bytes()
    if source_object_store is None or source_bucket is None:
        raise ValueError(
            "source object store and source bucket are required without source_truth_root"
        )
    return source_object_store.get_bytes(bucket=source_bucket, key=key)


def _read_json(path: Path) -> dict[str, Any]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    return _require_mapping(payload, str(path))


def _write_json(path: Path, payload: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def _require_mapping(value: object, label: str) -> dict[str, Any]:
    if not isinstance(value, Mapping):
        raise ValueError(f"{label} must be an object")
    return dict(value)


def _required_text(value: object) -> str | None:
    if not isinstance(value, str):
        return None
    normalized = value.strip()
    return normalized or None


def _default_generated_at() -> str:
    return datetime.now(timezone(timedelta(hours=8))).isoformat(timespec="seconds")


__all__ = [
    "TRANSPORT_SCHEDULE_PROJECTION_FILENAME",
    "build_parser",
    "build_transport_schedule_projection_release_from_consumption_projection",
    "build_transport_schedule_projection_release_from_inventory",
    "main",
]


if __name__ == "__main__":
    main()
