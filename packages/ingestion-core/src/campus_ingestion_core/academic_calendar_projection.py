from __future__ import annotations

import hashlib
import json
from dataclasses import asdict, dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Protocol

from campus_ingestion_core.object_store import build_index_release_artifact_key

OFFICIAL_WEB_CURATED_ACADEMIC_CALENDAR_SCHEMA_VERSION = "official_web_curated_academic_calendar.v1"
ACADEMIC_CALENDAR_PROJECTION_SCHEMA_VERSION = "academic_calendar_projection.v1"
ACADEMIC_CALENDAR_VALIDATION_REPORT_SCHEMA_VERSION = "academic_calendar_projection_validation.v1"
ACADEMIC_CALENDAR_RELEASE_MANIFEST_SCHEMA_VERSION = (
    "academic_calendar_projection_release_manifest.v1"
)
ACADEMIC_CALENDAR_SOURCE_TRUTH_MANIFEST_SCHEMA_VERSION = (
    "academic_calendar_source_truth_manifest.v1"
)
ACADEMIC_CALENDAR_CORPUS = "calendar"
ACADEMIC_CALENDAR_COLLECTION = "academic_calendar"
ACADEMIC_CALENDAR_PROJECTION_FILENAME = "academic-calendar-projection.json"
ACADEMIC_CALENDAR_VALIDATION_FILENAME = "validation-summary.json"
ACADEMIC_CALENDAR_RELEASE_MANIFEST_FILENAME = "release-manifest.json"
ACADEMIC_CALENDAR_MANUAL_REVIEW_FILENAME = "manual-review-report.json"
OFFICIAL_WEB_CURATED_ACADEMIC_CALENDAR_SOURCE_FAMILY = "official_web_curated_academic_calendar_v1"


class AcademicCalendarProjectionObjectStore(Protocol):
    def put_bytes(
        self,
        *,
        bucket: str,
        key: str,
        data: bytes,
        content_type: str,
    ) -> None: ...


@dataclass(frozen=True, slots=True)
class AcademicCalendarProjectionValidationReport:
    schema_version: str
    valid: bool
    issues: list[dict[str, Any]]
    counts: dict[str, int]


@dataclass(frozen=True, slots=True)
class AcademicCalendarProjectionReleaseReport:
    schema_version: str
    release_id: str
    generated_at: str
    projection_path: str
    current_projection_path: str
    release_object_key: str
    current_object_key: str
    validation_summary_path: str
    release_manifest_path: str
    manual_review_report_path: str


@dataclass(frozen=True, slots=True)
class AcademicCalendarProjectionBuildResult:
    bundle: dict[str, Any]
    validation_report: AcademicCalendarProjectionValidationReport
    manual_review_sources: list[dict[str, Any]]


@dataclass(frozen=True, slots=True)
class AcademicCalendarSourceTruthManifest:
    path: Path
    target_corpus: str
    target_collection: str
    upstream_source_channel: str
    release_id_prefix: str
    expected_ready_records: int | None
    curated_academic_calendar_paths: tuple[Path, ...]


