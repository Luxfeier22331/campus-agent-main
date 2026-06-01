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

    def test_gc_check_blocks_archive_candidate_without_native_snapshot_bundle(self) -> None:
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
                backup_root=Path("/srv/backups/campus-agent/qdrant-snapshots"),
            ),
            env={},
            object_store=object_store,
            qdrant_admin=qdrant_admin,
        )

        self.assertFalse(report.eligible)
        self.assertEqual(report.role, "archive_candidate")
        self.assertIn("missing_native_snapshot_backup", report.blockers)

    def test_gc_check_allows_archive_candidate_with_native_snapshot_bundle(self) -> None:
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
        object_store.put_bytes(
            bucket=DERIVED_BUCKET,
            key=validation_summary_key,
            data=b"{}",
            content_type="application/json",
        )
        qdrant_admin.aliases["student_rules"] = "student_rules__r20260331_120000"
        qdrant_admin.collections.update(
            {
                "student_rules__r20260328_095627",
                "student_rules__r20260331_120000",
            }
        )

        with TemporaryDirectory() as temp_dir:
            backup_manifest_path = _write_native_snapshot_bundle(
                backup_root=Path(temp_dir),
                corpus="regulations",
                collection="student_rules",
                release_id="r20260328_095627",
                backup_id="b20260401T010203Z",
                serving_alias="student_rules",
                physical_collection_name="student_rules__r20260328_095627",
                manifest_key=manifest_key,
                validation_summary_key=validation_summary_key,
            )
            report = check_snapshot_gc_eligibility(
                request=CollectionGcCheckRequest(
                    corpus="regulations",
                    collection="student_rules",
                    release_id="r20260328_095627",
                    backup_root=Path(temp_dir),
                ),
                env={},
                object_store=object_store,
                qdrant_admin=qdrant_admin,
            )

        self.assertTrue(report.eligible)
        self.assertEqual(report.blockers, ())
        self.assertEqual(report.role, "archive_candidate")
        self.assertEqual(report.backup_manifest_path, str(backup_manifest_path))

    def test_gc_check_fails_closed_when_validation_summary_head_fails(self) -> None:
        object_store = _FakeBackupObjectStore()
        qdrant_admin = _FakeQdrantSnapshotAdmin()
        validation_summary_key = build_index_release_artifact_key(
            corpus="regulations",
            collection="student_rules",
            release_id="r20260328_095627",
            filename="validation-summary.json",
        )
        _seed_release_manifest(
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
        object_store.fail_head_keys.add((DERIVED_BUCKET, validation_summary_key))
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
        self.assertIn("validation_summary_probe_failed", report.blockers)
        self.assertNotIn("missing_validation_summary", report.blockers)

    def test_gc_check_fails_closed_when_native_snapshot_checksum_mismatches(self) -> None:
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
        object_store.put_bytes(
            bucket=DERIVED_BUCKET,
            key=validation_summary_key,
            data=b"{}",
            content_type="application/json",
        )
        qdrant_admin.aliases["student_rules"] = "student_rules__r20260331_120000"
        qdrant_admin.collections.update(
            {
                "student_rules__r20260328_095627",
                "student_rules__r20260331_120000",
            }
        )

        with TemporaryDirectory() as temp_dir:
            backup_manifest_path = _write_native_snapshot_bundle(
                backup_root=Path(temp_dir),
                corpus="regulations",
                collection="student_rules",
                release_id="r20260328_095627",
                backup_id="b20260401T010203Z",
                serving_alias="student_rules",
                physical_collection_name="student_rules__r20260328_095627",
                manifest_key=manifest_key,
                validation_summary_key=validation_summary_key,
            )
            manifest_payload = json.loads(backup_manifest_path.read_text(encoding="utf-8"))
            manifest_payload["snapshot_sha256"] = "0" * 64
            backup_manifest_path.write_text(
                json.dumps(manifest_payload, ensure_ascii=False, indent=2) + "\n",
                encoding="utf-8",
            )
            report = check_snapshot_gc_eligibility(
                request=CollectionGcCheckRequest(
                    corpus="regulations",
                    collection="student_rules",
                    release_id="r20260328_095627",
                    backup_root=Path(temp_dir),
                ),
                env={},
                object_store=object_store,
                qdrant_admin=qdrant_admin,
            )

        self.assertFalse(report.eligible)
        self.assertIn("native_snapshot_sha256_mismatch", report.blockers)
        self.assertIsNone(report.backup_manifest_path)

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
        self.assertIsNone(report.backup_manifest_path)


if __name__ == "__main__":
    unittest.main()
