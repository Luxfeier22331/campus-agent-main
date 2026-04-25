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
HANDBOOK_CURATED_SERVICE_FLOW_GRAPH_SCHEMA_VERSION = "handbook_curated_service_flow_graph.v1"
HANDBOOK_CURATED_SERVICE_GUIDE_SCHEMA_VERSION = "handbook_curated_service_guide.v1"
HANDBOOK_CURATED_SERVICE_GUIDE_SOURCE_FAMILY = "handbook_curated_service_guide_v1"

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
    return _build_service_guide_projection_bundle_from_handbook_source(
        source=source,
        generated_at=generated_at,
        effective_from=effective_from,
        effective_until=effective_until,
    )


def build_service_guide_projection_bundle_from_handbook_flow_graph_document_data(
    *,
    document_data: dict[str, Any],
    generated_at: str,
    effective_from: str,
    effective_until: str,
    target_document_id: str | None = None,
    source_document_id: str | None = None,
) -> ServiceGuideProjectionBuildResult:
    _parse_rfc3339(generated_at, "generated_at")
    _parse_rfc3339(effective_from, "effective_from")
    _validate_effective_window(effective_from, effective_until, "effective")
    source = _coerce_handbook_flow_graph_document_data_source(
        document_data=document_data,
        target_document_id=target_document_id,
        source_document_id=source_document_id,
    )
    return _build_service_guide_projection_bundle_from_handbook_source(
        source=source,
        generated_at=generated_at,
        effective_from=effective_from,
        effective_until=effective_until,
    )


def build_service_guide_projection_bundle_from_curated_handbook_flow_graph(
    *,
    curated_flow_graph_artifact: dict[str, Any],
    generated_at: str,
    effective_from: str,
    effective_until: str,
) -> ServiceGuideProjectionBuildResult:
    artifact = _require_mapping(
        curated_flow_graph_artifact,
        "curated_flow_graph_artifact",
    )
    schema_version = str(artifact.get("schemaVersion") or "").strip()
    if schema_version != HANDBOOK_CURATED_SERVICE_FLOW_GRAPH_SCHEMA_VERSION:
        raise ValueError(
            f"unsupported curated handbook flow graph schemaVersion: {schema_version!r}"
        )
    if _required_text(artifact.get("projectionName")) is None:
        raise ValueError("curated handbook flow graph projectionName is required")
    document_data = _require_mapping(artifact.get("documentData"), "documentData")
    return build_service_guide_projection_bundle_from_handbook_flow_graph_document_data(
        document_data=document_data,
        generated_at=generated_at,
        effective_from=effective_from,
        effective_until=effective_until,
        target_document_id=_required_text(artifact.get("targetDocumentId")),
        source_document_id=_required_text(artifact.get("sourceDocumentId")),
    )


