from __future__ import annotations

import importlib
import io
import json
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch


def _load_cleanup_module():
    return importlib.import_module(
        "campus_ingestion_core.authenticated_notice_attachment_key_cleanup"
    )


def _load_cleanup_worker():
    return importlib.import_module(
        "campus_ingestion_worker.cleanup_authenticated_notice_source_attachment_keys"
    )


def _object_store_env() -> dict[str, str]:
    return {
        "OBJECT_STORE_ENDPOINT": "http://localhost:9000",
        "OBJECT_STORE_ACCESS_KEY": "minioadmin",
        "OBJECT_STORE_SECRET_KEY": "minioadmin",
    }


def _write_jsonl(path: Path, rows: list[dict[str, object]]) -> None:
    path.write_text(
        "\n".join(json.dumps(row, ensure_ascii=False) for row in rows) + "\n",
        encoding="utf-8",
    )


def _canonical_key(slug: str, sha_char: str, filename: str) -> str:
    return (
        f"authenticated_notice_portal/attachment-{slug}/2026/sha256/"
        + sha_char * 64
        + f"/capture/{filename}"
    )


class _FakeCleanupObjectStore:
    def __init__(self) -> None:
        self.objects: dict[tuple[str, str], bytes] = {}
        self.deleted: list[dict[str, str]] = []

    def put_bytes(self, *, bucket: str, key: str, data: bytes) -> None:
        self.objects[(bucket, key)] = data

    def head_object(self, *, bucket: str, key: str) -> dict[str, object]:
        if (bucket, key) not in self.objects:
            raise KeyError((bucket, key))
        return {
            "ContentLength": len(self.objects[(bucket, key)]),
            "ETag": f"fake-etag:{key}",
        }

    def delete_object(self, *, bucket: str, key: str) -> None:
        self.deleted.append({"bucket": bucket, "key": key})
        self.objects.pop((bucket, key), None)


