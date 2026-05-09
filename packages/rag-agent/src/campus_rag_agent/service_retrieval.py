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
    RetrievalPlanBudget,
    RetrievalScope,
    RetrievalSelector,
    RetrievalSemanticHint,
    RetrievalSourceTrustPolicy,
    RetrievalStep,
    RetrievalStepBudget,
    execute_retrieval_plan,
)
from campus_retrieval_core import (
    retrieve_sources as _retrieve_sources,
)
from campus_retrieval_core.curriculum_query_resolution import interpret_curriculum_query

from campus_rag_agent.agentic_depth_diagnostics import build_planner_information_needs
from campus_rag_agent.remote_content_hardening import apply_remote_content_suspicion_labels
from campus_rag_agent.retrieval_intent import RetrievalIntent
from campus_rag_agent.retrieval_plan import (
    DEFAULT_INDEXED_LOOKUP_TIMEOUT_MS,
    _default_minimum_source_trust_tier,
    build_ordered_retrieval_plan,
)
from campus_rag_agent.semantic_replan import build_semantic_replan_steps

from .institutional_rules_query_planning import (
    InstitutionalRulesQueryPlan,
    plan_institutional_rules_query,
)
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
_HANDBOOK_CATEGORY_DISCOVERY_TOP_K = 10
_HANDBOOK_CATEGORY_MEMBER_TOP_K = 2


@dataclass(frozen=True, slots=True)
class RagRetrievalContext:
    retrieval_goal: str
    focused_retrieval_goal: str
    retrieval_collection: str
    target_document_ids: tuple[str, ...]
    preferred_document_ids: tuple[str, ...]
    focus_detail_labels: tuple[str, ...]
    focus_article_nos: tuple[str, ...]
    focus_clause_nos: tuple[str, ...]
    focus_terms: tuple[str, ...]
    category_member_document_ids: tuple[str, ...]
    canonical_course_ids: tuple[str, ...]
    canonical_course_family_ids: tuple[str, ...]
    canonical_program_family_ids: tuple[str, ...]
    retrieval_top_k: int | None
    focused_retrieval_top_k: int | None
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
    institutional_rules_plan: InstitutionalRulesQueryPlan | None = None,
    curriculum_plan,
    curriculum_course_plan,
    curriculum_program_family_plan,
    build_document_registry_from_env_fn: Callable[[], object] | None = None,
    resolve_version_query_fn: Callable[..., object] | None = None,
) -> RagRetrievalContext | None:
    retrieval_goal = user_goal
    focused_retrieval_goal = user_goal
    target_document_ids: tuple[str, ...] = ()
    preferred_document_ids: tuple[str, ...] = ()
    focus_detail_labels: tuple[str, ...] = ()
    focus_article_nos: tuple[str, ...] = ()
    focus_clause_nos: tuple[str, ...] = ()
    focus_terms: tuple[str, ...] = ()
    category_member_document_ids: tuple[str, ...] = ()
    retrieval_collection = effective_scope.collection
    canonical_course_ids: tuple[str, ...] = ()
    canonical_course_family_ids: tuple[str, ...] = ()
    canonical_program_family_ids: tuple[str, ...] = ()
    retrieval_top_k: int | None = None
    focused_retrieval_top_k: int | None = None

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
    elif (
        handbook_plan is not None
        and handbook_plan.status == "resolved"
        and handbook_plan.task_kind == "category_discovery"
    ):
        retrieval_goal = user_goal
        focused_retrieval_goal = user_goal
        preferred_document_ids = handbook_plan.preferred_document_ids
        category_member_document_ids = handbook_plan.category_member_document_ids
        retrieval_top_k = _HANDBOOK_CATEGORY_DISCOVERY_TOP_K
    elif handbook_plan is not None and handbook_plan.status == "resolved":
        retrieval_goal = handbook_plan.rewritten_query_text
        focused_retrieval_goal = (
            handbook_plan.focused_query_text or handbook_plan.rewritten_query_text
        )
        target_document_ids = handbook_plan.target_document_ids
        focus_detail_labels = handbook_plan.focus_detail_labels
        focus_article_nos = handbook_plan.focus_article_nos
        focus_clause_nos = handbook_plan.focus_clause_nos
        focus_terms = handbook_plan.focus_terms
        focused_retrieval_top_k = 4
    elif (
        effective_scope.corpus == "regulations"
        and effective_scope.collection == "institutional_rules"
    ):
        resolved_institutional_rules_plan = (
            institutional_rules_plan or plan_institutional_rules_query(effective_user_goal)
        )
        target_document_ids = resolved_institutional_rules_plan.target_document_ids

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
        focused_retrieval_goal=focused_retrieval_goal,
        retrieval_collection=retrieval_collection,
        target_document_ids=target_document_ids,
        preferred_document_ids=preferred_document_ids,
        focus_detail_labels=focus_detail_labels,
        focus_article_nos=focus_article_nos,
        focus_clause_nos=focus_clause_nos,
        focus_terms=focus_terms,
        category_member_document_ids=category_member_document_ids,
        canonical_course_ids=canonical_course_ids,
        canonical_course_family_ids=canonical_course_family_ids,
        canonical_program_family_ids=canonical_program_family_ids,
        retrieval_top_k=retrieval_top_k,
        focused_retrieval_top_k=focused_retrieval_top_k,
        version_answer_context=version_answer_context,
    )


