from __future__ import annotations

import importlib
import io
import json
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

source_cleanup_worker = importlib.import_module(
    "campus_ingestion_worker.cleanup_source_bucket_prefix"
)
attachment_cleanup_worker = importlib.import_module(
    "campus_ingestion_worker.cleanup_authenticated_notice_source_attachment_keys"
)
regulation_residue_cleanup_worker = importlib.import_module(
    "campus_ingestion_worker.cleanup_internal_notice_regulation_target_residue"
)
source_hygiene = importlib.import_module("campus_ingestion_core.source_bucket_hygiene")
attachment_cleanup = importlib.import_module(
    "campus_ingestion_core.authenticated_notice_attachment_key_cleanup"
)


class CleanupDestructiveWorkerGuardsTest(unittest.TestCase):
    def test_source_bucket_cleanup_requires_yes_unless_dry_run(self) -> None:
        with (
            patch("campus_ingestion_worker.cleanup_source_bucket_prefix.load_worker_env"),
            self.assertRaises(SystemExit),
        ):
            source_cleanup_worker.main(["--prefix", "unexpected/", "--output-dir", "/tmp/out"])

    def test_attachment_cleanup_requires_yes_unless_dry_run(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            inventory_path = Path(temp_dir) / "inventory.jsonl"
            inventory_path.write_text("", encoding="utf-8")
            with (
                patch(
                    "campus_ingestion_worker.cleanup_authenticated_notice_source_attachment_keys.load_worker_env"
                ),
                self.assertRaises(SystemExit),
            ):
                attachment_cleanup_worker.main(
                    [
                        "--unreferenced-inventory-path",
                        str(inventory_path),
                        "--output-dir",
                        str(Path(temp_dir) / "out"),
                    ]
                )

    def test_regulation_residue_cleanup_requires_explicit_bucket(self) -> None:
        with (
            tempfile.TemporaryDirectory() as temp_dir,
            patch(
                "campus_ingestion_worker.cleanup_internal_notice_regulation_target_residue."
                "load_worker_env"
            ),
            patch.dict("os.environ", {}, clear=True),
            self.assertRaises(SystemExit),
        ):
            regulation_residue_cleanup_worker.main(
                [
                    "--notice-id",
                    "355282",
                    "--title",
                    "中央民族大学采购工作管理办法",
                    "--collection",
                    "institutional_rules",
                    "--document-id",
                    "regulation:muc:procurement",
                    "--version-id",
                    "sha256:abc",
                    "--target-key",
                    "regulations/institutional_rules/procurement.md",
                    "--output-dir",
                    temp_dir,
                ]
            )

    def test_source_bucket_cleanup_dry_run_does_not_delete_objects(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            object_store = _SourceObjectStore(("unexpected/a.txt", "unexpected/b.txt"))
            with patch(
                "campus_ingestion_core.source_bucket_hygiene.ObjectStoreSettings.from_env",
                return_value=SimpleNamespace(bucket_source="source"),
            ):
                result = source_hygiene.cleanup_source_bucket_prefix(
                    request=source_hygiene.SourceBucketPrefixCleanupRequest(
                        prefix="unexpected/",
                        output_dir=Path(temp_dir),
                        dry_run=True,
                    ),
                    object_store=object_store,
                    stderr=io.StringIO(),
                )

        self.assertEqual(result["candidate_count"], 2)
        self.assertEqual(result["deleted_count"], 0)
        self.assertEqual(result["dry_run_count"], 2)
        self.assertEqual(object_store.deleted, [])

    def test_attachment_cleanup_dry_run_does_not_delete_objects(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            inventory_path = Path(temp_dir) / "inventory.jsonl"
            inventory_path.write_text(
                json.dumps(
                    {
                        "legacy_object_key": "aa/" + "b" * 64 + "/legacy.pdf",
                    }
                )
                + "\n",
                encoding="utf-8",
            )
            object_store = _AttachmentObjectStore()
            with patch(
                "campus_ingestion_core.authenticated_notice_attachment_key_cleanup.ObjectStoreSettings.from_env",
                return_value=SimpleNamespace(bucket_source="source"),
            ):
                result = attachment_cleanup.cleanup_authenticated_notice_source_attachment_keys(
                    request=attachment_cleanup.AuthenticatedNoticeAttachmentKeyCleanupRequest(
                        unreferenced_inventory_path=inventory_path,
                        output_dir=Path(temp_dir) / "out",
                        dry_run=True,
                    ),
                    object_store=object_store,
                    stderr=io.StringIO(),
                )

        self.assertEqual(result["candidate_count"], 1)
        self.assertEqual(result["deleted_count"], 0)
        self.assertEqual(result["dry_run_count"], 1)
        self.assertEqual(object_store.deleted, [])


class _SourceObjectStore:
    def __init__(self, keys: tuple[str, ...]) -> None:
        self.keys = keys
        self.deleted: list[tuple[str, str]] = []

    def list_keys(self, *, bucket: str, prefix: str) -> tuple[str, ...]:
        return tuple(key for key in self.keys if key.startswith(prefix))

    def head_object(self, *, bucket: str, key: str):
        return {}

    def delete_object(self, *, bucket: str, key: str) -> None:
        self.deleted.append((bucket, key))


class _AttachmentObjectStore:
    def __init__(self) -> None:
        self.deleted: list[tuple[str, str]] = []

    def head_object(self, *, bucket: str, key: str):
        return {}

    def delete_object(self, *, bucket: str, key: str) -> None:
        self.deleted.append((bucket, key))


if __name__ == "__main__":
    unittest.main()
