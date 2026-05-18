from __future__ import annotations

import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from campus_ingestion_core.authenticated_notice_source_run_retention import (
    AUTHENTICATED_NOTICE_SOURCE_RUN_PREFIX,
)
from campus_ingestion_worker.authenticated_notice_source_run_retention_sources import (
    CURRENT_SOURCE_RUN_REFERENCE_QUERIES,
    extract_source_run_ids_from_text,
    load_repo_referenced_source_run_ids,
)
from campus_ingestion_worker.cleanup_authenticated_notice_source_runs import (
    build_parser as build_cleanup_parser,
)


class AuthenticatedNoticeSourceRunRetentionWorkerTests(unittest.TestCase):
    def test_extract_source_run_ids_from_text(self) -> None:
        payload = (
            f"{AUTHENTICATED_NOTICE_SOURCE_RUN_PREFIX}run-a/export-manifest.json "
            f"{AUTHENTICATED_NOTICE_SOURCE_RUN_PREFIX}run-b/notices-bundle.json"
        )

        self.assertEqual(extract_source_run_ids_from_text(payload), frozenset({"run-a", "run-b"}))

    def test_repo_reference_loader_uses_fixed_string_search(self) -> None:
        calls: list[list[str]] = []

        def fake_run(argv, *, cwd, check):
            del cwd, check
            calls.append(list(argv))
            run_id = argv[3]
            return type("Completed", (), {"returncode": 0 if run_id == "referenced" else 1})()

        with patch(
            "campus_ingestion_worker.authenticated_notice_source_run_retention_sources.subprocess.run",
            side_effect=fake_run,
        ):
            referenced = load_repo_referenced_source_run_ids(
                candidate_run_ids={"referenced", "unreferenced"},
                repo_root=".",
            )

        self.assertEqual(referenced, frozenset({"referenced"}))
        self.assertTrue(all("--fixed-strings" in call for call in calls))

    def test_cleanup_parser_requires_candidate_objects_path(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            args = build_cleanup_parser().parse_args(
                [
                    "--candidate-objects-path",
                    str(Path(tmp) / "delete-candidate-objects.jsonl"),
                    "--output-dir",
                    str(Path(tmp) / "delete"),
                    "--dry-run",
                ]
            )

        self.assertTrue(args.dry_run)
        self.assertFalse(args.yes)

    def test_db_reference_loader_uses_current_schema_tables(self) -> None:
        self.assertEqual(
            tuple(spec.table_name for spec in CURRENT_SOURCE_RUN_REFERENCE_QUERIES),
            (
                "ingestion_queue.notice_ingest_jobs",
                "ingestion_registry.document_registry_records",
                "ingestion_registry.raw_asset_registry_records",
                "ingestion_projection.authenticated_notice_collector_run",
                "ingestion_projection.authenticated_notice_file_release_inventory",
                "ingestion_projection.authenticated_notice_source_truth_inventory",
                "operator.authenticated_notice_processing_projection",
                "operator.authenticated_notice_run_processing_projection",
            ),
        )
        queue_spec = CURRENT_SOURCE_RUN_REFERENCE_QUERIES[0]
        self.assertIn("source_object_refs::text", queue_spec.text_expressions)
        self.assertIn("job_payload::text", queue_spec.text_expressions)


if __name__ == "__main__":
    unittest.main()
