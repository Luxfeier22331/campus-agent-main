from __future__ import annotations

import hashlib
import json
from dataclasses import asdict
from typing import TYPE_CHECKING

from campus_contracts import DEFAULT_POLICY_PROJECTION_VERSION

from campus_ingestion_core.campusrag_ingestion_artifacts import ProcessedArtifactInput
from campus_ingestion_core.campusrag_ingestion_support import DocumentImportInput
from campus_ingestion_core.models import RawAssetRecord
from campus_ingestion_core.object_store import infer_year_label

if TYPE_CHECKING:
    from campus_ingestion_core.handbook_service_navigation_hybrid_materialization import (
        ServiceNavigationFlowGraph,
    )


def _build_handbook_service_navigation_hybrid_document_from_projection_bytes(
    *,
    projection_artifact_bytes: bytes,
    projection_artifact_key: str,
    raw_asset_record: RawAssetRecord,
    source_document_id: str,
    source_uri: str,
    source_handbook_section: str,
    target_document_id: str,
    target_title: str,
    projection_name: str,
    derived_from: str,
    parent_document_id: str,
    attachment_kind: str | None,
    attachment_role: str | None,
    provider_response_key: str,
    layout_elements_key: str,
    source_page_start: int,
    source_page_end: int,
    entitlement_groups: tuple[str, ...],
    visibility_scope: str | None,
    visibility_level: str,
    import_source: str,
    additional_processed_artifacts: tuple[ProcessedArtifactInput, ...],
) -> DocumentImportInput:
    projection_artifact = _load_projection_artifact(projection_artifact_bytes)
    _validate_projection_artifact(
        projection_artifact=projection_artifact,
        raw_asset_record=raw_asset_record,
        source_document_id=source_document_id,
        target_document_id=target_document_id,
        target_title=target_title,
        projection_name=projection_name,
        source_page_start=source_page_start,
        source_page_end=source_page_end,
    )
    flow_graph = projection_artifact["flow_graph"]
    version_seed = json.dumps(
        asdict(flow_graph), ensure_ascii=False, separators=(",", ":"), sort_keys=True
    )
    version_id = f"flow-graph:{hashlib.sha1(version_seed.encode('utf-8')).hexdigest()}"
    canonical_markdown = _render_canonical_markdown(
        metadata={
            "schema_version": 1,
            "doc_id": target_document_id,
            "corpus": "campus_services",
            "collection": "service_catalog",
            "title": target_title,
            "source_kind": "handbook_service_navigation_hybrid_projection",
            "source_doc": raw_asset_record.source_filename,
            "handbook_section": source_handbook_section,
            "page_start": source_page_start,
            "page_end": source_page_end,
            "projection_name": projection_name,
            "derived_from": derived_from,
            "derived_from_document_id": source_document_id,
            "derived_from_raw_asset_id": raw_asset_record.raw_asset_id,
            "derived_from_raw_version_id": raw_asset_record.raw_version_id,
            "parent_document_id": parent_document_id,
            "attachment_kind": attachment_kind,
            "attachment_role": attachment_role,
            "migration_source_provider_response_key": provider_response_key,
            "projection_artifact_key": projection_artifact_key,
        },
        body=_render_flow_graph_markdown(flow_graph),
    )
    document_units_bytes = _build_document_units_bytes(
        flow_graph=flow_graph,
        target_document_id=target_document_id,
        version_id=version_id,
        target_title=target_title,
        source_document_id=source_document_id,
        source_uri=source_uri,
        source_pdf=raw_asset_record.source_filename,
        projection_name=projection_name,
        derived_from=derived_from,
        parent_document_id=parent_document_id,
        raw_asset_record=raw_asset_record,
        attachment_kind=attachment_kind,
        attachment_role=attachment_role,
        provider_response_key=provider_response_key,
        source_page_start=source_page_start,
        source_page_end=source_page_end,
        entitlement_groups=entitlement_groups,
        visibility_scope=visibility_scope,
        visibility_level=visibility_level,
    )
    return DocumentImportInput(
        source_label=f"{provider_response_key}#{projection_name}",
        document_units_bytes=document_units_bytes,
        provider_response_bytes=None,
        canonical_markdown_bytes=canonical_markdown.encode("utf-8"),
        metadata={
            "document_id": target_document_id,
            "version_id": version_id,
            "title": target_title,
            "entitlement_groups": list(entitlement_groups),
            "visibility_scope": visibility_scope,
            "visibility_level": visibility_level,
        },
        import_source=import_source,
        revision_track="source-faithful",
        source_channel="pdf_ocr",
        is_current=False,
        corpus="campus_services",
        collection="service_catalog",
        visibility_scope=visibility_scope,
        status="active",
        raw_source_uri=raw_asset_record.raw_source_uri,
        raw_asset_id=raw_asset_record.raw_asset_id,
        raw_version_id=raw_asset_record.raw_version_id,
        provider_response_object_key=provider_response_key,
        additional_processed_object_keys=(layout_elements_key, projection_artifact_key),
        additional_processed_artifacts=additional_processed_artifacts,
        title=target_title,
        year=infer_year_label(raw_asset_record.source_filename),
    )


