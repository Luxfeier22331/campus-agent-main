from __future__ import annotations

import unittest
from dataclasses import replace

from campus_contracts import (
    AgentResponse,
    ClaimSupport,
    EvidenceBundle,
    RagResultDiagnostics,
    RagResultPayload,
)
from campus_evals.answer_ready_component_runtime import (
    AnswerReadyComponentRuntimeArtifact,
    build_answer_ready_component_observation,
    collect_answer_ready_component_runtime_observations,
)
from campus_retrieval_core.evidence_attributes import INTERNAL_EVIDENCE_ATTRIBUTES_ANCHOR_KEY

from tests.agent.rag_agent_test_support import (
    _make_handbook_source,
    _make_official_web_source,
)


def _answer_ready_anchor(**metadata: object) -> dict[str, object]:
    payload: dict[str, object] = {
        "evidence_contract_version": "answer_ready_evidence.v3",
        "parent_unit_id": "unit:article-1",
        **metadata,
    }
    answer_role = str(payload.get("answer_role") or "").strip()
    condition_subject = str(payload.get("condition_subject") or "").strip()
    condition_group_id = str(payload.get("condition_group_id") or "").strip()
    category_audience = str(payload.get("category_audience") or "").strip()

    if condition_subject:
        payload.setdefault("condition_subject_taxonomy_version", "condition_subject.v1")
        payload.setdefault("condition_subject_provenance", "test-helper:default")
    if condition_subject and answer_role in {"procedure_step", "category_overview"}:
        payload.setdefault("condition_group_subject", condition_subject)
    if answer_role == "procedure_step":
        payload.setdefault("procedure_step_index", 1)
        payload.setdefault("procedure_actor", "student")
        payload.setdefault("procedure_action", "apply")
        payload.setdefault("procedure_action_taxonomy_version", "procedure_action.v1")
        payload.setdefault("procedure_action_provenance", "test-helper:default")
        if condition_subject and not condition_group_id:
            payload["condition_group_id"] = f"unit:article-1:{condition_subject}"
    if answer_role == "category_overview":
        payload.setdefault("category_registry_version", "policy_category_registry.v1")
        if category_audience and "audience" not in payload:
            payload["audience"] = category_audience
        if "category_member_document_ids" in payload and "member_policy_document_ids" not in payload:
            payload["member_policy_document_ids"] = payload["category_member_document_ids"]
        if "category_member_titles" in payload and "member_policy_titles" not in payload:
            payload["member_policy_titles"] = payload["category_member_titles"]
    return {INTERNAL_EVIDENCE_ATTRIBUTES_ANCHOR_KEY: payload}


