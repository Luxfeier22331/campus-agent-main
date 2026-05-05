from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass

from campus_contracts import AgentRequest, EvidenceBundle, KnowledgeScope
from campus_ingestion_core import (
    build_document_registry_from_env,
    load_runtime_profile,
    resolve_version_query,
)
from campus_retrieval_core import (
    CorpusQueryDisabledError as _CorpusQueryDisabledError,
)
from campus_retrieval_core import (
    RestrictedDocumentAccessDeniedError as _RestrictedDocumentAccessDeniedError,
)
from campus_retrieval_core import (
    RetrievalBackendError as _RetrievalBackendError,
)
from campus_retrieval_core import (
    RetrievalExecutionResult,
    RetrievalPlan,
    execute_retrieval_plan,
)
from campus_retrieval_core import (
    retrieve_sources as _retrieve_sources,
)
from campus_retrieval_core.curriculum_query_resolution import interpret_curriculum_query

from campus_rag_agent.agentic_depth_diagnostics import build_planner_information_needs
from campus_rag_agent.remote_content_hardening import apply_remote_content_suspicion_labels
from campus_rag_agent.retrieval_plan import build_ordered_retrieval_plan
from campus_rag_agent.semantic_replan import build_semantic_replan_steps

from .service_common import (
    _execute_retrieval_request_with_callable_retriever,
    _with_query_text,
)
from .service_curriculum import _resolve_curriculum_course_fact_target_document_ids
from .service_scope_curriculum import (
    _resolve_curriculum_program_semester_fact_target_document_ids,
    _should_use_curriculum_program_semester_facts,
)
from .service_versioning_context import (
    _resolve_retrieval_query_mode,
    _resolve_version_answer_context,
    _VersionAnswerContext,
)

Retriever = Callable[..., object]
RetrievalObservationSink = Callable[[dict[str, object]], None]
CorpusQueryDisabledError = _CorpusQueryDisabledError
RestrictedDocumentAccessDeniedError = _RestrictedDocumentAccessDeniedError
RetrievalBackendError = _RetrievalBackendError
retrieve_sources = _retrieve_sources
_COURSE_FAMILY_SCHEDULE_TOP_K = 8


@dataclass(frozen=True, slots=True)
class RagRetrievalContext:
    retrieval_goal: str
    retrieval_collection: str
    target_document_ids: tuple[str, ...]
    preferred_document_ids: tuple[str, ...]
    canonical_course_ids: tuple[str, ...]
    canonical_course_family_ids: tuple[str, ...]
    canonical_program_family_ids: tuple[str, ...]
    retrieval_top_k: int | None
    version_answer_context: _VersionAnswerContext


@dataclass(frozen=True, slots=True)
class RagRetrievalResult:
    evidence: EvidenceBundle
    execution_result: RetrievalExecutionResult


def build_rag_retrieval_context(
    *,
    request: AgentRequest,
    effective_scope: KnowledgeScope,
    user_goal: str,
    effective_user_goal: str,
    handbook_plan,
    curriculum_plan,
    curriculum_course_plan,
    curriculum_program_family_plan,
    build_document_registry_from_env_fn: Callable[[], object] | None = None,
    resolve_version_query_fn: Callable[..., object] | None = None,
) -> RagRetrievalContext | None:
    retrieval_goal = user_goal
    target_document_ids: tuple[str, ...] = ()
    preferred_document_ids: tuple[str, ...] = ()
    retrieval_collection = effective_scope.collection
    canonical_course_ids: tuple[str, ...] = ()
    canonical_course_family_ids: tuple[str, ...] = ()
    canonical_program_family_ids: tuple[str, ...] = ()
    retrieval_top_k: int | None = None

    if effective_scope.corpus == "curriculum" and effective_scope.collection == "curriculum_plan":
        if (
            curriculum_program_family_plan is not None
            and curriculum_program_family_plan.resolution_mode == "resolved_family"
        ):
            retrieval_collection = curriculum_program_family_plan.internal_collection
            canonical_program_family_ids = (
                curriculum_program_family_plan.canonical_program_family_id,
            )
        elif curriculum_course_plan is not None:
            retrieval_collection = curriculum_course_plan.internal_collection
            target_document_ids = _resolve_curriculum_course_fact_target_document_ids(
                curriculum_course_plan
            )
            canonical_course_ids = (
                (curriculum_course_plan.canonical_course_id,)
                if curriculum_course_plan.canonical_course_id
                else ()
            )
            canonical_course_family_ids = (
                (curriculum_course_plan.canonical_course_family_id,)
                if (
                    curriculum_course_plan.entity_type == "course_family"
                    and curriculum_course_plan.canonical_course_family_id
                )
                else ()
            )
            if (
                curriculum_course_plan.entity_type == "course_family"
                and curriculum_course_plan.fact_intent == "schedule"
            ):
                retrieval_top_k = _COURSE_FAMILY_SCHEDULE_TOP_K
        elif _should_use_curriculum_program_semester_facts(
            curriculum_plan=curriculum_plan,
            user_goal=effective_user_goal,
        ):
            retrieval_collection = "program_semester_facts"
            retrieval_goal = curriculum_plan.rewritten_query_text
            target_document_ids = _resolve_curriculum_program_semester_fact_target_document_ids(
                curriculum_plan=curriculum_plan,
                user_goal=effective_user_goal,
            )
        elif curriculum_plan is not None and curriculum_plan.status in {
            "resolved",
            "soft_preference",
        }:
            retrieval_goal = curriculum_plan.rewritten_query_text
            target_document_ids = curriculum_plan.target_document_ids
            preferred_document_ids = curriculum_plan.preferred_document_ids
        else:
            retrieval_goal = interpret_curriculum_query(effective_user_goal).normalized_query_text
    elif handbook_plan is not None and handbook_plan.status == "resolved":
        retrieval_goal = handbook_plan.rewritten_query_text
        target_document_ids = handbook_plan.target_document_ids

    version_answer_context = _resolve_version_answer_context(
        request=request,
        resolved_scope=effective_scope,
        retrieval_collection=retrieval_collection,
        target_document_ids=target_document_ids,
        build_document_registry_from_env_fn=(
            build_document_registry_from_env_fn or build_document_registry_from_env
        ),
        resolve_version_query_fn=resolve_version_query_fn or resolve_version_query,
    )
    if version_answer_context is None:
        return None

    return RagRetrievalContext(
        retrieval_goal=retrieval_goal,
        retrieval_collection=retrieval_collection,
        target_document_ids=target_document_ids,
        preferred_document_ids=preferred_document_ids,
        canonical_course_ids=canonical_course_ids,
        canonical_course_family_ids=canonical_course_family_ids,
        canonical_program_family_ids=canonical_program_family_ids,
        retrieval_top_k=retrieval_top_k,
        version_answer_context=version_answer_context,
    )


