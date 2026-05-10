from __future__ import annotations

import unittest
from unittest.mock import patch

from campus_contracts import (
    CURRICULUM_PROGRAM_FAMILY_SLOT_NAME,
    CURRICULUM_PROGRAM_SLOT_NAME,
    CURRICULUM_SEMESTER_SLOT_NAME,
    ActorContext,
    AgentRequest,
    AgentResponse,
    AuthorizationProjection,
    AuthorizedRetrievalFilter,
    ClaimSupport,
    ContextProjection,
    ErrorInfo,
    EvidenceBundle,
    EvidenceSource,
    KnowledgeScope,
    PersonalizationHint,
    ProfileMemoryItem,
    ProfileMemorySummary,
    PromptTrace,
    RagRequestPayload,
    RagResultDiagnostics,
    RagResultPayload,
    RemoteContentSuspicionSummary,
    SessionSlot,
    SessionSummary,
    SourceTrustSummary,
    VersionQuery,
)
from campus_ingestion_core import ResolvedVersionQuery, ResolvedVersionSelection
from campus_ingestion_core.curriculum_program_semester_facts_projection import (
    build_curriculum_program_semester_fact_document_id,
)
from campus_rag_agent import RagAgent
from campus_rag_agent.agent import _query_mode, _select_answer_support_rows
from campus_rag_agent.confidence import derive_confidence
from campus_rag_agent.grounding_validation import validate_prompt_answer_grounding
from campus_rag_agent.intent import frame_rag_intent
from campus_rag_agent.prompt_execution import (
    RagAnswerPromptOutput,
    RagClarifyPromptOutput,
    RagPromptExecutionResult,
    RagPromptExecutor,
)
from campus_rag_agent.prompt_packets import build_rag_answer_prompt_packet
from campus_rag_agent.prompts.registry import get_rag_prompt_spec
from campus_rag_agent.query_planning import (
    plan_curriculum_course_query,
    plan_curriculum_program_family_query,
    plan_curriculum_query,
)
from campus_rag_agent.rag_sdk_models import RagSdkRunRequest, RagSdkRunResult
from campus_rag_agent.rag_sdk_output import RagSdkAnswerOutput, RagSdkClaim, RagSdkClaimSupport
from campus_rag_agent.service import delegate_to_rag_agent as _service_delegate_to_rag_agent
from campus_rag_agent.service_retrieval import retrieve_sources
from campus_rag_agent.typed_answer_drafts import validate_typed_answer_draft
from campus_retrieval_core import (
    CorpusQueryDisabledError,
    RestrictedDocumentAccessDeniedError,
    RetrievalBackendError,
)
from campus_retrieval_core.evidence_attributes import INTERNAL_EVIDENCE_ATTRIBUTES_ANCHOR_KEY
from campus_shared import (
    NormalizedProviderGroundingSupport,
    PromptRuntimeValidationError,
)
from campus_shared.regulation_semantic_registry import load_regulation_discovery_config

from tests.agent.rag_agent_test_support_defaults import (
    default_condition_subject_for_source,
    default_procedure_action_for_source,
)
from tests.agent.rag_agent_test_support_evidence import (
    _assert_answer_text_hides_internal_locators,
    _make_curriculum_plan_source,
    _make_official_web_evidence,
    _make_official_web_source,
    _make_program_semester_source,
    _make_versioned_handbook_evidence,
    _resolved_curriculum_diagnostics_from_response,
    _resolved_scope_diagnostics,
)

_UNSET = object()


def _rag_prompt_trace(prompt_id: str) -> PromptTrace:
    spec = get_rag_prompt_spec(prompt_id)
    return PromptTrace(
        prompt_id=prompt_id,
        prompt_version=prompt_id.rsplit("_", 1)[-1],
        template_sha256=spec.template_sha256,
        variables_schema_version=spec.variables_schema_version,
        output_schema_version=spec.output_schema_version,
        model_provider="openai-responses",
        model_name="gpt-5.2-mini",
    )


