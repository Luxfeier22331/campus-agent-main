from __future__ import annotations

import importlib
import io
import json
import unittest
from unittest.mock import patch

worker = importlib.import_module("campus_ingestion_worker.import_authenticated_notice_export")


class ImportAuthenticatedNoticeExportWorkerCliTest(unittest.TestCase):
    def test_main_builds_typed_request_from_cli_args(self) -> None:
        with (
            patch("campus_ingestion_worker.import_authenticated_notice_export.load_worker_env"),
            patch(
                "campus_ingestion_worker.import_authenticated_notice_export.import_authenticated_notice_export"
            ) as run_import,
            patch("sys.stdout", new_callable=io.StringIO) as stdout,
        ):
            run_import.return_value = {
                "notice_count": 1,
                "created_document_ids": ["notice:muc_internal_portal:355119"],
                "errors": [],
            }
            worker.main(
                [
                    "--bundle-path",
                    "/tmp/notices-bundle.json",
                    "--allow-local-fixture-import",
                    "--manifest-path",
                    "/tmp/export-manifest.json",
                    "--consumer-admission-manifest-path",
                    "/tmp/consumer-admission-manifest.json",
                    "--attachment-blob-root",
                    "/tmp/blob-store",
                    "--site-id",
                    "muc_internal_portal",
                    "--source-home-url",
                    "https://portal.example.edu/home",
                    "--entitlement-group",
                    "campus_members",
                    "--visibility-scope",
                    "campus",
                ]
            )

        request = run_import.call_args.kwargs["request"]
        self.assertEqual(str(request.bundle_path), "/tmp/notices-bundle.json")
        self.assertTrue(request.allow_local_fixture_import)
        self.assertEqual(str(request.export_manifest_path), "/tmp/export-manifest.json")
        self.assertEqual(
            str(request.consumer_admission_manifest_path),
            "/tmp/consumer-admission-manifest.json",
        )
        self.assertEqual(str(request.attachment_blob_root), "/tmp/blob-store")
        self.assertEqual(request.site_id, "muc_internal_portal")
        self.assertEqual(request.source_home_url, "https://portal.example.edu/home")
        self.assertEqual(request.default_entitlement_groups, ("campus_members",))
        self.assertEqual(request.visibility_scope, "campus")
        self.assertEqual(request.mode, "plan")
        self.assertFalse(request.replace_scope)
        payload = json.loads(stdout.getvalue())
        self.assertEqual(payload["notice_count"], 1)

    def test_main_rejects_bare_local_bundle_path_without_fixture_guard(self) -> None:
        with (
            patch("campus_ingestion_worker.import_authenticated_notice_export.load_worker_env"),
            patch(
                "campus_ingestion_worker.import_authenticated_notice_export.import_authenticated_notice_export"
            ) as run_import,
            self.assertRaisesRegex(ValueError, "allow-local-fixture-import"),
        ):
            worker.main(
                [
                    "--bundle-path",
                    "/tmp/notices-bundle.json",
                    "--manifest-path",
                    "/tmp/export-manifest.json",
                    "--site-id",
                    "muc_internal_portal",
                    "--source-home-url",
                    "https://portal.example.edu/home",
                ]
            )

        run_import.assert_not_called()

    def test_main_accepts_explicit_object_refs(self) -> None:
        with (
            patch("campus_ingestion_worker.import_authenticated_notice_export.load_worker_env"),
            patch(
                "campus_ingestion_worker.import_authenticated_notice_export.import_authenticated_notice_export"
            ) as run_import,
            patch("sys.stdout", new_callable=io.StringIO),
        ):
            run_import.return_value = {
                "notice_count": 1,
                "created_document_ids": [],
                "errors": [],
            }
            worker.main(
                [
                    "--source-bucket",
                    "campus-rag-source",
                    "--bundle-object-key",
                    "authenticated_notice/exports/run-1/notices-bundle.json",
                    "--manifest-object-key",
                    "authenticated_notice/exports/run-1/export-manifest.json",
                    "--site-id",
                    "muc_internal_portal",
                    "--source-home-url",
                    "https://portal.example.edu/home",
                ]
            )

        request = run_import.call_args.kwargs["request"]
        self.assertIsNone(request.bundle_path)
        self.assertEqual(request.source_bucket, "campus-rag-source")
        self.assertEqual(
            request.bundle_object_key,
            "authenticated_notice/exports/run-1/notices-bundle.json",
        )
        self.assertEqual(
            request.manifest_object_key,
            "authenticated_notice/exports/run-1/export-manifest.json",
        )

    def test_main_accepts_run_id_resolution_request(self) -> None:
        with (
            patch("campus_ingestion_worker.import_authenticated_notice_export.load_worker_env"),
            patch(
                "campus_ingestion_worker.import_authenticated_notice_export.import_authenticated_notice_export"
            ) as run_import,
            patch("sys.stdout", new_callable=io.StringIO),
        ):
            run_import.return_value = {
                "notice_count": 1,
                "created_document_ids": [],
                "errors": [],
            }
            worker.main(
                [
                    "--run-id",
                    "muc_internal_portal:notice:20260402T235919838Z",
                    "--site-id",
                    "muc_internal_portal",
                    "--source-home-url",
                    "https://portal.example.edu/home",
                ]
            )

        request = run_import.call_args.kwargs["request"]
        self.assertEqual(request.run_id, "muc_internal_portal:notice:20260402T235919838Z")
        self.assertIsNone(request.bundle_path)
        self.assertIsNone(request.source_bucket)

    def test_main_passes_explicit_materialize_mode(self) -> None:
        with (
            patch("campus_ingestion_worker.import_authenticated_notice_export.load_worker_env"),
            patch(
                "campus_ingestion_worker.import_authenticated_notice_export.import_authenticated_notice_export"
            ) as run_import,
            patch("sys.stdout", new_callable=io.StringIO),
        ):
            run_import.return_value = {
                "mode": "admit_and_materialize",
                "notice_count": 1,
                "created_document_ids": ["notice:muc_internal_portal:355119"],
                "errors": [],
            }
            worker.main(
                [
                    "--bundle-path",
                    "/tmp/notices-bundle.json",
                    "--allow-local-fixture-import",
                    "--manifest-path",
                    "/tmp/export-manifest.json",
                    "--site-id",
                    "muc_internal_portal",
                    "--source-home-url",
                    "https://portal.example.edu/home",
                    "--mode",
                    "admit-and-materialize",
                ]
            )

        request = run_import.call_args.kwargs["request"]
        self.assertEqual(request.mode, "admit_and_materialize")

    def test_main_passes_explicit_replace_scope_flag(self) -> None:
        with (
            patch("campus_ingestion_worker.import_authenticated_notice_export.load_worker_env"),
            patch(
                "campus_ingestion_worker.import_authenticated_notice_export.import_authenticated_notice_export"
            ) as run_import,
            patch("sys.stdout", new_callable=io.StringIO),
        ):
            run_import.return_value = {
                "notice_count": 1,
                "created_document_ids": ["notice:muc_internal_portal:355119"],
                "errors": [],
            }
            worker.main(
                [
                    "--bundle-path",
                    "/tmp/notices-bundle.json",
                    "--allow-local-fixture-import",
                    "--manifest-path",
                    "/tmp/export-manifest.json",
                    "--site-id",
                    "muc_internal_portal",
                    "--source-home-url",
                    "https://portal.example.edu/home",
                    "--replace-scope",
                ]
            )

        request = run_import.call_args.kwargs["request"]
        self.assertTrue(request.replace_scope)

    def test_main_passes_source_truth_only_stop_point(self) -> None:
        with (
            patch("campus_ingestion_worker.import_authenticated_notice_export.load_worker_env"),
            patch(
                "campus_ingestion_worker.import_authenticated_notice_export.import_authenticated_notice_export"
            ) as run_import,
            patch("sys.stdout", new_callable=io.StringIO),
        ):
            run_import.return_value = {
                "notice_count": 1,
                "created_document_ids": ["notice:muc_internal_portal:355119"],
                "errors": [],
            }
            worker.main(
                [
                    "--bundle-path",
                    "/tmp/notices-bundle.json",
                    "--allow-local-fixture-import",
                    "--manifest-path",
                    "/tmp/export-manifest.json",
                    "--site-id",
                    "muc_internal_portal",
                    "--source-home-url",
                    "https://portal.example.edu/home",
                    "--source-truth-only",
                ]
            )

        request = run_import.call_args.kwargs["request"]
        self.assertTrue(request.source_truth_only)


if __name__ == "__main__":
    unittest.main()
