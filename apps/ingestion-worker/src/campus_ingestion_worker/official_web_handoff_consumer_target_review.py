from __future__ import annotations

from campus_ingestion_worker.official_web_handoff_consumer_io import (
    coerce_non_negative_int,
    normalize_string_list,
    optional_text,
    require_object_list,
    require_text,
)
from campus_ingestion_worker.official_web_handoff_consumer_selected_write import (
    _has_blocking_field_status,
)


def _target_inventory_entries(
    target_inventory_manifest: dict[str, object] | None,
) -> list[dict[str, object]]:
    if target_inventory_manifest is None:
        return []
    if target_inventory_manifest.get("schema_version") != "official_web_target_inventory.v1":
        return []
    return require_object_list(target_inventory_manifest.get("entries"), "entries")


def _candidate_source_refs(candidate: dict[str, object]) -> list[dict[str, object]]:
    refs = _candidate_explicit_source_refs(candidate)
    if not refs:
        refs = [
            {
                "source_channel": "official_web",
                "raw_asset_id": require_text(candidate.get("raw_asset_id"), "raw_asset_id"),
                "raw_version_id": require_text(candidate.get("raw_version_id"), "raw_version_id"),
                "normalized_canonical_url": require_text(
                    candidate.get("normalized_canonical_url"),
                    "normalized_canonical_url",
                ),
            }
        ]
    typed_candidate = candidate.get("typed_candidate")
    if isinstance(typed_candidate, dict):
        for url in normalize_string_list(
            typed_candidate.get("supporting_source_urls")
            or typed_candidate.get("supportingSourceUrls")
        ):
            if not any(ref["normalized_canonical_url"] == url for ref in refs):
                refs.append(
                    {
                        "source_channel": "official_web",
                        "raw_asset_id": "",
                        "raw_version_id": "",
                        "normalized_canonical_url": url,
                    }
                )
    return refs


def _candidate_explicit_source_refs(candidate: dict[str, object]) -> list[dict[str, object]]:
    raw_refs = candidate.get("source_refs") or candidate.get("sourceRefs")
    if not isinstance(raw_refs, list):
        return []
    refs: list[dict[str, object]] = []
    seen: set[str] = set()
    for raw_ref in raw_refs:
        if not isinstance(raw_ref, dict):
            continue
        normalized_url = optional_text(
            raw_ref.get("normalized_canonical_url") or raw_ref.get("normalizedCanonicalUrl")
        )
        if normalized_url is None or normalized_url in seen:
            continue
        seen.add(normalized_url)
        refs.append(
            {
                "source_channel": optional_text(
                    raw_ref.get("source_channel") or raw_ref.get("sourceChannel")
                )
                or "official_web",
                "raw_asset_id": optional_text(
                    raw_ref.get("raw_asset_id") or raw_ref.get("rawAssetId")
                )
                or "",
                "raw_version_id": optional_text(
                    raw_ref.get("raw_version_id") or raw_ref.get("rawVersionId")
                )
                or "",
                "normalized_canonical_url": normalized_url,
            }
        )
    return refs


def _target_inventory_entry_for_candidate(
    *,
    candidate: dict[str, object],
    target_inventory_entries: list[dict[str, object]],
) -> dict[str, object] | None:
    target_id = optional_text(candidate.get("target_id"))
    normalized_canonical_url = optional_text(candidate.get("normalized_canonical_url"))
    if target_id is None:
        return None
    for entry in target_inventory_entries:
        if optional_text(entry.get("admission_target_id")) != target_id:
            continue
        source_urls = normalize_string_list(entry.get("source_urls"))
        if source_urls and normalized_canonical_url not in source_urls:
            continue
        return entry
    return None


def _target_inventory_entry_for_document(
    *,
    document: dict[str, object],
    target_inventory_entries: list[dict[str, object]],
) -> dict[str, object] | None:
    target_id = optional_text(document.get("target_id"))
    normalized_canonical_url = optional_text(document.get("normalized_canonical_url"))
    if target_id is None:
        return None
    for entry in target_inventory_entries:
        if optional_text(entry.get("admission_target_id")) != target_id:
            continue
        source_urls = normalize_string_list(entry.get("source_urls"))
        if source_urls and normalized_canonical_url not in source_urls:
            continue
        return entry
    return None


def _target_inventory_required_fields(
    target_inventory_entry: dict[str, object] | None,
) -> list[str]:
    if target_inventory_entry is None:
        return []
    return normalize_string_list(target_inventory_entry.get("required_fields"))


def _target_inventory_optional_fields(
    target_inventory_entry: dict[str, object] | None,
) -> list[str]:
    if target_inventory_entry is None:
        return []
    return normalize_string_list(target_inventory_entry.get("optional_fields"))


