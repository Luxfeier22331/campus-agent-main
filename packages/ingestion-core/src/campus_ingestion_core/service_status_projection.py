from __future__ import annotations

import json
from dataclasses import asdict, dataclass
from datetime import datetime
from pathlib import Path
from typing import Any, Protocol

from campus_ingestion_core.object_store import build_index_release_artifact_key

SERVICE_STATUS_PROJECTION_SCHEMA_VERSION = "campus_services_projection_bundle.v1"
SERVICE_STATUS_VALIDATION_REPORT_SCHEMA_VERSION = "service_status_projection_validation_report.v1"
SERVICE_STATUS_RELEASE_MANIFEST_SCHEMA_VERSION = "service_status_projection_release_manifest.v1"
SERVICE_STATUS_CORPUS = "campus_services"
SERVICE_STATUS_COLLECTION = "service_status"
SERVICE_STATUS_PROJECTION_FILENAME = "service-status-projection.json"
SERVICE_STATUS_VALIDATION_FILENAME = "validation-summary.json"
SERVICE_STATUS_RELEASE_MANIFEST_FILENAME = "release-manifest.json"
SERVICE_STATUS_REJECTED_SOURCE_REPORT_FILENAME = "rejected-source-report.json"
SERVICE_STATUS_ALLOWED_OBSERVED_STATUSES = {
    "open",
    "closed",
    "temporarily_closed",
    "limited_service",
}
SERVICE_STATUS_ALLOWED_SERVICE_FAMILIES = {
    "facility",
    "it_platform",
    "library",
    "service_counter",
    "transport_adjacent",
}


class ServiceStatusProjectionObjectStore(Protocol):
    def put_bytes(
        self,
        *,
        bucket: str,
        key: str,
        data: bytes,
        content_type: str,
    ) -> None: ...


@dataclass(frozen=True, slots=True)
class ServiceStatusProjectionBuildResult:
    bundle: dict[str, Any]
    validation_report: ServiceStatusProjectionValidationReport


@dataclass(frozen=True, slots=True)
class ServiceStatusProjectionValidationReport:
    schema_version: str
    valid: bool
    issues: list[dict[str, Any]]
    counts: dict[str, int]


@dataclass(frozen=True, slots=True)
class ServiceStatusProjectionReleaseReport:
    schema_version: str
    release_id: str
    generated_at: str
    projection_path: str
    current_projection_path: str
    release_object_key: str
    current_object_key: str
    validation_summary_path: str
    release_manifest_path: str
    rejected_source_report_path: str
    rejected_source_report_object_key: str


def validate_service_status_projection_bundle(
    bundle: dict[str, Any],
) -> ServiceStatusProjectionValidationReport:
    issues: list[dict[str, Any]] = []
    if bundle.get("schema_version") != SERVICE_STATUS_PROJECTION_SCHEMA_VERSION:
        issues.append(_issue("schema_version", "unsupported service status projection schema"))
    records = _list_of_dicts(bundle.get("service_status_records"))
    subject_ids: set[str] = set()
    for index, record in enumerate(records):
        path = f"service_status_records[{index}]"
        subject_id = _required_text(record.get("subject_id"))
        if subject_id is None:
            issues.append(_issue(f"{path}.subject_id", "subject_id is required"))
        elif subject_id in subject_ids:
            issues.append(_issue(f"{path}.subject_id", "duplicate subject_id"))
        else:
            subject_ids.add(subject_id)
        if _required_text(record.get("display_name")) is None:
            issues.append(_issue(f"{path}.display_name", "display_name is required"))
        if (
            _required_text(record.get("service_family"))
            not in SERVICE_STATUS_ALLOWED_SERVICE_FAMILIES
        ):
            issues.append(_issue(f"{path}.service_family", "unsupported service_family"))
        observed_status = _required_text(record.get("observed_status"))
        if observed_status not in SERVICE_STATUS_ALLOWED_OBSERVED_STATUSES:
            issues.append(_issue(f"{path}.observed_status", "unsupported observed_status"))
        _validate_rfc3339(record.get("effective_from"), f"{path}.effective_from", issues)
        _validate_rfc3339(record.get("effective_until"), f"{path}.effective_until", issues)
        source_refs = _list_of_text(record.get("related_notice_refs"))
        if not source_refs:
            issues.append(_issue(f"{path}.related_notice_refs", "related_notice_refs is required"))
    rejected_sources = _list_of_dicts(bundle.get("service_status_rejected_sources"))
    for index, record in enumerate(rejected_sources):
        path = f"service_status_rejected_sources[{index}]"
        if _required_text(record.get("source_notice_id")) is None:
            issues.append(_issue(f"{path}.source_notice_id", "source_notice_id is required"))
        if _required_text(record.get("source_ref")) is None:
            issues.append(_issue(f"{path}.source_ref", "source_ref is required"))
        if _required_text(record.get("reason")) is None:
            issues.append(_issue(f"{path}.reason", "reason is required"))
    return ServiceStatusProjectionValidationReport(
        schema_version=SERVICE_STATUS_VALIDATION_REPORT_SCHEMA_VERSION,
        valid=not issues,
        issues=issues,
        counts={
            "service_status_records": len(records),
            "rejected_sources": len(rejected_sources),
        },
    )


