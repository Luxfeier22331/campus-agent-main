from __future__ import annotations

import importlib
import io
import json
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

from tests.ingestion.test_authenticated_notice_import import _FakeObjectStore


def _load_hygiene_module():
    try:
        return importlib.import_module("campus_ingestion_core.source_bucket_hygiene")
    except ModuleNotFoundError as exc:  # pragma: no cover - red phase
        raise AssertionError("missing source bucket hygiene module") from exc


def _load_audit_worker():
    try:
        return importlib.import_module("campus_ingestion_worker.audit_source_bucket_hygiene")
    except ModuleNotFoundError as exc:  # pragma: no cover - red phase
        raise AssertionError("missing source bucket hygiene audit worker") from exc


def _load_cleanup_worker():
    try:
        return importlib.import_module("campus_ingestion_worker.cleanup_source_bucket_prefix")
    except ModuleNotFoundError as exc:  # pragma: no cover - red phase
        raise AssertionError("missing source bucket prefix cleanup worker") from exc


def _object_store_env() -> dict[str, str]:
    return {
        "OBJECT_STORE_ENDPOINT": "http://localhost:9000",
        "OBJECT_STORE_ACCESS_KEY": "minioadmin",
        "OBJECT_STORE_SECRET_KEY": "minioadmin",
    }


class _FakeSourceBucketObjectStore(_FakeObjectStore):
    def __init__(self) -> None:
        super().__init__()
        self.deleted: list[dict[str, str]] = []

    def list_keys(self, *, bucket: str, prefix: str) -> tuple[str, ...]:
        keys = [
            key
            for stored_bucket, key in self.objects
            if stored_bucket == bucket and key.startswith(prefix)
        ]
        return tuple(sorted(keys))

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


