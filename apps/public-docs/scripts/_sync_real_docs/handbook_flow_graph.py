from __future__ import annotations

import json
import re
from collections.abc import Iterator, Mapping
from pathlib import Path
from typing import Any

from .course_map import _build_course_map_data_import_name, _build_course_map_data_module
from .shared import (
    HANDBOOK_SOURCE_PROJECTIONS_PATH,
    HANDBOOK_YEAR,
    SOURCE_BUCKET,
    HandbookFlowGraphDoc,
    _json_string,
    _remove_stale_generated_files,
    _write_text,
)
from .storage import _list_object_keys, _read_optional_bytes_object

_FLOW_GRAPH_FILENAME = "flow-graph.json"
_FLOW_GRAPH_SCHEMA_VERSION = "handbook_service_navigation_projection_v1"
_FLOW_GRAPH_DOC_COMPONENT_IMPORT_PATH = "../.components/HandbookFlowGraphSection"
_FLOW_GRAPH_PROJECTION_KEY_SUFFIX = f"/projection/{{projection_name}}/{_FLOW_GRAPH_FILENAME}"
_HANDBOOK_FLOW_GRAPH_DOC_SLUG_OVERRIDES = {
    "handbook_navigation_service_catalog": "central-minzu-student-dormitory-management-workflow",
}


def _sync_handbook_flow_graph_artifacts(
    client,
    *,
    docs_root: Path,
) -> tuple[HandbookFlowGraphDoc, ...]:
    generated_dir = docs_root / ".generated" / "handbook-flow-graphs"
    target_dir = docs_root / "student-handbook"
    generated_dir.mkdir(parents=True, exist_ok=True)
    target_dir.mkdir(parents=True, exist_ok=True)

    generated_docs: list[HandbookFlowGraphDoc] = []
    expected_data_files: set[str] = set()
    for projection in _load_handbook_flow_graph_projection_configs():
        projection_name = _require_text(projection, "projection_name")
        flow_graph_key = _find_handbook_flow_graph_object_key(
            client,
            projection_name=projection_name,
        )
        if flow_graph_key is None:
            continue
        raw_bytes = _read_optional_bytes_object(
            client=client,
            key=flow_graph_key,
            bucket=SOURCE_BUCKET,
        )
        if raw_bytes is None:
            continue

        payload = json.loads(raw_bytes.decode("utf-8"))
        _validate_handbook_flow_graph_payload(payload, projection=projection)

        title = _require_text(projection, "target_title")
        slug = _build_handbook_flow_graph_doc_slug(projection=projection)
        data_module_name = f"{slug}.data.ts"
        data_import_name = _build_course_map_data_import_name(slug)
        data_import_path = f"../.generated/handbook-flow-graphs/{slug}.data"
        _write_text(
            generated_dir / data_module_name,
            _build_course_map_data_module(
                _build_handbook_flow_graph_data_payload(payload),
                biome_file_path=(
                    f"apps/public-docs/docs/.generated/handbook-flow-graphs/{data_module_name}"
                ),
            ),
        )
        _write_text(
            target_dir / f"{slug}.mdx",
            _build_handbook_flow_graph_markdown(
                title=title,
                data_import_name=data_import_name,
                data_import_path=data_import_path,
            ),
        )
        expected_data_files.add(data_module_name)
        generated_docs.append(
            HandbookFlowGraphDoc(
                slug=slug,
                title=title,
                filename=f"{slug}.mdx",
            )
        )

    _remove_stale_generated_files(generated_dir, expected_names=expected_data_files)
    return tuple(generated_docs)


def _load_handbook_flow_graph_projection_configs() -> tuple[Mapping[str, Any], ...]:
    payload = json.loads(HANDBOOK_SOURCE_PROJECTIONS_PATH.read_text(encoding="utf-8"))
    projections: list[Mapping[str, Any]] = []
    for projection in payload.get("projections") or ():
        if not isinstance(projection, Mapping):
            continue
        if projection.get("attachment_role") != "service_navigation_document":
            continue
        if projection.get("target_collection") != "service_catalog":
            continue
        projections.append(projection)
    return tuple(projections)


def _find_handbook_flow_graph_object_key(
    client,
    *,
    projection_name: str,
) -> str | None:
    suffix = _FLOW_GRAPH_PROJECTION_KEY_SUFFIX.format(projection_name=projection_name)
    prefixes = (
        f"official_pdf/student-handbook/{HANDBOOK_YEAR}/",
        "official_pdf/student-handbook/",
    )
    for prefix in prefixes:
        candidates = [
            key
            for key in _list_object_keys(client, prefix=prefix, bucket=SOURCE_BUCKET)
            if key.endswith(suffix)
        ]
        if candidates:
            return sorted(candidates)[-1]
    return None


def _validate_handbook_flow_graph_payload(
    payload: Mapping[str, Any],
    *,
    projection: Mapping[str, Any],
) -> None:
    projection_name = _require_text(projection, "projection_name")
    target_title = _require_text(projection, "target_title")
    source_page_start = _require_int(projection, "source_page_start")
    source_page_end = _require_int(projection, "source_page_end")
    if payload.get("schema_version") != _FLOW_GRAPH_SCHEMA_VERSION:
        raise ValueError(
            f"{projection_name} flow graph schema mismatch: {payload.get('schema_version')!r}"
        )
    if payload.get("projection_name") != projection_name:
        raise ValueError(
            f"{projection_name} flow graph projection mismatch: {payload.get('projection_name')!r}"
        )
    if payload.get("target_title") != target_title:
        raise ValueError(
            f"{projection_name} flow graph target_title mismatch: {payload.get('target_title')!r}"
        )
    if _require_int(payload, "source_page_start") != source_page_start:
        raise ValueError(f"{projection_name} flow graph source_page_start mismatch")
    if _require_int(payload, "source_page_end") != source_page_end:
        raise ValueError(f"{projection_name} flow graph source_page_end mismatch")
    flow_graph = payload.get("flow_graph")
    if not isinstance(flow_graph, Mapping):
        raise ValueError(f"{projection_name} flow_graph object is required")
    if flow_graph.get("document_title") != target_title:
        raise ValueError(f"{projection_name} flow_graph document_title mismatch")
    if not tuple(_iter_body_bearing_flow_steps(flow_graph)):
        raise ValueError(f"{projection_name} flow graph has no body-bearing steps")


