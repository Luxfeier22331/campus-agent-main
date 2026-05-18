from __future__ import annotations

import argparse
import json
import sys
from collections.abc import Iterator, Sequence
from contextlib import contextmanager
from dataclasses import replace
from pathlib import Path
from unittest.mock import patch

import campus_retrieval_core.backend_qdrant as backend_qdrant_module
from campus_contracts import AuthorizedRetrievalFilter
from campus_rag_agent.handbook_query_planning import plan_student_handbook_query
from campus_rag_agent.institutional_rules_query_planning import plan_institutional_rules_query
from campus_rag_agent.query_planning import plan_curriculum_query
from campus_rag_agent.retrieval_intent import RetrievalIntent
from campus_retrieval_core import RetrievalRequest, build_retrieval_backend
from campus_retrieval_core.models import RetrievalSemanticHint
from campus_shared import load_repo_env

from campus_evals.benchmark import (
    RetrievalBenchmarkRun,
    RetrievalMetricSummary,
    RetrievalObservedSource,
    RetrievalQrelsCase,
    RetrievalRunCase,
    evaluate_retrieval_run,
    load_retrieval_qrels_dataset,
    render_retrieval_summary_text,
    resolve_retrieval_fixture_manifest_path,
    summarize_retrieval_metrics,
    validate_retrieval_qrels_fixture,
)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Execute live retrieval for a qrels fixture and write run-results."
    )
    parser.add_argument("--qrels", required=True, help="Path to retrieval qrels JSON fixture.")
    parser.add_argument("--output", required=True, help="Path to write run-results JSON.")
    parser.add_argument(
        "--manifest", help="Optional split-manifest path used for qrels validation."
    )
    parser.add_argument(
        "--format",
        choices=("text", "json"),
        default="text",
        help="Render benchmark summary as text or JSON.",
    )
    parser.add_argument(
        "--top-k",
        type=int,
        default=5,
        help="Default retrieval top-k when the qrels case does not override it.",
    )
    parser.add_argument(
        "--qdrant-collection-name",
        help="Optional physical collection or alias name override used only for this live validation run.",
    )
    parser.add_argument(
        "--force-enable-retrieval",
        action="store_true",
        help="Temporarily override runtime profile retrieval_enabled for this validation run.",
    )
    return parser


def main(argv: list[str] | None = None) -> int:
    load_repo_env()
    args = build_parser().parse_args(argv)
    qrels_path = Path(args.qrels)
    manifest_path = (
        Path(args.manifest)
        if args.manifest
        else resolve_retrieval_fixture_manifest_path(qrels_path)
    )
    issues = validate_retrieval_qrels_fixture(
        qrels_path,
        manifest_path=manifest_path,
        ambiguity_severity="error",
    )
    if issues:
        for issue in issues:
            print(issue, file=sys.stderr)
        return 2

    dataset = load_retrieval_qrels_dataset(qrels_path)
    backend = build_retrieval_backend()
    run = _execute_live_retrieval_run(
        dataset=dataset.cases,
        default_top_k=args.top_k,
        backend=backend,
        qdrant_collection_name=args.qdrant_collection_name,
        force_enable_retrieval=args.force_enable_retrieval,
    )
    output_path = Path(args.output)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(
        json.dumps(_serialize_run(run), ensure_ascii=False, indent=2),
        encoding="utf-8",
    )

    metrics = evaluate_retrieval_run(dataset, run)
    summary = summarize_retrieval_metrics(metrics)
    _print_summary(summary=summary, output_format=args.format)
    return 0


