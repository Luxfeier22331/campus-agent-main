from __future__ import annotations

import hashlib
import json
import re
from dataclasses import asdict, dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Protocol

from campus_ingestion_core.object_store import build_index_release_artifact_key

CONTACT_DIRECTORY_PROJECTION_SCHEMA_VERSION = "campus_services_contact_directory_projection.v1"
CONTACT_DIRECTORY_VALIDATION_REPORT_SCHEMA_VERSION = (
    "contact_directory_projection_validation_report.v1"
)
CONTACT_DIRECTORY_RELEASE_MANIFEST_SCHEMA_VERSION = (
    "contact_directory_projection_release_manifest.v1"
)
CONTACT_DIRECTORY_CORPUS = "campus_services"
CONTACT_DIRECTORY_COLLECTION = "contact_directory"
CONTACT_DIRECTORY_PROJECTION_FILENAME = "contact-directory-projection.json"
CONTACT_DIRECTORY_VALIDATION_FILENAME = "validation-summary.json"
CONTACT_DIRECTORY_RELEASE_MANIFEST_FILENAME = "release-manifest.json"
CONTACT_DIRECTORY_MANUAL_REVIEW_FILENAME = "manual-review-report.json"
HANDBOOK_PHONE_DIRECTORY_SOURCE_FAMILY = "handbook_phone_directory_projection_v1"
HANDBOOK_PHONE_DIRECTORY_PROJECTION_NAME = "handbook_phone_directory"
HANDBOOK_PHONE_DIRECTORY_ATTACHMENT_ROLE = "service_contact_directory"

_PHONE_LINE_RE = re.compile(r"^(?P<name>.+?)[\s:：]+(?P<number>\d[\d\- ]{4,}\d)$")


class ContactDirectoryProjectionObjectStore(Protocol):
    def put_bytes(
        self,
        *,
        bucket: str,
        key: str,
        data: bytes,
        content_type: str,
    ) -> None: ...


@dataclass(frozen=True, slots=True)
class ContactDirectoryProjectionBuildResult:
    bundle: dict[str, Any]
    validation_report: ContactDirectoryProjectionValidationReport
    manual_review_sources: list[dict[str, Any]]


@dataclass(frozen=True, slots=True)
class ContactDirectoryProjectionValidationReport:
    schema_version: str
    valid: bool
    issues: list[dict[str, Any]]
    counts: dict[str, int]


@dataclass(frozen=True, slots=True)
class ContactDirectoryProjectionReleaseReport:
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


def build_contact_directory_projection_bundle_from_handbook_document_units(
    *,
    document_units: list[dict[str, Any]] | tuple[dict[str, Any], ...],
    generated_at: str,
    source_title: str,
    source_page_start: int,
    source_page_end: int,
) -> ContactDirectoryProjectionBuildResult:
    _parse_rfc3339(generated_at, "generated_at")
    if not source_title.strip():
        raise ValueError("source_title is required")
    if source_page_start <= 0 or source_page_end < source_page_start:
        raise ValueError("source page range is invalid")

    records: list[dict[str, Any]] = []
    manual_review_sources: list[dict[str, Any]] = []
    seen_contacts: set[tuple[str, str]] = set()
    for unit in _list_of_dicts(document_units):
        if str(unit.get("unit_type") or "").strip() != "policy_page":
            continue
        anchor = _mapping_or_empty(unit.get("anchor"))
        source_ref = _source_ref_from_anchor(
            anchor=anchor,
            default_page_start=source_page_start,
            default_page_end=source_page_end,
        )
        contact_group = _contact_group_from_anchor(anchor)
        for line in _contact_lines(unit.get("clean_text")):
            parsed_entries = _parse_phone_entries(line)
            if not parsed_entries:
                if _contains_phoneish_number(line):
                    manual_review_sources.append(
                        {
                            "source_ref": source_ref,
                            "reason": "unparsed_handbook_phone_line",
                            "line": line,
                        }
                    )
                continue
            for display_name, phone_number in parsed_entries:
                dedupe_key = (_normalize_search_text(display_name), phone_number)
                if dedupe_key in seen_contacts:
                    continue
                seen_contacts.add(dedupe_key)
                records.append(
                    _contact_record(
                        display_name=display_name,
                        phone_number=phone_number,
                        contact_group=contact_group,
                        source_title=source_title,
                        source_ref=source_ref,
                    )
                )

    records.sort(key=lambda item: (item["contact_group"], item["display_name"]))
    bundle = {
        "schema_version": CONTACT_DIRECTORY_PROJECTION_SCHEMA_VERSION,
        "generated_at": generated_at,
        "source_families": [HANDBOOK_PHONE_DIRECTORY_SOURCE_FAMILY],
        "source_documents": [
            {
                "title": source_title,
                "source_refs": [
                    _handbook_page_source_ref(
                        page_start=source_page_start,
                        page_end=source_page_end,
                        page=source_page_start,
                    )
                ],
            }
        ],
        "contact_records": records,
        "conflict_records": [],
        "manual_review_sources": manual_review_sources,
    }
    validation_report = validate_contact_directory_projection_bundle(bundle)
    return ContactDirectoryProjectionBuildResult(
        bundle=bundle,
        validation_report=validation_report,
        manual_review_sources=manual_review_sources,
    )


