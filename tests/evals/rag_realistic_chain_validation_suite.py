from __future__ import annotations

import os
import unittest
from contextlib import contextmanager
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

from campus_evals.rag_realistic_chain_validation import (
    PORTAL_PASSWORD_CASE_ID,
    RagRealisticChainValidationReport,
    load_rag_realistic_chain_cases,
    run_live_env_validation,
    run_seeded_inprocess_validation,
)


class RagRealisticChainValidationTest(unittest.TestCase):
    def test_cases_keep_portal_password_out_of_rag_path(self) -> None:
        cases = load_rag_realistic_chain_cases()
        by_id = {case.case_id: case for case in cases}

        self.assertIn(PORTAL_PASSWORD_CASE_ID, by_id)
        portal_case = by_id[PORTAL_PASSWORD_CASE_ID]
        self.assertEqual(portal_case.expected_target, "campus_services")
        self.assertEqual(portal_case.validation_path, "supervisor_route")
        self.assertFalse(portal_case.execute_with_rag)

    def test_seeded_inprocess_validation_runs_rag_over_real_retrieval_backend(self) -> None:
        report = run_seeded_inprocess_validation()

        self.assertEqual(report.mode, "seeded_inprocess")
        self.assertFalse(report.skipped)
        self.assertTrue(report.passed, report.to_summary_text())
        results = {result.case_id: result for result in report.results}

        discovery = results["scholarship-discovery-undergrad"]
        self.assertEqual(discovery.status, "completed")
        self.assertTrue(discovery.retrieval_called)
        self.assertEqual(discovery.expected_target, "knowledge")
        self.assertIn("当前已收录依据中，本科生奖学金相关制度包括：", discovery.answer_text)
        self.assertIn("以当年通知/学院细则为准", discovery.answer_text)
        self.assertGreaterEqual(len(discovery.supporting_doc_ids), 4)

        clarification = results["scholarship-ambiguous-procedure"]
        self.assertEqual(clarification.status, "needs_clarification")
        self.assertFalse(clarification.retrieval_called)
        self.assertEqual(clarification.validation_path, "rag_preflight")

        rank = results["national-scholarship-rank-top-ten"]
        self.assertEqual(rank.status, "completed")
        self.assertIn("handbook:55f7a1b27590bdc59c099f37d84cfa097356ce15", rank.supporting_doc_ids)

    def test_live_env_validation_reports_missing_qdrant_url_as_skip_not_success(self) -> None:
        report = run_live_env_validation(env={})

        self.assertEqual(report.mode, "live_env")
        self.assertTrue(report.skipped)
        self.assertFalse(report.passed)
        self.assertIn("QDRANT_URL", report.skip_reason)
        self.assertEqual(report.results, ())

    def test_live_env_validation_loads_repo_env_before_skip_check(self) -> None:
        with TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            (root / ".env").write_text(
                "\n".join(
                    (
                        "QDRANT_URL=https://qdrant.example.com",
                        "EMBEDDING_PROVIDER=mock",
                        "EMBEDDING_MODEL=mock-embedding-8d",
                        "EMBEDDING_DIMENSIONS=8",
                        "SPARSE_PROVIDER=mock",
                    )
                ),
                encoding="utf-8",
            )
            with (
                _temporary_cwd(root),
                patch.dict(os.environ, {}, clear=True),
                patch(
                    "campus_evals.rag_realistic_chain_validation.QdrantRetrievalBackend",
                    return_value=object(),
                ) as backend_factory,
                patch(
                    "campus_evals.rag_realistic_chain_validation._run_rag_validation",
                    return_value=RagRealisticChainValidationReport(
                        mode="live_env",
                        passed=True,
                    ),
                ),
            ):
                report = run_live_env_validation()

        self.assertEqual(report.mode, "live_env")
        self.assertFalse(report.skipped)
        self.assertTrue(report.passed)
        backend_factory.assert_called_once()


if __name__ == "__main__":
    unittest.main()


@contextmanager
def _temporary_cwd(path: Path):
    previous = Path.cwd()
    os.chdir(path)
    try:
        yield
    finally:
        os.chdir(previous)