def _execute_live_retrieval_run(
    *,
    dataset: Sequence[RetrievalQrelsCase],
    default_top_k: int,
    backend: object,
    qdrant_collection_name: str | None,
    force_enable_retrieval: bool,
) -> RetrievalBenchmarkRun:
    cases = tuple(dataset)
    if default_top_k <= 0:
        raise ValueError("top_k must be greater than zero")
    if not cases:
        return RetrievalBenchmarkRun(schema_version=1, cases=())
    first_scope = cases[0].scope
    run_cases = []
    with _override_runtime_profile(
        corpus=first_scope.corpus,
        collection=first_scope.collection,
        qdrant_collection_name=qdrant_collection_name,
        force_enable_retrieval=force_enable_retrieval,
    ):
        for case in cases:
            request = _build_retrieval_request(case=case, default_top_k=default_top_k)
            bundle = backend.retrieve(request)
            run_cases.append(
                RetrievalRunCase(
                    case_id=case.case_id,
                    retrieved_sources=tuple(
                        RetrievalObservedSource(
                            doc_id=source.doc_id,
                            version_id=source.version_id or None,
                            chunk_id=source.chunk_id or None,
                            score=source.score,
                        )
                        for source in bundle.sources
                    ),
                )
            )
    return RetrievalBenchmarkRun(
        schema_version=1,
        cases=tuple(run_cases),
    )


def _build_retrieval_request(*, case: RetrievalQrelsCase, default_top_k: int) -> RetrievalRequest:
    overrides = dict(case.request_overrides)
    query_text = case.query
    target_document_ids = _coerce_tuple(overrides.get("target_document_ids"))
    handbook_plan = None
    institutional_rules_plan = None
    curriculum_plan = None
    retrieval_intent = None
    if (
        case.scope.corpus == "regulations"
        and case.scope.collection == "student_rules"
        and not target_document_ids
    ):
        handbook_plan = plan_student_handbook_query(case.query)
        retrieval_intent = handbook_plan.retrieval_intent
        if handbook_plan.status == "resolved":
            query_text = handbook_plan.focused_query_text or handbook_plan.rewritten_query_text
            target_document_ids = handbook_plan.target_document_ids
    if (
        case.scope.corpus == "regulations"
        and case.scope.collection == "institutional_rules"
        and not target_document_ids
    ):
        institutional_rules_plan = plan_institutional_rules_query(case.query)
        retrieval_intent = institutional_rules_plan.retrieval_intent
        query_text = (
            institutional_rules_plan.focused_query_text
            or institutional_rules_plan.rewritten_query_text
        )
        target_document_ids = institutional_rules_plan.target_document_ids
    if (
        case.scope.corpus == "curriculum"
        and case.scope.collection == "curriculum_plan"
        and not target_document_ids
    ):
        curriculum_plan = plan_curriculum_query(case.query)
        retrieval_intent = curriculum_plan.retrieval_intent
        if curriculum_plan.status == "resolved":
            query_text = curriculum_plan.rewritten_query_text
            target_document_ids = curriculum_plan.target_document_ids
    return RetrievalRequest(
        query_text=query_text,
        corpus=case.scope.corpus,
        collection=case.scope.collection,
        authorized_filter=_build_authorized_filter(overrides),
        target_document_ids=target_document_ids,
        preferred_document_ids=_coerce_tuple(overrides.get("preferred_document_ids"))
        or _handbook_plan_preferred_document_ids(handbook_plan)
        or _planning_tuple(curriculum_plan, "preferred_document_ids"),
        focus_detail_labels=_coerce_tuple(overrides.get("focus_detail_labels"))
        or _planning_tuple(handbook_plan, "focus_detail_labels")
        or _planning_tuple(institutional_rules_plan, "focus_detail_labels"),
        focus_article_nos=_coerce_tuple(overrides.get("focus_article_nos"))
        or _planning_tuple(handbook_plan, "focus_article_nos")
        or _planning_tuple(institutional_rules_plan, "focus_article_nos"),
        focus_clause_nos=_coerce_tuple(overrides.get("focus_clause_nos"))
        or _planning_tuple(handbook_plan, "focus_clause_nos")
        or _planning_tuple(institutional_rules_plan, "focus_clause_nos"),
        focus_terms=_coerce_tuple(overrides.get("focus_terms"))
        or _planning_tuple(handbook_plan, "focus_terms")
        or _planning_tuple(institutional_rules_plan, "focus_terms"),
        semantic_hint=_semantic_hint_from_retrieval_intent(retrieval_intent),
        top_k=_coerce_top_k(overrides.get("top_k"), default=default_top_k),
    )