def build_academic_calendar_projection_bundle_from_curated_source_truth(
    *,
    curated_source_truth_artifact: dict[str, Any],
    generated_at: str,
) -> AcademicCalendarProjectionBuildResult:
    _parse_rfc3339(generated_at, "generated_at")
    artifact = _require_mapping(
        curated_source_truth_artifact,
        "curated_source_truth_artifact",
    )
    schema_version = str(artifact.get("schemaVersion") or "").strip()
    if schema_version != OFFICIAL_WEB_CURATED_ACADEMIC_CALENDAR_SCHEMA_VERSION:
        raise ValueError(f"unsupported curated academic calendar schemaVersion: {schema_version!r}")
    if not _required_text(artifact.get("projectionName")):
        raise ValueError("curated academic calendar projectionName is required")
    document_data = _require_mapping(artifact.get("documentData"), "documentData")
    records = _coerce_curated_academic_calendar_records(document_data)
    records.sort(
        key=lambda item: (
            str(item.get("academic_year_label") or ""),
            str(item.get("term_label") or ""),
            str(item.get("start_date") or ""),
            str(item.get("day_kind") or ""),
        )
    )
    bundle = {
        "schema_version": ACADEMIC_CALENDAR_PROJECTION_SCHEMA_VERSION,
        "generated_at": generated_at,
        "source_families": [OFFICIAL_WEB_CURATED_ACADEMIC_CALENDAR_SOURCE_FAMILY],
        "source_documents": [
            {
                "title": _required_text(document_data.get("title")) or "academic calendar",
                "source_refs": _string_list(document_data.get("sourceRefs")),
            }
        ],
        "academic_calendar_records": records,
        "manual_review_sources": [],
    }
    validation_report = validate_academic_calendar_projection_bundle(bundle)
    return AcademicCalendarProjectionBuildResult(
        bundle=bundle,
        validation_report=validation_report,
        manual_review_sources=[],
    )


def load_academic_calendar_source_truth_manifest(
    path: Path | str,
) -> AcademicCalendarSourceTruthManifest:
    manifest_path = Path(path).resolve()
    payload = _require_mapping(
        json.loads(manifest_path.read_text(encoding="utf-8")),
        "academic_calendar_source_truth_manifest",
    )
    schema_version = _required_text(payload.get("schema_version"))
    if schema_version != ACADEMIC_CALENDAR_SOURCE_TRUTH_MANIFEST_SCHEMA_VERSION:
        raise ValueError(
            f"unsupported academic calendar source truth manifest schema_version: {schema_version!r}"
        )
    target_corpus = _required_text(payload.get("target_corpus"))
    target_collection = _required_text(payload.get("target_collection"))
    if (
        target_corpus != ACADEMIC_CALENDAR_CORPUS
        or target_collection != ACADEMIC_CALENDAR_COLLECTION
    ):
        raise ValueError(
            "academic calendar source truth manifest target must be calendar/academic_calendar"
        )
    upstream_source_channel = _required_text(payload.get("upstream_source_channel"))
    if upstream_source_channel != "official_web":
        raise ValueError("academic calendar source truth manifest upstream must be official_web")
    release_id_prefix = _required_text(payload.get("release_id_prefix")) or "academic-calendar"
    expected_ready_records = _optional_positive_int(payload.get("expected_ready_records"))
    curated_paths = _manifest_source_paths(
        payload.get("curated_academic_calendars"),
        manifest_dir=manifest_path.parent,
        field_name="curated_academic_calendars",
    )
    if not curated_paths:
        raise ValueError(
            "academic calendar source truth manifest must declare at least one curated calendar"
        )
    return AcademicCalendarSourceTruthManifest(
        path=manifest_path,
        target_corpus=target_corpus,
        target_collection=target_collection,
        upstream_source_channel=upstream_source_channel,
        release_id_prefix=release_id_prefix,
        expected_ready_records=expected_ready_records,
        curated_academic_calendar_paths=curated_paths,
    )


def build_academic_calendar_projection_bundle_from_source_truth_manifest(
    *,
    source_truth_manifest_path: Path | str,
    generated_at: str,
) -> AcademicCalendarProjectionBuildResult:
    manifest = load_academic_calendar_source_truth_manifest(source_truth_manifest_path)
    build_results = [
        build_academic_calendar_projection_bundle_from_curated_source_truth(
            curated_source_truth_artifact=_read_json_object(path),
            generated_at=generated_at,
        )
        for path in manifest.curated_academic_calendar_paths
    ]
    return (
        build_results[0]
        if len(build_results) == 1
        else merge_academic_calendar_projection_build_results(
            build_results=build_results,
            generated_at=generated_at,
        )
    )


