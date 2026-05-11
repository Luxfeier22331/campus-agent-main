from __future__ import annotations

import argparse
import json
import os
import re
import sys
import uuid
from datetime import UTC, datetime, timedelta
from pathlib import Path

if __package__ in {None, ""}:
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from campus_ingestion_core import ObjectStoreSettings
from campus_ingestion_core.local_rebuild import S3ObjectStoreAdmin
from campus_ingestion_core.object_store import build_index_release_artifact_key
from campus_ingestion_core.service_guide_projection import (
    SERVICE_GUIDE_COLLECTION,
    SERVICE_GUIDE_CORPUS,
    SERVICE_GUIDE_PROJECTION_FILENAME,
    SERVICE_GUIDE_PROJECTION_SCHEMA_VERSION,
)
from campus_ingestion_core.service_guide_projection_release import (
    write_service_guide_projection_release,
)
from campus_ingestion_core.structured_projection_postgres import (
    PostgresStructuredProjectionPublisher,
    projection_artifact_checksum,
)
from campus_ingestion_worker.env_bootstrap import load_worker_env
from campus_ingestion_worker.release_official_web_selected_write import (
    release_official_web_selected_write,
)

from scripts.official_web_service_guide_no_promotion_proof import (
    DEFAULT_PREVIEW_REPORT_NAME,
    load_execution_report_for_seam_report,
    resolve_service_guide_preview_release_tasks,
)
from scripts.service_guide_selected_write_runtime_smoke import (
    build_service_guide_selected_write_runtime_smoke_plan,
    run_service_guide_selected_write_runtime_smoke,
)
from scripts.supervisor_runtime_process_smoke import (
    _create_temporary_postgres_database,
    _postgres_url_with_database,
    _sanitize_postgres_database_name,
)


class _SnapshotReporter:
    def __init__(self) -> None:
        self.snapshots: list[dict[str, object]] = []

    def report(self, *, snapshot: dict[str, object]) -> None:
        self.snapshots.append(dict(snapshot))


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description=(
            "Publish service-guide selected-write tasks into an isolated local proof "
            "environment and verify preview-vs-publish parity."
        )
    )
    parser.add_argument("--seam-report", required=True)
    parser.add_argument("--preview-report", required=True)
    parser.add_argument("--output-dir", required=True)
    parser.add_argument("--source-bucket")
    parser.add_argument("--derived-bucket")
    parser.add_argument("--declarations-path")
    return parser


def build_isolated_derived_bucket_name(seed: str) -> str:
    normalized = re.sub(r"[^a-z0-9-]+", "-", str(seed).lower()).strip("-")
    if not normalized:
        normalized = "proof"
    suffix = uuid.uuid5(uuid.NAMESPACE_URL, seed).hex[:12]
    name = f"campus-rag-derived-proof-{normalized}-{suffix}"
    return name[:63].rstrip("-")


def compare_publish_results_to_preview(
    *,
    preview_report: dict[str, object],
    publish_results: list[dict[str, object]],
) -> dict[str, object]:
    preview_by_id: dict[str, dict[str, object]] = {}
    results = preview_report.get("results")
    if not isinstance(results, list):
        raise ValueError("selected-write preview report results must be a list")
    for item in results:
        if not isinstance(item, dict):
            continue
        if str(item.get("collection") or "").strip() != "service_guide":
            continue
        selected_write_id = str(item.get("selected_write_id") or "").strip()
        if selected_write_id:
            preview_by_id[selected_write_id] = dict(item)
    mismatches: list[dict[str, object]] = []
    for result in publish_results:
        selected_write_id = str(result.get("selected_write_id") or "").strip()
        preview = preview_by_id.get(selected_write_id)
        if preview is None:
            mismatches.append(
                {
                    "selected_write_id": selected_write_id,
                    "field": "selected_write_id",
                    "preview": None,
                    "publish": result,
                }
            )
            continue
        for field in (
            "record_count",
            "full_record_count",
            "task_scope_display_names",
            "full_impact_display_names",
        ):
            preview_value = preview.get(field)
            publish_value = result.get(field)
            if preview_value != publish_value:
                mismatches.append(
                    {
                        "selected_write_id": selected_write_id,
                        "field": field,
                        "preview": preview_value,
                        "publish": publish_value,
                    }
                )
    return {
        "passed": not mismatches and len(preview_by_id) == len(publish_results),
        "service_guide_task_count": len(preview_by_id),
        "published_task_count": len(publish_results),
        "mismatches": mismatches,
    }


def _full_impact_bundle_from_preview_report(preview_report: dict[str, object]) -> dict[str, object]:
    results = preview_report.get("results")
    if not isinstance(results, list):
        raise ValueError("selected-write preview report results must be a list")
    for item in results:
        if not isinstance(item, dict):
            continue
        full_bundle = item.get("full_bundle")
        if isinstance(full_bundle, dict):
            return dict(full_bundle)
    raise RuntimeError("preview report does not contain a service-guide full_bundle")


