from __future__ import annotations

import hashlib
import json
import logging
import time
from collections.abc import Callable, Sequence
from dataclasses import replace
from datetime import UTC, datetime
from pathlib import Path
from threading import Lock

from campus_contracts import AuthorizedRetrievalFilter, EvidenceBundle, PersonalizationHint
from campus_ingestion_core.corpus_profiles import load_runtime_profile

from campus_retrieval_core.backend_qdrant import QdrantRetrievalBackend, RetrievalBackendError
from campus_retrieval_core.models import (
    RetrievalExecutionResult,
    RetrievalPlan,
    RetrievalRequest,
    RetrievalStep,
    RetrievalStepResult,
)
from campus_retrieval_core.service_execution import (
    build_blocked_step_result,
    build_decision_step_result,
    build_failed_step_result,
    build_succeeded_step_result,
    filter_merged_evidence_by_source_trust_policy,
    merge_step_evidence,
    validate_replanned_step,
)
from campus_retrieval_core.service_requests import (
    build_retrieval_request_from_step,
    build_single_step_plan,
)
from campus_retrieval_core.settings import RetrievalSettings

_RUNTIME_BACKEND_CACHE: dict[RetrievalSettings, QdrantRetrievalBackend] = {}
_RUNTIME_BACKEND_CACHE_LOCK = Lock()
_LOGGER = logging.getLogger(__name__)
ExecutableRetrievalRequestFn = Callable[[RetrievalRequest], EvidenceBundle]
ExecutableLiveLookupFn = Callable[[RetrievalStep], EvidenceBundle]
ExecutableRerankFn = Callable[[RetrievalRequest, EvidenceBundle], EvidenceBundle]
RetrievalObservationSink = Callable[[dict[str, object]], None]
RetrievalObservationEventEmitter = Callable[[str, dict[str, object]], None]
ReplanStepCallback = Callable[
    [RetrievalPlan, tuple[RetrievalStepResult, ...], RetrievalStepResult], Sequence[RetrievalStep]
]
_INDEX_BACKED_RETRIEVAL_STEP_TYPES = frozenset(
    {
        "indexed_lookup",
        "entity_resolution",
        "historical_version_lookup",
        "compare_pair_lookup",
    }
)


def build_retrieval_backend(
    settings: RetrievalSettings | None = None,
) -> QdrantRetrievalBackend:
    runtime_settings = settings or RetrievalSettings.from_env()
    try:
        if settings is not None:
            return QdrantRetrievalBackend(runtime_settings)
        with _RUNTIME_BACKEND_CACHE_LOCK:
            existing = _RUNTIME_BACKEND_CACHE.get(runtime_settings)
            if existing is not None:
                return existing
            backend = QdrantRetrievalBackend(runtime_settings)
            _RUNTIME_BACKEND_CACHE[runtime_settings] = backend
            return backend
    except Exception as exc:  # pragma: no cover - exercised via caller mapping
        raise RetrievalBackendError("failed to initialize retrieval backend") from exc


def build_jsonl_retrieval_observation_sink(path: str | Path) -> RetrievalObservationSink:
    output_path = Path(path)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    write_lock = Lock()

    def sink(observation: dict[str, object]) -> None:
        line = json.dumps(
            observation,
            ensure_ascii=False,
            sort_keys=True,
            default=str,
        )
        with write_lock, output_path.open("a", encoding="utf-8") as handle:
            handle.write(line + "\n")

    return sink


def build_retrieval_observation_event_sink(
    emit_event: RetrievalObservationEventEmitter,
) -> RetrievalObservationSink:
    def sink(observation: dict[str, object]) -> None:
        emit_event("retrieval.runtime_observation", dict(observation))

    return sink


