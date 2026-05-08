from __future__ import annotations

import time
from dataclasses import replace
from datetime import UTC, datetime

from campus_contracts import EvidenceBundle
from campus_ingestion_core.corpus_profiles import CollectionRuntimeProfile

from campus_retrieval_core.backend_qdrant_errors import RetrievalBackendError
from campus_retrieval_core.evidence_attributes import evidence_fallback_diagnostics_for_source
from campus_retrieval_core.models import RetrievalPlan, RetrievalRequest, RetrievalStep
from campus_retrieval_core.service_execution import (
    build_blocked_step_result,
    build_decision_step_result,
    build_succeeded_step_result,
)
from campus_retrieval_core.service_requests import build_retrieval_request_from_step


def classify_retrieval_exception_failure_kind(exc: Exception) -> str:
    message = str(exc).lower()
    if (
        "release metadata" in message
        or "legacy old-index fallback" in message
        or "profile_identity_hash" in message
        or "quality_gate_status" in message
        or "chunk_quality_status" in message
        or "qrels_coverage_status" in message
    ):
        return "release_metadata_drift"
    return "executor_error"


def execute_index_backed_step(
    step: RetrievalStep,
    *,
    authorized_filter,
    personalization_hint,
    request_executor,
    rerank_step,
    load_runtime_profile_fn,
    logger,
    plan: RetrievalPlan | None = None,
):
    validation_error = validate_index_backed_step(step)
    if validation_error is not None:
        return build_blocked_step_result(
            step,
            failure_kind="unsupported_step_type",
            message=validation_error,
        )

    started_at = time.perf_counter()
    reranker_failure_kind = ""
    if step.step_type == "compare_pair_lookup":
        evidence_chunks: list[EvidenceBundle] = []
        for request in build_compare_pair_requests(
            step,
            authorized_filter=authorized_filter,
            personalization_hint=personalization_hint,
        ):
            evidence = request_executor(request)
            evidence, current_reranker_failure_kind = apply_profile_gated_reranker(
                request=request,
                evidence=evidence,
                rerank_step=rerank_step,
                load_runtime_profile_fn=load_runtime_profile_fn,
                logger=logger,
            )
            if current_reranker_failure_kind and not reranker_failure_kind:
                reranker_failure_kind = current_reranker_failure_kind
            evidence_chunks.append(evidence)
        evidence = merge_evidence_chunks(
            query_text=step.query_text,
            corpus=step.scope.corpus,
            collection=step.scope.collection,
            chunks=tuple(evidence_chunks),
        )
    else:
        request = build_retrieval_request_from_step(
            step,
            authorized_filter=authorized_filter,
            personalization_hint=personalization_hint,
        )
        evidence = request_executor(request)
        evidence, reranker_failure_kind = apply_profile_gated_reranker(
            request=request,
            evidence=evidence,
            rerank_step=rerank_step,
            load_runtime_profile_fn=load_runtime_profile_fn,
            logger=logger,
        )
    runtime_profile = load_runtime_profile_fn(step.scope.corpus, step.scope.collection)
    _fail_closed_on_disallowed_legacy_fallback(
        plan=plan,
        step=step,
        runtime_profile=runtime_profile,
        evidence=evidence,
    )
    latency_ms = max(0, round((time.perf_counter() - started_at) * 1000))
    return build_succeeded_step_result(
        step,
        evidence=evidence,
        latency_ms=latency_ms,
        reranker_degraded=bool(reranker_failure_kind),
        reranker_failure_kind=reranker_failure_kind,
    )


def validate_index_backed_step(step: RetrievalStep) -> str | None:
    if step.step_type == "historical_version_lookup" and not step.selector.target_version_ids:
        return "historical_version_lookup requires target_version_ids"
    if step.step_type == "compare_pair_lookup":
        if len(step.selector.target_version_ids) != 2:
            return "compare_pair_lookup requires exactly two target_version_ids"
        if step.selector.target_version_ids[0] == step.selector.target_version_ids[1]:
            return "compare_pair_lookup requires distinct target_version_ids"
    return None


def _fail_closed_on_disallowed_legacy_fallback(
    *,
    plan: RetrievalPlan | None,
    step: RetrievalStep,
    runtime_profile: CollectionRuntimeProfile,
    evidence: EvidenceBundle,
) -> None:
    if not _requires_target_v3_legacy_fallback_quarantine(
        plan=plan,
        step=step,
        runtime_profile=runtime_profile,
    ):
        return
    for source in evidence.sources:
        if not source.is_answer_bearing:
            continue
        diagnostics = evidence_fallback_diagnostics_for_source(source)
        if not diagnostics.fallback_used:
            continue
        raise RetrievalBackendError(
            "legacy old-index fallback is not allowed for target v3 query-serving "
            f"{step.scope.corpus}/{step.scope.collection}: "
            f"{diagnostics.fallback_primary_signal or 'unknown'}"
        )


def _requires_target_v3_legacy_fallback_quarantine(
    *,
    plan: RetrievalPlan | None,
    step: RetrievalStep,
    runtime_profile: CollectionRuntimeProfile,
) -> bool:
    if runtime_profile.corpus != "regulations":
        return False
    if runtime_profile.collection not in {"student_rules", "institutional_rules"}:
        return False
    if runtime_profile.serving_stage != "query_serving":
        return False
    if not runtime_profile.query_enabled_by_default:
        return False
    if plan is None:
        return True
    return plan.source_trust_policy.legacy_fallback_mode != "legacy_old_index_compatibility"