def build_retrieval_plan_for_context(
    *,
    request: AgentRequest,
    effective_scope: KnowledgeScope,
    user_goal: str,
    retrieval_context: RagRetrievalContext,
) -> RetrievalPlan:
    runtime_profile = load_runtime_profile(
        effective_scope.corpus, retrieval_context.retrieval_collection
    )
    retrieval_query_mode = _resolve_retrieval_query_mode(
        resolved_scope=effective_scope,
        retrieval_collection=retrieval_context.retrieval_collection,
        user_goal=user_goal,
        version_mode=retrieval_context.version_answer_context.mode,
    )
    information_needs = build_planner_information_needs(
        user_goal=user_goal,
        effective_scope=effective_scope,
        retrieval_collection=retrieval_context.retrieval_collection,
        query_mode=retrieval_query_mode,
    )
    return build_ordered_retrieval_plan(
        query_text=retrieval_context.retrieval_goal,
        scope=effective_scope,
        retrieval_collection=retrieval_context.retrieval_collection,
        query_mode=retrieval_query_mode,
        target_document_ids=retrieval_context.target_document_ids,
        target_version_ids=retrieval_context.version_answer_context.target_version_ids,
        target_revision_track=retrieval_context.version_answer_context.target_revision_track,
        preferred_document_ids=retrieval_context.preferred_document_ids,
        canonical_course_ids=retrieval_context.canonical_course_ids,
        canonical_course_family_ids=retrieval_context.canonical_course_family_ids,
        canonical_program_family_ids=retrieval_context.canonical_program_family_ids,
        top_k=retrieval_context.retrieval_top_k or runtime_profile.retrieval_top_k,
        version_query=request.payload.version_query,
        primary_version_id=retrieval_context.version_answer_context.primary_version_id,
        comparison_version_id=retrieval_context.version_answer_context.comparison_version_id,
        need_ids=tuple(need.need_id for need in information_needs),
        allow_live_source_lookup=runtime_profile.live_search_fallback_allowed,
    )


def execute_rag_retrieval_context(
    *,
    request: AgentRequest,
    effective_scope: KnowledgeScope,
    user_goal: str,
    effective_user_goal: str,
    personalization_hint,
    retriever: Retriever,
    retrieval_context: RagRetrievalContext,
    retrieval_plan: RetrievalPlan,
    retrieval_observation_sink: RetrievalObservationSink | None = None,
    include_retrieval_observation_query_text: bool = False,
) -> RagRetrievalResult:
    execution_result = execute_retrieval_plan(
        retrieval_plan,
        authorized_filter=request.context.authorization.retrieval_filter,
        personalization_hint=personalization_hint,
        retrieve_step=lambda retrieval_request: _execute_retrieval_request_with_callable_retriever(
            retriever,
            retrieval_request,
        ),
        replan_callback=build_semantic_replan_steps,
        observation_sink=retrieval_observation_sink,
        observation_request_id=request.request_id,
        include_observation_query_text=include_retrieval_observation_query_text,
    )
    evidence = execution_result.merged_evidence
    evidence = _with_query_text(
        evidence,
        effective_user_goal
        if effective_scope.corpus == "curriculum"
        and effective_scope.collection == "curriculum_plan"
        else user_goal,
    )
    apply_remote_content_suspicion_labels(evidence)
    return RagRetrievalResult(evidence=evidence, execution_result=execution_result)