def _make_evidence(
    *,
    scores: tuple[float, ...] = (0.82, 0.77),
    snippets: tuple[str, ...] | None = None,
    doc_ids: tuple[str, ...] | None = None,
    query_text: str = "library hours",
) -> EvidenceBundle:
    sources = tuple(
        EvidenceSource(
            doc_id=(doc_ids[index] if doc_ids is not None else f"handbook:test-{index + 1}"),
            revision_track="source-faithful",
            version_id=f"v1:test-{index + 1}",
            chunk_id=f"{(doc_ids[index] if doc_ids is not None else f'handbook:test-{index + 1}')}:source-faithful:v1:test-{index + 1}:chunk-0001",
            anchor={
                "page_start": index + 1,
                "page_end": index + 1,
                INTERNAL_EVIDENCE_ATTRIBUTES_ANCHOR_KEY: _default_v3_contract_metadata(
                    doc_id=(
                        doc_ids[index] if doc_ids is not None else f"handbook:test-{index + 1}"
                    ),
                    answer_role="eligibility_condition",
                    content_role="requirement",
                    semantic_role="eligibility_condition",
                    polarity="positive",
                    action_type="",
                    claim_type="condition",
                ),
            },
            canonical_url=f"https://campus.example/handbook/test-{index + 1}",
            latest_url=f"https://campus.example/handbook/test-{index + 1}",
            source_channel="pdf_ocr",
            collection="student_rules",
            is_current=False,
            snippet=(
                snippets[index]
                if snippets is not None
                else f"Evidence snippet {index + 1} about library hours and student support."
            ),
            score=score,
            content_role="requirement",
            is_answer_bearing=True,
            semantic_role="eligibility_condition",
            polarity="positive",
            claim_type="condition",
        )
        for index, score in enumerate(scores)
    )
    return EvidenceBundle(
        query_text=query_text,
        corpus="regulations",
        collection="student_rules",
        sources=sources,
    )


def _make_handbook_source(
    *,
    doc_id: str,
    title: str,
    snippet: str,
    score: float,
    chunk_id_suffix: str,
    detail_label: str = "",
    content_role: str = "",
    is_answer_bearing: bool = False,
    semantic_role: str = "",
    polarity: str = "",
    action_type: str = "",
    claim_type: str = "",
    anchor: dict[str, object] | None = None,
) -> EvidenceSource:
    runtime_anchor = dict(anchor or {"page_start": 1, "page_end": 1})
    if is_answer_bearing and INTERNAL_EVIDENCE_ATTRIBUTES_ANCHOR_KEY not in runtime_anchor:
        default_answer_role = _default_answer_role_for_source(
            content_role=content_role,
            semantic_role=semantic_role,
        )
        if default_answer_role:
            runtime_anchor[INTERNAL_EVIDENCE_ATTRIBUTES_ANCHOR_KEY] = _default_v3_contract_metadata(
                doc_id=doc_id,
                answer_role=default_answer_role,
                content_role=content_role,
                semantic_role=semantic_role,
                polarity=polarity,
                action_type=action_type,
                claim_type=claim_type,
            )
    return EvidenceSource(
        doc_id=doc_id,
        revision_track="source-faithful",
        version_id=f"v1:{chunk_id_suffix}",
        chunk_id=f"{doc_id}:source-faithful:v1:{chunk_id_suffix}",
        anchor=runtime_anchor,
        canonical_url=f"https://campus.example/handbook/{doc_id}",
        latest_url=f"https://campus.example/handbook/{doc_id}",
        source_channel="pdf_ocr",
        collection="student_rules",
        is_current=True,
        snippet=snippet,
        score=score,
        source_title=title,
        structural_path=(title,),
        detail_label=detail_label,
        content_role=content_role,
        is_answer_bearing=is_answer_bearing,
        semantic_role=semantic_role,
        polarity=polarity,
        action_type=action_type,
        claim_type=claim_type,
    )


def _default_answer_role_for_source(*, content_role: str, semantic_role: str) -> str:
    if semantic_role in {
        "eligibility_condition",
        "exception_rule",
        "exclusion_rule",
        "example_evidence",
        "procedure_step",
        "material_requirement",
        "time_constraint",
        "category_overview",
        "table_fact",
    }:
        return semantic_role
    if semantic_role == "eligibility":
        return "eligibility_condition"
    if semantic_role == "exception":
        return "exception_rule"
    if content_role == "procedure":
        return "procedure_step"
    if content_role in {"requirement", "eligibility"}:
        return "eligibility_condition"
    if content_role == "policy_list":
        return "category_overview"
    if content_role == "table_fact":
        return "table_fact"
    return ""


