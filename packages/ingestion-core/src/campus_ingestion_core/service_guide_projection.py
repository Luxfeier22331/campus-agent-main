from __future__ import annotations

import hashlib
import json
import re
from dataclasses import asdict, dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Protocol
from urllib.parse import quote

from campus_ingestion_core.object_store import build_index_release_artifact_key

SERVICE_GUIDE_PROJECTION_SCHEMA_VERSION = "campus_services_service_guide_projection.v1"
SERVICE_GUIDE_VALIDATION_REPORT_SCHEMA_VERSION = "service_guide_projection_validation_report.v1"
SERVICE_GUIDE_RELEASE_MANIFEST_SCHEMA_VERSION = "service_guide_projection_release_manifest.v1"
SERVICE_GUIDE_CORPUS = "campus_services"
SERVICE_GUIDE_COLLECTION = "service_guide"
SERVICE_GUIDE_PROJECTION_FILENAME = "service-guide-projection.json"
SERVICE_GUIDE_VALIDATION_FILENAME = "validation-summary.json"
SERVICE_GUIDE_RELEASE_MANIFEST_FILENAME = "release-manifest.json"
SERVICE_GUIDE_MANUAL_REVIEW_FILENAME = "manual-review-report.json"
HANDBOOK_SERVICE_NAVIGATION_SOURCE_FAMILY = "handbook_service_navigation_projection_v1"

_NUMBERING_RE = re.compile(
    r"^\s*(?:[一二三四五六七八九十]+|[0-9]+)[、.．]\s*",
)
_STEP_NUMBERING_RE = re.compile(r"^\s*(?:[0-9]+|[一二三四五六七八九十]+)[、.．]\s*")
_PUNCTUATION_RE = re.compile(r"[\s:：,，。；;（）()《》<>]+")
_SERVICE_KEYWORDS = (
    "学生公寓",
    "公寓",
    "宿舍",
    "住宿",
    "入住",
    "不住宿",
    "退宿",
    "离校",
    "本科生",
    "研究生",
)


class ServiceGuideProjectionObjectStore(Protocol):
    def put_bytes(
        self,
        *,
        bucket: str,
        key: str,
        data: bytes,
        content_type: str,
    ) -> None: ...


@dataclass(frozen=True, slots=True)
class ServiceGuideProjectionBuildResult:
    bundle: dict[str, Any]
    validation_report: ServiceGuideProjectionValidationReport
    manual_review_sources: list[dict[str, Any]]


@dataclass(frozen=True, slots=True)
class ServiceGuideProjectionValidationReport:
    schema_version: str
    valid: bool
    issues: list[dict[str, Any]]
    counts: dict[str, int]


@dataclass(frozen=True, slots=True)
class ServiceGuideProjectionReleaseReport:
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


