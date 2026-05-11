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
from campus_evals.benchmark import RetrievalQrelsCase
from campus_evals.ragas_diagnostic_runner import (
    DEFAULT_RAGAS_DIAGNOSTIC_SAMPLE_LIMIT_PER_SURFACE,
    _build_projection_with_breakdown,
    build_ragas_diagnostic_sample_manifest,
    combine_ragas_diagnostic_reports,
    main,
    run_ragas_diagnostic,
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
        self.assertEqual(
            institutional_request.query_text,
            "研究生助教助研助管工作应该依据哪份管理办法？",
        )
        self.assertEqual(
            institutional_request.authorized_filter,
            AuthorizedRetrievalFilter(
                entitlement_groups=("campus_members",),
                visibility_scope="campus",
                visibility_level="restricted",
            ),
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
        self.assertEqual(report["cases"][0]["fallback_path"], "")
        self.assertEqual(report["cases"][0]["fallback_reason"], "")
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
                    sources=(_source(doc_id=f"{request.collection}:doc"),),
                )

        report = run_ragas_diagnostic(
            backend=FakeBackend(),
            scorer=lambda projection: {"answer_relevancy": None},
            sample_limit_per_surface=1,
            metric_names=("answer_relevancy",),
        )

        first_case = report["cases"][0]
        self.assertTrue(report["passed"])
        self.assertEqual(report["summary"]["failed_cases"], 0)
        self.assertEqual(first_case["status"], "completed")
        self.assertNotIn("error_type", first_case)
        self.assertEqual(first_case["scores"], {})
        self.assertNotIn("metric_failures", first_case)
        self.assertEqual(first_case["failure_attribution"]["primary_stage"], "passed")

    def test_run_ragas_diagnostic_respects_case_workers_and_preserves_order(self) -> None:
        class FakeBackend:
            def retrieve(self, request):
                return EvidenceBundle(
                    corpus=request.corpus,
                    collection=request.collection,
                    query_text=request.query_text,
                    sources=(_source(doc_id=f"{request.collection}:{request.query_text}"),),
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
                    ]
                )
            manifest = json.loads((output_dir / "sample-manifest.json").read_text())
            report = json.loads((output_dir / "ragas-diagnostic.current.json").read_text())
            metric_report = json.loads(
                (output_dir / "ragas-diagnostic.context_precision.json").read_text()
            )
            summary = json.loads((output_dir / "ragas-diagnostic.summary.json").read_text())

        self.assertEqual(exit_code, 0)
        self.assertEqual(len(manifest["cases"]), 4)
        self.assertTrue(report["passed"])
        self.assertEqual(report["run_config"]["metric_names"], ["context_precision"])
        self.assertEqual(report["run_config"]["case_workers"], 2)
        self.assertEqual(metric_report["summary"]["metrics"]["context_precision"]["count"], 4)
        self.assertEqual(summary["total_cases"], 4)
        self.assertEqual(summary["metrics"]["context_precision"]["count"], 4)
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


if __name__ == "__main__":
    unittest.main()