def _planning_tuple(plan: object | None, field_name: str) -> tuple[str, ...]:
    if plan is None:
        return ()
    if getattr(plan, "status", "resolved") != "resolved":
        return ()
    value = getattr(plan, field_name, ())
    return tuple(item for item in value if isinstance(item, str) and item.strip())


def _handbook_plan_tuple(handbook_plan: object | None, field_name: str) -> tuple[str, ...]:
    return _planning_tuple(handbook_plan, field_name)


def _handbook_plan_preferred_document_ids(handbook_plan: object | None) -> tuple[str, ...]:
    if handbook_plan is None or getattr(handbook_plan, "status", "") != "resolved":
        return ()
    explicit = _handbook_plan_tuple(handbook_plan, "preferred_document_ids")
    if explicit:
        return explicit
    if _handbook_plan_tuple(handbook_plan, "target_document_ids"):
        return ()
    return _handbook_plan_tuple(handbook_plan, "category_member_document_ids")


def _semantic_hint_from_retrieval_intent(
    retrieval_intent: RetrievalIntent | None,
) -> RetrievalSemanticHint | None:
    if retrieval_intent is None:
        return None
    return RetrievalSemanticHint(
        intent_kind=retrieval_intent.kind,
        answer_kind=retrieval_intent.expected.answer_kind,
        need_kinds=_need_kinds_from_retrieval_intent(retrieval_intent),
        coverage_policy=retrieval_intent.expected.coverage_policy,
        selection_policy=retrieval_intent.expected.selection_policy,
        rerank_policy=retrieval_intent.expected.rerank_policy,
        replan_policy=retrieval_intent.expected.replan_policy,
        expected_answer_roles=retrieval_intent.expected.evidence_roles,
        condition_subject=retrieval_intent.target.condition_subject,
        category_id=retrieval_intent.target.category_id,
        critical_terms=retrieval_intent.critical_terms,
    )


def _need_kinds_from_retrieval_intent(retrieval_intent: RetrievalIntent) -> tuple[str, ...]:
    if retrieval_intent.kind == "policy_list":
        return ("policy_list",)
    if retrieval_intent.kind == "condition_table":
        return ("condition_table",)
    if retrieval_intent.kind == "eligibility_judgment":
        return ("eligibility_judgment",)
    if retrieval_intent.kind == "procedure_steps":
        return ("procedure_steps",)
    if retrieval_intent.kind == "specific_clause_lookup":
        return ("specific_clause",)
    if retrieval_intent.kind == "policy_object_lookup":
        return ("policy_object",)
    if retrieval_intent.kind == "curriculum_document_lookup":
        return ("curriculum_document",)
    if retrieval_intent.kind == "curriculum_fact_lookup":
        return ("curriculum_fact",)
    if retrieval_intent.kind == "official_reference_lookup":
        return ("official_reference",)
    if retrieval_intent.kind == "clarification_required":
        return ("clarification",)
    if retrieval_intent.kind == "unsupported":
        return ("unsupported",)
    return ("general_fact",)


def _build_authorized_filter(overrides: dict[str, object]) -> AuthorizedRetrievalFilter | None:
    entitlement_groups = _coerce_tuple(overrides.get("entitlement_groups"))
    visibility_scope = _optional_text(overrides.get("visibility_scope"))
    visibility_level = _optional_text(overrides.get("visibility_level"))
    policy_projection_version = _optional_text(overrides.get("policy_projection_version"))
    if (
        not entitlement_groups
        and visibility_scope is None
        and visibility_level is None
        and policy_projection_version is None
    ):
        return None
    return AuthorizedRetrievalFilter(
        entitlement_groups=entitlement_groups,
        visibility_scope=visibility_scope,
        visibility_level=visibility_level or ("restricted" if entitlement_groups else "public"),
        policy_projection_version=policy_projection_version or "",
    )


def _coerce_tuple(value: object) -> tuple[str, ...]:
    if value is None:
        return ()
    if isinstance(value, str):
        normalized = value.strip()
        return (normalized,) if normalized else ()
    if isinstance(value, Sequence):
        return tuple(
            normalized
            for item in value
            if isinstance(item, str)
            for normalized in (item.strip(),)
            if normalized
        )
    raise ValueError("request override must be a string or sequence of strings")