def _default_v3_contract_metadata(
    *,
    doc_id: str,
    answer_role: str,
    content_role: str,
    semantic_role: str,
    polarity: str,
    action_type: str,
    claim_type: str,
) -> dict[str, object]:
    base = {
        "answer_role": answer_role,
        "parent_unit_id": f"{doc_id}:article-1",
        "evidence_contract_version": "answer_ready_evidence.v3",
    }
    default_polarity = polarity or ("negative" if answer_role == "exclusion_rule" else "positive")
    if default_polarity:
        base["polarity"] = default_polarity
        base["condition_polarity"] = default_polarity
    if action_type:
        base["action_type"] = action_type
    if claim_type:
        base["claim_type"] = claim_type

    if answer_role in {
        "eligibility_condition",
        "exception_rule",
        "exclusion_rule",
        "example_evidence",
        "material_requirement",
        "time_constraint",
        "table_fact",
    }:
        subject = default_condition_subject_for_source(
            content_role=content_role,
            semantic_role=semantic_role,
            answer_role=answer_role,
            action_type=action_type,
        )
        if subject:
            base["condition_subject"] = subject
            base["condition_group_subject"] = subject
            base["condition_group_id"] = f"{doc_id}:article-1:group-01:{subject}"
            base["condition_subject_taxonomy_version"] = "condition_subject.v1"
            base["condition_subject_provenance"] = "test-helper:default"

    if answer_role == "procedure_step":
        subject = default_condition_subject_for_source(
            content_role=content_role,
            semantic_role=semantic_role,
            answer_role=answer_role,
            action_type=action_type,
        )
        if subject:
            base["condition_subject"] = subject
            base["condition_group_subject"] = subject
            base["condition_group_id"] = f"{doc_id}:article-1:group-01:{subject}"
            base["condition_subject_taxonomy_version"] = "condition_subject.v1"
            base["condition_subject_provenance"] = "test-helper:default"
        base["procedure_step_index"] = 1
        base["procedure_actor"] = "student"
        base["procedure_action"] = default_procedure_action_for_source(
            action_type=action_type,
        )
        base["procedure_action_taxonomy_version"] = "procedure_action.v1"
        base["procedure_action_provenance"] = "test-helper:default"
    if answer_role == "category_overview":
        base["condition_subject"] = "audience_scope"
        base["condition_group_subject"] = "audience_scope"
        base["condition_group_id"] = f"{doc_id}:article-1:group-01:audience_scope"
        base["condition_subject_taxonomy_version"] = "condition_subject.v1"
        base["condition_subject_provenance"] = "test-helper:default"
    return base


def _build_default_rag_sdk_answer_text_from_snippets(snippets: list[str]) -> str:
    if not snippets:
        return ""
    if len(snippets) == 1:
        return f"根据学生手册相关规定，{snippets[0]}"
    return "根据学生手册相关规定，" + "；".join(snippets[:3])


def _default_grounded_runner_for_evidence(evidence: EvidenceBundle):
    def runner(request: RagSdkRunRequest) -> RagSdkRunResult:
        projected_evidence = request.evidence
        source_lookup = {(source.doc_id, source.chunk_id): source for source in evidence.sources}
        requested_sources = tuple(
            source_lookup[key]
            for key in (
                (anchor.source_id, anchor.chunk_id) for anchor in projected_evidence.anchors
            )
            if key in source_lookup
        )
        selected_evidence = EvidenceBundle(
            query_text=request.user_goal or evidence.query_text,
            corpus=evidence.corpus,
            collection=evidence.collection,
            sources=requested_sources,
        )
        answer_draft = RagAgent().build_answer(selected_evidence)
        grounded_sources = (
            answer_draft.supporting_sources
            if answer_draft.supporting_sources
            else requested_sources
        )
        anchors = tuple(
            anchor
            for anchor in projected_evidence.anchors
            if (anchor.source_id, anchor.chunk_id)
            in {(source.doc_id, source.chunk_id) for source in grounded_sources}
        )
        snippets = [anchor.excerpt.strip() for anchor in anchors if anchor.excerpt.strip()]
        answer_text = answer_draft.answer_text or _build_default_rag_sdk_answer_text_from_snippets(
            snippets,
        )
        claims, claim_supports = _claims_and_supports_from_typed_answer(
            typed_answer=request.typed_answer or answer_draft.typed_draft,
            anchors=anchors,
        )
        if not claims:
            claim_supports = tuple(
                RagSdkClaimSupport(
                    claim_id=f"claim-{index + 1}",
                    anchors=(anchor,),
                )
                for index, anchor in enumerate(anchors)
            )
            claims = tuple(
                RagSdkClaim(
                    claim_id=f"claim-{index + 1}",
                    text=anchor.excerpt,
                    claim_type="fact",
                )
                for index, anchor in enumerate(anchors)
            )
        return RagSdkRunResult(
            output=RagSdkAnswerOutput(
                answer_text=answer_text,
                answer_kind="short_answer",
                semantic_outcome="grounded_answer",
                confidence="medium",
                cited_source_ids=tuple(anchor.source_id for anchor in anchors),
                claims=claims,
                claim_supports=claim_supports,
                evidence_anchors=anchors,
            ),
            trace_projection={"schema_version": "rag-sdk-trace-projection-v1"},
        )

    return runner


