from __future__ import annotations

import json
import unittest
from pathlib import Path

KNOWN_GAP_CASES_PATH = (
    Path(__file__).resolve().parents[2]
    / "packages"
    / "evals"
    / "fixtures"
    / "rag_known_gap_cases.v1.json"
)


class RagKnownGapSuite(unittest.TestCase):
    def test_known_gap_fixture_records_innovation_credit_rule_without_expected_sources(
        self,
    ) -> None:
        from campus_evals.rag_known_gap import load_rag_known_gap_cases

        case_set = load_rag_known_gap_cases(KNOWN_GAP_CASES_PATH)
        innovation_cases = [
            case
            for case in case_set.cases
            if case.gap_id == "student-rules-innovation-credit-recognition-rule"
        ]

        self.assertEqual(len(innovation_cases), 4)
        self.assertTrue(
            all(case.status == "pending_authenticated_collection" for case in innovation_cases)
        )
        self.assertTrue(all(case.expected_sources == () for case in innovation_cases))
        self.assertTrue(
            all(
                "中央民族大学本科生创新教育学分认定管理办法" in case.missing_canonical_titles
                for case in innovation_cases
            )
        )
        self.assertTrue(
            any(
                case.nearest_available_titles == ("中央民族大学本科创新教育实施办法",)
                for case in innovation_cases
            )
        )

    def test_known_gap_fixture_rejects_expected_sources_for_pending_authenticated_gap(
        self,
    ) -> None:
        from campus_evals.rag_known_gap import load_rag_known_gap_cases

        payload = json.loads(KNOWN_GAP_CASES_PATH.read_text(encoding="utf-8"))
        payload["cases"][0]["expected_sources"] = [
            {
                "doc_id": "handbook:02a96d9625b2d15bec9411e8633b6c6533be4b6e",
                "rationale": "should not be accepted as canonical gap truth",
            }
        ]
        temp_path = KNOWN_GAP_CASES_PATH.parent / ".tmp-rag-known-gap-invalid.json"
        try:
            temp_path.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "must not define expected_sources"):
                load_rag_known_gap_cases(temp_path)
        finally:
            temp_path.unlink(missing_ok=True)


if __name__ == "__main__":
    unittest.main()