def write_academic_calendar_projection_release_from_source_truth_manifest(
    *,
    source_truth_manifest_path: Path | str,
    output_dir: Path,
    generated_at: str,
    object_store: AcademicCalendarProjectionObjectStore,
    bucket: str,
    release_id: str | None = None,
) -> AcademicCalendarProjectionReleaseReport:
    manifest = load_academic_calendar_source_truth_manifest(source_truth_manifest_path)
    build_result = build_academic_calendar_projection_bundle_from_source_truth_manifest(
        source_truth_manifest_path=source_truth_manifest_path,
        generated_at=generated_at,
    )
    assert_academic_calendar_projection_release_ready(
        build_result.bundle,
        expected_ready_records=manifest.expected_ready_records,
    )
    return write_academic_calendar_projection_release(
        bundle=build_result.bundle,
        output_dir=output_dir,
        release_id=release_id
        or _academic_calendar_release_id(manifest.release_id_prefix, generated_at),
        generated_at=generated_at,
        manual_review_sources=build_result.manual_review_sources,
        object_store=object_store,
        bucket=bucket,
    )


def merge_academic_calendar_projection_build_results(
    *,
    build_results: list[AcademicCalendarProjectionBuildResult],
    generated_at: str,
) -> AcademicCalendarProjectionBuildResult:
    _parse_rfc3339(generated_at, "generated_at")
    source_families: list[str] = []
    source_documents: list[dict[str, Any]] = []
    records: list[dict[str, Any]] = []
    manual_review_sources: list[dict[str, Any]] = []
    for build_result in build_results:
        bundle = build_result.bundle
        for source_family in _string_list(bundle.get("source_families")):
            if source_family not in source_families:
                source_families.append(source_family)
        source_documents.extend(_list_of_dicts(bundle.get("source_documents")))
        records.extend(_list_of_dicts(bundle.get("academic_calendar_records")))
        manual_review_sources.extend(_list_of_dicts(bundle.get("manual_review_sources")))
    records.sort(
        key=lambda item: (
            str(item.get("academic_year_label") or ""),
            str(item.get("term_label") or ""),
            str(item.get("start_date") or ""),
            str(item.get("day_kind") or ""),
        )
    )
    bundle = {
        "schema_version": ACADEMIC_CALENDAR_PROJECTION_SCHEMA_VERSION,
        "generated_at": generated_at,
        "source_families": source_families,
        "source_documents": source_documents,
        "academic_calendar_records": records,
        "manual_review_sources": manual_review_sources,
    }
    validation_report = validate_academic_calendar_projection_bundle(bundle)
    return AcademicCalendarProjectionBuildResult(
        bundle=bundle,
        validation_report=validation_report,
        manual_review_sources=manual_review_sources,
    )


def validate_academic_calendar_projection_bundle(
    bundle: dict[str, Any],
) -> AcademicCalendarProjectionValidationReport:
    issues: list[dict[str, Any]] = []
    if bundle.get("schema_version") != ACADEMIC_CALENDAR_PROJECTION_SCHEMA_VERSION:
        issues.append(_issue("schema_version", "unsupported academic calendar projection schema"))
    records = _list_of_dicts(bundle.get("academic_calendar_records"))
    for index, record in enumerate(records):
        path = f"academic_calendar_records[{index}]"
        for field_name in (
            "academic_year_label",
            "term_label",
            "start_date",
            "end_date",
            "day_kind",
        ):
            if not _required_text(record.get(field_name)):
                issues.append(_issue(f"{path}.{field_name}", f"{field_name} is required"))
        if not isinstance(record.get("week_index"), int):
            issues.append(_issue(f"{path}.week_index", "week_index must be an integer"))
        if not isinstance(record.get("is_makeup_class"), bool):
            issues.append(_issue(f"{path}.is_makeup_class", "is_makeup_class must be a boolean"))
        if not _string_list(record.get("source_refs")):
            issues.append(_issue(f"{path}.source_refs", "source_refs is required"))
    return AcademicCalendarProjectionValidationReport(
        schema_version=ACADEMIC_CALENDAR_VALIDATION_REPORT_SCHEMA_VERSION,
        valid=not issues,
        issues=issues,
        counts={"academic_calendar_records": len(records)},
    )