class AuthenticatedNoticeCanonicalAttachmentCleanupTest(unittest.TestCase):
    def test_cleanup_deletes_canonical_unreferenced_attachments_from_audit_inventory(
        self,
    ) -> None:
        cleanup_module = _load_cleanup_module()
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            inventory_path = root / "canonical-attachment-cleanup-candidates.jsonl"
            output_dir = root / "output"
            expired_key = _canonical_key("expired", "a", "expired.png")
            absent_key = _canonical_key("absent", "b", "absent.png")
            _write_jsonl(
                inventory_path,
                [
                    {
                        "bucket": "campus-rag-source",
                        "object_key": expired_key,
                        "cleanup_reason": "unreferenced_attachment_object",
                    },
                    {
                        "bucket": "campus-rag-source",
                        "object_key": absent_key,
                        "cleanup_reason": "unreferenced_attachment_object",
                    },
                ],
            )
            object_store = _FakeCleanupObjectStore()
            object_store.put_bytes(
                bucket="campus-rag-source",
                key=expired_key,
                data=b"expired image",
            )

            summary = cleanup_module.cleanup_authenticated_notice_canonical_unreferenced_attachment_keys(
                request=(
                    cleanup_module.AuthenticatedNoticeCanonicalUnreferencedAttachmentCleanupRequest(
                        candidate_inventory_path=inventory_path,
                        output_dir=output_dir,
                    )
                ),
                env=_object_store_env(),
                object_store=object_store,
            )

            deleted_rows = [
                json.loads(line)
                for line in (output_dir / "deleted-canonical-unreferenced-attachment-objects.jsonl")
                .read_text(encoding="utf-8")
                .splitlines()
                if line.strip()
            ]
            already_absent_rows = [
                json.loads(line)
                for line in (
                    output_dir / "already-absent-canonical-unreferenced-attachment-objects.jsonl"
                )
                .read_text(encoding="utf-8")
                .splitlines()
                if line.strip()
            ]

        self.assertEqual(summary["candidate_count"], 2)
        self.assertEqual(summary["deleted_count"], 1)
        self.assertEqual(summary["already_absent_count"], 1)
        self.assertNotIn(("campus-rag-source", expired_key), object_store.objects)
        self.assertEqual(deleted_rows[0]["object_key"], expired_key)
        self.assertEqual(already_absent_rows[0]["object_key"], absent_key)

    def test_cleanup_rejects_keep_rows(self) -> None:
        cleanup_module = _load_cleanup_module()
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            inventory_path = root / "keep.jsonl"
            _write_jsonl(
                inventory_path,
                [
                    {
                        "object_key": _canonical_key("required", "c", "required.pdf"),
                        "cleanup_reason": "unreferenced_attachment_object",
                        "classification": "keep",
                    }
                ],
            )

            with self.assertRaisesRegex(ValueError, "cannot be a keep row"):
                cleanup_module.cleanup_authenticated_notice_canonical_unreferenced_attachment_keys(
                    request=(
                        cleanup_module.AuthenticatedNoticeCanonicalUnreferencedAttachmentCleanupRequest(
                            candidate_inventory_path=inventory_path,
                            output_dir=root / "out",
                        )
                    ),
                    env=_object_store_env(),
                    object_store=_FakeCleanupObjectStore(),
                )

    def test_cleanup_rejects_expired_quarantine_candidates_without_media_closeout_gate(
        self,
    ) -> None:
        cleanup_module = _load_cleanup_module()
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            inventory_path = root / "quarantine.jsonl"
            _write_jsonl(
                inventory_path,
                [
                    {
                        "object_key": _canonical_key("expired", "d", "expired.png"),
                        "cleanup_reason": "expired_quarantine_candidate",
                    }
                ],
            )

            with self.assertRaisesRegex(ValueError, "quarantine candidates must use"):
                cleanup_module.cleanup_authenticated_notice_canonical_unreferenced_attachment_keys(
                    request=(
                        cleanup_module.AuthenticatedNoticeCanonicalUnreferencedAttachmentCleanupRequest(
                            candidate_inventory_path=inventory_path,
                            output_dir=root / "out",
                        )
                    ),
                    env=_object_store_env(),
                    object_store=_FakeCleanupObjectStore(),
                )

    def test_cleanup_dry_run_does_not_delete_canonical_unreferenced_attachments(self) -> None:
        cleanup_module = _load_cleanup_module()
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            inventory_path = root / "canonical-attachment-cleanup-candidates.jsonl"
            output_dir = root / "output"
            expired_key = _canonical_key("expired", "d", "expired.png")
            _write_jsonl(
                inventory_path,
                [
                    {
                        "object_key": expired_key,
                        "cleanup_reason": "unreferenced_attachment_object",
                    }
                ],
            )
            object_store = _FakeCleanupObjectStore()
            object_store.put_bytes(
                bucket="campus-rag-source",
                key=expired_key,
                data=b"expired image",
            )

            summary = cleanup_module.cleanup_authenticated_notice_canonical_unreferenced_attachment_keys(
                request=(
                    cleanup_module.AuthenticatedNoticeCanonicalUnreferencedAttachmentCleanupRequest(
                        candidate_inventory_path=inventory_path,
                        output_dir=output_dir,
                        dry_run=True,
                    )
                ),
                env=_object_store_env(),
                object_store=object_store,
            )

        self.assertEqual(summary["dry_run_count"], 1)
        self.assertEqual(object_store.deleted, [])
        self.assertIn(("campus-rag-source", expired_key), object_store.objects)

    def test_cli_renders_canonical_unreferenced_cleanup_summary(self) -> None:
        cleanup_worker = _load_cleanup_worker()
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            inventory_path = root / "canonical-attachment-cleanup-candidates.jsonl"
            output_dir = root / "output"
            inventory_path.write_text("", encoding="utf-8")

            with (
                patch(
                    "campus_ingestion_worker.cleanup_authenticated_notice_source_attachment_keys.load_worker_env"
                ),
                patch(
                    (
                        "campus_ingestion_worker.cleanup_authenticated_notice_source_attachment_keys."
                        "cleanup_authenticated_notice_canonical_unreferenced_attachment_keys"
                    ),
                    return_value={
                        "candidate_count": 2,
                        "deleted_count": 1,
                        "already_absent_count": 1,
                    },
                ) as cleanup_mock,
                patch("sys.stdout", new_callable=io.StringIO) as stdout,
            ):
                cleanup_worker.main(
                    [
                        "--canonical-unreferenced-inventory-path",
                        str(inventory_path),
                        "--output-dir",
                        str(output_dir),
                        "--yes",
                    ]
                )

        payload = json.loads(stdout.getvalue())
        self.assertEqual(payload["candidate_count"], 2)
        self.assertEqual(payload["deleted_count"], 1)
        request = cleanup_mock.call_args.kwargs["request"]
        self.assertEqual(request.candidate_inventory_path, inventory_path)


if __name__ == "__main__":
    unittest.main()
