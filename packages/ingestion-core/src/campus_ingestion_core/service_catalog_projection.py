from __future__ import annotations

import hashlib
import json
import re
from dataclasses import asdict, dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Protocol

from campus_ingestion_core.object_store import build_index_release_artifact_key

SERVICE_CATALOG_PROJECTION_SCHEMA_VERSION = "campus_services_service_catalog_projection.v1"
SERVICE_CATALOG_VALIDATION_REPORT_SCHEMA_VERSION = "service_catalog_projection_validation_report.v1"
SERVICE_CATALOG_RELEASE_MANIFEST_SCHEMA_VERSION = "service_catalog_projection_release_manifest.v1"
SERVICE_CATALOG_CORPUS = "campus_services"
SERVICE_CATALOG_COLLECTION = "service_catalog"
SERVICE_CATALOG_PROJECTION_FILENAME = "service-catalog-projection.json"
SERVICE_CATALOG_VALIDATION_FILENAME = "validation-summary.json"
SERVICE_CATALOG_RELEASE_MANIFEST_FILENAME = "release-manifest.json"
SERVICE_CATALOG_MANUAL_REVIEW_FILENAME = "manual-review-report.json"
SERVICE_GUIDE_PROJECTION_SOURCE_FAMILY = "service_guide_projection_v1"
CONTACT_DIRECTORY_PROJECTION_SOURCE_FAMILY = "contact_directory_projection_v1"


class ServiceCatalogProjectionObjectStore(Protocol):
    def put_bytes(
        self,
        *,
        bucket: str,
        key: str,
        data: bytes,
        content_type: str,
    ) -> None: ...


@dataclass(frozen=True, slots=True)
class ServiceCatalogProjectionBuildResult:
    bundle: dict[str, Any]
    validation_report: ServiceCatalogProjectionValidationReport
    manual_review_sources: list[dict[str, Any]]


@dataclass(frozen=True, slots=True)
class ServiceCatalogProjectionValidationReport:
    schema_version: str
    valid: bool
    issues: list[dict[str, Any]]
    counts: dict[str, int]


@dataclass(frozen=True, slots=True)
class ServiceCatalogProjectionReleaseReport:
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


def build_service_catalog_projection_bundle(
    *,
    service_guide_bundle: dict[str, Any],
    generated_at: str,
    contact_directory_bundle: dict[str, Any] | None = None,
) -> ServiceCatalogProjectionBuildResult:
    _parse_rfc3339(generated_at, "generated_at")
    source_families = [SERVICE_GUIDE_PROJECTION_SOURCE_FAMILY]
    contact_records = _ready_contact_records(contact_directory_bundle)
    if contact_directory_bundle is not None:
        source_families.append(CONTACT_DIRECTORY_PROJECTION_SOURCE_FAMILY)
    contact_index = _contact_index(contact_records)

    entries: list[dict[str, Any]] = []
    manual_review_sources: list[dict[str, Any]] = []
    for record in _list_of_dicts(service_guide_bundle.get("service_guide_records")):
        service_id = _required_text(record.get("service_id"))
        display_name = _required_text(record.get("display_name"))
        if service_id is None or display_name is None:
            manual_review_sources.append(
                {
                    "reason": "service_guide_record_identity_missing",
                    "service_id": service_id or "",
                    "display_name": display_name or "",
                }
            )
            continue
        extraction_status = _required_text(record.get("extraction_status")) or "incomplete"
        if extraction_status != "ready":
            manual_review_sources.append(
                {
                    "reason": "service_guide_record_not_ready",
                    "service_id": service_id,
                    "extraction_status": extraction_status,
                }
            )

        linked_contacts = _matched_contacts_for_service_guide_record(
            record=record,
            contact_index=contact_index,
        )
        contact_record_refs = [contact["contact_id"] for contact in linked_contacts]
        owner_department = _owner_department(linked_contacts)
        source_refs = _unique_strings(
            [
                *_string_list(record.get("source_refs")),
                *_source_refs_from_entry_refs(record.get("entry_refs")),
                *_source_refs_from_contact_records(linked_contacts),
            ]
        )
        entries.append(
            {
                "service_id": service_id,
                "display_name": display_name,
                "aliases": _unique_strings([display_name, *_string_list(record.get("aliases"))]),
                "category": _required_text(record.get("category")) or "uncategorized",
                "campus_scope": _required_text(record.get("campus_scope")) or "all",
                "audience": _string_list(record.get("audience")) or ["unknown"],
                "owner_department": owner_department,
                "guide_record_refs": [service_id],
                "contact_record_refs": contact_record_refs,
                "entry_refs": _service_catalog_entry_refs(record.get("entry_refs")),
                "source_refs": source_refs,
                "effective_from": _required_text(record.get("effective_from")) or "",
                "effective_until": _required_text(record.get("effective_until")) or "",
                "extraction_status": extraction_status,
            }
        )

    entries.sort(key=lambda item: (item["category"], item["display_name"]))
    bundle = {
        "schema_version": SERVICE_CATALOG_PROJECTION_SCHEMA_VERSION,
        "generated_at": generated_at,
        "source_families": source_families,
        "service_entries": entries,
        "conflict_records": [],
        "manual_review_sources": manual_review_sources,
    }
    validation_report = validate_service_catalog_projection_bundle(bundle)
    return ServiceCatalogProjectionBuildResult(
        bundle=bundle,
        validation_report=validation_report,
        manual_review_sources=manual_review_sources,
    )