class AnswerReadyComponentRuntimeTest(unittest.TestCase):
    def test_builds_student_procedure_observation_from_runtime_response(self) -> None:
        selected_source = replace(
            _make_handbook_source(
                doc_id="handbook:discipline-relief",
                title="中央民族大学解除学生纪律处分实施办法",
                snippet="学生提交解除处分申请表，经学院审核后报学生处。",
                score=0.92,
                chunk_id_suffix="discipline-procedure",
                content_role="procedure",
                is_answer_bearing=True,
                semantic_role="procedure_step",
                polarity="positive",
                action_type="lift_discipline",
                claim_type="procedure",
            ),
            anchor=_answer_ready_anchor(
                answer_role="procedure_step",
                condition_subject="application_procedure",
                condition_group_id="handbook:discipline-relief:article-3:application_procedure",
                condition_polarity="positive",
                procedure_step_index=1,
                procedure_actor="student",
                procedure_action="submit_materials",
                procedure_materials=("解除处分申请表",),
                procedure_next_actor="college",
            ),
        )
        secondary_source = replace(
            _make_handbook_source(
                doc_id="handbook:discipline-relief",
                title="中央民族大学解除学生纪律处分实施办法",
                snippet="存在未解除情形的，不予解除处分。",
                score=0.71,
                chunk_id_suffix="discipline-exclusion",
                content_role="requirement",
                is_answer_bearing=True,
                semantic_role="exclusion_rule",
                polarity="negative",
                action_type="lift_discipline",
                claim_type="cannot_do",
            ),
            anchor=_answer_ready_anchor(
                answer_role="exclusion_rule",
                condition_subject="discipline_relief_exclusion",
                condition_group_id="handbook:discipline-relief:article-4:discipline_relief_exclusion",
                condition_polarity="negative",
            ),
        )
        response = AgentResponse(
            target="rag-agent",
            status="completed",
            answer_text="按规定提交解除处分申请表，经学院审核后报学生处。",
            confidence="high",
            result=RagResultPayload(
                evidence=EvidenceBundle(
                    corpus="regulations",
                    collection="student_rules",
                    query_text="处分怎么消",
                    sources=(selected_source,),
                ),
                diagnostics=RagResultDiagnostics(
                    retrieved_sources=(selected_source, secondary_source),
                    claim_supports=(
                        ClaimSupport(
                            claim_type="procedure_step",
                            claim_text="学生提交解除处分申请表，经学院审核后报学生处。",
                            supported=True,
                            support_source_doc_id=selected_source.doc_id,
                            support_snippet=selected_source.snippet,
                        ),
                    ),
                    semantic_outcome="grounded_answer",
                    grounding_verdict="grounded",
                ),
            ),
        )

        observed = build_answer_ready_component_observation(
            query="处分怎么消",
            response=response,
        )

        self.assertEqual(observed.task_kind, "procedure_lookup")
        self.assertEqual(observed.query_polarity, "positive")
        self.assertEqual(observed.answer_role, "procedure_step")
        self.assertEqual(observed.retrieved_document_ids, ("handbook:discipline-relief",))
        self.assertEqual(
            observed.ranked_evidence_roles,
            ("procedure_step", "exclusion_rule"),
        )
        self.assertEqual(observed.selected_evidence_roles, ("procedure_step",))
        self.assertEqual(observed.draft_kind, "procedure_steps")
        self.assertTrue(observed.grounding_support_present)
        self.assertEqual(observed.condition_subject, "application_procedure")
        self.assertEqual(observed.selected_condition_subjects, ("application_procedure",))
        self.assertEqual(observed.selected_polarities, ("positive",))
        self.assertEqual(observed.fallback_primary_signals, ())

    def test_builds_category_discovery_observation_and_preserves_release_status(self) -> None:
        selected_source = replace(
            _make_handbook_source(
                doc_id="handbook:national-scholarship",
                title="中央民族大学本科学生国家奖学金评审办法",
                snippet="本科生奖学金相关制度包括国家奖学金、国家励志奖学金等。",
                score=0.89,
                chunk_id_suffix="scholarship-overview",
                content_role="policy_list",
                is_answer_bearing=True,
            ),
            anchor=_answer_ready_anchor(
                answer_role="category_overview",
                condition_subject="audience_scope",
                category_id="scholarship",
                category_audience="本科生",
                category_member_document_ids=(
                    "handbook:national-scholarship",
                    "handbook:national-encouragement-scholarship",
                ),
                category_member_titles=(
                    "中央民族大学本科学生国家奖学金评审办法",
                    "中央民族大学本科学生国家励志奖学金评审办法",
                ),
            ),
        )
        response = AgentResponse(
            target="rag-agent",
            status="completed",
            answer_text="当前已收录依据中，本科生奖学金相关制度包括：国家奖学金、国家励志奖学金。",
            confidence="high",
            result=RagResultPayload(
                evidence=EvidenceBundle(
                    corpus="regulations",
                    collection="student_rules",
                    query_text="本科生有哪些奖学金能申请",
                    sources=(selected_source,),
                ),
                diagnostics=RagResultDiagnostics(
                    retrieved_sources=(selected_source,),
                    claim_supports=(
                        ClaimSupport(
                            claim_type="policy_list_item",
                            claim_text="国家奖学金",
                            supported=True,
                            support_source_doc_id=selected_source.doc_id,
                            support_snippet=selected_source.snippet,
                        ),
                    ),
                    semantic_outcome="grounded_answer",
                    grounding_verdict="grounded",
                ),
            ),
        )

        observed = build_answer_ready_component_observation(
            query="本科生有哪些奖学金能申请",
            response=response,
            release_contract_status="passed",
        )

        self.assertEqual(observed.task_kind, "category_discovery")
        self.assertEqual(observed.query_polarity, "neutral")
        self.assertEqual(observed.answer_role, "category_overview")
        self.assertEqual(observed.selected_evidence_roles, ("category_overview",))
        self.assertEqual(observed.draft_kind, "policy_list")
        self.assertEqual(observed.condition_subject, "audience_scope")
        self.assertEqual(observed.release_contract_status, "passed")
        self.assertEqual(observed.release_contract_failure_classes, ())

    def test_builds_table_fact_observation_from_runtime_response(self) -> None:
        selected_source = replace(
            _make_handbook_source(
                doc_id="handbook:professional-scholarship",
                title="中央民族大学本科学生专业奖学金评定办法",
                snippet=(
                    "专业奖学金等级和金额\n"
                    "奖学金等级 | 奖励金额 | 名额\n"
                    "一等奖 | 3000元 | 10人\n"
                    "二等奖 | 1500元 | 20人"
                ),
                score=0.94,
                chunk_id_suffix="professional-scholarship-amount-table",
                content_role="table_fact",
                is_answer_bearing=True,
                semantic_role="table_fact",
                polarity="positive",
                claim_type="amount_or_quota",
            ),
            anchor=_answer_ready_anchor(
                answer_role="table_fact",
                condition_subject="amount_or_quota",
                condition_group_id="handbook:professional-scholarship:table:amount_or_quota",
                condition_polarity="positive",
                claim_type="amount_or_quota",
                table_fact_type="amount_or_quota",
            ),
        )
        response = AgentResponse(
            target="rag-agent",
            status="completed",
            answer_text="专业奖学金一等奖奖励金额为 3000 元。",
            confidence="high",
            result=RagResultPayload(
                evidence=EvidenceBundle(
                    corpus="regulations",
                    collection="student_rules",
                    query_text="专业奖学金一等奖金额是多少？",
                    sources=(selected_source,),
                ),
                diagnostics=RagResultDiagnostics(
                    retrieved_sources=(selected_source,),
                    claim_supports=(
                        ClaimSupport(
                            claim_type="condition_row",
                            claim_text="一等奖 | 3000元 | 10人",
                            supported=True,
                            support_source_doc_id=selected_source.doc_id,
                            support_snippet=selected_source.snippet,
                        ),
                    ),
                    semantic_outcome="grounded_answer",
                    grounding_verdict="grounded",
                ),
            ),
        )

        observed = build_answer_ready_component_observation(
            query="专业奖学金一等奖金额是多少？",
            response=response,
        )

        self.assertEqual(observed.task_kind, "eligibility_judgment")
        self.assertEqual(observed.query_polarity, "positive")
        self.assertEqual(observed.answer_role, "table_fact")
        self.assertEqual(observed.retrieved_document_ids, ("handbook:professional-scholarship",))
        self.assertEqual(observed.ranked_evidence_roles, ("table_fact",))
        self.assertEqual(observed.selected_evidence_roles, ("table_fact",))
        self.assertEqual(observed.draft_kind, "condition_table")
        self.assertTrue(observed.grounding_support_present)
        self.assertEqual(observed.condition_subject, "amount_or_quota")
        self.assertEqual(observed.selected_condition_subjects, ("amount_or_quota",))
        self.assertEqual(observed.selected_polarities, ("positive",))
        self.assertEqual(observed.fallback_primary_signals, ())

    def test_student_rank_judgment_observation_uses_semantic_task_kind_not_route_lock(
        self,
    ) -> None:
        selected_source = replace(
            _make_handbook_source(
                doc_id="handbook:national-scholarship",
                title="中央民族大学本科学生国家奖学金评审办法",
                snippet="学习成绩排名或综合测评排名超出前10%，但均位于前30%，且单科成绩不低于80分。",
                score=0.93,
                chunk_id_suffix="national-rank-exception",
                content_role="eligibility",
                is_answer_bearing=True,
                semantic_role="exception_rule",
                polarity="positive",
                claim_type="condition",
            ),
            anchor=_answer_ready_anchor(
                answer_role="exception_rule",
                condition_subject="rank_threshold",
                condition_group_id="handbook:national-scholarship:article-9:rank_threshold",
                condition_polarity="positive",
            ),
        )
        secondary_source = replace(
            _make_handbook_source(
                doc_id="handbook:national-scholarship",
                title="中央民族大学本科学生国家奖学金评审办法",
                snippet="学习成绩排名与综合考评成绩排名原则上均应位于前10%。",
                score=0.95,
                chunk_id_suffix="national-rank-top-ten",
                content_role="eligibility",
                is_answer_bearing=True,
                semantic_role="eligibility_condition",
                polarity="positive",
                claim_type="condition",
            ),
            anchor=_answer_ready_anchor(
                answer_role="eligibility_condition",
                condition_subject="rank_threshold",
                condition_group_id="handbook:national-scholarship:article-9:rank_threshold",
                condition_polarity="positive",
            ),
        )
        response = AgentResponse(
            target="rag-agent",
            status="completed",
            answer_text="若成绩未进前10%，但仍位于前30%且满足其他要求，可以按例外条件参评。",
            confidence="high",
            result=RagResultPayload(
                evidence=EvidenceBundle(
                    corpus="regulations",
                    collection="student_rules",
                    query_text="成绩没前十还能评国奖吗",
                    sources=(selected_source,),
                ),
                diagnostics=RagResultDiagnostics(
                    retrieved_sources=(selected_source, secondary_source),
                    claim_supports=(
                        ClaimSupport(
                            claim_type="eligibility_judgment",
                            claim_text="成绩未进前10%但位于前30%且满足其他要求时可按例外条件参评。",
                            supported=True,
                            support_source_doc_id=selected_source.doc_id,
                            support_snippet=selected_source.snippet,
                        ),
                    ),
                    semantic_outcome="grounded_answer",
                    grounding_verdict="grounded",
                ),
            ),
        )

        observed = build_answer_ready_component_observation(
            query="成绩没前十还能评国奖吗",
            response=response,
        )

        self.assertEqual(observed.task_kind, "eligibility_judgment")
        self.assertEqual(observed.query_polarity, "positive")
        self.assertEqual(observed.answer_role, "exception_rule")
        self.assertEqual(observed.draft_kind, "eligibility_judgment")
        self.assertEqual(observed.condition_subject, "rank_threshold")

    def test_student_paper_judgment_observation_uses_semantic_task_kind_not_route_lock(
        self,
    ) -> None:
        selected_source = replace(
            _make_handbook_source(
                doc_id="handbook:national-scholarship",
                title="中央民族大学本科学生国家奖学金评审办法",
                snippet="在学术研究上取得显著成绩，以第一作者发表高水平学术论文。",
                score=0.92,
                chunk_id_suffix="national-paper-condition",
                content_role="eligibility",
                is_answer_bearing=True,
                semantic_role="example_evidence",
                polarity="positive",
                claim_type="condition",
            ),
            anchor=_answer_ready_anchor(
                answer_role="example_evidence",
                condition_subject="paper_or_publication",
                condition_group_id="handbook:national-scholarship:article-9:paper_or_publication",
                condition_polarity="positive",
            ),
        )
        response = AgentResponse(
            target="rag-agent",
            status="completed",
            answer_text="论文可以作为国奖相关条件中的学术研究表现依据之一。",
            confidence="high",
            result=RagResultPayload(
                evidence=EvidenceBundle(
                    corpus="regulations",
                    collection="student_rules",
                    query_text="论文能不能算国奖条件",
                    sources=(selected_source,),
                ),
                diagnostics=RagResultDiagnostics(
                    retrieved_sources=(selected_source,),
                    claim_supports=(
                        ClaimSupport(
                            claim_type="eligibility_judgment",
                            claim_text="学术论文可以作为国奖相关条件中的学术研究表现依据之一。",
                            supported=True,
                            support_source_doc_id=selected_source.doc_id,
                            support_snippet=selected_source.snippet,
                        ),
                    ),
                    semantic_outcome="grounded_answer",
                    grounding_verdict="grounded",
                ),
            ),
        )

        observed = build_answer_ready_component_observation(
            query="论文能不能算国奖条件",
            response=response,
        )

        self.assertEqual(observed.task_kind, "eligibility_judgment")
        self.assertEqual(observed.query_polarity, "positive")
        self.assertEqual(observed.answer_role, "example_evidence")
        self.assertEqual(observed.draft_kind, "eligibility_judgment")
        self.assertEqual(observed.condition_subject, "paper_or_publication")

    def test_table_fact_claim_support_maps_to_condition_table_draft_kind(self) -> None:
        selected_source = replace(
            _make_handbook_source(
                doc_id="handbook:professional-scholarship",
                title="中央民族大学本科学生专业奖学金评定办法",
                snippet="一等奖 | 3000元 | 10人",
                score=0.94,
                chunk_id_suffix="professional-scholarship-amount-table-typed-claim",
                content_role="table_fact",
                is_answer_bearing=True,
                semantic_role="table_fact",
                polarity="positive",
                claim_type="amount_or_quota",
            ),
            anchor=_answer_ready_anchor(
                answer_role="table_fact",
                condition_subject="amount_or_quota",
                condition_group_id="handbook:professional-scholarship:table:amount_or_quota",
                condition_polarity="positive",
                claim_type="amount_or_quota",
                table_fact_type="amount_or_quota",
            ),
        )
        response = AgentResponse(
            target="rag-agent",
            status="completed",
            answer_text="专业奖学金一等奖奖励金额为 3000 元。",
            confidence="high",
            result=RagResultPayload(
                evidence=EvidenceBundle(
                    corpus="regulations",
                    collection="student_rules",
                    query_text="专业奖学金一等奖金额是多少？",
                    sources=(selected_source,),
                ),
                diagnostics=RagResultDiagnostics(
                    retrieved_sources=(selected_source,),
                    claim_supports=(
                        ClaimSupport(
                            claim_type="table_fact",
                            claim_text="一等奖 | 3000元 | 10人",
                            supported=True,
                            support_source_doc_id=selected_source.doc_id,
                            support_snippet=selected_source.snippet,
                        ),
                    ),
                    semantic_outcome="grounded_answer",
                    grounding_verdict="grounded",
                ),
            ),
        )

        observed = build_answer_ready_component_observation(
            query="专业奖学金一等奖金额是多少？",
            response=response,
        )

        self.assertEqual(observed.draft_kind, "condition_table")

    def test_builds_ambiguous_scholarship_clarification_observation(self) -> None:
        response = AgentResponse(
            target="rag-agent",
            status="needs_clarification",
            answer_text="你想查的是哪类奖学金？例如国家奖学金、国家励志奖学金、专项奖学金等。",
            follow_up_question=(
                "你想查的是哪类奖学金？例如国家奖学金、国家励志奖学金、专项奖学金等。"
            ),
            confidence="low",
            result=RagResultPayload(
                evidence=EvidenceBundle(
                    corpus="regulations",
                    collection="student_rules",
                    query_text="奖学金怎么申请",
                    sources=(),
                ),
                diagnostics=RagResultDiagnostics(
                    resolved_scope_corpus="regulations",
                    resolved_scope_collection="student_rules",
                    clarification_reason="ambiguous_procedure",
                    retrieval_adequacy_verdict="ambiguous",
                    retrieval_adequacy_reason="ambiguous_procedure",
                ),
            ),
        )

        observed = build_answer_ready_component_observation(
            query="奖学金怎么申请",
            response=response,
        )

        self.assertEqual(observed.task_kind, "ambiguous_procedure")
        self.assertEqual(observed.query_polarity, "neutral")
        self.assertEqual(observed.answer_role, "clarification")
        self.assertEqual(observed.retrieved_document_ids, ())
        self.assertEqual(observed.ranked_evidence_roles, ())
        self.assertEqual(observed.selected_evidence_roles, ())
        self.assertEqual(observed.draft_kind, "clarification")
        self.assertFalse(observed.grounding_support_present)
        self.assertEqual(observed.condition_subject, "application_procedure")
        self.assertEqual(observed.selected_condition_subjects, ())
        self.assertEqual(observed.selected_polarities, ())
        self.assertEqual(observed.fallback_primary_signals, ())

    def test_builds_student_rules_no_hit_observation(self) -> None:
        response = AgentResponse(
            target="rag-agent",
            status="no_answer",
            answer_text="当前未检索到足够依据支持回答这个学生手册问题，请确认它是否属于学生手册范围，或补充更具体的制度名称。",
            confidence="low",
            result=RagResultPayload(
                evidence=EvidenceBundle(
                    corpus="regulations",
                    collection="student_rules",
                    query_text="校内宇宙签证办理处",
                    sources=(),
                ),
                diagnostics=RagResultDiagnostics(
                    resolved_scope_corpus="regulations",
                    resolved_scope_collection="student_rules",
                    no_answer_reason="",
                    semantic_outcome="unsupported_by_evidence",
                    retrieval_adequacy_verdict="insufficient",
                    retrieval_adequacy_reason="no_supporting_sources",
                ),
            ),
        )

        observed = build_answer_ready_component_observation(
            query="校内宇宙签证办理处",
            response=response,
        )

        self.assertEqual(observed.task_kind, "unsupported_or_no_hit")
        self.assertEqual(observed.query_polarity, "neutral")
        self.assertEqual(observed.answer_role, "unsupported")
        self.assertEqual(observed.retrieved_document_ids, ())
        self.assertEqual(observed.ranked_evidence_roles, ())
        self.assertEqual(observed.selected_evidence_roles, ())
        self.assertEqual(observed.draft_kind, "unsupported")
        self.assertFalse(observed.grounding_support_present)
        self.assertEqual(observed.condition_subject, "")
        self.assertEqual(observed.selected_condition_subjects, ())
        self.assertEqual(observed.selected_polarities, ())
        self.assertEqual(observed.fallback_primary_signals, ())

    def test_builds_typed_draft_invalid_observation_with_draft_failure_reason(self) -> None:
        selected_source = replace(
            _make_handbook_source(
                doc_id="handbook:discipline-relief",
                title="中央民族大学解除学生纪律处分实施办法",
                snippet="学生提交解除处分申请表，经学院审核后报学生处。",
                score=0.91,
                chunk_id_suffix="discipline-procedure-invalid-draft",
                content_role="procedure",
                is_answer_bearing=True,
                semantic_role="procedure_step",
                polarity="positive",
                action_type="lift_discipline",
                claim_type="procedure",
            ),
            anchor=_answer_ready_anchor(
                answer_role="procedure_step",
                condition_subject="application_procedure",
                condition_group_id="handbook:discipline-relief:article-3:application_procedure",
                condition_polarity="positive",
            ),
        )
        response = AgentResponse(
            target="rag-agent",
            status="no_answer",
            answer_text="当前检索到相关依据，但答案草稿未通过结构化校验。",
            confidence="low",
            result=RagResultPayload(
                evidence=EvidenceBundle(
                    corpus="regulations",
                    collection="student_rules",
                    query_text="处分怎么消",
                    sources=(selected_source,),
                ),
                diagnostics=RagResultDiagnostics(
                    retrieved_sources=(selected_source,),
                    no_answer_reason="typed_answer_draft_invalid",
                    semantic_outcome="unsupported_by_evidence",
                    retrieval_adequacy_verdict="sufficient",
                    retrieval_adequacy_reason="supporting_sources_ready",
                    grounding_verdict="unsupported",
                    grounding_downgraded=True,
                    unsupported_fields=("procedure_step_contract_missing",),
                ),
            ),
        )

        observed = build_answer_ready_component_observation(
            query="处分怎么消",
            response=response,
        )

        self.assertEqual(observed.task_kind, "procedure_lookup")
        self.assertEqual(observed.query_polarity, "positive")
        self.assertEqual(observed.answer_role, "procedure_step")
        self.assertEqual(observed.selected_evidence_roles, ("procedure_step",))
        self.assertEqual(observed.draft_kind, "procedure_steps")
        self.assertFalse(observed.grounding_support_present)
        self.assertEqual(observed.no_answer_reason, "typed_answer_draft_invalid")
        self.assertEqual(observed.condition_subject, "application_procedure")
        self.assertEqual(observed.selected_condition_subjects, ("application_procedure",))
        self.assertEqual(observed.selected_polarities, ("positive",))

    def test_builds_negative_restriction_observation_from_runtime_response(self) -> None:
        selected_source = replace(
            _make_handbook_source(
                doc_id="handbook:discipline-relief",
                title="中央民族大学解除学生纪律处分实施办法",
                snippet="有下列情形之一的，不予解除处分。",
                score=0.91,
                chunk_id_suffix="discipline-exclusion",
                content_role="requirement",
                is_answer_bearing=True,
                semantic_role="exclusion_rule",
                polarity="negative",
                action_type="lift_discipline",
                claim_type="cannot_do",
            ),
            anchor=_answer_ready_anchor(
                answer_role="exclusion_rule",
                condition_subject="discipline_relief_exclusion",
                condition_group_id="handbook:discipline-relief:article-4:discipline_relief_exclusion",
                condition_polarity="negative",
            ),
        )
        response = AgentResponse(
            target="rag-agent",
            status="completed",
            answer_text="有规定情形的，不予解除处分。",
            confidence="high",
            result=RagResultPayload(
                evidence=EvidenceBundle(
                    corpus="regulations",
                    collection="student_rules",
                    query_text="哪些情况不能解除处分",
                    sources=(selected_source,),
                ),
                diagnostics=RagResultDiagnostics(
                    retrieved_sources=(selected_source,),
                    claim_supports=(
                        ClaimSupport(
                            claim_type="condition_row",
                            claim_text="不予解除处分的情形",
                            supported=True,
                            support_source_doc_id=selected_source.doc_id,
                            support_snippet=selected_source.snippet,
                        ),
                    ),
                    semantic_outcome="grounded_answer",
                    grounding_verdict="grounded",
                ),
            ),
        )

        observed = build_answer_ready_component_observation(
            query="哪些情况不能解除处分",
            response=response,
        )

        self.assertEqual(observed.task_kind, "restriction_lookup")
        self.assertEqual(observed.query_polarity, "negative")
        self.assertEqual(observed.answer_role, "exclusion_rule")
        self.assertEqual(observed.draft_kind, "condition_table")
        self.assertEqual(observed.condition_subject, "discipline_relief_exclusion")
        self.assertEqual(observed.selected_polarities, ("negative",))

    def test_builds_institutional_judgment_observation_from_selected_role_and_fallback_signal(
        self,
    ) -> None:
        selected_source = replace(
            _make_official_web_source(
                doc_id="official-web-regulation-appeal-deadline-test",
                title="中央民族大学学生申诉处理办法",
                snippet="学生申诉应当在收到处理决定之日起 10 日内提出。",
                score=0.93,
                chunk_id_suffix="appeal-deadline",
                content_role="requirement",
                is_answer_bearing=True,
                semantic_role="time_constraint",
                polarity="positive",
                claim_type="time_constraint",
                collection="institutional_rules",
            ),
            anchor=_answer_ready_anchor(
                answer_role="time_constraint",
                condition_subject="deadline",
                condition_group_id="institutional:appeal:deadline",
                condition_polarity="positive",
            ),
        )
        secondary_source = replace(
            _make_official_web_source(
                doc_id="official-web-regulation-appeal-deadline-test",
                title="中央民族大学学生申诉处理办法",
                snippet="申诉需要符合规定条件。",
                score=0.79,
                chunk_id_suffix="appeal-condition",
                content_role="requirement",
                is_answer_bearing=True,
                semantic_role="eligibility_condition",
                polarity="positive",
                claim_type="condition",
                collection="institutional_rules",
            ),
            anchor=_answer_ready_anchor(
                answer_role="eligibility_condition",
                condition_subject="deadline",
                condition_group_id="institutional:appeal:deadline",
                condition_polarity="positive",
            ),
        )
        response = AgentResponse(
            target="rag-agent",
            status="completed",
            answer_text="应当在收到处理决定之日起 10 日内提出申诉。",
            confidence="high",
            result=RagResultPayload(
                evidence=EvidenceBundle(
                    corpus="regulations",
                    collection="institutional_rules",
                    query_text="申诉有时间限制吗",
                    sources=(selected_source,),
                ),
                diagnostics=RagResultDiagnostics(
                    retrieved_sources=(selected_source, secondary_source),
                    claim_supports=(
                        ClaimSupport(
                            claim_type="condition_row",
                            claim_text="应当在收到处理决定之日起 10 日内提出。",
                            supported=True,
                            support_source_doc_id=selected_source.doc_id,
                            support_snippet=selected_source.snippet,
                        ),
                    ),
                    semantic_outcome="grounded_answer",
                    grounding_verdict="grounded",
                ),
            ),
        )

        observed = build_answer_ready_component_observation(
            query="申诉有时间限制吗",
            response=response,
            retrieval_runtime_observations=(
                {
                    "fallback_used": True,
                    "fallback_primary_signal": "text_cue",
                },
            ),
            release_contract_status="missing",
            release_contract_failure_classes=("chunk_contract_missing",),
        )

        self.assertEqual(observed.task_kind, "eligibility_judgment")
        self.assertEqual(observed.query_polarity, "positive")
        self.assertEqual(observed.answer_role, "time_constraint")
        self.assertEqual(observed.selected_evidence_roles, ("time_constraint",))
        self.assertEqual(observed.draft_kind, "condition_table")
        self.assertEqual(observed.condition_subject, "deadline")
        self.assertEqual(observed.selected_condition_subjects, ("deadline",))
        self.assertEqual(observed.selected_polarities, ("positive",))
        self.assertEqual(observed.fallback_primary_signals, ("text_cue",))
        self.assertEqual(observed.release_contract_status, "missing")
        self.assertEqual(
            observed.release_contract_failure_classes,
            ("chunk_contract_missing",),
        )

    def test_time_constraint_claim_support_maps_to_condition_table_draft_kind(self) -> None:
        selected_source = replace(
            _make_official_web_source(
                doc_id="official-web-regulation-appeal-deadline-test",
                title="中央民族大学学生申诉处理办法",
                snippet="学生申诉应当在收到处理决定之日起 10 日内提出。",
                score=0.93,
                chunk_id_suffix="appeal-deadline-typed-claim",
                content_role="requirement",
                is_answer_bearing=True,
                semantic_role="time_constraint",
                polarity="positive",
                claim_type="time_constraint",
                collection="institutional_rules",
            ),
            anchor=_answer_ready_anchor(
                answer_role="time_constraint",
                condition_subject="deadline",
                condition_group_id="institutional:appeal:deadline",
                condition_polarity="positive",
            ),
        )
        response = AgentResponse(
            target="rag-agent",
            status="completed",
            answer_text="应当在收到处理决定之日起 10 日内提出申诉。",
            confidence="high",
            result=RagResultPayload(
                evidence=EvidenceBundle(
                    corpus="regulations",
                    collection="institutional_rules",
                    query_text="申诉有时间限制吗",
                    sources=(selected_source,),
                ),
                diagnostics=RagResultDiagnostics(
                    retrieved_sources=(selected_source,),
                    claim_supports=(
                        ClaimSupport(
                            claim_type="time_constraint",
                            claim_text="应当在收到处理决定之日起 10 日内提出。",
                            supported=True,
                            support_source_doc_id=selected_source.doc_id,
                            support_snippet=selected_source.snippet,
                        ),
                    ),
                    semantic_outcome="grounded_answer",
                    grounding_verdict="grounded",
                ),
            ),
        )

        observed = build_answer_ready_component_observation(
            query="申诉有时间限制吗",
            response=response,
        )

        self.assertEqual(observed.draft_kind, "condition_table")

    def test_builds_institutional_procedure_observation_from_selected_role(self) -> None:
        selected_source = replace(
            _make_official_web_source(
                doc_id="official-web-regulation-appeal-procedure-test",
                title="中央民族大学学生申诉处理办法",
                snippet="校级申诉应当先提交申请，再进入复核和决定程序。",
                score=0.94,
                chunk_id_suffix="appeal-procedure",
                content_role="procedure",
                is_answer_bearing=True,
                semantic_role="procedure_step",
                polarity="positive",
                claim_type="procedure",
                collection="institutional_rules",
            ),
            anchor=_answer_ready_anchor(
                answer_role="procedure_step",
                condition_subject="application_procedure",
                condition_group_id="institutional:appeal:procedure",
                condition_polarity="positive",
                procedure_step_index=1,
                procedure_actor="student",
                procedure_action="submit_materials",
            ),
        )
        response = AgentResponse(
            target="rag-agent",
            status="completed",
            answer_text="先提交申请，再进入复核和决定程序。",
            confidence="high",
            result=RagResultPayload(
                evidence=EvidenceBundle(
                    corpus="regulations",
                    collection="institutional_rules",
                    query_text="校级申诉怎么走流程",
                    sources=(selected_source,),
                ),
                diagnostics=RagResultDiagnostics(
                    retrieved_sources=(selected_source,),
                    claim_supports=(
                        ClaimSupport(
                            claim_type="procedure_step",
                            claim_text="提交申请",
                            supported=True,
                            support_source_doc_id=selected_source.doc_id,
                            support_snippet=selected_source.snippet,
                        ),
                    ),
                    semantic_outcome="grounded_answer",
                    grounding_verdict="grounded",
                ),
            ),
        )

        observed = build_answer_ready_component_observation(
            query="校级申诉怎么走流程",
            response=response,
        )

        self.assertEqual(observed.task_kind, "procedure_lookup")
        self.assertEqual(observed.query_polarity, "positive")
        self.assertEqual(observed.answer_role, "procedure_step")
        self.assertEqual(observed.draft_kind, "procedure_steps")
        self.assertEqual(observed.condition_subject, "application_procedure")

    def test_builds_institutional_unsupported_observation_when_title_only_candidates_fail_closed(
        self,
    ) -> None:
        response = AgentResponse(
            target="rag-agent",
            status="no_answer",
            answer_text="当前未检索到足够依据支持回答这个校级制度问题，请确认它是否属于当前已开放的校级制度范围，或补充更具体的制度名称。",
            confidence="low",
            result=RagResultPayload(
                evidence=EvidenceBundle(
                    corpus="regulations",
                    collection="institutional_rules",
                    query_text="中央民族大学星际通勤飞船管理办法",
                    sources=(),
                ),
                diagnostics=RagResultDiagnostics(
                    retrieved_sources=(),
                    claim_supports=(),
                    semantic_outcome="unsupported_by_evidence",
                    grounding_verdict="unsupported",
                    retrieval_adequacy_verdict="insufficient",
                    retrieval_adequacy_reason="no_supporting_sources",
                    no_answer_reason="",
                ),
            ),
        )

        observed = build_answer_ready_component_observation(
            query="中央民族大学星际通勤飞船管理办法",
            response=response,
        )

        self.assertEqual(observed.task_kind, "unsupported_or_no_hit")
        self.assertEqual(observed.query_polarity, "neutral")
        self.assertEqual(observed.answer_role, "unsupported")
        self.assertEqual(observed.draft_kind, "unsupported")

    def test_collects_runtime_observations_into_case_mapping(self) -> None:
        source = replace(
            _make_handbook_source(
                doc_id="handbook:discipline-relief",
                title="中央民族大学解除学生纪律处分实施办法",
                snippet="学生提交解除处分申请表，经学院审核后报学生处。",
                score=0.92,
                chunk_id_suffix="discipline-procedure",
                content_role="procedure",
                is_answer_bearing=True,
                semantic_role="procedure_step",
                polarity="positive",
                action_type="lift_discipline",
                claim_type="procedure",
            ),
            anchor=_answer_ready_anchor(
                answer_role="procedure_step",
                condition_subject="application_procedure",
                condition_group_id="handbook:discipline-relief:article-3:application_procedure",
                condition_polarity="positive",
            ),
        )
        response = AgentResponse(
            target="rag-agent",
            status="completed",
            answer_text="按规定提交解除处分申请表。",
            confidence="high",
            result=RagResultPayload(
                evidence=EvidenceBundle(
                    corpus="regulations",
                    collection="student_rules",
                    query_text="处分怎么消",
                    sources=(source,),
                ),
                diagnostics=RagResultDiagnostics(
                    retrieved_sources=(source,),
                    claim_supports=(
                        ClaimSupport(
                            claim_type="procedure_step",
                            claim_text="提交解除处分申请表。",
                            supported=True,
                            support_source_doc_id=source.doc_id,
                            support_snippet=source.snippet,
                        ),
                    ),
                    semantic_outcome="grounded_answer",
                    grounding_verdict="grounded",
                ),
            ),
        )

        observation_set = collect_answer_ready_component_runtime_observations(
            (
                AnswerReadyComponentRuntimeArtifact(
                    case_id="student_discipline_relief_procedure",
                    query="处分怎么消",
                    response=response,
                    release_contract_status="passed",
                ),
            )
        )

        self.assertEqual(observation_set.schema_version, 1)
        self.assertIn(
            "student_discipline_relief_procedure",
            observation_set.observations,
        )
        self.assertEqual(
            observation_set.observations["student_discipline_relief_procedure"].draft_kind,
            "procedure_steps",
        )


if __name__ == "__main__":
    unittest.main()