def _target_inventory_required_evidence(
    target_inventory_entry: dict[str, object] | None,
) -> list[str]:
    if target_inventory_entry is None:
        return []
    return normalize_string_list(target_inventory_entry.get("required_evidence"))


def _target_inventory_optional_evidence(
    target_inventory_entry: dict[str, object] | None,
) -> list[str]:
    if target_inventory_entry is None:
        return []
    return normalize_string_list(target_inventory_entry.get("optional_evidence"))


def _target_inventory_review_fields(
    *,
    required_fields: list[str],
    required_evidence: list[str],
) -> list[str]:
    fields: list[str] = []
    for field_name in [*required_fields, *required_evidence]:
        if field_name not in fields:
            fields.append(field_name)
    return fields


def _unique_strings(values: list[str]) -> list[str]:
    result: list[str] = []
    for value in values:
        if value not in result:
            result.append(value)
    return result


_FIELD_ALIASES: dict[str, tuple[str, ...]] = {
    "academic_year_label": ("academic_year_label",),
    "calendar_arrangement": ("calendar_arrangement",),
    "class_day_pattern": ("class_day_pattern",),
    "authoritative_source_url": ("source_url",),
    "date_range": ("date_range",),
    "email": ("emails", "contacts.emails"),
    "holiday_name": ("holiday_name",),
    "location": ("locations", "contacts.locations"),
    "normalized_content_summary": ("normalized_content_summary", "summary"),
    "office_hours": ("office_hours", "contacts.office_hours"),
    "organization_name": ("organization_name", "display_name", "source_title"),
    "phone": ("phones", "contacts.phones"),
    "process_steps": ("process_steps",),
    "reference_title": ("reference_title", "source_title"),
    "release_scope": ("release_scope",),
    "required_materials": ("required_materials", "materials"),
    "responsible_office": ("responsible_office",),
    "service_entry": ("entry_points",),
    "service_material": ("required_materials", "materials"),
    "service_name": ("service_name",),
    "service_process": ("process_steps",),
    "source_url": ("source_url",),
    "term_label": ("term_label",),
    "week_index": ("week_index",),
}


def _field_status_for_required_fields(
    *,
    candidate: dict[str, object],
    optional_fields: list[str],
    required_fields: list[str],
    typed_candidate: dict[object, object],
) -> dict[str, str]:
    optional_field_set = set(optional_fields)
    return {
        field_name: _normalize_optional_field_status(
            field_name=field_name,
            optional_field_set=optional_field_set,
            status=_field_status_for_required_field(
                candidate=candidate,
                field_name=field_name,
                typed_candidate=typed_candidate,
            ),
        )
        for field_name in required_fields
    }


def _normalize_optional_field_status(
    *,
    field_name: str,
    optional_field_set: set[str],
    status: str,
) -> str:
    if field_name in optional_field_set and status == "missing":
        return "source_not_provided"
    return status


def _field_status_for_required_field(
    *,
    candidate: dict[str, object],
    field_name: str,
    typed_candidate: dict[object, object],
) -> str:
    if field_name == "source_version_evidence":
        return (
            "present"
            if optional_text(candidate.get("raw_asset_id"))
            and optional_text(candidate.get("raw_version_id"))
            else "missing"
        )
    if field_name == "source_url":
        return "present" if optional_text(candidate.get("normalized_canonical_url")) else "missing"
    for field_path in _FIELD_ALIASES.get(field_name, (field_name,)):
        if _is_present_value(_lookup_field_path(typed_candidate, field_path)):
            return "present"
    return "missing"


def _lookup_field_path(value: dict[object, object], field_path: str) -> object:
    current: object = value
    for part in field_path.split("."):
        if not isinstance(current, dict):
            return None
        current = current.get(part)
    return current


def _is_present_value(value: object) -> bool:
    if isinstance(value, str):
        return bool(value.strip())
    if isinstance(value, list):
        return any(_is_present_value(item) for item in value)
    if isinstance(value, dict):
        return any(_is_present_value(item) for item in value.values())
    return value is not None


def _evidence_span_present(*, candidate: dict[str, object], evidence_type: str) -> bool:
    if not isinstance(candidate.get("evidence_spans"), list):
        return False
    for span in require_object_list(candidate.get("evidence_spans"), "evidence_spans"):
        if optional_text(span.get("evidence_type")) == evidence_type and optional_text(
            span.get("text")
        ):
            return True
    return False