def build_retrieval_plan_for_context(
    *,
    request: AgentRequest,
    effective_scope: KnowledgeScope,
    user_goal: str,
    retrieval_context: RagRetrievalContext,
    retrieval_intent: RetrievalIntent | None = None,
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
        retrieval_intent=retrieval_intent,
    )
    if retrieval_context.category_member_document_ids:
        return _build_category_discovery_retrieval_plan(
            query_text=retrieval_context.retrieval_goal,
            scope=effective_scope,
            retrieval_collection=retrieval_context.retrieval_collection,
            query_mode=retrieval_query_mode,
            member_document_ids=retrieval_context.category_member_document_ids,
            preferred_document_ids=retrieval_context.preferred_document_ids,
            top_k=retrieval_context.retrieval_top_k or runtime_profile.retrieval_top_k,
            need_ids=tuple(need.need_id for need in information_needs),
            semantic_hint=_semantic_hint_from_retrieval_intent(retrieval_intent),
            version_query=request.payload.version_query,
            allow_live_source_lookup=runtime_profile.live_search_fallback_allowed,
        )
    if (
        effective_scope.corpus == "regulations"
        and effective_scope.collection == "student_rules"
        and retrieval_context.target_document_ids
        and retrieval_context.version_answer_context.mode == "current"
        and retrieval_context.focused_retrieval_goal.strip()
        != retrieval_context.retrieval_goal.strip()
    ):
        return _build_specific_policy_focused_retrieval_plan(
            broad_query_text=retrieval_context.retrieval_goal,
            focused_query_text=retrieval_context.focused_retrieval_goal,
            scope=effective_scope,
            retrieval_collection=retrieval_context.retrieval_collection,
            query_mode=retrieval_query_mode,
            target_document_ids=retrieval_context.target_document_ids,
            focus_detail_labels=retrieval_context.focus_detail_labels,
            focus_article_nos=retrieval_context.focus_article_nos,
            focus_clause_nos=retrieval_context.focus_clause_nos,
            focus_terms=retrieval_context.focus_terms,
            top_k=retrieval_context.retrieval_top_k or runtime_profile.retrieval_top_k,
            focused_top_k=retrieval_context.focused_retrieval_top_k
            or runtime_profile.retrieval_top_k,
            need_ids=tuple(need.need_id for need in information_needs),
            semantic_hint=_semantic_hint_from_retrieval_intent(retrieval_intent),
            version_query=request.payload.version_query,
            allow_live_source_lookup=runtime_profile.live_search_fallback_allowed,
        )
    if (
        effective_scope.corpus == "regulations"
        and effective_scope.collection == "student_rules"
        and retrieval_context.target_document_ids
        and retrieval_context.version_answer_context.mode in {"historical", "as_of", "compare"}
        and retrieval_context.focused_retrieval_goal.strip()
        != retrieval_context.retrieval_goal.strip()
    ):
        return build_ordered_retrieval_plan(
            query_text=retrieval_context.focused_retrieval_goal,
            scope=effective_scope,
            retrieval_collection=retrieval_context.retrieval_collection,
            query_mode=retrieval_query_mode,
            target_document_ids=retrieval_context.target_document_ids,
            target_version_ids=retrieval_context.version_answer_context.target_version_ids,
            target_revision_track=retrieval_context.version_answer_context.target_revision_track,
            preferred_document_ids=retrieval_context.preferred_document_ids,
            focus_detail_labels=retrieval_context.focus_detail_labels,
            focus_article_nos=retrieval_context.focus_article_nos,
            focus_clause_nos=retrieval_context.focus_clause_nos,
            focus_terms=retrieval_context.focus_terms,
            canonical_course_ids=retrieval_context.canonical_course_ids,
            canonical_course_family_ids=retrieval_context.canonical_course_family_ids,
            canonical_program_family_ids=retrieval_context.canonical_program_family_ids,
            top_k=retrieval_context.focused_retrieval_top_k or runtime_profile.retrieval_top_k,
            version_query=request.payload.version_query,
            primary_version_id=retrieval_context.version_answer_context.primary_version_id,
            comparison_version_id=retrieval_context.version_answer_context.comparison_version_id,
            need_ids=tuple(need.need_id for need in information_needs),
            semantic_hint=_semantic_hint_from_retrieval_intent(retrieval_intent),
            allow_live_source_lookup=runtime_profile.live_search_fallback_allowed,
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
        focus_detail_labels=retrieval_context.focus_detail_labels,
        focus_article_nos=retrieval_context.focus_article_nos,
        focus_clause_nos=retrieval_context.focus_clause_nos,
        focus_terms=retrieval_context.focus_terms,
        canonical_course_ids=retrieval_context.canonical_course_ids,
        canonical_course_family_ids=retrieval_context.canonical_course_family_ids,
        canonical_program_family_ids=retrieval_context.canonical_program_family_ids,
        top_k=retrieval_context.retrieval_top_k or runtime_profile.retrieval_top_k,
        version_query=request.payload.version_query,
        primary_version_id=retrieval_context.version_answer_context.primary_version_id,
        comparison_version_id=retrieval_context.version_answer_context.comparison_version_id,
        need_ids=tuple(need.need_id for need in information_needs),
        semantic_hint=_semantic_hint_from_retrieval_intent(retrieval_intent),
        allow_live_source_lookup=runtime_profile.live_search_fallback_allowed,
    )


