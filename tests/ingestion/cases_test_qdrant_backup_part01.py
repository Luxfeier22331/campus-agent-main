# ruff: noqa: F403,F405
from __future__ import annotations

import unittest

from tests.ingestion.test_qdrant_backup_support import *


class QdrantBackupTestPart01(unittest.TestCase):
    def test_build_qdrant_backup_artifact_key_uses_backup_namespace(self) -> None:
        key = build_qdrant_backup_artifact_key(
            corpus="regulations",
            collection="student_rules",
            release_id="r20260331_120000",
            backup_id="b20260401T010203Z",
            filename="backup-manifest.json",
        )

        self.assertEqual(
            key,
            "regulations/backups/student_rules/r20260331_120000/b20260401T010203Z/backup-manifest.json",
        )

    def test_create_snapshot_backup_writes_snapshot_bundle_and_manifest(self) -> None:
        object_store = _FakeBackupObjectStore()
        qdrant_admin = _FakeQdrantSnapshotAdmin()
        validation_summary_key = build_index_release_artifact_key(
            corpus="regulations",
            collection="student_rules",
            release_id="r20260331_120000",
            filename="validation-summary.json",
        )
        manifest_key = _seed_release_manifest(
            object_store=object_store,
            corpus="regulations",
            collection="student_rules",
            release_id="r20260331_120000",
            physical_collection_name="student_rules__r20260331_120000",
            previous_physical_collection_name="student_rules__r20260330_120000",
            serving_alias="student_rules",
            validation_summary_key=validation_summary_key,
        )
        qdrant_admin.aliases["student_rules"] = "student_rules__r20260331_120000"

        manifest = create_snapshot_backup(
            request=SnapshotBackupRequest(
                corpus="regulations",
                collection="student_rules",
                release_id="r20260331_120000",
                backup_reason="pre-gc",
                operator="tester",
            ),
            env={},
            object_store=object_store,
            qdrant_admin=qdrant_admin,
        )

        snapshot_key = build_qdrant_backup_artifact_key(
            corpus="regulations",
            collection="student_rules",
            release_id="r20260331_120000",
            backup_id=manifest.backup_id,
            filename="student_rules__r20260331_120000.snapshot",
        )
        backup_manifest_key = build_qdrant_backup_artifact_key(
            corpus="regulations",
            collection="student_rules",
            release_id="r20260331_120000",
            backup_id=manifest.backup_id,
            filename="backup-manifest.json",
        )

        self.assertEqual(manifest.index_release_manifest_key, manifest_key)
        self.assertEqual(manifest.validation_summary_key, validation_summary_key)
        self.assertEqual(
            manifest.alias_bindings, {"student_rules": "student_rules__r20260331_120000"}
        )
        self.assertEqual(manifest.snapshot_object_key, snapshot_key)
        self.assertIn((DERIVED_BUCKET, snapshot_key), object_store.objects)
        self.assertIn((DERIVED_BUCKET, backup_manifest_key), object_store.objects)
        self.assertEqual(
            manifest.snapshot_sha256,
            hashlib.sha256(object_store.objects[(DERIVED_BUCKET, snapshot_key)]).hexdigest(),
        )

    def test_load_index_release_manifest_preserves_post_publish_audit_metadata(self) -> None:
        object_store = _FakeBackupObjectStore()
        audit_summary_key = build_index_release_artifact_key(
            corpus="regulations",
            collection="student_rules",
            release_id="r20260331_120000",
            filename="post-publish-audit-summary.json",
        )
        _seed_release_manifest(
            object_store=object_store,
            corpus="regulations",
            collection="student_rules",
            release_id="r20260331_120000",
            physical_collection_name="student_rules__r20260331_120000",
            previous_physical_collection_name="student_rules__r20260330_120000",
            serving_alias="student_rules",
            post_publish_audit_status="passed",
            post_publish_audit_summary_key=audit_summary_key,
        )

        manifest = _load_index_release_manifest(
            object_store=object_store,
            bucket=DERIVED_BUCKET,
            corpus="regulations",
            collection="student_rules",
            release_id="r20260331_120000",
        )

        self.assertEqual(manifest.post_publish_audit_status, "passed")
        self.assertEqual(manifest.post_publish_audit_summary_object_key, audit_summary_key)

    def test_load_index_release_manifest_preserves_component_eval_metadata(self) -> None:
        object_store = _FakeBackupObjectStore()
        component_eval_summary_key = build_index_release_artifact_key(
            corpus="regulations",
            collection="student_rules",
            release_id="r20260331_120000",
            filename="component-eval-summary.json",
        )
        _seed_release_manifest(
            object_store=object_store,
            corpus="regulations",
            collection="student_rules",
            release_id="r20260331_120000",
            physical_collection_name="student_rules__r20260331_120000",
            previous_physical_collection_name="student_rules__r20260330_120000",
            serving_alias="student_rules",
            component_eval_status="passed",
            component_eval_summary_key=component_eval_summary_key,
        )

        manifest = _load_index_release_manifest(
            object_store=object_store,
            bucket=DERIVED_BUCKET,
            corpus="regulations",
            collection="student_rules",
            release_id="r20260331_120000",
        )

        self.assertEqual(manifest.component_eval_status, "passed")
        self.assertEqual(manifest.component_eval_summary_object_key, component_eval_summary_key)

    def test_restore_snapshot_backup_restores_snapshot_and_writes_restore_report(self) -> None:
        object_store = _FakeBackupObjectStore()
        qdrant_admin = _FakeQdrantSnapshotAdmin()
        validation_summary_key = build_index_release_artifact_key(
            corpus="regulations",
            collection="student_rules",
            release_id="r20260331_120000",
            filename="validation-summary.json",
        )
        manifest_key = _seed_release_manifest(
            object_store=object_store,
            corpus="regulations",
            collection="student_rules",
            release_id="r20260331_120000",
            physical_collection_name="student_rules__r20260331_120000",
            previous_physical_collection_name="student_rules__r20260330_120000",
            serving_alias="student_rules",
            validation_summary_key=validation_summary_key,
        )
        snapshot_bytes = b"snapshot:student_rules__r20260331_120000"
        checksum = hashlib.sha256(snapshot_bytes).hexdigest()
        backup_manifest = SnapshotBackupManifest(
            backup_id="b20260401T010203Z",
            backup_mode="qdrant_collection_snapshot_export",
            captured_at="2026-04-01T01:02:03+00:00",
            corpus="regulations",
            collection="student_rules",
            release_id="r20260331_120000",
            serving_alias="student_rules",
            physical_collection_name="student_rules__r20260331_120000",
            alias_bindings={"student_rules": "student_rules__r20260331_120000"},
            index_release_manifest_key=manifest_key,
            validation_summary_key=validation_summary_key,
            snapshot_object_key=build_qdrant_backup_artifact_key(
                corpus="regulations",
                collection="student_rules",
                release_id="r20260331_120000",
                backup_id="b20260401T010203Z",
                filename="student_rules__r20260331_120000.snapshot",
            ),
            snapshot_sha256=checksum,
            backup_reason="pre-gc",
            operator="tester",
        )
        object_store.put_bytes(
            bucket=DERIVED_BUCKET,
            key=backup_manifest.snapshot_object_key,
            data=snapshot_bytes,
            content_type="application/octet-stream",
        )
        object_store.put_bytes(
            bucket=DERIVED_BUCKET,
            key=build_qdrant_backup_artifact_key(
                corpus="regulations",
                collection="student_rules",
                release_id="r20260331_120000",
                backup_id="b20260401T010203Z",
                filename="backup-manifest.json",
            ),
            data=(json.dumps(asdict(backup_manifest), ensure_ascii=False, indent=2) + "\n").encode(
                "utf-8"
            ),
            content_type="application/json",
        )
        qdrant_admin.points_count["student_rules__r20260331_120000"] = 20
        qdrant_admin.release_payload["student_rules__r20260331_120000"] = {
            "index_release_id": "r20260331_120000",
            "index_release_manifest_key": manifest_key,
            "index_release_alias": "student_rules",
        }

        report = restore_snapshot_backup(
            request=SnapshotRestoreRequest(
                corpus="regulations",
                collection="student_rules",
                release_id="r20260331_120000",
                backup_id="b20260401T010203Z",
                operator="tester",
                apply_alias=True,
            ),
            env={},
            object_store=object_store,
            qdrant_admin=qdrant_admin,
        )

        self.assertEqual(report.restored_collection_name, "student_rules__r20260331_120000")
        self.assertEqual(report.verification_status, "passed")
        self.assertEqual(
            qdrant_admin.applied_aliases,
            [{"student_rules": "student_rules__r20260331_120000"}],
        )
        self.assertEqual(qdrant_admin.restored_snapshots[0][2], checksum)
        restore_report_key = build_qdrant_backup_artifact_key(
            corpus="regulations",
            collection="student_rules",
            release_id="r20260331_120000",
            backup_id="b20260401T010203Z",
            filename="restore-report.json",
        )
        self.assertIn((DERIVED_BUCKET, restore_report_key), object_store.objects)

    def test_restore_snapshot_backup_fails_verification_when_points_count_mismatches(self) -> None:
        object_store = _FakeBackupObjectStore()
        qdrant_admin = _FakeQdrantSnapshotAdmin()
        validation_summary_key = build_index_release_artifact_key(
            corpus="regulations",
            collection="student_rules",
            release_id="r20260331_120000",
            filename="validation-summary.json",
        )
        manifest_key = _seed_release_manifest(
            object_store=object_store,
            corpus="regulations",
            collection="student_rules",
            release_id="r20260331_120000",
            physical_collection_name="student_rules__r20260331_120000",
            previous_physical_collection_name="student_rules__r20260330_120000",
            serving_alias="student_rules",
            validation_summary_key=validation_summary_key,
        )
        snapshot_bytes = b"snapshot:student_rules__r20260331_120000"
        checksum = hashlib.sha256(snapshot_bytes).hexdigest()
        backup_manifest = SnapshotBackupManifest(
            backup_id="b20260401T010203Z",
            backup_mode="qdrant_collection_snapshot_export",
            captured_at="2026-04-01T01:02:03+00:00",
            corpus="regulations",
            collection="student_rules",
            release_id="r20260331_120000",
            serving_alias="student_rules",
            physical_collection_name="student_rules__r20260331_120000",
            alias_bindings={"student_rules": "student_rules__r20260331_120000"},
            index_release_manifest_key=manifest_key,
            validation_summary_key=validation_summary_key,
            snapshot_object_key=build_qdrant_backup_artifact_key(
                corpus="regulations",
                collection="student_rules",
                release_id="r20260331_120000",
                backup_id="b20260401T010203Z",
                filename="student_rules__r20260331_120000.snapshot",
            ),
            snapshot_sha256=checksum,
            backup_reason="pre-gc",
            operator="tester",
        )
        object_store.put_bytes(
            bucket=DERIVED_BUCKET,
            key=backup_manifest.snapshot_object_key,
            data=snapshot_bytes,
            content_type="application/octet-stream",
        )
        object_store.put_bytes(
            bucket=DERIVED_BUCKET,
            key=build_qdrant_backup_artifact_key(
                corpus="regulations",
                collection="student_rules",
                release_id="r20260331_120000",
                backup_id="b20260401T010203Z",
                filename="backup-manifest.json",
            ),
            data=(json.dumps(asdict(backup_manifest), ensure_ascii=False, indent=2) + "\n").encode(
                "utf-8"
            ),
            content_type="application/json",
        )
        qdrant_admin.points_count["student_rules__r20260331_120000"] = 19
        qdrant_admin.release_payload["student_rules__r20260331_120000"] = {
            "index_release_id": "r20260331_120000",
            "index_release_manifest_key": manifest_key,
            "index_release_alias": "student_rules",
        }

        report = restore_snapshot_backup(
            request=SnapshotRestoreRequest(
                corpus="regulations",
                collection="student_rules",
                release_id="r20260331_120000",
                backup_id="b20260401T010203Z",
                operator="tester",
                apply_alias=True,
            ),
            env={},
            object_store=object_store,
            qdrant_admin=qdrant_admin,
        )

        self.assertEqual(report.verification_status, "failed")
        self.assertIn("points_count_mismatch", report.verification_errors)
        self.assertEqual(qdrant_admin.applied_aliases, [])

    def test_gc_check_blocks_archive_candidate_without_snapshot_bundle(self) -> None:
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
        qdrant_admin.collections.update(
            {
                "student_rules__r20260328_095627",
                "student_rules__r20260331_120000",
            }
        )

        report = check_snapshot_gc_eligibility(
            request=CollectionGcCheckRequest(
                corpus="regulations",
                collection="student_rules",
                release_id="r20260328_095627",
            ),
            env={},
            object_store=object_store,
            qdrant_admin=qdrant_admin,
        )

        self.assertFalse(report.eligible)
        self.assertEqual(report.role, "archive_candidate")
        self.assertIn("missing_snapshot_backup", report.blockers)

    def test_gc_check_allows_archive_candidate_with_snapshot_bundle(self) -> None:
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
        object_store.put_bytes(
            bucket=DERIVED_BUCKET,
            key=backup_manifest.snapshot_object_key,
            data=b"snapshot",
            content_type="application/octet-stream",
        )
        object_store.put_bytes(
            bucket=DERIVED_BUCKET,
            key=build_qdrant_backup_artifact_key(
                corpus="regulations",
                collection="student_rules",
                release_id="r20260328_095627",
                backup_id="b20260401T010203Z",
                filename="backup-manifest.json",
            ),
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

        report = check_snapshot_gc_eligibility(
            request=CollectionGcCheckRequest(
                corpus="regulations",
                collection="student_rules",
                release_id="r20260328_095627",
            ),
            env={},
            object_store=object_store,
            qdrant_admin=qdrant_admin,
        )

        self.assertTrue(report.eligible)
        self.assertEqual(report.blockers, ())
        self.assertEqual(report.role, "archive_candidate")

    def test_gc_check_allows_preview_candidate_without_snapshot_backup(self) -> None:
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

        report = check_snapshot_gc_eligibility(
            request=CollectionGcCheckRequest(
                corpus="regulations",
                collection="student_rules",
                release_id="r20260507_114855_751879_351c552d",
            ),
            env={},
            object_store=object_store,
            qdrant_admin=qdrant_admin,
        )

        self.assertTrue(report.eligible)
        self.assertEqual(report.role, "preview_candidate")
        self.assertEqual(report.blockers, ())
        self.assertIsNone(report.backup_manifest_object_key)


if __name__ == "__main__":
    unittest.main()