def build_service_guide_projection_bundle_from_curated_service_guide(
    *,
    curated_service_guide_artifact: dict[str, Any],
    generated_at: str,
    effective_from: str,
    effective_until: str,
) -> ServiceGuideProjectionBuildResult:
    _parse_rfc3339(generated_at, "generated_at")
    _parse_rfc3339(effective_from, "effective_from")
    _validate_effective_window(effective_from, effective_until, "effective")
    artifact = _require_mapping(
        curated_service_guide_artifact,
        "curated_service_guide_artifact",
    )
    schema_version = str(artifact.get("schemaVersion") or "").strip()
    if schema_version != HANDBOOK_CURATED_SERVICE_GUIDE_SCHEMA_VERSION:
        raise ValueError(f"unsupported curated service guide schemaVersion: {schema_version!r}")
    if _required_text(artifact.get("projectionName")) is None:
        raise ValueError("curated service guide projectionName is required")
    document_data = _require_mapping(artifact.get("documentData"), "documentData")
    records, manual_review_sources = _coerce_curated_service_guide_records(
        document_data=document_data,
        effective_from=effective_from,
        effective_until=effective_until,
    )
    records.sort(key=lambda item: (item["source_refs"][0], item["display_name"]))
    bundle = {
        "schema_version": SERVICE_GUIDE_PROJECTION_SCHEMA_VERSION,
        "generated_at": generated_at,
        "source_families": [HANDBOOK_CURATED_SERVICE_GUIDE_SOURCE_FAMILY],
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


def merge_service_guide_projection_build_results(
    *,
    build_results: list[ServiceGuideProjectionBuildResult],
    generated_at: str,
) -> ServiceGuideProjectionBuildResult:
    _parse_rfc3339(generated_at, "generated_at")
    source_families: list[str] = []
    records: list[dict[str, Any]] = []
    conflicts: list[dict[str, Any]] = []
    manual_review_sources: list[dict[str, Any]] = []
    for build_result in build_results:
        bundle = build_result.bundle
        for source_family in _string_list(bundle.get("source_families")):
            if source_family not in source_families:
                source_families.append(source_family)
        records.extend(_list_of_dicts(bundle.get("service_guide_records")))
        conflicts.extend(_list_of_dicts(bundle.get("conflict_records")))
        manual_review_sources.extend(_list_of_dicts(bundle.get("manual_review_sources")))
    records.sort(key=lambda item: (item["source_refs"][0], item["display_name"]))
    bundle = {
        "schema_version": SERVICE_GUIDE_PROJECTION_SCHEMA_VERSION,
        "generated_at": generated_at,
        "source_families": source_families,
        "service_guide_records": records,
        "conflict_records": conflicts,
        "manual_review_sources": manual_review_sources,
    }
    validation_report = validate_service_guide_projection_bundle(bundle)
    return ServiceGuideProjectionBuildResult(
        bundle=bundle,
        validation_report=validation_report,
        manual_review_sources=manual_review_sources,
    )


def assert_service_guide_projection_release_ready(
    bundle: dict[str, Any],
    *,
    expected_ready_records: int | None = None,
) -> None:
    validation_report = validate_service_guide_projection_bundle(bundle)
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
        raise ValueError("service guide projection release blocked by manual review records")
    manual_review_sources = _list_of_dicts(bundle.get("manual_review_sources"))
    if manual_review_sources:
        raise ValueError("service guide projection release blocked by manual review sources")
    if expected_ready_records is not None and len(records) != expected_ready_records:
        raise ValueError(
            "service guide projection ready record count mismatch: "
            f"expected {expected_ready_records}, got {len(records)}"
        )


def _build_service_guide_projection_bundle_from_handbook_source(
    *,
    source: dict[str, Any],
    generated_at: str,
    effective_from: str,
    effective_until: str,
) -> ServiceGuideProjectionBuildResult:
    manual_review_sources: list[dict[str, Any]] = []
    records: list[dict[str, Any]] = []
    global_manual_review_required = bool(source.get("global_manual_review_required"))
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
            extraction_status = (
                "needs_manual_review" if notes or global_manual_review_required else "ready"
            )
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
            if notes or global_manual_review_required:
                manual_review_sources.append(
                    {
                        "service_id": service_id,
                        "source_ref": source_ref,
                        "reason": "handbook_flow_manual_review_notes"
                        if notes
                        else "handbook_flow_graph_global_manual_review_required",
                        "notes": notes or ["flow graph source marked manual review required"],
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
        "global_manual_review_required": bool(flow_graph.get("global_manual_review_required")),
        "page_findings": page_findings,
    }


def _coerce_handbook_flow_graph_document_data_source(
    *,
    document_data: dict[str, Any],
    target_document_id: str | None,
    source_document_id: str | None,
) -> dict[str, Any]:
    payload = _require_mapping(document_data, "document_data")
    extraction_status = _required_text(payload.get("extractionStatus")) or ""
    if extraction_status not in {"ready", "needs_review"}:
        raise ValueError(
            "handbook flow graph document data extractionStatus must be ready or needs_review"
        )
    title = _required_text(payload.get("title"))
    if title is None:
        raise ValueError("handbook flow graph document data title is required")
    page_start = _positive_int(payload.get("sourcePageStart"), "sourcePageStart")
    page_end = _positive_int(payload.get("sourcePageEnd"), "sourcePageEnd")
    page_findings: list[dict[str, Any]] = []
    for page in _list_of_dicts(payload.get("pageFindings")):
        flows: list[dict[str, Any]] = []
        for flow in _list_of_dicts(page.get("flows")):
            steps: list[dict[str, Any]] = []
            for step in _list_of_dicts(flow.get("steps")):
                step_text = _required_text(step.get("stepText"))
                if step_text is None:
                    continue
                steps.append(
                    {
                        "step_id": _required_text(step.get("stepId")) or "",
                        "step_text": step_text,
                        "next_step_ids": _string_list(step.get("nextStepIds")),
                    }
                )
            if not steps:
                continue
            flows.append(
                {
                    "flow_heading": _required_text(flow.get("flowHeading")) or "未命名流程",
                    "audience_scope": _required_text(flow.get("audienceScope")) or "",
                    "steps": steps,
                    "manual_review_notes": _string_list(flow.get("manualReviewNotes")),
                }
            )
        if not flows:
            continue
        page_findings.append(
            {
                "source_page": _positive_int(page.get("sourcePage"), "sourcePage"),
                "page_heading": _required_text(page.get("pageHeading")) or "",
                "flows": flows,
            }
        )
    if not page_findings:
        raise ValueError("handbook flow graph document data pageFindings has no usable flows")
    return {
        "target_title": title,
        "target_document_id": target_document_id or _default_target_document_id(title),
        "source_document_id": source_document_id or "",
        "source_page_start": page_start,
        "source_page_end": page_end,
        "global_manual_review_required": bool(payload.get("manualReviewRequired"))
        or extraction_status == "needs_review",
        "page_findings": page_findings,
    }


def _coerce_curated_service_guide_records(
    *,
    document_data: dict[str, Any],
    effective_from: str,
    effective_until: str,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    payload = _require_mapping(document_data, "document_data")
    extraction_status = _required_text(payload.get("extractionStatus")) or ""
    if extraction_status not in {"ready", "needs_review"}:
        raise ValueError("curated service guide extractionStatus must be ready or needs_review")
    title = _required_text(payload.get("title"))
    if title is None:
        raise ValueError("curated service guide title is required")
    page_start = _positive_int(payload.get("sourcePageStart"), "sourcePageStart")
    page_end = _positive_int(payload.get("sourcePageEnd"), "sourcePageEnd")
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
    page_start: int,
    page_end: int,
) -> list[str]:
    refs = _string_list(value)
    if refs:
        return refs
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


def _positive_int(value: object, field_name: str) -> int:
    if isinstance(value, bool):
        raise ValueError(f"{field_name} must be a positive integer")
    try:
        parsed = int(str(value))
    except ValueError as exc:
        raise ValueError(f"{field_name} must be a positive integer") from exc
    if parsed <= 0:
        raise ValueError(f"{field_name} must be a positive integer")
    return parsed


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
    "HANDBOOK_CURATED_SERVICE_FLOW_GRAPH_SCHEMA_VERSION",
    "HANDBOOK_CURATED_SERVICE_GUIDE_SCHEMA_VERSION",
    "HANDBOOK_CURATED_SERVICE_GUIDE_SOURCE_FAMILY",
    "HANDBOOK_SERVICE_NAVIGATION_SOURCE_FAMILY",
    "SERVICE_GUIDE_COLLECTION",
    "SERVICE_GUIDE_CORPUS",
    "SERVICE_GUIDE_PROJECTION_FILENAME",
    "SERVICE_GUIDE_PROJECTION_SCHEMA_VERSION",
    "ServiceGuideProjectionBuildResult",
    "ServiceGuideProjectionReleaseReport",
    "ServiceGuideProjectionValidationReport",
    "assert_service_guide_projection_release_ready",
    "build_service_guide_projection_bundle_from_curated_handbook_flow_graph",
    "build_service_guide_projection_bundle_from_curated_service_guide",
    "build_service_guide_projection_bundle_from_handbook_flow_graph",
    "build_service_guide_projection_bundle_from_handbook_flow_graph_document_data",
    "merge_service_guide_projection_build_results",
    "validate_service_guide_projection_bundle",
    "write_service_guide_projection_release",
]
