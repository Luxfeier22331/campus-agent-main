from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

from campus_ingestion_core.service_guide_projection_constants import (
    SERVICE_GUIDE_PROJECTION_SCHEMA_VERSION,
    SERVICE_GUIDE_VALIDATION_REPORT_SCHEMA_VERSION,
)
from campus_ingestion_core.service_guide_projection_models import (
    ServiceGuideProjectionValidationReport,
)


def validate_service_guide_projection_bundle(
    bundle: dict[str, Any],
) -> ServiceGuideProjectionValidationReport:
    issues: list[dict[str, Any]] = []
    if bundle.get("schema_version") != SERVICE_GUIDE_PROJECTION_SCHEMA_VERSION:
        issues.append(_issue("schema_version", "unsupported service guide projection schema"))
    _validate_rfc3339_field(bundle, "generated_at", "generated_at", issues)

    records = _list_of_dicts(bundle.get("service_guide_records"))
    conflicts = _list_of_dicts(bundle.get("conflict_records"))
    manual_review_sources = _list_of_dicts(bundle.get("manual_review_sources"))

    service_ids: set[str] = set()
    for record_index, record in enumerate(records):
        path = f"service_guide_records[{record_index}]"
        service_id = _required_text(record.get("service_id"))
        if service_id is None:
            issues.append(_issue(f"{path}.service_id", "service_id is required"))
        elif service_id in service_ids:
            issues.append(_issue(f"{path}.service_id", f"duplicate service_id: {service_id}"))
        elif not service_id.startswith("service:"):
            issues.append(_issue(f"{path}.service_id", "service_id must start with service:"))
        if service_id:
            service_ids.add(service_id)

        extraction_status = _required_text(record.get("extraction_status"))
        if extraction_status not in {"ready", "conflicted", "incomplete"}:
            issues.append(_issue(f"{path}.extraction_status", "unsupported extraction_status"))

        _validate_required_text(record, "display_name", path, issues)
        aliases = _string_list(record.get("aliases"))
        if not aliases:
            issues.append(_issue(f"{path}.aliases", "aliases is required"))
        _validate_required_text(record, "category", path, issues)
        _validate_required_text(record, "campus_scope", path, issues)
        if not _string_list(record.get("audience")):
            issues.append(_issue(f"{path}.audience", "audience is required"))
        _validate_rfc3339_field(record, "effective_from", f"{path}.effective_from", issues)
        _validate_rfc3339_field(record, "effective_until", f"{path}.effective_until", issues)
        _validate_effective_window_fields(record, path, issues)

        source_refs = _string_list(record.get("source_refs"))
        if not source_refs:
            issues.append(_issue(f"{path}.source_refs", "source_refs is required"))

        guide_sections = _list_of_dicts(record.get("guide_sections"))
        if extraction_status == "ready" and not guide_sections:
            issues.append(_issue(f"{path}.guide_sections", "guide_sections is required"))
        for section_index, section in enumerate(guide_sections):
            section_path = f"{path}.guide_sections[{section_index}]"
            _validate_required_text(section, "section_id", section_path, issues)
            if _required_text(section.get("section_type")) not in {
                "overview",
                "procedure",
                "required_materials",
                "entry",
                "office_hours",
                "contact",
                "eligibility",
            }:
                issues.append(_issue(f"{section_path}.section_type", "unsupported section_type"))
            _validate_required_text(section, "title", section_path, issues)
            _validate_required_text(section, "content", section_path, issues)
            if not _string_list(section.get("source_refs")):
                issues.append(_issue(f"{section_path}.source_refs", "source_refs is required"))

        _validate_source_linked_rows(
            record,
            field_name="materials",
            path=path,
            issues=issues,
        )
        _validate_entry_refs(record, path, issues)
        _validate_source_linked_rows(
            record,
            field_name="office_hours",
            path=path,
            issues=issues,
        )
        _validate_source_linked_rows(
            record,
            field_name="contact_refs",
            path=path,
            issues=issues,
        )

    return ServiceGuideProjectionValidationReport(
        schema_version=SERVICE_GUIDE_VALIDATION_REPORT_SCHEMA_VERSION,
        valid=not issues,
        issues=issues,
        counts={
            "service_guide_records": len(records),
            "conflict_records": len(conflicts),
            "manual_review_sources": len(manual_review_sources),
        },
    )


def _validate_source_linked_rows(
    record: dict[str, Any],
    *,
    field_name: str,
    path: str,
    issues: list[dict[str, Any]],
) -> None:
    for index, row in enumerate(_list_of_dicts(record.get(field_name))):
        if not _string_list(row.get("source_refs")):
            issues.append(
                _issue(f"{path}.{field_name}[{index}].source_refs", "source_refs is required")
            )


def _validate_entry_refs(record: dict[str, Any], path: str, issues: list[dict[str, Any]]) -> None:
    for index, entry in enumerate(_list_of_dicts(record.get("entry_refs"))):
        entry_path = f"{path}.entry_refs[{index}]"
        if not _string_list(entry.get("source_refs")):
            issues.append(_issue(f"{entry_path}.source_refs", "source_refs is required"))
        entry_type = _required_text(entry.get("entry_type"))
        if entry_type == "online_url":
            url = _required_text(entry.get("url"))
            if url is None or not url.startswith(("http://", "https://")):
                issues.append(_issue(f"{entry_path}.url", "online_url entry requires http(s) url"))


def _validate_required_text(
    row: dict[str, Any],
    field: str,
    path: str,
    issues: list[dict[str, Any]],
) -> None:
    if _required_text(row.get(field)) is None:
        issues.append(_issue(f"{path}.{field}", f"{field} is required"))


def _validate_rfc3339_field(
    row: dict[str, Any],
    field: str,
    path: str,
    issues: list[dict[str, Any]],
) -> None:
    value = _required_text(row.get(field))
    if value is None:
        issues.append(_issue(path, f"{field} is required"))
        return
    try:
        _parse_rfc3339(value, field)
    except ValueError as exc:
        issues.append(_issue(path, str(exc)))


def _validate_effective_window_fields(
    row: dict[str, Any],
    path: str,
    issues: list[dict[str, Any]],
) -> None:
    effective_from = _required_text(row.get("effective_from"))
    effective_until = _required_text(row.get("effective_until"))
    if effective_from is None or effective_until is None:
        return
    try:
        _validate_effective_window(effective_from, effective_until, path)
    except ValueError as exc:
        issues.append(_issue(f"{path}.effective_until", str(exc)))


def _validate_effective_window(effective_from: str, effective_until: str, path: str) -> None:
    if _parse_rfc3339(effective_until, "effective_until") <= _parse_rfc3339(
        effective_from,
        "effective_from",
    ):
        raise ValueError(f"{path} effective_until must be after effective_from")


def _parse_rfc3339(value: str, field_name: str) -> datetime:
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError as exc:
        raise ValueError(f"{field_name} must be RFC3339 datetime") from exc
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=UTC)
    return parsed


def _required_text(value: object) -> str | None:
    if not isinstance(value, str):
        return None
    normalized = value.strip()
    return normalized or None


def _string_list(value: object) -> list[str]:
    if not isinstance(value, list):
        return []
    items: list[str] = []
    for item in value:
        text = _required_text(item)
        if text is not None:
            items.append(text)
    return items


def _list_of_dicts(value: object) -> list[dict[str, Any]]:
    if not isinstance(value, list):
        return []
    return [dict(item) for item in value if isinstance(item, dict)]


def _issue(path: str, message: str) -> dict[str, str]:
    return {"path": path, "message": message}


__all__ = ["validate_service_guide_projection_bundle"]