def retrieve_sources(
    query: str,
    *,
    corpus: str,
    collection: str,
    target_document_ids: tuple[str, ...] = (),
    target_version_ids: tuple[str, ...] = (),
    target_revision_track: str = "",
    preferred_document_ids: tuple[str, ...] = (),
    canonical_course_ids: tuple[str, ...] = (),
    canonical_course_family_ids: tuple[str, ...] = (),
    canonical_program_family_ids: tuple[str, ...] = (),
    authorized_filter: AuthorizedRetrievalFilter | None = None,
    personalization_hint: PersonalizationHint | None = None,
    top_k: int | None = None,
    backend: QdrantRetrievalBackend | None = None,
    observation_sink: RetrievalObservationSink | None = None,
    observation_request_id: str = "",
    include_observation_query_text: bool = False,
) -> EvidenceBundle:
    runtime_top_k = (
        top_k if top_k is not None else load_runtime_profile(corpus, collection).retrieval_top_k
    )
    request = RetrievalRequest(
        query_text=query,
        corpus=corpus,
        collection=collection,
        target_document_ids=target_document_ids,
        target_version_ids=target_version_ids,
        target_revision_track=target_revision_track,
        preferred_document_ids=preferred_document_ids,
        canonical_course_ids=canonical_course_ids,
        canonical_course_family_ids=canonical_course_family_ids,
        canonical_program_family_ids=canonical_program_family_ids,
        authorized_filter=authorized_filter,
        personalization_hint=personalization_hint,
        top_k=runtime_top_k,
    )
    runtime_backend = backend or build_retrieval_backend()
    execution = execute_retrieval_plan(
        build_single_step_plan(request),
        authorized_filter=authorized_filter,
        personalization_hint=personalization_hint,
        backend=runtime_backend,
        observation_sink=observation_sink,
        observation_request_id=observation_request_id,
        include_observation_query_text=include_observation_query_text,
    )
    return execution.merged_evidence


