from __future__ import annotations

import hashlib
import importlib
import io
import json
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import patch

from campus_ingestion_core.authenticated_notice_attachment_ref_rewrite import (
    AuthenticatedNoticeAttachmentRefRewriteRequest,
    rewrite_authenticated_notice_source_attachment_refs,
)
from tests.ingestion.test_authenticated_notice_import import _FakeObjectStore


rewrite_worker = importlib.import_module(
    "campus_ingestion_worker.rewrite_authenticated_notice_source_attachment_refs"
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


def _attachment_keys(filename: str = "application.docx") -> tuple[str, str, str]:
    payload = b"authenticated notice attachment"
    sha256 = hashlib.sha256(payload).hexdigest()
    legacy_key = f"{sha256[:2]}/{sha256}/{filename}"
    canonical_key = (
        f"authenticated_notice_portal/attachment-{sha256[:12]}/2026/sha256/{sha256}/capture/{filename}"
    )
    return sha256, legacy_key, canonical_key


def _artifact_keys() -> tuple[str, str]:
    attachment_refs_key = (
        "authenticated_notice_portal/355119/2026/sha256/abc/source-truth/attachment-refs.jsonl"
    )
    provider_key = (
        "authenticated_notice_portal/355119/2026/sha256/abc/provider/bundle-import-v1/attachment-observations.jsonl"
    )
    return attachment_refs_key, provider_key


class _FakeRewriteObjectStore(_FakeObjectStore):
    def list_keys(self, *, bucket: str, prefix: str) -> tuple[str, ...]:
        keys = [key for stored_bucket, key in self.objects if stored_bucket == bucket and key.startswith(prefix)]
        return tuple(sorted(keys))


class AuthenticatedNoticeAttachmentRefRewriteTest(unittest.TestCase):
    def test_rewrite_updates_attachment_refs_and_provider_artifacts(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            inventory_path = root / "referenced-legacy-keys.jsonl"
            output_dir = root / "output"
            content_sha256, legacy_key, canonical_key = _attachment_keys()
            attachment_refs_key, provider_key = _artifact_keys()
            _write_jsonl(
                inventory_path,
                [
                    {
                        "notice_id": "355119",
                        "attachment_refs_key": attachment_refs_key,
                        "attachment_ref_id": "attachment-0001",
                        "legacy_object_key": legacy_key,
                        "content_sha256": content_sha256,
                        "mime_type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                        "byte_size": 123,
                        "original_filename": "application.docx",
                        "canonical_object_key": canonical_key,
                    }
                ],
            )
            object_store = _FakeRewriteObjectStore()
            object_store.put_bytes(
                bucket="campus-rag-source",
                key=attachment_refs_key,
                data=(
                    json.dumps(
                        {
                            "attachment_ref_id": "attachment-0001",
                            "notice_id": "355119",
                            "object_key": legacy_key,
                            "content_sha256": content_sha256,
                        },
                        ensure_ascii=False,
                    )
                    + "\n"
                ).encode("utf-8"),
                content_type="application/x-ndjson",
            )
            object_store.put_bytes(
                bucket="campus-rag-source",
                key=provider_key,
                data=(
                    json.dumps(
                        {
                            "attachment_id": 1,
                            "object_key": legacy_key,
                            "content_sha256": content_sha256,
                            "source_url": "https://portal.example.edu/files/application.docx",
                        },
                        ensure_ascii=False,
                    )
                    + "\n"
                ).encode("utf-8"),
                content_type="application/x-ndjson",
            )

            summary = rewrite_authenticated_notice_source_attachment_refs(
                request=AuthenticatedNoticeAttachmentRefRewriteRequest(
                    referenced_inventory_path=inventory_path,
                    output_dir=output_dir,
                ),
                env=_object_store_env(),
                object_store=object_store,
                max_concurrency=1,
            )

            rewritten_attachment_refs = object_store.get_bytes(
                bucket="campus-rag-source",
                key=attachment_refs_key,
            ).decode("utf-8")
            rewritten_provider = object_store.get_bytes(
                bucket="campus-rag-source",
                key=provider_key,
            ).decode("utf-8")
            rewritten_attachment_artifacts = [
                json.loads(line)
                for line in (output_dir / "rewritten-attachment-refs-artifacts.jsonl").read_text(
                    encoding="utf-8"
                ).splitlines()
                if line.strip()
            ]
            rewritten_provider_artifacts = [
                json.loads(line)
                for line in (output_dir / "rewritten-provider-artifacts.jsonl").read_text(
                    encoding="utf-8"
                ).splitlines()
                if line.strip()
            ]

        self.assertEqual(summary["inventory_row_count"], 1)
        self.assertEqual(summary["candidate_count"], 1)
        self.assertEqual(summary["rewritten_attachment_ref_artifact_count"], 1)
        self.assertEqual(summary["rewritten_provider_artifact_count"], 1)
        self.assertIn(canonical_key, rewritten_attachment_refs)
        self.assertIn(canonical_key, rewritten_provider)
        self.assertEqual(rewritten_attachment_artifacts[0]["artifact_key"], attachment_refs_key)
        self.assertEqual(rewritten_provider_artifacts[0]["artifact_key"], provider_key)

    def test_rewrite_accepts_already_canonical_rows_without_rewrite(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            inventory_path = root / "referenced-legacy-keys.jsonl"
            output_dir = root / "output"
            content_sha256, legacy_key, canonical_key = _attachment_keys()
            attachment_refs_key, provider_key = _artifact_keys()
            _write_jsonl(
                inventory_path,
                [
                    {
                        "notice_id": "355119",
                        "attachment_refs_key": attachment_refs_key,
                        "attachment_ref_id": "attachment-0001",
                        "legacy_object_key": legacy_key,
                        "content_sha256": content_sha256,
                        "original_filename": "application.docx",
                        "canonical_object_key": canonical_key,
                    }
                ],
            )
            object_store = _FakeRewriteObjectStore()
            object_store.put_bytes(
                bucket="campus-rag-source",
                key=attachment_refs_key,
                data=(
                    json.dumps(
                        {
                            "attachment_ref_id": "attachment-0001",
                            "notice_id": "355119",
                            "object_key": canonical_key,
                            "content_sha256": content_sha256,
                        },
                        ensure_ascii=False,
                    )
                    + "\n"
                ).encode("utf-8"),
                content_type="application/x-ndjson",
            )
            object_store.put_bytes(
                bucket="campus-rag-source",
                key=provider_key,
                data=(
                    json.dumps(
                        {
                            "attachment_id": 1,
                            "object_key": canonical_key,
                            "content_sha256": content_sha256,
                        },
                        ensure_ascii=False,
                    )
                    + "\n"
                ).encode("utf-8"),
                content_type="application/x-ndjson",
            )
            upload_count_before = len(object_store.uploads)

            summary = rewrite_authenticated_notice_source_attachment_refs(
                request=AuthenticatedNoticeAttachmentRefRewriteRequest(
                    referenced_inventory_path=inventory_path,
                    output_dir=output_dir,
                ),
                env=_object_store_env(),
                object_store=object_store,
                max_concurrency=1,
            )

        self.assertEqual(summary["rewritten_attachment_ref_artifact_count"], 0)
        self.assertEqual(summary["rewritten_provider_artifact_count"], 0)
        self.assertEqual(summary["already_canonical_attachment_ref_row_count"], 1)
        self.assertEqual(summary["already_canonical_provider_row_count"], 1)
        self.assertEqual(len(object_store.uploads), upload_count_before)

    def test_rewrite_requires_provider_attachment_observation_artifact(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            inventory_path = root / "referenced-legacy-keys.jsonl"
            output_dir = root / "output"
            content_sha256, legacy_key, canonical_key = _attachment_keys()
            attachment_refs_key, _provider_key = _artifact_keys()
            _write_jsonl(
                inventory_path,
                [
                    {
                        "notice_id": "355119",
                        "attachment_refs_key": attachment_refs_key,
                        "attachment_ref_id": "attachment-0001",
                        "legacy_object_key": legacy_key,
                        "content_sha256": content_sha256,
                        "original_filename": "application.docx",
                        "canonical_object_key": canonical_key,
                    }
                ],
            )
            object_store = _FakeRewriteObjectStore()
            object_store.put_bytes(
                bucket="campus-rag-source",
                key=attachment_refs_key,
                data=(
                    json.dumps(
                        {
                            "attachment_ref_id": "attachment-0001",
                            "notice_id": "355119",
                            "object_key": legacy_key,
                            "content_sha256": content_sha256,
                        },
                        ensure_ascii=False,
                    )
                    + "\n"
                ).encode("utf-8"),
                content_type="application/x-ndjson",
            )

            with self.assertRaisesRegex(FileNotFoundError, "provider attachment-observations artifact"):
                rewrite_authenticated_notice_source_attachment_refs(
                    request=AuthenticatedNoticeAttachmentRefRewriteRequest(
                        referenced_inventory_path=inventory_path,
                        output_dir=output_dir,
                    ),
                    env=_object_store_env(),
                    object_store=object_store,
                    max_concurrency=1,
                )

    def test_cli_renders_rewrite_summary(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            inventory_path = root / "referenced-legacy-keys.jsonl"
            output_dir = root / "output"
            inventory_path.write_text("", encoding="utf-8")

            with (
                patch(
                    "campus_ingestion_worker.rewrite_authenticated_notice_source_attachment_refs.load_worker_env"
                ),
                patch(
                    "campus_ingestion_worker.rewrite_authenticated_notice_source_attachment_refs.rewrite_authenticated_notice_source_attachment_refs",
                    return_value={
                        "inventory_row_count": 1,
                        "candidate_count": 1,
                        "rewritten_attachment_ref_artifact_count": 1,
                        "rewritten_provider_artifact_count": 1,
                    },
                ),
                patch("sys.stdout", new_callable=io.StringIO) as stdout,
            ):
                rewrite_worker.main(
                    [
                        "--referenced-inventory-path",
                        str(inventory_path),
                        "--output-dir",
                        str(output_dir),
                        "--max-concurrency",
                        "4",
                    ]
                )

        payload = json.loads(stdout.getvalue())
        self.assertEqual(payload["candidate_count"], 1)
        self.assertEqual(payload["rewritten_provider_artifact_count"], 1)


if __name__ == "__main__":
    unittest.main()
