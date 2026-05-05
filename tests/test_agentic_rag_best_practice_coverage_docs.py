from __future__ import annotations

import unittest
from pathlib import Path

REPO_ROOT = Path(".")
COVERAGE_DOC = (
    REPO_ROOT
    / ".planning/workstreams/campus-bounded-autonomous-rag-completion/BEST-PRACTICE-COVERAGE.md"
)


class AgenticRagBestPracticeCoverageDocsTest(unittest.TestCase):
    def test_best_practice_coverage_maps_external_guidance_to_repo_gates(self) -> None:
        document = COVERAGE_DOC.read_text(encoding="utf-8")

        for required in (
            "https://developers.openai.com/api/docs/guides/agents",
            "https://developers.openai.com/api/docs/guides/agents/orchestration",
            "https://developers.openai.com/api/docs/guides/agents/guardrails-approvals",
            "Structured planning",
            "Bounded handoff",
            "Tool guardrails",
            "Untrusted content quarantine",
            "Trace/eval attribution",
            "Budget/fail-close",
            "tests.evals.agentic_retrieval_plan_eval_suite",
            "No arbitrary URL browse/fetch",
        ):
            with self.subTest(required=required):
                self.assertIn(required, document)


if __name__ == "__main__":
    unittest.main()
