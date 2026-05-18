from __future__ import annotations

import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from campus_ingestion_core.authenticated_notice_closeout_operations_retention import (
    AUTHENTICATED_NOTICE_CLOSEOUT_OPERATIONS_PREFIX,
)
from campus_ingestion_worker.authenticated_notice_closeout_operations_retention_sources import (
    extract_closeout_run_ids_from_text,
    load_repo_referenced_closeout_run_ids,
)
from campus_ingestion_worker.cleanup_authenticated_notice_closeout_operations import (
    build_parser as build_cleanup_parser,
)


class AuthenticatedNoticeCloseoutOperationsRetentionWorkerTests(unittest.TestCase):
    def test_extract_closeout_run_ids_from_text(self) -> None:
        payload = (
            f"{AUTHENTICATED_NOTICE_CLOSEOUT_OPERATIONS_PREFIX}run-a/staging/document-units.jsonl "
            f"{AUTHENTICATED_NOTICE_CLOSEOUT_OPERATIONS_PREFIX}run-b/run-manifest.json"
        )

        self.assertEqual(
            extract_closeout_run_ids_from_text(payload),
            frozenset({"run-a", "run-b"}),
        )

    def test_repo_reference_loader_uses_fixed_string_search(self) -> None:
        calls: list[list[str]] = []

        def fake_run(argv, *, cwd, check):
            del cwd, check
            calls.append(list(argv))
            run_id = argv[3]
            return type("Completed", (), {"returncode": 0 if run_id == "referenced" else 1})()

        with patch(
            "campus_ingestion_worker.authenticated_notice_closeout_operations_retention_sources.subprocess.run",
            side_effect=fake_run,
        ):
            referenced = load_repo_referenced_closeout_run_ids(
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


if __name__ == "__main__":
    unittest.main()
