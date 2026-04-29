from __future__ import annotations

import unittest

from campus_evals.document_quality_eval import (
    DOCUMENT_QUALITY_CASES_PATH,
    DocumentQualityObservation,
    evaluate_document_quality_cases,
    load_document_quality_cases,
)


class DocumentQualityEvalTest(unittest.TestCase):
    def test_loads_multimodal_ocr_document_quality_fixture(self) -> None:
        case_set = load_document_quality_cases()

        self.assertTrue(DOCUMENT_QUALITY_CASES_PATH.exists())
        self.assertEqual(case_set.schema_version, 1)
        case_ids = {case.case_id for case in case_set.cases}
        self.assertIn("document-quality-transport-table-ocr", case_ids)
        self.assertIn("document-quality-image-notice-required-spans", case_ids)
        self.assertIn("document-quality-scanned-pdf-required-spans", case_ids)
        self.assertIn("document-quality-table-heavy-schedule", case_ids)

    def test_evaluates_required_spans_tables_confidence_and_projection_target(self) -> None:
        case_set = load_document_quality_cases()
        observations = {
            case.case_id: DocumentQualityObservation(
                case_id=case.case_id,
                extracted_text=" ".join(case.required_spans),
                table_headers=case.required_table_headers,
                confidence=max(case.min_confidence, 0.91),
                projection_target=case.allowed_projection_targets[0],
                claims=("sanitized derived claim",),
            )
            for case in case_set.cases
        }

        report = evaluate_document_quality_cases(case_set.cases, observations)

        self.assertTrue(report.passed)
        self.assertEqual(report.passed_count, len(case_set.cases))

    def test_detects_title_only_table_loss_low_confidence_and_forbidden_claim(self) -> None:
        case_set = load_document_quality_cases()
        report = evaluate_document_quality_cases(
            case_set.cases,
            {
                "document-quality-transport-table-ocr": DocumentQualityObservation(
                    case_id="document-quality-transport-table-ocr",
                    extracted_text="关于班车安排的通知",
                    table_headers=(),
                    confidence=0.41,
                    projection_target="regulation_ready_text",
                    claims=("这是正式规章制度",),
                )
            },
        )

        self.assertFalse(report.passed)
        result = next(
            item
            for item in report.results
            if item.case_id == "document-quality-transport-table-ocr"
        )
        self.assertIn("missing required span", result.reason)
        self.assertIn("missing table header", result.reason)
        self.assertIn("confidence below minimum", result.reason)
        self.assertIn("forbidden projection target", result.reason)
        self.assertIn("forbidden claim", result.reason)


if __name__ == "__main__":
    unittest.main()
