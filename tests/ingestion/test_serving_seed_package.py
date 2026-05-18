from __future__ import annotations

import json
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

from campus_ingestion_core.serving_seed_package import (
    ServingSeedExportRequest,
    ServingSeedRestoreRequest,
    ServingSeedVerifyRequest,
    export_serving_seed_manifest,
    restore_serving_seed_manifest,
    verify_serving_seed_manifest,
)


class FakeSeedObjectStore:
    def __init__(self, objects: dict[tuple[str, str], tuple[bytes, str]]) -> None:
        self.objects = dict(objects)
        self.writes: dict[tuple[str, str], tuple[bytes, str]] = {}

    def get_bytes(self, *, bucket: str, key: str) -> bytes:
        try:
            return self.objects[(bucket, key)][0]
        except KeyError as exc:
            raise FileNotFoundError(key) from exc

    def put_bytes(self, *, bucket: str, key: str, data: bytes, content_type: str) -> None:
        self.writes[(bucket, key)] = (data, content_type)

    def head_object(self, *, bucket: str, key: str) -> dict[str, object]:
        try:
            data, content_type = self.objects[(bucket, key)]
        except KeyError as exc:
            raise FileNotFoundError(key) from exc
        return {"content_length": len(data), "content_type": content_type}


class ServingSeedPackageTest(unittest.TestCase):
    def test_export_manifest_collects_docs_reader_objects_with_sha256(self) -> None:
        manifest = _docs_manifest()
        reader_payload = b'{"sections":[]}'
        objects = {
            (
                "campus-rag-derived",
                "public_docs/releases/reader_assets/current/public-docs-reader-assets.json",
            ): (
                json.dumps(manifest, ensure_ascii=False).encode("utf-8"),
                "application/json",
            ),
            ("campus-rag-derived", "curriculum/documents/doc/reader-assets/reader.json"): (
                reader_payload,
                "application/json",
            ),
            ("campus-rag-derived", "curriculum/documents/doc/reader-assets/meta.json"): (
                b'{"title":"doc"}',
                "application/json",
            ),
        }

        report = export_serving_seed_manifest(
            request=ServingSeedExportRequest(
                manifest_object_keys=(
                    "public_docs/releases/reader_assets/current/public-docs-reader-assets.json",
                ),
                output_path=None,
            ),
            bucket_derived="campus-rag-derived",
            generated_at="2026-05-19T10:00:00+08:00",
            object_store=FakeSeedObjectStore(objects),
            repo_revision="test-revision",
        )

        self.assertEqual(report.object_count, 3)
        self.assertEqual(report.total_size_bytes, sum(len(data) for data, _ in objects.values()))
        keys = [row["key"] for row in report.manifest["objects"]]
        self.assertEqual(
            keys,
            [
                "curriculum/documents/doc/reader-assets/meta.json",
                "curriculum/documents/doc/reader-assets/reader.json",
                "public_docs/releases/reader_assets/current/public-docs-reader-assets.json",
            ],
        )
        reader_row = next(
            row for row in report.manifest["objects"] if row["key"].endswith("reader.json")
        )
        self.assertEqual(
            reader_row["sha256"],
            "777b5863d801327b008f5610aa3eb3a4fb47554f056e0961b393075db17a4274",
        )
        self.assertEqual(report.manifest["seedProfile"], "serving-seed")
        self.assertEqual(report.manifest["repoRevision"], "test-revision")

    def test_verify_manifest_rejects_sha256_mismatch(self) -> None:
        manifest = _seed_manifest(
            objects=[
                {
                    "bucket": "campus-rag-derived",
                    "key": "reader.json",
                    "sizeBytes": 2,
                    "sha256": "0" * 64,
                    "contentType": "application/json",
                    "role": "reader_asset",
                }
            ]
        )

        with self.assertRaisesRegex(ValueError, "sha256 mismatch"):
            verify_serving_seed_manifest(
                request=ServingSeedVerifyRequest(manifest_path=None, manifest=manifest),
                object_store=FakeSeedObjectStore(
                    {("campus-rag-derived", "reader.json"): (b"{}", "application/json")}
                ),
            )

    def test_restore_manifest_copies_all_declared_objects(self) -> None:
        manifest = _seed_manifest(
            objects=[
                {
                    "bucket": "campus-rag-derived",
                    "key": "reader.json",
                    "sizeBytes": 2,
                    "sha256": "44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a",
                    "contentType": "application/json",
                    "role": "reader_asset",
                }
            ]
        )
        source = FakeSeedObjectStore(
            {("campus-rag-derived", "reader.json"): (b"{}", "application/json")}
        )
        target = FakeSeedObjectStore({})

        report = restore_serving_seed_manifest(
            request=ServingSeedRestoreRequest(manifest_path=None, manifest=manifest),
            source_object_store=source,
            target_object_store=target,
        )

        self.assertEqual(report.restored_count, 1)
        self.assertEqual(
            target.writes[("campus-rag-derived", "reader.json")],
            (b"{}", "application/json"),
        )

    def test_export_writes_manifest_file_when_output_path_is_set(self) -> None:
        with TemporaryDirectory() as temp_dir:
            output_path = Path(temp_dir) / "serving-seed.json"
            report = export_serving_seed_manifest(
                request=ServingSeedExportRequest(
                    manifest_object_keys=(
                        "public_docs/releases/reader_assets/current/public-docs-reader-assets.json",
                    ),
                    output_path=output_path,
                ),
                bucket_derived="campus-rag-derived",
                generated_at="2026-05-19T10:00:00+08:00",
                object_store=FakeSeedObjectStore(
                    {
                        (
                            "campus-rag-derived",
                            "public_docs/releases/reader_assets/current/public-docs-reader-assets.json",
                        ): (json.dumps(_docs_manifest()).encode("utf-8"), "application/json"),
                        (
                            "campus-rag-derived",
                            "curriculum/documents/doc/reader-assets/reader.json",
                        ): (b"{}", "application/json"),
                        (
                            "campus-rag-derived",
                            "curriculum/documents/doc/reader-assets/meta.json",
                        ): (b"{}", "application/json"),
                    }
                ),
                repo_revision="test-revision",
            )

            self.assertEqual(json.loads(output_path.read_text(encoding="utf-8")), report.manifest)


def _docs_manifest() -> dict[str, object]:
    return {
        "schemaVersion": "document_reader_publish_manifest_v1",
        "publicDocsSyncManifest": {
            "entries": [
                {
                    "sourceObjects": {
                        "reader": "curriculum/documents/doc/reader-assets/reader.json",
                        "meta": "curriculum/documents/doc/reader-assets/meta.json",
                    }
                }
            ]
        },
    }


def _seed_manifest(*, objects: list[dict[str, object]]) -> dict[str, object]:
    return {
        "schemaVersion": "campus_serving_seed_manifest_v1",
        "seedProfile": "serving-seed",
        "generatedAt": "2026-05-19T10:00:00+08:00",
        "repoRevision": "test",
        "objects": objects,
    }


if __name__ == "__main__":
    unittest.main()
