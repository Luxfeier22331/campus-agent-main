from __future__ import annotations

import importlib
import io
import json
import os
import unittest
from unittest.mock import patch

from campus_ingestion_core.qdrant_backup import (
    CollectionGcDeleteReport,
    CollectionGcEligibilityReport,
)
from campus_ingestion_core.qdrant_filesystem_backup import FilesystemSnapshotBackupReport

filesystem_backup_worker = importlib.import_module(
    "campus_ingestion_worker.qdrant_filesystem_backup_create"
)
gc_check_worker = importlib.import_module("campus_ingestion_worker.qdrant_gc_check")
gc_delete_worker = importlib.import_module("campus_ingestion_worker.qdrant_gc_delete")


class QdrantBackupWorkerCliTest(unittest.TestCase):
    def test_filesystem_backup_create_main_builds_typed_request_from_cli_args(self) -> None:
        with (
            patch("campus_ingestion_worker.qdrant_filesystem_backup_create.load_worker_env"),
            patch("campus_ingestion_worker.qdrant_filesystem_backup_create.S3ObjectStoreAdmin"),
            patch("campus_ingestion_worker.qdrant_filesystem_backup_create.ObjectStoreSettings"),
            patch("campus_ingestion_worker.qdrant_filesystem_backup_create.QdrantSnapshotAdmin"),
            patch("campus_ingestion_worker.qdrant_filesystem_backup_create.RetrievalSettings"),
            patch(
                "campus_ingestion_worker.qdrant_filesystem_backup_create."
                "create_filesystem_snapshot_backup"
            ) as create_backup,
            patch("sys.stdout", new_callable=io.StringIO) as stdout,
        ):
            create_backup.return_value = FilesystemSnapshotBackupReport(
                backup_id="b20260401T010203Z",
                bundle_dir="/srv/backups/campus-agent/qdrant-snapshots/regulations/student_rules/r20260331_120000/b20260401T010203Z",
                corpus="regulations",
                collection="student_rules",
                release_id="r20260331_120000",
                physical_collection_name="student_rules__r20260331_120000",
                snapshot_path="/srv/backups/campus-agent/qdrant-snapshots/regulations/student_rules/r20260331_120000/b20260401T010203Z/student_rules__r20260331_120000.snapshot",
                snapshot_sha256="abc",
                snapshot_size_bytes=123,
                point_count=20,
                manifest_path="/srv/backups/campus-agent/qdrant-snapshots/regulations/student_rules/r20260331_120000/b20260401T010203Z/backup-manifest.json",
                restore_command_path="/srv/backups/campus-agent/qdrant-snapshots/regulations/student_rules/r20260331_120000/b20260401T010203Z/restore-command.txt",
            )
            filesystem_backup_worker.main(
                [
                    "--corpus",
                    "regulations",
                    "--collection",
                    "student_rules",
                    "--release-id",
                    "r20260331_120000",
                    "--output-root",
                    "/srv/backups/campus-agent/qdrant-snapshots",
                    "--backup-reason",
                    "pre-gc",
                    "--operator",
                    "tester",
                ]
            )

        request = create_backup.call_args.kwargs["request"]
        self.assertEqual(request.release_id, "r20260331_120000")
        self.assertEqual(request.backup_reason, "pre-gc")
        self.assertEqual(request.operator, "tester")
        self.assertEqual(str(request.output_root), "/srv/backups/campus-agent/qdrant-snapshots")
        payload = json.loads(stdout.getvalue())
        self.assertEqual(payload["backup_id"], "b20260401T010203Z")

    def test_filesystem_backup_create_requires_explicit_operator(self) -> None:
        with (
            patch("campus_ingestion_worker.qdrant_filesystem_backup_create.load_worker_env"),
            patch.dict(os.environ, {"USER": "ambient-user"}, clear=False),
            self.assertRaises(SystemExit),
        ):
            filesystem_backup_worker.main(
                [
                    "--corpus",
                    "regulations",
                    "--collection",
                    "student_rules",
                    "--release-id",
                    "r20260331_120000",
                    "--output-root",
                    "/srv/backups/campus-agent/qdrant-snapshots",
                    "--backup-reason",
                    "pre-gc",
                ]
            )

    def test_gc_check_main_builds_typed_request_from_cli_args(self) -> None:
        with (
            patch("campus_ingestion_worker.qdrant_gc_check.load_worker_env"),
            patch(
                "campus_ingestion_worker.qdrant_gc_check.check_snapshot_gc_eligibility"
            ) as gc_check,
            patch("sys.stdout", new_callable=io.StringIO) as stdout,
        ):
            gc_check.return_value = CollectionGcEligibilityReport(
                eligible=False,
                corpus="regulations",
                collection="student_rules",
                release_id="r20260328_095627",
                physical_collection_name="student_rules__r20260328_095627",
                role="archive_candidate",
                blockers=("missing_native_snapshot_backup",),
                backup_manifest_path=None,
            )
            gc_check_worker.main(
                [
                    "--corpus",
                    "regulations",
                    "--collection",
                    "student_rules",
                    "--release-id",
                    "r20260328_095627",
                    "--backup-root",
                    "/srv/backups/campus-agent/qdrant-snapshots",
                ]
            )

        request = gc_check.call_args.kwargs["request"]
        self.assertEqual(request.release_id, "r20260328_095627")
        self.assertEqual(str(request.backup_root), "/srv/backups/campus-agent/qdrant-snapshots")
        payload = json.loads(stdout.getvalue())
        self.assertFalse(payload["eligible"])

    def test_gc_delete_main_builds_typed_request_from_cli_args(self) -> None:
        with (
            patch("campus_ingestion_worker.qdrant_gc_delete.load_worker_env"),
            patch(
                "campus_ingestion_worker.qdrant_gc_delete.delete_gc_eligible_collection"
            ) as gc_delete,
            patch("sys.stdout", new_callable=io.StringIO) as stdout,
        ):
            gc_delete.return_value = CollectionGcDeleteReport(
                eligible=True,
                deleted=True,
                corpus="regulations",
                collection="student_rules",
                release_id="r20260328_095627",
                physical_collection_name="student_rules__r20260328_095627",
                role="archive_candidate",
                blockers=(),
                backup_manifest_path=(
                    "/srv/backups/campus-agent/qdrant-snapshots/regulations/student_rules/"
                    "r20260328_095627/b20260401T010203Z/backup-manifest.json"
                ),
                delete_report_object_key=(
                    "regulations/operations/qdrant_gc_delete/"
                    "r20260328_095627/student_rules/gc-delete-report.json"
                ),
                deleted_at="2026-04-01T03:04:05+00:00",
                operator="tester",
            )
            gc_delete_worker.main(
                [
                    "--corpus",
                    "regulations",
                    "--collection",
                    "student_rules",
                    "--release-id",
                    "r20260328_095627",
                    "--operator",
                    "tester",
                    "--backup-root",
                    "/srv/backups/campus-agent/qdrant-snapshots",
                ]
            )

        request = gc_delete.call_args.kwargs["request"]
        self.assertEqual(request.release_id, "r20260328_095627")
        self.assertEqual(request.operator, "tester")
        self.assertEqual(str(request.backup_root), "/srv/backups/campus-agent/qdrant-snapshots")
        payload = json.loads(stdout.getvalue())
        self.assertTrue(payload["deleted"])

    def test_gc_delete_requires_explicit_operator(self) -> None:
        with (
            patch("campus_ingestion_worker.qdrant_gc_delete.load_worker_env"),
            patch.dict(os.environ, {"USER": "ambient-user"}, clear=False),
            self.assertRaises(SystemExit),
        ):
            gc_delete_worker.main(
                [
                    "--corpus",
                    "regulations",
                    "--collection",
                    "student_rules",
                    "--release-id",
                    "r20260328_095627",
                ]
            )


if __name__ == "__main__":
    unittest.main()
