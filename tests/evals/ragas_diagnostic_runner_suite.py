from __future__ import annotations

import unittest
from dataclasses import replace

from campus_contracts import AuthorizedRetrievalFilter, EvidenceBundle, KnowledgeScope
from campus_evals.benchmark import RetrievalQrelsCase, RetrievalQrelsSourceRef
from campus_evals.ragas_diagnostic_runner import (
    RAGAS_DIAGNOSTIC_INDEXED_LOOKUP_TIMEOUT_MS,
    _build_diagnostic_retrieval_plan,
    _build_projection_with_breakdown,
    _retrieval_intent_for_case,
    build_ragas_diagnostic_sample_manifest,
    run_ragas_diagnostic,
)
from campus_evals.retrieval_live_benchmark import _build_retrieval_request
from campus_retrieval_core.evidence_attributes import INTERNAL_EVIDENCE_ATTRIBUTES_ANCHOR_KEY

from tests.evals.ragas_diagnostic_test_support import (
    _answer_ready_regulation_source,
    _diagnostic_source_for_request,
)
from tests.evals.retrieval_benchmark_test_support import _source


class RagasDiagnosticRunnerSuite(unittest.TestCase):
    def test_build_sample_manifest_selects_fixed_core_surface_cases(self) -> None:
        manifest = build_ragas_diagnostic_sample_manifest(sample_limit_per_surface=3)

        self.assertEqual(
            manifest["schema_version"],
            "ragas-diagnostic-sample-manifest.v1",
        )
        self.assertEqual(manifest["sample_limit_per_surface"], 3)
        self.assertEqual(len(manifest["cases"]), 12)
        self.assertEqual(
            {case["surface_key"] for case in manifest["cases"]},
            {
                "regulations/student_rules",
                "regulations/institutional_rules",
                "curriculum/curriculum_plan",
                "official_web/stable_reference",
            },
        )
        self.assertEqual(
            manifest["cases"][0]["case_id"],
            "policy-title-scholarship",
        )

    def test_build_sample_manifest_prioritizes_semantic_restricted_institutional_case(
        self,
    ) -> None:
        manifest = build_ragas_diagnostic_sample_manifest(sample_limit_per_surface=1)
        cases_by_surface = {
            case["surface_key"]: case for case in manifest["cases"] if isinstance(case, dict)
        }

        self.assertEqual(
            cases_by_surface["regulations/institutional_rules"]["case_id"],
            "institutional-three-assists",
        )
        self.assertEqual(
            cases_by_surface["regulations/institutional_rules"]["query"],
            "研究生助教助研助管工作应该依据哪份管理办法？",
        )

    def test_curriculum_deterministic_fact_cases_disable_answer_relevancy(self) -> None:
        manifest = build_ragas_diagnostic_sample_manifest(
            case_ids=(
                "general-english-total-credits",
                "law-ethnic-class-fourth-semester-courses",
            ),
        )

        cases_by_id = {case["case_id"]: case for case in manifest["cases"]}

        for case_id in (
            "general-english-total-credits",
            "law-ethnic-class-fourth-semester-courses",
        ):
            with self.subTest(case_id=case_id):
                self.assertFalse(
                    cases_by_id[case_id]["supplemental_metric_overrides"].get(
                        "answer_relevancy",
                        True,
                    )
                )
                self.assertNotEqual(
                    cases_by_id[case_id]["supplemental_metric_overrides"].get("faithfulness"),
                    False,
                )

    def test_article_number_clause_cases_disable_answer_relevancy(self) -> None:
        manifest = build_ragas_diagnostic_sample_manifest(
            case_ids=(
                "policy-alias-national-scholarship-article-nine",
                "policy-alias-national-scholarship-author-affiliation",
                "article-number-student-status",
                "fixed-phrase-dormitory-lighting",
                "fixed-phrase-electrical-appliance",
                "fixed-phrase-medical-reimbursement",
                "semantic-student-hearing-rights",
            ),
        )

        cases_by_id = {case["case_id"]: case for case in manifest["cases"]}

        for case_id in (
            "policy-alias-national-scholarship-article-nine",
            "policy-alias-national-scholarship-author-affiliation",
            "article-number-student-status",
            "fixed-phrase-dormitory-lighting",
            "fixed-phrase-electrical-appliance",
            "fixed-phrase-medical-reimbursement",
            "semantic-student-hearing-rights",
        ):
            with self.subTest(case_id=case_id):
                case = cases_by_id[case_id]
                self.assertFalse(
                    case["supplemental_metric_overrides"].get("answer_relevancy", True)
                )
                if case_id == "fixed-phrase-medical-reimbursement":
                    self.assertFalse(
                        case["supplemental_metric_overrides"].get("faithfulness", True)
                    )
                    self.assertTrue(
                        case["supplemental_metric_overrides"].get("identity_grounding", False)
                    )
                else:
                    self.assertNotEqual(
                        case["supplemental_metric_overrides"].get("faithfulness"),
                        False,
                    )

    def test_effective_date_judgment_cases_disable_answer_relevancy(self) -> None:
        manifest = build_ragas_diagnostic_sample_manifest(
            case_ids=("institutional-graduate-employment-reward-effective-scope",),
        )

        case = manifest["cases"][0]

        self.assertFalse(case["supplemental_metric_overrides"].get("answer_relevancy", True))
        self.assertNotEqual(case["supplemental_metric_overrides"].get("faithfulness"), False)
        self.assertFalse(case["supplemental_metric_overrides"].get("identity_grounding", False))

    def test_no_answer_hybrid_status_marks_ragas_case_as_expected_empty_result(
        self,
    ) -> None:
        manifest = build_ragas_diagnostic_sample_manifest(
            case_ids=("policy-alias-national-scholarship-author-affiliation",),
        )

        case = manifest["cases"][0]
        self.assertEqual(
            case["expected_empty_result_reason"],
            "unsupported_by_evidence",
        )
        self.assertFalse(case["expected_no_hit"])
        self.assertFalse(case["supplemental_metric_overrides"].get("answer_relevancy", True))

    def test_run_ragas_diagnostic_passes_restricted_institutional_authorization_to_backend(
        self,
    ) -> None:
        seen_requests = []

        class FakeBackend:
            def retrieve(self, request):
                seen_requests.append(request)
                return EvidenceBundle(
                    corpus=request.corpus,
                    collection=request.collection,
                    query_text=request.query_text,
                    sources=(_diagnostic_source_for_request(request),),
                )

        report = run_ragas_diagnostic(
            backend=FakeBackend(),
            scorer=lambda projection: {"faithfulness": 1.0},
            sample_limit_per_surface=1,
            metric_names=("faithfulness",),
        )

        institutional_request = next(
            request for request in seen_requests if request.collection == "institutional_rules"
        )
        self.assertTrue(report["passed"])
        self.assertEqual(institutional_request.semantic_hint.intent_kind, "policy_object_lookup")
        self.assertEqual(
            institutional_request.target_document_ids,
            ("institutional_regulation:muc:中央民族大学研究生-三助-工作管理办法:49319e7c44d3",),
        )
        self.assertEqual(
            institutional_request.authorized_filter,
            AuthorizedRetrievalFilter(
                entitlement_groups=("campus_members",),
                visibility_scope="campus",
                visibility_level="restricted",
            ),
        )

    def test_run_ragas_diagnostic_passes_handbook_focus_terms_to_retrieval_request(
        self,
    ) -> None:
        seen_requests = []

        class FakeBackend:
            def retrieve(self, request):
                seen_requests.append(request)
                return EvidenceBundle(
                    corpus=request.corpus,
                    collection=request.collection,
                    query_text=request.query_text,
                    sources=(
                        _answer_ready_regulation_source(
                            doc_id="handbook:6f147355748d2d2f181c310f8d1e0da908f2f1a8",
                            chunk_id="discipline-relief-condition",
                            source_title="中央民族大学解除学生纪律处分实施办法",
                            snippet="学生受处分满考察期后，可以申请解除纪律处分。",
                            detail_label="第三条",
                            content_role="eligibility",
                            answer_role="eligibility_condition",
                            semantic_role="eligibility_condition",
                            condition_subject="discipline_relief_condition",
                        ),
                    ),
                )

        report = run_ragas_diagnostic(
            backend=FakeBackend(),
            scorer=lambda projection: {"faithfulness": 1.0},
            sample_limit_per_surface=5,
            metric_names=("faithfulness",),
        )

        case = next(
            item for item in report["cases"] if item["case_id"] == "semantic-disciplinary-relief"
        )
        request = next(
            request
            for request in seen_requests
            if request.query_text.startswith("中央民族大学解除学生纪律处分实施办法")
        )
        self.assertIn("考察期", request.query_text)
        self.assertIn("条件", request.query_text)
        self.assertIn("考察期", request.focus_terms)
        self.assertIn("解除纪律处分", case["answer_text"])

    def test_retrieval_request_uses_category_members_as_preferred_docs_for_condition_overview(
        self,
    ) -> None:
        case = RetrievalQrelsCase(
            case_id="semantic-scholarship-eligibility",
            split="release_gate",
            query="申请奖学金需要满足什么条件",
            scope=KnowledgeScope(corpus="regulations", collection="student_rules"),
        )

        request = _build_retrieval_request(case=case, default_top_k=5)

        self.assertEqual(request.target_document_ids, ())
        self.assertGreaterEqual(len(request.preferred_document_ids), 4)
        self.assertIn(
            "handbook:55f7a1b27590bdc59c099f37d84cfa097356ce15",
            request.preferred_document_ids,
        )

    def test_retrieval_request_uses_curriculum_title_plan_for_document_lookup(self) -> None:
        case = RetrievalQrelsCase(
            case_id="curriculum-title-accounting-second-degree",
            split="smoke",
            query="会计学本科第二学士学位人才培养方案",
            scope=KnowledgeScope(corpus="curriculum", collection="curriculum_plan"),
        )

        request = _build_retrieval_request(case=case, default_top_k=5)

        self.assertEqual(
            request.target_document_ids,
            ("curriculum:会计学本科第二学士学位人才培养方案",),
        )
        self.assertIsNotNone(request.semantic_hint)
        assert request.semantic_hint is not None
        self.assertEqual(request.semantic_hint.intent_kind, "curriculum_document_lookup")
        self.assertEqual(request.semantic_hint.answer_kind, "curriculum_document")
        self.assertEqual(request.semantic_hint.selection_policy, "document_identity_first")
        self.assertEqual(request.semantic_hint.expected_answer_roles, ("document_identity",))

    def test_projection_executes_member_coverage_plan_for_category_condition_overview(
        self,
    ) -> None:
        seen_requests = []

        class FakeBackend:
            def retrieve(self, request):
                seen_requests.append(request)
                if not request.target_document_ids:
                    raise AssertionError("category member diagnostic plan must use target docs")
                sources = tuple(
                    _answer_ready_regulation_source(
                        doc_id=doc_id,
                        chunk_id=f"{doc_id}:condition-row",
                        source_title="中央民族大学本科学生奖学金评定办法",
                        snippet="申请奖学金应当热爱社会主义祖国，遵守学校规章制度，学习成绩优良。",
                        content_role="eligibility",
                        answer_role="eligibility_condition",
                        semantic_role="eligibility_condition",
                    )
                    for doc_id in request.target_document_ids
                )
                return EvidenceBundle(
                    corpus=request.corpus,
                    collection=request.collection,
                    query_text=request.query_text,
                    sources=sources,
                )

        projection, _ = _build_projection_with_breakdown(
            case=RetrievalQrelsCase(
                case_id="semantic-scholarship-eligibility",
                split="smoke",
                query="申请奖学金需要满足什么条件",
                scope=KnowledgeScope(corpus="regulations", collection="student_rules"),
            ),
            backend=FakeBackend(),
            top_k=5,
        )

        target_requests = [request for request in seen_requests if request.target_document_ids]
        self.assertGreaterEqual(len(target_requests), 4)
        self.assertTrue(all(len(request.target_document_ids) == 1 for request in target_requests))
        self.assertEqual(seen_requests, target_requests)
        self.assertIn("学习成绩优良", projection.response)
        self.assertEqual(projection.metadata["retrieval_intent_kind"], "condition_table")
        self.assertEqual(projection.metadata["retrieval_answer_kind"], "condition_table")

    def test_projection_uses_case_query_for_answer_synthesis_after_focused_retrieval(
        self,
    ) -> None:
        class FakeBackend:
            def retrieve(self, request):
                return EvidenceBundle(
                    corpus=request.corpus,
                    collection=request.collection,
                    query_text=request.query_text,
                    sources=(
                        replace(
                            _source(
                                doc_id="handbook:9350d885657d7409e524e73666b828b826f07191",
                                chunk_id="attendance-threshold-row",
                            ),
                            source_title="中央民族大学学生违纪处分实施办法",
                            detail_label="第三十三条",
                            snippet=(
                                "违反学校考勤管理规定,无故旷课者,视情节给予如下处分:\n"
                                "(一)一学期累计旷课16节以下者,给予学院通报批评处分;\n"
                                "(二)一学期累计旷课达16-23节者,给予警告处分。"
                            ),
                            content_role="procedure",
                            is_answer_bearing=True,
                            anchor={
                                INTERNAL_EVIDENCE_ATTRIBUTES_ANCHOR_KEY: {
                                    "evidence_contract_version": "answer_ready_evidence.v3",
                                    "answer_role": "supporting_detail",
                                    "parent_unit_id": "article-0033",
                                    "condition_subject": "attendance_absence_threshold",
                                    "condition_group_id": "article-0033:attendance_absence_threshold",
                                    "condition_group_subject": "attendance_absence_threshold",
                                    "condition_polarity": "neutral",
                                }
                            },
                            semantic_role="supporting_detail",
                        ),
                    ),
                )

        projection, _ = _build_projection_with_breakdown(
            case=RetrievalQrelsCase(
                case_id="short-fact-attendance-discipline-threshold",
                split="smoke",
                query="旷课多少学时会按违纪处理",
                scope=KnowledgeScope(corpus="regulations", collection="student_rules"),
            ),
            backend=FakeBackend(),
            top_k=5,
        )

        self.assertTrue(
            projection.response.startswith(
                "制度原文没有使用“学时”，而是按“节”统计；一学期累计旷课16节以下即进入违纪处理分档"
            )
        )
        self.assertIn("依据中央民族大学学生违纪处分实施办法 第三十三条", projection.response)

    def test_projection_reference_context_ids_use_primary_answer_sources_only(
        self,
    ) -> None:
        primary_doc_id = "handbook:9350d885657d7409e524e73666b828b826f07191"
        bridge_doc_id = "handbook:e53d05ae90e91f1c45843c50c3a777f774a88afc"

        class FakeBackend:
            def retrieve(self, request):
                return EvidenceBundle(
                    corpus=request.corpus,
                    collection=request.collection,
                    query_text=request.query_text,
                    sources=(
                        replace(
                            _source(doc_id=bridge_doc_id, chunk_id="attendance-bridge-row"),
                            source_title="中央民族大学学生考勤管理办法",
                            detail_label="第十五条-第十七条",
                            snippet=(
                                "学生旷课,视情节由学生处或研究生院根据"
                                "《中央民族大学学生违纪处分实施办法》相关条款给予相应处分。"
                            ),
                            is_answer_bearing=False,
                        ),
                        replace(
                            _source(doc_id=primary_doc_id, chunk_id="attendance-threshold-row"),
                            source_title="中央民族大学学生违纪处分实施办法",
                            detail_label="第三十三条",
                            snippet=(
                                "一学期累计旷课16节以下者,给予学院通报批评处分;"
                                "一学期累计旷课达16-23节者,给予警告处分。"
                            ),
                            content_role="procedure",
                            is_answer_bearing=True,
                            anchor={
                                INTERNAL_EVIDENCE_ATTRIBUTES_ANCHOR_KEY: {
                                    "evidence_contract_version": "answer_ready_evidence.v3",
                                    "answer_role": "supporting_detail",
                                    "parent_unit_id": "article-0033",
                                    "condition_subject": "attendance_absence_threshold",
                                    "condition_group_id": "article-0033:attendance_absence_threshold",
                                    "condition_group_subject": "attendance_absence_threshold",
                                    "condition_polarity": "neutral",
                                }
                            },
                            semantic_role="supporting_detail",
                        ),
                    ),
                )

        projection, _ = _build_projection_with_breakdown(
            case=RetrievalQrelsCase(
                case_id="short-fact-attendance-discipline-threshold",
                split="smoke",
                query="旷课多少学时会按违纪处理",
                scope=KnowledgeScope(corpus="regulations", collection="student_rules"),
                expected_sources=(
                    RetrievalQrelsSourceRef(
                        doc_id=primary_doc_id,
                        grade=2,
                        rationale="学生违纪处分实施办法第三十三条给出旷课处分分档阈值。",
                    ),
                    RetrievalQrelsSourceRef(
                        doc_id=bridge_doc_id,
                        grade=1,
                        rationale="学生考勤管理办法第十七条提供处分链路背景。",
                    ),
                ),
            ),
            backend=FakeBackend(),
            top_k=5,
        )

        self.assertEqual(projection.reference_context_ids, (primary_doc_id,))
        self.assertEqual(projection.metadata["expected_doc_ids"], [primary_doc_id, bridge_doc_id])
        self.assertEqual(
            projection.metadata["answer_reference_doc_ids"],
            [primary_doc_id],
        )

    def test_projection_uses_bound_request_per_category_member_condition_overview(
        self,
    ) -> None:
        seen_requests = []
        member_doc_ids = (
            "handbook:55f7a1b27590bdc59c099f37d84cfa097356ce15",
            "handbook:1f17ba6234c15963648b3d74656d78621cad77a7",
            "handbook:60c8b33801e2e59e6db2210719592a6252e3516d",
            "handbook:a531a3c85de862c737d0576e957bf59598822c54",
            "handbook:aa835b8cd4acddb62c7243fed9a9f8c0728e68bc",
        )

        class FakeBackend:
            def retrieve(self, request):
                seen_requests.append(request)
                if not request.target_document_ids:
                    raise AssertionError("category member diagnostic plan must use target docs")
                doc_id = request.target_document_ids[0]
                return EvidenceBundle(
                    corpus=request.corpus,
                    collection=request.collection,
                    query_text=request.query_text,
                    sources=(
                        replace(
                            _source(
                                doc_id=doc_id,
                                chunk_id="member-condition-row",
                            ),
                            source_title="中央民族大学本科学生奖学金评定办法",
                            snippet="申请奖学金应当热爱社会主义祖国，遵守学校规章制度，学习成绩优良。",
                            content_role="eligibility",
                            is_answer_bearing=True,
                            anchor={
                                INTERNAL_EVIDENCE_ATTRIBUTES_ANCHOR_KEY: {
                                    "evidence_contract_version": "answer_ready_evidence.v3",
                                    "answer_role": "eligibility_condition",
                                    "parent_unit_id": f"{doc_id}:article-1",
                                    "condition_subject": "generic_condition",
                                    "condition_group_id": f"{doc_id}:article-1:generic_condition",
                                    "condition_subject_taxonomy_version": "condition_subject.v1",
                                    "condition_subject_provenance": "test:explicit",
                                    "condition_polarity": "positive",
                                }
                            },
                        ),
                    ),
                )

        projection, _ = _build_projection_with_breakdown(
            case=RetrievalQrelsCase(
                case_id="semantic-scholarship-eligibility",
                split="smoke",
                query="申请奖学金需要满足什么条件",
                scope=KnowledgeScope(corpus="regulations", collection="student_rules"),
            ),
            backend=FakeBackend(),
            top_k=5,
        )

        target_requests = [request for request in seen_requests if request.target_document_ids]
        self.assertGreaterEqual(len(target_requests), 4)
        self.assertEqual(
            len({request.target_document_ids[0] for request in target_requests}),
            len(target_requests),
        )
        self.assertEqual(seen_requests, target_requests)
        self.assertEqual(projection.reference_context_ids, member_doc_ids)

    def test_category_condition_member_plan_uses_per_member_indexed_lookup_steps(
        self,
    ) -> None:
        case = RetrievalQrelsCase(
            case_id="semantic-scholarship-eligibility",
            split="smoke",
            query="申请奖学金需要满足什么条件",
            scope=KnowledgeScope(corpus="regulations", collection="student_rules"),
        )
        request = _build_retrieval_request(case=case, default_top_k=5)
        retrieval_intent = _retrieval_intent_for_case(case)

        plan = _build_diagnostic_retrieval_plan(
            case=case,
            request=request,
            retrieval_intent=retrieval_intent,
            top_k=5,
        )

        self.assertIsNotNone(plan)
        self.assertGreaterEqual(len(plan.steps), 4)
        self.assertTrue(
            all(len(step.selector.target_document_ids) == 1 for step in plan.steps),
        )
        self.assertTrue(
            all(
                step.budget.timeout_ms == RAGAS_DIAGNOSTIC_INDEXED_LOOKUP_TIMEOUT_MS
                for step in plan.steps
            )
        )
        self.assertTrue(
            all(step.budget.top_k == 5 for step in plan.steps),
        )

    def test_specific_policy_procedure_projection_executes_focused_plan(self) -> None:
        seen_requests = []

        class FakeBackend:
            def retrieve(self, request):
                seen_requests.append(request)
                if "听证申请" in request.query_text and request.top_k >= 12:
                    source = replace(
                        _source(
                            doc_id="handbook:1b7c532ecdbc8afe1820d2c55dfba911d891e37a",
                            chunk_id="hearing-application-right-deadline",
                        ),
                        source_title="中央民族大学学生听证实施办法",
                        detail_label="第十三条",
                        snippet=(
                            "学生有要求听证的权利。学生应当在收到拟处分或处理告知书后"
                            "10日内提交书面听证申请,学校15日内组织召开听证会。"
                        ),
                        content_role="time_constraint",
                        is_answer_bearing=True,
                        anchor={
                            INTERNAL_EVIDENCE_ATTRIBUTES_ANCHOR_KEY: {
                                "evidence_contract_version": "answer_ready_evidence.v3",
                                "answer_role": "time_constraint",
                                "semantic_role": "time_constraint",
                                "claim_type": "time_constraint",
                                "parent_unit_id": "handbook:hearing:article-13",
                                "procedure_step_index": 1,
                                "procedure_actor": "student",
                                "procedure_action": "apply",
                                "procedure_action_taxonomy_version": "procedure_action.v1",
                                "procedure_action_provenance": "test:explicit",
                                "condition_subject": "deadline",
                                "condition_group_subject": "deadline",
                                "condition_group_id": "handbook:hearing:article-13:deadline",
                                "condition_subject_taxonomy_version": "condition_subject.v1",
                                "condition_subject_provenance": "test:explicit",
                                "condition_polarity": "positive",
                            }
                        },
                    )
                else:
                    source = replace(
                        _source(
                            doc_id="handbook:1b7c532ecdbc8afe1820d2c55dfba911d891e37a",
                            chunk_id="hearing-meeting-sequence",
                        ),
                        source_title="中央民族大学学生听证实施办法",
                        detail_label="第二十条",
                        snippet=(
                            "听证主持人介绍听证会参加人员,宣布听证纪律,"
                            "询问当事人是否申请回避,宣布听证开始。"
                        ),
                        content_role="procedure",
                        is_answer_bearing=False,
                        anchor={
                            INTERNAL_EVIDENCE_ATTRIBUTES_ANCHOR_KEY: {
                                "evidence_contract_version": "answer_ready_evidence.v3",
                                "answer_role": "supporting_detail",
                                "semantic_role": "supporting_detail",
                                "claim_type": "supporting_detail",
                                "parent_unit_id": "handbook:hearing:article-20",
                            }
                        },
                    )
                return EvidenceBundle(
                    corpus=request.corpus,
                    collection=request.collection,
                    query_text=request.query_text,
                    sources=(source,),
                )

        report = run_ragas_diagnostic(
            backend=FakeBackend(),
            scorer=lambda projection: {"context_precision": 1.0},
            sample_limit_per_surface=12,
            metric_names=("context_precision",),
            case_ids=("semantic-student-hearing-rights",),
        )

        case = report["cases"][0]
        self.assertGreaterEqual(len(seen_requests), 2)
        self.assertIn("听证申请", seen_requests[-1].query_text)
        self.assertGreaterEqual(seen_requests[-1].top_k, 12)
        self.assertEqual(case["case_id"], "semantic-student-hearing-rights")
        self.assertTrue(report["passed"])
        self.assertEqual(case["failure_attribution"]["primary_stage"], "passed")


if __name__ == "__main__":
    unittest.main()