def build_service_guide_projection_bundle_from_handbook_flow_graph(
    *,
    flow_graph_artifact: dict[str, Any],
    generated_at: str,
    effective_from: str,
    effective_until: str,
    target_document_id: str | None = None,
    target_title: str | None = None,
    source_document_id: str | None = None,
    source_page_start: int | None = None,
    source_page_end: int | None = None,
) -> ServiceGuideProjectionBuildResult:
    _parse_rfc3339(generated_at, "generated_at")
    _parse_rfc3339(effective_from, "effective_from")
    _validate_effective_window(effective_from, effective_until, "effective")
    source = _coerce_handbook_flow_graph_source(
        flow_graph_artifact=flow_graph_artifact,
        target_document_id=target_document_id,
        target_title=target_title,
        source_document_id=source_document_id,
        source_page_start=source_page_start,
        source_page_end=source_page_end,
    )

    manual_review_sources: list[dict[str, Any]] = []
    records: list[dict[str, Any]] = []
    for page_finding in source["page_findings"]:
        page = int(page_finding["source_page"])
        page_heading = str(page_finding.get("page_heading") or "").strip()
        source_ref = _handbook_page_source_ref(
            page_start=source["source_page_start"],
            page_end=source["source_page_end"],
            page=page,
        )
        flows = _list_of_dicts(page_finding.get("flows"))
        for flow in flows:
            steps = _list_of_dicts(flow.get("steps"))
            if not steps:
                continue
            flow_heading = str(flow.get("flow_heading") or "").strip()
            display_name = _normalize_flow_heading(flow_heading)
            procedure_content = _procedure_content(steps)
            notes = _string_list(flow.get("manual_review_notes"))
            extraction_status = "needs_manual_review" if notes else "ready"
            service_id = _service_id(
                target_document_id=source["target_document_id"],
                page=page,
                flow_heading=flow_heading,
            )
            aliases = _build_aliases(
                target_title=source["target_title"],
                page_heading=page_heading,
                display_name=display_name,
                procedure_content=procedure_content,
            )
            record = {
                "service_id": service_id,
                "display_name": display_name,
                "aliases": aliases,
                "category": _infer_category(
                    f"{source['target_title']}\n{page_heading}\n{display_name}\n{procedure_content}"
                ),
                "campus_scope": "all",
                "audience": _infer_audience(
                    f"{source['target_title']}\n{page_heading}\n{display_name}\n"
                    f"{flow.get('audience_scope') or ''}"
                ),
                "effective_from": effective_from,
                "effective_until": effective_until,
                "source_refs": [source_ref],
                "guide_sections": [
                    {
                        "section_id": f"{service_id}:section:procedure",
                        "section_type": "procedure",
                        "title": display_name,
                        "content": procedure_content,
                        "order": 1,
                        "source_refs": [source_ref],
                    }
                ],
                "materials": [],
                "entry_refs": [],
                "office_hours": [],
                "contact_refs": [],
                "eligibility_notes": _eligibility_notes(flow.get("audience_scope")),
                "extraction_status": extraction_status,
            }
            records.append(record)
            if notes:
                manual_review_sources.append(
                    {
                        "service_id": service_id,
                        "source_ref": source_ref,
                        "reason": "handbook_flow_manual_review_notes",
                        "notes": notes,
                    }
                )

    records.sort(key=lambda item: (item["source_refs"][0], item["display_name"]))
    bundle = {
        "schema_version": SERVICE_GUIDE_PROJECTION_SCHEMA_VERSION,
        "generated_at": generated_at,
        "source_families": [HANDBOOK_SERVICE_NAVIGATION_SOURCE_FAMILY],
        "service_guide_records": records,
        "conflict_records": [],
        "manual_review_sources": manual_review_sources,
    }
    validation_report = validate_service_guide_projection_bundle(bundle)
    return ServiceGuideProjectionBuildResult(
        bundle=bundle,
        validation_report=validation_report,
        manual_review_sources=manual_review_sources,
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
        if extraction_status not in {"ready", "needs_manual_review", "conflicted", "incomplete"}:
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
        if extraction_status == "ready" and not source_refs:
            issues.append(_issue(f"{path}.source_refs", "source_refs is required"))

        for section_index, section in enumerate(_list_of_dicts(record.get("guide_sections"))):
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


def _coerce_handbook_flow_graph_source(
    *,
    flow_graph_artifact: dict[str, Any],
    target_document_id: str | None,
    target_title: str | None,
    source_document_id: str | None,
    source_page_start: int | None,
    source_page_end: int | None,
) -> dict[str, Any]:
    artifact = _require_mapping(flow_graph_artifact, "flow_graph_artifact")
    if "flow_graph" in artifact:
        schema_version = str(artifact.get("schema_version") or "").strip()
        if schema_version != HANDBOOK_SERVICE_NAVIGATION_SOURCE_FAMILY:
            raise ValueError(
                "unsupported handbook service navigation projection schema_version: "
                f"{schema_version!r}"
            )
        flow_graph = _require_mapping(artifact.get("flow_graph"), "flow_graph")
        resolved_target_title = (
            target_title
            or _required_text(artifact.get("target_title"))
            or _required_text(flow_graph.get("document_title"))
            or "手册服务流程"
        )
        resolved_target_document_id = (
            target_document_id
            or _required_text(artifact.get("target_document_id"))
            or _default_target_document_id(resolved_target_title)
        )
        resolved_source_document_id = (
            source_document_id or _required_text(artifact.get("source_document_id")) or ""
        )
        resolved_page_start = source_page_start or int(artifact.get("source_page_start") or 0)
        resolved_page_end = source_page_end or int(artifact.get("source_page_end") or 0)
    else:
        flow_graph = artifact
        resolved_target_title = (
            target_title or _required_text(flow_graph.get("document_title")) or "手册服务流程"
        )
        resolved_target_document_id = target_document_id or _default_target_document_id(
            resolved_target_title
        )
        resolved_source_document_id = source_document_id or ""
        resolved_page_start = source_page_start or 0
        resolved_page_end = source_page_end or 0

    page_findings = _list_of_dicts(flow_graph.get("page_findings"))
    if not page_findings:
        raise ValueError("flow_graph.page_findings must be a non-empty array")
    pages = [int(page.get("source_page") or 0) for page in page_findings]
    if not resolved_page_start:
        resolved_page_start = min(page for page in pages if page > 0)
    if not resolved_page_end:
        resolved_page_end = max(page for page in pages if page > 0)
    return {
        "target_title": resolved_target_title,
        "target_document_id": resolved_target_document_id,
        "source_document_id": resolved_source_document_id,
        "source_page_start": resolved_page_start,
        "source_page_end": resolved_page_end,
        "page_findings": page_findings,
    }


def _handbook_page_source_ref(*, page_start: int, page_end: int, page: int) -> str:
    return f"handbook:student_rules:pages:{page_start}-{page_end}#page={page}"


def _service_id(*, target_document_id: str, page: int, flow_heading: str) -> str:
    seed = json.dumps(
        {
            "target_document_id": target_document_id,
            "page": page,
            "flow_heading": flow_heading,
        },
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    )
    digest = hashlib.sha1(seed.encode("utf-8")).hexdigest()[:12]
    return f"service:handbook:{digest}"


def _normalize_flow_heading(value: str) -> str:
    normalized = _NUMBERING_RE.sub("", value).strip()
    return normalized or value.strip()


def _procedure_content(steps: list[dict[str, Any]]) -> str:
    lines: list[str] = []
    for index, step in enumerate(steps, start=1):
        text = _STEP_NUMBERING_RE.sub("", str(step.get("step_text") or "")).strip()
        if not text:
            continue
        lines.append(f"{index}. {text}")
    return "\n".join(lines)


def _build_aliases(
    *,
    target_title: str,
    page_heading: str,
    display_name: str,
    procedure_content: str,
) -> list[str]:
    aliases: list[str] = []
    for candidate in (
        display_name,
        _strip_suffix(display_name, "手续流程"),
        _strip_suffix(display_name, "流程"),
        _strip_suffix(display_name, "手续"),
        _strip_suffix(target_title, "工作流程"),
        target_title,
        _strip_prefix(page_heading, "中央民族大学"),
        page_heading,
    ):
        _append_alias(aliases, candidate)
    combined = f"{target_title}\n{page_heading}\n{display_name}\n{procedure_content}"
    for keyword in _SERVICE_KEYWORDS:
        if keyword in combined:
            _append_alias(aliases, keyword)
    return aliases


def _append_alias(aliases: list[str], value: str | None) -> None:
    normalized = _normalize_alias(value)
    if normalized and normalized not in aliases:
        aliases.append(normalized)


def _normalize_alias(value: str | None) -> str:
    normalized = str(value or "").strip()
    return _PUNCTUATION_RE.sub("", normalized)


def _strip_suffix(value: str, suffix: str) -> str:
    return value[: -len(suffix)] if value.endswith(suffix) else value


def _strip_prefix(value: str, prefix: str) -> str:
    return value[len(prefix) :] if value.startswith(prefix) else value


def _infer_category(value: str) -> str:
    if any(keyword in value for keyword in ("学生公寓", "公寓", "宿舍", "住宿", "退宿")):
        return "student_housing"
    return "campus_service"


def _infer_audience(value: str) -> list[str]:
    if any(keyword in value for keyword in ("学生", "本科生", "研究生", "新生", "毕业生")):
        return ["student"]
    return ["unknown"]


def _eligibility_notes(value: object) -> list[str]:
    audience_scope = str(value or "").strip()
    if not audience_scope:
        return []
    return [audience_scope]


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


def _default_target_document_id(target_title: str) -> str:
    digest = hashlib.sha1(target_title.encode("utf-8")).hexdigest()[:12]
    return f"campus_services:service_catalog:{quote(target_title, safe='')[:48]}:{digest}"


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


def _require_mapping(value: object, label: str) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise ValueError(f"{label} must be an object")
    return dict(value)


def _issue(path: str, message: str) -> dict[str, str]:
    return {"path": path, "message": message}


def _json_bytes(payload: object) -> bytes:
    return (json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True) + "\n").encode(
        "utf-8"
    )


def _path_segment(value: str, field_name: str) -> str:
    normalized = str(value or "").strip()
    if not normalized:
        raise ValueError(f"{field_name} is required")
    if "/" in normalized or "\\" in normalized:
        raise ValueError(f"{field_name} must not contain path separators")
    return normalized


__all__ = [
    "HANDBOOK_SERVICE_NAVIGATION_SOURCE_FAMILY",
    "SERVICE_GUIDE_COLLECTION",
    "SERVICE_GUIDE_CORPUS",
    "SERVICE_GUIDE_PROJECTION_FILENAME",
    "SERVICE_GUIDE_PROJECTION_SCHEMA_VERSION",
    "ServiceGuideProjectionBuildResult",
    "ServiceGuideProjectionReleaseReport",
    "ServiceGuideProjectionValidationReport",
    "build_service_guide_projection_bundle_from_handbook_flow_graph",
    "validate_service_guide_projection_bundle",
    "write_service_guide_projection_release",
]
