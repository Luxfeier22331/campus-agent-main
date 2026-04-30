from __future__ import annotations

import hashlib
import json
import unittest
from dataclasses import asdict
from pathlib import Path

from campus_ingestion_core.object_store import (
    build_index_release_artifact_key,
    build_qdrant_backup_artifact_key,
)
from campus_ingestion_core.qdrant_backup import (
    CollectionGcCheckRequest,
    SnapshotBackupManifest,
    SnapshotBackupRequest,
    SnapshotRestoreRequest,
    _load_index_release_manifest,
    check_snapshot_gc_eligibility,
    create_snapshot_backup,
    restore_snapshot_backup,
)

DERIVED_BUCKET = "campus-rag-derived"


class _FakeBackupObjectStore:
    def __init__(self) -> None:
        self.objects: dict[tuple[str, str], bytes] = {}

    def get_bytes(self, *, bucket: str, key: str) -> bytes:
        return self.objects[(bucket, key)]

    def put_bytes(self, *, bucket: str, key: str, data: bytes, content_type: str) -> None:
        self.objects[(bucket, key)] = data

    def upload_file(self, *, bucket: str, key: str, file_path: str, content_type: str) -> None:
        self.objects[(bucket, key)] = Path(file_path).read_bytes()

    def download_file(self, *, bucket: str, key: str, file_path: str) -> None:
        Path(file_path).write_bytes(self.objects[(bucket, key)])

    def head_object(self, *, bucket: str, key: str) -> dict[str, object]:
        data = self.objects[(bucket, key)]
        return {"ContentLength": len(data)}

    def list_keys(self, *, bucket: str, prefix: str) -> tuple[str, ...]:
        return tuple(
            sorted(
                key
                for object_bucket, key in self.objects
                if object_bucket == bucket and key.startswith(prefix)
            )
        )


class _FakeQdrantSnapshotAdmin:
    def __init__(self) -> None:
        self.aliases: dict[str, str] = {}
        self.collections: set[str] = set()
        self.created_snapshots: list[tuple[str, str]] = []
        self.restored_snapshots: list[tuple[str, bytes, str | None]] = []
        self.applied_aliases: list[dict[str, str]] = []
        self.points_count: dict[str, int] = {}
        self.release_payload: dict[str, dict[str, object]] = {}

    def create_collection_snapshot(self, collection_name: str) -> str:
        snapshot_name = f"{collection_name}-snapshot-001.snapshot"
        self.created_snapshots.append((collection_name, snapshot_name))
        return snapshot_name

    def download_collection_snapshot(
        self,
        *,
        collection_name: str,
        snapshot_name: str,
        target_path: str,
    ) -> None:
        Path(target_path).write_bytes(f"snapshot:{collection_name}:{snapshot_name}".encode())

    def restore_collection_snapshot(
        self,
        *,
        collection_name: str,
        snapshot_path: str,
        checksum: str | None,
    ) -> None:
        snapshot_bytes = Path(snapshot_path).read_bytes()
        self.collections.add(collection_name)
        self.restored_snapshots.append((collection_name, snapshot_bytes, checksum))

    def resolve_alias_target(self, alias_name: str) -> str | None:
        return self.aliases.get(alias_name)

    def apply_alias_bindings(self, alias_bindings: dict[str, str]) -> None:
        self.aliases.update(alias_bindings)
        self.applied_aliases.append(dict(alias_bindings))

    def list_collections(self) -> tuple[str, ...]:
        return tuple(sorted(self.collections))

    def get_collection_points_count(self, collection_name: str) -> int | None:
        return self.points_count.get(collection_name)

    def get_release_payload(self, collection_name: str) -> dict[str, object]:
        return dict(self.release_payload.get(collection_name) or {})


def _seed_release_manifest(
    *,
    object_store: _FakeBackupObjectStore,
    corpus: str,
    collection: str,
    release_id: str,
    physical_collection_name: str,
    previous_physical_collection_name: str | None,
    serving_alias: str,
    validation_summary_key: str | None = None,
    post_publish_audit_status: str = "",
    post_publish_audit_summary_key: str | None = None,
) -> str:
    manifest_key = build_index_release_artifact_key(
        corpus=corpus,
        collection=collection,
        release_id=release_id,
        filename="index-release.json",
    )
    payload = {
        "release_id": release_id,
        "corpus": corpus,
        "collection": collection,
        "serving_alias": serving_alias,
        "physical_collection_name": physical_collection_name,
        "previous_physical_collection_name": previous_physical_collection_name,
        "cleaning_policy_version": "student-handbook-cleaning-v1",
        "chunk_policy_version": "student-handbook-semantic-v1",
        "embedding_model": "Qwen3-Embedding-4B",
        "indexed_at": "2026-03-31T12:00:00+00:00",
        "published_at": "2026-03-31T12:05:00+00:00",
        "document_count": 2,
        "point_count": 20,
        "document_version_ids_hash": "doc-hash",
        "document_units_keys_hash": "units-hash",
        "validation_status": "passed",
        "validation_summary_object_key": validation_summary_key,
        "post_publish_audit_status": post_publish_audit_status,
        "post_publish_audit_summary_object_key": post_publish_audit_summary_key,
        "documents": [],
    }
    object_store.put_bytes(
        bucket=DERIVED_BUCKET,
        key=manifest_key,
        data=(json.dumps(payload, ensure_ascii=False, indent=2) + "\n").encode("utf-8"),
        content_type="application/json",
    )
    if validation_summary_key is not None:
        object_store.put_bytes(
            bucket=DERIVED_BUCKET,
            key=validation_summary_key,
            data=b'{"status":"passed"}\n',
            content_type="application/json",
        )
    return manifest_key


class QdrantBackupTest(unittest.TestCase):
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


if __name__ == "__main__":
    unittest.main()
