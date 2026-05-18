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
    SnapshotBackupManifest,
    SnapshotRestoreReport,
)

backup_create_worker = importlib.import_module("campus_ingestion_worker.qdrant_backup_create")
backup_restore_worker = importlib.import_module("campus_ingestion_worker.qdrant_backup_restore")
gc_check_worker = importlib.import_module("campus_ingestion_worker.qdrant_gc_check")
gc_delete_worker = importlib.import_module("campus_ingestion_worker.qdrant_gc_delete")


class QdrantBackupWorkerCliTest(unittest.TestCase):
    def test_backup_create_main_builds_typed_request_from_cli_args(self) -> None:
        with (
            patch("campus_ingestion_worker.qdrant_backup_create.load_worker_env"),
            patch(
                "campus_ingestion_worker.qdrant_backup_create.create_snapshot_backup"
            ) as create_backup,
            patch("sys.stdout", new_callable=io.StringIO) as stdout,
        ):
            create_backup.return_value = SnapshotBackupManifest(
                backup_id="b20260401T010203Z",
                backup_mode="qdrant_collection_snapshot_export",
                captured_at="2026-04-01T01:02:03+00:00",
                corpus="regulations",
                collection="student_rules",
                release_id="r20260331_120000",
                serving_alias="student_rules",
                physical_collection_name="student_rules__r20260331_120000",
                alias_bindings={"student_rules": "student_rules__r20260331_120000"},
                index_release_manifest_key="regulations/releases/student_rules/r20260331_120000/index-release.json",
                validation_summary_key=None,
                snapshot_object_key="regulations/backups/student_rules/r20260331_120000/b20260401T010203Z/student_rules__r20260331_120000.snapshot",
                snapshot_sha256="abc",
                backup_reason="pre-gc",
                operator="tester",
            )
            backup_create_worker.main(
                [
                    "--corpus",
                    "regulations",
                    "--collection",
                    "student_rules",
                    "--release-id",
                    "r20260331_120000",
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
        payload = json.loads(stdout.getvalue())
        self.assertEqual(payload["backup_id"], "b20260401T010203Z")

    def test_backup_create_requires_explicit_operator(self) -> None:
        with (
            patch("campus_ingestion_worker.qdrant_backup_create.load_worker_env"),
            patch.dict(os.environ, {"USER": "ambient-user"}, clear=False),
            self.assertRaises(SystemExit),
        ):
            backup_create_worker.main(
                [
                    "--corpus",
                    "regulations",
                    "--collection",
                    "student_rules",
                    "--release-id",
                    "r20260331_120000",
                    "--backup-reason",
                    "pre-gc",
                ]
            )

    def test_backup_restore_main_builds_typed_request_from_cli_args(self) -> None:
        with (
            patch("campus_ingestion_worker.qdrant_backup_restore.load_worker_env"),
            patch(
                "campus_ingestion_worker.qdrant_backup_restore.restore_snapshot_backup"
            ) as restore_backup,
            patch("sys.stdout", new_callable=io.StringIO) as stdout,
        ):
            restore_backup.return_value = SnapshotRestoreReport(
                backup_id="b20260401T010203Z",
                corpus="regulations",
                collection="student_rules",
                release_id="r20260331_120000",
                restored_collection_name="student_rules__r20260331_120000",
                applied_alias_bindings={"student_rules": "student_rules__r20260331_120000"},
                points_count=20,
                restored_at="2026-04-01T02:03:04+00:00",
                restore_report_object_key="regulations/backups/student_rules/r20260331_120000/b20260401T010203Z/restore-report.json",
                verification_status="passed",
            )
            backup_restore_worker.main(
                [
                    "--corpus",
                    "regulations",
                    "--collection",
                    "student_rules",
                    "--release-id",
                    "r20260331_120000",
                    "--backup-id",
                    "b20260401T010203Z",
                    "--operator",
                    "tester",
                    "--apply-alias",
                ]
            )

        request = restore_backup.call_args.kwargs["request"]
        self.assertTrue(request.apply_alias)
        self.assertEqual(request.backup_id, "b20260401T010203Z")
        payload = json.loads(stdout.getvalue())
        self.assertEqual(payload["verification_status"], "passed")

    def test_backup_restore_requires_explicit_operator(self) -> None:
        with (
            patch("campus_ingestion_worker.qdrant_backup_restore.load_worker_env"),
            patch.dict(os.environ, {"USER": "ambient-user"}, clear=False),
            self.assertRaises(SystemExit),
        ):
            backup_restore_worker.main(
                [
                    "--corpus",
                    "regulations",
                    "--collection",
                    "student_rules",
                    "--release-id",
                    "r20260331_120000",
                    "--backup-id",
                    "b20260401T010203Z",
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
                blockers=("missing_snapshot_backup",),
                backup_manifest_object_key=None,
            )
            gc_check_worker.main(
                [
                    "--corpus",
                    "regulations",
                    "--collection",
                    "student_rules",
                    "--release-id",
                    "r20260328_095627",
                ]
            )

        request = gc_check.call_args.kwargs["request"]
        self.assertEqual(request.release_id, "r20260328_095627")
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
                backup_manifest_object_key=(
                    "regulations/backups/student_rules/r20260328_095627/"
                    "b20260401T010203Z/backup-manifest.json"
                ),
                delete_report_object_key=(
                    "regulations/backups/student_rules/r20260328_095627/"
                    "b20260401T010203Z/gc-delete-report.json"
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
                ]
            )

        request = gc_delete.call_args.kwargs["request"]
        self.assertEqual(request.release_id, "r20260328_095627")
        self.assertEqual(request.operator, "tester")
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