def execute_retrieval_plan(
    plan: RetrievalPlan,
    *,
    authorized_filter: AuthorizedRetrievalFilter | None = None,
    personalization_hint: PersonalizationHint | None = None,
    backend: QdrantRetrievalBackend | None = None,
    retrieve_step: ExecutableRetrievalRequestFn | None = None,
    retrieve_live_step: ExecutableLiveLookupFn | None = None,
    rerank_step: ExecutableRerankFn | None = None,
    replan_callback: ReplanStepCallback | None = None,
    observation_sink: RetrievalObservationSink | None = None,
    observation_request_id: str = "",
    include_observation_query_text: bool = False,
) -> RetrievalExecutionResult:
    runtime_backend = backend
    needs_indexed_executor = any(
        step.step_type in _INDEX_BACKED_RETRIEVAL_STEP_TYPES for step in plan.steps
    )
    if runtime_backend is None and retrieve_step is None and needs_indexed_executor:
        runtime_backend = build_retrieval_backend()
    if retrieve_step is not None:
        request_executor = retrieve_step
    elif runtime_backend is not None:
        request_executor = runtime_backend.retrieve
    else:
        request_executor = None

    pending_steps = list(plan.steps)
    completed_step_ids: set[str] = set()
    executed_steps: list[RetrievalStep] = []
    step_results: list[RetrievalStepResult] = []
    replan_count = 0
    live_lookup_count = 0
    step_index = 0

    while step_index < len(pending_steps):
        step = pending_steps[step_index]
        missing_dependencies = [
            dep for dep in step.depends_on_step_ids if dep not in completed_step_ids
        ]
        if missing_dependencies:
            result = build_blocked_step_result(
                step,
                failure_kind="missing_dependency",
                message=f"step dependencies not satisfied: {', '.join(missing_dependencies)}",
            )
        elif step.step_type == "freshness_gate":
            result = _execute_freshness_gate_step(plan=plan, step=step)
        elif step.step_type == "live_source_lookup":
            result = _execute_live_source_lookup_step(
                plan=plan,
                step=step,
                retrieve_live_step=retrieve_live_step,
                attempted_live_lookup_count=live_lookup_count,
            )
        elif step.step_type not in _INDEX_BACKED_RETRIEVAL_STEP_TYPES:
            result = build_blocked_step_result(
                step,
                failure_kind="unsupported_step_type",
                message=f"unsupported retrieval step type: {step.step_type}",
            )
        else:
            if request_executor is None:
                result = build_blocked_step_result(
                    step,
                    failure_kind="executor_error",
                    message="index-backed retrieval executor is unavailable for this runtime path",
                )
                executed_steps.append(step)
                step_results.append(result)
                completed_step_ids.add(step.step_id)
                break
            try:
                result = _execute_index_backed_step(
                    step,
                    authorized_filter=authorized_filter,
                    personalization_hint=personalization_hint,
                    request_executor=request_executor,
                    rerank_step=rerank_step,
                )
            except Exception as exc:
                result = build_failed_step_result(
                    step,
                    failure_kind=_classify_retrieval_exception_failure_kind(exc),
                    message=str(exc),
                )
                executed_steps.append(step)
                step_results.append(result)
                completed_step_ids.add(step.step_id)
                if observation_sink is not None:
                    _emit_retrieval_observations(
                        execution=_build_execution_result(
                            plan=plan,
                            executed_steps=tuple(executed_steps),
                            step_results=tuple(step_results),
                            replan_count=replan_count,
                        ),
                        observation_sink=observation_sink,
                        request_id=observation_request_id,
                        include_query_text=include_observation_query_text,
                    )
                raise

        executed_steps.append(step)
        step_results.append(result)
        completed_step_ids.add(step.step_id)
        if result.status in {"blocked", "failed"} and step.step_type in {
            "freshness_gate",
            "live_source_lookup",
        }:
            break
        if step.step_type == "live_source_lookup" and result.status == "succeeded":
            live_lookup_count += 1

        can_attempt_replan = (
            replan_callback is not None
            and result.status in {"empty", "blocked"}
            and replan_count < plan.budget.max_replans
        )
        if can_attempt_replan:
            additional_steps = tuple(replan_callback(plan, tuple(step_results), result))
            if additional_steps:
                if len(pending_steps) + len(additional_steps) > plan.budget.max_steps:
                    step_results.append(
                        build_failed_step_result(
                            step,
                            failure_kind="budget_exhausted",
                            message="replan budget exhausted",
                        )
                    )
                    break
                known_step_ids = {pending_step.step_id for pending_step in pending_steps}.union(
                    completed_step_ids
                )
                for additional_step in additional_steps:
                    validation_error = validate_replanned_step(
                        plan=plan,
                        triggering_step=step,
                        replanned_step=additional_step,
                    )
                    if validation_error is not None:
                        step_results.append(
                            build_failed_step_result(
                                additional_step,
                                failure_kind="executor_error",
                                message=validation_error,
                            )
                        )
                        break
                    if additional_step.step_id in known_step_ids:
                        step_results.append(
                            build_failed_step_result(
                                additional_step,
                                failure_kind="executor_error",
                                message=f"duplicate replanned step_id: {additional_step.step_id}",
                            )
                        )
                        break
                    pending_steps.insert(step_index + 1, additional_step)
                    known_step_ids.add(additional_step.step_id)
                if step_results[-1].status == "failed":
                    break
                replan_count += 1
        step_index += 1

    execution = _build_execution_result(
        plan=plan,
        executed_steps=tuple(executed_steps),
        step_results=tuple(step_results),
        replan_count=replan_count,
    )
    if observation_sink is not None:
        _emit_retrieval_observations(
            execution=execution,
            observation_sink=observation_sink,
            request_id=observation_request_id,
            include_query_text=include_observation_query_text,
        )
    return execution


def _classify_retrieval_exception_failure_kind(exc: Exception) -> str:
    message = str(exc).lower()
    if (
        "release metadata" in message
        or "profile_identity_hash" in message
        or "quality_gate_status" in message
        or "chunk_quality_status" in message
        or "qrels_coverage_status" in message
    ):
        return "release_metadata_drift"
    return "executor_error"