def _make_current_v3_category_overview_source(
    *,
    doc_id: str,
    title: str,
    snippet: str,
    score: float,
    chunk_id_suffix: str,
    collection: str = "student_rules",
) -> EvidenceSource:
    discovery = load_regulation_discovery_config(collection)
    category = next(
        (item for item in discovery.categories if doc_id in item.member_policy_document_ids),
        None,
    )
    if category is None:
        raise ValueError(f"no discovery category found for document id: {doc_id}")
    member_titles = tuple(
        policy.title
        for policy in discovery.policy_objects
        if policy.document_id in category.member_policy_document_ids
    )
    source = _make_handbook_source(
        doc_id=doc_id,
        title=title,
        snippet=snippet,
        score=score,
        chunk_id_suffix=chunk_id_suffix,
        content_role="policy_list",
        is_answer_bearing=True,
        semantic_role="category_overview",
        polarity="positive",
        claim_type="policy_list",
    )
    runtime_anchor = dict(source.anchor)
    runtime_anchor[INTERNAL_EVIDENCE_ATTRIBUTES_ANCHOR_KEY] = {
        **_default_v3_contract_metadata(
            doc_id=doc_id,
            answer_role="category_overview",
            content_role="policy_list",
            semantic_role="category_overview",
            polarity="positive",
            action_type="",
            claim_type="policy_list",
        ),
        "category_id": category.category_id,
        "category_display_name": category.display_name,
        "category_registry_version": "policy_category_registry.v1",
        "audience": category.audience,
        "category_audience": category.audience,
        "member_policy_document_ids": category.member_policy_document_ids,
        "category_member_document_ids": category.member_policy_document_ids,
        "member_policy_titles": member_titles,
        "category_member_titles": member_titles,
    }
    return EvidenceSource(
        doc_id=source.doc_id,
        revision_track=source.revision_track,
        version_id=source.version_id,
        chunk_id=source.chunk_id,
        anchor=runtime_anchor,
        canonical_url=source.canonical_url,
        latest_url=source.latest_url,
        source_channel=source.source_channel,
        collection=source.collection,
        is_current=source.is_current,
        snippet=source.snippet,
        score=source.score,
        source_title=source.source_title,
        structural_path=source.structural_path,
        content_kind=source.content_kind,
        content_role=source.content_role,
        detail_label=source.detail_label,
        is_answer_bearing=source.is_answer_bearing,
        semantic_role=source.semantic_role,
        polarity=source.polarity,
        action_type=source.action_type,
        claim_type=source.claim_type,
        audience_scope=source.audience_scope,
        article_no=source.article_no,
        clause_no=source.clause_no,
        section_kind=source.section_kind,
        source_unit_key=source.source_unit_key,
    )


def _deferred_default_grounded_runner(bundle_ref):
    def runner(request: RagSdkRunRequest) -> RagSdkRunResult:
        evidence = bundle_ref()
        if evidence is None:
            raise RuntimeError("test default rag sdk runner called before retrieval evidence")
        return _default_grounded_runner_for_evidence(evidence)(request)

    return runner


def _deferred_prompt_grounded_runner(
    *,
    bundle_ref,
    request_ref,
    prompt_executor: RagPromptExecutor,
):
    def runner(request: RagSdkRunRequest) -> RagSdkRunResult:
        evidence = bundle_ref()
        if evidence is None:
            raise RuntimeError("test prompt rag sdk runner called before retrieval evidence")
        agent_request = request_ref()
        if agent_request is None:
            raise RuntimeError("test prompt rag sdk runner called before agent request")
        execution = prompt_executor.compose_answer(
            build_rag_answer_prompt_packet(
                agent_request,
                resolved_scope=agent_request.payload.scope,
                evidence=evidence,
            )
        )
        default_result = _default_grounded_runner_for_evidence(evidence)(request)
        return RagSdkRunResult(
            output=RagSdkAnswerOutput(
                answer_text=execution.output.answer_text,
                answer_kind=default_result.output.answer_kind,
                semantic_outcome=default_result.output.semantic_outcome,
                confidence=default_result.output.confidence,
                cited_source_ids=default_result.output.cited_source_ids,
                claims=default_result.output.claims,
                claim_supports=default_result.output.claim_supports,
                evidence_anchors=default_result.output.evidence_anchors,
            ),
            trace_projection=default_result.trace_projection,
        )

    return runner


