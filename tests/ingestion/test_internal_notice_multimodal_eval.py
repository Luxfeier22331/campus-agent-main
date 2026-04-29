from __future__ import annotations

import importlib
import io
import json
import unittest
from pathlib import Path
from unittest.mock import patch

from campus_ingestion_core.internal_notice_multimodal_eval import (
    evaluate_internal_notice_multimodal_decisions_jsonl,
    evaluate_internal_notice_multimodal_visual_jsonl,
)

worker = importlib.import_module(
    "campus_ingestion_worker.evaluate_internal_notice_multimodal_decisions"
)
visual_worker = importlib.import_module(
    "campus_ingestion_worker.evaluate_internal_notice_multimodal_visual"
)


class InternalNoticeMultimodalEvalTest(unittest.TestCase):
    def test_eval_gate_scores_expected_actions_from_jsonl(self) -> None:
        report = evaluate_internal_notice_multimodal_decisions_jsonl(
            b"\n".join(
                (
                    b'{"case_id":"retain-map","expected_action":"retain_for_notice_query","actual_action":"retain_for_notice_query"}',
                    b'{"case_id":"decorative","expected_action":"no_adoption","actual_action":"retain_for_notice_query"}',
                )
            )
        )

        self.assertFalse(report.ok)
        self.assertEqual(report.case_count, 2)
        self.assertEqual(report.passed_count, 1)
        self.assertEqual(report.accuracy, 0.5)
        self.assertEqual(report.failed_case_ids, ("decorative",))
        self.assertEqual(report.action_counts["retain_for_notice_query"], 2)

    def test_eval_gate_passes_when_thresholds_are_met(self) -> None:
        report = evaluate_internal_notice_multimodal_decisions_jsonl(
            b"\n".join(
                (
                    b'{"case_id":"retain-map","expected_action":"retain_for_notice_query","actual_action":"retain_for_notice_query"}',
                    b'{"case_id":"needs-more","expected_action":"retain_for_notice_query","actual_action":"needs_additional_processing"}',
                )
            ),
            min_accuracy=0.5,
            max_needs_additional_processing_rate=0.5,
        )

        self.assertTrue(report.ok)
        self.assertEqual(report.needs_additional_processing_count, 1)
        self.assertEqual(report.needs_additional_processing_rate, 0.5)

    def test_eval_gate_fails_empty_dataset(self) -> None:
        report = evaluate_internal_notice_multimodal_decisions_jsonl(b"\n\n")

        self.assertFalse(report.ok)
        self.assertEqual(report.case_count, 0)
        self.assertEqual(report.accuracy, 0.0)

    def test_eval_gate_fails_when_needs_additional_processing_rate_is_too_high(
        self,
    ) -> None:
        report = evaluate_internal_notice_multimodal_decisions_jsonl(
            b"\n".join(
                (
                    b'{"case_id":"needs-more","expected_action":"needs_additional_processing","actual_action":"needs_additional_processing"}',
                    b'{"case_id":"retain-map","expected_action":"retain_for_notice_query","actual_action":"retain_for_notice_query"}',
                )
            ),
            min_accuracy=1.0,
            max_needs_additional_processing_rate=0.0,
        )

        self.assertFalse(report.ok)
        self.assertEqual(report.needs_additional_processing_count, 1)
        self.assertEqual(report.needs_additional_processing_rate, 0.5)

    def test_repo_owned_default_eval_dataset_passes_cli_gate(self) -> None:
        default_path = worker.DEFAULT_INTERNAL_NOTICE_MULTIMODAL_DECISION_EVAL_PATH

        self.assertTrue(default_path.exists())
        with patch("sys.stdout", new_callable=io.StringIO) as stdout:
            exit_code = worker.main([])

        self.assertEqual(exit_code, 0)
        payload = json.loads(stdout.getvalue())
        self.assertGreaterEqual(payload["case_count"], 20)
        self.assertTrue(payload["ok"])

    def test_default_eval_dataset_lives_under_internal_notice_config(self) -> None:
        root = Path(__file__).resolve().parents[2]
        default_path = worker.DEFAULT_INTERNAL_NOTICE_MULTIMODAL_DECISION_EVAL_PATH

        self.assertEqual(
            default_path.relative_to(root).as_posix(),
            "configs/ingestion/campus_notices/internal_notice/multimodal-decision-eval.v1.jsonl",
        )

    def test_visual_eval_gate_validates_grounded_retain_fixture(self) -> None:
        report = evaluate_internal_notice_multimodal_visual_jsonl(
            json.dumps(
                {
                    "case_id": "procurement-table",
                    "expected_action": "retain_for_notice_query",
                    "expected_target_surface": "notice_level_query",
                    "min_confidence": "medium",
                    "required_text_spans": ["家具采购项目", "报名截止", "联系人"],
                    "forbidden_claims": ["中标结果", "预算金额100万元"],
                    "required_reasons": ["visual_text_extracted"],
                    "decision": {
                        "action": "retain_for_notice_query",
                        "summary": "图片公告为家具采购项目，包含报名截止时间和联系人。",
                        "extracted_text": "家具采购项目 报名截止：4月30日 联系人：资产处",
                        "reasons": ["visual_text_extracted"],
                        "confidence": "high",
                    },
                },
                ensure_ascii=False,
            )
        )

        self.assertTrue(report.ok)
        self.assertEqual(report.case_count, 1)
        self.assertEqual(report.passed_count, 1)
        self.assertEqual(report.failed_case_ids, ())
        self.assertEqual(report.missing_required_text_span_count, 0)
        self.assertEqual(report.forbidden_claim_hit_count, 0)

    def test_visual_eval_gate_reports_missing_spans_for_retain_fixture(self) -> None:
        report = evaluate_internal_notice_multimodal_visual_jsonl(
            json.dumps(
                {
                    "case_id": "scan-missing-date",
                    "expected_action": "retain_for_notice_query",
                    "required_text_spans": ["截止时间：2026年5月10日"],
                    "decision": {
                        "action": "retain_for_notice_query",
                        "summary": "图片公告包含报名要求。",
                        "extracted_text": "报名要求见附件。",
                        "reasons": ["visual_text_extracted"],
                        "confidence": "high",
                    },
                },
                ensure_ascii=False,
            )
        )

        self.assertFalse(report.ok)
        self.assertEqual(report.failed_case_ids, ("scan-missing-date",))
        self.assertEqual(report.missing_required_text_span_count, 1)
        self.assertIn(
            "missing required text span: 截止时间：2026年5月10日",
            report.failure_reasons["scan-missing-date"],
        )

    def test_visual_eval_gate_reports_forbidden_claims(self) -> None:
        report = evaluate_internal_notice_multimodal_visual_jsonl(
            json.dumps(
                {
                    "case_id": "procurement-hallucinated-award",
                    "expected_action": "retain_for_notice_query",
                    "forbidden_claims": ["中标结果"],
                    "decision": {
                        "action": "retain_for_notice_query",
                        "summary": "图片显示家具采购项目中标结果。",
                        "extracted_text": "家具采购项目 中标结果",
                        "reasons": ["visual_text_extracted"],
                        "confidence": "high",
                    },
                },
                ensure_ascii=False,
            )
        )

        self.assertFalse(report.ok)
        self.assertEqual(report.forbidden_claim_hit_count, 1)
        self.assertIn(
            "forbidden claim present: 中标结果",
            report.failure_reasons["procurement-hallucinated-award"],
        )

    def test_visual_eval_gate_requires_reason_and_minimum_confidence(self) -> None:
        report = evaluate_internal_notice_multimodal_visual_jsonl(
            json.dumps(
                {
                    "case_id": "low-confidence-retain",
                    "expected_action": "retain_for_notice_query",
                    "min_confidence": "medium",
                    "required_reasons": ["visual_text_extracted"],
                    "decision": {
                        "action": "retain_for_notice_query",
                        "summary": "图片可能是通知。",
                        "extracted_text": "服务大厅",
                        "reasons": ["weak_visual_guess"],
                        "confidence": "low",
                    },
                },
                ensure_ascii=False,
            )
        )

        self.assertFalse(report.ok)
        self.assertIn(
            "confidence low below minimum medium",
            report.failure_reasons["low-confidence-retain"],
        )
        self.assertIn(
            "missing required reason: visual_text_extracted",
            report.failure_reasons["low-confidence-retain"],
        )

    def test_visual_eval_gate_fails_empty_dataset(self) -> None:
        report = evaluate_internal_notice_multimodal_visual_jsonl("\n\n")

        self.assertFalse(report.ok)
        self.assertEqual(report.case_count, 0)

    def test_repo_owned_default_visual_eval_dataset_passes_cli_gate(self) -> None:
        default_path = visual_worker.DEFAULT_INTERNAL_NOTICE_MULTIMODAL_VISUAL_EVAL_PATH

        self.assertTrue(default_path.exists())
        with patch("sys.stdout", new_callable=io.StringIO) as stdout:
            exit_code = visual_worker.main([])

        self.assertEqual(exit_code, 0)
        payload = json.loads(stdout.getvalue())
        self.assertGreaterEqual(payload["case_count"], 5)
        self.assertTrue(payload["ok"])

    def test_default_visual_eval_dataset_lives_under_internal_notice_config(self) -> None:
        root = Path(__file__).resolve().parents[2]
        default_path = visual_worker.DEFAULT_INTERNAL_NOTICE_MULTIMODAL_VISUAL_EVAL_PATH

        self.assertEqual(
            default_path.relative_to(root).as_posix(),
            "configs/ingestion/campus_notices/internal_notice/multimodal-visual-eval.v1.jsonl",
        )


if __name__ == "__main__":
    unittest.main()