def _build_handbook_flow_graph_doc_slug(*, projection: Mapping[str, Any]) -> str:
    projection_name = _require_text(projection, "projection_name")
    override = _HANDBOOK_FLOW_GRAPH_DOC_SLUG_OVERRIDES.get(projection_name)
    if override:
        return override
    title = _require_text(projection, "target_title")
    slug = re.sub(r"[_\W]+", "-", title, flags=re.UNICODE).strip("-")
    return slug or projection_name


def _build_handbook_flow_graph_data_payload(payload: Mapping[str, Any]) -> dict[str, object]:
    flow_graph = _require_mapping(payload, "flow_graph")
    manual_review_required = bool(flow_graph.get("global_manual_review_required"))
    page_findings: list[dict[str, object]] = []
    for page in flow_graph.get("page_findings") or ():
        if not isinstance(page, Mapping):
            continue
        flows = _build_handbook_flow_payloads(page)
        if not flows:
            continue
        page_findings.append(
            {
                "sourcePage": _require_int(page, "source_page"),
                "pageHeading": str(page.get("page_heading") or "").strip(),
                "flows": flows,
            }
        )
    return {
        "title": _require_text(payload, "target_title"),
        "sourceHandbookSection": _require_text(payload, "source_handbook_section"),
        "sourcePageStart": _require_int(payload, "source_page_start"),
        "sourcePageEnd": _require_int(payload, "source_page_end"),
        "manualReviewRequired": manual_review_required,
        "extractionStatus": "needs_review" if manual_review_required else "ready",
        "pageFindings": page_findings,
    }


def _build_handbook_flow_payloads(page: Mapping[str, Any]) -> list[dict[str, object]]:
    flows: list[dict[str, object]] = []
    for flow in page.get("flows") or ():
        if not isinstance(flow, Mapping):
            continue
        steps = _build_handbook_flow_step_payloads(flow)
        if not steps:
            continue
        flows.append(
            {
                "flowHeading": str(flow.get("flow_heading") or "未命名流程").strip(),
                "audienceScope": str(flow.get("audience_scope") or "").strip(),
                "steps": steps,
                "manualReviewNotes": [
                    str(note).strip()
                    for note in flow.get("manual_review_notes") or ()
                    if str(note).strip()
                ],
            }
        )
    return flows


def _build_handbook_flow_step_payloads(flow: Mapping[str, Any]) -> list[dict[str, object]]:
    steps: list[dict[str, object]] = []
    for step in flow.get("steps") or ():
        if not isinstance(step, Mapping):
            continue
        step_text = str(step.get("step_text") or "").strip()
        if not step_text:
            continue
        steps.append(
            {
                "stepId": str(step.get("step_id") or "").strip(),
                "stepText": step_text,
                "nextStepIds": [
                    str(step_id).strip()
                    for step_id in step.get("next_step_ids") or ()
                    if str(step_id).strip()
                ],
            }
        )
    return steps


def _build_handbook_flow_graph_markdown(
    *,
    title: str,
    data_import_name: str,
    data_import_path: str,
) -> str:
    return "\n".join(
        [
            "---",
            f"title: {_json_string(title)}",
            "description: 学生手册中服务流程图的结构化阅读页。",
            "footer: false",
            "---",
            "",
            f'import HandbookFlowGraphSection from "{_FLOW_GRAPH_DOC_COMPONENT_IMPORT_PATH}";',
            f'import {data_import_name} from "{data_import_path}";',
            "",
            f"<HandbookFlowGraphSection data={{{data_import_name}}} />",
            "",
        ]
    )


def _iter_body_bearing_flow_steps(flow_graph: Mapping[str, Any]) -> Iterator[Mapping[str, Any]]:
    for page in flow_graph.get("page_findings") or ():
        if not isinstance(page, Mapping):
            continue
        for flow in page.get("flows") or ():
            if not isinstance(flow, Mapping):
                continue
            for step in flow.get("steps") or ():
                if isinstance(step, Mapping) and str(step.get("step_text") or "").strip():
                    yield step


def _require_mapping(payload: Mapping[str, Any], field_name: str) -> Mapping[str, Any]:
    value = payload.get(field_name)
    if not isinstance(value, Mapping):
        raise ValueError(f"{field_name} object is required")
    return value


def _require_text(payload: Mapping[str, Any], field_name: str) -> str:
    value = str(payload.get(field_name) or "").strip()
    if not value:
        raise ValueError(f"{field_name} is required")
    return value


def _require_int(payload: Mapping[str, Any], field_name: str) -> int:
    value = payload.get(field_name)
    if isinstance(value, bool):
        raise ValueError(f"{field_name} must be an integer")
    try:
        return int(value)
    except (TypeError, ValueError) as exc:
        raise ValueError(f"{field_name} must be an integer") from exc