def validate_contact_directory_projection_bundle(
    bundle: dict[str, Any],
) -> ContactDirectoryProjectionValidationReport:
    issues: list[dict[str, Any]] = []
    if bundle.get("schema_version") != CONTACT_DIRECTORY_PROJECTION_SCHEMA_VERSION:
        issues.append(_issue("schema_version", "unsupported contact directory projection schema"))
    _validate_rfc3339_field(bundle, "generated_at", "generated_at", issues)
    if not _string_list(bundle.get("source_families")):
        issues.append(_issue("source_families", "source_families is required"))

    records = _list_of_dicts(bundle.get("contact_records"))
    conflicts = _list_of_dicts(bundle.get("conflict_records"))
    manual_review_sources = _list_of_dicts(bundle.get("manual_review_sources"))

    contact_ids: set[str] = set()
    for record_index, record in enumerate(records):
        path = f"contact_records[{record_index}]"
        contact_id = _required_text(record.get("contact_id"))
        if contact_id is None:
            issues.append(_issue(f"{path}.contact_id", "contact_id is required"))
        elif contact_id in contact_ids:
            issues.append(_issue(f"{path}.contact_id", f"duplicate contact_id: {contact_id}"))
        elif not contact_id.startswith("contact:"):
            issues.append(_issue(f"{path}.contact_id", "contact_id must start with contact:"))
        if contact_id:
            contact_ids.add(contact_id)

        extraction_status = _required_text(record.get("extraction_status"))
        if extraction_status not in {"ready", "needs_manual_review", "conflicted", "incomplete"}:
            issues.append(_issue(f"{path}.extraction_status", "unsupported extraction_status"))
        _validate_required_text(record, "display_name", path, issues)
        if not _string_list(record.get("aliases")):
            issues.append(_issue(f"{path}.aliases", "aliases is required"))
        _validate_required_text(record, "contact_group", path, issues)
        _validate_required_text(record, "department", path, issues)
        if not _string_list(record.get("source_refs")):
            issues.append(_issue(f"{path}.source_refs", "source_refs is required"))

        phones = _list_of_dicts(record.get("phones"))
        emails = _list_of_dicts(record.get("emails"))
        if extraction_status == "ready" and not phones and not emails:
            issues.append(_issue(f"{path}.phones", "phones or emails is required"))
        for phone_index, phone in enumerate(phones):
            phone_path = f"{path}.phones[{phone_index}]"
            _validate_required_text(phone, "phone_id", phone_path, issues)
            _validate_required_text(phone, "number", phone_path, issues)
            if not _string_list(phone.get("source_refs")):
                issues.append(_issue(f"{phone_path}.source_refs", "source_refs is required"))
        for email_index, email in enumerate(emails):
            email_path = f"{path}.emails[{email_index}]"
            _validate_required_text(email, "email_id", email_path, issues)
            _validate_required_text(email, "address", email_path, issues)
            if not _string_list(email.get("source_refs")):
                issues.append(_issue(f"{email_path}.source_refs", "source_refs is required"))

    return ContactDirectoryProjectionValidationReport(
        schema_version=CONTACT_DIRECTORY_VALIDATION_REPORT_SCHEMA_VERSION,
        valid=not issues,
        issues=issues,
        counts={
            "contact_records": len(records),
            "conflict_records": len(conflicts),
            "manual_review_sources": len(manual_review_sources),
        },
    )