def _execute_index_backed_step(
    step: RetrievalStep,
    *,
    authorized_filter: AuthorizedRetrievalFilter | None,
    personalization_hint: PersonalizationHint | None,
    request_executor: ExecutableRetrievalRequestFn,
    rerank_step: ExecutableRerankFn | None,
) -> RetrievalStepResult:
    validation_error = _validate_index_backed_step(step)
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
        for request in _build_compare_pair_requests(
            step,
            authorized_filter=authorized_filter,
            personalization_hint=personalization_hint,
        ):
            evidence = request_executor(request)
            evidence, current_reranker_failure_kind = _apply_profile_gated_reranker(
                request=request,
                evidence=evidence,
                rerank_step=rerank_step,
            )
            if current_reranker_failure_kind and not reranker_failure_kind:
                reranker_failure_kind = current_reranker_failure_kind
            evidence_chunks.append(evidence)
        evidence = _merge_evidence_chunks(
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
        evidence, reranker_failure_kind = _apply_profile_gated_reranker(
            request=request,
            evidence=evidence,
            rerank_step=rerank_step,
        )
    latency_ms = max(0, round((time.perf_counter() - started_at) * 1000))
    return build_succeeded_step_result(
        step,
        evidence=evidence,
        latency_ms=latency_ms,
        reranker_degraded=bool(reranker_failure_kind),
        reranker_failure_kind=reranker_failure_kind,
    )


def _validate_index_backed_step(step: RetrievalStep) -> str | None:
    if step.step_type == "historical_version_lookup" and not step.selector.target_version_ids:
        return "historical_version_lookup requires target_version_ids"
    if step.step_type == "compare_pair_lookup":
        if len(step.selector.target_version_ids) != 2:
            return "compare_pair_lookup requires exactly two target_version_ids"
        if step.selector.target_version_ids[0] == step.selector.target_version_ids[1]:
            return "compare_pair_lookup requires distinct target_version_ids"
    return None


def _build_compare_pair_requests(
    step: RetrievalStep,
    *,
    authorized_filter: AuthorizedRetrievalFilter | None,
    personalization_hint: PersonalizationHint | None,
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


def _merge_evidence_chunks(
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


def _build_execution_result(
    *,
    plan: RetrievalPlan,
    executed_steps: tuple[RetrievalStep, ...],
    step_results: tuple[RetrievalStepResult, ...],
    replan_count: int,
) -> RetrievalExecutionResult:
    return RetrievalExecutionResult(
        plan=plan,
        step_results=step_results,
        merged_evidence=filter_merged_evidence_by_source_trust_policy(
            merge_step_evidence(
                executed_steps=executed_steps,
                step_results=step_results,
            ),
            query_mode=plan.query_mode,
            minimum_tier=plan.source_trust_policy.minimum_tier,
        ),
        replan_count=replan_count,
    )


def _emit_retrieval_observations(
    *,
    execution: RetrievalExecutionResult,
    observation_sink: RetrievalObservationSink,
    request_id: str,
    include_query_text: bool,
) -> None:
    for index, result in enumerate(execution.step_results, start=1):
        if result.activity is None:
            continue
        observation = _build_retrieval_observation(
            execution=execution,
            result=result,
            request_id=request_id or f"{execution.plan.plan_id}:step-{index}",
            include_query_text=include_query_text,
        )
        try:
            observation_sink(observation)
        except Exception:
            _LOGGER.warning(
                "retrieval observation sink failed for request_id=%s step_id=%s",
                observation.get("request_id"),
                observation.get("step_id"),
                exc_info=True,
            )


def _build_retrieval_observation(
    *,
    execution: RetrievalExecutionResult,
    result: RetrievalStepResult,
    request_id: str,
    include_query_text: bool,
) -> dict[str, object]:
    activity = result.activity
    if activity is None:
        raise ValueError("retrieval step activity is required to build monitoring observation")
    scores = [float(source.score) for source in result.references if source.score is not None]
    top_score = scores[0] if scores else None
    observation: dict[str, object] = {
        "schema_version": "retrieval-runtime-observation-v1",
        "request_id": request_id,
        "plan_id": execution.plan.plan_id,
            "step_id": activity.step_id,
            "query_mode": execution.plan.query_mode,
        "retrieval_mode": _observation_retrieval_mode(
            query_mode=execution.plan.query_mode,
            step_type=activity.step_type,
        ),
        "query_sha256": hashlib.sha256(activity.query_text.encode("utf-8")).hexdigest(),
        "scope": {"corpus": activity.corpus, "collection": activity.collection},
        "terminal_state": "failed_closed"
        if result.status in {"blocked", "failed"}
        else "completed",
        "failure_kind": activity.failure_kind or "",
        "candidate_count": activity.candidate_count,
        "reference_count": activity.reference_count,
        "top_score": top_score,
        "score_gap": _score_gap(scores),
        "top_source_ids": tuple(source.doc_id for source in result.references[:5]),
            "target_document_ids": activity.target_document_ids,
            "target_version_ids": activity.target_version_ids,
            "need_ids": activity.need_ids,
            "latency_ms": activity.latency_ms,
        }
    observation["canonical_index_truth"] = observation["retrieval_mode"] != "live_assisted"
    source_timestamps = tuple(
        str(source.anchor.get("source_timestamp") or "")
        for source in result.references
        if source.anchor.get("source_timestamp")
    )
    if source_timestamps:
        observation["source_timestamps"] = source_timestamps
    if execution.plan.version_query is not None and execution.plan.version_query.as_of:
        observation["as_of"] = execution.plan.version_query.as_of
    elif observation["retrieval_mode"] == "live_assisted":
        as_of_values = tuple(
            str(source.anchor.get("as_of") or "")
            for source in result.references
            if source.anchor.get("as_of")
        )
        if as_of_values:
            observation["as_of"] = as_of_values[0]
    if include_query_text:
        observation["query"] = activity.query_text
    if activity.reranker_degraded:
        observation["reranker_degraded"] = True
        observation["reranker_failure_kind"] = activity.reranker_failure_kind
    return observation


def _score_gap(scores: Sequence[float]) -> float | None:
    if len(scores) < 2:
        return None
    return scores[0] - scores[1]


def _observation_retrieval_mode(
    *,
    query_mode: str,
    step_type: str,
) -> str:
    if step_type == "live_source_lookup":
        return "live_assisted"
    return query_mode


def _apply_profile_gated_reranker(
    *,
    request: RetrievalRequest,
    evidence: EvidenceBundle,
    rerank_step: ExecutableRerankFn | None,
) -> tuple[EvidenceBundle, str]:
    profile = load_runtime_profile(request.corpus, request.collection)
    if not getattr(profile, "reranker_enabled_by_default", False):
        return evidence, ""
    if rerank_step is None:
        return evidence, "reranker_executor_unavailable"
    try:
        return rerank_step(
            request,
            _bounded_rerank_candidate_bundle(
                evidence,
                top_n=getattr(profile, "reranker_top_n", None),
            ),
        ), ""
    except Exception:
        _LOGGER.warning(
            "retrieval reranker degraded for %s/%s",
            request.corpus,
            request.collection,
            exc_info=True,
        )
        return evidence, "reranker_degraded"


def _bounded_rerank_candidate_bundle(
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


def _execute_freshness_gate_step(
    *,
    plan: RetrievalPlan,
    step: RetrievalStep,
) -> RetrievalStepResult:
    profile = load_runtime_profile(step.scope.corpus, step.scope.collection)
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


def _execute_live_source_lookup_step(
    *,
    plan: RetrievalPlan,
    step: RetrievalStep,
    retrieve_live_step: ExecutableLiveLookupFn | None,
    attempted_live_lookup_count: int,
) -> RetrievalStepResult:
    profile = load_runtime_profile(step.scope.corpus, step.scope.collection)
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
    evidence = _annotate_live_evidence(retrieve_live_step(step))
    latency_ms = max(0, round((time.perf_counter() - started_at) * 1000))
    return build_succeeded_step_result(step, evidence=evidence, latency_ms=latency_ms)


def _annotate_live_evidence(evidence: EvidenceBundle) -> EvidenceBundle:
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