def write_service_status_projection_release(
    *,
    bundle: dict[str, Any],
    output_dir: Path,
    release_id: str,
    generated_at: str,
    object_store: ServiceStatusProjectionObjectStore | None = None,
    bucket: str | None = None,
    write_current: bool = True,
) -> ServiceStatusProjectionReleaseReport:
    normalized_release_id = _path_segment(release_id, "release_id")
    output_root = Path(output_dir)
    release_dir = output_root / normalized_release_id
    current_dir = output_root / "current"
    release_dir.mkdir(parents=True, exist_ok=True)

    bundle_bytes = _json_bytes(bundle)
    validation_report = validate_service_status_projection_bundle(bundle)
    validation_payload = asdict(validation_report)
    release_object_key = build_index_release_artifact_key(
        corpus=SERVICE_STATUS_CORPUS,
        collection=SERVICE_STATUS_COLLECTION,
        release_id=normalized_release_id,
        filename=SERVICE_STATUS_PROJECTION_FILENAME,
    )
    current_object_key = build_index_release_artifact_key(
        corpus=SERVICE_STATUS_CORPUS,
        collection=SERVICE_STATUS_COLLECTION,
        release_id="current",
        filename=SERVICE_STATUS_PROJECTION_FILENAME,
    )
    rejected_source_report_object_key = build_index_release_artifact_key(
        corpus=SERVICE_STATUS_CORPUS,
        collection=SERVICE_STATUS_COLLECTION,
        release_id=normalized_release_id,
        filename=SERVICE_STATUS_REJECTED_SOURCE_REPORT_FILENAME,
    )
    release_manifest = {
        "schema_version": SERVICE_STATUS_RELEASE_MANIFEST_SCHEMA_VERSION,
        "release_id": normalized_release_id,
        "generated_at": generated_at,
        "corpus": SERVICE_STATUS_CORPUS,
        "collection": SERVICE_STATUS_COLLECTION,
        "projection_object_key": release_object_key,
        "current_projection_object_key": current_object_key,
        "rejected_source_report_object_key": rejected_source_report_object_key,
        "validation_valid": validation_report.valid,
        "counts": dict(validation_report.counts),
    }

    projection_path = release_dir / SERVICE_STATUS_PROJECTION_FILENAME
    current_projection_path = current_dir / SERVICE_STATUS_PROJECTION_FILENAME
    validation_path = release_dir / SERVICE_STATUS_VALIDATION_FILENAME
    manifest_path = release_dir / SERVICE_STATUS_RELEASE_MANIFEST_FILENAME
    rejected_source_path = release_dir / SERVICE_STATUS_REJECTED_SOURCE_REPORT_FILENAME
    projection_path.write_bytes(bundle_bytes)
    if write_current:
        current_dir.mkdir(parents=True, exist_ok=True)
        current_projection_path.write_bytes(bundle_bytes)
    validation_path.write_bytes(_json_bytes(validation_payload))
    manifest_path.write_bytes(_json_bytes(release_manifest))
    rejected_source_path.write_bytes(
        _json_bytes(
            {
                "schema_version": "service_status_rejected_source_report.v1",
                "release_id": normalized_release_id,
                "generated_at": generated_at,
                "rejected_source_count": len(
                    _list_of_dicts(bundle.get("service_status_rejected_sources"))
                ),
                "rejected_sources": _list_of_dicts(bundle.get("service_status_rejected_sources")),
            }
        )
    )

    if object_store is not None:
        if not bucket:
            raise ValueError("bucket is required when object_store is provided")
        uploads: list[tuple[str, bytes]] = [
            (release_object_key, bundle_bytes),
            (
                build_index_release_artifact_key(
                    corpus=SERVICE_STATUS_CORPUS,
                    collection=SERVICE_STATUS_COLLECTION,
                    release_id=normalized_release_id,
                    filename=SERVICE_STATUS_VALIDATION_FILENAME,
                ),
                _json_bytes(validation_payload),
            ),
            (
                build_index_release_artifact_key(
                    corpus=SERVICE_STATUS_CORPUS,
                    collection=SERVICE_STATUS_COLLECTION,
                    release_id=normalized_release_id,
                    filename=SERVICE_STATUS_RELEASE_MANIFEST_FILENAME,
                ),
                _json_bytes(release_manifest),
            ),
            (
                rejected_source_report_object_key,
                rejected_source_path.read_bytes(),
            ),
        ]
        if write_current:
            uploads.append((current_object_key, bundle_bytes))
        for key, data in uploads:
            object_store.put_bytes(
                bucket=bucket,
                key=key,
                data=data,
                content_type="application/json",
            )

    return ServiceStatusProjectionReleaseReport(
        schema_version=SERVICE_STATUS_RELEASE_MANIFEST_SCHEMA_VERSION,
        release_id=normalized_release_id,
        generated_at=generated_at,
        projection_path=str(projection_path),
        current_projection_path=str(current_projection_path) if write_current else "",
        release_object_key=release_object_key,
        current_object_key=current_object_key if write_current else "",
        validation_summary_path=str(validation_path),
        release_manifest_path=str(manifest_path),
        rejected_source_report_path=str(rejected_source_path),
        rejected_source_report_object_key=rejected_source_report_object_key,
    )