def build_compare_pair_requests(
    step: RetrievalStep,
    *,
    authorized_filter,
    personalization_hint,
) -> tuple[RetrievalRequest, ...]:
    return tuple(
        build_retrieval_request_from_step(
            replace(
                step,
                selector=replace(step.selector, target_version_ids=(version_id,)),
            ),
            authorized_filter=authorized_filter,
            personalization_hint=personalization_hint,
        )
        for version_id in step.selector.target_version_ids
    )


def merge_evidence_chunks(
    *,
    query_text: str,
    corpus: str,
    collection: str,
    chunks: tuple[EvidenceBundle, ...],
) -> EvidenceBundle:
    ordered_sources = {}
    for chunk in chunks:
        for source in chunk.sources:
            dedupe_key = source.chunk_id or repr(source)
            ordered_sources.setdefault(dedupe_key, source)
    return EvidenceBundle(
        query_text=query_text,
        corpus=corpus,
        collection=collection,
        sources=tuple(ordered_sources.values()),
    )


def apply_profile_gated_reranker(
    *,
    request: RetrievalRequest,
    evidence: EvidenceBundle,
    rerank_step,
    load_runtime_profile_fn,
    logger,
) -> tuple[EvidenceBundle, str]:
    profile = load_runtime_profile_fn(request.corpus, request.collection)
    if not getattr(profile, "reranker_enabled_by_default", False):
        return evidence, ""
    if rerank_step is None:
        return evidence, "reranker_executor_unavailable"
    try:
        return rerank_step(
            request,
            bounded_rerank_candidate_bundle(
                evidence,
                top_n=getattr(profile, "reranker_top_n", None),
            ),
        ), ""
    except Exception:
        logger.warning(
            "retrieval reranker degraded for %s/%s",
            request.corpus,
            request.collection,
            exc_info=True,
        )
        return evidence, "reranker_degraded"


def bounded_rerank_candidate_bundle(
    evidence: EvidenceBundle,
    *,
    top_n: int | None,
) -> EvidenceBundle:
    if top_n is None or len(evidence.sources) <= top_n:
        return evidence
    return EvidenceBundle(
        query_text=evidence.query_text,
        corpus=evidence.corpus,
        collection=evidence.collection,
        sources=evidence.sources[:top_n],
    )


def execute_freshness_gate_step(
    *,
    plan: RetrievalPlan,
    step: RetrievalStep,
    load_runtime_profile_fn,
):
    profile = load_runtime_profile_fn(step.scope.corpus, step.scope.collection)
    if (
        plan.query_mode not in {"freshness_sensitive", "live_assisted"}
        and not profile.requires_freshness_gate
    ):
        return build_decision_step_result(step, status="succeeded")
    if profile.supports_freshness_sensitive_queries:
        return build_decision_step_result(step, status="succeeded")
    if (
        plan.query_mode == "live_assisted"
        and plan.source_trust_policy.allow_live_source_lookup
        and profile.live_search_fallback_allowed
    ):
        return build_decision_step_result(step, status="succeeded")
    return build_blocked_step_result(
        step,
        failure_kind="unresolved_freshness",
        message="freshness gate rejected local retrieval and no admitted live branch is available",
    )


def execute_live_source_lookup_step(
    *,
    plan: RetrievalPlan,
    step: RetrievalStep,
    retrieve_live_step,
    attempted_live_lookup_count: int,
    load_runtime_profile_fn,
):
    profile = load_runtime_profile_fn(step.scope.corpus, step.scope.collection)
    if attempted_live_lookup_count >= plan.budget.max_live_lookups:
        return build_blocked_step_result(
            step,
            failure_kind="budget_exhausted",
            message="live source lookup budget exhausted",
        )
    if not plan.source_trust_policy.allow_live_source_lookup:
        return build_blocked_step_result(
            step,
            failure_kind="live_lookup_unavailable",
            message="live source lookup is not allowed by the retrieval plan",
        )
    if not profile.live_search_fallback_allowed:
        return build_blocked_step_result(
            step,
            failure_kind="live_lookup_unavailable",
            message="live source lookup is not admitted for this runtime profile",
        )
    if retrieve_live_step is None:
        return build_blocked_step_result(
            step,
            failure_kind="live_lookup_unavailable",
            message="live source lookup is admitted but no live lookup executor is wired for this runtime path",
        )
    started_at = time.perf_counter()
    evidence = annotate_live_evidence(retrieve_live_step(step))
    latency_ms = max(0, round((time.perf_counter() - started_at) * 1000))
    return build_succeeded_step_result(step, evidence=evidence, latency_ms=latency_ms)


def annotate_live_evidence(evidence: EvidenceBundle) -> EvidenceBundle:
    as_of = datetime.now(UTC).isoformat()
    sources = tuple(
        replace(
            source,
            anchor={
                **source.anchor,
                "retrieval_mode": "live_assisted",
                "canonical_index_truth": False,
                "as_of": source.anchor.get("as_of") or as_of,
            },
        )
        for source in evidence.sources
    )
    return EvidenceBundle(
        query_text=evidence.query_text,
        corpus=evidence.corpus,
        collection=evidence.collection,
        sources=sources,
    )


__all__ = [
    "annotate_live_evidence",
    "apply_profile_gated_reranker",
    "bounded_rerank_candidate_bundle",
    "build_compare_pair_requests",
    "classify_retrieval_exception_failure_kind",
    "execute_freshness_gate_step",
    "execute_index_backed_step",
    "execute_live_source_lookup_step",
    "merge_evidence_chunks",
    "validate_index_backed_step",
]
