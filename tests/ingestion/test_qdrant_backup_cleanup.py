from __future__ import annotations

import json
import unittest
from dataclasses import asdict
from pathlib import Path
from tempfile import TemporaryDirectory

from campus_ingestion_core.object_store import build_qdrant_backup_artifact_key
from campus_ingestion_core.qdrant_backup_cleanup import (
    QdrantBackupCleanupPlanRequest,
    build_qdrant_backup_cleanup_plan,
    execute_qdrant_backup_cleanup_plan,
)
from campus_ingestion_core.qdrant_backup_models import SnapshotBackupManifest

from tests.ingestion.test_qdrant_backup_support import (
    DERIVED_BUCKET,
    _FakeBackupObjectStore,
    _FakeQdrantSnapshotAdmin,
    _seed_release_manifest,
)


class QdrantBackupCleanupTest(unittest.TestCase):
    def test_plan_marks_obsolete_family_and_archive_backups_without_prefix_delete(self) -> None:
        object_store = _FakeBackupObjectStore()
        qdrant_admin = _FakeQdrantSnapshotAdmin()
        _seed_release_manifest(
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
        current_keys = _put_backup_manifest(
            object_store=object_store,
            corpus="regulations",
            collection="student_rules",
            release_id="r20260513",
            backup_id="b20260513T010203Z",
            serving_alias="student_rules",
            physical_collection_name="student_rules__r20260513",
        )
        old_keys = _put_backup_manifest(
            object_store=object_store,
            corpus="regulations",
            collection="student_rules",
            release_id="r20260422",
            backup_id="b20260507T151642Z",
            serving_alias="student_rules",
            physical_collection_name="student_rules__r20260422",
        )
        obsolete_keys = _put_backup_manifest(
            object_store=object_store,
            corpus="regulations",
            collection="student_handbook",
            release_id="r20260330",
            backup_id="b20260331T175856Z",
            serving_alias="student_handbook",
            physical_collection_name="student_handbook__r20260330",
        )

        with TemporaryDirectory() as temp_dir:
            report = build_qdrant_backup_cleanup_plan(
                request=QdrantBackupCleanupPlanRequest(
                    output_dir=Path(temp_dir),
                    current_aliases={"student_rules": "student_rules__r20260513"},
                    obsolete_families=("regulations/student_handbook",),
                ),
                env={},
                object_store=object_store,
                qdrant_admin=qdrant_admin,
            )
            plan = json.loads(Path(report.deletion_plan_path).read_text(encoding="utf-8"))

        delete_keys = {row["key"] for row in plan["delete_candidates"]}
        retained_keys = {row["key"] for row in plan["retained_objects"]}
        self.assertEqual(delete_keys, set(old_keys + obsolete_keys))
        self.assertEqual(retained_keys, set(current_keys))
        self.assertEqual(plan["delete_candidate_count"], 4)
        self.assertEqual(
            plan["delete_candidate_bytes"],
            sum(
                len(object_store.objects[(DERIVED_BUCKET, key)]) for key in old_keys + obsolete_keys
            ),
        )
        self.assertTrue(
            all(row["delete_mode"] == "exact_object" for row in plan["delete_candidates"])
        )
        self.assertIn(
            "obsolete_family",
            {row["reason"] for row in plan["delete_candidates"]},
        )

    def test_execute_deletes_only_exact_plan_keys(self) -> None:
        object_store = _FakeBackupObjectStore()
        delete_keys = _put_backup_manifest(
            object_store=object_store,
            corpus="curriculum",
            collection="curriculum_plan",
            release_id="r20260328",
            backup_id="b20260331T175326Z",
            serving_alias="curriculum_plan",
            physical_collection_name="curriculum_plan__r20260328",
        )
        retained_key = "curriculum/backups/curriculum_plan/r20260504/b/current.snapshot"
        object_store.put_bytes(
            bucket=DERIVED_BUCKET,
            key=retained_key,
            data=b"retain",
            content_type="application/octet-stream",
        )
        plan = {
            "schema_version": "qdrant_backup_cleanup_plan.v1",
            "bucket": DERIVED_BUCKET,
            "delete_candidates": [
                {
                    "bucket": DERIVED_BUCKET,
                    "key": key,
                    "size_bytes": 12,
                    "delete_mode": "exact_object",
                }
                for key in delete_keys
            ],
        }

        with TemporaryDirectory() as temp_dir:
            plan_path = Path(temp_dir) / "deletion-plan.json"
            plan_path.write_text(json.dumps(plan), encoding="utf-8")
            report = execute_qdrant_backup_cleanup_plan(
                plan_path=plan_path,
                object_store=object_store,
                output_dir=Path(temp_dir),
            )

        self.assertEqual(
            set(object_store.deleted_objects),
            {(DERIVED_BUCKET, key) for key in delete_keys},
        )
        self.assertIn((DERIVED_BUCKET, retained_key), object_store.objects)
        self.assertEqual(report.deleted_count, 2)

    def test_plan_rejects_snapshot_without_valid_backup_manifest(self) -> None:
        object_store = _FakeBackupObjectStore()
        qdrant_admin = _FakeQdrantSnapshotAdmin()
        snapshot_key = (
            "regulations/backups/student_rules/r20260422/"
            "b20260507T151642Z/student_rules__r20260422.snapshot"
        )
        object_store.put_bytes(
            bucket=DERIVED_BUCKET,
            key=snapshot_key,
            data=b"orphan snapshot",
            content_type="application/octet-stream",
        )

        with (
            TemporaryDirectory() as temp_dir,
            self.assertRaisesRegex(ValueError, "missing backup-manifest.json"),
        ):
            build_qdrant_backup_cleanup_plan(
                request=QdrantBackupCleanupPlanRequest(
                    output_dir=Path(temp_dir),
                    current_aliases={"student_rules": "student_rules__r20260513"},
                ),
                env={},
                object_store=object_store,
                qdrant_admin=qdrant_admin,
            )


def _put_backup_manifest(
    *,
    object_store: _FakeBackupObjectStore,
    corpus: str,
    collection: str,
    release_id: str,
    backup_id: str,
    serving_alias: str,
    physical_collection_name: str,
) -> tuple[str, str]:
    snapshot_key = build_qdrant_backup_artifact_key(
        corpus=corpus,
        collection=collection,
        release_id=release_id,
        backup_id=backup_id,
        filename=f"{physical_collection_name}.snapshot",
    )
    manifest_key = build_qdrant_backup_artifact_key(
        corpus=corpus,
        collection=collection,
        release_id=release_id,
        backup_id=backup_id,
        filename="backup-manifest.json",
    )
    manifest = SnapshotBackupManifest(
        backup_id=backup_id,
        backup_mode="qdrant_collection_snapshot_export",
        captured_at="2026-05-13T01:02:03+00:00",
        corpus=corpus,
        collection=collection,
        release_id=release_id,
        serving_alias=serving_alias,
        physical_collection_name=physical_collection_name,
        alias_bindings={serving_alias: physical_collection_name},
        index_release_manifest_key=f"{corpus}/releases/{collection}/{release_id}/index-release.json",
        validation_summary_key=f"{corpus}/releases/{collection}/{release_id}/validation.json",
        snapshot_object_key=snapshot_key,
        snapshot_sha256="1" * 64,
        backup_reason="test",
        operator="tester",
    )
    object_store.put_bytes(
        bucket=DERIVED_BUCKET,
        key=snapshot_key,
        data=b"snapshotdata",
        content_type="application/octet-stream",
    )
    object_store.put_bytes(
        bucket=DERIVED_BUCKET,
        key=manifest_key,
        data=(json.dumps(asdict(manifest), ensure_ascii=False) + "\n").encode("utf-8"),
        content_type="application/json",
    )
    return snapshot_key, manifest_key


if __name__ == "__main__":
    unittest.main()
