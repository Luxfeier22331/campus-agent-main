from __future__ import annotations

import json
import unittest
from contextlib import redirect_stdout
from dataclasses import replace
from io import StringIO
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

from campus_contracts import EvidenceBundle, KnowledgeScope
from campus_evals.benchmark import RetrievalQrelsCase
from campus_evals.ragas_diagnostic_runner import (
    _build_projection_with_breakdown,
    _override_ragas_diagnostic_runtime_profiles,
    main,
    run_ragas_diagnostic,
)
from campus_retrieval_core import RestrictedDocumentAccessDeniedError

from tests.evals.ragas_diagnostic_test_support import (
    _answer_ready_regulation_source,
    _diagnostic_source_for_request,
    _discipline_relief_duration_source,
)


class RagasDiagnosticRuntimeSuite(unittest.TestCase):
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
                    sources=(_diagnostic_source_for_request(request),),
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

    def test_run_ragas_diagnostic_marks_disabled_metrics_before_scorer_execution(
        self,
    ) -> None:
        class FakeBackend:
            def retrieve(self, request):
                return EvidenceBundle(
                    corpus=request.corpus,
                    collection=request.collection,
                    query_text=request.query_text,
                    sources=(_diagnostic_source_for_request(request),),
                )

        def contract_asserting_scorer(projection):
            self.assertEqual(
                projection.metadata["metric_applicability"],
                {
                    "faithfulness": False,
                    "answer_relevancy": False,
                    "identity_grounding": True,
                    "context_precision": True,
                },
            )
            return {"context_precision": 1.0}

        report = run_ragas_diagnostic(
            backend=FakeBackend(),
            scorer=contract_asserting_scorer,
            sample_limit_per_surface=1,
            metric_names=(
                "faithfulness",
                "answer_relevancy",
                "identity_grounding",
                "context_precision",
            ),
            case_ids=("institutional-three-assists",),
        )

        case = report["cases"][0]
        self.assertTrue(report["passed"])
        self.assertEqual(
            case["scores"],
            {"identity_grounding": 1.0, "context_precision": 1.0},
        )

    def test_run_ragas_diagnostic_uses_intent_for_unlisted_institutional_title(
        self,
    ) -> None:
        title = "中央民族大学丰台校区就医管理办法（暂行）"

        class FakeBackend:
            def retrieve(self, request):
                source = _answer_ready_regulation_source(
                    doc_id=(
                        "institutional_regulation:muc:"
                        "中央民族大学丰台校区就医管理办法-暂行:ff711d1185f9"
                    ),
                    collection="institutional_rules",
                    chunk_id="medical-title",
                    source_title=title,
                    snippet=f"{title}\n一、就医医院",
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
                source = _answer_ready_regulation_source(
                    doc_id="handbook:55f7a1b27590bdc59c099f37d84cfa097356ce15",
                    chunk_id="national-paper-book",
                    source_title=title,
                    snippet=(
                        f"{title} / 第三章 评选条件 / 第九条\n"
                        "2. 在学术研究上取得显著成绩,以第一作者发表论文或以"
                        "第一、二作者出版学术专著。"
                    ),
                    detail_label="第九条",
                    content_role="eligibility",
                    answer_role="eligibility_condition",
                    semantic_role="eligibility_condition",
                    condition_subject="generic_condition",
                )
                source = replace(source, article_no="第九条", clause_no="2.")
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
                    sources=(_diagnostic_source_for_request(request),),
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
        self.assertEqual(
            report["cases"][0]["raw_retrieved_doc_ids"],
            ["handbook:55f7a1b27590bdc59c099f37d84cfa097356ce15"],
        )
        self.assertEqual(
            report["cases"][0]["selected_support_doc_ids"],
            ["handbook:55f7a1b27590bdc59c099f37d84cfa097356ce15"],
        )
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

    def test_no_hit_qrels_case_passes_when_retrieval_has_no_supporting_evidence(
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

        no_hit_case = RetrievalQrelsCase(
            case_id="stable-reference-no-hit-fictional-service",
            split="regression_locked",
            query="中央民族大学火星校区宇宙签证办理处",
            scope=KnowledgeScope(corpus="official_web", collection="stable_reference"),
            expected_sources=(),
        )

        report = run_ragas_diagnostic(
            backend=EmptyBackend(),
            scorer=lambda projection: {"context_precision": 0.0},
            sample_limit_per_surface=1,
            metric_names=("context_precision",),
            case_ids=(no_hit_case.case_id,),
        )

        self.assertTrue(report["passed"])
        case = report["cases"][0]
        self.assertEqual(case["status"], "completed")
        self.assertEqual(case["diagnostic_reason"], "expected_no_hit")
        self.assertEqual(case["scores"], {})
        self.assertEqual(case["retrieved_context_count"], 0)

    def test_authz_denied_qrels_case_passes_when_retrieval_has_no_supporting_evidence(
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
            scorer=lambda projection: {"context_precision": 0.0},
            sample_limit_per_surface=1,
            metric_names=("context_precision",),
            case_ids=("institutional-student-association-management-authz-deny",),
        )

        self.assertTrue(report["passed"])
        case = report["cases"][0]
        self.assertEqual(case["status"], "completed")
        self.assertEqual(case["diagnostic_reason"], "expected_authz_denied")
        self.assertEqual(case["scores"], {})
        self.assertEqual(case["retrieved_context_count"], 0)

    def test_authz_denied_qrels_case_passes_when_backend_denies_restricted_target(
        self,
    ) -> None:
        class DenyingBackend:
            def retrieve(self, request):
                raise RestrictedDocumentAccessDeniedError("restricted document access denied")

        report = run_ragas_diagnostic(
            backend=DenyingBackend(),
            scorer=lambda projection: {"context_precision": 0.0},
            sample_limit_per_surface=1,
            metric_names=("context_precision",),
            case_ids=("institutional-student-association-management-authz-deny",),
        )

        self.assertTrue(report["passed"])
        case = report["cases"][0]
        self.assertEqual(case["status"], "completed")
        self.assertEqual(case["diagnostic_reason"], "expected_authz_denied")
        self.assertEqual(case["scores"], {})
        self.assertEqual(case["retrieved_context_count"], 0)

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
                    sources=(_diagnostic_source_for_request(request),),
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
                    sources=(_diagnostic_source_for_request(request, doc_id="wrong:doc"),),
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
        self.assertEqual(report["summary"]["failure_attribution"]["retrieval"], 2)
        self.assertEqual(report["summary"]["failure_attribution"]["failed"], 2)
        self.assertEqual(report["summary"]["performance_breakdown"]["case_count"], 2)
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
                        _diagnostic_source_for_request(request, doc_id="wrong:doc"),
                        _diagnostic_source_for_request(
                            request,
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
                target_doc_id = (
                    request.target_document_ids[0] if request.target_document_ids else ""
                )
                source_title = institutional_title_by_doc_id.get(target_doc_id, request.query_text)
                if request.corpus == "regulations" and request.collection == "institutional_rules":
                    source = _answer_ready_regulation_source(
                        doc_id=target_doc_id or f"{request.collection}:{request.query_text}",
                        collection=request.collection,
                        source_title=source_title,
                        snippet=f"{source_title} 相关依据",
                    )
                elif request.corpus == "regulations" and request.collection == "student_rules":
                    source = _diagnostic_source_for_request(request)
                else:
                    source = _diagnostic_source_for_request(request)
                return EvidenceBundle(
                    corpus=request.corpus,
                    collection=request.collection,
                    query_text=request.query_text,
                    sources=(source,),
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
                    source = _diagnostic_source_for_request(request)
                else:
                    source = _answer_ready_regulation_source(
                        doc_id=request.target_document_ids[0]
                        if request.target_document_ids
                        else f"{request.collection}:doc",
                        source_title="中央民族大学解除学生纪律处分实施办法",
                        detail_label="第三条",
                        snippet=(
                            "受警告、严重警告处分的学生,考察期满6个月后可申请解除处分;"
                            "受记过、留校察看处分的学生,考察期满12个月后可申请解除处分。"
                        ),
                        content_role="eligibility",
                        answer_role="eligibility_condition",
                        semantic_role="eligibility_condition",
                        condition_subject="discipline_relief_condition",
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

    def test_run_ragas_diagnostic_rejects_doc_level_article_number_cases(self) -> None:
        with self.assertRaisesRegex(
            ValueError,
            "doc-level article-number qrels case is not answer-ready for RAGAS",
        ):
            run_ragas_diagnostic(
                backend=object(),
                scorer=lambda projection: {"identity_grounding": 1.0},
                sample_limit_per_surface=1,
                metric_names=("identity_grounding",),
                case_ids=("article-number-degree-procedure",),
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


if __name__ == "__main__":
    unittest.main()