def assert_academic_calendar_projection_release_ready(
    bundle: dict[str, Any],
    *,
    expected_ready_records: int | None = None,
) -> None:
    validation = validate_academic_calendar_projection_bundle(bundle)
    if not validation.valid:
        messages = ", ".join(str(issue.get("message") or issue) for issue in validation.issues)
        raise ValueError(f"academic calendar projection validation failed: {messages}")
    records = _list_of_dicts(bundle.get("academic_calendar_records"))
    if not records:
        raise ValueError("academic calendar projection produced no records")
    if expected_ready_records is not None and len(records) != expected_ready_records:
        raise ValueError(
            "academic calendar projection ready record count mismatch: "
            f"expected {expected_ready_records}, got {len(records)}"
        )


def write_academic_calendar_projection_release(
    *,
    bundle: dict[str, Any],
    output_dir: Path,
    release_id: str,
    generated_at: str,
    manual_review_sources: list[dict[str, Any]] | None = None,
    object_store: AcademicCalendarProjectionObjectStore | None = None,
    bucket: str | None = None,
) -> AcademicCalendarProjectionReleaseReport:
    normalized_release_id = _path_segment(release_id, "release_id")
    output_root = Path(output_dir)
    release_dir = output_root / normalized_release_id
    current_dir = output_root / "current"
    release_dir.mkdir(parents=True, exist_ok=True)
    current_dir.mkdir(parents=True, exist_ok=True)

    bundle_bytes = _json_bytes(bundle)
    validation_report = validate_academic_calendar_projection_bundle(bundle)
    validation_payload = asdict(validation_report)
    manual_review_payload = manual_review_sources or []
    release_object_key = build_index_release_artifact_key(
        corpus=ACADEMIC_CALENDAR_CORPUS,
        collection=ACADEMIC_CALENDAR_COLLECTION,
        release_id=normalized_release_id,
        filename=ACADEMIC_CALENDAR_PROJECTION_FILENAME,
    )
    current_object_key = build_index_release_artifact_key(
        corpus=ACADEMIC_CALENDAR_CORPUS,
        collection=ACADEMIC_CALENDAR_COLLECTION,
        release_id="current",
        filename=ACADEMIC_CALENDAR_PROJECTION_FILENAME,
    )
    release_manifest = {
        "schema_version": ACADEMIC_CALENDAR_RELEASE_MANIFEST_SCHEMA_VERSION,
        "release_id": normalized_release_id,
        "generated_at": generated_at,
        "corpus": ACADEMIC_CALENDAR_CORPUS,
        "collection": ACADEMIC_CALENDAR_COLLECTION,
        "projection_object_key": release_object_key,
        "current_projection_object_key": current_object_key,
        "validation_valid": validation_report.valid,
        "counts": dict(validation_report.counts),
    }

    projection_path = release_dir / ACADEMIC_CALENDAR_PROJECTION_FILENAME
    current_projection_path = current_dir / ACADEMIC_CALENDAR_PROJECTION_FILENAME
    validation_path = release_dir / ACADEMIC_CALENDAR_VALIDATION_FILENAME
    manifest_path = release_dir / ACADEMIC_CALENDAR_RELEASE_MANIFEST_FILENAME
    manual_review_path = release_dir / ACADEMIC_CALENDAR_MANUAL_REVIEW_FILENAME
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
                    corpus=ACADEMIC_CALENDAR_CORPUS,
                    collection=ACADEMIC_CALENDAR_COLLECTION,
                    release_id=normalized_release_id,
                    filename=ACADEMIC_CALENDAR_VALIDATION_FILENAME,
                ),
                _json_bytes(validation_payload),
            ),
            (
                build_index_release_artifact_key(
                    corpus=ACADEMIC_CALENDAR_CORPUS,
                    collection=ACADEMIC_CALENDAR_COLLECTION,
                    release_id=normalized_release_id,
                    filename=ACADEMIC_CALENDAR_RELEASE_MANIFEST_FILENAME,
                ),
                _json_bytes(release_manifest),
            ),
            (
                build_index_release_artifact_key(
                    corpus=ACADEMIC_CALENDAR_CORPUS,
                    collection=ACADEMIC_CALENDAR_COLLECTION,
                    release_id=normalized_release_id,
                    filename=ACADEMIC_CALENDAR_MANUAL_REVIEW_FILENAME,
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

    return AcademicCalendarProjectionReleaseReport(
        schema_version=ACADEMIC_CALENDAR_RELEASE_MANIFEST_SCHEMA_VERSION,
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


def _issue(path: str, message: str) -> dict[str, str]:
    return {"path": path, "message": message}


def _coerce_curated_academic_calendar_records(
    document_data: dict[str, Any],
) -> list[dict[str, Any]]:
    payload = _require_mapping(document_data, "documentData")
    if _required_text(payload.get("extractionStatus")) != "ready":
        raise ValueError("curated academic calendar extractionStatus must be ready")
    if bool(payload.get("manualReviewRequired")):
        raise ValueError("curated academic calendar no longer supports manual review")
    if _string_list(payload.get("manualReviewNotes")):
        raise ValueError("curated academic calendar no longer supports manual review notes")
    default_source_refs = _string_list(payload.get("sourceRefs"))
    if not default_source_refs:
        raise ValueError("curated academic calendar sourceRefs is required")
    records: list[dict[str, Any]] = []
    for index, raw_record in enumerate(_list_of_dicts(payload.get("records"))):
        notes = _string_list(raw_record.get("manualReviewNotes"))
        if notes:
            raise ValueError("curated academic calendar record no longer supports manual review")
        record = _curated_academic_calendar_record(
            raw_record,
            default_source_refs=default_source_refs,
            index=index,
        )
        records.append(record)
    if not records:
        raise ValueError("curated academic calendar documentData.records has no usable records")
    return records


def _curated_academic_calendar_record(
    raw_record: dict[str, Any],
    *,
    default_source_refs: list[str],
    index: int,
) -> dict[str, Any]:
    academic_year_label = _required_text(raw_record.get("academicYearLabel"))
    term_label = _required_text(raw_record.get("termLabel"))
    start_date = _required_text(raw_record.get("startDate"))
    end_date = _required_text(raw_record.get("endDate"))
    day_kind = _required_text(raw_record.get("dayKind"))
    if not academic_year_label:
        raise ValueError(f"documentData.records[{index}].academicYearLabel is required")
    if not term_label:
        raise ValueError(f"documentData.records[{index}].termLabel is required")
    if not start_date:
        raise ValueError(f"documentData.records[{index}].startDate is required")
    if not end_date:
        raise ValueError(f"documentData.records[{index}].endDate is required")
    if not day_kind:
        raise ValueError(f"documentData.records[{index}].dayKind is required")
    week_index = _non_negative_int(
        raw_record.get("weekIndex"),
        f"documentData.records[{index}].weekIndex",
    )
    is_makeup_class = raw_record.get("isMakeupClass")
    if not isinstance(is_makeup_class, bool):
        raise ValueError(f"documentData.records[{index}].isMakeupClass must be a boolean")
    source_refs = _string_list(raw_record.get("sourceRefs")) or default_source_refs
    if not source_refs:
        raise ValueError(f"documentData.records[{index}].sourceRefs is required")
    return {
        "calendar_record_id": _calendar_record_id(
            {
                "academic_year_label": academic_year_label,
                "term_label": term_label,
                "start_date": start_date,
                "end_date": end_date,
                "day_kind": day_kind,
                "week_index": week_index,
                "holiday_name": _required_text(raw_record.get("holidayName")) or "",
                "class_day_pattern": _required_text(raw_record.get("classDayPattern")) or "",
            }
        ),
        "academic_year_label": academic_year_label,
        "term_label": term_label,
        "start_date": start_date,
        "end_date": end_date,
        "week_index": week_index,
        "day_kind": day_kind,
        "class_day_pattern": _required_text(raw_record.get("classDayPattern")) or "",
        "is_makeup_class": is_makeup_class,
        "holiday_name": _required_text(raw_record.get("holidayName")) or "",
        "source_refs": _unique_strings(source_refs),
    }


def _calendar_record_id(seed: dict[str, Any]) -> str:
    encoded = json.dumps(seed, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode(
        "utf-8"
    )
    return "calendar:official_web:" + hashlib.sha1(encoded).hexdigest()[:16]


def _academic_calendar_release_id(prefix: str, generated_at: str) -> str:
    normalized_prefix = _path_segment(prefix, "release_id_prefix")
    timestamp = _parse_rfc3339(generated_at, "generated_at").strftime("%Y%m%dT%H%M%S")
    return f"{normalized_prefix}-{timestamp}"


def _manifest_source_paths(
    value: object,
    *,
    manifest_dir: Path,
    field_name: str,
) -> tuple[Path, ...]:
    paths: list[Path] = []
    for index, item in enumerate(_list_of_dicts(value)):
        raw_path = _required_text(item.get("path"))
        if not raw_path:
            raise ValueError(f"{field_name}[{index}].path is required")
        resolved_path = Path(raw_path)
        if not resolved_path.is_absolute():
            resolved_path = manifest_dir / resolved_path
        resolved_path = resolved_path.resolve()
        if not resolved_path.exists():
            raise ValueError(f"{field_name}[{index}].path does not exist: {resolved_path}")
        paths.append(resolved_path)
    return tuple(paths)


def _read_json_object(path: Path) -> dict[str, Any]:
    return _require_mapping(json.loads(path.read_text(encoding="utf-8")), str(path))


def _parse_rfc3339(value: str, field_name: str) -> datetime:
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError as exc:
        raise ValueError(f"{field_name} must be RFC3339 datetime") from exc
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=UTC)
    return parsed


def _require_mapping(value: object, label: str) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise ValueError(f"{label} must be an object")
    return dict(value)


def _required_text(value: object) -> str:
    return str(value or "").strip()


def _optional_positive_int(value: object) -> int | None:
    if value is None or value == "":
        return None
    if isinstance(value, bool):
        return None
    try:
        parsed = int(str(value))
    except ValueError:
        return None
    return parsed if parsed > 0 else None


def _non_negative_int(value: object, field_name: str) -> int:
    if isinstance(value, bool):
        raise ValueError(f"{field_name} must be a non-negative integer")
    try:
        parsed = int(str(value or "0"))
    except ValueError as exc:
        raise ValueError(f"{field_name} must be a non-negative integer") from exc
    if parsed < 0:
        raise ValueError(f"{field_name} must be a non-negative integer")
    return parsed


def _string_list(value: object) -> list[str]:
    if not isinstance(value, list):
        return []
    return [text for item in value if (text := str(item or "").strip())]


def _list_of_dicts(value: object) -> list[dict[str, Any]]:
    if not isinstance(value, list):
        return []
    return [dict(item) for item in value if isinstance(item, dict)]


def _unique_strings(values: list[str]) -> list[str]:
    unique: list[str] = []
    for value in values:
        normalized = str(value or "").strip()
        if normalized and normalized not in unique:
            unique.append(normalized)
    return unique


def _json_bytes(payload: object) -> bytes:
    return json.dumps(payload, ensure_ascii=False, indent=2).encode("utf-8")


def _path_segment(value: str, field_name: str) -> str:
    normalized = str(value or "").strip()
    if not normalized:
        raise ValueError(f"{field_name} is required")
    return normalized
