from __future__ import annotations

from pathlib import Path
from tempfile import TemporaryDirectory
import unittest

from campus_ingestion_core.local_rebuild import rebuild_local_data


class _FakeObjectStoreAdmin:
    def __init__(self) -> None:
        self.cleared_prefixes: list[tuple[str, str]] = []

    def delete_prefix(self, *, bucket: str, prefix: str) -> None:
        self.cleared_prefixes.append((bucket, prefix))


class _FakeQdrantAdmin:
    def __init__(self) -> None:
        self.reset_collections: list[str] = []

    def reset_collection(self, collection_name: str) -> None:
        self.reset_collections.append(collection_name)


class _FakeDocumentRegistry:
    def __init__(self) -> None:
        self.deleted_corpora: list[str] = []

    def delete_by_corpus(self, corpus: str) -> None:
        self.deleted_corpora.append(corpus)


class _FakeRawAssetRegistry:
    def __init__(self) -> None:
        self.deleted_corpora: list[str] = []

    def delete_by_corpus(self, corpus: str) -> None:
        self.deleted_corpora.append(corpus)


class RebuildLocalDataTest(unittest.TestCase):
    def test_rebuild_clears_minio_and_registry_without_touching_qdrant_by_default(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            document_registry_path = root / "registry" / "student_handbook_documents.json"
            raw_asset_registry_path = root / "registry" / "student_handbook_raw_assets.json"
            document_registry_path.parent.mkdir(parents=True, exist_ok=True)
            document_registry_path.write_text('{"stale": true}', encoding="utf-8")
            raw_asset_registry_path.write_text('{"stale": true}', encoding="utf-8")
            object_store = _FakeObjectStoreAdmin()
            qdrant = _FakeQdrantAdmin()
            calls: list[dict[str, str]] = []

            report = rebuild_local_data(
                env={
                    "OBJECT_STORE_ENDPOINT": "http://localhost:9000",
                    "OBJECT_STORE_ACCESS_KEY": "minioadmin",
                    "OBJECT_STORE_SECRET_KEY": "minioadmin",
                    "OBJECT_STORE_BUCKET_RAW": "campus-rag-raw",
                    "OBJECT_STORE_BUCKET_PROCESSED": "campus-rag-processed",
                    "REBUILD_IMPORT_MODE": "existing_ocr",
                    "DOCUMENT_REGISTRY_PATH": str(document_registry_path),
                    "RAW_ASSET_REGISTRY_PATH": str(raw_asset_registry_path),
                    "QDRANT_COLLECTION": "student_handbook",
                },
                object_store=object_store,
                qdrant_admin=qdrant,
                import_runner=lambda **kwargs: calls.append(kwargs["env"]) or {"status": "ok"},
            )

            self.assertEqual(
                object_store.cleared_prefixes,
                [
                    ("campus-rag-raw", "student_handbook/"),
                    ("campus-rag-processed", "student_handbook/"),
                ],
            )
            self.assertEqual(qdrant.reset_collections, [])
            self.assertFalse(document_registry_path.exists())
            self.assertFalse(raw_asset_registry_path.exists())
            self.assertEqual(calls, [report.import_env])
            self.assertEqual(report.import_result, {"status": "ok"})

    def test_rebuild_can_optionally_reset_qdrant_collection(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            document_registry_path = root / "registry" / "student_handbook_documents.json"
            raw_asset_registry_path = root / "registry" / "student_handbook_raw_assets.json"
            document_registry_path.parent.mkdir(parents=True, exist_ok=True)
            document_registry_path.write_text('{"stale": true}', encoding="utf-8")
            raw_asset_registry_path.write_text('{"stale": true}', encoding="utf-8")
            object_store = _FakeObjectStoreAdmin()
            qdrant = _FakeQdrantAdmin()

            rebuild_local_data(
                env={
                    "OBJECT_STORE_ENDPOINT": "http://localhost:9000",
                    "OBJECT_STORE_ACCESS_KEY": "minioadmin",
                    "OBJECT_STORE_SECRET_KEY": "minioadmin",
                    "REBUILD_IMPORT_MODE": "existing_ocr",
                    "DOCUMENT_REGISTRY_PATH": str(document_registry_path),
                    "RAW_ASSET_REGISTRY_PATH": str(raw_asset_registry_path),
                    "QDRANT_COLLECTION": "student_handbook",
                    "REBUILD_RESET_QDRANT": "1",
                },
                object_store=object_store,
                qdrant_admin=qdrant,
                import_runner=lambda **kwargs: {"status": "ok"},
            )

            self.assertEqual(qdrant.reset_collections, ["student_handbook"])

    def test_rebuild_uses_ingestion_corpus_prefix_for_curriculum_plan(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            document_registry_path = root / "registry" / "curriculum_plan_documents.json"
            raw_asset_registry_path = root / "registry" / "curriculum_plan_raw_assets.json"
            document_registry_path.parent.mkdir(parents=True, exist_ok=True)
            document_registry_path.write_text('{"stale": true}', encoding="utf-8")
            raw_asset_registry_path.write_text('{"stale": true}', encoding="utf-8")
            object_store = _FakeObjectStoreAdmin()

            rebuild_local_data(
                env={
                    "OBJECT_STORE_ENDPOINT": "http://localhost:9000",
                    "OBJECT_STORE_ACCESS_KEY": "minioadmin",
                    "OBJECT_STORE_SECRET_KEY": "minioadmin",
                    "REBUILD_IMPORT_MODE": "existing_ocr",
                    "DOCUMENT_REGISTRY_PATH": str(document_registry_path),
                    "RAW_ASSET_REGISTRY_PATH": str(raw_asset_registry_path),
                    "INGESTION_CORPUS": "curriculum_plan",
                },
                object_store=object_store,
                import_runner=lambda **kwargs: {"status": "ok"},
            )

            self.assertEqual(
                object_store.cleared_prefixes,
                [
                    ("campus-rag-raw", "curriculum_plan/"),
                    ("campus-rag-processed", "curriculum_plan/"),
                ],
            )

    def test_rebuild_local_data_requires_explicit_import_mode(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)

            with self.assertRaisesRegex(ValueError, "REBUILD_IMPORT_MODE"):
                rebuild_local_data(
                    env={
                        "OBJECT_STORE_ENDPOINT": "http://localhost:9000",
                        "OBJECT_STORE_ACCESS_KEY": "minioadmin",
                        "OBJECT_STORE_SECRET_KEY": "minioadmin",
                        "DOCUMENT_REGISTRY_PATH": str(root / "registry" / "documents.json"),
                        "RAW_ASSET_REGISTRY_PATH": str(root / "registry" / "raw_assets.json"),
                    },
                    object_store=_FakeObjectStoreAdmin(),
                    import_runner=lambda **kwargs: {"status": "ok"},
                )

    def test_rebuild_local_data_deletes_registry_by_corpus_and_can_dispatch_raw_online_ocr(self) -> None:
        object_store = _FakeObjectStoreAdmin()
        document_registry = _FakeDocumentRegistry()
        raw_asset_registry = _FakeRawAssetRegistry()
        calls: list[dict[str, str]] = []

        report = rebuild_local_data(
            env={
                "OBJECT_STORE_ENDPOINT": "http://localhost:9000",
                "OBJECT_STORE_ACCESS_KEY": "minioadmin",
                "OBJECT_STORE_SECRET_KEY": "minioadmin",
                "INGESTION_CORPUS": "curriculum_plan",
                "REBUILD_IMPORT_MODE": "raw_online_ocr",
            },
            object_store=object_store,
            document_registry=document_registry,
            raw_asset_registry=raw_asset_registry,
            import_runner=lambda **kwargs: calls.append(kwargs["env"]) or {"status": "raw"},
        )

        self.assertEqual(document_registry.deleted_corpora, ["curriculum_plan"])
        self.assertEqual(raw_asset_registry.deleted_corpora, ["curriculum_plan"])
        self.assertEqual(calls, [report.import_env])
        self.assertEqual(report.import_result, {"status": "raw"})


if __name__ == "__main__":
    unittest.main()