def _build_document_units_bytes(
    *,
    flow_graph: ServiceNavigationFlowGraph,
    target_document_id: str,
    version_id: str,
    target_title: str,
    source_document_id: str,
    source_uri: str,
    source_pdf: str,
    projection_name: str,
    derived_from: str,
    parent_document_id: str,
    raw_asset_record: RawAssetRecord,
    attachment_kind: str | None,
    attachment_role: str | None,
    provider_response_key: str,
    source_page_start: int,
    source_page_end: int,
    entitlement_groups: tuple[str, ...],
    visibility_scope: str | None,
    visibility_level: str,
) -> bytes:
    rows: list[dict[str, object]] = []
    chunk_index = 0
    for page_finding in flow_graph.page_findings:
        for flow in page_finding.flows:
            if not flow.steps:
                continue
            chunk_index += 1
            chunk_id = f"flow-{chunk_index:04d}"
            flow_lines = [
                f"流程标题：{flow.flow_heading}",
                f"页面标题：{page_finding.page_heading}",
            ]
            if flow.audience_scope.strip():
                flow_lines.append(f"适用对象：{flow.audience_scope}")
            flow_lines.append("步骤：")
            for step_index, step in enumerate(flow.steps, start=1):
                next_text = (
                    "；下一步：" + ", ".join(step.next_step_ids) if step.next_step_ids else ""
                )
                flow_lines.append(f"{step_index}. [{step.step_id}] {step.step_text}{next_text}")
            for note in flow.manual_review_notes:
                flow_lines.append(f"人工复核：{note}")
            rows.append(
                {
                    "doc_id": target_document_id,
                    "version_id": version_id,
                    "chunk_id": chunk_id,
                    "root_unit_id": chunk_id,
                    "unit_type": "section_text",
                    "clean_text": "\n".join(flow_lines),
                    "source_pdf": source_pdf,
                    "source_url": source_uri,
                    "source_md": None,
                    "source": {"id": source_uri},
                    "page_start": page_finding.source_page,
                    "page_end": page_finding.source_page,
                    "anchor": {
                        "page_start": page_finding.source_page,
                        "page_end": page_finding.source_page,
                        "section_path": [target_title, flow.flow_heading],
                    },
                    "metadata": {
                        "title": target_title,
                        "page_heading": page_finding.page_heading,
                        "flow_heading": flow.flow_heading,
                        "audience_scope": flow.audience_scope,
                        "document_nature": "service_navigation_flow",
                        "projection_name": projection_name,
                        "derived_from": derived_from,
                        "derived_from_document_id": source_document_id,
                        "derived_from_raw_asset_id": raw_asset_record.raw_asset_id,
                        "derived_from_raw_version_id": raw_asset_record.raw_version_id,
                        "parent_document_id": parent_document_id,
                        "attachment_kind": attachment_kind,
                        "attachment_role": attachment_role,
                        "migration_source_provider_response_key": provider_response_key,
                        "source_page_start": source_page_start,
                        "source_page_end": source_page_end,
                        "manual_review_required": bool(flow.manual_review_notes),
                        "step_count": len(flow.steps),
                        "source_url": source_uri,
                    },
                    "entitlement_groups": list(entitlement_groups),
                    "visibility_scope": visibility_scope,
                    "visibility_level": visibility_level,
                    "policy_projection_version": DEFAULT_POLICY_PROJECTION_VERSION,
                }
            )
    return ("\n".join(json.dumps(row, ensure_ascii=False) for row in rows) + "\n").encode("utf-8")


def _load_projection_artifact(payload_bytes: bytes) -> dict[str, object]:
    from campus_ingestion_core.handbook_service_navigation_hybrid_materialization import (
        HANDOOK_SERVICE_NAVIGATION_PROJECTION_SCHEMA_VERSION,
        _coerce_flow_graph,
    )

    payload = json.loads(payload_bytes)
    if not isinstance(payload, dict):
        raise ValueError("handbook service navigation projection artifact must be a JSON object")
    schema_version = str(payload.get("schema_version") or "").strip()
    if schema_version != HANDOOK_SERVICE_NAVIGATION_PROJECTION_SCHEMA_VERSION:
        raise ValueError(
            "unsupported handbook service navigation projection artifact schema_version: "
            f"{schema_version!r}"
        )
    artifact = {
        "projection_name": str(payload.get("projection_name") or "").strip(),
        "raw_asset_id": str(payload.get("raw_asset_id") or "").strip(),
        "raw_version_id": str(payload.get("raw_version_id") or "").strip(),
        "source_document_id": str(payload.get("source_document_id") or "").strip(),
        "source_uri": str(payload.get("source_uri") or "").strip(),
        "source_handbook_section": str(payload.get("source_handbook_section") or "").strip(),
        "source_page_start": int(payload.get("source_page_start") or 0),
        "source_page_end": int(payload.get("source_page_end") or 0),
        "target_document_id": str(payload.get("target_document_id") or "").strip(),
        "target_title": str(payload.get("target_title") or "").strip(),
        "extractor_runtime": dict(payload.get("extractor_runtime") or {}),
        "flow_graph": _coerce_flow_graph(payload.get("flow_graph")),
    }
    if not artifact["projection_name"]:
        raise ValueError(
            "handbook service navigation projection artifact projection_name is required"
        )
    if not artifact["raw_asset_id"] or not artifact["raw_version_id"]:
        raise ValueError("handbook service navigation projection artifact raw identity is required")
    if not artifact["source_document_id"]:
        raise ValueError(
            "handbook service navigation projection artifact source_document_id is required"
        )
    if not artifact["target_document_id"] or not artifact["target_title"]:
        raise ValueError(
            "handbook service navigation projection artifact target identity is required"
        )
    return artifact


