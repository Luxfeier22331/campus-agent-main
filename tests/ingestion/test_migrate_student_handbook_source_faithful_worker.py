from __future__ import annotations

import importlib
import io
import json
import unittest
from unittest.mock import patch

from campus_ingestion_core import StudentHandbookMigrationReport

migration_worker = importlib.import_module(
    "campus_ingestion_worker.migrate_student_handbook_source_faithful"
)


class MigrateStudentHandbookSourceFaithfulWorkerCliTest(unittest.TestCase):
    def test_main_builds_typed_request_from_cli_args(self) -> None:
        with (
            patch(
                "campus_ingestion_worker.migrate_student_handbook_source_faithful.load_worker_env"
            ),
            patch(
                "campus_ingestion_worker.migrate_student_handbook_source_faithful.migrate_student_handbook_source_faithful"
            ) as migrate,
            patch("sys.stdout", new_callable=io.StringIO) as stdout,
        ):
            migrate.return_value = StudentHandbookMigrationReport(
                canonical_raw_filename="学生手册_2018.pdf",
                previous_raw_object_key="legacy.pdf",
                canonical_raw_object_key="canonical.pdf",
                rebuild_report={"status": "ok"},
            )
            migration_worker.main(
                [
                    "--raw-version-id",
                    "sha256:test-001",
                    "--raw-asset-id",
                    "asset:student-handbook-pdf",
                    "--canonical-raw-filename",
                    "学生手册_2018.pdf",
                ]
            )

        request = migrate.call_args.kwargs["request"]
        self.assertEqual(request.raw_version_id, "sha256:test-001")
        self.assertEqual(request.raw_asset_id, "asset:student-handbook-pdf")
        self.assertEqual(request.canonical_raw_filename, "学生手册_2018.pdf")
        payload = json.loads(stdout.getvalue())
        self.assertEqual(payload["canonical_raw_filename"], "学生手册_2018.pdf")


if __name__ == "__main__":
    unittest.main()
