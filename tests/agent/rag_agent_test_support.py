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
        subject = _default_condition_subject_for_source(
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
        subject = _default_condition_subject_for_source(
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
        base["procedure_action"] = _default_procedure_action_for_source(
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
            answer_draft.supporting_sources if answer_draft.supporting_sources else requested_sources
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
                claim_type=_default_claim_type_for_source(
                    source_lookup.get((anchor.source_id, anchor.chunk_id)),
                    anchor.excerpt,
                ),
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


def _default_claim_type_for_source(source: EvidenceSource | None, excerpt: str) -> str:
    if source is not None:
        raw_attributes = source.anchor.get(INTERNAL_EVIDENCE_ATTRIBUTES_ANCHOR_KEY)
        answer_role = ""
        if isinstance(raw_attributes, dict):
            answer_role = str(raw_attributes.get("answer_role") or "").strip()
        if not answer_role:
            answer_role = _default_answer_role_for_source(
                content_role=source.content_role,
                semantic_role=source.semantic_role,
            )
        role_to_claim_type = {
            "procedure_step": "procedure_step",
            "time_constraint": "time_constraint",
            "material_requirement": "material_requirement",
            "table_fact": "table_fact",
            "eligibility_condition": "eligibility_judgment",
            "exception_rule": "eligibility_judgment",
            "exclusion_rule": "condition_table",
            "example_evidence": "eligibility_judgment",
            "category_overview": "policy_list_item",
        }
        mapped = role_to_claim_type.get(answer_role)
        if mapped:
            return mapped
    text = excerpt.strip()
    if not text:
        return "fact"
    if any(token in text for token in ("申请", "办理", "审核", "挂失", "补办")):
        return "procedure_step"
    if any(token in text for token in ("材料", "票据", "证明", "申请表")):
        return "material_requirement"
    if any(token in text for token in ("日内", "时间", "期限", "周四", "第一时间", "24:00")):
        return "time_constraint"
    if any(token in text for token in ("金额", "元", "名额", "|")):
        return "table_fact"
    if any(token in text for token in ("能不能", "可以", "原则上", "条件", "排名", "论文")):
        return "eligibility_judgment"
    return "fact"


def _normalize_regulation_evidence_for_current_v3(evidence: EvidenceBundle) -> EvidenceBundle:
    if evidence.corpus != "regulations" or evidence.collection not in {
        "student_rules",
        "institutional_rules",
    }:
        return evidence
    normalized_sources = tuple(_normalize_regulation_source_for_current_v3(source) for source in evidence.sources)
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
    captured_sources_by_chunk_id: dict[str, EvidenceSource] = {}

    def wrapped_retriever(*args, **kwargs):
        nonlocal captured_bundle
        normalized_bundle = _normalize_regulation_evidence_for_current_v3(retriever(*args, **kwargs))
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
        rag_sdk_runner=_deferred_default_grounded_runner(lambda: captured_bundle),
    )


def _default_condition_subject_for_source(
    *,
    content_role: str,
    semantic_role: str,
    answer_role: str,
    action_type: str,
) -> str:
    if action_type == "lift_discipline":
        if answer_role == "exclusion_rule":
            return "discipline_relief_exclusion"
        if answer_role == "procedure_step":
            return "application_procedure"
        return "discipline_relief_condition"
    if action_type == "reissue":
        if answer_role == "procedure_step":
            return "student_card_or_identity_credential"
        return "student_card_or_identity_credential"
    if answer_role == "material_requirement":
        return "material_requirement"
    if answer_role == "time_constraint":
        return "deadline"
    if answer_role == "table_fact":
        return "amount_or_quota"
    if semantic_role == "example_evidence" or answer_role == "example_evidence":
        return "example_evidence"
    if content_role == "procedure" or answer_role == "procedure_step":
        return "application_procedure"
    return "generic_condition"


def _default_procedure_action_for_source(*, action_type: str) -> str:
    if action_type == "reissue":
        return "reissue"
    if action_type == "lift_discipline":
        return "apply"
    return "process"


def _make_official_web_source(
    *,
    doc_id: str,
    title: str,
    snippet: str,
    score: float,
    chunk_id_suffix: str,
    content_role: str = "",
    is_answer_bearing: bool = False,
    semantic_role: str = "",
    polarity: str = "",
    action_type: str = "",
    claim_type: str = "",
    anchor: dict[str, object] | None = None,
    structural_path: tuple[str, ...] | None = None,
    collection: str = "muc_public_pages",
) -> EvidenceSource:
    return EvidenceSource(
        doc_id=doc_id,
        revision_track="source-faithful",
        version_id=f"owdocver:{chunk_id_suffix}",
        chunk_id=f"{doc_id}:source-faithful:owdocver:{chunk_id_suffix}:chunk-0001",
        anchor=anchor or {"segment_ord": 1},
        canonical_url=f"https://www.muc.edu.cn/{chunk_id_suffix}.htm",
        latest_url=f"https://www.muc.edu.cn/{chunk_id_suffix}.htm",
        source_channel="official_web",
        collection=collection,
        is_current=True,
        snippet=snippet,
        score=score,
        source_title=title,
        structural_path=structural_path or (title,),
        content_kind="article_body",
        content_role=content_role,
        detail_label=title,
        is_answer_bearing=is_answer_bearing,
        semantic_role=semantic_role,
        polarity=polarity,
        action_type=action_type,
        claim_type=claim_type,
    )


def _make_official_web_evidence(
    *,
    query_text: str,
    sources: tuple[EvidenceSource, ...],
    collection: str = "muc_public_pages",
) -> EvidenceBundle:
    return EvidenceBundle(
        query_text=query_text,
        corpus="official_web",
        collection=collection,
        sources=sources,
    )


def _make_program_semester_source(
    *,
    source_document_id: str,
    semester_label: str,
    snippet: str,
    score: float,
) -> EvidenceSource:
    source_title = source_document_id.split(":", 1)[-1]
    fact_document_id = build_curriculum_program_semester_fact_document_id(
        source_document_id,
        semester_label,
    )
    return EvidenceSource(
        doc_id=fact_document_id,
        revision_track="source-faithful",
        version_id=f"v1:{source_title}:{semester_label}",
        chunk_id=f"{fact_document_id}:row-0001",
        anchor={"fact_type": "semester_course_list"},
        canonical_url=f"https://campus.example/curriculum/{source_title}",
        latest_url=f"https://campus.example/curriculum/{source_title}",
        source_channel="pdf_ocr",
        collection="program_semester_facts",
        is_current=False,
        snippet=snippet,
        score=score,
        source_title=f"{source_title} {semester_label}课程事实",
        structural_path=(source_title, semester_label),
        detail_label=f"{semester_label}课程",
        content_kind="program_semester_fact",
        content_role="semester_course_list",
        is_answer_bearing=True,
    )


def _make_curriculum_plan_source(
    *,
    doc_id: str,
    chunk_id: str,
    snippet: str,
    score: float,
    source_title: str,
    structural_path: tuple[str, ...] = (),
    content_kind: str = "",
    content_role: str = "",
    detail_label: str = "",
    is_answer_bearing: bool = False,
) -> EvidenceSource:
    return EvidenceSource(
        doc_id=doc_id,
        revision_track="source-faithful",
        version_id=f"v1:{chunk_id.rsplit(':', 1)[-1]}",
        chunk_id=chunk_id,
        anchor={"page_start": 1, "page_end": 1},
        canonical_url=f"https://campus.example/{doc_id.split(':', 1)[-1]}",
        latest_url=f"https://campus.example/{doc_id.split(':', 1)[-1]}",
        source_channel="pdf_ocr",
        collection="curriculum_plan",
        is_current=False,
        snippet=snippet,
        score=score,
        source_title=source_title,
        structural_path=structural_path,
        content_kind=content_kind,
        content_role=content_role,
        detail_label=detail_label,
        is_answer_bearing=is_answer_bearing,
    )


def _make_versioned_handbook_evidence(
    *,
    query_text: str,
    document_id: str,
    primary_version_id: str,
    primary_snippet: str,
    comparison_version_id: str = "",
    comparison_snippet: str = "",
) -> EvidenceBundle:
    sources = [
        EvidenceSource(
            doc_id=document_id,
            revision_track="source-faithful",
            version_id=primary_version_id,
            chunk_id=f"{document_id}:source-faithful:{primary_version_id}:chunk-0001",
            anchor={"page_start": 1, "page_end": 1},
            canonical_url=f"https://campus.example/handbook/{document_id}",
            latest_url=f"https://campus.example/handbook/{document_id}",
            source_channel="pdf_ocr",
            collection="student_rules",
            is_current=False,
            snippet=primary_snippet,
            score=0.92,
            source_title="中央民族大学本科学生国家奖学金评审办法",
            structural_path=("中央民族大学本科学生国家奖学金评审办法",),
            is_answer_bearing=True,
        )
    ]
    if comparison_version_id:
        sources.append(
            EvidenceSource(
                doc_id=document_id,
                revision_track="source-faithful",
                version_id=comparison_version_id,
                chunk_id=f"{document_id}:source-faithful:{comparison_version_id}:chunk-0001",
                anchor={"page_start": 2, "page_end": 2},
                canonical_url=f"https://campus.example/handbook/{document_id}",
                latest_url=f"https://campus.example/handbook/{document_id}",
                source_channel="pdf_ocr",
                collection="student_rules",
                is_current=True,
                snippet=comparison_snippet,
                score=0.9,
                source_title="中央民族大学本科学生国家奖学金评审办法",
                structural_path=("中央民族大学本科学生国家奖学金评审办法",),
                is_answer_bearing=True,
            )
        )
    return EvidenceBundle(
        query_text=query_text,
        corpus="regulations",
        collection="student_rules",
        sources=tuple(sources),
    )


def _assert_answer_text_hides_internal_locators(
    test_case: unittest.TestCase,
    answer_text: str,
) -> None:
    test_case.assertNotIn("source-faithful", answer_text)
    test_case.assertNotIn("program_semester_facts:", answer_text)
    test_case.assertNotIn("chunk-", answer_text)
    test_case.assertNotRegex(answer_text, r"\[[^\]]*#[^\]]*\]")


def _resolved_scope_diagnostics(
    *,
    corpus: str,
    collection: str,
    **kwargs: object,
) -> RagResultDiagnostics:
    clarification_reason = kwargs.get("clarification_reason", "")
    no_answer_reason = kwargs.get("no_answer_reason", "")
    semantic_outcome = kwargs.get("semantic_outcome", "")
    if "retrieval_adequacy_verdict" not in kwargs:
        if isinstance(clarification_reason, str) and clarification_reason:
            kwargs["retrieval_adequacy_verdict"] = "ambiguous"
            kwargs["retrieval_adequacy_reason"] = clarification_reason
        elif semantic_outcome == "grounded_answer":
            kwargs["retrieval_adequacy_verdict"] = "sufficient"
            kwargs["retrieval_adequacy_reason"] = "sufficient"
        elif semantic_outcome in {"unsupported_by_evidence", "freshness_fail_close"}:
            kwargs["retrieval_adequacy_verdict"] = "insufficient"
            if no_answer_reason == "resolved_policy_clause_not_found":
                kwargs["retrieval_adequacy_reason"] = "resolved_policy_clause_not_found"
            elif no_answer_reason == "freshness_fail_close":
                kwargs["retrieval_adequacy_reason"] = "freshness_fail_close"
            else:
                kwargs["retrieval_adequacy_reason"] = "no_supporting_sources"
    if semantic_outcome == "grounded_answer" and "grounding_verdict" not in kwargs:
        kwargs["grounding_verdict"] = "grounded"
    return RagResultDiagnostics(
        resolved_scope_corpus=corpus,
        resolved_scope_collection=collection,
        **kwargs,
    )


def _resolved_curriculum_diagnostics_from_response(
    response: AgentResponse,
    **kwargs: object,
) -> RagResultDiagnostics:
    result = response.result
    if not isinstance(result, RagResultPayload):
        raise AssertionError("expected RagResultPayload for curriculum diagnostics assertion")
    if result.diagnostics is not None:
        kwargs.setdefault("retrieval_plan_summary", result.diagnostics.retrieval_plan_summary)
        kwargs.setdefault("stage_activities", result.diagnostics.stage_activities)
        kwargs.setdefault("source_trust_summary", result.diagnostics.source_trust_summary)
        kwargs.setdefault("retrieved_sources", result.diagnostics.retrieved_sources)
        kwargs.setdefault(
            "planner_information_needs",
            result.diagnostics.planner_information_needs,
        )
        kwargs.setdefault(
            "projection_context_summaries",
            result.diagnostics.projection_context_summaries,
        )
        kwargs.setdefault("claim_supports", result.diagnostics.claim_supports)
        kwargs.setdefault("claim_evidence_graph", result.diagnostics.claim_evidence_graph)
    if (
        response.status == "completed"
        and "semantic_outcome" not in kwargs
        and not kwargs.get("no_answer_reason")
        and not kwargs.get("clarification_reason")
    ):
        kwargs["semantic_outcome"] = "grounded_answer"
    return _resolved_scope_diagnostics(
        corpus="curriculum",
        collection="curriculum_plan",
        **kwargs,
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