def _build_category_discovery_retrieval_plan(
    *,
    query_text: str,
    scope: KnowledgeScope,
    retrieval_collection: str,
    query_mode: str,
    member_document_ids: tuple[str, ...],
    preferred_document_ids: tuple[str, ...],
    top_k: int,
    need_ids: tuple[str, ...],
    semantic_hint: RetrievalSemanticHint | None,
    version_query,
    allow_live_source_lookup: bool,
) -> RetrievalPlan:
    admitted_scope = RetrievalScope(corpus=scope.corpus, collection=retrieval_collection)
    broad_step = RetrievalStep(
        step_id="category-broad-lookup",
        step_type="indexed_lookup",
        scope=admitted_scope,
        query_text=query_text,
        need_ids=need_ids,
        semantic_hint=semantic_hint,
        selector=RetrievalSelector(preferred_document_ids=preferred_document_ids),
        budget=RetrievalStepBudget(top_k=top_k, timeout_ms=DEFAULT_INDEXED_LOOKUP_TIMEOUT_MS),
        expected_output="candidate_set",
    )
    member_steps = tuple(
        RetrievalStep(
            step_id=f"category-member-lookup-{index}",
            step_type="indexed_lookup",
            scope=admitted_scope,
            query_text=query_text,
            need_ids=need_ids,
            semantic_hint=semantic_hint,
            selector=RetrievalSelector(target_document_ids=(document_id,)),
            budget=RetrievalStepBudget(
                top_k=_HANDBOOK_CATEGORY_MEMBER_TOP_K,
                timeout_ms=DEFAULT_INDEXED_LOOKUP_TIMEOUT_MS,
            ),
            expected_output="candidate_set",
        )
        for index, document_id in enumerate(member_document_ids, start=1)
    )
    steps = (broad_step, *member_steps)
    return RetrievalPlan(
        plan_id=f"{scope.corpus}:{retrieval_collection}:{query_mode}:category-discovery",
        query_mode=query_mode,
        admitted_scopes=(admitted_scope,),
        version_query=version_query,
        source_trust_policy=RetrievalSourceTrustPolicy(
            minimum_tier=_default_minimum_source_trust_tier(
                retrieval_collection=retrieval_collection,
                query_mode=query_mode,
            ),
            allow_live_source_lookup=allow_live_source_lookup,
            legacy_fallback_mode="target_v3_only",
        ),
        budget=RetrievalPlanBudget(
            max_steps=len(steps),
            max_replans=0,
            max_live_lookups=0,
        ),
        steps=steps,
    )


