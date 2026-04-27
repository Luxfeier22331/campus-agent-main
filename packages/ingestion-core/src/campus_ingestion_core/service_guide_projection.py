from __future__ import annotations

import hashlib
import json
import re
from collections.abc import Mapping
from pathlib import Path
from typing import Any

from campus_ingestion_core import service_guide_projection_support as _support
from campus_ingestion_core.service_guide_projection_constants import (
    HANDBOOK_CURATED_SERVICE_FLOW_GRAPH_SCHEMA_VERSION,
    HANDBOOK_CURATED_SERVICE_GUIDE_SCHEMA_VERSION,
    HANDBOOK_CURATED_SERVICE_GUIDE_SOURCE_FAMILY,
    HANDBOOK_SERVICE_NAVIGATION_SOURCE_FAMILY,
    NOTICE_DERIVED_SERVICE_GUIDE_SOURCE_FAMILY,
    OFFICIAL_WEB_CURATED_SERVICE_GUIDE_SCHEMA_VERSION,
    OFFICIAL_WEB_CURATED_SERVICE_GUIDE_SOURCE_FAMILY,
    SERVICE_GUIDE_COLLECTION,
    SERVICE_GUIDE_CORPUS,
    SERVICE_GUIDE_MANUAL_REVIEW_FILENAME,
    SERVICE_GUIDE_PROJECTION_FILENAME,
    SERVICE_GUIDE_PROJECTION_SCHEMA_VERSION,
    SERVICE_GUIDE_SOURCE_TRUTH_MANIFEST_ENV,
    SERVICE_GUIDE_SOURCE_TRUTH_MANIFEST_SCHEMA_VERSION,
)
from campus_ingestion_core.service_guide_projection_curated import (
    _coerce_curated_service_guide_records,
)
from campus_ingestion_core.service_guide_projection_flow_graph import (
    _coerce_handbook_flow_graph_document_data_source,
    _coerce_handbook_flow_graph_source,
)
from campus_ingestion_core.service_guide_projection_models import (
    ServiceGuideProjectionBuildResult,
    ServiceGuideProjectionObjectStore,
    ServiceGuideProjectionReleaseReport,
    ServiceGuideProjectionValidationReport,
    ServiceGuideSourceTruthManifest,
)
from campus_ingestion_core.service_guide_projection_release import (
    assert_service_guide_projection_release_ready,
    write_service_guide_projection_release,
)
from campus_ingestion_core.service_guide_projection_validation import (
    validate_service_guide_projection_bundle,
)

