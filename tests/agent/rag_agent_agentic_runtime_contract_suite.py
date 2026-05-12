from __future__ import annotations

import unittest

import campus_contracts
from campus_contracts import (
    AgentRequest,
    EvidenceBundle,
    KnowledgeScope,
    RagRequestPayload,
)
from campus_rag_agent.agent import RagAgent
from campus_rag_agent.agent_answer_shape import AnswerShape, infer_answer_shape
from campus_rag_agent.confidence import derive_confidence
from campus_rag_agent.rag_sdk_models import RagSdkEvidenceAnchor, RagSdkRunRequest, RagSdkRunResult
from campus_rag_agent.rag_sdk_output import (
    RagSdkAnswerOutput,
    RagSdkClaim,
    RagSdkClaimSupport,
)
from campus_rag_agent.runtime_stages import (
    RAG_AGENT_RUNTIME_STAGES,
    resolve_stage_contract,
)
from campus_rag_agent.service_evidence_stage import execute_rag_evidence_selection_stage
from campus_rag_agent.service_versioning_context import _VersionAnswerContext
from campus_retrieval_core import (
    RetrievalExecutionResult,
    RetrievalPlan,
    RetrievalPlanBudget,
    RetrievalScope,
    RetrievalSelector,
    RetrievalSourceTrustPolicy,
    RetrievalStep,
    RetrievalStepActivity,
    RetrievalStepBudget,
    RetrievalStepResult,
)
from campus_retrieval_core.evidence_attributes import INTERNAL_EVIDENCE_ATTRIBUTES_ANCHOR_KEY

from tests.agent.rag_agent_agentic_depth_runtime_suite_support import execute_rag_planner_stage
from tests.agent.rag_agent_test_support import _make_handbook_source, delegate_to_rag_agent


