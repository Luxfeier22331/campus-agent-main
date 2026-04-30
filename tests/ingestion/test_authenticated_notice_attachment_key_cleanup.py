from __future__ import annotations

import hashlib
import importlib
import io
import json
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

from tests.ingestion.test_authenticated_notice_import import _FakeObjectStore


def _load_cleanup_module():
    try:
        return importlib.import_module(
            "campus_ingestion_core.authenticated_notice_attachment_key_cleanup"
        )
    except ModuleNotFoundError as exc:  # pragma: no cover - red phase
        raise AssertionError("missing authenticated notice attachment key cleanup module") from exc


def _load_cleanup_worker():
    try:
        return importlib.import_module(
            "campus_ingestion_worker.cleanup_authenticated_notice_source_attachment_keys"
        )
    except ModuleNotFoundError as exc:  # pragma: no cover - red phase
        raise AssertionError("missing authenticated notice attachment key cleanup worker") from exc


def _object_store_env() -> dict[str, str]:
    return {
        "OBJECT_STORE_ENDPOINT": "http://localhost:9000",
        "OBJECT_STORE_ACCESS_KEY": "minioadmin",
        "OBJECT_STORE_SECRET_KEY": "minioadmin",
    }


def _legacy_key(*, attachment_bytes: bytes, filename: str) -> str:
    sha256 = hashlib.sha256(attachment_bytes).hexdigest()
    return f"{sha256[:2]}/{sha256}/{filename}"


def _write_jsonl(path: Path, rows: list[dict[str, object]]) -> None:
    path.write_text(
        "\n".join(json.dumps(row, ensure_ascii=False) for row in rows) + "\n",
        encoding="utf-8",
    )


class _FakeCleanupObjectStore(_FakeObjectStore):
    def __init__(self) -> None:
        super().__init__()
        self.deleted: list[dict[str, str]] = []

    def head_object(self, *, bucket: str, key: str) -> dict[str, object]:
        if (bucket, key) not in self.objects:
            raise KeyError((bucket, key))
        stored = self.objects[(bucket, key)]
        data = stored["data"]
        assert isinstance(data, bytes)
        return {
            "content_length": len(data),
            "etag": f"fake-etag:{bucket}:{key}",
        }

    def delete_object(self, *, bucket: str, key: str) -> None:
        self.deleted.append({"bucket": bucket, "key": key})
        self.objects.pop((bucket, key), None)


class _StickyDeleteObjectStore(_FakeCleanupObjectStore):
    def delete_object(self, *, bucket: str, key: str) -> None:
        self.deleted.append({"bucket": bucket, "key": key})


