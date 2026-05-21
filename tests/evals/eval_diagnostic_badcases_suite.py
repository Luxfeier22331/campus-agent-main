from __future__ import annotations

import json
import unittest

from campus_evals.eval_diagnostic_badcases import (
    EVAL_DIAGNOSTIC_BADCASES_SCHEMA_VERSION,
    build_eval_diagnostic_badcases_projection,
)


class EvalDiagnosticBadcasesSuite(unittest.TestCase):
    def test_builds_operator_safe_ragas_diagnostic_badcases_from_combined_report(self) -> None:
        projection = build_eval_diagnostic_badcases_projection(
            _combined_report(
                cases=[
                    {
                        "surface_key": "regulations/student_rules",
                        "case_id": "student-scholarship-condition",
                        "split": "release_gate",
                        "query": "奖学金要满足什么条件",
                        "expected_doc_ids": ["doc:scholarship"],
                        "forbidden_doc_ids": [],
                        "status": "completed",
                        "answer_text": "学生需要满足学业和处分条件。",
                        "answer_shape": "eligibility_judgment",
                        "presentation_kind": "condition_table",
                        "retrieved_context_count": 2,
                        "retrieved_context_ids": ["chunk:wrong", "chunk:scholarship"],
                        "raw_retrieved_doc_ids": ["doc:wrong", "doc:scholarship"],
                        "selected_support_doc_ids": ["doc:wrong"],
                        "selected_support_chunk_ids": ["chunk:wrong"],
                        "failure_attribution": {
                            "primary_stage": "evidence_selection",
                            "metric_failures": {"faithfulness": "evidence_selection"},
                        },
                        "scores": {
                            "context_recall": 0.92,
                            "faithfulness": 0.31,
                        },
                    }
                ]
            ),
            generated_at="2026-05-21T09:00:00+00:00",
            source_git_head="git-main",
        )

        self.assertEqual(
            projection["schemaVersion"],
            EVAL_DIAGNOSTIC_BADCASES_SCHEMA_VERSION,
        )
        self.assertEqual(projection["evalRunId"], "ragas_diagnostic_combined")
        self.assertEqual(projection["generatedAt"], "2026-05-21T09:00:00.000Z")
        self.assertEqual(projection["sourceReportSchema"], "ragas-diagnostic-combined-report.v1")
        self.assertEqual(len(projection["badcases"]), 1)
        badcase = projection["badcases"][0]
        self.assertEqual(
            badcase,
            {
                "badcaseId": "ragas_diagnostic:student-scholarship-condition:faithfulness",
                "caseId": "student-scholarship-condition",
                "surfaceKey": "regulations/student_rules",
                "metricName": "faithfulness",
                "score": 0.31,
                "threshold": 0.8,
                "failureStage": "evidence_selection",
                "causeClass": "evidence_selection_failed",
                "metricFailureReason": "evidence_selection",
                "queryPreview": "奖学金要满足什么条件",
                "expectedDocIds": ["doc:scholarship"],
                "retrievedContextIds": ["chunk:wrong", "chunk:scholarship"],
                "retrievedDocIds": ["doc:wrong", "doc:scholarship"],
                "supportingDocIds": ["doc:wrong"],
                "supportingChunkIds": ["chunk:wrong"],
                "answerShape": "eligibility_judgment",
                "presentationKind": "condition_table",
            },
        )
        self.assertNotIn("answer_text", json.dumps(projection, ensure_ascii=False))

    def test_fails_closed_when_low_score_case_lacks_failure_attribution(self) -> None:
        with self.assertRaisesRegex(ValueError, "failure_attribution.primary_stage is required"):
            build_eval_diagnostic_badcases_projection(
                _combined_report(
                    cases=[
                        {
                            "surface_key": "regulations/student_rules",
                            "case_id": "missing-attribution",
                            "query": "校历哪周补课",
                            "expected_doc_ids": ["doc:calendar"],
                            "retrieved_context_ids": [],
                            "scores": {"answer_relevancy": 0.4},
                        }
                    ]
                ),
                generated_at="2026-05-21T09:00:00+00:00",
                source_git_head="git-main",
            )

    def test_rejects_raw_or_local_artifact_fields(self) -> None:
        with self.assertRaisesRegex(ValueError, "forbidden raw workflow trace key"):
            build_eval_diagnostic_badcases_projection(
                _combined_report(
                    cases=[
                        {
                            "surface_key": "regulations/student_rules",
                            "case_id": "raw-prompt-leak",
                            "query": "学生证怎么补办",
                            "expected_doc_ids": ["doc:student-card"],
                            "retrieved_context_ids": ["chunk:student-card"],
                            "failure_attribution": {
                                "primary_stage": "synthesis",
                                "metric_failures": {"answer_relevancy": "synthesis"},
                            },
                            "scores": {"answer_relevancy": 0.4},
                            "raw_prompt": "hidden prompt",
                        }
                    ]
                ),
                generated_at="2026-05-21T09:00:00+00:00",
                source_git_head="git-main",
            )


def _combined_report(*, cases: list[dict[str, object]]) -> dict[str, object]:
    return {
        "schema_version": "ragas-diagnostic-combined-report.v1",
        "report_id": "ragas_diagnostic_combined",
        "mode": "diagnostic_non_blocking",
        "passed": True,
        "summary": {
            "low_score_threshold": 0.8,
            "low_score_cases": [],
        },
        "cases": cases,
    }


if __name__ == "__main__":
    unittest.main()
