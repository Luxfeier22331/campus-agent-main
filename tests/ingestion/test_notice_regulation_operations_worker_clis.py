from __future__ import annotations

import importlib
import json
import os
import unittest
from contextlib import redirect_stdout
from io import StringIO
from pathlib import Path
from unittest.mock import patch

audit_worker = importlib.import_module(
    "campus_ingestion_worker.audit_collected_notice_regulation_admission_batch"
)
cleanup_worker = importlib.import_module(
    "campus_ingestion_worker.cleanup_internal_notice_regulation_target_residue"
)


class NoticeRegulationOperationsWorkerCliTest(unittest.TestCase):
    def test_audit_batch_main_maps_expectations_and_missing_guard(self) -> None:
        with (
            patch.object(audit_worker, "load_worker_env"),
            patch.object(audit_worker, "utc_now", return_value="2026-05-01T00:00:00+00:00"),
            patch.object(
                audit_worker,
                "audit_collected_notice_regulation_admission_batch",
                return_value={"schema_version": "audit.v1", "expectation_failures": []},
            ) as run_audit,
            redirect_stdout(StringIO()) as stdout,
        ):
            audit_worker.main(
                [
                    "--selection-json",
                    "/tmp/selection.json",
                    "--bundle-json",
                    "/tmp/notices-bundle.json",
                    "--output-dir",
                    "/tmp/audit-output",
                    "--expect",
                    "186977:historical_annual_cycle_rule_hold:search_only",
                    "--allow-missing",
                ]
            )

        kwargs = run_audit.call_args.kwargs
        self.assertEqual(kwargs["selection_json"], Path("/tmp/selection.json"))
        self.assertEqual(kwargs["bundle_json"], Path("/tmp/notices-bundle.json"))
        self.assertEqual(kwargs["output_dir"], Path("/tmp/audit-output"))
        self.assertEqual(kwargs["generated_at"], "2026-05-01T00:00:00+00:00")
        self.assertTrue(kwargs["allow_missing"])
        self.assertEqual(len(kwargs["expectations"]), 1)
        expectation = kwargs["expectations"][0]
        self.assertEqual(expectation.notice_id, "186977")
        self.assertEqual(
            expectation.regulation_admission_class,
            "historical_annual_cycle_rule_hold",
        )
        self.assertEqual(expectation.consumption_class, "search_only")
        payload = json.loads(stdout.getvalue())
        self.assertEqual(payload["schema_version"], "audit.v1")

    def test_cleanup_main_builds_exact_target_request_and_defaults_to_dry_run(self) -> None:
        with (
            patch.object(cleanup_worker, "load_worker_env"),
            patch.object(
                cleanup_worker,
                "cleanup_internal_notice_regulation_target_residue",
                return_value={"schema_version": "cleanup.v1", "apply": False},
            ) as run_cleanup,
            patch.dict(
                os.environ,
                {
                    "DOCUMENT_REGISTRY_DATABASE_URL": "postgresql://registry.example/postgres",
                    "OBJECT_STORE_ENDPOINT": "https://s3.example.com",
                    "OBJECT_STORE_ACCESS_KEY": "shared-ak",
                    "OBJECT_STORE_SECRET_KEY": "shared-sk",
                    "OBJECT_STORE_BUCKET_DERIVED": "campus-rag-derived",
                },
                clear=True,
            ),
            redirect_stdout(StringIO()) as stdout,
        ):
            cleanup_worker.main(
                [
                    "--notice-id",
                    "186977",
                    "--title",
                    "药学院2021年硕博连读博士研究生招生实施细则",
                    "--collection",
                    "scoped_rules",
                    "--document-id",
                    "institutional_regulation:muc:药学院2021年硕博连读博士研究生招生实施细则:b398c5cfe7e3",
                    "--version-id",
                    "sha256:target-version",
                    "--target-key",
                    "regulations/documents/scoped_rules/historical/canonical.md",
                    "--qdrant-collection",
                    "scoped_rules__r20260501",
                    "--target-surface",
                    "regulations/scoped_rules",
                    "--output-dir",
                    "/tmp/cleanup-output",
                ]
            )

        request = run_cleanup.call_args.kwargs["request"]
        self.assertEqual(request.notice_id, "186977")
        self.assertEqual(request.collection, "scoped_rules")
        self.assertEqual(request.version_id, "sha256:target-version")
        self.assertEqual(request.bucket, "campus-rag-derived")
        self.assertEqual(
            request.target_keys,
            ("regulations/documents/scoped_rules/historical/canonical.md",),
        )
        self.assertEqual(request.qdrant_collections, ("scoped_rules__r20260501",))
        self.assertEqual(request.target_surface, "regulations/scoped_rules")
        self.assertEqual(request.output_dir, Path("/tmp/cleanup-output"))
        self.assertFalse(request.apply)
        payload = json.loads(stdout.getvalue())
        self.assertFalse(payload["apply"])

    def test_cleanup_main_requires_apply_flag_for_deletion(self) -> None:
        with (
            patch.object(cleanup_worker, "load_worker_env"),
            patch.object(
                cleanup_worker,
                "cleanup_internal_notice_regulation_target_residue",
                return_value={"schema_version": "cleanup.v1", "apply": True},
            ) as run_cleanup,
            patch.dict(
                os.environ,
                {
                    "DOCUMENT_REGISTRY_DATABASE_URL": "postgresql://registry.example/postgres",
                    "OBJECT_STORE_ENDPOINT": "https://s3.example.com",
                    "OBJECT_STORE_ACCESS_KEY": "shared-ak",
                    "OBJECT_STORE_SECRET_KEY": "shared-sk",
                    "OBJECT_STORE_BUCKET_DERIVED": "campus-rag-derived",
                },
                clear=True,
            ),
            redirect_stdout(StringIO()),
        ):
            cleanup_worker.main(
                [
                    "--notice-id",
                    "186977",
                    "--title",
                    "药学院2021年硕博连读博士研究生招生实施细则",
                    "--collection",
                    "scoped_rules",
                    "--document-id",
                    "institutional_regulation:muc:药学院2021年硕博连读博士研究生招生实施细则:b398c5cfe7e3",
                    "--version-id",
                    "sha256:target-version",
                    "--target-key",
                    "regulations/documents/scoped_rules/historical/canonical.md",
                    "--output-dir",
                    "/tmp/cleanup-output",
                    "--apply",
                ]
            )

        request = run_cleanup.call_args.kwargs["request"]
        self.assertTrue(request.apply)

    def test_cleanup_object_store_uses_ingestion_core_bucket_credential_resolution(self) -> None:
        store = cleanup_worker.S3RegulationTargetResidueObjectStore(
            {
                "OBJECT_STORE_ENDPOINT": "https://s3.example.com",
                "OBJECT_STORE_REGION": "auto",
                "OBJECT_STORE_BUCKET_DERIVED": "campus-rag-derived",
                "OBJECT_STORE_DERIVED_ACCESS_KEY": "derived-ak",
                "OBJECT_STORE_DERIVED_SECRET_KEY": "derived-sk",
            }
        )

        with patch.object(cleanup_worker.boto3, "client") as create_client:
            client = store._client("campus-rag-derived")

        self.assertIs(client, create_client.return_value)
        create_client.assert_called_once()
        kwargs = create_client.call_args.kwargs
        self.assertEqual(kwargs["endpoint_url"], "https://s3.example.com")
        self.assertEqual(kwargs["region_name"], "auto")
        self.assertEqual(kwargs["aws_access_key_id"], "derived-ak")
        self.assertEqual(kwargs["aws_secret_access_key"], "derived-sk")

    def test_cleanup_object_store_reuses_ingestion_core_endpoint_validation(self) -> None:
        with (
            patch.object(cleanup_worker.boto3, "client") as create_client,
            self.assertRaisesRegex(ValueError, "http\\(s\\) URL"),
        ):
            cleanup_worker.S3RegulationTargetResidueObjectStore(
                {
                    "OBJECT_STORE_ENDPOINT": "/tmp/minio",
                    "OBJECT_STORE_ACCESS_KEY": "shared-ak",
                    "OBJECT_STORE_SECRET_KEY": "shared-sk",
                }
            )

        create_client.assert_not_called()


if __name__ == "__main__":
    unittest.main()