def _issue(path: str, message: str) -> dict[str, str]:
    return {"path": path, "message": message}


def _list_of_dicts(value: object) -> list[dict[str, Any]]:
    if not isinstance(value, list):
        return []
    return [dict(item) for item in value if isinstance(item, dict)]


def _list_of_text(value: object) -> list[str]:
    if not isinstance(value, list):
        return []
    return [text for item in value if (text := str(item).strip())]


def _required_text(value: object) -> str | None:
    if not isinstance(value, str):
        return None
    normalized = value.strip()
    return normalized or None


def _validate_rfc3339(value: object, path: str, issues: list[dict[str, Any]]) -> None:
    text = _required_text(value)
    if text is None:
        issues.append(_issue(path, "RFC3339 datetime is required"))
        return
    try:
        datetime.fromisoformat(text)
    except ValueError:
        issues.append(_issue(path, "invalid RFC3339 datetime"))


def _path_segment(value: str, field_name: str) -> str:
    normalized = str(value or "").strip()
    if not normalized:
        raise ValueError(f"{field_name} is required")
    if "/" in normalized or "\\" in normalized:
        raise ValueError(f"{field_name} must not contain path separators")
    return normalized


def _json_bytes(payload: object) -> bytes:
    return (json.dumps(payload, ensure_ascii=False, indent=2) + "\n").encode("utf-8")


__all__ = [
    "SERVICE_STATUS_COLLECTION",
    "SERVICE_STATUS_CORPUS",
    "SERVICE_STATUS_PROJECTION_FILENAME",
    "SERVICE_STATUS_PROJECTION_SCHEMA_VERSION",
    "SERVICE_STATUS_REJECTED_SOURCE_REPORT_FILENAME",
    "ServiceStatusProjectionBuildResult",
    "ServiceStatusProjectionReleaseReport",
    "ServiceStatusProjectionValidationReport",
    "validate_service_status_projection_bundle",
    "write_service_status_projection_release",
]
