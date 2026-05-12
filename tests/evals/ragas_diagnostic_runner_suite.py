from __future__ import annotations

import json
import unittest
from contextlib import redirect_stdout
from dataclasses import replace
from io import StringIO
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

from campus_contracts import AuthorizedRetrievalFilter, EvidenceBundle, KnowledgeScope
from campus_evals.benchmark import RetrievalQrelsCase, RetrievalQrelsSourceRef
from campus_evals.ragas_diagnostic_runner import (
    DEFAULT_RAGAS_DIAGNOSTIC_SAMPLE_LIMIT_PER_SURFACE,
    RAGAS_DIAGNOSTIC_INDEXED_LOOKUP_TIMEOUT_MS,
    _build_diagnostic_retrieval_plan,
    _build_projection_with_breakdown,
    _override_ragas_diagnostic_runtime_profiles,
    _retrieval_intent_for_case,
    build_ragas_diagnostic_sample_manifest,
    combine_ragas_diagnostic_reports,
    main,
    run_ragas_diagnostic,
)
from campus_evals.retrieval_live_benchmark import _build_retrieval_request
from campus_retrieval_core.evidence_attributes import INTERNAL_EVIDENCE_ATTRIBUTES_ANCHOR_KEY

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
                    sources=(_source(doc_id=f"{request.collection}:doc"),),
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
            (
                "institutional_regulation:muc:"
                "中央民族大学研究生-三助-工作管理办法:49319e7c44d3",
            ),
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
                        replace(
                            _source(
                                doc_id="handbook:6f147355748d2d2f181c310f8d1e0da908f2f1a8",
                                chunk_id="discipline-relief-condition",
                            ),
                            source_title="中央民族大学解除学生纪律处分实施办法",
                            snippet="学生受处分满考察期后，可以申请解除纪律处分。",
                            detail_label="第三条",
                            is_answer_bearing=True,
                            anchor={
                                INTERNAL_EVIDENCE_ATTRIBUTES_ANCHOR_KEY: {
                                    "evidence_contract_version": "answer_ready_evidence.v3",
                                    "answer_role": "eligibility_condition",
                                    "semantic_role": "eligibility_condition",
                                    "claim_type": "condition",
                                    "condition_subject": "discipline_relief_condition",
                                    "condition_polarity": "positive",
                                    "article_no": "第三条",
                                }
                            },
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
                    replace(
                        _source(
                            doc_id=doc_id,
                            chunk_id=f"{doc_id}:condition-row",
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
                                    "condition_polarity": "neutral",
                                }
                            },
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

        self.assertTrue(projection.response.startswith("旷课按违纪处理的最低命中分档"))
        self.assertIn("其余分档依据中央民族大学学生违纪处分实施办法 第三十三条", projection.response)

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
                            is_answer_bearing=True,
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
                                    "condition_group_subject": "attendance_absence_threshold",
                                    "condition_polarity": "neutral",
                                }
                            },
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

    def test_run_ragas_diagnostic_scores_document_identity_with_deterministic_grounding(
        self,
    ) -> None:
        seen_projections = []

        class FakeBackend:
            def retrieve(self, request):
                return EvidenceBundle(
                    corpus=request.corpus,
                    collection=request.collection,
                    query_text=request.query_text,
                    sources=(
                        _source(
                            doc_id=(
                                "institutional_regulation:muc:"
                                "中央民族大学研究生-三助-工作管理办法:49319e7c44d3"
                            ),
                        ),
                    ),
                )

        def fake_scorer(projection):
            seen_projections.append(projection)
            return {"faithfulness": 0.0}

        report = run_ragas_diagnostic(
            backend=FakeBackend(),
            scorer=fake_scorer,
            sample_limit_per_surface=1,
            metric_names=("faithfulness", "identity_grounding"),
        )

        institutional_case = next(
            case for case in report["cases"] if case["case_id"] == "institutional-three-assists"
        )
        self.assertEqual(institutional_case["answer_shape"], "title_lookup")
        self.assertEqual(institutional_case["presentation_kind"], "document_identity")
        self.assertNotIn("faithfulness", institutional_case["scores"])
        self.assertEqual(institutional_case["scores"]["identity_grounding"], 1.0)
        self.assertEqual(institutional_case["failure_attribution"]["primary_stage"], "passed")
        self.assertTrue(
            any(
                projection.case_id == "institutional-three-assists"
                and projection.metadata.get("presentation_kind") == "document_identity"
                for projection in seen_projections
            )
        )

    def test_run_ragas_diagnostic_uses_intent_for_unlisted_institutional_title(
        self,
    ) -> None:
        title = "中央民族大学丰台校区就医管理办法（暂行）"

        class FakeBackend:
            def retrieve(self, request):
                return EvidenceBundle(
                    corpus=request.corpus,
                    collection=request.collection,
                    query_text=request.query_text,
                    sources=(
                        replace(
                            _source(
                                doc_id=(
                                    "institutional_regulation:muc:"
                                    "中央民族大学丰台校区就医管理办法-暂行:ff711d1185f9"
                                ),
                                chunk_id="medical-title",
                            ),
                            source_title=title,
                            snippet=f"{title}\n一、就医医院",
                            is_answer_bearing=True,
                        ),
                    ),
                )

        report = run_ragas_diagnostic(
            backend=FakeBackend(),
            scorer=lambda projection: {"context_precision": 1.0},
            sample_limit_per_surface=2,
            metric_names=("identity_grounding", "context_precision"),
        )

        case = next(
            item
            for item in report["cases"]
            if item["case_id"] == "institutional-title-exact-ff711d1185f9"
        )
        self.assertEqual(case["answer_shape"], "title_lookup")
        self.assertEqual(case["presentation_kind"], "document_identity")
        self.assertEqual(case["retrieval_intent_kind"], "policy_object_lookup")
        self.assertEqual(case["retrieval_answer_kind"], "policy_object")
        self.assertEqual(case["scores"]["identity_grounding"], 1.0)
        self.assertIn(title, case["answer_text"])
        self.assertNotEqual(case["answer_text"], "")

    def test_run_ragas_diagnostic_uses_intent_for_rewritten_policy_clause_answers(
        self,
    ) -> None:
        seen_projections = []
        title = "中央民族大学本科学生国家奖学金评审办法"

        class FakeBackend:
            def retrieve(self, request):
                source = replace(
                    _source(
                        doc_id="handbook:55f7a1b27590bdc59c099f37d84cfa097356ce15",
                        chunk_id="national-paper-book",
                    ),
                    source_title=title,
                    snippet=(
                        f"{title} / 第三章 评选条件 / 第九条\n"
                        "2. 在学术研究上取得显著成绩,以第一作者发表论文或以"
                        "第一、二作者出版学术专著。"
                    ),
                    detail_label="第九条",
                    article_no="第九条",
                    clause_no="2.",
                    content_role="eligibility",
                    is_answer_bearing=True,
                )
                return EvidenceBundle(
                    corpus=request.corpus,
                    collection=request.collection,
                    query_text=f"{title} {request.query_text}",
                    sources=(source,),
                )

        def fake_scorer(projection):
            seen_projections.append(projection)
            return {"faithfulness": 1.0, "answer_relevancy": 1.0}

        report = run_ragas_diagnostic(
            backend=FakeBackend(),
            scorer=fake_scorer,
            sample_limit_per_surface=2,
            metric_names=("faithfulness", "answer_relevancy"),
        )

        case = next(
            item
            for item in report["cases"]
            if item["case_id"] == "policy-alias-national-scholarship-article-nine"
        )
        self.assertEqual(case["answer_shape"], "detail_clause")
        self.assertIn("论文", case["answer_text"])
        self.assertIn("第一作者", case["answer_text"])
        self.assertNotIn("相关依据为", case["answer_text"])
        self.assertEqual(case["retrieval_intent_kind"], "specific_clause_lookup")
        self.assertEqual(case["retrieval_answer_kind"], "specific_clause")
        projection = next(
            projection
            for projection in seen_projections
            if projection.case_id == "policy-alias-national-scholarship-article-nine"
        )
        self.assertEqual(projection.metadata["retrieval_intent_kind"], "specific_clause_lookup")

    def test_projection_for_planner_clarification_case_uses_clarification_text(self) -> None:
        class FakeBackend:
            def retrieve(self, request):
                return EvidenceBundle(
                    corpus=request.corpus,
                    collection=request.collection,
                    query_text=request.query_text,
                    sources=(),
                )

        projection, _ = _build_projection_with_breakdown(
            case=RetrievalQrelsCase(
                case_id="ambiguous-scholarship-procedure",
                split="smoke",
                query="奖学金怎么申请？",
                scope=KnowledgeScope(corpus="regulations", collection="student_rules"),
            ),
            backend=FakeBackend(),
            top_k=5,
        )

        self.assertIn("请说明", projection.response)
        self.assertEqual(projection.metadata["retrieval_intent_kind"], "clarification_required")
        self.assertEqual(projection.metadata["retrieval_answer_kind"], "clarification")
        self.assertEqual(projection.metadata["answer_shape"], "general_summary")
        self.assertEqual(projection.metadata["presentation_kind"], "clarification")

    def test_run_ragas_diagnostic_uses_retrieved_evidence_and_fake_scorer(self) -> None:
        seen_bundles: list[EvidenceBundle] = []

        class FakeBackend:
            def retrieve(self, request):
                bundle = EvidenceBundle(
                    corpus=request.corpus,
                    collection=request.collection,
                    query_text=request.query_text,
                    sources=(_source(doc_id=f"{request.collection}:doc"),),
                )
                seen_bundles.append(bundle)
                return bundle

        def fake_scorer(projection):
            return {
                "context_precision": 0.91,
            }

        report = run_ragas_diagnostic(
            backend=FakeBackend(),
            scorer=fake_scorer,
            sample_limit_per_surface=1,
            metric_names=("context_precision",),
        )

        self.assertTrue(report["passed"])
        self.assertEqual(report["summary"]["total_cases"], 4)
        self.assertEqual(report["summary"]["failed_cases"], 0)
        self.assertEqual(report["run_config"]["sample_limit_per_surface"], 1)
        self.assertEqual(report["run_config"]["top_k"], 5)
        self.assertEqual(report["run_config"]["metric_names"], ["context_precision"])
        self.assertEqual(len(seen_bundles), 4)
        self.assertTrue(report["cases"][0]["answer_text"])
        self.assertEqual(report["cases"][0]["answer_shape"], "title_lookup")
        self.assertEqual(report["cases"][0]["presentation_kind"], "document_identity")
        self.assertEqual(report["cases"][0]["presentation_path"], "")
        self.assertEqual(report["cases"][0]["diagnostic_reason"], "")
        self.assertEqual(report["cases"][0]["retrieval_intent_kind"], "policy_object_lookup")
        self.assertEqual(report["cases"][0]["retrieval_answer_kind"], "policy_object")
        self.assertEqual(report["cases"][0]["scores"]["context_precision"], 0.91)
        self.assertNotIn("answer_relevancy", report["cases"][0]["scores"])
        self.assertEqual(report["cases"][0]["retrieved_context_count"], 1)
        self.assertEqual(report["cases"][0]["raw_retrieved_doc_ids"], ["student_rules:doc"])
        self.assertEqual(report["cases"][0]["selected_support_doc_ids"], ["student_rules:doc"])
        self.assertIn("duration_ms", report["cases"][0])
        self.assertEqual(
            set(report["cases"][0]["performance_breakdown"]),
            {
                "retrieval_ms",
                "answer_ms",
                "scorer_ms",
                "diagnostic_ms",
                "dependency_wait_ms",
            },
        )
        self.assertEqual(
            report["cases"][0]["failure_attribution"]["primary_stage"],
            "passed",
        )

    def test_run_ragas_diagnostic_fails_closed_when_projection_has_no_answer_support(
        self,
    ) -> None:
        class EmptyBackend:
            def retrieve(self, request):
                return EvidenceBundle(
                    corpus=request.corpus,
                    collection=request.collection,
                    query_text=request.query_text,
                    sources=(),
                )

        report = run_ragas_diagnostic(
            backend=EmptyBackend(),
            scorer=lambda projection: {"context_precision": 1.0},
            sample_limit_per_surface=1,
            metric_names=("context_precision",),
        )

        first_case = report["cases"][0]
        self.assertFalse(report["passed"])
        self.assertEqual(first_case["status"], "failed")
        self.assertEqual(first_case["error_type"], "RagasProjectionContractError")
        self.assertIn("no supporting evidence", first_case["error_message"])
        self.assertEqual(report["summary"]["failed_cases"], 4)

    def test_diagnostic_runtime_profile_override_targets_preview_collection(
        self,
    ) -> None:
        import campus_retrieval_core.backend_qdrant as backend_qdrant_module
        import campus_retrieval_core.service as retrieval_service_module

        with _override_ragas_diagnostic_runtime_profiles(
            {
                "regulations/student_rules": "student_rules__r20260512_preview",
            }
        ):
            backend_profile = backend_qdrant_module.load_runtime_profile(
                "regulations",
                "student_rules",
            )
            service_profile = retrieval_service_module.load_runtime_profile(
                "regulations",
                "student_rules",
            )

        self.assertTrue(backend_profile.retrieval_enabled)
        self.assertEqual(
            backend_profile.qdrant_index_binding.alias_name,
            "student_rules__r20260512_preview",
        )
        self.assertEqual(
            service_profile.qdrant_index_binding.alias_name,
            "student_rules__r20260512_preview",
        )

    def test_cli_accepts_scoped_qdrant_collection_override(self) -> None:
        class FakeBackend:
            def retrieve(self, request):
                return EvidenceBundle(
                    corpus=request.corpus,
                    collection=request.collection,
                    query_text=request.query_text,
                    sources=(_source(doc_id=f"{request.collection}:doc"),),
                )

        with TemporaryDirectory() as temp_dir:
            output_dir = Path(temp_dir)
            with (
                patch(
                    "campus_evals.ragas_diagnostic_runner.build_retrieval_backend",
                    return_value=FakeBackend(),
                ),
                redirect_stdout(StringIO()),
            ):
                exit_code = main(
                    [
                        "--output-dir",
                        str(output_dir),
                        "--sample-limit-per-surface",
                        "1",
                        "--fake-scorer",
                        "--metric-name",
                        "context_precision",
                        "--qdrant-collection-name",
                        "regulations/student_rules=student_rules__r20260512_preview",
                    ]
                )
            report = json.loads((output_dir / "ragas-diagnostic.current.json").read_text())

        self.assertEqual(exit_code, 0)
        self.assertEqual(
            report["run_config"]["qdrant_collection_overrides"],
            {"regulations/student_rules": "student_rules__r20260512_preview"},
        )

    def test_run_ragas_diagnostic_attributes_low_scores_to_retrieval_or_synthesis(
        self,
    ) -> None:
        class WrongBackend:
            def retrieve(self, request):
                return EvidenceBundle(
                    corpus=request.corpus,
                    collection=request.collection,
                    query_text=request.query_text,
                    sources=(_source(doc_id="wrong:doc"),),
                )

        report = run_ragas_diagnostic(
            backend=WrongBackend(),
            scorer=lambda projection: {"context_recall": 0.2, "answer_relevancy": 0.4},
            sample_limit_per_surface=1,
            metric_names=("context_recall", "answer_relevancy"),
        )

        first_case = report["cases"][0]
        self.assertEqual(
            first_case["failure_attribution"]["metric_failures"],
            {"context_recall": "retrieval"},
        )
        self.assertEqual(first_case["failure_attribution"]["primary_stage"], "retrieval")
        self.assertEqual(report["summary"]["failure_attribution"]["retrieval"], 4)
        self.assertEqual(report["summary"]["performance_breakdown"]["case_count"], 4)
        self.assertIn("retrieval_ms", report["summary"]["performance_breakdown"])

    def test_run_ragas_diagnostic_attributes_answer_quality_to_evidence_selection_when_raw_retrieval_had_expected_doc(
        self,
    ) -> None:
        class MixedBackend:
            def retrieve(self, request):
                return EvidenceBundle(
                    corpus=request.corpus,
                    collection=request.collection,
                    query_text=request.query_text,
                    sources=(
                        _source(doc_id="wrong:doc"),
                        _source(
                            doc_id="handbook:55f7a1b27590bdc59c099f37d84cfa097356ce15",
                        ),
                    ),
                )

        report = run_ragas_diagnostic(
            backend=MixedBackend(),
            scorer=lambda projection: {"answer_relevancy": 0.4},
            sample_limit_per_surface=1,
            metric_names=("answer_relevancy",),
        )

        first_case = report["cases"][0]
        self.assertEqual(first_case["status"], "completed")
        self.assertEqual(
            first_case["failure_attribution"]["metric_failures"],
            {},
        )
        self.assertEqual(first_case["failure_attribution"]["primary_stage"], "passed")

    def test_run_ragas_diagnostic_marks_requested_null_metric_as_failed(self) -> None:
        class FakeBackend:
            def retrieve(self, request):
                return EvidenceBundle(
                    corpus=request.corpus,
                    collection=request.collection,
                    query_text=request.query_text,
                    sources=(_discipline_relief_duration_source(),),
                )

        report = run_ragas_diagnostic(
            backend=FakeBackend(),
            scorer=lambda projection: {"answer_relevancy": None},
            sample_limit_per_surface=1,
            metric_names=("answer_relevancy",),
            case_ids=("semantic-disciplinary-relief",),
        )

        first_case = report["cases"][0]
        self.assertFalse(report["passed"])
        self.assertEqual(report["summary"]["failed_cases"], 1)
        self.assertEqual(first_case["status"], "failed")
        self.assertEqual(first_case["error_type"], "RagasMetricUnavailable")
        self.assertEqual(first_case["scores"], {"answer_relevancy": None})
        self.assertEqual(first_case["metric_failures"][0]["metric_name"], "answer_relevancy")
        self.assertEqual(first_case["failure_attribution"]["primary_stage"], "diagnostic")

    def test_live_scorer_null_metric_failure_includes_underlying_rationale(self) -> None:

        class FakeBackend:
            def retrieve(self, request):
                return EvidenceBundle(
                    corpus=request.corpus,
                    collection=request.collection,
                    query_text=request.query_text,
                    sources=(_discipline_relief_duration_source(),),
                )

        def fake_live_scorer(projection):
            projection.metadata["metric_diagnostics"] = {
                "answer_relevancy": {
                    "verdict": "failed",
                    "rationale": "ragas runtime error: provider timeout",
                    "metadata": {"judge_error": "TimeoutError", "failure_reasons": ["timeout"]},
                }
            }
            return {"answer_relevancy": None}

        report = run_ragas_diagnostic(
            backend=FakeBackend(),
            scorer=fake_live_scorer,
            sample_limit_per_surface=1,
            metric_names=("answer_relevancy",),
            case_ids=("semantic-disciplinary-relief",),
        )

        first_case = report["cases"][0]
        self.assertEqual(first_case["status"], "failed")
        self.assertIn("provider timeout", first_case["error_message"])
        self.assertIn("TimeoutError", first_case["error_message"])
        self.assertIn("timeout", first_case["metric_failures"][0]["error_message"])

    def test_run_ragas_diagnostic_respects_case_workers_and_preserves_order(self) -> None:
        institutional_title_by_doc_id = {
            "institutional_regulation:muc:中央民族大学研究生-三助-工作管理办法:49319e7c44d3": "中央民族大学研究生“三助”工作管理办法",
            "institutional_regulation:muc:中央民族大学丰台校区就医管理办法-暂行:ff711d1185f9": "中央民族大学丰台校区就医管理办法（暂行）",
            "institutional_regulation:muc:中央民族大学学生公费医疗管理办法:81401d3a02d6": "中央民族大学学生公费医疗管理办法",
            "institutional_regulation:muc:中央民族大学学生社团管理办法:7da72ac3d796": "中央民族大学学生社团管理办法",
            "institutional_regulation:muc:中央民族大学学费-住宿费收费管理规定:40d4d65809c5": "中央民族大学学费、住宿费收费管理规定",
            "institutional_regulation:muc:中央民族大学排课管理办法:e593d7a51e16": "中央民族大学排课管理办法",
        }

        class FakeBackend:
            def retrieve(self, request):
                target_doc_id = request.target_document_ids[0] if request.target_document_ids else ""
                source_title = institutional_title_by_doc_id.get(target_doc_id, request.query_text)
                return EvidenceBundle(
                    corpus=request.corpus,
                    collection=request.collection,
                    query_text=request.query_text,
                    sources=(
                        replace(
                            _source(doc_id=f"{request.collection}:{request.query_text}"),
                            source_title=source_title,
                            snippet=f"{source_title} 相关依据",
                            is_answer_bearing=True,
                            anchor={
                                INTERNAL_EVIDENCE_ATTRIBUTES_ANCHOR_KEY: {
                                    "evidence_contract_version": "answer_ready_evidence.v3",
                                    "answer_role": "primary_content",
                                }
                            },
                        ),
                    ),
                )

        report = run_ragas_diagnostic(
            backend=FakeBackend(),
            scorer=lambda projection: {"context_precision": 1.0},
            sample_limit_per_surface=2,
            metric_names=("context_precision",),
            case_workers=2,
        )

        self.assertTrue(report["passed"])
        self.assertEqual(report["run_config"]["case_workers"], 2)
        self.assertEqual(len(report["cases"]), 8)
        self.assertEqual(report["cases"][0]["case_id"], "policy-title-scholarship")
        self.assertEqual(
            report["cases"][1]["case_id"], "policy-alias-national-scholarship-article-nine"
        )

    def test_run_ragas_diagnostic_filters_to_explicit_case_ids(self) -> None:
        class FakeBackend:
            def retrieve(self, request):
                if request.collection == "curriculum_plan":
                    source = replace(
                        _source(doc_id="curriculum_plan:digital-economy"),
                        source_title="数字经济专业本科培养方案",
                        snippet="数字经济专业本科培养方案 相关依据",
                        is_answer_bearing=True,
                        anchor={
                            INTERNAL_EVIDENCE_ATTRIBUTES_ANCHOR_KEY: {
                                "evidence_contract_version": "answer_ready_evidence.v3",
                                "answer_role": "primary_content",
                            }
                        },
                    )
                else:
                    source = replace(
                        _source(doc_id=f"{request.collection}:doc"),
                        source_title="中央民族大学解除学生纪律处分实施办法",
                        detail_label="第三条",
                        snippet=(
                            "受警告、严重警告处分的学生,考察期满6个月后可申请解除处分;"
                            "受记过、留校察看处分的学生,考察期满12个月后可申请解除处分。"
                        ),
                        is_answer_bearing=True,
                        anchor={
                            INTERNAL_EVIDENCE_ATTRIBUTES_ANCHOR_KEY: {
                                "evidence_contract_version": "answer_ready_evidence.v3",
                                "answer_role": "eligibility_condition",
                                "condition_subject": "discipline_relief_condition",
                                "condition_polarity": "positive",
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
            sample_limit_per_surface=1,
            metric_names=("context_precision",),
            case_ids=("semantic-disciplinary-relief", "digital-economy-plan-paraphrase"),
        )

        self.assertTrue(report["passed"])
        self.assertEqual(
            [case["case_id"] for case in report["cases"]],
            ["semantic-disciplinary-relief", "digital-economy-plan-paraphrase"],
        )
        self.assertEqual(
            report["run_config"]["case_ids"],
            ["semantic-disciplinary-relief", "digital-economy-plan-paraphrase"],
        )
        self.assertEqual(
            report["sample_manifest"]["case_ids"],
            ["semantic-disciplinary-relief", "digital-economy-plan-paraphrase"],
        )

    def test_run_ragas_diagnostic_rejects_unknown_case_id(self) -> None:
        with self.assertRaisesRegex(ValueError, "unknown RAGAS diagnostic case_id"):
            run_ragas_diagnostic(
                backend=object(),
                scorer=lambda projection: {"context_precision": 1.0},
                sample_limit_per_surface=1,
                metric_names=("context_precision",),
                case_ids=("missing-ragas-case",),
            )

    def test_run_ragas_diagnostic_rejects_invalid_case_workers(self) -> None:
        with self.assertRaisesRegex(ValueError, "case_workers must be greater than zero"):
            run_ragas_diagnostic(
                backend=object(),
                scorer=lambda projection: {"context_precision": 1.0},
                sample_limit_per_surface=1,
                metric_names=("context_precision",),
                case_workers=0,
            )

    def test_cli_writes_manifest_and_report_with_fake_runtime(self) -> None:
        class FakeBackend:
            def retrieve(self, request):
                return EvidenceBundle(
                    corpus=request.corpus,
                    collection=request.collection,
                    query_text=request.query_text,
                    sources=(_source(doc_id=f"{request.collection}:doc"),),
                )

        with TemporaryDirectory() as temp_dir:
            output_dir = Path(temp_dir)
            with (
                patch(
                    "campus_evals.ragas_diagnostic_runner.build_retrieval_backend",
                    return_value=FakeBackend(),
                ),
                redirect_stdout(StringIO()),
            ):
                exit_code = main(
                    [
                        "--output-dir",
                        str(output_dir),
                        "--sample-limit-per-surface",
                        "1",
                        "--fake-scorer",
                        "--metric-name",
                        "context_precision",
                        "--case-workers",
                        "2",
                        "--case-id",
                        "policy-title-scholarship",
                    ]
                )
            manifest = json.loads((output_dir / "sample-manifest.json").read_text())
            report = json.loads((output_dir / "ragas-diagnostic.current.json").read_text())
            metric_report = json.loads(
                (output_dir / "ragas-diagnostic.context_precision.json").read_text()
            )
            summary = json.loads((output_dir / "ragas-diagnostic.summary.json").read_text())

        self.assertEqual(exit_code, 0)
        self.assertEqual(len(manifest["cases"]), 1)
        self.assertEqual(manifest["case_ids"], ["policy-title-scholarship"])
        self.assertTrue(report["passed"])
        self.assertEqual(report["run_config"]["metric_names"], ["context_precision"])
        self.assertEqual(report["run_config"]["case_workers"], 2)
        self.assertEqual(report["run_config"]["case_ids"], ["policy-title-scholarship"])
        self.assertEqual(metric_report["summary"]["metrics"]["context_precision"]["count"], 1)
        self.assertEqual(summary["total_cases"], 1)
        self.assertEqual(summary["metrics"]["context_precision"]["count"], 1)
        self.assertNotIn("faithfulness", summary["metrics"])
        self.assertEqual(
            DEFAULT_RAGAS_DIAGNOSTIC_SAMPLE_LIMIT_PER_SURFACE,
            12,
        )

    def test_combine_ragas_diagnostic_reports_merges_metric_scores_and_low_cases(self) -> None:
        combined = combine_ragas_diagnostic_reports(
            [
                _report(
                    metric_name="context_recall",
                    cases=[
                        _case("student", "a", "context_recall", 1.0),
                        _case("student", "b", "context_recall", 0.25),
                    ],
                ),
                _report(
                    metric_name="answer_relevancy",
                    cases=[
                        _case("student", "a", "answer_relevancy", 0.91),
                        _case("student", "b", "answer_relevancy", 0.48),
                    ],
                ),
            ]
        )

        self.assertTrue(combined["passed"])
        self.assertEqual(combined["summary"]["total_reports"], 2)
        self.assertEqual(
            combined["summary"]["run_configs"],
            [
                {"metric_names": ["context_recall"]},
                {"metric_names": ["answer_relevancy"]},
            ],
        )
        self.assertEqual(combined["summary"]["total_cases"], 2)
        self.assertEqual(combined["summary"]["metrics"]["context_recall"]["min"], 0.25)
        self.assertEqual(combined["summary"]["metrics"]["answer_relevancy"]["min"], 0.48)
        self.assertEqual(
            [item["metric_name"] for item in combined["summary"]["low_score_cases"]],
            ["context_recall", "answer_relevancy"],
        )
        self.assertEqual(
            combined["cases"][1]["scores"],
            {"answer_relevancy": 0.48, "context_recall": 0.25},
        )

    def test_combine_ragas_diagnostic_reports_marks_null_requested_metric_as_failure(self) -> None:
        combined = combine_ragas_diagnostic_reports(
            [
                _report(
                    metric_name="answer_relevancy",
                    cases=[_case("student", "a", "answer_relevancy", None)],
                )
            ]
        )

        self.assertFalse(combined["passed"])
        self.assertEqual(combined["summary"]["failed_cases"], 1)
        self.assertEqual(combined["summary"]["metrics"]["answer_relevancy"]["count"], 0)
        self.assertEqual(combined["cases"][0]["status"], "failed")
        self.assertEqual(combined["cases"][0]["scores"], {"answer_relevancy": None})
        self.assertEqual(
            combined["cases"][0]["metric_failures"],
            [
                {
                    "metric_names": ["answer_relevancy"],
                    "error_type": "RagasMetricUnavailable",
                    "error_message": (
                        "requested RAGAS metric answer_relevancy did not return a numeric score"
                    ),
                }
            ],
        )

    def test_cli_combines_existing_metric_reports_without_running_retrieval(self) -> None:
        with TemporaryDirectory() as temp_dir:
            output_dir = Path(temp_dir)
            (output_dir / "ragas-diagnostic.context_recall.json").write_text(
                json.dumps(
                    _report(
                        metric_name="context_recall",
                        cases=[_case("student", "a", "context_recall", 0.25)],
                    )
                ),
                encoding="utf-8",
            )
            (output_dir / "ragas-diagnostic.answer_relevancy.json").write_text(
                json.dumps(
                    _report(
                        metric_name="answer_relevancy",
                        cases=[_case("student", "a", "answer_relevancy", 0.48)],
                    )
                ),
                encoding="utf-8",
            )

            with redirect_stdout(StringIO()):
                exit_code = main(["--output-dir", str(output_dir), "--combine-existing-reports"])
            combined = json.loads((output_dir / "ragas-diagnostic.combined.json").read_text())
            summary = json.loads((output_dir / "ragas-diagnostic.summary.json").read_text())

        self.assertEqual(exit_code, 0)
        self.assertEqual(combined["summary"]["total_reports"], 2)
        self.assertEqual(summary["metrics"]["context_recall"]["min"], 0.25)


def _report(*, metric_name: str, cases: list[dict[str, object]]) -> dict[str, object]:
    return {
        "schema_version": "ragas-diagnostic-report.v1",
        "report_id": "ragas_diagnostic",
        "passed": True,
        "mode": "diagnostic_non_blocking",
        "run_config": {"metric_names": [metric_name]},
        "sample_manifest": {"metric_names": [metric_name]},
        "summary": {},
        "cases": cases,
    }


def _case(
    surface_key: str,
    case_id: str,
    metric_name: str,
    score: object,
) -> dict[str, object]:
    return {
        "surface_key": surface_key,
        "case_id": case_id,
        "split": "release_gate",
        "query": f"query {case_id}",
        "expected_doc_ids": [f"{case_id}:expected"],
        "forbidden_doc_ids": [],
        "status": "completed",
        "answer_text": f"answer {case_id}",
        "retrieved_context_count": 1,
        "retrieved_context_ids": [f"{case_id}:retrieved"],
        "raw_retrieved_doc_ids": [f"{case_id}:retrieved"],
        "selected_support_doc_ids": [f"{case_id}:retrieved"],
        "duration_ms": 1,
        "scores": {metric_name: score},
    }


def _discipline_relief_duration_source():
    return replace(
        _source(doc_id="handbook:6f147355748d2d2f181c310f8d1e0da908f2f1a8"),
        source_title="中央民族大学解除学生纪律处分实施办法",
        detail_label="第三条",
        snippet=(
            "受警告、严重警告处分的学生,考察期满6个月后可申请解除处分;"
            "受记过、留校察看处分的学生,考察期满12个月后可申请解除处分。"
        ),
        is_answer_bearing=True,
        anchor={
            INTERNAL_EVIDENCE_ATTRIBUTES_ANCHOR_KEY: {
                "evidence_contract_version": "answer_ready_evidence.v3",
                "answer_role": "eligibility_condition",
                "condition_subject": "discipline_relief_condition",
                "condition_polarity": "positive",
            }
        },
    )


if __name__ == "__main__":
    unittest.main()
