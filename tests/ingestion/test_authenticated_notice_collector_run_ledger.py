from __future__ import annotations

import unittest

from campus_ingestion_core.authenticated_notice_collector_run_ledger import (
    collector_run_ledger_database_url_from_env,
    collector_run_refs_from_row,
    resolve_authenticated_notice_collector_run_refs,
)


class AuthenticatedNoticeCollectorRunLedgerTest(unittest.TestCase):
    def test_collector_run_refs_require_successful_verified_notice_row(self) -> None:
        refs = collector_run_refs_from_row(
            {
                "run_id": "run-1",
                "source_surface": "notice",
                "status": "success",
                "verification_status": "verified",
                "source_bucket": "campus-agent-source",
                "bundle_object_key": "authenticated_notice/exports/run-1/bundle.json",
                "bundle_content_sha256": "a" * 64,
                "bundle_byte_size": 100,
                "manifest_object_key": "authenticated_notice/exports/run-1/manifest.json",
                "manifest_content_sha256": "b" * 64,
                "manifest_byte_size": 50,
            },
            expected_source_surface="notice",
        )

        self.assertEqual(refs.source_bucket, "campus-agent-source")
        self.assertEqual(refs.bundle_object_key, "authenticated_notice/exports/run-1/bundle.json")
        self.assertEqual(
            refs.manifest_object_key,
            "authenticated_notice/exports/run-1/manifest.json",
        )

    def test_collector_run_refs_reject_unverified_rows(self) -> None:
        with self.assertRaisesRegex(ValueError, "verified"):
            collector_run_refs_from_row(
                {
                    "run_id": "run-1",
                    "source_surface": "notice",
                    "status": "success",
                    "verification_status": "missing_required_objects",
                    "source_bucket": "campus-agent-source",
                    "bundle_object_key": "bundle.json",
                    "bundle_content_sha256": "a" * 64,
                    "bundle_byte_size": 100,
                    "manifest_object_key": "manifest.json",
                    "manifest_content_sha256": "b" * 64,
                    "manifest_byte_size": 50,
                },
                expected_source_surface="notice",
            )

    def test_collector_run_refs_reject_wrong_surface(self) -> None:
        with self.assertRaisesRegex(ValueError, "source_surface"):
            collector_run_refs_from_row(
                {
                    "run_id": "run-1",
                    "source_surface": "file_release",
                    "status": "success",
                    "verification_status": "verified",
                    "source_bucket": "campus-agent-source",
                    "bundle_object_key": "bundle.json",
                    "bundle_content_sha256": "a" * 64,
                    "bundle_byte_size": 100,
                    "manifest_object_key": "manifest.json",
                    "manifest_content_sha256": "b" * 64,
                    "manifest_byte_size": 50,
                },
                expected_source_surface="notice",
            )

    def test_resolver_fails_closed_after_python_db_runtime_retirement(self) -> None:
        with self.assertRaisesRegex(RuntimeError, "Python database runtime is retired"):
            resolve_authenticated_notice_collector_run_refs(
                env={"AUTHENTICATED_NOTICE_COLLECTOR_RUN_LEDGER_DATABASE_URL": "postgresql://db"},
                run_id="missing-run",
                expected_source_surface="notice",
            )

    def test_database_url_builder_fails_closed_after_python_db_runtime_retirement(self) -> None:
        with self.assertRaisesRegex(RuntimeError, "Python database runtime is retired"):
            collector_run_ledger_database_url_from_env(
                {"AUTHENTICATED_NOTICE_COLLECTOR_RUN_LEDGER_DATABASE_URL": "postgresql://db"}
            )


if __name__ == "__main__":
    unittest.main()
