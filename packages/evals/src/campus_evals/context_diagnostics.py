from __future__ import annotations

import argparse
import json
from pathlib import Path

from campus_contracts import (
    CapabilityResponse,
    EvidenceBundle,
    EvidenceSource,
    KnowledgeScope,
    RagResultPayload,
)
from campus_shared import load_repo_env

from campus_evals.models import ExecutionResult, GoldenCase, ObservedTrace
from campus_evals.ragas_adapter import build_ragas_projection
from campus_evals.scenarios import (
    curriculum_error_gate_cases,
    curriculum_release_gate_cases,
    handbook_error_gate_cases,
    handbook_release_gate_cases,
)

CONTEXT_METRIC_NAMES = ("context_precision", "context_recall")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Render per-case context diagnostics from live benchmark artifacts."
    )
    parser.add_argument(
        "--case-results", required=True, help="Path to run-XX-case-results.json artifact."
    )
    parser.add_argument(
        "--scenario-set",
        required=True,
        choices=("curriculum_live_gate", "handbook_live_gate"),
        help="Scenario set used to resolve canonical GoldenCase truth.",
    )
    parser.add_argument(
        "--format",
        choices=("text", "json"),
        default="text",
        help="Render diagnostics as text or JSON.",
    )
    return parser


def build_context_diagnostics(
    *,
    case_results_payload: dict[str, object],
    scenario_set: str,
) -> dict[str, object]:
    case_index = {case.case_id: case for case in _scenario_cases(scenario_set)}
    diagnostics: list[dict[str, object]] = []

    for item in case_results_payload.get("results") or ():
        payload = dict(item)
        case_id = str(payload["case_id"])
        case = case_index.get(case_id)
        if case is None:
            raise ValueError(f"unknown case_id for scenario set {scenario_set}: {case_id}")

        observed_trace = _deserialize_observed_trace(payload.get("observed_trace"))
        artifact_scores = _artifact_metric_scores(payload)
        response_status = _response_status(payload, case=case)
        metric_applicability = {
            metric_name: _metric_applicable(case, metric_name)
            and case.expected_status == "completed"
            for metric_name in CONTEXT_METRIC_NAMES
        }

        diagnostics.append(
            {
                "case_id": case.case_id,
                "expected_status": case.expected_status,
                "response_status": response_status,
                "context_metric_applicability": metric_applicability,
                "artifact_scores": artifact_scores,
                "projection": _build_projection_diagnostic(
                    case,
                    observed_trace,
                    response_status=response_status,
                    metric_applicability=metric_applicability,
                ),
            }
        )

    return {
        "schema_version": 1,
        "scenario_set": scenario_set,
        "benchmark_type": str(case_results_payload.get("benchmark_type") or ""),
        "run_number": int(case_results_payload.get("run_number") or 0),
        "case_count": len(diagnostics),
        "cases": diagnostics,
    }


def render_context_diagnostics_text(diagnostics: dict[str, object]) -> str:
    lines = [
        "Context Diagnostics Summary",
        f"scenario_set: {diagnostics['scenario_set']}",
        f"run_number: {diagnostics['run_number']}",
        f"case_count: {diagnostics['case_count']}",
        "",
    ]
    for item in diagnostics["cases"]:
        lines.append(f"- {item['case_id']}")
        lines.append(
            "  "
            f"status={item['expected_status']} response_status={item['response_status']} "
            f"artifact_precision={item['artifact_scores']['context_precision']} "
            f"artifact_recall={item['artifact_scores']['context_recall']}"
        )
        projection = item["projection"]
        if projection is None:
            lines.append("  projection=n/a")
            continue
        lines.append(
            "  "
            f"route={projection['metric_route']} source={projection['projection_context_source']} "
            f"supporting={projection['supporting_source_count']} retrieved={projection['retrieved_source_count']}"
        )
        lines.append(
            "  "
            f"reference_ids={projection['reference_context_ids']} "
            f"retrieved_ids={projection['retrieved_context_ids']}"
        )
        lines.append(
            "  "
            f"missing={projection['missing_reference_context_ids']} "
            f"extra={projection['extra_retrieved_context_ids']}"
        )
    return "\n".join(lines)


