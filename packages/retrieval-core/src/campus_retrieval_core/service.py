from __future__ import annotations

import hashlib
import time
from collections.abc import Callable, Sequence
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
ExecutableRetrievalRequestFn = Callable[[RetrievalRequest], EvidenceBundle]
ExecutableLiveLookupFn = Callable[[RetrievalStep], EvidenceBundle]
RetrievalObservationSink = Callable[[dict[str, object]], None]
ReplanStepCallback = Callable[
    [RetrievalPlan, tuple[RetrievalStepResult, ...], RetrievalStepResult], Sequence[RetrievalStep]
]


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
    replan_callback: ReplanStepCallback | None = None,
    observation_sink: RetrievalObservationSink | None = None,
    observation_request_id: str = "",
) -> RetrievalExecutionResult:
    runtime_backend = backend
    needs_indexed_executor = any(step.step_type == "indexed_lookup" for step in plan.steps)
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
            )
        elif step.step_type != "indexed_lookup":
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
                    message="indexed lookup executor is unavailable for this runtime path",
                )
                executed_steps.append(step)
                step_results.append(result)
                completed_step_ids.add(step.step_id)
                break
            request = build_retrieval_request_from_step(
                step,
                authorized_filter=authorized_filter,
                personalization_hint=personalization_hint,
            )
            started_at = time.perf_counter()
            evidence = request_executor(request)
            latency_ms = max(0, round((time.perf_counter() - started_at) * 1000))
            result = build_succeeded_step_result(step, evidence=evidence, latency_ms=latency_ms)

        executed_steps.append(step)
        step_results.append(result)
        completed_step_ids.add(step.step_id)
        if result.status in {"blocked", "failed"} and step.step_type in {
            "freshness_gate",
            "live_source_lookup",
        }:
            break

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

    execution = RetrievalExecutionResult(
        plan=plan,
        step_results=tuple(step_results),
        merged_evidence=filter_merged_evidence_by_source_trust_policy(
            merge_step_evidence(
                executed_steps=tuple(executed_steps),
                step_results=tuple(step_results),
            ),
            query_mode=plan.query_mode,
            minimum_tier=plan.source_trust_policy.minimum_tier,
        ),
        replan_count=replan_count,
    )
    if observation_sink is not None:
        _emit_retrieval_observations(
            execution=execution,
            observation_sink=observation_sink,
            request_id=observation_request_id,
        )
    return execution


def _emit_retrieval_observations(
    *,
    execution: RetrievalExecutionResult,
    observation_sink: RetrievalObservationSink,
    request_id: str,
) -> None:
    for index, result in enumerate(execution.step_results, start=1):
        if result.activity is None:
            continue
        observation_sink(
            _build_retrieval_observation(
                execution=execution,
                result=result,
                request_id=request_id or f"{execution.plan.plan_id}:step-{index}",
            )
        )


def _build_retrieval_observation(
    *,
    execution: RetrievalExecutionResult,
    result: RetrievalStepResult,
    request_id: str,
) -> dict[str, object]:
    activity = result.activity
    if activity is None:
        raise ValueError("retrieval step activity is required to build monitoring observation")
    scores = [float(source.score) for source in result.references if source.score is not None]
    top_score = scores[0] if scores else None
    return {
        "schema_version": "retrieval-runtime-observation-v1",
        "request_id": request_id,
        "plan_id": execution.plan.plan_id,
        "step_id": activity.step_id,
        "query": activity.query_text,
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
        "latency_ms": activity.latency_ms,
    }


def _score_gap(scores: Sequence[float]) -> float | None:
    if len(scores) < 2:
        return None
    return scores[0] - scores[1]


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
) -> RetrievalStepResult:
    profile = load_runtime_profile(step.scope.corpus, step.scope.collection)
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
    evidence = retrieve_live_step(step)
    latency_ms = max(0, round((time.perf_counter() - started_at) * 1000))
    return build_succeeded_step_result(step, evidence=evidence, latency_ms=latency_ms)