def _claims_and_supports_from_typed_answer(*, typed_answer, anchors):
    validation = validate_typed_answer_draft(
        typed_answer,
        expected_answer_kind=typed_answer.kind,
    )
    if validation.verdict != "valid" or not validation.claim_supports:
        return (), ()
    claims: list[RagSdkClaim] = []
    claim_supports: list[RagSdkClaimSupport] = []
    for index, support in enumerate(validation.claim_supports):
        claim_id = f"claim-{index + 1}"
        support_anchor = _anchor_for_claim_support(support, anchors)
        claims.append(
            RagSdkClaim(
                claim_id=claim_id,
                text=support.claim_text,
                claim_type=support.claim_type,
            )
        )
        claim_supports.append(
            RagSdkClaimSupport(
                claim_id=claim_id,
                anchors=((support_anchor,) if support_anchor is not None else ()),
            )
        )
    return tuple(claims), tuple(claim_supports)


def _anchor_for_claim_support(support, anchors):
    for anchor in anchors:
        if anchor.source_id != support.support_source_doc_id:
            continue
        if support.support_snippet and support.support_snippet == anchor.excerpt:
            return anchor
    for anchor in anchors:
        if anchor.source_id == support.support_source_doc_id:
            return anchor
    return None


def _normalize_regulation_evidence_for_current_v3(evidence: EvidenceBundle) -> EvidenceBundle:
    if evidence.corpus != "regulations" or evidence.collection not in {
        "student_rules",
        "institutional_rules",
    }:
        return evidence
    normalized_sources = tuple(
        _normalize_regulation_source_for_current_v3(source) for source in evidence.sources
    )
    if normalized_sources == evidence.sources:
        return evidence
    return EvidenceBundle(
        query_text=evidence.query_text,
        corpus=evidence.corpus,
        collection=evidence.collection,
        sources=normalized_sources,
    )


def _normalize_regulation_source_for_current_v3(source: EvidenceSource) -> EvidenceSource:
    raw = source.anchor.get(INTERNAL_EVIDENCE_ATTRIBUTES_ANCHOR_KEY)
    if source.is_answer_bearing is not True:
        return source
    answer_role = _default_answer_role_for_source(
        content_role=source.content_role,
        semantic_role=source.semantic_role,
    )
    if not answer_role:
        return source
    runtime_anchor = dict(source.anchor)
    default_metadata = _default_v3_contract_metadata(
        doc_id=source.doc_id,
        answer_role=answer_role,
        content_role=source.content_role,
        semantic_role=source.semantic_role,
        polarity=source.polarity,
        action_type=source.action_type,
        claim_type=source.claim_type,
    )
    if not isinstance(raw, dict):
        normalized_metadata = default_metadata
    else:
        normalized_metadata = dict(raw)
        for field_name in (
            "condition_subject_taxonomy_version",
            "condition_subject_provenance",
            "condition_group_subject",
            "condition_polarity",
            "procedure_action_taxonomy_version",
            "procedure_action_provenance",
            "category_registry_version",
        ):
            if field_name not in normalized_metadata and field_name in default_metadata:
                normalized_metadata[field_name] = default_metadata[field_name]
    runtime_anchor[INTERNAL_EVIDENCE_ATTRIBUTES_ANCHOR_KEY] = normalized_metadata
    return EvidenceSource(
        doc_id=source.doc_id,
        revision_track=source.revision_track,
        version_id=source.version_id,
        chunk_id=source.chunk_id,
        anchor=runtime_anchor,
        canonical_url=source.canonical_url,
        latest_url=source.latest_url,
        source_channel=source.source_channel,
        collection=source.collection,
        is_current=source.is_current,
        snippet=source.snippet,
        score=source.score,
        source_title=source.source_title,
        structural_path=source.structural_path,
        content_kind=source.content_kind,
        content_role=source.content_role,
        detail_label=source.detail_label,
        is_answer_bearing=source.is_answer_bearing,
        semantic_role=source.semantic_role,
        polarity=source.polarity,
        action_type=source.action_type,
        claim_type=source.claim_type,
        audience_scope=source.audience_scope,
        article_no=source.article_no,
        clause_no=source.clause_no,
        section_kind=source.section_kind,
        source_unit_key=source.source_unit_key,
    )