def validate_service_catalog_projection_bundle(
    bundle: dict[str, Any],
) -> ServiceCatalogProjectionValidationReport:
    issues: list[dict[str, Any]] = []
    if bundle.get("schema_version") != SERVICE_CATALOG_PROJECTION_SCHEMA_VERSION:
        issues.append(_issue("schema_version", "unsupported service catalog projection schema"))
    _validate_rfc3339_field(bundle, "generated_at", "generated_at", issues)
    if not _string_list(bundle.get("source_families")):
        issues.append(_issue("source_families", "source_families is required"))

    entries = _list_of_dicts(bundle.get("service_entries"))
    conflicts = _list_of_dicts(bundle.get("conflict_records"))
    manual_review_sources = _list_of_dicts(bundle.get("manual_review_sources"))
    service_ids: set[str] = set()
    for entry_index, entry in enumerate(entries):
        path = f"service_entries[{entry_index}]"
        service_id = _required_text(entry.get("service_id"))
        if service_id is None:
            issues.append(_issue(f"{path}.service_id", "service_id is required"))
        elif service_id in service_ids:
            issues.append(_issue(f"{path}.service_id", f"duplicate service_id: {service_id}"))
        elif not service_id.startswith("service:"):
            issues.append(_issue(f"{path}.service_id", "service_id must start with service:"))
        if service_id:
            service_ids.add(service_id)

        extraction_status = _required_text(entry.get("extraction_status"))
        if extraction_status not in {"ready", "needs_manual_review", "conflicted", "incomplete"}:
            issues.append(_issue(f"{path}.extraction_status", "unsupported extraction_status"))
        _validate_required_text(entry, "display_name", path, issues)
        if not _string_list(entry.get("aliases")):
            issues.append(_issue(f"{path}.aliases", "aliases is required"))
        _validate_required_text(entry, "category", path, issues)
        _validate_required_text(entry, "campus_scope", path, issues)
        if not _string_list(entry.get("audience")):
            issues.append(_issue(f"{path}.audience", "audience is required"))
        if extraction_status == "ready" and not _string_list(entry.get("source_refs")):
            issues.append(_issue(f"{path}.source_refs", "source_refs is required"))
        if extraction_status == "ready" and not _string_list(entry.get("guide_record_refs")):
            issues.append(_issue(f"{path}.guide_record_refs", "guide_record_refs is required"))
        _validate_rfc3339_field(entry, "effective_from", f"{path}.effective_from", issues)
        _validate_rfc3339_field(entry, "effective_until", f"{path}.effective_until", issues)
        _validate_effective_window_fields(entry, path, issues)
        for entry_ref_index, entry_ref in enumerate(_list_of_dicts(entry.get("entry_refs"))):
            entry_ref_path = f"{path}.entry_refs[{entry_ref_index}]"
            _validate_required_text(entry_ref, "label", entry_ref_path, issues)
            _validate_required_text(entry_ref, "entry_type", entry_ref_path, issues)
            if not _string_list(entry_ref.get("source_refs")):
                issues.append(_issue(f"{entry_ref_path}.source_refs", "source_refs is required"))

    return ServiceCatalogProjectionValidationReport(
        schema_version=SERVICE_CATALOG_VALIDATION_REPORT_SCHEMA_VERSION,
        valid=not issues,
        issues=issues,
        counts={
            "service_entries": len(entries),
            "conflict_records": len(conflicts),
            "manual_review_sources": len(manual_review_sources),
        },
    )


