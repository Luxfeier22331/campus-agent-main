from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from campus_evals.answer_quality_contract import (
    AnswerQualityObservation,
    evaluate_answer_quality_cases,
    load_answer_quality_cases,
    run_answer_quality_contract_profile,
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


if __name__ == "__main__":
    unittest.main()
