from __future__ import annotations

import re
from typing import Any

from campus_ingestion_core import service_guide_projection_support as _support

_list_of_dicts = _support.list_of_dicts
_optional_positive_int = _support.optional_positive_int
_positive_int = _support.positive_int
_require_mapping = _support.require_mapping
_required_text = _support.required_text
_string_list = _support.string_list

_PUNCTUATION_RE = re.compile(r"[\s:：,，。；;（）()《》<>]+")


def _coerce_curated_service_guide_records(
    *,
    document_data: dict[str, Any],
    effective_from: str,
    effective_until: str,
    require_handbook_pages: bool = True,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    payload = _require_mapping(document_data, "document_data")
    extraction_status = _required_text(payload.get("extractionStatus")) or ""
    if extraction_status not in {"ready", "needs_review"}:
        raise ValueError("curated service guide extractionStatus must be ready or needs_review")
    title = _required_text(payload.get("title"))
    if title is None:
        raise ValueError("curated service guide title is required")
    if require_handbook_pages:
        page_start = _positive_int(payload.get("sourcePageStart"), "sourcePageStart")
        page_end = _positive_int(payload.get("sourcePageEnd"), "sourcePageEnd")
    else:
        page_start = _optional_positive_int(payload.get("sourcePageStart"))
        page_end = _optional_positive_int(payload.get("sourcePageEnd"))
    global_manual_review_required = bool(payload.get("manualReviewRequired")) or (
        extraction_status == "needs_review"
    )
    records: list[dict[str, Any]] = []
    manual_review_sources: list[dict[str, Any]] = []
    for service in _list_of_dicts(payload.get("services")):
        service_id = _required_text(service.get("serviceId"))
        display_name = _required_text(service.get("displayName"))
        if service_id is None or display_name is None:
            continue
        service_source_refs = _curated_source_refs(
            service.get("sourceRefs"),
            page_start=page_start,
            page_end=page_end,
        )
        aliases = _curated_aliases(
            display_name=display_name,
            aliases=service.get("aliases"),
        )
        notes = _string_list(service.get("manualReviewNotes"))
        service_status = _required_text(service.get("extractionStatus")) or (
            "needs_manual_review" if global_manual_review_required else "ready"
        )
        if service_status == "needs_review":
            service_status = "needs_manual_review"
        if global_manual_review_required and service_status == "ready":
            service_status = "needs_manual_review"
        record = {
            "service_id": service_id,
            "display_name": display_name,
            "aliases": aliases,
            "category": _required_text(service.get("category"))
            or _infer_category(f"{title}\n{display_name}"),
            "campus_scope": _required_text(service.get("campusScope")) or "all",
            "audience": _string_list(service.get("audience")) or ["unknown"],
            "effective_from": effective_from,
            "effective_until": effective_until,
            "source_refs": service_source_refs,
            "guide_sections": _curated_guide_sections(
                service.get("guideSections"),
                service_id=service_id,
                default_source_refs=service_source_refs,
            ),
            "materials": _curated_materials(
                service.get("materials"),
                service_id=service_id,
                default_source_refs=service_source_refs,
            ),
            "entry_refs": _curated_entry_refs(
                service.get("entryRefs"),
                service_id=service_id,
                default_source_refs=service_source_refs,
            ),
            "office_hours": _curated_office_hours(
                service.get("officeHours"),
                service_id=service_id,
                default_source_refs=service_source_refs,
            ),
            "contact_refs": _curated_contact_refs(
                service.get("contactRefs"),
                service_id=service_id,
                default_source_refs=service_source_refs,
            ),
            "eligibility_notes": _string_list(service.get("eligibilityNotes")),
            "extraction_status": service_status,
        }
        records.append(record)
        if notes or service_status != "ready":
            manual_review_sources.append(
                {
                    "service_id": service_id,
                    "source_ref": service_source_refs[0],
                    "reason": "curated_service_guide_manual_review_required",
                    "notes": notes or [f"service extraction status is {service_status}"],
                }
            )
    if not records:
        raise ValueError("curated service guide documentData.services has no usable services")
    return records, manual_review_sources


def _curated_aliases(*, display_name: str, aliases: object) -> list[str]:
    resolved: list[str] = []
    _append_alias(resolved, display_name)
    for alias in _string_list(aliases):
        _append_alias(resolved, alias)
    return resolved


def _curated_source_refs(
    value: object,
    *,
    page_start: int | None,
    page_end: int | None,
) -> list[str]:
    refs = _string_list(value)
    if refs:
        return refs
    if page_start is None or page_end is None:
        raise ValueError(
            "curated service guide sourceRefs is required when handbook pages are absent"
        )
    return [_handbook_page_source_ref(page_start=page_start, page_end=page_end, page=page_start)]


def _curated_guide_sections(
    value: object,
    *,
    service_id: str,
    default_source_refs: list[str],
) -> list[dict[str, Any]]:
    sections: list[dict[str, Any]] = []
    for index, section in enumerate(_list_of_dicts(value), start=1):
        section_type = _required_text(section.get("sectionType"))
        title = _required_text(section.get("title"))
        content = _required_text(section.get("content"))
        if section_type is None or title is None or content is None:
            continue
        sections.append(
            {
                "section_id": _required_text(section.get("sectionId"))
                or f"{service_id}:section:{section_type}:{index}",
                "section_type": section_type,
                "title": title,
                "content": content,
                "order": _optional_positive_int(section.get("order")) or index,
                "source_refs": _string_list(section.get("sourceRefs")) or default_source_refs,
            }
        )
    return sections


def _curated_materials(
    value: object,
    *,
    service_id: str,
    default_source_refs: list[str],
) -> list[dict[str, Any]]:
    materials: list[dict[str, Any]] = []
    for index, material in enumerate(_list_of_dicts(value), start=1):
        name = _required_text(material.get("name"))
        if name is None:
            continue
        materials.append(
            {
                "material_id": _required_text(material.get("materialId"))
                or f"{service_id}:material:{index}",
                "name": name,
                "required": bool(material.get("required")),
                "note": _required_text(material.get("note")) or "",
                "source_refs": _string_list(material.get("sourceRefs")) or default_source_refs,
            }
        )
    return materials


def _curated_entry_refs(
    value: object,
    *,
    service_id: str,
    default_source_refs: list[str],
) -> list[dict[str, Any]]:
    entries: list[dict[str, Any]] = []
    for index, entry in enumerate(_list_of_dicts(value), start=1):
        label = _required_text(entry.get("label"))
        entry_type = _required_text(entry.get("entryType"))
        if label is None or entry_type is None:
            continue
        entries.append(
            {
                "entry_id": _required_text(entry.get("entryId")) or f"{service_id}:entry:{index}",
                "label": label,
                "entry_type": entry_type,
                "url": _required_text(entry.get("url")) or "",
                "location_ref": _required_text(entry.get("locationRef")) or "",
                "source_refs": _string_list(entry.get("sourceRefs")) or default_source_refs,
            }
        )
    return entries


def _curated_office_hours(
    value: object,
    *,
    service_id: str,
    default_source_refs: list[str],
) -> list[dict[str, Any]]:
    hours_rows: list[dict[str, Any]] = []
    for index, hours in enumerate(_list_of_dicts(value), start=1):
        label = _required_text(hours.get("label"))
        if label is None:
            continue
        hours_rows.append(
            {
                "hours_id": _required_text(hours.get("hoursId")) or f"{service_id}:hours:{index}",
                "label": label,
                "day_pattern": _required_text(hours.get("dayPattern")) or "",
                "time_range": _required_text(hours.get("timeRange")) or "",
                "effective_note": _required_text(hours.get("effectiveNote")) or "",
                "source_refs": _string_list(hours.get("sourceRefs")) or default_source_refs,
            }
        )
    return hours_rows


def _curated_contact_refs(
    value: object,
    *,
    service_id: str,
    default_source_refs: list[str],
) -> list[dict[str, Any]]:
    contacts: list[dict[str, Any]] = []
    for index, contact in enumerate(_list_of_dicts(value), start=1):
        label = _required_text(contact.get("label"))
        if label is None:
            continue
        contacts.append(
            {
                "contact_id": _required_text(contact.get("contactId"))
                or f"{service_id}:contact:{index}",
                "label": label,
                "department": _required_text(contact.get("department")) or "",
                "phone": _required_text(contact.get("phone")) or "",
                "email": _required_text(contact.get("email")) or "",
                "location_ref": _required_text(contact.get("locationRef")) or "",
                "source_refs": _string_list(contact.get("sourceRefs")) or default_source_refs,
            }
        )
    return contacts


def _handbook_page_source_ref(*, page_start: int, page_end: int, page: int) -> str:
    return f"handbook:student_rules:pages:{page_start}-{page_end}#page={page}"


def _append_alias(aliases: list[str], value: str | None) -> None:
    normalized = _normalize_alias(value)
    if normalized and normalized not in aliases:
        aliases.append(normalized)


def _normalize_alias(value: str | None) -> str:
    normalized = str(value or "").strip()
    return _PUNCTUATION_RE.sub("", normalized)


def _infer_category(value: str) -> str:
    if any(keyword in value for keyword in ("学生公寓", "公寓", "宿舍", "住宿", "退宿")):
        return "student_housing"
    return "campus_service"


__all__ = ["_coerce_curated_service_guide_records"]
