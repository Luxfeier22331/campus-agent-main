from __future__ import annotations

import json
import unittest
from dataclasses import asdict
from pathlib import Path
from tempfile import TemporaryDirectory

from campus_ingestion_core.object_store import build_qdrant_backup_artifact_key
from campus_ingestion_core.qdrant_backup_models import SnapshotBackupManifest
from campus_ingestion_core.qdrant_backup_retention_audit import (
    QdrantBackupRetentionAuditRequest,
    audit_qdrant_backup_retention,
)

from tests.ingestion.test_qdrant_backup_support import (
    DERIVED_BUCKET,
    _FakeBackupObjectStore,
    _FakeQdrantSnapshotAdmin,
    _seed_release_manifest,
)


class QdrantBackupRetentionAuditTest(unittest.TestCase):
    def test_audit_classifies_current_previous_archive_and_orphan_backup_manifests(self) -> None:
        object_store = _FakeBackupObjectStore()
        qdrant_admin = _FakeQdrantSnapshotAdmin()
        _seed_release_manifest(
            object_store=object_store,
            corpus="regulations",
            collection="student_rules",
            release_id="r20260328_095627",
            physical_collection_name="student_rules__r20260328_095627",
            previous_physical_collection_name=None,
            serving_alias="student_rules",
            validation_summary_key="regulations/releases/student_rules/r20260328_095627/validation-summary.json",
        )
        _seed_release_manifest(
            object_store=object_store,
            corpus="regulations",
            collection="student_rules",
            release_id="r20260331_120000",
            physical_collection_name="student_rules__r20260331_120000",
            previous_physical_collection_name="student_rules__r20260328_095627",
            serving_alias="student_rules",
            validation_summary_key="regulations/releases/student_rules/r20260331_120000/validation-summary.json",
        )
        qdrant_admin.aliases["student_rules"] = "student_rules__r20260331_120000"
        qdrant_admin.collections.update(
            {
                "student_rules__r20260328_095627",
                "student_rules__r20260331_120000",
            }
        )
        _put_backup_manifest(
            object_store=object_store,
            release_id="r20260328_095627",
            backup_id="b20260401T010203Z",
            physical_collection_name="student_rules__r20260328_095627",
        )
        _put_backup_manifest(
            object_store=object_store,
            release_id="r20260331_120000",
            backup_id="b20260402T010203Z",
            physical_collection_name="student_rules__r20260331_120000",
        )
        _put_backup_manifest(
            object_store=object_store,
            release_id="r20260201_000000",
            backup_id="b20260403T010203Z",
            physical_collection_name="student_rules__r20260201_000000",
        )

        with TemporaryDirectory() as temp_dir:
            output_dir = Path(temp_dir)
            summary = audit_qdrant_backup_retention(
                request=QdrantBackupRetentionAuditRequest(
                    corpus="regulations",
                    collection="student_rules",
                    output_dir=output_dir,
                ),
                env={},
                object_store=object_store,
                qdrant_admin=qdrant_admin,
            )
            rows = [
                json.loads(line)
                for line in (output_dir / "backup-retention-inventory.jsonl")
                .read_text(encoding="utf-8")
                .splitlines()
                if line.strip()
            ]

        by_release = {row["release_id"]: row for row in rows}
        self.assertEqual(summary["backup_manifest_count"], 3)
        self.assertEqual(summary["orphan_backup_manifest_count"], 1)
        self.assertEqual(by_release["r20260331_120000"]["role"], "current")
        self.assertEqual(by_release["r20260328_095627"]["role"], "previous")
        self.assertEqual(by_release["r20260201_000000"]["role"], "orphan_backup_manifest")
        self.assertIn("missing_release_manifest", by_release["r20260201_000000"]["blockers"])


def _put_backup_manifest(
    *,
    object_store: _FakeBackupObjectStore,
    release_id: str,
    backup_id: str,
    physical_collection_name: str,
) -> None:
    snapshot_key = build_qdrant_backup_artifact_key(
        corpus="regulations",
        collection="student_rules",
        release_id=release_id,
        backup_id=backup_id,
        filename=f"{physical_collection_name}.snapshot",
    )
    manifest = SnapshotBackupManifest(
        backup_id=backup_id,
        backup_mode="qdrant_collection_snapshot_export",
        captured_at="2026-04-01T01:02:03+00:00",
        corpus="regulations",
        collection="student_rules",
        release_id=release_id,
        serving_alias="student_rules",
        physical_collection_name=physical_collection_name,
        alias_bindings={"student_rules": physical_collection_name},
        index_release_manifest_key=(
            f"regulations/releases/student_rules/{release_id}/index-release.json"
        ),
        validation_summary_key=f"regulations/releases/student_rules/{release_id}/validation-summary.json",
        snapshot_object_key=snapshot_key,
        snapshot_sha256="0" * 64,
        backup_reason="audit-test",
        operator="tester",
    )
    object_store.put_bytes(
        bucket=DERIVED_BUCKET,
        key=snapshot_key,
        data=b"snapshot",
        content_type="application/octet-stream",
    )
    object_store.put_bytes(
        bucket=DERIVED_BUCKET,
        key=build_qdrant_backup_artifact_key(
            corpus="regulations",
            collection="student_rules",
            release_id=release_id,
            backup_id=backup_id,
            filename="backup-manifest.json",
        ),
        data=(json.dumps(asdict(manifest), ensure_ascii=False, indent=2) + "\n").encode("utf-8"),
        content_type="application/json",
    )


if __name__ == "__main__":
    unittest.main()
