from __future__ import annotations

import argparse
import json
from collections.abc import Callable, Mapping
from pathlib import Path
from typing import Any

from campus_contracts import AgentResponse, EvidenceBundle, RagResultPayload
from campus_rag_agent import RagAgent
from campus_retrieval_core import build_retrieval_backend
from campus_shared import load_repo_env

from campus_evals.benchmark import RetrievalQrelsCase, load_retrieval_qrels_dataset
from campus_evals.ragas_adapter import build_ragas_scorer
from campus_evals.ragas_adapter_projection import RagasProjection
from campus_evals.settings import RagasSettings
from campus_evals.retrieval_live_benchmark import _build_retrieval_request

RAGAS_DIAGNOSTIC_REPORT_SCHEMA_VERSION = "ragas-diagnostic-report.v1"
RAGAS_DIAGNOSTIC_SAMPLE_MANIFEST_SCHEMA_VERSION = "ragas-diagnostic-sample-manifest.v1"
DEFAULT_RAGAS_DIAGNOSTIC_SAMPLE_LIMIT_PER_SURFACE = 12
DEFAULT_RAGAS_DIAGNOSTIC_TOP_K = 5
DEFAULT_RAGAS_DIAGNOSTIC_METRIC_NAMES = (
    "faithfulness",
    "answer_relevancy",
    "context_precision",
    "context_recall",
)

_SURFACE_QRELS_FIXTURES = {
    "regulations/student_rules": "student_handbook_retrieval_qrels.json",
    "regulations/institutional_rules": "institutional_rules_retrieval_qrels.json",
    "curriculum/curriculum_plan": "curriculum_plan_retrieval_qrels.json",
}

_PREFERRED_CASE_IDS = {
    "regulations/student_rules": (
        "policy-title-scholarship",
        "policy-alias-national-scholarship-article-nine",
        "semantic-scholarship-eligibility",
        "short-fact-attendance-discipline-threshold",
        "semantic-disciplinary-relief",
        "policy-title-recommend-postgraduate-exemption",
        "semantic-study-abroad-management",
        "semantic-innovation-education-credit",
        "policy-title-temporary-hardship-subsidy",
        "policy-title-national-grant",
        "policy-title-student-aid-management",
        "policy-title-funded-student-public-service",
    ),
    "regulations/institutional_rules": (
        "institutional-title-exact-ff711d1185f9",
        "institutional-title-exact-81401d3a02d6",
        "institutional-title-exact-7da72ac3d796",
        "institutional-title-exact-40d4d65809c5",
        "institutional-title-exact-e593d7a51e16",
        "institutional-title-exact-ccd8fad3cd06",
        "institutional-title-exact-580644ffc701",
        "institutional-title-exact-6ad2032144d0",
        "institutional-title-exact-a7716c82cbe1",
        "institutional-title-exact-eb3f2445780f",
        "institutional-title-exact-3c69a0dd5d82",
        "institutional-title-exact-f2860d036974",
    ),
    "curriculum/curriculum_plan": (
        "ethnology-plan-title",
        "history-strong-base-title",
        "digital-economy-plan-paraphrase",
        "ethnology-second-degree-academic-years",
        "ethnology-total-credits",
        "economics-course-settings-table",
        "general-english-total-credits",
        "hanyu-international-students-total-credits",
        "law-ethnic-class-fourth-semester-courses",
        "semantic-philosophy-strong-base-paraphrase",
        "curriculum-title-general-chinese-culture",
        "curriculum-title-social-practice",
    ),
}


def build_ragas_diagnostic_sample_manifest(
    *,
    sample_limit_per_surface: int = DEFAULT_RAGAS_DIAGNOSTIC_SAMPLE_LIMIT_PER_SURFACE,
    repo_root: str | Path | None = None,
) -> dict[str, object]:
    if sample_limit_per_surface <= 0:
        raise ValueError("sample_limit_per_surface must be greater than zero")
    root = Path(repo_root) if repo_root is not None else Path(__file__).resolve().parents[4]
    cases: list[dict[str, object]] = []
    for surface_key in _SURFACE_QRELS_FIXTURES:
        dataset = load_retrieval_qrels_dataset(_qrels_path(root=root, surface_key=surface_key))
        by_case_id = {case.case_id: case for case in dataset.cases}
        selected = [
            by_case_id[case_id]
            for case_id in _PREFERRED_CASE_IDS[surface_key]
            if case_id in by_case_id
        ][:sample_limit_per_surface]
        cases.extend(_manifest_case(surface_key=surface_key, case=case) for case in selected)
    return {
        "schema_version": RAGAS_DIAGNOSTIC_SAMPLE_MANIFEST_SCHEMA_VERSION,
        "sample_limit_per_surface": sample_limit_per_surface,
        "metric_names": list(DEFAULT_RAGAS_DIAGNOSTIC_METRIC_NAMES),
        "cases": cases,
    }