def _target_field_review_record(
    *,
    candidate: dict[str, object],
    run_id: str,
) -> dict[str, object] | None:
    job_id = optional_text(candidate.get("target_job_id"))
    field_status = candidate.get("field_status")
    if job_id is None or not isinstance(field_status, dict) or not field_status:
        return None
    status = (
        "ready_for_selected_write"
        if bool(candidate.get("ready_for_selected_write"))
        else "blocked_fields"
        if _has_blocking_field_status(
            field_status=field_status,
            required_fields=normalize_string_list(candidate.get("required_fields")),
        )
        else "pending_review"
    )
    return {
        "canonicalVerification": False,
        "jobId": job_id,
        "runId": run_id,
        "sourceHandoffId": None,
        "status": status,
        "summary": {
            "schemaVersion": "official_web_target_field_review.v1",
            "candidateKey": require_text(candidate.get("candidate_key"), "candidate_key"),
            "consumerFamily": require_text(candidate.get("consumer_family"), "consumer_family"),
            "fieldStatus": field_status,
            "inventoryId": candidate.get("inventory_id"),
            "normalizedCanonicalUrl": require_text(
                candidate.get("normalized_canonical_url"),
                "normalized_canonical_url",
            ),
            "readyForSelectedWrite": bool(candidate.get("ready_for_selected_write")),
            "optionalEvidence": normalize_string_list(candidate.get("optional_evidence")),
            "optionalFields": normalize_string_list(candidate.get("optional_fields")),
            "requiredEvidence": normalize_string_list(candidate.get("required_evidence")),
            "requiredFields": normalize_string_list(candidate.get("required_fields")),
            "reviewVerdict": require_text(candidate.get("review_verdict"), "review_verdict"),
            "selectedWriteTarget": candidate.get("selected_write_target"),
            "sourceRef": candidate.get("source_ref"),
            "targetId": candidate.get("target_id"),
        },
    }


def _stable_reference_target_field_review_record(
    *,
    document: dict[str, object],
    run_id: str,
    target_inventory_entry: dict[str, object] | None,
) -> dict[str, object] | None:
    job_id = optional_text(document.get("target_job_id"))
    required_fields = _target_inventory_required_fields(target_inventory_entry)
    if job_id is None or not required_fields:
        return None
    field_status = _stable_reference_field_status_for_required_fields(
        document=document,
        required_fields=required_fields,
    )
    status = (
        "blocked_fields"
        if any(value in {"missing", "ambiguous"} for value in field_status.values())
        else "release_gate_required"
    )
    normalized_canonical_url = require_text(
        document.get("normalized_canonical_url"),
        "normalized_canonical_url",
    )
    return {
        "canonicalVerification": False,
        "jobId": job_id,
        "runId": run_id,
        "sourceHandoffId": None,
        "status": status,
        "summary": {
            "schemaVersion": "official_web_target_field_review.v1",
            "candidateKey": (
                f"owdoc:{require_text(document.get('document_id'), 'document_id')}:"
                f"{require_text(document.get('version_id'), 'version_id')}"
            ),
            "consumerFamily": "stable_reference_candidate",
            "fieldStatus": field_status,
            "inventoryId": optional_text(target_inventory_entry.get("inventory_id"))
            if target_inventory_entry is not None
            else None,
            "normalizedCanonicalUrl": normalized_canonical_url,
            "readyForSelectedWrite": False,
            "requiredFields": required_fields,
            "reviewVerdict": "pending_review",
            "selectedWriteTarget": document.get("selected_write_target"),
            "sourceRef": {
                "source_channel": "official_web",
                "raw_asset_id": require_text(document.get("raw_asset_id"), "raw_asset_id"),
                "raw_version_id": require_text(document.get("raw_version_id"), "raw_version_id"),
                "normalized_canonical_url": normalized_canonical_url,
            },
            "targetId": document.get("target_id"),
        },
    }


def _stable_reference_field_status_for_required_fields(
    *,
    document: dict[str, object],
    required_fields: list[str],
) -> dict[str, str]:
    return {
        field_name: _stable_reference_field_status_for_required_field(
            document=document,
            field_name=field_name,
        )
        for field_name in required_fields
    }


def _stable_reference_field_status_for_required_field(
    *,
    document: dict[str, object],
    field_name: str,
) -> str:
    if field_name == "reference_title":
        return "present" if optional_text(document.get("title")) else "missing"
    if field_name == "normalized_content_summary":
        return (
            "present"
            if coerce_non_negative_int(document.get("unit_count")) > 0
            or optional_text(document.get("canonical_markdown_path"))
            else "missing"
        )
    if field_name in {"authoritative_source_url", "source_url"}:
        return "present" if optional_text(document.get("normalized_canonical_url")) else "missing"
    if field_name == "release_scope":
        return (
            "present"
            if optional_text(document.get("target_corpus")) == "official_web"
            and optional_text(document.get("target_collection")) == "stable_reference"
            else "missing"
        )
    if field_name == "source_version_evidence":
        return (
            "present"
            if optional_text(document.get("raw_asset_id"))
            and optional_text(document.get("raw_version_id"))
            else "missing"
        )
    return "not_applicable"
