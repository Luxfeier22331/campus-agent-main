from __future__ import annotations

import unittest
from unittest.mock import patch

from campus_ingestion_core.authenticated_notice_collector_run_ledger import (
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
                "source_bucket": "campus-rag-source",
                "bundle_object_key": "authenticated_notice/exports/run-1/bundle.json",
                "bundle_content_sha256": "a" * 64,
                "bundle_byte_size": 100,
                "manifest_object_key": "authenticated_notice/exports/run-1/manifest.json",
                "manifest_content_sha256": "b" * 64,
                "manifest_byte_size": 50,
            },
            expected_source_surface="notice",
        )

        self.assertEqual(refs.source_bucket, "campus-rag-source")
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
                    "source_bucket": "campus-rag-source",
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
                    "source_bucket": "campus-rag-source",
                    "bundle_object_key": "bundle.json",
                    "bundle_content_sha256": "a" * 64,
                    "bundle_byte_size": 100,
                    "manifest_object_key": "manifest.json",
                    "manifest_content_sha256": "b" * 64,
                    "manifest_byte_size": 50,
                },
                expected_source_surface="notice",
            )

    def test_resolver_rejects_missing_run_id_row(self) -> None:
        class _FakeCursor:
            def __enter__(self) -> _FakeCursor:
                return self

            def __exit__(self, *_args: object) -> None:
                return None

            def execute(self, *_args: object) -> None:
                return None

            def fetchone(self) -> None:
                return None

        class _FakeConnection:
            def __enter__(self) -> _FakeConnection:
                return self

            def __exit__(self, *_args: object) -> None:
                return None

            def cursor(self) -> _FakeCursor:
                return _FakeCursor()

        with (
            patch(
                "campus_ingestion_core.authenticated_notice_collector_run_ledger._collector_run_ledger_database_url",
                return_value="postgresql://operator.example/db",
            ),
            patch(
                "campus_ingestion_core.authenticated_notice_collector_run_ledger._postgres_connection",
                return_value=_FakeConnection(),
            ),
            self.assertRaisesRegex(ValueError, "row not found"),
        ):
            resolve_authenticated_notice_collector_run_refs(
                env={},
                run_id="missing-run",
                expected_source_surface="notice",
            )


if __name__ == "__main__":
    unittest.main()