def run_ragas_diagnostic(
    *,
    backend: object,
    scorer: Callable[[RagasProjection], Mapping[str, float | None]],
    sample_limit_per_surface: int = DEFAULT_RAGAS_DIAGNOSTIC_SAMPLE_LIMIT_PER_SURFACE,
    top_k: int = DEFAULT_RAGAS_DIAGNOSTIC_TOP_K,
    repo_root: str | Path | None = None,
) -> dict[str, object]:
    root = Path(repo_root) if repo_root is not None else Path(__file__).resolve().parents[4]
    manifest = build_ragas_diagnostic_sample_manifest(
        sample_limit_per_surface=sample_limit_per_surface,
        repo_root=root,
    )
    case_specs = tuple(dict(item) for item in manifest["cases"] if isinstance(item, dict))
    results: list[dict[str, object]] = []
    for case_spec in case_specs:
        surface_key = str(case_spec["surface_key"])
        case = _load_case(root=root, surface_key=surface_key, case_id=str(case_spec["case_id"]))
        try:
            projection = _build_projection(case=case, backend=backend, top_k=top_k)
            scores = dict(scorer(projection))
            results.append(_passed_case_result(case_spec=case_spec, projection=projection, scores=scores))
        except Exception as exc:
            results.append(_failed_case_result(case_spec=case_spec, exc=exc))
    summary = _summarize_results(results)
    return {
        "schema_version": RAGAS_DIAGNOSTIC_REPORT_SCHEMA_VERSION,
        "report_id": "ragas_diagnostic",
        "passed": summary["failed_cases"] == 0,
        "mode": "diagnostic_non_blocking",
        "sample_manifest": manifest,
        "summary": summary,
        "cases": results,
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Run small-sample RAGAS diagnostics for core RAG.")
    parser.add_argument("--output-dir", required=True)
    parser.add_argument(
        "--sample-limit-per-surface",
        type=int,
        default=DEFAULT_RAGAS_DIAGNOSTIC_SAMPLE_LIMIT_PER_SURFACE,
    )
    parser.add_argument("--top-k", type=int, default=DEFAULT_RAGAS_DIAGNOSTIC_TOP_K)
    parser.add_argument(
        "--fake-scorer",
        action="store_true",
        help="Use deterministic fake scores for tests and dry wiring checks.",
    )
    args = parser.parse_args(argv)

    load_repo_env()
    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    manifest = build_ragas_diagnostic_sample_manifest(
        sample_limit_per_surface=args.sample_limit_per_surface
    )
    (output_dir / "sample-manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    backend = build_retrieval_backend()
    scorer = _fake_scorer if args.fake_scorer else _build_live_scorer()
    report = run_ragas_diagnostic(
        backend=backend,
        scorer=scorer,
        sample_limit_per_surface=args.sample_limit_per_surface,
        top_k=args.top_k,
    )
    (output_dir / "ragas-diagnostic.current.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    (output_dir / "ragas-diagnostic.summary.json").write_text(
        json.dumps(report["summary"], ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(json.dumps(report["summary"], ensure_ascii=False, indent=2))
    return 0 if report["passed"] else 1


def _build_projection(*, case: RetrievalQrelsCase, backend: object, top_k: int) -> RagasProjection:
    request = _build_retrieval_request(case=case, default_top_k=top_k)
    bundle = backend.retrieve(request)
    draft = RagAgent().build_answer(bundle)
    response = AgentResponse(
        target="rag-agent",
        status="completed",
        answer_text=draft.answer_text,
        confidence="medium",
        result=RagResultPayload(evidence=bundle),
    )
    reference = _reference_for_case(case)
    context_ids = tuple(_source_projection_id(source) for source in draft.supporting_sources)
    return RagasProjection(
        case_id=case.case_id,
        user_input=case.query,
        response=response.answer_text,
        retrieved_contexts=draft.supporting_contexts
        or tuple(source.snippet for source in draft.supporting_sources),
        reference=reference,
        retrieved_context_ids=context_ids,
        reference_context_ids=tuple(source.doc_id for source in case.expected_sources),
        reference_contexts=tuple(source.rationale for source in case.expected_sources if source.rationale),
        metadata={
            "corpus": case.scope.corpus,
            "collection": case.scope.collection,
            "expected_doc_ids": [source.doc_id for source in case.expected_sources],
            "retrieved_doc_ids": [source.doc_id for source in bundle.sources],
            "supporting_doc_ids": [source.doc_id for source in draft.supporting_sources],
        },
    )


def _build_live_scorer() -> Callable[[RagasProjection], Mapping[str, float | None]]:
    settings = RagasSettings.from_env()
    scorer = build_ragas_scorer(
        settings,
        metric_names=DEFAULT_RAGAS_DIAGNOSTIC_METRIC_NAMES,
    )

    def _score(projection: RagasProjection) -> Mapping[str, float | None]:
        return {result.metric_name: result.score for result in scorer(projection)}

    return _score


def _fake_scorer(projection: RagasProjection) -> Mapping[str, float]:
    del projection
    return {
        "faithfulness": 1.0,
        "answer_relevancy": 1.0,
        "context_precision": 1.0,
        "context_recall": 1.0,
    }


def _manifest_case(*, surface_key: str, case: RetrievalQrelsCase) -> dict[str, object]:
    return {
        "surface_key": surface_key,
        "case_id": case.case_id,
        "split": case.split,
        "query": case.query,
        "expected_doc_ids": [source.doc_id for source in case.expected_sources],
        "forbidden_doc_ids": [source.doc_id for source in case.forbidden_sources],
    }


def _passed_case_result(
    *,
    case_spec: dict[str, object],
    projection: RagasProjection,
    scores: Mapping[str, float | None],
) -> dict[str, object]:
    return {
        **case_spec,
        "status": "completed",
        "answer_text": projection.response,
        "retrieved_context_count": len(projection.retrieved_contexts),
        "retrieved_context_ids": list(projection.retrieved_context_ids),
        "scores": {name: scores.get(name) for name in DEFAULT_RAGAS_DIAGNOSTIC_METRIC_NAMES},
    }


def _failed_case_result(*, case_spec: dict[str, object], exc: Exception) -> dict[str, object]:
    return {
        **case_spec,
        "status": "failed",
        "error_type": type(exc).__name__,
        "error_message": str(exc),
        "scores": {},
    }


def _summarize_results(results: list[dict[str, object]]) -> dict[str, object]:
    metrics: dict[str, dict[str, object]] = {}
    for metric_name in DEFAULT_RAGAS_DIAGNOSTIC_METRIC_NAMES:
        values = [
            float(scores[metric_name])
            for item in results
            for scores in (item.get("scores"),)
            if isinstance(scores, dict) and isinstance(scores.get(metric_name), int | float)
        ]
        metrics[metric_name] = {
            "count": len(values),
            "mean": (sum(values) / len(values)) if values else None,
            "min": min(values) if values else None,
            "max": max(values) if values else None,
        }
    failed_cases = [item for item in results if item.get("status") != "completed"]
    return {
        "total_cases": len(results),
        "completed_cases": len(results) - len(failed_cases),
        "failed_cases": len(failed_cases),
        "metrics": metrics,
    }


def _load_case(*, root: Path, surface_key: str, case_id: str) -> RetrievalQrelsCase:
    dataset = load_retrieval_qrels_dataset(_qrels_path(root=root, surface_key=surface_key))
    for case in dataset.cases:
        if case.case_id == case_id:
            return case
    raise ValueError(f"unknown qrels case {surface_key}:{case_id}")


def _qrels_path(*, root: Path, surface_key: str) -> Path:
    return root / "packages" / "evals" / "fixtures" / _SURFACE_QRELS_FIXTURES[surface_key]


def _reference_for_case(case: RetrievalQrelsCase) -> str:
    rationales = tuple(source.rationale for source in case.expected_sources if source.rationale)
    if rationales:
        return "\n".join(rationales)
    return "\n".join(source.doc_id for source in case.expected_sources)


def _source_projection_id(source) -> str:
    return str(source.canonical_source_id or source.doc_id or source.chunk_id or "").strip()


__all__ = [
    "DEFAULT_RAGAS_DIAGNOSTIC_METRIC_NAMES",
    "DEFAULT_RAGAS_DIAGNOSTIC_SAMPLE_LIMIT_PER_SURFACE",
    "DEFAULT_RAGAS_DIAGNOSTIC_TOP_K",
    "RAGAS_DIAGNOSTIC_REPORT_SCHEMA_VERSION",
    "RAGAS_DIAGNOSTIC_SAMPLE_MANIFEST_SCHEMA_VERSION",
    "build_ragas_diagnostic_sample_manifest",
    "main",
    "run_ragas_diagnostic",
]


if __name__ == "__main__":
    raise SystemExit(main())