def _trusted_time_from_full_impact_bundle(bundle: dict[str, object]) -> str:
    records = bundle.get("service_guide_records")
    if not isinstance(records, list):
        raise ValueError("service-guide full impact bundle records must be a list")
    trusted_times: list[datetime] = []
    for item in records:
        if not isinstance(item, dict):
            continue
        effective_from = str(item.get("effective_from") or "").strip()
        if not effective_from:
            continue
        trusted_times.append(
            datetime.fromisoformat(effective_from.replace("Z", "+00:00")).astimezone(UTC)
            + timedelta(seconds=1)
        )
    if not trusted_times:
        raise RuntimeError("service-guide full impact bundle is missing effective_from values")
    return max(trusted_times).isoformat().replace("+00:00", "Z")


def _seed_service_guide_current_projection(
    *,
    object_store: S3ObjectStoreAdmin,
    publisher: PostgresStructuredProjectionPublisher,
    derived_bucket: str,
    output_dir: Path,
    bundle: dict[str, object],
) -> dict[str, object]:
    generated_at = str(bundle.get("generated_at") or "").strip()
    if not generated_at:
        raise ValueError("seed bundle generated_at is required")
    release_id = "seed_current_preview_baseline"
    release_report = write_service_guide_projection_release(
        bundle=bundle,
        output_dir=output_dir / "seed-current",
        release_id=release_id,
        generated_at=generated_at,
        manual_review_sources=[],
        object_store=object_store,
        bucket=derived_bucket,
    )
    publish_report = publisher.publish_release(
        corpus=SERVICE_GUIDE_CORPUS,
        collection=SERVICE_GUIDE_COLLECTION,
        release_id=release_id,
        generated_at=generated_at,
        schema_version=SERVICE_GUIDE_PROJECTION_SCHEMA_VERSION,
        artifact_object_key=build_index_release_artifact_key(
            corpus=SERVICE_GUIDE_CORPUS,
            collection=SERVICE_GUIDE_COLLECTION,
            release_id=release_id,
            filename=SERVICE_GUIDE_PROJECTION_FILENAME,
        ),
        artifact_checksum=projection_artifact_checksum(bundle),
        bundle=bundle,
        validation_status="valid",
        promote_current=True,
    )
    return {
        "release_id": release_id,
        "generated_at": generated_at,
        "projection_path": release_report.projection_path,
        "current_projection_path": release_report.current_projection_path,
        "current_object_key": release_report.current_object_key,
        "counts": publish_report.counts,
    }