def _build_specific_policy_focused_retrieval_plan(
    *,
    broad_query_text: str,
    focused_query_text: str,
    scope: KnowledgeScope,
    retrieval_collection: str,
    query_mode: str,
    target_document_ids: tuple[str, ...],
    focus_detail_labels: tuple[str, ...],
    focus_article_nos: tuple[str, ...],
    focus_clause_nos: tuple[str, ...],
    focus_terms: tuple[str, ...],
    top_k: int,
    focused_top_k: int,
    need_ids: tuple[str, ...],
    semantic_hint: RetrievalSemanticHint | None,
    version_query,
    allow_live_source_lookup: bool,
) -> RetrievalPlan:
    admitted_scope = RetrievalScope(corpus=scope.corpus, collection=retrieval_collection)
    broad_step = RetrievalStep(
        step_id="policy-broad-lookup",
        step_type="indexed_lookup",
        scope=admitted_scope,
        query_text=broad_query_text,
        need_ids=need_ids,
        semantic_hint=semantic_hint,
        selector=RetrievalSelector(
            target_document_ids=target_document_ids,
            focus_detail_labels=focus_detail_labels,
            focus_article_nos=focus_article_nos,
            focus_clause_nos=focus_clause_nos,
            focus_terms=focus_terms,
        ),
        budget=RetrievalStepBudget(top_k=top_k, timeout_ms=DEFAULT_INDEXED_LOOKUP_TIMEOUT_MS),
        expected_output="candidate_set",
    )
    focused_step = RetrievalStep(
        step_id="policy-focused-lookup",
        step_type="indexed_lookup",
        scope=admitted_scope,
        query_text=focused_query_text,
        need_ids=need_ids,
        semantic_hint=semantic_hint,
        depends_on_step_ids=("policy-broad-lookup",),
        selector=RetrievalSelector(
            target_document_ids=target_document_ids,
            focus_detail_labels=focus_detail_labels,
            focus_article_nos=focus_article_nos,
            focus_clause_nos=focus_clause_nos,
            focus_terms=focus_terms,
        ),
        budget=RetrievalStepBudget(
            top_k=focused_top_k,
            timeout_ms=DEFAULT_INDEXED_LOOKUP_TIMEOUT_MS,
        ),
        expected_output="candidate_set",
    )
    steps = (broad_step, focused_step)
    return RetrievalPlan(
        plan_id=f"{scope.corpus}:{retrieval_collection}:{query_mode}:specific-policy-focus",
        query_mode=query_mode,
        admitted_scopes=(admitted_scope,),
        version_query=version_query,
        source_trust_policy=RetrievalSourceTrustPolicy(
            minimum_tier=_default_minimum_source_trust_tier(
                retrieval_collection=retrieval_collection,
                query_mode=query_mode,
            ),
            allow_live_source_lookup=allow_live_source_lookup,
            legacy_fallback_mode="target_v3_only",
        ),
        budget=RetrievalPlanBudget(
            max_steps=len(steps) + 1,
            max_replans=1,
            max_live_lookups=0,
        ),
        steps=steps,
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
        replan_callback=lambda plan, results, last_result: build_semantic_replan_steps(
            plan,
            results,
            last_result,
        ),
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
    kind = retrieval_intent.kind
    if kind == "policy_list":
        return ("policy_list",)
    if kind == "policy_object_lookup":
        return ("policy_object",)
    if kind == "specific_clause_lookup":
        return ("specific_clause",)
    if kind == "eligibility_judgment":
        return ("eligibility_judgment",)
    if kind == "procedure_steps":
        return ("procedure_steps",)
    if kind == "condition_table":
        return ("condition_table",)
    if kind == "version_compare":
        return ("version_compare",)
    if kind == "curriculum_fact_lookup":
        return ("curriculum_fact",)
    if kind == "official_reference_lookup":
        return ("official_reference",)
    if kind == "clarification_required":
        return ("clarification",)
    if kind == "unsupported":
        return ("unsupported",)
    return ("general_fact",)