class RagAgentAgenticRuntimeContractTest(unittest.TestCase):
    def test_title_lookup_shape_cannot_turn_weak_title_hit_into_completed_answer(self) -> None:
        title = "中央民族大学学生公费医疗管理办法"
        evidence = EvidenceBundle(
            query_text=f"查看{title}",
            corpus="regulations",
            collection="student_rules",
            sources=(
                _make_handbook_source(
                    doc_id="handbook:medical",
                    title=title,
                    snippet="目录 公费医疗管理办法 附表 文件下载",
                    score=0.91,
                    chunk_id_suffix="medical-title-weak-hit",
                    content_role="navigation",
                    is_answer_bearing=False,
                ),
            ),
        )

        self.assertEqual(infer_answer_shape(evidence=evidence), AnswerShape.TITLE_LOOKUP)

        response = delegate_to_rag_agent(
            AgentRequest(
                target="rag-agent",
                user_goal=f"查看{title}",
                payload=RagRequestPayload(
                    scope=KnowledgeScope(corpus="regulations", collection="student_rules")
                ),
            ),
            retriever=lambda *args, **kwargs: evidence,
        )

        self.assertEqual(response.status, "no_answer")
        self.assertEqual(response.confidence, "low")
        self.assertEqual(
            response.result.diagnostics.semantic_outcome,
            "unsupported_by_evidence",
        )
        self.assertEqual(
            response.result.diagnostics.retrieval_adequacy_reason,
            "weak_supporting_evidence",
        )
        stage_by_name = {
            stage.stage_name: stage for stage in response.result.diagnostics.stage_activities
        }
        self.assertEqual(stage_by_name["planner"].stage_status, "completed")
        self.assertEqual(stage_by_name["retrieval"].candidate_count, 1)
        self.assertEqual(stage_by_name["evidence_selection"].stage_status, "failed_closed")
        self.assertEqual(
            stage_by_name["evidence_selection"].diagnostic_reason,
            "weak_supporting_evidence",
        )

    def test_discovery_query_shape_uses_category_discovery_list_for_regulation_family(self) -> None:
        evidence = EvidenceBundle(
            query_text="学校层面的学生管理制度有哪些",
            corpus="regulations",
            collection="institutional_rules",
            sources=(
                _make_handbook_source(
                    doc_id="official_web_regulation:0a420e3fe367027c",
                    title="校园服务制度目录",
                    snippet=(
                        "当前已收录依据中，校园成员校园服务制度相关制度包括："
                        "《中央民族大学信息公开实施细则》、"
                        "《中央民族大学信息门户运行管理办法（试行）》。"
                    ),
                    score=0.91,
                    chunk_id_suffix="institutional-category-overview",
                    content_role="policy_list",
                    is_answer_bearing=True,
                ),
            ),
        )

        self.assertEqual(
            infer_answer_shape(evidence=evidence),
            AnswerShape.CATEGORY_DISCOVERY_LIST,
        )

    def test_condition_overview_shape_survives_clause_anchored_condition_rows(self) -> None:
        evidence = EvidenceBundle(
            query_text="申请奖学金需要满足什么条件",
            corpus="regulations",
            collection="student_rules",
            sources=(
                _make_handbook_source(
                    doc_id="handbook:national-scholarship",
                    title="中央民族大学本科学生国家奖学金评审办法",
                    snippet="第八条 参评学生应当遵纪守法，遵守学校规章制度。",
                    score=0.91,
                    chunk_id_suffix="national-scholarship-article-8-clause-2",
                    detail_label="第八条",
                    content_role="eligibility",
                    is_answer_bearing=True,
                    anchor={
                        "page_start": 1,
                        "page_end": 1,
                        INTERNAL_EVIDENCE_ATTRIBUTES_ANCHOR_KEY: {
                            "evidence_contract_version": "answer_ready_evidence.v3",
                            "answer_role": "eligibility_condition",
                            "semantic_role": "eligibility_condition",
                            "claim_type": "condition",
                            "condition_subject": "generic_condition",
                            "condition_group_subject": "generic_condition",
                            "condition_polarity": "positive",
                            "article_no": "第八条",
                        },
                    },
                ),
                _make_handbook_source(
                    doc_id="handbook:national-scholarship",
                    title="中央民族大学本科学生国家奖学金评审办法",
                    snippet="第九条 学习成绩排名与综合测评排名均位于前10%以内。",
                    score=0.9,
                    chunk_id_suffix="national-scholarship-article-9-clause-1",
                    detail_label="第九条",
                    content_role="eligibility",
                    is_answer_bearing=True,
                    anchor={
                        "page_start": 2,
                        "page_end": 2,
                        INTERNAL_EVIDENCE_ATTRIBUTES_ANCHOR_KEY: {
                            "evidence_contract_version": "answer_ready_evidence.v3",
                            "answer_role": "eligibility_condition",
                            "semantic_role": "eligibility_condition",
                            "claim_type": "condition",
                            "condition_subject": "generic_condition",
                            "condition_group_subject": "generic_condition",
                            "condition_polarity": "positive",
                            "article_no": "第九条",
                        },
                    },
                ),
            ),
        )

        self.assertEqual(infer_answer_shape(evidence=evidence), AnswerShape.CONDITION_OVERVIEW)

    def test_management_summary_query_does_not_become_condition_table_from_mixed_rule_rows(
        self,
    ) -> None:
        evidence = EvidenceBundle(
            query_text="本科生出国境外留学期间学籍和成绩怎么管理",
            corpus="regulations",
            collection="student_rules",
            sources=(
                _make_handbook_source(
                    doc_id="handbook:study-abroad",
                    title="中央民族大学本科生境外留学管理办法",
                    snippet="参加留学项目学生的学籍在外留学期间仍属于中央民族大学。",
                    score=0.91,
                    chunk_id_suffix="study-abroad-status",
                    detail_label="第八条",
                    content_role="article_body",
                    is_answer_bearing=True,
                    anchor={
                        INTERNAL_EVIDENCE_ATTRIBUTES_ANCHOR_KEY: {
                            "evidence_contract_version": "answer_ready_evidence.v3",
                            "answer_role": "supporting_detail",
                            "parent_unit_id": "article-0008",
                            "article_no": "第八条",
                        },
                    },
                ),
                _make_handbook_source(
                    doc_id="handbook:study-abroad",
                    title="中央民族大学本科生境外留学管理办法",
                    snippet="境外课程及获得的学分按照协议予以转换和承认。",
                    score=0.9,
                    chunk_id_suffix="study-abroad-grade",
                    detail_label="第十一条",
                    content_role="eligibility",
                    is_answer_bearing=True,
                    anchor={
                        INTERNAL_EVIDENCE_ATTRIBUTES_ANCHOR_KEY: {
                            "evidence_contract_version": "answer_ready_evidence.v3",
                            "answer_role": "eligibility_condition",
                            "parent_unit_id": "article-0011",
                            "condition_subject": "generic_condition",
                            "condition_group_subject": "generic_condition",
                            "condition_polarity": "positive",
                            "article_no": "第十一条",
                        },
                    },
                ),
            ),
        )

        self.assertEqual(infer_answer_shape(evidence=evidence), AnswerShape.GENERAL_SUMMARY)

    def test_management_summary_selection_covers_explicit_query_facets_before_same_article_rows(
        self,
    ) -> None:
        evidence = EvidenceBundle(
            query_text="本科生出国境外留学期间学籍和成绩怎么管理",
            corpus="regulations",
            collection="student_rules",
            sources=(
                _make_handbook_source(
                    doc_id="handbook:study-abroad",
                    title="中央民族大学本科生境外留学管理办法",
                    snippet=(
                        "参加留学项目学生在外留学期间必须自觉维护国家利益，"
                        "必须认真遵守对方学校的管理规定。"
                    ),
                    score=0.91,
                    chunk_id_suffix="study-abroad-behavior-management",
                    detail_label="第九条",
                    content_role="eligibility",
                    is_answer_bearing=True,
                ),
                _make_handbook_source(
                    doc_id="handbook:study-abroad",
                    title="中央民族大学本科生境外留学管理办法",
                    snippet=(
                        "参加境外留学项目学生所修的课程(以下简称境外课程)及获得的"
                        "学分按照协议予以转换和承认。"
                    ),
                    score=0.9,
                    chunk_id_suffix="study-abroad-credit-conversion",
                    detail_label="第十一条",
                    content_role="eligibility",
                    is_answer_bearing=True,
                ),
                _make_handbook_source(
                    doc_id="handbook:study-abroad",
                    title="中央民族大学本科生境外留学管理办法",
                    snippet="触犯对方校规校纪或法律法规的，按照对方相关学籍管理规定处理。",
                    score=0.89,
                    chunk_id_suffix="study-abroad-violation-management",
                    detail_label="第九条",
                    content_role="article_body",
                    is_answer_bearing=True,
                ),
                _make_handbook_source(
                    doc_id="handbook:study-abroad",
                    title="中央民族大学本科生境外留学管理办法",
                    snippet="参加留学项目学生的学籍在外留学期间仍属于中央民族大学。",
                    score=0.88,
                    chunk_id_suffix="study-abroad-status-ownership",
                    detail_label="第八条",
                    content_role="article_body",
                    is_answer_bearing=True,
                ),
                _make_handbook_source(
                    doc_id="handbook:study-abroad",
                    title="中央民族大学本科生境外留学管理办法",
                    snippet=(
                        "成绩认定采用对应原则，境外课程的成绩以学校百分制成绩、成绩等级、"
                        "学分绩点相对应的方式进行认定，并以百分制形式录入我校教务管理系统。"
                    ),
                    score=0.87,
                    chunk_id_suffix="study-abroad-grade-recognition",
                    detail_label="第十一条",
                    content_role="procedure",
                    is_answer_bearing=True,
                ),
            ),
        )

        draft = RagAgent().build_answer(evidence)

        self.assertTrue(draft.answer_text.startswith("本科生出国境外留学期间"))
        self.assertIn("学籍在外留学期间仍属于中央民族大学", draft.answer_text)
        self.assertTrue(
            "学分按照协议予以转换和承认" in draft.answer_text
            or "成绩认定采用对应原则" in draft.answer_text
        )
        self.assertIn("成绩认定采用对应原则", draft.answer_text)
        self.assertNotIn("成绩等级、学分绩点相对应", draft.answer_text)
        self.assertNotIn("以下简称", draft.answer_text)
        self.assertNotIn("参加境外留学项目学生所修的课程", draft.answer_text)
        self.assertLess(draft.answer_text.index("学籍"), draft.answer_text.index("成绩"))
        self.assertNotIn("第十一条明确", draft.answer_text)
        self.assertNotIn("触犯对方校规校纪", draft.answer_text)

    def test_completed_answer_preserves_retrieval_step_provenance_on_supporting_evidence(
        self,
    ) -> None:
        evidence = EvidenceBundle(
            query_text="公费医疗报销需要什么材料",
            corpus="regulations",
            collection="student_rules",
            sources=(
                _make_handbook_source(
                    doc_id="handbook:medical",
                    title="中央民族大学学生公费医疗管理办法",
                    snippet="学生申请公费医疗报销时，应提交门诊收费票据、诊断证明和本人校园卡信息。",
                    score=0.91,
                    chunk_id_suffix="medical-support-1",
                    content_role="requirement",
                    is_answer_bearing=True,
                ),
                _make_handbook_source(
                    doc_id="handbook:medical",
                    title="中央民族大学学生公费医疗管理办法",
                    snippet="报销材料经校医院审核后，按学校公费医疗管理办法办理。",
                    score=0.88,
                    chunk_id_suffix="medical-support-2",
                    content_role="procedure",
                    is_answer_bearing=True,
                ),
            ),
        )

        response = delegate_to_rag_agent(
            AgentRequest(
                target="rag-agent",
                user_goal="公费医疗报销需要什么材料",
                payload=RagRequestPayload(
                    scope=KnowledgeScope(corpus="regulations", collection="student_rules")
                ),
            ),
            retriever=lambda *args, **kwargs: evidence,
            rag_sdk_runner=_grounded_runner_for_evidence(evidence),
        )

        self.assertEqual(response.status, "completed")
        self.assertIsNotNone(response.result.diagnostics.retrieval_plan_summary)
        retrieval_plan_summary = response.result.diagnostics.retrieval_plan_summary
        expected_plan_id = retrieval_plan_summary.plan_id
        expected_step_ids = {
            activity.step_id for activity in retrieval_plan_summary.step_activities
        }
        for source in response.result.evidence.sources:
            self.assertEqual(
                source.anchor["retrieval_plan_id"],
                expected_plan_id,
            )
            self.assertTrue(source.anchor["retrieval_step_ids"])
            self.assertTrue(set(source.anchor["retrieval_step_ids"]).issubset(expected_step_ids))
            self.assertEqual(source.anchor["retrieval_replan_count"], 0)

    def test_executable_retrieval_seam_types_are_not_public_contracts(self) -> None:
        executable_type_names = (
            "RetrievalPlan",
            "RetrievalStep",
            "RetrievalStepResult",
            "RetrievalExecutionResult",
        )

        for type_name in executable_type_names:
            with self.subTest(type_name=type_name):
                self.assertNotIn(type_name, campus_contracts.__all__)
                self.assertFalse(hasattr(campus_contracts, type_name))

        self.assertIn("RetrievalPlanSummary", campus_contracts.__all__)
        self.assertIn("RetrievalStepActivitySummary", campus_contracts.__all__)

    def test_agentic_runtime_stage_contract_is_explicit_and_ordered(self) -> None:
        self.assertEqual(
            tuple(stage.stage_name for stage in RAG_AGENT_RUNTIME_STAGES),
            (
                "planner",
                "retrieval",
                "evidence_selection",
                "synthesis",
                "grounding",
            ),
        )

        planner = resolve_stage_contract("planner")
        retrieval = resolve_stage_contract("retrieval")
        evidence = resolve_stage_contract("evidence_selection")
        synthesis = resolve_stage_contract("synthesis")
        grounding = resolve_stage_contract("grounding")

        self.assertEqual(planner.owner, "packages/rag-agent")
        self.assertIn("RetrievalPlan", planner.output_artifacts)
        self.assertEqual(retrieval.owner, "packages/retrieval-core")
        self.assertIn("RetrievalStepResult", retrieval.output_artifacts)
        self.assertIn("supporting EvidenceBundle", evidence.output_artifacts)
        self.assertNotIn("answer success", synthesis.allowed_presentation_heuristics)
        self.assertEqual(grounding.fail_close_semantic, "insufficient_grounding")

    def test_evidence_selection_stage_returns_support_bundle_and_confidence(self) -> None:
        evidence = EvidenceBundle(
            query_text="公费医疗报销需要什么材料",
            corpus="regulations",
            collection="student_rules",
            sources=(
                _make_handbook_source(
                    doc_id="handbook:medical",
                    title="中央民族大学学生公费医疗管理办法",
                    snippet="学生申请公费医疗报销时，应提交门诊收费票据、诊断证明和本人校园卡信息。",
                    score=0.91,
                    chunk_id_suffix="medical-support-1",
                    content_role="requirement",
                    is_answer_bearing=True,
                ),
                _make_handbook_source(
                    doc_id="handbook:medical",
                    title="中央民族大学学生公费医疗管理办法",
                    snippet="报销材料经校医院审核后，按学校公费医疗管理办法办理。",
                    score=0.88,
                    chunk_id_suffix="medical-support-2",
                    content_role="procedure",
                    is_answer_bearing=True,
                ),
            ),
        )

        result = execute_rag_evidence_selection_stage(
            retrieved_evidence=evidence,
            version_answer_context=_VersionAnswerContext(),
        )

        self.assertIsNone(result.response)
        self.assertEqual(result.supporting_evidence.sources, evidence.sources)
        self.assertEqual(result.confidence, derive_confidence(result.supporting_evidence))
        self.assertIn(result.confidence, {"medium", "high"})
        self.assertFalse(result.compare_support_incomplete)

    def test_evidence_selection_stage_preserves_step_level_support_provenance(self) -> None:
        primary_source = _make_handbook_source(
            doc_id="handbook:medical",
            title="中央民族大学学生公费医疗管理办法",
            snippet="学生申请公费医疗报销时，应提交门诊收费票据、诊断证明和本人校园卡信息。",
            score=0.91,
            chunk_id_suffix="medical-support-primary",
            content_role="requirement",
            is_answer_bearing=True,
        )
        follow_up_source = _make_handbook_source(
            doc_id="handbook:medical",
            title="中央民族大学学生公费医疗管理办法",
            snippet="报销材料经校医院审核后，按学校公费医疗管理办法办理。",
            score=0.88,
            chunk_id_suffix="medical-support-follow-up",
            content_role="procedure",
            is_answer_bearing=True,
        )
        plan = RetrievalPlan(
            plan_id="regulations:student_rules:current",
            query_mode="current",
            admitted_scopes=(RetrievalScope(corpus="regulations", collection="student_rules"),),
            budget=RetrievalPlanBudget(max_steps=2, max_replans=1),
            source_trust_policy=RetrievalSourceTrustPolicy(minimum_tier="T1"),
            steps=(
                RetrievalStep(
                    step_id="indexed-lookup",
                    step_type="indexed_lookup",
                    scope=RetrievalScope(corpus="regulations", collection="student_rules"),
                    query_text="公费医疗报销需要什么材料",
                    selector=RetrievalSelector(),
                    budget=RetrievalStepBudget(top_k=2),
                ),
                RetrievalStep(
                    step_id="indexed-lookup-follow-up",
                    step_type="indexed_lookup",
                    scope=RetrievalScope(corpus="regulations", collection="student_rules"),
                    query_text="公费医疗报销材料",
                    depends_on_step_ids=("indexed-lookup",),
                    selector=RetrievalSelector(),
                    budget=RetrievalStepBudget(top_k=2),
                ),
            ),
        )
        execution_result = RetrievalExecutionResult(
            plan=plan,
            replan_count=1,
            merged_evidence=EvidenceBundle(
                query_text="公费医疗报销需要什么材料",
                corpus="regulations",
                collection="student_rules",
                sources=(primary_source, follow_up_source),
            ),
            step_results=(
                RetrievalStepResult(
                    step_id="indexed-lookup",
                    status="succeeded",
                    grounding=(primary_source,),
                    references=(primary_source,),
                    activity=RetrievalStepActivity(
                        step_id="indexed-lookup",
                        step_type="indexed_lookup",
                        corpus="regulations",
                        collection="student_rules",
                        status="succeeded",
                        query_text="公费医疗报销需要什么材料",
                        top_k=2,
                        candidate_count=1,
                        reference_count=1,
                    ),
                ),
                RetrievalStepResult(
                    step_id="indexed-lookup-follow-up",
                    status="succeeded",
                    grounding=(follow_up_source,),
                    references=(follow_up_source,),
                    activity=RetrievalStepActivity(
                        step_id="indexed-lookup-follow-up",
                        step_type="indexed_lookup",
                        corpus="regulations",
                        collection="student_rules",
                        status="succeeded",
                        query_text="公费医疗报销材料",
                        top_k=2,
                        candidate_count=1,
                        reference_count=1,
                    ),
                ),
            ),
        )

        result = execute_rag_evidence_selection_stage(
            retrieved_evidence=execution_result.merged_evidence,
            version_answer_context=_VersionAnswerContext(),
            retrieval_execution_result=execution_result,
        )

        provenance_by_chunk = {
            source.chunk_id: source.anchor for source in result.supporting_evidence.sources
        }
        self.assertEqual(
            provenance_by_chunk[primary_source.chunk_id]["retrieval_step_ids"],
            ("indexed-lookup",),
        )
        self.assertEqual(
            provenance_by_chunk[follow_up_source.chunk_id]["retrieval_step_ids"],
            ("indexed-lookup-follow-up",),
        )
        self.assertEqual(
            provenance_by_chunk[follow_up_source.chunk_id]["retrieval_plan_id"],
            "regulations:student_rules:current",
        )
        self.assertEqual(result.step_support_count, 2)

    def test_planner_stage_returns_retrieval_context_without_executing_retrieval(self) -> None:
        request = AgentRequest(
            target="rag-agent",
            user_goal="公费医疗报销需要什么材料",
            payload=RagRequestPayload(
                scope=KnowledgeScope(corpus="regulations", collection="student_rules")
            ),
        )

        result = execute_rag_planner_stage(
            request=request,
            effective_scope=KnowledgeScope(corpus="regulations", collection="student_rules"),
            user_goal=request.user_goal,
            effective_user_goal=request.user_goal,
            handbook_plan=None,
            curriculum_plan=None,
            curriculum_course_plan=None,
            curriculum_program_family_plan=None,
        )

        self.assertIsNone(result.response)
        self.assertIsNotNone(result.retrieval_context)
        self.assertEqual(result.retrieval_context.retrieval_goal, request.user_goal)
        self.assertEqual(result.retrieval_context.retrieval_collection, "student_rules")
        self.assertEqual(result.retrieval_context.version_answer_context.mode, "current")
        self.assertIsNotNone(result.retrieval_plan)
        self.assertEqual(result.retrieval_plan.plan_id, "regulations:student_rules:current")
        self.assertEqual(result.retrieval_plan.steps[0].step_type, "indexed_lookup")


if __name__ == "__main__":
    unittest.main()


def _grounded_runner_for_evidence(evidence: EvidenceBundle):
    primary_source = evidence.sources[0]

    def runner(_request: RagSdkRunRequest) -> RagSdkRunResult:
        anchor = RagSdkEvidenceAnchor(
            source_id=primary_source.doc_id,
            chunk_id=primary_source.chunk_id,
            excerpt=primary_source.snippet,
            span_ref="chunk-0001:0-24",
        )
        return RagSdkRunResult(
            output=RagSdkAnswerOutput(
                answer_text=primary_source.snippet,
                answer_kind="short_answer",
                semantic_outcome="grounded_answer",
                confidence="medium",
                cited_source_ids=(primary_source.doc_id,),
                claims=(
                    RagSdkClaim(
                        claim_id="claim-1",
                        text=primary_source.snippet,
                    ),
                ),
                claim_supports=(RagSdkClaimSupport(claim_id="claim-1", anchors=(anchor,)),),
                evidence_anchors=(anchor,),
            ),
            trace_projection={"schema_version": "rag-sdk-trace-projection-v1"},
        )

    return runner
