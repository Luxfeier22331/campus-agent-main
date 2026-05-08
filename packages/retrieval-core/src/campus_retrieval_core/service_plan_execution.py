from __future__ import annotations

from collections.abc import Callable, Sequence

from campus_contracts import AuthorizedRetrievalFilter, EvidenceBundle, PersonalizationHint

from campus_retrieval_core.models import (
    RetrievalExecutionResult,
    RetrievalPlan,
    RetrievalRequest,
    RetrievalStep,
    RetrievalStepResult,
)
from campus_retrieval_core.service_execution import (
    build_blocked_step_result,
    build_failed_step_result,
    filter_merged_evidence_by_source_trust_policy,
    merge_step_evidence,
    validate_replanned_step,
)
from campus_retrieval_core.service_step_executor import (
    classify_retrieval_exception_failure_kind,
    execute_freshness_gate_step,
    execute_index_backed_step,
    execute_live_source_lookup_step,
)

ExecutableRetrievalRequestFn = Callable[[RetrievalRequest], EvidenceBundle]
ExecutableLiveLookupFn = Callable[[RetrievalStep], EvidenceBundle]
ExecutableRerankFn = Callable[[RetrievalRequest, EvidenceBundle], EvidenceBundle]
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


def execute_retrieval_plan(
    plan: RetrievalPlan,
    *,
    authorized_filter: AuthorizedRetrievalFilter | None = None,
    personalization_hint: PersonalizationHint | None = None,
    backend=None,
    retrieve_step: ExecutableRetrievalRequestFn | None = None,
    retrieve_live_step: ExecutableLiveLookupFn | None = None,
    rerank_step: ExecutableRerankFn | None = None,
    replan_callback: ReplanStepCallback | None = None,
    observation_sink=None,
    observation_request_id: str = "",
    include_observation_query_text: bool = False,
    build_retrieval_backend_fn=None,
    load_runtime_profile_fn=None,
    emit_retrieval_observations_fn=None,
    logger=None,
) -> RetrievalExecutionResult:
    runtime_backend = backend
    needs_indexed_executor = any(
        step.step_type in _INDEX_BACKED_RETRIEVAL_STEP_TYPES for step in plan.steps
    )
    if runtime_backend is None and retrieve_step is None and needs_indexed_executor:
        runtime_backend = build_retrieval_backend_fn()
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
            result = execute_freshness_gate_step(
                plan=plan,
                step=step,
                load_runtime_profile_fn=load_runtime_profile_fn,
            )
        elif step.step_type == "live_source_lookup":
            result = execute_live_source_lookup_step(
                plan=plan,
                step=step,
                retrieve_live_step=retrieve_live_step,
                attempted_live_lookup_count=live_lookup_count,
                load_runtime_profile_fn=load_runtime_profile_fn,
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
                result = execute_index_backed_step(
                    step,
                    plan=plan,
                    authorized_filter=authorized_filter,
                    personalization_hint=personalization_hint,
                    request_executor=request_executor,
                    rerank_step=rerank_step,
                    load_runtime_profile_fn=load_runtime_profile_fn,
                    logger=logger,
                )
            except Exception as exc:
                result = build_failed_step_result(
                    step,
                    failure_kind=classify_retrieval_exception_failure_kind(exc),
                    message=str(exc),
                )
                executed_steps.append(step)
                step_results.append(result)
                completed_step_ids.add(step.step_id)
                if observation_sink is not None:
                    emit_retrieval_observations_fn(
                        execution=build_execution_result(
                            plan=plan,
                            executed_steps=tuple(executed_steps),
                            step_results=tuple(step_results),
                            replan_count=replan_count,
                        ),
                        observation_sink=observation_sink,
                        request_id=observation_request_id,
                        include_query_text=include_observation_query_text,
                        logger=logger,
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

    execution = build_execution_result(
        plan=plan,
        executed_steps=tuple(executed_steps),
        step_results=tuple(step_results),
        replan_count=replan_count,
    )
    if observation_sink is not None:
        emit_retrieval_observations_fn(
            execution=execution,
            observation_sink=observation_sink,
            request_id=observation_request_id,
            include_query_text=include_observation_query_text,
            logger=logger,
        )
    return execution


def build_execution_result(
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


__all__ = [
    "ExecutableLiveLookupFn",
    "ExecutableRerankFn",
    "ExecutableRetrievalRequestFn",
    "ReplanStepCallback",
    "build_execution_result",
    "execute_retrieval_plan",
]