def assert_contact_directory_projection_release_ready(
    bundle: dict[str, Any],
    *,
    expected_ready_records: int | None = None,
) -> None:
    validation_report = validate_contact_directory_projection_bundle(bundle)
    if not validation_report.valid:
        messages = ", ".join(
            str(issue.get("message") or issue) for issue in validation_report.issues
        )
        raise ValueError(f"contact directory projection validation failed: {messages}")
    records = _list_of_dicts(bundle.get("contact_records"))
    if not records:
        raise ValueError("contact directory projection produced no ready records")
    conflicts = _list_of_dicts(bundle.get("conflict_records"))
    if conflicts:
        raise ValueError("contact directory projection release blocked by unresolved conflicts")
    non_ready_records = [
        record for record in records if _required_text(record.get("extraction_status")) != "ready"
    ]
    if non_ready_records:
        raise ValueError("contact directory projection release blocked by manual review records")
    manual_review_sources = _list_of_dicts(bundle.get("manual_review_sources"))
    if manual_review_sources:
        raise ValueError("contact directory projection release blocked by manual review sources")
    if expected_ready_records is not None and len(records) != expected_ready_records:
        raise ValueError(
            "contact directory projection ready record count mismatch: "
            f"expected {expected_ready_records}, got {len(records)}"
        )