def _coerce_top_k(value: object, *, default: int) -> int:
    if value is None:
        return default
    normalized = int(value)
    if normalized <= 0:
        raise ValueError("request override top_k must be greater than zero")
    return normalized


def _optional_text(value: object) -> str | None:
    if not isinstance(value, str):
        return None
    normalized = value.strip()
    return normalized or None


@contextmanager
def _override_runtime_profile(
    *,
    corpus: str,
    collection: str,
    qdrant_collection_name: str | None,
    force_enable_retrieval: bool,
) -> Iterator[None]:
    if not qdrant_collection_name and not force_enable_retrieval:
        yield
        return

    original_load_runtime_profile = backend_qdrant_module.load_runtime_profile

    def _load_runtime_profile(target_corpus: str, target_collection: str, *, config_root=None):
        profile = original_load_runtime_profile(
            target_corpus,
            target_collection,
            config_root=config_root,
        )
        if target_corpus != corpus or target_collection != collection:
            return profile
        qdrant_index_binding = profile.qdrant_index_binding
        if qdrant_collection_name:
            qdrant_index_binding = replace(qdrant_index_binding, alias_name=qdrant_collection_name)
        retrieval_enabled = profile.retrieval_enabled or force_enable_retrieval
        if (
            retrieval_enabled == profile.retrieval_enabled
            and qdrant_index_binding == profile.qdrant_index_binding
        ):
            return profile
        return replace(
            profile,
            retrieval_enabled=retrieval_enabled,
            qdrant_index_binding=qdrant_index_binding,
        )

    with patch.object(
        backend_qdrant_module, "load_runtime_profile", side_effect=_load_runtime_profile
    ):
        yield


def _serialize_run(run: RetrievalBenchmarkRun) -> dict[str, object]:
    return {
        "schema_version": run.schema_version,
        "cases": [
            {
                "case_id": case.case_id,
                "retrieved_sources": [
                    {
                        "doc_id": source.doc_id,
                        "version_id": source.version_id,
                        "chunk_id": source.chunk_id,
                        "score": source.score,
                    }
                    for source in case.retrieved_sources
                ],
            }
            for case in run.cases
        ],
    }


def _print_summary(*, summary: RetrievalMetricSummary, output_format: str) -> None:
    if output_format == "json":
        print(
            json.dumps(
                {
                    "total_cases": summary.total_cases,
                    "hit_at_1": summary.hit_at_1,
                    "hit_at_3": summary.hit_at_3,
                    "recall_at_5": summary.recall_at_5,
                    "precision_at_5": summary.precision_at_5,
                    "mrr_at_5": summary.mrr_at_5,
                    "doc_hit_at_1": summary.doc_hit_at_1,
                    "doc_hit_at_3": summary.doc_hit_at_3,
                    "doc_recall_at_5": summary.doc_recall_at_5,
                    "doc_precision_at_5": summary.doc_precision_at_5,
                    "doc_mrr_at_5": summary.doc_mrr_at_5,
                    "forbidden_hit_rate": summary.forbidden_hit_rate,
                    "by_split": {
                        name: {
                            "total_cases": item.total_cases,
                            "hit_at_1": item.hit_at_1,
                            "hit_at_3": item.hit_at_3,
                            "recall_at_5": item.recall_at_5,
                            "precision_at_5": item.precision_at_5,
                            "mrr_at_5": item.mrr_at_5,
                            "doc_hit_at_1": item.doc_hit_at_1,
                            "doc_hit_at_3": item.doc_hit_at_3,
                            "doc_recall_at_5": item.doc_recall_at_5,
                            "doc_precision_at_5": item.doc_precision_at_5,
                            "doc_mrr_at_5": item.doc_mrr_at_5,
                            "forbidden_hit_rate": item.forbidden_hit_rate,
                        }
                        for name, item in summary.by_split.items()
                    },
                },
                ensure_ascii=False,
                indent=2,
            )
        )
        return
    print(render_retrieval_summary_text(summary))


if __name__ == "__main__":
    raise SystemExit(main())