def _validate_projection_artifact(
    *,
    projection_artifact: dict[str, object],
    raw_asset_record: RawAssetRecord,
    source_document_id: str,
    target_document_id: str,
    target_title: str,
    projection_name: str,
    source_page_start: int,
    source_page_end: int,
) -> None:
    expected_pairs = {
        "projection_name": projection_name,
        "raw_asset_id": raw_asset_record.raw_asset_id,
        "raw_version_id": raw_asset_record.raw_version_id,
        "source_document_id": source_document_id,
        "target_document_id": target_document_id,
        "target_title": target_title,
        "source_page_start": source_page_start,
        "source_page_end": source_page_end,
    }
    for key, expected in expected_pairs.items():
        actual = projection_artifact.get(key)
        if actual != expected:
            raise ValueError(
                "handbook service navigation projection artifact mismatch: "
                f"{key} expected {expected!r}, got {actual!r}"
            )


def _resolve_projection_extractor_runtime(source: dict[str, str]) -> dict[str, str]:
    from campus_ingestion_core.handbook_service_navigation_hybrid_materialization import (
        DEFAULT_PROMPT_RUNTIME_BASE_URL,
    )

    base_url = (
        source.get("PROMPT_RUNTIME_BASE_URL")
        or source.get("LLM_BASE_URL")
        or DEFAULT_PROMPT_RUNTIME_BASE_URL
    ).strip()
    model_name = (source.get("PROMPT_RUNTIME_MODEL") or "").strip()
    reasoning_effort = (source.get("PROMPT_RUNTIME_REASONING_EFFORT") or "").strip()
    runtime = {
        "kind": "prompt_runtime",
        "base_url": base_url,
        "model": model_name,
    }
    if reasoning_effort:
        runtime["reasoning_effort"] = reasoning_effort
    return runtime


def _render_flow_graph_markdown(flow_graph: ServiceNavigationFlowGraph) -> str:
    lines: list[str] = [f"# {flow_graph.document_title}", ""]
    for page_finding in flow_graph.page_findings:
        lines.append(f"## 第 {page_finding.source_page} 页 {page_finding.page_heading}")
        lines.append("")
        if not page_finding.flows:
            lines.append("本页未识别到可消费流程节点。")
            lines.append("")
            continue
        for flow in page_finding.flows:
            lines.append(f"### {flow.flow_heading}")
            if flow.audience_scope.strip():
                lines.append(f"- 适用对象：{flow.audience_scope}")
            for index, step in enumerate(flow.steps, start=1):
                next_text = f" -> {', '.join(step.next_step_ids)}" if step.next_step_ids else ""
                lines.append(f"{index}. [{step.step_id}] {step.step_text}{next_text}")
            for note in flow.manual_review_notes:
                lines.append(f"- 人工复核：{note}")
            lines.append("")
    if flow_graph.global_manual_review_required:
        lines.append("## 人工复核")
        lines.append("")
        lines.append("当前结果包含需人工复核的局部节点或连线。")
        lines.append("")
    return "\n".join(lines).rstrip()


def _render_canonical_markdown(*, metadata: dict[str, object], body: str) -> str:
    lines = ["---"]
    for key, value in metadata.items():
        if value is None or value == "":
            continue
        lines.append(f"{key}: {_format_front_matter_value(value)}")
    lines.extend(["---", "", body.rstrip(), ""])
    return "\n".join(lines)


def _format_front_matter_value(value: object) -> str:
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, (int, float)):
        return str(value)
    if isinstance(value, (list, dict)):
        return json.dumps(value, ensure_ascii=False, separators=(",", ":"))
    text = str(value)
    if not text:
        return '""'
    if any(ch in text for ch in ["#", "[", "]", "{", "}", ","]) or text != text.strip():
        return json.dumps(text, ensure_ascii=False)
    return text
