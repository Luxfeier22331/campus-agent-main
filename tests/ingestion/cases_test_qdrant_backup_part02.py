# ruff: noqa: F403,F405
from __future__ import annotations

import unittest

from tests.ingestion.test_qdrant_backup_support import *


class QdrantBackupTestPart02(unittest.TestCase):
    def test_delete_gc_eligible_collection_removes_archive_candidate_and_writes_report(
        self,
    ) -> None:
        object_store = _FakeBackupObjectStore()
        qdrant_admin = _FakeQdrantSnapshotAdmin()
        validation_summary_key = build_index_release_artifact_key(
            corpus="regulations",
            collection="student_rules",
            release_id="r20260328_095627",
            filename="validation-summary.json",
        )
        manifest_key = _seed_release_manifest(
            object_store=object_store,
            corpus="regulations",
            collection="student_rules",
            release_id="r20260328_095627",
            physical_collection_name="student_rules__r20260328_095627",
            previous_physical_collection_name="student_rules__r20260327_100000",
            serving_alias="student_rules",
            validation_summary_key=validation_summary_key,
        )
        _seed_release_manifest(
            object_store=object_store,
            corpus="regulations",
            collection="student_rules",
            release_id="r20260331_120000",
            physical_collection_name="student_rules__r20260331_120000",
            previous_physical_collection_name="student_rules__r20260330_120000",
            serving_alias="student_rules",
        )
        backup_manifest = SnapshotBackupManifest(
            backup_id="b20260401T010203Z",
            backup_mode="qdrant_collection_snapshot_export",
            captured_at="2026-04-01T01:02:03+00:00",
            corpus="regulations",
            collection="student_rules",
            release_id="r20260328_095627",
            serving_alias="student_rules",
            physical_collection_name="student_rules__r20260328_095627",
            alias_bindings={"student_rules": "student_rules__r20260331_120000"},
            index_release_manifest_key=manifest_key,
            validation_summary_key=validation_summary_key,
            snapshot_object_key=build_qdrant_backup_artifact_key(
                corpus="regulations",
                collection="student_rules",
                release_id="r20260328_095627",
                backup_id="b20260401T010203Z",
                filename="student_rules__r20260328_095627.snapshot",
            ),
            snapshot_sha256=hashlib.sha256(b"snapshot").hexdigest(),
            backup_reason="pre-gc",
            operator="tester",
        )
        backup_manifest_key = build_qdrant_backup_artifact_key(
            corpus="regulations",
            collection="student_rules",
            release_id="r20260328_095627",
            backup_id="b20260401T010203Z",
            filename="backup-manifest.json",
        )
        object_store.put_bytes(
            bucket=DERIVED_BUCKET,
            key=backup_manifest.snapshot_object_key,
            data=b"snapshot",
            content_type="application/octet-stream",
        )
        object_store.put_bytes(
            bucket=DERIVED_BUCKET,
            key=backup_manifest_key,
            data=(json.dumps(asdict(backup_manifest), ensure_ascii=False, indent=2) + "\n").encode(
                "utf-8"
            ),
            content_type="application/json",
        )
        qdrant_admin.aliases["student_rules"] = "student_rules__r20260331_120000"
        qdrant_admin.collections.update(
            {
                "student_rules__r20260328_095627",
                "student_rules__r20260331_120000",
            }
        )

        report = delete_gc_eligible_collection(
            request=CollectionGcDeleteRequest(
                corpus="regulations",
                collection="student_rules",
                release_id="r20260328_095627",
                operator="tester",
            ),
            env={},
            object_store=object_store,
            qdrant_admin=qdrant_admin,
        )

        self.assertTrue(report.eligible)
        self.assertTrue(report.deleted)
        self.assertEqual(report.role, "archive_candidate")
        self.assertEqual(report.blockers, ())
        self.assertEqual(
            qdrant_admin.deleted_collections,
            ["student_rules__r20260328_095627"],
        )
        self.assertNotIn("student_rules__r20260328_095627", qdrant_admin.collections)
        self.assertEqual(report.backup_manifest_object_key, backup_manifest_key)
        self.assertEqual(
            report.delete_report_object_key,
            build_qdrant_backup_artifact_key(
                corpus="regulations",
                collection="student_rules",
                release_id="r20260328_095627",
                backup_id="b20260401T010203Z",
                filename="gc-delete-report.json",
            ),
        )
        persisted = json.loads(
            object_store.get_bytes(
                bucket=DERIVED_BUCKET,
                key=report.delete_report_object_key,
            ).decode("utf-8")
        )
        self.assertTrue(persisted["deleted"])
        self.assertEqual(persisted["operator"], "tester")
        self.assertEqual(
            persisted["physical_collection_name"],
            "student_rules__r20260328_095627",
        )

    def test_delete_gc_eligible_collection_rejects_missing_operator(self) -> None:
        object_store = _FakeBackupObjectStore()
        qdrant_admin = _FakeQdrantSnapshotAdmin()
        _seed_release_manifest(
            object_store=object_store,
            corpus="regulations",
            collection="student_rules",
            release_id="r20260328_095627",
            physical_collection_name="student_rules__r20260328_095627",
            previous_physical_collection_name="student_rules__r20260327_100000",
            serving_alias="student_rules",
        )

        with self.assertRaisesRegex(ValueError, "operator is required"):
            delete_gc_eligible_collection(
                request=CollectionGcDeleteRequest(
                    corpus="regulations",
                    collection="student_rules",
                    release_id="r20260328_095627",
                    operator="",
                ),
                env={},
                object_store=object_store,
                qdrant_admin=qdrant_admin,
            )

    def test_delete_gc_eligible_collection_refuses_ineligible_release(self) -> None:
        object_store = _FakeBackupObjectStore()
        qdrant_admin = _FakeQdrantSnapshotAdmin()
        _seed_release_manifest(
            object_store=object_store,
            corpus="regulations",
            collection="student_rules",
            release_id="r20260331_120000",
            physical_collection_name="student_rules__r20260331_120000",
            previous_physical_collection_name="student_rules__r20260330_120000",
            serving_alias="student_rules",
        )
        qdrant_admin.aliases["student_rules"] = "student_rules__r20260331_120000"
        qdrant_admin.collections.add("student_rules__r20260331_120000")

        report = delete_gc_eligible_collection(
            request=CollectionGcDeleteRequest(
                corpus="regulations",
                collection="student_rules",
                release_id="r20260331_120000",
                operator="tester",
            ),
            env={},
            object_store=object_store,
            qdrant_admin=qdrant_admin,
        )

        self.assertFalse(report.eligible)
        self.assertFalse(report.deleted)
        self.assertEqual(report.role, "current")
        self.assertIn("current_alias_target", report.blockers)
        self.assertEqual(qdrant_admin.deleted_collections, [])
        self.assertIsNone(report.delete_report_object_key)

    def test_delete_gc_eligible_collection_removes_preview_candidate_without_snapshot_backup(
        self,
    ) -> None:
        object_store = _FakeBackupObjectStore()
        qdrant_admin = _FakeQdrantSnapshotAdmin()
        _seed_release_manifest(
            object_store=object_store,
            corpus="regulations",
            collection="student_rules",
            release_id="r20260507_114855_751879_351c552d",
            physical_collection_name="student_rules__r20260507_114855_751879_351c552d",
            previous_physical_collection_name="student_rules__r20260507_015403_831830_7efbb08f",
            serving_alias="student_rules",
            published_at=None,
        )
        _seed_release_manifest(
            object_store=object_store,
            corpus="regulations",
            collection="student_rules",
            release_id="r20260507_131414_903127_da40dbcf",
            physical_collection_name="student_rules__r20260507_131414_903127_da40dbcf",
            previous_physical_collection_name="student_rules__r20260507_015403_831830_7efbb08f",
            serving_alias="student_rules",
            published_at=None,
        )
        qdrant_admin.aliases["student_rules"] = "student_rules__r20260507_015403_831830_7efbb08f"
        qdrant_admin.collections.update(
            {
                "student_rules__r20260507_015403_831830_7efbb08f",
                "student_rules__r20260507_114855_751879_351c552d",
                "student_rules__r20260507_131414_903127_da40dbcf",
            }
        )

        report = delete_gc_eligible_collection(
            request=CollectionGcDeleteRequest(
                corpus="regulations",
                collection="student_rules",
                release_id="r20260507_114855_751879_351c552d",
                operator="tester",
            ),
            env={},
            object_store=object_store,
            qdrant_admin=qdrant_admin,
        )

        self.assertTrue(report.eligible)
        self.assertTrue(report.deleted)
        self.assertEqual(report.role, "preview_candidate")
        self.assertEqual(report.blockers, ())
        self.assertIsNone(report.backup_manifest_object_key)
        self.assertEqual(
            qdrant_admin.deleted_collections,
            ["student_rules__r20260507_114855_751879_351c552d"],
        )
        self.assertEqual(
            report.delete_report_object_key,
            "regulations/operations/qdrant_gc_delete/"
            "r20260507_114855_751879_351c552d/student_rules/gc-delete-report.json",
        )


if __name__ == "__main__":
    unittest.main()