def write_contact_directory_projection_release(
    *,
    bundle: dict[str, Any],
    output_dir: Path,
    release_id: str,
    generated_at: str,
    manual_review_sources: list[dict[str, Any]] | None = None,
    object_store: ContactDirectoryProjectionObjectStore | None = None,
    bucket: str | None = None,
) -> ContactDirectoryProjectionReleaseReport:
    normalized_release_id = _path_segment(release_id, "release_id")
    output_root = Path(output_dir)
    release_dir = output_root / normalized_release_id
    current_dir = output_root / "current"
    release_dir.mkdir(parents=True, exist_ok=True)
    current_dir.mkdir(parents=True, exist_ok=True)

    bundle_bytes = _json_bytes(bundle)
    validation_report = validate_contact_directory_projection_bundle(bundle)
    validation_payload = asdict(validation_report)
    manual_review_payload = manual_review_sources
    if manual_review_payload is None:
        manual_review_payload = _list_of_dicts(bundle.get("manual_review_sources"))
    release_object_key = build_index_release_artifact_key(
        corpus=CONTACT_DIRECTORY_CORPUS,
        collection=CONTACT_DIRECTORY_COLLECTION,
        release_id=normalized_release_id,
        filename=CONTACT_DIRECTORY_PROJECTION_FILENAME,
    )
    current_object_key = build_index_release_artifact_key(
        corpus=CONTACT_DIRECTORY_CORPUS,
        collection=CONTACT_DIRECTORY_COLLECTION,
        release_id="current",
        filename=CONTACT_DIRECTORY_PROJECTION_FILENAME,
    )
    release_manifest = {
        "schema_version": CONTACT_DIRECTORY_RELEASE_MANIFEST_SCHEMA_VERSION,
        "release_id": normalized_release_id,
        "generated_at": generated_at,
        "corpus": CONTACT_DIRECTORY_CORPUS,
        "collection": CONTACT_DIRECTORY_COLLECTION,
        "projection_object_key": release_object_key,
        "current_projection_object_key": current_object_key,
        "validation_valid": validation_report.valid,
        "counts": dict(validation_report.counts),
    }

    projection_path = release_dir / CONTACT_DIRECTORY_PROJECTION_FILENAME
    current_projection_path = current_dir / CONTACT_DIRECTORY_PROJECTION_FILENAME
    validation_path = release_dir / CONTACT_DIRECTORY_VALIDATION_FILENAME
    manifest_path = release_dir / CONTACT_DIRECTORY_RELEASE_MANIFEST_FILENAME
    manual_review_path = release_dir / CONTACT_DIRECTORY_MANUAL_REVIEW_FILENAME
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
                    corpus=CONTACT_DIRECTORY_CORPUS,
                    collection=CONTACT_DIRECTORY_COLLECTION,
                    release_id=normalized_release_id,
                    filename=CONTACT_DIRECTORY_VALIDATION_FILENAME,
                ),
                _json_bytes(validation_payload),
            ),
            (
                build_index_release_artifact_key(
                    corpus=CONTACT_DIRECTORY_CORPUS,
                    collection=CONTACT_DIRECTORY_COLLECTION,
                    release_id=normalized_release_id,
                    filename=CONTACT_DIRECTORY_RELEASE_MANIFEST_FILENAME,
                ),
                _json_bytes(release_manifest),
            ),
            (
                build_index_release_artifact_key(
                    corpus=CONTACT_DIRECTORY_CORPUS,
                    collection=CONTACT_DIRECTORY_COLLECTION,
                    release_id=normalized_release_id,
                    filename=CONTACT_DIRECTORY_MANUAL_REVIEW_FILENAME,
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

    return ContactDirectoryProjectionReleaseReport(
        schema_version=CONTACT_DIRECTORY_RELEASE_MANIFEST_SCHEMA_VERSION,
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


def write_contact_directory_projection_release_from_import_documents(
    *,
    documents: list[object] | tuple[object, ...],
    output_dir: Path,
    generated_at: str,
    object_store: ContactDirectoryProjectionObjectStore,
    bucket: str,
) -> tuple[ContactDirectoryProjectionReleaseReport, ...]:
    contact_documents = tuple(_iter_contact_directory_handbook_documents(documents))
    if not contact_documents:
        return ()
    document_units: list[dict[str, Any]] = []
    source_titles: list[str] = []
    for document in contact_documents:
        rows = _read_document_units_from_import_document(document)
        document_units.extend(rows)
        title = _document_title(document)
        if title and title not in source_titles:
            source_titles.append(title)
    page_start, page_end = _source_page_range(document_units)
    source_title = source_titles[0] if source_titles else "中央民族大学校内常用电话"
    build_result = build_contact_directory_projection_bundle_from_handbook_document_units(
        document_units=document_units,
        generated_at=generated_at,
        source_title=source_title,
        source_page_start=page_start,
        source_page_end=page_end,
    )
    assert_contact_directory_projection_release_ready(build_result.bundle)
    report = write_contact_directory_projection_release(
        bundle=build_result.bundle,
        output_dir=output_dir,
        release_id=_contact_directory_release_id(generated_at),
        generated_at=generated_at,
        manual_review_sources=build_result.manual_review_sources,
        object_store=object_store,
        bucket=bucket,
    )
    return (report,)


def _contact_record(
    *,
    display_name: str,
    phone_number: str,
    contact_group: str,
    source_title: str,
    source_ref: str,
) -> dict[str, Any]:
    contact_id = _contact_id(
        display_name=display_name,
        phone_number=phone_number,
        contact_group=contact_group,
        source_title=source_title,
    )
    aliases = _aliases_for_contact(display_name)
    return {
        "contact_id": contact_id,
        "display_name": display_name,
        "aliases": aliases,
        "contact_group": contact_group,
        "department": _department_for_display_name(display_name),
        "phones": [
            {
                "phone_id": f"{contact_id}:phone:1",
                "label": "电话号码",
                "number": phone_number,
                "source_refs": [source_ref],
            }
        ],
        "emails": [],
        "location_refs": [],
        "source_refs": [source_ref],
        "extraction_status": "ready",
    }


def _contact_id(
    *,
    display_name: str,
    phone_number: str,
    contact_group: str,
    source_title: str,
) -> str:
    seed = json.dumps(
        {
            "source_title": source_title,
            "contact_group": contact_group,
            "display_name": display_name,
            "phone_number": phone_number,
        },
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    )
    digest = hashlib.sha1(seed.encode("utf-8")).hexdigest()[:16]
    return f"contact:handbook:{digest}"


def _aliases_for_contact(display_name: str) -> list[str]:
    aliases = [display_name]
    if display_name.endswith("办公室") and len(display_name) > len("办公室"):
        aliases.append(display_name[: -len("办公室")])
    return aliases


def _department_for_display_name(display_name: str) -> str:
    if display_name.endswith("办公室") and len(display_name) > len("办公室"):
        return display_name[: -len("办公室")]
    return display_name


def _source_ref_from_anchor(
    *,
    anchor: dict[str, Any],
    default_page_start: int,
    default_page_end: int,
) -> str:
    page = _optional_positive_int(anchor.get("page_start")) or default_page_start
    page_end = _optional_positive_int(anchor.get("page_end")) or default_page_end
    return _handbook_page_source_ref(page_start=default_page_start, page_end=page_end, page=page)


def _contact_group_from_anchor(anchor: dict[str, Any]) -> str:
    section_path = anchor.get("section_path")
    if isinstance(section_path, list):
        for item in section_path:
            if isinstance(item, str) and item.strip():
                return item.strip()
    return "未分组"


def _contact_lines(value: object) -> list[str]:
    if not isinstance(value, str):
        return []
    return [line.strip() for line in value.splitlines() if line.strip()]


def _parse_phone_line(line: str) -> tuple[str, str] | None:
    parsed = _parse_phone_entries(line)
    return parsed[0] if parsed else None


def _parse_phone_entries(line: str) -> list[tuple[str, str]]:
    normalized = re.sub(r"\s+", " ", line.strip())
    matches = list(re.finditer(r"\d[\d\- ]{4,}\d", normalized))
    if len(matches) > 1:
        entries: list[tuple[str, str]] = []
        for index, match in enumerate(matches):
            name_start = 0 if index == 0 else matches[index - 1].end()
            name = _normalize_contact_name(normalized[name_start : match.start()])
            number = re.sub(r"\s+", "", match.group(0).strip())
            if name and number:
                entries.append((name, number))
        return entries
    match = _PHONE_LINE_RE.match(normalized)
    if match is None:
        return []
    name = _normalize_contact_name(match.group("name"))
    number = re.sub(r"\s+", "", match.group("number").strip())
    if not name or not number:
        return []
    return [(name, number)]


def _normalize_contact_name(value: str) -> str:
    return re.sub(r"[\s:：\-—]+$", "", value.strip()).strip()


def _contains_phoneish_number(value: str) -> bool:
    return bool(re.search(r"\d{5,}", value))


def _handbook_page_source_ref(*, page_start: int, page_end: int, page: int) -> str:
    return f"handbook:student_rules:pages:{page_start}-{page_end}#page={page}"


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


def _parse_rfc3339(value: str, field_name: str) -> datetime:
    normalized = value.replace("Z", "+00:00")
    try:
        parsed = datetime.fromisoformat(normalized)
    except ValueError as exc:
        raise ValueError(f"{field_name} must be RFC3339") from exc
    if parsed.tzinfo is None:
        raise ValueError(f"{field_name} must include timezone")
    return parsed.astimezone(UTC)


def _optional_positive_int(value: object) -> int | None:
    if value is None or value == "":
        return None
    if isinstance(value, bool):
        return None
    try:
        parsed = int(str(value))
    except ValueError:
        return None
    if parsed <= 0:
        return None
    return parsed


def _required_text(value: object) -> str | None:
    if not isinstance(value, str):
        return None
    normalized = value.strip()
    return normalized or None


def _string_list(value: object) -> list[str]:
    if not isinstance(value, list):
        return []
    return [item.strip() for item in value if isinstance(item, str) and item.strip()]


def _list_of_dicts(value: object) -> list[dict[str, Any]]:
    if not isinstance(value, list | tuple):
        return []
    return [dict(item) for item in value if isinstance(item, dict)]


def _iter_contact_directory_handbook_documents(documents: list[object] | tuple[object, ...]):
    for document in documents:
        if getattr(document, "corpus", None) != CONTACT_DIRECTORY_CORPUS:
            continue
        if getattr(document, "collection", None) != CONTACT_DIRECTORY_COLLECTION:
            continue
        rows = _read_document_units_from_import_document(document)
        if not rows:
            continue
        if not _is_handbook_phone_directory_document(rows):
            continue
        yield document


def _read_document_units_from_import_document(document: object) -> list[dict[str, Any]]:
    data = getattr(document, "document_units_bytes", b"")
    if not isinstance(data, bytes):
        return []
    rows: list[dict[str, Any]] = []
    for line in data.decode("utf-8").splitlines():
        if not line.strip():
            continue
        payload = json.loads(line)
        if isinstance(payload, dict):
            rows.append(dict(payload))
    return rows


def _is_handbook_phone_directory_document(rows: list[dict[str, Any]]) -> bool:
    for row in rows:
        metadata = _mapping_or_empty(row.get("metadata"))
        if metadata.get("projection_name") == HANDBOOK_PHONE_DIRECTORY_PROJECTION_NAME:
            return True
        if metadata.get("attachment_role") == HANDBOOK_PHONE_DIRECTORY_ATTACHMENT_ROLE:
            return True
    return False


def _document_title(document: object) -> str:
    title = getattr(document, "title", None)
    if isinstance(title, str) and title.strip():
        return title.strip()
    metadata = getattr(document, "metadata", None)
    if isinstance(metadata, dict):
        metadata_title = metadata.get("title")
        if isinstance(metadata_title, str) and metadata_title.strip():
            return metadata_title.strip()
    return ""


def _source_page_range(document_units: list[dict[str, Any]]) -> tuple[int, int]:
    page_starts: list[int] = []
    page_ends: list[int] = []
    for unit in document_units:
        anchor = _mapping_or_empty(unit.get("anchor"))
        page_start = _optional_positive_int(anchor.get("page_start"))
        page_end = _optional_positive_int(anchor.get("page_end"))
        if page_start is not None:
            page_starts.append(page_start)
        if page_end is not None:
            page_ends.append(page_end)
    if not page_starts:
        return (1, 1)
    page_start = min(page_starts)
    page_end = max(page_ends or page_starts)
    return page_start, max(page_start, page_end)


def _contact_directory_release_id(generated_at: str) -> str:
    parsed = _parse_rfc3339(generated_at, "generated_at")
    return f"contact-directory-handbook-{parsed.strftime('%Y%m%d_%H%M%S')}"


def _mapping_or_empty(value: object) -> dict[str, Any]:
    return dict(value) if isinstance(value, dict) else {}


def _normalize_search_text(value: str) -> str:
    return re.sub(r"\s+", "", value).lower()


def _json_bytes(payload: object) -> bytes:
    return json.dumps(payload, ensure_ascii=False, indent=2).encode("utf-8") + b"\n"


def _issue(path: str, message: str) -> dict[str, str]:
    return {"path": path, "message": message}


def _path_segment(value: str, field_name: str) -> str:
    normalized = str(value or "").strip()
    if not normalized or "/" in normalized or normalized in {".", ".."}:
        raise ValueError(f"{field_name} is not a safe path segment")
    return normalized


__all__ = [
    "CONTACT_DIRECTORY_COLLECTION",
    "CONTACT_DIRECTORY_CORPUS",
    "CONTACT_DIRECTORY_MANUAL_REVIEW_FILENAME",
    "CONTACT_DIRECTORY_PROJECTION_FILENAME",
    "CONTACT_DIRECTORY_PROJECTION_SCHEMA_VERSION",
    "CONTACT_DIRECTORY_RELEASE_MANIFEST_SCHEMA_VERSION",
    "CONTACT_DIRECTORY_VALIDATION_REPORT_SCHEMA_VERSION",
    "HANDBOOK_PHONE_DIRECTORY_ATTACHMENT_ROLE",
    "HANDBOOK_PHONE_DIRECTORY_PROJECTION_NAME",
    "HANDBOOK_PHONE_DIRECTORY_SOURCE_FAMILY",
    "ContactDirectoryProjectionBuildResult",
    "ContactDirectoryProjectionReleaseReport",
    "ContactDirectoryProjectionValidationReport",
    "assert_contact_directory_projection_release_ready",
    "build_contact_directory_projection_bundle_from_handbook_document_units",
    "validate_contact_directory_projection_bundle",
    "write_contact_directory_projection_release",
    "write_contact_directory_projection_release_from_import_documents",
]