def delegate_to_rag_agent(
    request: AgentRequest,
    *,
    retriever=retrieve_sources,
    prompt_executor: RagPromptExecutor | None = None,
    retrieval_observation_sink=None,
    include_retrieval_observation_query_text: bool = False,
    rag_sdk_runner=_UNSET,
) -> AgentResponse:
    if rag_sdk_runner is not _UNSET:
        return _service_delegate_to_rag_agent(
            request,
            retriever=retriever,
            prompt_executor=prompt_executor,
            retrieval_observation_sink=retrieval_observation_sink,
            include_retrieval_observation_query_text=include_retrieval_observation_query_text,
            rag_sdk_runner=rag_sdk_runner,
        )
    captured_bundle: EvidenceBundle | None = None
    captured_request: AgentRequest | None = request
    captured_sources_by_chunk_id: dict[str, EvidenceSource] = {}

    def wrapped_retriever(*args, **kwargs):
        nonlocal captured_bundle
        normalized_bundle = _normalize_regulation_evidence_for_current_v3(
            retriever(*args, **kwargs)
        )
        for source in normalized_bundle.sources:
            captured_sources_by_chunk_id[source.chunk_id] = source
        captured_bundle = EvidenceBundle(
            query_text=normalized_bundle.query_text,
            corpus=normalized_bundle.corpus,
            collection=normalized_bundle.collection,
            sources=tuple(captured_sources_by_chunk_id.values()),
        )
        return captured_bundle

    return _service_delegate_to_rag_agent(
        request,
        retriever=wrapped_retriever,
        prompt_executor=prompt_executor,
        retrieval_observation_sink=retrieval_observation_sink,
        include_retrieval_observation_query_text=include_retrieval_observation_query_text,
        rag_sdk_runner=(
            _deferred_prompt_grounded_runner(
                bundle_ref=lambda: captured_bundle,
                request_ref=lambda: captured_request,
                prompt_executor=prompt_executor,
            )
            if prompt_executor is not None
            else _deferred_default_grounded_runner(lambda: captured_bundle)
        ),
    )


__all__ = (
    "CURRICULUM_PROGRAM_FAMILY_SLOT_NAME",
    "CURRICULUM_PROGRAM_SLOT_NAME",
    "CURRICULUM_SEMESTER_SLOT_NAME",
    "ActorContext",
    "AgentRequest",
    "AgentResponse",
    "AuthorizationProjection",
    "AuthorizedRetrievalFilter",
    "ClaimSupport",
    "ContextProjection",
    "CorpusQueryDisabledError",
    "ErrorInfo",
    "EvidenceBundle",
    "EvidenceSource",
    "KnowledgeScope",
    "NormalizedProviderGroundingSupport",
    "PersonalizationHint",
    "ProfileMemoryItem",
    "ProfileMemorySummary",
    "PromptRuntimeValidationError",
    "PromptTrace",
    "RagAgent",
    "RagAnswerPromptOutput",
    "RagClarifyPromptOutput",
    "RagPromptExecutionResult",
    "RagRequestPayload",
    "RagResultDiagnostics",
    "RagResultPayload",
    "RemoteContentSuspicionSummary",
    "ResolvedVersionQuery",
    "ResolvedVersionSelection",
    "RestrictedDocumentAccessDeniedError",
    "RetrievalBackendError",
    "SessionSlot",
    "SessionSummary",
    "SourceTrustSummary",
    "VersionQuery",
    "_assert_answer_text_hides_internal_locators",
    "_make_curriculum_plan_source",
    "_make_evidence",
    "_make_handbook_source",
    "_make_official_web_evidence",
    "_make_official_web_source",
    "_make_program_semester_source",
    "_make_versioned_handbook_evidence",
    "_query_mode",
    "_rag_prompt_trace",
    "_resolved_curriculum_diagnostics_from_response",
    "_resolved_scope_diagnostics",
    "_select_answer_support_rows",
    "build_curriculum_program_semester_fact_document_id",
    "delegate_to_rag_agent",
    "derive_confidence",
    "frame_rag_intent",
    "get_rag_prompt_spec",
    "patch",
    "plan_curriculum_course_query",
    "plan_curriculum_program_family_query",
    "plan_curriculum_query",
    "unittest",
    "validate_prompt_answer_grounding",
)
