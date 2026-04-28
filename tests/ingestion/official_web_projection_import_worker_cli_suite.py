from __future__ import annotations

import io
import json
import unittest
from unittest.mock import Mock, patch

from campus_ingestion_core.campusrag_ingestion_support import ImportReport

from .official_web_projection_import_worker_test_support import _object_store_settings, worker


class OfficialWebProjectionImportWorkerCliTest(unittest.TestCase):
    def test_main_passes_cli_args_into_import_projection_output(self) -> None:
        fake_report = ImportReport(
            import_mode="official_web_source_truth_replay",
            success_count=1,
            skipped_count=0,
            failed_count=0,
            raw_uploaded_count=0,
            raw_reused_count=0,
            document_ids=("official_web:muc_public_pages:article_detail:doc-1",),
            created_document_ids=("official_web:muc_public_pages:article_detail:doc-1",),
            updated_document_ids=(),
            skipped_document_ids=(),
            unresolved_source_pdfs=(),
            errors=(),
            report_path="/tmp/work/import-reports/official-web-import.json",
        )
        with (
            patch("campus_ingestion_worker.official_web_projection_import.load_worker_env"),
            patch(
                "campus_ingestion_worker.official_web_projection_import._resolve_object_store_settings"
            ) as resolve_settings,
            patch(
                "campus_ingestion_worker.official_web_projection_import.build_document_registry_from_env"
            ) as build_document_registry,
            patch(
                "campus_ingestion_worker.official_web_projection_import.build_raw_asset_registry_from_env"
            ) as build_raw_asset_registry,
            patch(
                "campus_ingestion_worker.official_web_projection_import.import_projection_output"
            ) as import_projection_output,
            patch("sys.stdout", new_callable=io.StringIO) as stdout,
        ):
            resolve_settings.return_value = _object_store_settings()
            build_document_registry.return_value = Mock()
            build_raw_asset_registry.return_value = Mock()
            import_projection_output.return_value = fake_report
            worker.main(
                [
                    "--projection-output-dir",
                    "/tmp/projection-output",
                    "--replay-input-dir",
                    "/tmp/replay-input",
                    "--work-dir",
                    "/tmp/work",
                    "--corpus",
                    "official_web",
                    "--collection",
                    "muc_public_pages",
                    "--require-promotable",
                    "--dry-run",
                ]
            )

        self.assertEqual(
            import_projection_output.call_args.kwargs["scope_refresh"],
            ("official_web", "muc_public_pages"),
        )
        self.assertTrue(import_projection_output.call_args.kwargs["require_promotable"])
        self.assertTrue(import_projection_output.call_args.kwargs["dry_run"])
        payload = json.loads(stdout.getvalue())
        self.assertEqual(payload["success_count"], 1)
