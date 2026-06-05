from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace

from campus_ingestion_core.index_release import load_index_release_manifest
from campus_ingestion_worker.reconstruct_rag_release_manifests import (
    reconstruct_release_manifests,
)


class MemoryObjectStore:
    def __init__(self) -> None:
        self.objects: dict[tuple[str, str], bytes] = {}

    def put_bytes(self, *, bucket: str, key: str, data: bytes, content_type: str) -> None:
        self.objects[(bucket, key)] = data
        self.last_content_type = content_type

    def get_bytes(self, *, bucket: str, key: str) -> bytes:
        return self.objects[(bucket, key)]


class FakeQdrantClient:
    def __init__(
        self,
        *,
        alias_target: str | None = "student_rules__r1",
        points_count: int = 2,
        payloads: tuple[dict[str, object], ...] | None = None,
    ) -> None:
        self.alias_target = alias_target
        self.points_count = points_count
        self.payloads = payloads or (_payload("doc-a", "v1"), _payload("doc-b", "v2"))

    def get_aliases(self):
        aliases = []
        if self.alias_target is not None:
            aliases.append(
                SimpleNamespace(alias_name="student_rules", collection_name=self.alias_target)
            )
        return SimpleNamespace(aliases=aliases)

    def get_collection(self, *, collection_name: str):
        return SimpleNamespace(points_count=self.points_count)

    def scroll(self, *, collection_name: str, limit: int, with_payload: bool, with_vectors: bool):
        return [SimpleNamespace(payload=payload) for payload in self.payloads[:limit]], None


def _payload(document_id: str, version_id: str, **overrides: object) -> dict[str, object]:
    payload: dict[str, object] = {
        "index_release_id": "r1",
        "index_release_manifest_key": "regulations/releases/student_rules/r1/index-release.json",
        "index_release_alias": "student_rules",
        "index_physical_collection_name": "student_rules__r1",
        "chunk_policy_version": "handbook-v3",
        "cleaning_policy_version": "clean-v1",
        "index_validation_status": "passed",
        "embedding_provider": "openai-compatible",
        "embedding_model": "text-embedding-3-small",
        "embedding_dimensions": 1536,
        "document_id": document_id,
        "revision_track": "current",
        "version_id": version_id,
        "document_units_object_key": f"regulations/documents/student_rules/{document_id}/current/{version_id}/document-units.json",
        "document_units_sha256": f"sha-{document_id}",
        "retrieval_acceptance_status": "passed",
        "quality_gate_status": "passed",
        "chunk_quality_status": "passed",
        "qrels_coverage_status": "passed",
        "release_metadata_consistency_status": "passed",
    }
    payload.update(overrides)
    return payload


def _write_snapshot_manifest(
    root: Path, *, physical_collection_name: str = "student_rules__r1", point_count: int = 2
) -> Path:
    path = root / "regulations" / "student_rules" / "r1" / "b1" / "backup-manifest.json"
    path.parent.mkdir(parents=True)
    path.write_text(
        json.dumps(
            {
                "schema_version": "qdrant_filesystem_snapshot_backup.v1",
                "backup_id": "b1",
                "captured_at": "2026-06-01T00:00:00Z",
                "corpus": "regulations",
                "collection": "student_rules",
                "release_id": "r1",
                "serving_alias": "student_rules",
                "physical_collection_name": physical_collection_name,
                "index_release_manifest_key": "regulations/releases/student_rules/r1/index-release.json",
                "point_count": point_count,
            }
        ),
        encoding="utf-8",
    )
    return path


class ReconstructRagReleaseManifestsTests(unittest.TestCase):
    def test_dry_run_writes_report_without_object_put(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir) / "snapshots"
            _write_snapshot_manifest(root)
            store = MemoryObjectStore()
            report = reconstruct_release_manifests(
                scopes=("regulations/student_rules",),
                backup_root=root,
                report_path=Path(temp_dir) / "report.json",
                write=False,
                qdrant_client=FakeQdrantClient(),
                object_store=store,
                bucket="derived",
            )
        self.assertEqual(report["mode"], "dry_run")
        self.assertEqual(store.objects, {})
        self.assertEqual(
            report["surfaces"][0]["manifest_object_key"],
            "regulations/releases/student_rules/r1/index-release.json",
        )

    def test_write_uploads_exact_manifest_and_loader_accepts_it(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir) / "snapshots"
            _write_snapshot_manifest(root)
            store = MemoryObjectStore()
            reconstruct_release_manifests(
                scopes=("regulations/student_rules",),
                backup_root=root,
                report_path=Path(temp_dir) / "report.json",
                write=True,
                qdrant_client=FakeQdrantClient(),
                object_store=store,
                bucket="derived",
            )
            key = "regulations/releases/student_rules/r1/index-release.json"
            manifest = load_index_release_manifest(
                reader=store,
                bucket="derived",
                corpus="regulations",
                collection="student_rules",
                release_id="r1",
            )
        self.assertIn(("derived", key), store.objects)
        self.assertEqual(manifest.release_id, "r1")
        self.assertEqual(manifest.document_count, 2)
        self.assertNotEqual(
            manifest.document_version_ids_hash, "reconstructed-from-live-qdrant-payload"
        )

    def test_snapshot_physical_collection_mismatch_fails(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir) / "snapshots"
            _write_snapshot_manifest(root, physical_collection_name="other")
            with self.assertRaisesRegex(ValueError, "snapshot_manifest_match_count"):
                reconstruct_release_manifests(
                    scopes=("regulations/student_rules",),
                    backup_root=root,
                    report_path=Path(temp_dir) / "report.json",
                    write=False,
                    qdrant_client=FakeQdrantClient(),
                    object_store=MemoryObjectStore(),
                    bucket="derived",
                )

    def test_payload_metadata_mismatch_fails(self) -> None:
        payloads = (_payload("doc-a", "v1"), _payload("doc-b", "v2", embedding_model="different"))
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir) / "snapshots"
            _write_snapshot_manifest(root)
            with self.assertRaisesRegex(ValueError, "payload_metadata_mismatch"):
                reconstruct_release_manifests(
                    scopes=("regulations/student_rules",),
                    backup_root=root,
                    report_path=Path(temp_dir) / "report.json",
                    write=False,
                    qdrant_client=FakeQdrantClient(payloads=payloads),
                    object_store=MemoryObjectStore(),
                    bucket="derived",
                )

    def test_missing_snapshot_manifest_fails(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir) / "snapshots"
            root.mkdir()
            with self.assertRaisesRegex(ValueError, "missing_snapshot_manifest"):
                reconstruct_release_manifests(
                    scopes=("regulations/student_rules",),
                    backup_root=root,
                    report_path=Path(temp_dir) / "report.json",
                    write=False,
                    qdrant_client=FakeQdrantClient(),
                    object_store=MemoryObjectStore(),
                    bucket="derived",
                )

    def test_empty_collection_fails(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir) / "snapshots"
            _write_snapshot_manifest(root, point_count=0)
            with self.assertRaisesRegex(ValueError, "collection_empty"):
                reconstruct_release_manifests(
                    scopes=("regulations/student_rules",),
                    backup_root=root,
                    report_path=Path(temp_dir) / "report.json",
                    write=False,
                    qdrant_client=FakeQdrantClient(points_count=0),
                    object_store=MemoryObjectStore(),
                    bucket="derived",
                )


if __name__ == "__main__":
    unittest.main()