def main(argv: list[str] | None = None) -> int:
    load_repo_env()
    args = build_parser().parse_args(argv)
    payload = json.loads(Path(args.case_results).read_text(encoding="utf-8"))
    diagnostics = build_context_diagnostics(
        case_results_payload=payload,
        scenario_set=args.scenario_set,
    )
    if args.format == "json":
        print(json.dumps(diagnostics, ensure_ascii=False, indent=2))
    else:
        print(render_context_diagnostics_text(diagnostics))
    return 0


def _scenario_cases(scenario_set: str) -> tuple[GoldenCase, ...]:
    if scenario_set == "curriculum_live_gate":
        return (*curriculum_release_gate_cases(), *curriculum_error_gate_cases())
    if scenario_set == "handbook_live_gate":
        return (*handbook_release_gate_cases(), *handbook_error_gate_cases())
    raise ValueError(f"unsupported scenario set: {scenario_set}")


def _artifact_metric_scores(payload: dict[str, object]) -> dict[str, float | None]:
    scores: dict[str, float | None] = dict.fromkeys(CONTEXT_METRIC_NAMES, None)
    for result in payload.get("supplemental_results") or ():
        item = dict(result)
        metric_name = str(item.get("metric_name") or "")
        if metric_name not in scores or str(item.get("adapter_id") or "") != "ragas":
            continue
        raw_score = item.get("score")
        scores[metric_name] = float(raw_score) if raw_score is not None else None
    return scores


def _response_status(payload: dict[str, object], *, case: GoldenCase) -> str:
    for result in payload.get("supplemental_results") or ():
        metadata = dict(dict(result).get("metadata") or {})
        response_status = str(metadata.get("response_status") or "").strip()
        if response_status:
            return response_status
    return case.expected_status


def _metric_applicable(case: GoldenCase, metric_name: str) -> bool:
    override = case.supplemental_metric_overrides.get(metric_name)
    if override is not None:
        return override
    return True


def _build_projection_diagnostic(
    case: GoldenCase,
    observed_trace: ObservedTrace | None,
    *,
    response_status: str,
    metric_applicability: dict[str, bool],
) -> dict[str, object] | None:
    if (
        observed_trace is None
        or response_status != "completed"
        or not any(metric_applicability.values())
    ):
        return None

    execution = ExecutionResult(
        response=CapabilityResponse(
            capability="knowledge",
            status="completed",
            answer_text="artifact replay answer",
            confidence="high",
            result=RagResultPayload(
                evidence=EvidenceBundle(
                    query_text=case.user_goal,
                    corpus=case.scope.corpus,
                    collection=case.scope.collection,
                    sources=observed_trace.supporting_sources,
                )
            ),
        ),
        observed_trace=observed_trace,
    )
    projection = build_ragas_projection(case, execution)
    retrieved_context_ids = _ordered_unique(projection.retrieved_context_ids)
    reference_context_ids = _ordered_unique(projection.reference_context_ids)
    retrieved_context_id_set = set(retrieved_context_ids)
    reference_context_id_set = set(reference_context_ids)
    return {
        "metric_route": _metric_route(projection),
        "projection_context_source": str(
            projection.metadata.get("projection_context_source") or ""
        ),
        "retrieved_context_count": len(projection.retrieved_contexts),
        "retrieved_context_ids": retrieved_context_ids,
        "reference_context_ids": reference_context_ids,
        "missing_reference_context_ids": sorted(
            reference_context_id_set - retrieved_context_id_set
        ),
        "extra_retrieved_context_ids": sorted(retrieved_context_id_set - reference_context_id_set),
        "retrieved_source_count": len(observed_trace.retrieved_sources),
        "supporting_source_count": len(observed_trace.supporting_sources),
        "retrieved_doc_ids": _ordered_unique(
            source.doc_id for source in observed_trace.retrieved_sources if source.doc_id
        ),
        "retrieved_canonical_source_ids": _ordered_unique(
            source.canonical_source_id
            for source in observed_trace.retrieved_sources
            if source.canonical_source_id
        ),
        "retrieved_source_unit_kinds": _ordered_unique(
            source.source_unit_kind
            for source in observed_trace.retrieved_sources
            if source.source_unit_kind
        ),
        "retrieved_source_unit_keys": _ordered_unique(
            source.source_unit_key
            for source in observed_trace.retrieved_sources
            if source.source_unit_key
        ),
        "retrieved_source_titles": [
            source.source_title
            for source in observed_trace.retrieved_sources
            if source.source_title
        ],
        "supporting_doc_ids": _ordered_unique(
            source.doc_id for source in observed_trace.supporting_sources if source.doc_id
        ),
        "supporting_canonical_source_ids": _ordered_unique(
            source.canonical_source_id
            for source in observed_trace.supporting_sources
            if source.canonical_source_id
        ),
        "supporting_source_unit_kinds": _ordered_unique(
            source.source_unit_kind
            for source in observed_trace.supporting_sources
            if source.source_unit_kind
        ),
        "supporting_source_unit_keys": _ordered_unique(
            source.source_unit_key
            for source in observed_trace.supporting_sources
            if source.source_unit_key
        ),
        "supporting_source_titles": [
            source.source_title
            for source in observed_trace.supporting_sources
            if source.source_title
        ],
    }