def assert_service_catalog_projection_release_ready(
    bundle: dict[str, Any],
    *,
    expected_ready_records: int | None = None,
) -> None:
    validation_report = validate_service_catalog_projection_bundle(bundle)
    if not validation_report.valid:
        messages = ", ".join(
            str(issue.get("message") or issue) for issue in validation_report.issues
        )
        raise ValueError(f"service catalog projection validation failed: {messages}")
    entries = _list_of_dicts(bundle.get("service_entries"))
    if not entries:
        raise ValueError("service catalog projection produced no ready entries")
    conflicts = _list_of_dicts(bundle.get("conflict_records"))
    if conflicts:
        raise ValueError("service catalog projection release blocked by unresolved conflicts")
    non_ready_entries = [
        entry for entry in entries if _required_text(entry.get("extraction_status")) != "ready"
    ]
    if non_ready_entries:
        raise ValueError("service catalog projection release blocked by manual review entries")
    manual_review_sources = _list_of_dicts(bundle.get("manual_review_sources"))
    if manual_review_sources:
        raise ValueError("service catalog projection release blocked by manual review sources")
    if expected_ready_records is not None and len(entries) != expected_ready_records:
        raise ValueError(
            "service catalog projection ready entry count mismatch: "
            f"expected {expected_ready_records}, got {len(entries)}"
        )


