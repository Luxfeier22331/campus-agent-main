from __future__ import annotations

import unittest

from campus_contracts import EvidenceBundle
from campus_evals.ragas_diagnostic_runner import (
    run_ragas_diagnostic,
)

from tests.evals.ragas_diagnostic_test_support import (
    _answer_ready_regulation_source,
    _diagnostic_source_for_request,
    _discipline_relief_duration_source,
)


class RagasDiagnosticRuntimeTailSuite(unittest.TestCase):
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