class AuthenticatedNoticeAttachmentKeyCleanupTest(unittest.TestCase):
    def test_cleanup_deletes_existing_legacy_objects_and_records_absent_ones(self) -> None:
        cleanup_module = _load_cleanup_module()
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            inventory_path = root / "unreferenced-legacy-keys.jsonl"
            output_dir = root / "output"
            existing_key = _legacy_key(
                attachment_bytes=b"attachment-a",
                filename="sample-a.pdf",
            )
            missing_key = _legacy_key(
                attachment_bytes=b"attachment-b",
                filename="sample-b.pdf",
            )
            _write_jsonl(
                inventory_path,
                [
                    {"legacy_object_key": existing_key},
                    {"legacy_object_key": existing_key},
                    {"legacy_object_key": missing_key},
                ],
            )
            object_store = _FakeCleanupObjectStore()
            object_store.put_bytes(
                bucket="campus-rag-source",
                key=existing_key,
                data=b"attachment-a",
                content_type="application/pdf",
            )

            summary = cleanup_module.cleanup_authenticated_notice_source_attachment_keys(
                request=cleanup_module.AuthenticatedNoticeAttachmentKeyCleanupRequest(
                    unreferenced_inventory_path=inventory_path,
                    output_dir=output_dir,
                ),
                env=_object_store_env(),
                object_store=object_store,
            )

            deleted_rows = [
                json.loads(line)
                for line in (output_dir / "deleted-objects.jsonl")
                .read_text(encoding="utf-8")
                .splitlines()
                if line.strip()
            ]
            already_absent_rows = [
                json.loads(line)
                for line in (output_dir / "already-absent-objects.jsonl")
                .read_text(encoding="utf-8")
                .splitlines()
                if line.strip()
            ]

        self.assertEqual(summary["inventory_row_count"], 3)
        self.assertEqual(summary["candidate_count"], 2)
        self.assertEqual(summary["deleted_count"], 1)
        self.assertEqual(summary["already_absent_count"], 1)
        self.assertNotIn(("campus-rag-source", existing_key), object_store.objects)
        self.assertEqual(
            deleted_rows,
            [
                {
                    "legacy_object_key": existing_key,
                    "byte_size": len(b"attachment-a"),
                    "etag": f"fake-etag:campus-rag-source:{existing_key}",
                    "status": "deleted",
                }
            ],
        )
        self.assertEqual(
            already_absent_rows,
            [
                {
                    "legacy_object_key": missing_key,
                    "status": "already_absent",
                }
            ],
        )

    def test_cleanup_rejects_non_legacy_inventory_keys(self) -> None:
        cleanup_module = _load_cleanup_module()
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            inventory_path = root / "unreferenced-legacy-keys.jsonl"
            output_dir = root / "output"
            _write_jsonl(
                inventory_path,
                [
                    {
                        "legacy_object_key": "authenticated_notice_portal/355119/2026/sha256/abc/source-truth/attachment-refs.jsonl"
                    }
                ],
            )

            with self.assertRaisesRegex(ValueError, "legacy attachment object key"):
                cleanup_module.cleanup_authenticated_notice_source_attachment_keys(
                    request=cleanup_module.AuthenticatedNoticeAttachmentKeyCleanupRequest(
                        unreferenced_inventory_path=inventory_path,
                        output_dir=output_dir,
                    ),
                    env=_object_store_env(),
                    object_store=_FakeCleanupObjectStore(),
                )

    def test_cleanup_fails_when_object_still_exists_after_delete(self) -> None:
        cleanup_module = _load_cleanup_module()
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            inventory_path = root / "unreferenced-legacy-keys.jsonl"
            output_dir = root / "output"
            existing_key = _legacy_key(
                attachment_bytes=b"attachment-a",
                filename="sample-a.pdf",
            )
            _write_jsonl(inventory_path, [{"legacy_object_key": existing_key}])
            object_store = _StickyDeleteObjectStore()
            object_store.put_bytes(
                bucket="campus-rag-source",
                key=existing_key,
                data=b"attachment-a",
                content_type="application/pdf",
            )

            with self.assertRaisesRegex(ValueError, "still exists after delete"):
                cleanup_module.cleanup_authenticated_notice_source_attachment_keys(
                    request=cleanup_module.AuthenticatedNoticeAttachmentKeyCleanupRequest(
                        unreferenced_inventory_path=inventory_path,
                        output_dir=output_dir,
                    ),
                    env=_object_store_env(),
                    object_store=object_store,
                )

    def test_quarantine_cleanup_deletes_expired_unpromoted_attachment_bytes(self) -> None:
        cleanup_module = _load_cleanup_module()
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            attachment_refs_path = root / "attachment-refs.jsonl"
            output_dir = root / "output"
            expired_key = (
                "authenticated_notice_portal/attachment-expired/2026/sha256/"
                + "a" * 64
                + "/capture/schedule.png"
            )
            promoted_key = (
                "authenticated_notice_portal/attachment-promoted/2026/sha256/"
                + "b" * 64
                + "/capture/promoted.png"
            )
            _write_jsonl(
                attachment_refs_path,
                [
                    {
                        "attachment_ref_id": "attachment-0001",
                        "object_key": expired_key,
                        "content_sha256": "a" * 64,
                        "retention_class": "quarantine_candidate",
                        "retention_expires_at": "2026-04-15T00:00:00+08:00",
                        "attachment_promotion_state": "candidate",
                        "required_source_object": False,
                    },
                    {
                        "attachment_ref_id": "attachment-0002",
                        "object_key": promoted_key,
                        "content_sha256": "b" * 64,
                        "retention_class": "quarantine_candidate",
                        "retention_expires_at": "2026-04-15T00:00:00+08:00",
                        "attachment_promotion_state": "promoted",
                        "required_source_object": False,
                    },
                ],
            )
            object_store = _FakeCleanupObjectStore()
            object_store.put_bytes(
                bucket="campus-rag-source",
                key=expired_key,
                data=b"expired",
                content_type="image/png",
            )
            object_store.put_bytes(
                bucket="campus-rag-source",
                key=promoted_key,
                data=b"promoted",
                content_type="image/png",
            )

            summary = cleanup_module.cleanup_authenticated_notice_quarantine_attachment_keys(
                request=cleanup_module.AuthenticatedNoticeQuarantineAttachmentCleanupRequest(
                    attachment_refs_path=attachment_refs_path,
                    output_dir=output_dir,
                    now="2026-04-30T00:00:00+08:00",
                ),
                env=_object_store_env(),
                object_store=object_store,
            )

            deleted_rows = [
                json.loads(line)
                for line in (output_dir / "deleted-quarantine-objects.jsonl")
                .read_text(encoding="utf-8")
                .splitlines()
                if line.strip()
            ]

        self.assertEqual(summary["candidate_count"], 1)
        self.assertEqual(summary["deleted_count"], 1)
        self.assertNotIn(("campus-rag-source", expired_key), object_store.objects)
        self.assertIn(("campus-rag-source", promoted_key), object_store.objects)
        self.assertEqual(deleted_rows[0]["attachment_ref_id"], "attachment-0001")
        self.assertEqual(deleted_rows[0]["object_key"], expired_key)

    def test_cli_renders_cleanup_summary(self) -> None:
        cleanup_worker = _load_cleanup_worker()
        cleanup_module = _load_cleanup_module()
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            inventory_path = root / "unreferenced-legacy-keys.jsonl"
            output_dir = root / "output"
            inventory_path.write_text("", encoding="utf-8")

            with (
                patch(
                    "campus_ingestion_worker.cleanup_authenticated_notice_source_attachment_keys.load_worker_env"
                ),
                patch(
                    "campus_ingestion_worker.cleanup_authenticated_notice_source_attachment_keys.cleanup_authenticated_notice_source_attachment_keys",
                    return_value={
                        "inventory_row_count": 2,
                        "candidate_count": 2,
                        "deleted_count": 1,
                        "already_absent_count": 1,
                    },
                ),
                patch("sys.stdout", new_callable=io.StringIO) as stdout,
            ):
                cleanup_worker.main(
                    [
                        "--unreferenced-inventory-path",
                        str(inventory_path),
                        "--output-dir",
                        str(output_dir),
                        "--yes",
                    ]
                )

        payload = json.loads(stdout.getvalue())
        self.assertEqual(payload["inventory_row_count"], 2)
        self.assertEqual(payload["deleted_count"], 1)
        self.assertEqual(payload["already_absent_count"], 1)
        self.assertIsNotNone(cleanup_module)

    def test_cli_renders_quarantine_cleanup_summary(self) -> None:
        cleanup_worker = _load_cleanup_worker()
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            attachment_refs_path = root / "attachment-refs.jsonl"
            output_dir = root / "output"
            attachment_refs_path.write_text("", encoding="utf-8")

            with (
                patch(
                    "campus_ingestion_worker.cleanup_authenticated_notice_source_attachment_keys.load_worker_env"
                ),
                patch(
                    (
                        "campus_ingestion_worker.cleanup_authenticated_notice_source_attachment_keys."
                        "cleanup_authenticated_notice_quarantine_attachment_keys"
                    ),
                    return_value={
                        "input_row_count": 3,
                        "candidate_count": 1,
                        "deleted_count": 1,
                        "already_absent_count": 0,
                    },
                ),
                patch("sys.stdout", new_callable=io.StringIO) as stdout,
            ):
                cleanup_worker.main(
                    [
                        "--quarantine-attachment-refs-path",
                        str(attachment_refs_path),
                        "--output-dir",
                        str(output_dir),
                        "--now",
                        "2026-04-30T00:00:00+08:00",
                        "--yes",
                    ]
                )

        payload = json.loads(stdout.getvalue())
        self.assertEqual(payload["input_row_count"], 3)
        self.assertEqual(payload["candidate_count"], 1)
        self.assertEqual(payload["deleted_count"], 1)


if __name__ == "__main__":
    unittest.main()