class SourceBucketHygieneTest(unittest.TestCase):
    def test_audit_detects_unexpected_root_prefixes_and_writes_evidence(self) -> None:
        hygiene = _load_hygiene_module()
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            output_dir = root / "audit"
            object_store = _FakeSourceBucketObjectStore()
            object_store.put_bytes(
                bucket="campus-rag-source",
                key="official_pdf/student-handbook/2018/sha256/test/capture/学生手册_2018.pdf",
                data=b"pdf",
                content_type="application/pdf",
            )
            object_store.put_bytes(
                bucket="campus-rag-source",
                key="authenticated_notice_portal/notice-1/2026/sha256/test/source-truth/notice-manifest.json",
                data=b"{}",
                content_type="application/json",
            )
            object_store.put_bytes(
                bucket="campus-rag-source",
                key="debug/zero-byte/test/zero.jsonl",
                data=b"",
                content_type="application/x-ndjson",
            )

            summary = hygiene.audit_source_bucket_hygiene(
                request=hygiene.SourceBucketHygieneAuditRequest(output_dir=output_dir),
                env=_object_store_env(),
                object_store=object_store,
            )

            unexpected_prefixes = [
                json.loads(line)
                for line in (output_dir / "unexpected-root-prefixes.jsonl")
                .read_text(encoding="utf-8")
                .splitlines()
                if line.strip()
            ]
            unexpected_keys = [
                json.loads(line)
                for line in (output_dir / "unexpected-keys.jsonl")
                .read_text(encoding="utf-8")
                .splitlines()
                if line.strip()
            ]

        self.assertEqual(summary["source_key_count"], 3)
        self.assertEqual(summary["unexpected_root_prefix_count"], 1)
        self.assertEqual(summary["unexpected_key_count"], 1)
        self.assertEqual(
            unexpected_prefixes,
            [{"root_prefix": "debug", "key_count": 1}],
        )
        self.assertEqual(
            unexpected_keys,
            [{"root_prefix": "debug", "object_key": "debug/zero-byte/test/zero.jsonl"}],
        )

    def test_cleanup_deletes_unexpected_prefix_objects_and_writes_evidence(self) -> None:
        hygiene = _load_hygiene_module()
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            output_dir = root / "cleanup"
            object_store = _FakeSourceBucketObjectStore()
            object_store.put_bytes(
                bucket="campus-rag-source",
                key="debug/zero-byte/test/zero.jsonl",
                data=b"",
                content_type="application/x-ndjson",
            )
            object_store.put_bytes(
                bucket="campus-rag-source",
                key="debug/zero-byte/test/non-empty-1.json",
                data=b"{}",
                content_type="application/json",
            )
            object_store.put_bytes(
                bucket="campus-rag-source",
                key="official_pdf/student-handbook/2018/sha256/test/capture/学生手册_2018.pdf",
                data=b"pdf",
                content_type="application/pdf",
            )

            summary = hygiene.cleanup_source_bucket_prefix(
                request=hygiene.SourceBucketPrefixCleanupRequest(
                    prefix="debug/",
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

        self.assertEqual(summary["candidate_count"], 2)
        self.assertEqual(summary["deleted_count"], 2)
        self.assertEqual(summary["already_absent_count"], 0)
        self.assertEqual(
            object_store.list_keys(bucket="campus-rag-source", prefix="debug/"),
            (),
        )
        self.assertEqual(
            object_store.list_keys(bucket="campus-rag-source", prefix="official_pdf/"),
            ("official_pdf/student-handbook/2018/sha256/test/capture/学生手册_2018.pdf",),
        )
        self.assertEqual(
            [row["object_key"] for row in deleted_rows],
            [
                "debug/zero-byte/test/non-empty-1.json",
                "debug/zero-byte/test/zero.jsonl",
            ],
        )

    def test_cleanup_rejects_allowed_source_channel_prefix(self) -> None:
        hygiene = _load_hygiene_module()
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            output_dir = root / "cleanup"
            with self.assertRaisesRegex(ValueError, "allowed source root prefix"):
                hygiene.cleanup_source_bucket_prefix(
                    request=hygiene.SourceBucketPrefixCleanupRequest(
                        prefix="official_pdf/",
                        output_dir=output_dir,
                    ),
                    env=_object_store_env(),
                    object_store=_FakeSourceBucketObjectStore(),
                )

    def test_audit_cli_renders_summary(self) -> None:
        audit_worker = _load_audit_worker()
        with TemporaryDirectory() as temp_dir:
            output_dir = Path(temp_dir) / "audit"
            with (
                patch("campus_ingestion_worker.audit_source_bucket_hygiene.load_worker_env"),
                patch(
                    "campus_ingestion_worker.audit_source_bucket_hygiene.audit_source_bucket_hygiene",
                    return_value={
                        "source_key_count": 11,
                        "unexpected_root_prefix_count": 1,
                        "unexpected_key_count": 11,
                    },
                ),
                patch("sys.stdout", new_callable=io.StringIO) as stdout,
            ):
                audit_worker.main(["--output-dir", str(output_dir)])

        payload = json.loads(stdout.getvalue())
        self.assertEqual(payload["unexpected_root_prefix_count"], 1)
        self.assertEqual(payload["unexpected_key_count"], 11)

    def test_cleanup_cli_renders_summary(self) -> None:
        cleanup_worker = _load_cleanup_worker()
        with TemporaryDirectory() as temp_dir:
            output_dir = Path(temp_dir) / "cleanup"
            with (
                patch("campus_ingestion_worker.cleanup_source_bucket_prefix.load_worker_env"),
                patch(
                    "campus_ingestion_worker.cleanup_source_bucket_prefix.cleanup_source_bucket_prefix",
                    return_value={
                        "prefix": "debug/",
                        "candidate_count": 11,
                        "deleted_count": 11,
                        "already_absent_count": 0,
                    },
                ),
                patch("sys.stdout", new_callable=io.StringIO) as stdout,
            ):
                cleanup_worker.main(
                    ["--prefix", "debug/", "--output-dir", str(output_dir), "--yes"]
                )

        payload = json.loads(stdout.getvalue())
        self.assertEqual(payload["prefix"], "debug/")
        self.assertEqual(payload["deleted_count"], 11)


if __name__ == "__main__":
    unittest.main()