def write_service_catalog_projection_release(
    *,
    bundle: dict[str, Any],
    output_dir: Path,
    release_id: str,
    generated_at: str,
    expected_ready_records: int | None = None,
    manual_review_sources: list[dict[str, Any]] | None = None,
    object_store: ServiceCatalogProjectionObjectStore | None = None,
    bucket: str | None = None,
) -> ServiceCatalogProjectionReleaseReport:
    assert_service_catalog_projection_release_ready(
        bundle,
        expected_ready_records=expected_ready_records,
    )
    normalized_release_id = _path_segment(release_id, "release_id")
    output_root = Path(output_dir)
    release_dir = output_root / normalized_release_id
    current_dir = output_root / "current"
    release_dir.mkdir(parents=True, exist_ok=True)
    current_dir.mkdir(parents=True, exist_ok=True)

    bundle_bytes = _json_bytes(bundle)
    validation_report = validate_service_catalog_projection_bundle(bundle)
    validation_payload = asdict(validation_report)
    manual_review_payload = manual_review_sources
    if manual_review_payload is None:
        manual_review_payload = _list_of_dicts(bundle.get("manual_review_sources"))
    release_object_key = build_index_release_artifact_key(
        corpus=SERVICE_CATALOG_CORPUS,
        collection=SERVICE_CATALOG_COLLECTION,
        release_id=normalized_release_id,
        filename=SERVICE_CATALOG_PROJECTION_FILENAME,
    )
    current_object_key = build_index_release_artifact_key(
        corpus=SERVICE_CATALOG_CORPUS,
        collection=SERVICE_CATALOG_COLLECTION,
        release_id="current",
        filename=SERVICE_CATALOG_PROJECTION_FILENAME,
    )
    release_manifest = {
        "schema_version": SERVICE_CATALOG_RELEASE_MANIFEST_SCHEMA_VERSION,
        "release_id": normalized_release_id,
        "generated_at": generated_at,
        "corpus": SERVICE_CATALOG_CORPUS,
        "collection": SERVICE_CATALOG_COLLECTION,
        "projection_object_key": release_object_key,
        "current_projection_object_key": current_object_key,
        "validation_valid": validation_report.valid,
        "counts": dict(validation_report.counts),
    }

    projection_path = release_dir / SERVICE_CATALOG_PROJECTION_FILENAME
    current_projection_path = current_dir / SERVICE_CATALOG_PROJECTION_FILENAME
    validation_path = release_dir / SERVICE_CATALOG_VALIDATION_FILENAME
    manifest_path = release_dir / SERVICE_CATALOG_RELEASE_MANIFEST_FILENAME
    manual_review_path = release_dir / SERVICE_CATALOG_MANUAL_REVIEW_FILENAME
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
                    corpus=SERVICE_CATALOG_CORPUS,
                    collection=SERVICE_CATALOG_COLLECTION,
                    release_id=normalized_release_id,
                    filename=SERVICE_CATALOG_VALIDATION_FILENAME,
                ),
                _json_bytes(validation_payload),
            ),
            (
                build_index_release_artifact_key(
                    corpus=SERVICE_CATALOG_CORPUS,
                    collection=SERVICE_CATALOG_COLLECTION,
                    release_id=normalized_release_id,
                    filename=SERVICE_CATALOG_RELEASE_MANIFEST_FILENAME,
                ),
                _json_bytes(release_manifest),
            ),
            (
                build_index_release_artifact_key(
                    corpus=SERVICE_CATALOG_CORPUS,
                    collection=SERVICE_CATALOG_COLLECTION,
                    release_id=normalized_release_id,
                    filename=SERVICE_CATALOG_MANUAL_REVIEW_FILENAME,
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

    return ServiceCatalogProjectionReleaseReport(
        schema_version=SERVICE_CATALOG_RELEASE_MANIFEST_SCHEMA_VERSION,
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


def write_service_catalog_projection_release_from_current_projections(
    *,
    service_guide_projection_path: Path | str,
    output_dir: Path,
    generated_at: str,
    object_store: ServiceCatalogProjectionObjectStore,
    bucket: str,
    contact_directory_projection_path: Path | str | None = None,
    release_id: str | None = None,
    expected_ready_records: int | None = None,
) -> ServiceCatalogProjectionReleaseReport:
    service_guide_bundle = _read_json_object(Path(service_guide_projection_path))
    contact_directory_bundle = (
        _read_json_object(Path(contact_directory_projection_path))
        if contact_directory_projection_path is not None
        else None
    )
    build_result = build_service_catalog_projection_bundle(
        service_guide_bundle=service_guide_bundle,
        contact_directory_bundle=contact_directory_bundle,
        generated_at=generated_at,
    )
    resolved_expected_ready_records = (
        expected_ready_records
        if expected_ready_records is not None
        else _ready_service_guide_record_count(service_guide_bundle)
    )
    return write_service_catalog_projection_release(
        bundle=build_result.bundle,
        output_dir=output_dir,
        release_id=release_id or _service_catalog_release_id(generated_at),
        generated_at=generated_at,
        expected_ready_records=resolved_expected_ready_records,
        manual_review_sources=build_result.manual_review_sources,
        object_store=object_store,
        bucket=bucket,
    )


def _matched_contacts_for_service_guide_record(
    *,
    record: dict[str, Any],
    contact_index: dict[str, dict[str, Any]],
) -> list[dict[str, Any]]:
    matches: list[dict[str, Any]] = []
    seen_ids: set[str] = set()
    candidate_terms = [
        *(
            _required_text(entry.get("label")) or ""
            for entry in _list_of_dicts(record.get("entry_refs"))
        ),
        *(
            _required_text(contact.get("label")) or ""
            for contact in _list_of_dicts(record.get("contact_refs"))
        ),
        *(
            _required_text(contact.get("department")) or ""
            for contact in _list_of_dicts(record.get("contact_refs"))
        ),
    ]
    for term in candidate_terms:
        contact = contact_index.get(_normalize_search_text(term))
        if not contact:
            continue
        contact_id = str(contact.get("contact_id") or "")
        if contact_id and contact_id not in seen_ids:
            seen_ids.add(contact_id)
            matches.append(contact)
    return matches


def _ready_contact_records(contact_directory_bundle: dict[str, Any] | None) -> list[dict[str, Any]]:
    if contact_directory_bundle is None:
        return []
    return [
        record
        for record in _list_of_dicts(contact_directory_bundle.get("contact_records"))
        if _required_text(record.get("extraction_status")) == "ready"
        and _required_text(record.get("contact_id")) is not None
    ]


def _ready_service_guide_record_count(service_guide_bundle: dict[str, Any]) -> int:
    return sum(
        1
        for record in _list_of_dicts(service_guide_bundle.get("service_guide_records"))
        if _required_text(record.get("extraction_status")) == "ready"
        and _required_text(record.get("service_id")) is not None
    )


def _contact_index(contact_records: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    index: dict[str, dict[str, Any]] = {}
    for contact in contact_records:
        terms = [
            _required_text(contact.get("display_name")) or "",
            _required_text(contact.get("department")) or "",
            *_string_list(contact.get("aliases")),
        ]
        for term in terms:
            normalized = _normalize_search_text(term)
            if normalized and normalized not in index:
                index[normalized] = contact
    return index


def _owner_department(linked_contacts: list[dict[str, Any]]) -> str:
    if not linked_contacts:
        return ""
    first = linked_contacts[0]
    return (
        _required_text(first.get("department")) or _required_text(first.get("display_name")) or ""
    )


def _service_catalog_entry_refs(raw: object) -> list[dict[str, Any]]:
    refs: list[dict[str, Any]] = []
    for item in _list_of_dicts(raw):
        label = _required_text(item.get("label"))
        entry_type = _required_text(item.get("entry_type"))
        if label is None or entry_type is None:
            continue
        refs.append(
            {
                "label": label,
                "entry_type": entry_type,
                "url": _required_text(item.get("url")) or "",
                "location_ref": _required_text(item.get("location_ref")) or "",
                "source_refs": _string_list(item.get("source_refs")),
            }
        )
    return refs


def _source_refs_from_entry_refs(raw: object) -> list[str]:
    refs: list[str] = []
    for item in _list_of_dicts(raw):
        refs.extend(_string_list(item.get("source_refs")))
    return refs


def _source_refs_from_contact_records(records: list[dict[str, Any]]) -> list[str]:
    refs: list[str] = []
    for record in records:
        refs.extend(_string_list(record.get("source_refs")))
        for phone in _list_of_dicts(record.get("phones")):
            refs.extend(_string_list(phone.get("source_refs")))
        for email in _list_of_dicts(record.get("emails")):
            refs.extend(_string_list(email.get("source_refs")))
    return refs


def _validate_required_text(
    record: dict[str, Any],
    field_name: str,
    path: str,
    issues: list[dict[str, Any]],
) -> None:
    if _required_text(record.get(field_name)) is None:
        issues.append(_issue(f"{path}.{field_name}", f"{field_name} is required"))


def _validate_rfc3339_field(
    record: dict[str, Any],
    field_name: str,
    path: str,
    issues: list[dict[str, Any]],
) -> None:
    value = _required_text(record.get(field_name))
    if value is None:
        issues.append(_issue(path, f"{field_name} is required"))
        return
    try:
        _parse_rfc3339(value, field_name)
    except ValueError as exc:
        issues.append(_issue(path, str(exc)))


def _validate_effective_window_fields(
    record: dict[str, Any],
    path: str,
    issues: list[dict[str, Any]],
) -> None:
    effective_from = _required_text(record.get("effective_from"))
    effective_until = _required_text(record.get("effective_until"))
    if effective_from is None or effective_until is None:
        return
    try:
        start = _parse_rfc3339(effective_from, "effective_from")
        end = _parse_rfc3339(effective_until, "effective_until")
    except ValueError:
        return
    if not end > start:
        issues.append(
            _issue(f"{path}.effective_until", "effective_until must be after effective_from")
        )


def _parse_rfc3339(value: str, field_name: str) -> datetime:
    normalized = value.replace("Z", "+00:00")
    try:
        parsed = datetime.fromisoformat(normalized)
    except ValueError as exc:
        raise ValueError(f"{field_name} must be RFC3339") from exc
    if parsed.tzinfo is None:
        raise ValueError(f"{field_name} must include timezone")
    return parsed.astimezone(UTC)


def _required_text(value: object) -> str | None:
    if not isinstance(value, str):
        return None
    normalized = value.strip()
    return normalized or None


def _string_list(value: object) -> list[str]:
    if not isinstance(value, list | tuple):
        return []
    return [item.strip() for item in value if isinstance(item, str) and item.strip()]


def _list_of_dicts(value: object) -> list[dict[str, Any]]:
    if not isinstance(value, list | tuple):
        return []
    return [dict(item) for item in value if isinstance(item, dict)]


def _unique_strings(values: list[str]) -> list[str]:
    seen: set[str] = set()
    unique: list[str] = []
    for value in values:
        normalized = value.strip()
        if not normalized or normalized in seen:
            continue
        seen.add(normalized)
        unique.append(normalized)
    return unique


def _normalize_search_text(value: str) -> str:
    return re.sub(r"[\s:：,，。；;（）()《》<>]+", "", value.strip().lower())


def _json_bytes(payload: object) -> bytes:
    return (json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True) + "\n").encode(
        "utf-8"
    )


def _path_segment(value: str, field_name: str) -> str:
    normalized = value.strip()
    if not normalized or "/" in normalized or "\\" in normalized:
        raise ValueError(f"{field_name} must be a safe path segment")
    return normalized


def _service_catalog_release_id(generated_at: str) -> str:
    safe_timestamp = re.sub(r"[^0-9A-Za-z]+", "", generated_at)
    digest = hashlib.sha1(generated_at.encode("utf-8")).hexdigest()[:10]
    return f"service-catalog-handbook-{safe_timestamp}-{digest}"


def _read_json_object(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def _issue(path: str, message: str) -> dict[str, str]:
    return {"path": path, "message": message}
