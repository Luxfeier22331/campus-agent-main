from __future__ import annotations

import time
from collections.abc import Callable, Sequence
from threading import Lock

from campus_contracts import AuthorizedRetrievalFilter, EvidenceBundle, PersonalizationHint
from campus_ingestion_core.corpus_profiles import load_runtime_profile

from campus_retrieval_core.backend_qdrant import QdrantRetrievalBackend, RetrievalBackendError
from campus_retrieval_core.models import (
    RetrievalExecutionResult,
    RetrievalPlan,
    RetrievalPlanBudget,
    RetrievalRequest,
    RetrievalScope,
    RetrievalSelector,
    RetrievalSourceTrustPolicy,
    RetrievalStep,
    RetrievalStepActivity,
    RetrievalStepBudget,
    RetrievalStepFailure,
    RetrievalStepResult,
)
from campus_retrieval_core.settings import RetrievalSettings

_RUNTIME_BACKEND_CACHE: dict[RetrievalSettings, QdrantRetrievalBackend] = {}
_RUNTIME_BACKEND_CACHE_LOCK = Lock()
ExecutableRetrievalRequestFn = Callable[[RetrievalRequest], EvidenceBundle]
ExecutableLiveLookupFn = Callable[[RetrievalStep], EvidenceBundle]
ReplanStepCallback = Callable[
    [RetrievalPlan, tuple[RetrievalStepResult, ...], RetrievalStepResult], Sequence[RetrievalStep]
]
_COLLECTION_MINIMUM_SOURCE_TRUST_TIER = {
    "curriculum_plan": "T0",
    "program_semester_facts": "T0",
    "program_family_facts": "T0",
    "course_facts": "T0",
    "student_rules": "T1",
    "stable_reference": "T2",
    "fresh_news": "T3",
}


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
        _build_single_step_plan(request),
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
) -> RetrievalExecutionResult:
    runtime_backend = backend if retrieve_step is None else backend
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
            result = _build_blocked_step_result(
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
            result = _build_blocked_step_result(
                step,
                failure_kind="unsupported_step_type",
                message=f"unsupported retrieval step type: {step.step_type}",
            )
        else:
            if request_executor is None:
                result = _build_blocked_step_result(
                    step,
                    failure_kind="executor_error",
                    message="indexed lookup executor is unavailable for this runtime path",
                )
                executed_steps.append(step)
                step_results.append(result)
                completed_step_ids.add(step.step_id)
                break
            request = _build_retrieval_request_from_step(
                step,
                authorized_filter=authorized_filter,
                personalization_hint=personalization_hint,
            )
            started_at = time.perf_counter()
            evidence = request_executor(request)
            latency_ms = max(0, round((time.perf_counter() - started_at) * 1000))
            result = _build_succeeded_step_result(step, evidence=evidence, latency_ms=latency_ms)

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
                        _build_failed_step_result(
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
                    validation_error = _validate_replanned_step(
                        plan=plan,
                        triggering_step=step,
                        replanned_step=additional_step,
                    )
                    if validation_error is not None:
                        step_results.append(
                            _build_failed_step_result(
                                additional_step,
                                failure_kind="executor_error",
                                message=validation_error,
                            )
                        )
                        break
                    if additional_step.step_id in known_step_ids:
                        step_results.append(
                            _build_failed_step_result(
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

    return RetrievalExecutionResult(
        plan=plan,
        step_results=tuple(step_results),
        merged_evidence=_filter_merged_evidence_by_source_trust_policy(
            _merge_step_evidence(
                executed_steps=tuple(executed_steps), step_results=tuple(step_results)
            ),
            query_mode=plan.query_mode,
            minimum_tier=plan.source_trust_policy.minimum_tier,
        ),
        replan_count=replan_count,
    )


def _build_single_step_plan(request: RetrievalRequest) -> RetrievalPlan:
    return RetrievalPlan(
        plan_id=f"{request.corpus}:{request.collection}:single-step",
        query_mode="current",
        admitted_scopes=(RetrievalScope(corpus=request.corpus, collection=request.collection),),
        version_query=None,
        source_trust_policy=RetrievalSourceTrustPolicy(
            minimum_tier=_default_minimum_source_trust_tier_for_collection(request.collection),
        ),
        budget=RetrievalPlanBudget(max_steps=1, max_replans=0, max_live_lookups=0),
        steps=(
            RetrievalStep(
                step_id="indexed-lookup",
                step_type="indexed_lookup",
                scope=RetrievalScope(corpus=request.corpus, collection=request.collection),
                query_text=request.query_text,
                selector=RetrievalSelector(
                    target_document_ids=request.target_document_ids,
                    target_version_ids=request.target_version_ids,
                    target_revision_track=request.target_revision_track,
                    preferred_document_ids=request.preferred_document_ids,
                    canonical_course_ids=request.canonical_course_ids,
                    canonical_course_family_ids=request.canonical_course_family_ids,
                    canonical_program_family_ids=request.canonical_program_family_ids,
                ),
                budget=RetrievalStepBudget(top_k=request.top_k),
                expected_output="candidate_set",
            ),
        ),
    )


def _validate_replanned_step(
    *,
    plan: RetrievalPlan,
    triggering_step: RetrievalStep,
    replanned_step: RetrievalStep,
) -> str | None:
    if replanned_step.step_type != "indexed_lookup":
        return "replanned step must stay on indexed_lookup and cannot switch to live branch"
    if replanned_step.scope != triggering_step.scope:
        return "replanned step must preserve the triggering step scope"
    if triggering_step.step_id not in replanned_step.depends_on_step_ids:
        return "replanned step must depend on the triggering step"
    if replanned_step.expected_output != triggering_step.expected_output:
        return "replanned step must preserve expected_output"

    selector_error = _validate_replanned_selector(
        original=triggering_step.selector,
        replanned=replanned_step.selector,
    )
    if selector_error is not None:
        return selector_error

    budget_error = _validate_replanned_step_budget(
        original=triggering_step.budget,
        replanned=replanned_step.budget,
    )
    if budget_error is not None:
        return budget_error

    admitted_scope_keys = {(scope.corpus, scope.collection) for scope in plan.admitted_scopes}
    if (replanned_step.scope.corpus, replanned_step.scope.collection) not in admitted_scope_keys:
        return "replanned step must stay within admitted_scopes"

    return None


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
        return _build_decision_step_result(step, status="succeeded")
    if profile.supports_freshness_sensitive_queries:
        return _build_decision_step_result(step, status="succeeded")
    if (
        plan.query_mode == "live_assisted"
        and plan.source_trust_policy.allow_live_source_lookup
        and profile.live_search_fallback_allowed
    ):
        return _build_decision_step_result(step, status="succeeded")
    return _build_blocked_step_result(
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
        return _build_blocked_step_result(
            step,
            failure_kind="live_lookup_unavailable",
            message="live source lookup is not allowed by the retrieval plan",
        )
    if not profile.live_search_fallback_allowed:
        return _build_blocked_step_result(
            step,
            failure_kind="live_lookup_unavailable",
            message="live source lookup is not admitted for this runtime profile",
        )
    if retrieve_live_step is None:
        return _build_blocked_step_result(
            step,
            failure_kind="live_lookup_unavailable",
            message="live source lookup is admitted but no live lookup executor is wired for this runtime path",
        )
    started_at = time.perf_counter()
    evidence = retrieve_live_step(step)
    latency_ms = max(0, round((time.perf_counter() - started_at) * 1000))
    return _build_succeeded_step_result(step, evidence=evidence, latency_ms=latency_ms)


def _validate_replanned_selector(
    *,
    original: RetrievalSelector,
    replanned: RetrievalSelector,
) -> str | None:
    tuple_fields = (
        "target_document_ids",
        "target_version_ids",
        "preferred_document_ids",
        "canonical_course_ids",
        "canonical_course_family_ids",
        "canonical_program_family_ids",
        "entity_keys",
    )
    for field_name in tuple_fields:
        original_values = getattr(original, field_name)
        replanned_values = getattr(replanned, field_name)
        if not original_values:
            continue
        if not replanned_values:
            return f"replanned selector must preserve {field_name}"
        if not set(replanned_values).issubset(original_values):
            return f"replanned selector must not widen {field_name}"

    if (
        original.target_revision_track
        and replanned.target_revision_track != original.target_revision_track
    ):
        return "replanned selector must preserve target_revision_track"

    return None


def _validate_replanned_step_budget(
    *,
    original: RetrievalStepBudget,
    replanned: RetrievalStepBudget,
) -> str | None:
    if replanned.top_k > original.top_k:
        return "replanned step must not widen top_k"
    if original.timeout_ms is not None and (
        replanned.timeout_ms is None or replanned.timeout_ms > original.timeout_ms
    ):
        return "replanned step must not widen timeout_ms"
    return None


def _build_retrieval_request_from_step(
    step: RetrievalStep,
    *,
    authorized_filter: AuthorizedRetrievalFilter | None,
    personalization_hint: PersonalizationHint | None,
) -> RetrievalRequest:
    return RetrievalRequest(
        query_text=step.query_text,
        corpus=step.scope.corpus,
        collection=step.scope.collection,
        target_document_ids=step.selector.target_document_ids,
        target_version_ids=step.selector.target_version_ids,
        target_revision_track=step.selector.target_revision_track,
        preferred_document_ids=step.selector.preferred_document_ids,
        canonical_course_ids=step.selector.canonical_course_ids,
        canonical_course_family_ids=step.selector.canonical_course_family_ids,
        canonical_program_family_ids=step.selector.canonical_program_family_ids,
        authorized_filter=authorized_filter,
        personalization_hint=personalization_hint,
        top_k=step.budget.top_k,
    )


def _build_succeeded_step_result(
    step: RetrievalStep,
    *,
    evidence: EvidenceBundle,
    latency_ms: int,
) -> RetrievalStepResult:
    status = "succeeded" if evidence.sources else "empty"
    return RetrievalStepResult(
        step_id=step.step_id,
        status=status,
        grounding=evidence.sources,
        references=evidence.sources,
        activity=RetrievalStepActivity(
            step_id=step.step_id,
            step_type=step.step_type,
            corpus=step.scope.corpus,
            collection=step.scope.collection,
            status=status,
            query_text=step.query_text,
            target_document_ids=step.selector.target_document_ids,
            target_version_ids=step.selector.target_version_ids,
            top_k=step.budget.top_k,
            latency_ms=latency_ms,
            candidate_count=len(evidence.sources),
            reference_count=len(evidence.sources),
        ),
    )


def _filter_merged_evidence_by_source_trust_policy(
    evidence: EvidenceBundle,
    *,
    query_mode: str,
    minimum_tier: str,
) -> EvidenceBundle:
    if query_mode not in {"freshness_sensitive", "live_assisted"}:
        return evidence
    if not minimum_tier:
        return evidence
    filtered_sources = tuple(
        source
        for source in evidence.sources
        if _source_trust_tier_satisfies_policy(
            required_tier=minimum_tier,
            observed_tier=source.source_trust_tier,
        )
    )
    if filtered_sources == evidence.sources:
        return evidence
    return EvidenceBundle(
        query_text=evidence.query_text,
        corpus=evidence.corpus,
        collection=evidence.collection,
        sources=filtered_sources,
    )


def _source_trust_tier_satisfies_policy(
    *,
    required_tier: str,
    observed_tier: str,
) -> bool:
    if not observed_tier:
        return False
    if required_tier == "T0":
        return observed_tier == "T0"
    if required_tier == "T1":
        return observed_tier in {"T0", "T1"}
    if required_tier == "T2":
        return observed_tier == "T2"
    if required_tier == "T3":
        return observed_tier == "T3"
    return False


def _default_minimum_source_trust_tier_for_collection(collection: str) -> str:
    return _COLLECTION_MINIMUM_SOURCE_TRUST_TIER.get(collection.strip(), "T1")


def _build_decision_step_result(
    step: RetrievalStep,
    *,
    status: str,
) -> RetrievalStepResult:
    return RetrievalStepResult(
        step_id=step.step_id,
        status=status,
        activity=RetrievalStepActivity(
            step_id=step.step_id,
            step_type=step.step_type,
            corpus=step.scope.corpus,
            collection=step.scope.collection,
            status=status,
            query_text=step.query_text,
            target_document_ids=step.selector.target_document_ids,
            target_version_ids=step.selector.target_version_ids,
            top_k=step.budget.top_k,
            candidate_count=0,
            reference_count=0,
        ),
    )


def _build_blocked_step_result(
    step: RetrievalStep,
    *,
    failure_kind: str,
    message: str,
) -> RetrievalStepResult:
    return RetrievalStepResult(
        step_id=step.step_id,
        status="blocked",
        activity=RetrievalStepActivity(
            step_id=step.step_id,
            step_type=step.step_type,
            corpus=step.scope.corpus,
            collection=step.scope.collection,
            status="blocked",
            query_text=step.query_text,
            target_document_ids=step.selector.target_document_ids,
            target_version_ids=step.selector.target_version_ids,
            top_k=step.budget.top_k,
            candidate_count=0,
            reference_count=0,
            failure_kind=failure_kind,
        ),
        failure=RetrievalStepFailure(failure_kind=failure_kind, terminal=True, message=message),
    )


def _build_failed_step_result(
    step: RetrievalStep,
    *,
    failure_kind: str,
    message: str,
) -> RetrievalStepResult:
    failure_step_id = f"{step.step_id}:failure"
    return RetrievalStepResult(
        step_id=failure_step_id,
        status="failed",
        activity=RetrievalStepActivity(
            step_id=failure_step_id,
            step_type=step.step_type,
            corpus=step.scope.corpus,
            collection=step.scope.collection,
            status="failed",
            query_text=step.query_text,
            target_document_ids=step.selector.target_document_ids,
            target_version_ids=step.selector.target_version_ids,
            top_k=step.budget.top_k,
            candidate_count=0,
            reference_count=0,
            failure_kind=failure_kind,
        ),
        failure=RetrievalStepFailure(failure_kind=failure_kind, terminal=True, message=message),
    )


def _merge_step_evidence(
    *,
    executed_steps: tuple[RetrievalStep, ...],
    step_results: tuple[RetrievalStepResult, ...],
) -> EvidenceBundle:
    ordered_sources: dict[str, object] = {}
    query_text = ""
    final_scope = executed_steps[0].scope

    for step, result in zip(executed_steps, step_results, strict=False):
        if not query_text:
            query_text = step.query_text
        for source in result.grounding:
            chunk_id = getattr(source, "chunk_id", "")
            dedupe_key = chunk_id or repr(source)
            ordered_sources.setdefault(dedupe_key, source)

    return EvidenceBundle(
        query_text=query_text,
        corpus=final_scope.corpus,
        collection=final_scope.collection,
        sources=tuple(ordered_sources.values()),
    )
