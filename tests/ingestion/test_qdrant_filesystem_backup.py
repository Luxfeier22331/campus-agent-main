from __future__ import annotations

import json
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

from campus_ingestion_core.qdrant_filesystem_backup import (
    FilesystemSnapshotBackupRequest,
    create_filesystem_snapshot_backup,
)

from tests.ingestion.test_qdrant_backup_support import (
    DERIVED_BUCKET,
    _FakeBackupObjectStore,
    _FakeQdrantSnapshotAdmin,
    _seed_release_manifest,
)


class QdrantFilesystemBackupTest(unittest.TestCase):
    def test_writes_snapshot_manifest_sha_and_restore_command_for_current_alias(self) -> None:
        object_store = _FakeBackupObjectStore()
        qdrant_admin = _FakeQdrantSnapshotAdmin()
        release_key = _seed_release_manifest(
            object_store=object_store,
            corpus="regulations",
            collection="student_rules",
            release_id="r20260513",
            physical_collection_name="student_rules__r20260513",
            previous_physical_collection_name=None,
            serving_alias="student_rules",
            validation_summary_key="regulations/releases/student_rules/r20260513/validation.json",
        )
        qdrant_admin.aliases["student_rules"] = "student_rules__r20260513"
        qdrant_admin.collections.add("student_rules__r20260513")
        qdrant_admin.points_count["student_rules__r20260513"] = 20
        qdrant_admin.release_payload["student_rules__r20260513"] = {
            "index_release_id": "r20260513",
            "index_release_manifest_key": release_key,
            "index_release_alias": "student_rules",
        }

        with TemporaryDirectory() as temp_dir:
            report = create_filesystem_snapshot_backup(
                request=FilesystemSnapshotBackupRequest(
                    corpus="regulations",
                    collection="student_rules",
                    release_id="r20260513",
                    output_root=Path(temp_dir),
                    operator="tester",
                ),
                env={},
                object_store=object_store,
                qdrant_admin=qdrant_admin,
                backup_id="b20260513T010203Z",
            )
            bundle_dir = Path(report.bundle_dir)
            manifest = json.loads((bundle_dir / "backup-manifest.json").read_text())

            self.assertTrue((bundle_dir / "student_rules__r20260513.snapshot").is_file())
            self.assertTrue((bundle_dir / "sha256.txt").is_file())
            self.assertTrue((bundle_dir / "restore-command.txt").is_file())
            self.assertEqual(manifest["bucket"], "filesystem")
            self.assertEqual(manifest["source_bucket"], DERIVED_BUCKET)
            self.assertEqual(manifest["physical_collection_name"], "student_rules__r20260513")
            self.assertEqual(manifest["index_release_manifest_key"], release_key)
            self.assertEqual(manifest["point_count"], 20)
            self.assertEqual(manifest["snapshot_sha256"], report.snapshot_sha256)
            self.assertIn(
                "qdrant-native-snapshot.sh restore-collection", manifest["restore_command"]
            )
            self.assertIn("cd ", manifest["restore_command"])

        self.assertEqual(
            qdrant_admin.created_snapshots,
            [("student_rules__r20260513", "student_rules__r20260513-snapshot-001.snapshot")],
        )
        self.assertEqual(
            qdrant_admin.deleted_snapshots,
            [("student_rules__r20260513", "student_rules__r20260513-snapshot-001.snapshot")],
        )

    def test_rejects_alias_payload_mismatch_before_writing_snapshot(self) -> None:
        object_store = _FakeBackupObjectStore()
        qdrant_admin = _FakeQdrantSnapshotAdmin()
        _seed_release_manifest(
            object_store=object_store,
            corpus="curriculum",
            collection="curriculum_plan",
            release_id="r20260504",
            physical_collection_name="curriculum_plan__r20260504",
            previous_physical_collection_name=None,
            serving_alias="curriculum_plan",
            validation_summary_key="curriculum/releases/curriculum_plan/r20260504/validation.json",
        )
        qdrant_admin.aliases["curriculum_plan"] = "curriculum_plan__r20260504"
        qdrant_admin.collections.add("curriculum_plan__r20260504")
        qdrant_admin.points_count["curriculum_plan__r20260504"] = 20
        qdrant_admin.release_payload["curriculum_plan__r20260504"] = {
            "index_release_id": "wrong",
            "index_release_manifest_key": "wrong",
            "index_release_alias": "curriculum_plan",
        }

        with (
            TemporaryDirectory() as temp_dir,
            self.assertRaisesRegex(ValueError, "payload_release_id_mismatch"),
        ):
            create_filesystem_snapshot_backup(
                request=FilesystemSnapshotBackupRequest(
                    corpus="curriculum",
                    collection="curriculum_plan",
                    release_id="r20260504",
                    output_root=Path(temp_dir),
                    operator="tester",
                ),
                env={},
                object_store=object_store,
                qdrant_admin=qdrant_admin,
                backup_id="b20260504T010203Z",
            )
        self.assertEqual(qdrant_admin.created_snapshots, [])


if __name__ == "__main__":
    unittest.main()