def run_service_guide_isolated_publish_proof(
    *,
    seam_report_path: Path,
    preview_report_path: Path,
    output_dir: Path,
    source_bucket: str | None = None,
    derived_bucket: str | None = None,
    declarations_path: Path | None = None,
) -> dict[str, object]:
    load_worker_env()
    seam_report = json.loads(seam_report_path.read_text(encoding="utf-8"))
    preview_report = json.loads(preview_report_path.read_text(encoding="utf-8"))
    output_dir.mkdir(parents=True, exist_ok=True)
    base_database_url = _required_env(
        "CAMPUS_SHARED_POSTGRES_URL",
        "isolated publish proof requires CAMPUS_SHARED_POSTGRES_URL",
    )
    management_url = _postgres_url_with_database(base_database_url, "postgres")
    database_name = _sanitize_postgres_database_name(
        f"campus_agent_official_web_service_guide_proof_{uuid.uuid4().hex[:10]}"
    )
    runtime_database_url = _postgres_url_with_database(base_database_url, database_name)
    cleanup_database = _create_temporary_postgres_database(management_url, database_name)
    settings = ObjectStoreSettings.from_env()
    resolved_source_bucket = source_bucket or settings.bucket_source
    resolved_derived_bucket = derived_bucket or build_isolated_derived_bucket_name(database_name)
    object_store_settings = ObjectStoreSettings(
        endpoint=settings.endpoint,
        access_key=settings.access_key,
        secret_key=settings.secret_key,
        region=settings.region,
        bucket_source=resolved_source_bucket,
        bucket_derived=resolved_derived_bucket,
        secure=settings.secure,
        source_access_key=settings.source_access_key,
        source_secret_key=settings.source_secret_key,
        derived_access_key=settings.derived_access_key,
        derived_secret_key=settings.derived_secret_key,
    )
    object_store = S3ObjectStoreAdmin(object_store_settings)
    publish_results: list[dict[str, object]] = []
    operator_snapshots: list[dict[str, object]] = []
    try:
        _ensure_bucket_exists(object_store, resolved_source_bucket)
        _ensure_bucket_exists(object_store, resolved_derived_bucket)
        publisher = PostgresStructuredProjectionPublisher(runtime_database_url)
        from campus_ingestion_core.official_web_release_task_store import (
            build_official_web_release_task_store_from_env,
        )

        release_store = build_official_web_release_task_store_from_env()
        execution_report = load_execution_report_for_seam_report(
            seam_report_path=seam_report_path,
            seam_report=seam_report,
        )
        preview_release_tasks, preview_task_source = resolve_service_guide_preview_release_tasks(
            seam_report=seam_report,
            release_store=release_store,
            execution_report=execution_report,
        )
        full_impact_bundle = _full_impact_bundle_from_preview_report(preview_report)
        seeded_current = _seed_service_guide_current_projection(
            object_store=object_store,
            publisher=publisher,
            derived_bucket=resolved_derived_bucket,
            output_dir=output_dir,
            bundle=full_impact_bundle,
        )
        trusted_time_rfc3339 = _trusted_time_from_full_impact_bundle(full_impact_bundle)
        for task_payload in preview_release_tasks:
            task_id = _require_canonical_release_task_id(task_payload)
            reporter = _SnapshotReporter()
            work_dir = output_dir / task_id
            result = release_official_web_selected_write(
                release_task={**task_payload, "status": "claimed"},
                object_store=object_store,
                derived_object_store=object_store,
                structured_projection_publisher=publisher,
                projection_reporter=reporter,
                work_dir=work_dir,
                object_store_settings=object_store_settings,
                source_bucket=resolved_source_bucket,
                derived_bucket=resolved_derived_bucket,
                declarations_path=declarations_path,
            )
            publish_results.append(
                {
                    "selected_write_id": result.selected_write_id,
                    "release_id": result.release_id,
                    "record_count": result.record_count,
                    "full_record_count": result.full_record_count,
                    "task_scope_display_names": result.task_scope_display_names,
                    "full_impact_display_names": result.full_impact_display_names,
                    "work_dir": result.work_dir,
                }
            )
            operator_snapshots.append(
                {
                    "selected_write_id": result.selected_write_id,
                    "snapshots": reporter.snapshots,
                }
            )
        comparison = compare_publish_results_to_preview(
            preview_report=preview_report,
            publish_results=publish_results,
        )
        smoke_output_dir = output_dir / "runtime-smoke"
        smoke_plan = build_service_guide_selected_write_runtime_smoke_plan(
            repo_root=Path(__file__).resolve().parents[1],
            output_dir=smoke_output_dir,
            database_url=runtime_database_url,
            structured_query_secret=os.getenv(
                "SUPERVISOR_INTERNAL_QUERY_SHARED_SECRET", "query-secret"
            ),
            trusted_time_rfc3339=trusted_time_rfc3339,
        )
        smoke_report = run_service_guide_selected_write_runtime_smoke(smoke_plan)
        report = {
            "schema_version": "official_web_service_guide_isolated_publish_proof.v1",
            "passed": bool(comparison["passed"] and smoke_report.get("passed") is True),
            "preview_task_source": preview_task_source,
            "database_name": database_name,
            "runtime_database_url": runtime_database_url,
            "source_bucket": resolved_source_bucket,
            "derived_bucket": resolved_derived_bucket,
            "trusted_time_rfc3339": trusted_time_rfc3339,
            "preview_report_path": str(preview_report_path.resolve()),
            "preview_report_name": DEFAULT_PREVIEW_REPORT_NAME,
            "seeded_current_projection": seeded_current,
            "publish_results": publish_results,
            "preview_publish_comparison": comparison,
            "operator_safe_projection_snapshots": operator_snapshots,
            "runtime_smoke_report": smoke_report,
        }
        (output_dir / "official-web-service-guide-isolated-publish-proof.json").write_text(
            json.dumps(report, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
        return report
    finally:
        cleanup_database()


def _ensure_bucket_exists(object_store: S3ObjectStoreAdmin, bucket: str) -> None:
    client = object_store._client
    try:
        client.head_bucket(Bucket=bucket)
    except Exception:
        client.create_bucket(Bucket=bucket)


def _required_env(key: str, message: str) -> str:
    value = os.getenv(key, "").strip()
    if not value:
        raise RuntimeError(message)
    return value


def _require_canonical_release_task_id(task_payload: dict[str, object]) -> str:
    if "task_id" in task_payload:
        raise ValueError("legacy release task field task_id is not accepted; use taskId")
    task_id = str(task_payload.get("taskId") or "").strip()
    if not task_id:
        raise RuntimeError("service-guide preview release task missing taskId")
    return task_id


def main(argv: list[str] | None = None) -> None:
    args = build_parser().parse_args(argv)
    report = run_service_guide_isolated_publish_proof(
        seam_report_path=Path(args.seam_report).resolve(),
        preview_report_path=Path(args.preview_report).resolve(),
        output_dir=Path(args.output_dir).resolve(),
        source_bucket=args.source_bucket,
        derived_bucket=args.derived_bucket,
        declarations_path=Path(args.declarations_path).resolve()
        if args.declarations_path
        else None,
    )
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