def _metric_route(projection) -> str:
    if projection.retrieved_context_ids and projection.reference_context_ids:
        return "id_based"
    if projection.retrieved_contexts and projection.reference_contexts:
        return "text_based"
    return "none"


def _ordered_unique(values) -> list[str]:
    seen: set[str] = set()
    ordered: list[str] = []
    for value in values:
        normalized = str(value).strip()
        if not normalized or normalized in seen:
            continue
        seen.add(normalized)
        ordered.append(normalized)
    return ordered


def _deserialize_observed_trace(payload: object) -> ObservedTrace | None:
    if not isinstance(payload, dict):
        return None
    selected_scope_payload = payload.get("selected_scope")
    selected_scope = None
    if isinstance(selected_scope_payload, dict):
        selected_scope = KnowledgeScope(
            corpus=str(selected_scope_payload.get("corpus") or ""),
            collection=str(selected_scope_payload.get("collection") or ""),
        )
    return ObservedTrace(
        selected_scope=selected_scope,
        retrieval_called=_deserialize_optional_bool(payload.get("retrieval_called")),
        clarification_emitted=_deserialize_optional_bool(payload.get("clarification_emitted")),
        error_path=_deserialize_optional_bool(payload.get("error_path")),
        retrieved_sources=_deserialize_evidence_sources(payload.get("retrieved_sources")),
        supporting_sources=_deserialize_evidence_sources(payload.get("supporting_sources")),
    )


def _deserialize_evidence_sources(payload: object) -> tuple[EvidenceSource, ...]:
    if not isinstance(payload, list):
        return ()
    return tuple(_deserialize_evidence_source(item) for item in payload if isinstance(item, dict))


def _deserialize_evidence_source(payload: dict[str, object]) -> EvidenceSource:
    structural_path = payload.get("structural_path")
    return EvidenceSource(
        doc_id=str(payload.get("doc_id") or ""),
        revision_track=str(payload.get("revision_track") or "source-faithful"),
        version_id=str(payload.get("version_id") or ""),
        chunk_id=str(payload.get("chunk_id") or ""),
        anchor=dict(payload.get("anchor") or {}),
        canonical_url=str(payload.get("canonical_url") or ""),
        latest_url=str(payload.get("latest_url") or ""),
        source_channel=str(payload.get("source_channel") or "pdf_ocr"),
        collection=str(payload.get("collection") or ""),
        is_current=bool(payload.get("is_current")),
        snippet=str(payload.get("snippet") or ""),
        score=float(payload.get("score") or 0.0),
        source_title=str(payload.get("source_title") or ""),
        structural_path=tuple(str(item) for item in structural_path)
        if isinstance(structural_path, list)
        else (),
        content_kind=str(payload.get("content_kind") or ""),
        content_role=str(payload.get("content_role") or ""),
        detail_label=str(payload.get("detail_label") or ""),
        is_answer_bearing=bool(payload.get("is_answer_bearing")),
        canonical_source_id=str(payload.get("canonical_source_id") or ""),
        canonical_source_title=str(payload.get("canonical_source_title") or ""),
        source_unit_kind=str(payload.get("source_unit_kind") or ""),
        source_unit_key=str(payload.get("source_unit_key") or ""),
    )


def _deserialize_optional_bool(value: object) -> bool | None:
    if value is None:
        return None
    return bool(value)


if __name__ == "__main__":
    raise SystemExit(main())
