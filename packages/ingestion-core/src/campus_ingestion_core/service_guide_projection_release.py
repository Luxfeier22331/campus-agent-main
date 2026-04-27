from __future__ import annotations

from collections.abc import Mapping
from dataclasses import asdict
from pathlib import Path
from typing import Any

from campus_ingestion_core import service_guide_projection_support as _support
from campus_ingestion_core.object_store import build_index_release_artifact_key
from campus_ingestion_core.service_guide_projection_constants import (
    SERVICE_GUIDE_COLLECTION,
    SERVICE_GUIDE_CORPUS,
    SERVICE_GUIDE_MANUAL_REVIEW_FILENAME,
    SERVICE_GUIDE_PROJECTION_FILENAME,
    SERVICE_GUIDE_RELEASE_MANIFEST_FILENAME,
    SERVICE_GUIDE_RELEASE_MANIFEST_SCHEMA_VERSION,
    SERVICE_GUIDE_VALIDATION_FILENAME,
)
from campus_ingestion_core.service_guide_projection_models import (
    ServiceGuideProjectionObjectStore,
    ServiceGuideProjectionReleaseReport,
)
from campus_ingestion_core.service_guide_projection_validation import (
    validate_service_guide_projection_bundle,
)

_json_bytes = _support.json_bytes
_list_of_dicts = _support.list_of_dicts
_path_segment = _support.path_segment
_required_text = _support.required_text


def assert_service_guide_projection_release_ready(
    bundle: Mapping[str, Any],
    *,
    expected_ready_records: int | None = None,
) -> None:
    validation_report = validate_service_guide_projection_bundle(dict(bundle))
    if not validation_report.valid:
        messages = ", ".join(
            str(issue.get("message") or issue) for issue in validation_report.issues
        )
        raise ValueError(f"service guide projection validation failed: {messages}")
    records = _list_of_dicts(bundle.get("service_guide_records"))
    if not records:
        raise ValueError("service guide projection produced no ready records")
    conflicts = _list_of_dicts(bundle.get("conflict_records"))
    if conflicts:
        raise ValueError("service guide projection release blocked by unresolved conflicts")
    non_ready_records = [
        record for record in records if _required_text(record.get("extraction_status")) != "ready"
    ]
    if non_ready_records:
        raise ValueError("service guide projection release blocked by non-ready records")
    manual_review_sources = _list_of_dicts(bundle.get("manual_review_sources"))
    if manual_review_sources:
        raise ValueError("service guide projection release blocked by legacy manual review sources")
    if expected_ready_records is not None and len(records) != expected_ready_records:
        raise ValueError(
            "service guide projection ready record count mismatch: "
            f"expected {expected_ready_records}, got {len(records)}"
        )


def write_service_guide_projection_release(
    *,
    bundle: dict[str, Any],
    output_dir: Path,
    release_id: str,
    generated_at: str,
    manual_review_sources: list[dict[str, Any]] | None = None,
    object_store: ServiceGuideProjectionObjectStore | None = None,
    bucket: str | None = None,
) -> ServiceGuideProjectionReleaseReport:
    normalized_release_id = _path_segment(release_id, "release_id")
    output_root = Path(output_dir)
    release_dir = output_root / normalized_release_id
    current_dir = output_root / "current"
    release_dir.mkdir(parents=True, exist_ok=True)
    current_dir.mkdir(parents=True, exist_ok=True)

    bundle_bytes = _json_bytes(bundle)
    validation_report = validate_service_guide_projection_bundle(bundle)
    validation_payload = asdict(validation_report)
    manual_review_payload = manual_review_sources
    if manual_review_payload is None:
        manual_review_payload = _list_of_dicts(bundle.get("manual_review_sources"))
    release_object_key = build_index_release_artifact_key(
        corpus=SERVICE_GUIDE_CORPUS,
        collection=SERVICE_GUIDE_COLLECTION,
        release_id=normalized_release_id,
        filename=SERVICE_GUIDE_PROJECTION_FILENAME,
    )
    current_object_key = build_index_release_artifact_key(
        corpus=SERVICE_GUIDE_CORPUS,
        collection=SERVICE_GUIDE_COLLECTION,
        release_id="current",
        filename=SERVICE_GUIDE_PROJECTION_FILENAME,
    )
    release_manifest = {
        "schema_version": SERVICE_GUIDE_RELEASE_MANIFEST_SCHEMA_VERSION,
        "release_id": normalized_release_id,
        "generated_at": generated_at,
        "corpus": SERVICE_GUIDE_CORPUS,
        "collection": SERVICE_GUIDE_COLLECTION,
        "projection_object_key": release_object_key,
        "current_projection_object_key": current_object_key,
        "validation_valid": validation_report.valid,
        "counts": dict(validation_report.counts),
    }

    projection_path = release_dir / SERVICE_GUIDE_PROJECTION_FILENAME
    current_projection_path = current_dir / SERVICE_GUIDE_PROJECTION_FILENAME
    validation_path = release_dir / SERVICE_GUIDE_VALIDATION_FILENAME
    manifest_path = release_dir / SERVICE_GUIDE_RELEASE_MANIFEST_FILENAME
    manual_review_path = release_dir / SERVICE_GUIDE_MANUAL_REVIEW_FILENAME
    projection_path.write_bytes(bundle_bytes)
    current_projection_path.write_bytes(bundle_bytes)
    validation_path.write_bytes(_json_bytes(validation_payload))
    manifest_path.write_bytes(_json_bytes(release_manifest))
    manual_review_path.write_bytes(_json_bytes(manual_review_payload))

    if object_store is not None:
        if not bucket:
            raise ValueError("bucket is required when object_store is provided")
        for key, data in (
            (release_object_key, bundle_bytes),
            (current_object_key, bundle_bytes),
            (
                build_index_release_artifact_key(
                    corpus=SERVICE_GUIDE_CORPUS,
                    collection=SERVICE_GUIDE_COLLECTION,
                    release_id=normalized_release_id,
                    filename=SERVICE_GUIDE_VALIDATION_FILENAME,
                ),
                _json_bytes(validation_payload),
            ),
            (
                build_index_release_artifact_key(
                    corpus=SERVICE_GUIDE_CORPUS,
                    collection=SERVICE_GUIDE_COLLECTION,
                    release_id=normalized_release_id,
                    filename=SERVICE_GUIDE_RELEASE_MANIFEST_FILENAME,
                ),
                _json_bytes(release_manifest),
            ),
            (
                build_index_release_artifact_key(
                    corpus=SERVICE_GUIDE_CORPUS,
                    collection=SERVICE_GUIDE_COLLECTION,
                    release_id=normalized_release_id,
                    filename=SERVICE_GUIDE_MANUAL_REVIEW_FILENAME,
                ),
                _json_bytes(manual_review_payload),
            ),
        ):
            object_store.put_bytes(
                bucket=bucket,
                key=key,
                data=data,
                content_type="application/json",
            )

    return ServiceGuideProjectionReleaseReport(
        schema_version=SERVICE_GUIDE_RELEASE_MANIFEST_SCHEMA_VERSION,
        release_id=normalized_release_id,
        generated_at=generated_at,
        projection_path=str(projection_path),
        current_projection_path=str(current_projection_path),
        release_object_key=release_object_key,
        current_object_key=current_object_key,
        validation_summary_path=str(validation_path),
        release_manifest_path=str(manifest_path),
        manual_review_report_path=str(manual_review_path),
    )


__all__ = (
    "assert_service_guide_projection_release_ready",
    "write_service_guide_projection_release",
)