_default_service_guide_source_truth_manifest_path = (
    _support.default_service_guide_source_truth_manifest_path
)
_default_target_document_id = _support.default_target_document_id
_list_of_dicts = _support.list_of_dicts
_manifest_source_paths = _support.manifest_source_paths
_optional_positive_int = _support.optional_positive_int
_parse_rfc3339 = _support.parse_rfc3339
_path_segment = _support.path_segment
_positive_int = _support.positive_int
_read_json_object = _support.read_json_object
_require_mapping = _support.require_mapping
_required_text = _support.required_text
_service_guide_release_id = _support.service_guide_release_id
_string_list = _support.string_list
_validate_effective_window = _support.validate_effective_window

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
    if schema_version == HANDBOOK_CURATED_SERVICE_GUIDE_SCHEMA_VERSION:
        source_family = HANDBOOK_CURATED_SERVICE_GUIDE_SOURCE_FAMILY
        require_handbook_pages = True
    elif schema_version == OFFICIAL_WEB_CURATED_SERVICE_GUIDE_SCHEMA_VERSION:
        source_family = OFFICIAL_WEB_CURATED_SERVICE_GUIDE_SOURCE_FAMILY
        require_handbook_pages = False
    else:
        raise ValueError(f"unsupported curated service guide schemaVersion: {schema_version!r}")
    if _required_text(artifact.get("projectionName")) is None:
        raise ValueError("curated service guide projectionName is required")
    document_data = _require_mapping(artifact.get("documentData"), "documentData")
    records, manual_review_sources = _coerce_curated_service_guide_records(
        document_data=document_data,
        effective_from=effective_from,
        effective_until=effective_until,
        require_handbook_pages=require_handbook_pages,
    )
    records.sort(key=lambda item: (item["source_refs"][0], item["display_name"]))
    bundle = {
        "schema_version": SERVICE_GUIDE_PROJECTION_SCHEMA_VERSION,
        "generated_at": generated_at,
        "source_families": [source_family],
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


def load_service_guide_source_truth_manifest(
    path: Path | str,
) -> ServiceGuideSourceTruthManifest:
    manifest_path = Path(path).resolve()
    payload = _require_mapping(
        json.loads(manifest_path.read_text(encoding="utf-8")),
        "service_guide_source_truth_manifest",
    )
    schema_version = _required_text(payload.get("schema_version"))
    if schema_version != SERVICE_GUIDE_SOURCE_TRUTH_MANIFEST_SCHEMA_VERSION:
        raise ValueError(
            f"unsupported service guide source truth manifest schema_version: {schema_version!r}"
        )
    target_corpus = _required_text(payload.get("target_corpus"))
    target_collection = _required_text(payload.get("target_collection"))
    if target_corpus != SERVICE_GUIDE_CORPUS or target_collection != SERVICE_GUIDE_COLLECTION:
        raise ValueError(
            "service guide source truth manifest target must be campus_services/service_guide"
        )
    upstream_corpus = _required_text(payload.get("upstream_corpus"))
    upstream_collection = _required_text(payload.get("upstream_collection"))
    if upstream_corpus is None or upstream_collection is None:
        raise ValueError("service guide source truth manifest upstream scope is required")
    effective_from = _required_text(payload.get("effective_from"))
    effective_until = _required_text(payload.get("effective_until"))
    if effective_from is None or effective_until is None:
        raise ValueError("service guide source truth manifest effective window is required")
    _validate_effective_window(effective_from, effective_until, "source_truth_manifest")
    release_id_prefix = _required_text(payload.get("release_id_prefix")) or "service-guide-handbook"
    expected_ready_records = _optional_positive_int(payload.get("expected_ready_records"))
    curated_flow_graph_paths = _manifest_source_paths(
        payload.get("curated_flow_graphs"),
        manifest_dir=manifest_path.parent,
        field_name="curated_flow_graphs",
    )
    curated_service_guide_paths = _manifest_source_paths(
        payload.get("curated_service_guides"),
        manifest_dir=manifest_path.parent,
        field_name="curated_service_guides",
    )
    if not curated_flow_graph_paths and not curated_service_guide_paths:
        raise ValueError("service guide source truth manifest must declare at least one source")
    return ServiceGuideSourceTruthManifest(
        path=manifest_path,
        target_corpus=target_corpus,
        target_collection=target_collection,
        upstream_corpus=upstream_corpus,
        upstream_collection=upstream_collection,
        release_id_prefix=release_id_prefix,
        effective_from=effective_from,
        effective_until=effective_until,
        expected_ready_records=expected_ready_records,
        curated_flow_graph_paths=curated_flow_graph_paths,
        curated_service_guide_paths=curated_service_guide_paths,
    )


def resolve_service_guide_source_truth_manifest_path(
    source: Mapping[str, str] | None = None,
) -> Path | None:
    resolved_source = source or {}
    configured = (resolved_source.get(SERVICE_GUIDE_SOURCE_TRUTH_MANIFEST_ENV) or "").strip()
    if configured:
        return Path(configured).resolve()
    default_path = _default_service_guide_source_truth_manifest_path()
    if default_path.exists():
        return default_path
    return None


def build_service_guide_projection_bundle_from_source_truth_manifest(
    *,
    source_truth_manifest_path: Path | str,
    generated_at: str,
) -> ServiceGuideProjectionBuildResult:
    manifest = load_service_guide_source_truth_manifest(source_truth_manifest_path)
    return _build_service_guide_projection_bundle_from_loaded_source_truth_manifest(
        manifest=manifest,
        generated_at=generated_at,
    )


def write_service_guide_projection_release_from_source_truth_manifest(
    *,
    source_truth_manifest_path: Path | str,
    output_dir: Path,
    generated_at: str,
    object_store: ServiceGuideProjectionObjectStore,
    bucket: str,
    release_id: str | None = None,
) -> ServiceGuideProjectionReleaseReport:
    manifest = load_service_guide_source_truth_manifest(source_truth_manifest_path)
    build_result = _build_service_guide_projection_bundle_from_loaded_source_truth_manifest(
        manifest=manifest,
        generated_at=generated_at,
    )
    assert_service_guide_projection_release_ready(
        build_result.bundle,
        expected_ready_records=manifest.expected_ready_records,
    )
    return write_service_guide_projection_release(
        bundle=build_result.bundle,
        output_dir=output_dir,
        release_id=release_id
        or _service_guide_release_id(manifest.release_id_prefix, generated_at),
        generated_at=generated_at,
        manual_review_sources=build_result.manual_review_sources,
        object_store=object_store,
        bucket=bucket,
    )


def write_service_guide_projection_release_from_manifest_if_available(
    *,
    source: Mapping[str, str],
    upstream_corpus: str,
    upstream_collection: str,
    output_dir: Path,
    generated_at: str,
    object_store: ServiceGuideProjectionObjectStore,
    bucket: str,
) -> ServiceGuideProjectionReleaseReport | None:
    configured = (source.get(SERVICE_GUIDE_SOURCE_TRUTH_MANIFEST_ENV) or "").strip()
    if not configured and (upstream_corpus.strip(), upstream_collection.strip()) != (
        "regulations",
        "student_rules",
    ):
        return None
    manifest_path = resolve_service_guide_source_truth_manifest_path(source)
    if manifest_path is None:
        return None
    manifest = load_service_guide_source_truth_manifest(manifest_path)
    if (
        manifest.upstream_corpus != upstream_corpus.strip()
        or manifest.upstream_collection != upstream_collection.strip()
    ):
        return None
    return write_service_guide_projection_release_from_source_truth_manifest(
        source_truth_manifest_path=manifest_path,
        output_dir=output_dir,
        generated_at=generated_at,
        object_store=object_store,
        bucket=bucket,
    )


def _build_service_guide_projection_bundle_from_loaded_source_truth_manifest(
    *,
    manifest: ServiceGuideSourceTruthManifest,
    generated_at: str,
) -> ServiceGuideProjectionBuildResult:
    _parse_rfc3339(generated_at, "generated_at")
    build_results: list[ServiceGuideProjectionBuildResult] = []
    for curated_flow_graph_path in manifest.curated_flow_graph_paths:
        build_results.append(
            build_service_guide_projection_bundle_from_curated_handbook_flow_graph(
                curated_flow_graph_artifact=_read_json_object(curated_flow_graph_path),
                generated_at=generated_at,
                effective_from=manifest.effective_from,
                effective_until=manifest.effective_until,
            )
        )
    for curated_service_guide_path in manifest.curated_service_guide_paths:
        build_results.append(
            build_service_guide_projection_bundle_from_curated_service_guide(
                curated_service_guide_artifact=_read_json_object(curated_service_guide_path),
                generated_at=generated_at,
                effective_from=manifest.effective_from,
                effective_until=manifest.effective_until,
            )
        )
    return (
        build_results[0]
        if len(build_results) == 1
        else merge_service_guide_projection_build_results(
            build_results=build_results,
            generated_at=generated_at,
        )
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
    if global_manual_review_required:
        raise ValueError("service guide projection no longer supports manual review sources")
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
            if notes:
                raise ValueError("service guide projection no longer supports manual review notes")
            extraction_status = "ready"
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


__all__ = [
    "HANDBOOK_CURATED_SERVICE_FLOW_GRAPH_SCHEMA_VERSION",
    "HANDBOOK_CURATED_SERVICE_GUIDE_SCHEMA_VERSION",
    "HANDBOOK_CURATED_SERVICE_GUIDE_SOURCE_FAMILY",
    "HANDBOOK_SERVICE_NAVIGATION_SOURCE_FAMILY",
    "NOTICE_DERIVED_SERVICE_GUIDE_SOURCE_FAMILY",
    "OFFICIAL_WEB_CURATED_SERVICE_GUIDE_SCHEMA_VERSION",
    "OFFICIAL_WEB_CURATED_SERVICE_GUIDE_SOURCE_FAMILY",
    "SERVICE_GUIDE_COLLECTION",
    "SERVICE_GUIDE_CORPUS",
    "SERVICE_GUIDE_MANUAL_REVIEW_FILENAME",
    "SERVICE_GUIDE_PROJECTION_FILENAME",
    "SERVICE_GUIDE_PROJECTION_SCHEMA_VERSION",
    "SERVICE_GUIDE_SOURCE_TRUTH_MANIFEST_ENV",
    "SERVICE_GUIDE_SOURCE_TRUTH_MANIFEST_SCHEMA_VERSION",
    "ServiceGuideProjectionBuildResult",
    "ServiceGuideProjectionReleaseReport",
    "ServiceGuideProjectionValidationReport",
    "ServiceGuideSourceTruthManifest",
    "assert_service_guide_projection_release_ready",
    "build_service_guide_projection_bundle_from_curated_handbook_flow_graph",
    "build_service_guide_projection_bundle_from_curated_service_guide",
    "build_service_guide_projection_bundle_from_handbook_flow_graph",
    "build_service_guide_projection_bundle_from_handbook_flow_graph_document_data",
    "build_service_guide_projection_bundle_from_source_truth_manifest",
    "load_service_guide_source_truth_manifest",
    "merge_service_guide_projection_build_results",
    "resolve_service_guide_source_truth_manifest_path",
    "validate_service_guide_projection_bundle",
    "write_service_guide_projection_release",
    "write_service_guide_projection_release_from_manifest_if_available",
    "write_service_guide_projection_release_from_source_truth_manifest",
]
