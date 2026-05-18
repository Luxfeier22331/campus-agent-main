from __future__ import annotations

import time
from dataclasses import replace

from campus_contracts import EvidenceBundle
from campus_ingestion_core.corpus_profiles import CollectionRuntimeProfile
from campus_shared.answer_ready_evidence_contract import answer_ready_contract_applies

from campus_retrieval_core.backend_qdrant_errors import RetrievalBackendError
from campus_retrieval_core.evidence_attributes import evidence_contract_diagnostics_for_source
from campus_retrieval_core.models import RetrievalPlan, RetrievalRequest, RetrievalStep
from campus_retrieval_core.service_execution import (
    build_blocked_step_result,
    build_decision_step_result,
    build_succeeded_step_result,
)
from campus_retrieval_core.service_requests import build_retrieval_request_from_step


def classify_retrieval_exception_failure_kind(exc: Exception) -> str:
    message = str(exc).lower()
    if "reranker_failed" in message:
        return "reranker_failed"
    if (
        "release metadata" in message
        or "answer-ready evidence contract missing" in message
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
    if step.step_type == "compare_pair_lookup":
        evidence_chunks: list[EvidenceBundle] = []
        for request in build_compare_pair_requests(
            step,
            authorized_filter=authorized_filter,
            personalization_hint=personalization_hint,
        ):
            evidence = request_executor(request)
            evidence = apply_profile_gated_reranker(
                step=step,
                request=request,
                evidence=evidence,
                rerank_step=rerank_step,
                load_runtime_profile_fn=load_runtime_profile_fn,
                logger=logger,
            )
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
        evidence = apply_profile_gated_reranker(
            step=step,
            request=request,
            evidence=evidence,
            rerank_step=rerank_step,
            load_runtime_profile_fn=load_runtime_profile_fn,
            logger=logger,
        )
    runtime_profile = load_runtime_profile_fn(step.scope.corpus, step.scope.collection)
    _fail_closed_on_missing_answer_ready_contract(
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


def _fail_closed_on_missing_answer_ready_contract(
    *,
    plan: RetrievalPlan | None,
    step: RetrievalStep,
    runtime_profile: CollectionRuntimeProfile,
    evidence: EvidenceBundle,
) -> None:
    if not _requires_answer_ready_contract_for_query_serving_surface(
        plan=plan,
        step=step,
        runtime_profile=runtime_profile,
    ):
        return
    for source in evidence.sources:
        if not source.is_answer_bearing:
            continue
        diagnostics = evidence_contract_diagnostics_for_source(source)
        if not diagnostics.contract_missing:
            continue
        raise RetrievalBackendError(
            "answer-ready evidence contract missing for query-serving regulation surface "
            f"{step.scope.corpus}/{step.scope.collection}: "
            f"{diagnostics.contract_issue_reason or 'missing_contract'}"
        )


def _requires_answer_ready_contract_for_query_serving_surface(
    *,
    plan: RetrievalPlan | None,
    step: RetrievalStep,
    runtime_profile: CollectionRuntimeProfile,
) -> bool:
    if not answer_ready_contract_applies(
        corpus=runtime_profile.corpus,
        collection=runtime_profile.collection,
    ):
        return False
    if runtime_profile.serving_stage != "query_serving":
        return False
    return runtime_profile.query_enabled_by_default


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
    step: RetrievalStep,
    request: RetrievalRequest,
    evidence: EvidenceBundle,
    rerank_step,
    load_runtime_profile_fn,
    logger,
) -> EvidenceBundle:
    profile = load_runtime_profile_fn(request.corpus, request.collection)
    if not getattr(profile, "reranker_enabled_by_default", False):
        return evidence
    if (
        step.semantic_hint is not None
        and step.semantic_hint.rerank_policy != "profile_gated_if_eligible"
    ):
        return evidence
    if rerank_step is None:
        raise RuntimeError("reranker_failed: reranker executor is unavailable")
    try:
        return rerank_step(
            request,
            bounded_rerank_candidate_bundle(
                evidence,
                top_n=getattr(profile, "reranker_top_n", None),
            ),
        )
    except Exception as exc:
        logger.error(
            "retrieval reranker failed for %s/%s",
            request.corpus,
            request.collection,
            exc_info=True,
        )
        raise RuntimeError("reranker_failed: reranker executor failed") from exc


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
    if plan.query_mode != "freshness_sensitive" and not profile.requires_freshness_gate:
        return build_decision_step_result(step, status="succeeded")
    if profile.supports_freshness_sensitive_queries:
        return build_decision_step_result(step, status="succeeded")
    return build_blocked_step_result(
        step,
        failure_kind="unresolved_freshness",
        message="freshness gate rejected local retrieval and no admitted freshness-ready branch is available",
    )


__all__ = [
    "apply_profile_gated_reranker",
    "bounded_rerank_candidate_bundle",
    "build_compare_pair_requests",
    "classify_retrieval_exception_failure_kind",
    "execute_freshness_gate_step",
    "execute_index_backed_step",
    "merge_evidence_chunks",
    "validate_index_backed_step",
]
