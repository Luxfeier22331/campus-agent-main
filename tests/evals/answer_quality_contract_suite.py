from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from tests.evals.retrieval_benchmark_test_support import (
    INSTITUTIONAL_RULES_RETRIEVAL_EVAL_MANIFEST_PATH,
)

from campus_evals.answer_quality_contract import (
    AnswerQualityObservation,
    evaluate_answer_quality_cases,
    load_answer_quality_cases,
    run_answer_quality_contract_profile,
)

INSTITUTIONAL_RULES_ANSWER_CASES_PATH = (
    Path(__file__).resolve().parents[2]
    / "packages"
    / "evals"
    / "fixtures"
    / "institutional_rules_answer_quality_cases.v1.json"
)


class AnswerQualityContractSuite(unittest.TestCase):
    def test_evaluator_checks_required_facts_forbidden_claims_and_source_url(self) -> None:
        case_set = load_answer_quality_cases()
        first_case = case_set.cases[0]
        second_case = case_set.cases[1]

        report = evaluate_answer_quality_cases(
            case_set.cases,
            {
                first_case.case_id: AnswerQualityObservation(
                    case_id=first_case.case_id,
                    answer_text="只提到了校园卡补卡，但没有办理地点。",
                    source_urls=("https://example.edu/card",),
                    source_titles=("校园卡丢失处理指引",),
                ),
                second_case.case_id: AnswerQualityObservation(
                    case_id=second_case.case_id,
                    answer_text="请在微信小程序直接预约并支付。",
                    source_urls=(),
                    source_titles=(),
                ),
            },
        )

        results = {result.case_id: result for result in report.results}
        self.assertEqual(results[first_case.case_id].failure_class, "required_fact_missing")
        self.assertEqual(results[second_case.case_id].failure_class, "forbidden_claim_present")

    def test_profile_writes_report_only_safe_contract_artifact(self) -> None:
        case_set = load_answer_quality_cases()
        observations = {
            case.case_id: {
                "answer_text": " ".join((*case.required_facts, "已附官方来源。")),
                "source_urls": ["https://example.edu/source"],
                "source_titles": ["官方来源"],
            }
            for case in case_set.cases
        }

        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            observations_path = root / "observations.json"
            observations_path.write_text(
                json.dumps({"observations": observations}, ensure_ascii=False),
                encoding="utf-8",
            )
            report = run_answer_quality_contract_profile(
                output_dir=root / "out",
                observations_path=observations_path,
                git_head_resolver=lambda: "abc123",
            )
            payload = json.loads(report.output_path.read_text(encoding="utf-8"))

        self.assertTrue(report.passed)
        self.assertEqual(payload["profile_id"], "answer_quality_contract")
        self.assertEqual(payload["summary"]["failed"], 0)

    def test_evaluator_enforces_required_and_forbidden_source_identity(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            cases_path = Path(tmpdir) / "cases.json"
            cases_path.write_text(
                json.dumps(
                    {
                        "schema_version": 1,
                        "case_family": "answer_quality_contract.v1",
                        "cases": [
                            {
                                "case_id": "institutional-rules-source-identity",
                                "split": "release_gate",
                                "surface": "rag_regulation_answer",
                                "required_facts": ["学生社团"],
                                "forbidden_claims": [],
                                "requires_source_url": True,
                                "requires_source_title": True,
                                "required_source_titles": ["中央民族大学学生社团管理办法"],
                                "required_source_url_fragments": [
                                    "/docs/regulations/institutional_rules/"
                                ],
                                "forbidden_source_title_fragments": [
                                    "历史文化学院2021年硕博连读博士研究生"
                                ],
                                "forbidden_source_url_fragments": [
                                    "/docs/regulations/scoped_rules/",
                                    "campusrag://promotion/internal_notice_scoped_rules/",
                                ],
                            }
                        ],
                    },
                    ensure_ascii=False,
                ),
                encoding="utf-8",
            )

            case_set = load_answer_quality_cases(cases_path)

        scoped_source_report = evaluate_answer_quality_cases(
            case_set.cases,
            {
                "institutional-rules-source-identity": AnswerQualityObservation(
                    case_id="institutional-rules-source-identity",
                    answer_text="学生社团应按制度要求接受管理。",
                    source_urls=(
                        "campusrag://promotion/internal_notice_scoped_rules/notice:muc_internal_portal:187004",
                    ),
                    source_titles=("历史文化学院2021年硕博连读博士研究生 招生实施细则",),
                )
            },
        )
        missing_institutional_report = evaluate_answer_quality_cases(
            case_set.cases,
            {
                "institutional-rules-source-identity": AnswerQualityObservation(
                    case_id="institutional-rules-source-identity",
                    answer_text="学生社团应按制度要求接受管理。",
                    source_urls=("/docs/regulations/institutional_rules/other",),
                    source_titles=("其他来源",),
                )
            },
        )

        self.assertEqual(
            scoped_source_report.results[0].failure_class,
            "forbidden_source_title_present",
        )
        self.assertEqual(
            missing_institutional_report.results[0].failure_class,
            "required_source_title_missing",
        )

    def test_institutional_rules_answer_quality_cases_cover_all_released_titles(
        self,
    ) -> None:
        case_set = load_answer_quality_cases(INSTITUTIONAL_RULES_ANSWER_CASES_PATH)
        manifest = json.loads(
            INSTITUTIONAL_RULES_RETRIEVAL_EVAL_MANIFEST_PATH.read_text(encoding="utf-8")
        )
        released_titles = {item["title"] for item in manifest["documents"]}
        covered_titles = {
            title for case in case_set.cases for title in case.required_source_titles
        }

        self.assertEqual(len(released_titles), 30)
        self.assertTrue(
            all(case.split == "regression_locked" for case in case_set.cases)
        )
        self.assertEqual(covered_titles, released_titles)
        self.assertTrue(
            all(
                "/docs/regulations/institutional_rules/"
                in case.required_source_url_fragments
                for case in case_set.cases
            )
        )
        self.assertTrue(
            all(
                "/docs/regulations/scoped_rules/"
                in case.forbidden_source_url_fragments
                for case in case_set.cases
            )
        )


if __name__ == "__main__":
    unittest.main()
