from __future__ import annotations

import hashlib
import importlib
import io
import json
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import patch

from campus_ingestion_core.authenticated_notice_attachment_object_backfill import (
    AuthenticatedNoticeAttachmentObjectBackfillRequest,
    backfill_authenticated_notice_attachment_objects,
)
from tests.ingestion.test_authenticated_notice_import import (
    _FakeObjectStore,
    _sample_notice_bundle,
    _write_json,
)

backfill_worker = importlib.import_module(
    "campus_ingestion_worker.backfill_authenticated_notice_attachment_objects"
)


def _object_store_env() -> dict[str, str]:
    return {
        "OBJECT_STORE_ENDPOINT": "http://localhost:9000",
        "OBJECT_STORE_ACCESS_KEY": "minioadmin",
        "OBJECT_STORE_SECRET_KEY": "minioadmin",
    }


def _bundle_with_attachment_payload(
    *,
    attachment_bytes: bytes,
    filename: str = "application.docx",
) -> tuple[list[dict[str, object]], str]:
    bundle = _sample_notice_bundle()
    sha256 = hashlib.sha256(attachment_bytes).hexdigest()
    object_key = f"{sha256[:2]}/{sha256}/{filename}"
    bundle[0]["attachments"][0]["byte_size"] = len(attachment_bytes)
    bundle[0]["attachments"][0]["sha256"] = sha256
    bundle[0]["attachments"][0]["object_key"] = object_key
    bundle[0]["attachments"][0]["original_filename"] = filename
    bundle[0]["attachments"][0]["local_path"] = (
        "D:\\docs\\muc\\muc-notice-collector\\runtime\\blob-store\\"
        + object_key.replace("/", "\\")
    )
    return bundle, object_key


class AuthenticatedNoticeAttachmentObjectBackfillTest(unittest.TestCase):
    def test_backfill_uploads_missing_attachment_object_from_blob_root(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            blob_root = root / "blob-store"
            bundle_path = root / "bundle.json"
            attachment_bytes = b"authenticated notice attachment"
            bundle, object_key = _bundle_with_attachment_payload(
                attachment_bytes=attachment_bytes
            )
            local_blob_path = blob_root / object_key
            local_blob_path.parent.mkdir(parents=True, exist_ok=True)
            local_blob_path.write_bytes(attachment_bytes)
            _write_json(bundle_path, bundle)
            object_store = _FakeObjectStore()

            summary = backfill_authenticated_notice_attachment_objects(
                request=AuthenticatedNoticeAttachmentObjectBackfillRequest(
                    bundle_path=bundle_path,
                    blob_root=blob_root,
                ),
                env=_object_store_env(),
                object_store=object_store,
                max_concurrency=1,
            )

        self.assertEqual(summary["candidate_count"], 1)
        self.assertEqual(summary["uploaded_count"], 1)
        self.assertEqual(summary["existing_verified_count"], 0)
        self.assertEqual(
            object_store.get_bytes(bucket="campus-rag-source", key=object_key),
            attachment_bytes,
        )

    def test_backfill_fast_fails_when_existing_object_content_mismatches_expected_sha256(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            blob_root = root / "blob-store"
            bundle_path = root / "bundle.json"
            attachment_bytes = b"authenticated notice attachment"
            bundle, object_key = _bundle_with_attachment_payload(
                attachment_bytes=attachment_bytes
            )
            _write_json(bundle_path, bundle)
            object_store = _FakeObjectStore()
            object_store.put_bytes(
                bucket="campus-rag-source",
                key=object_key,
                data=b"wrong bytes",
                content_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            )

            with self.assertRaisesRegex(ValueError, "content_sha256 mismatch"):
                backfill_authenticated_notice_attachment_objects(
                    request=AuthenticatedNoticeAttachmentObjectBackfillRequest(
                        bundle_path=bundle_path,
                        blob_root=blob_root,
                    ),
                    env=_object_store_env(),
                    object_store=object_store,
                    max_concurrency=1,
                )

    def test_backfill_fast_fails_when_missing_object_has_no_local_blob(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            blob_root = root / "blob-store"
            bundle_path = root / "bundle.json"
            bundle, _ = _bundle_with_attachment_payload(
                attachment_bytes=b"authenticated notice attachment"
            )
            _write_json(bundle_path, bundle)

            with self.assertRaisesRegex(FileNotFoundError, "local blob not found"):
                backfill_authenticated_notice_attachment_objects(
                    request=AuthenticatedNoticeAttachmentObjectBackfillRequest(
                        bundle_path=bundle_path,
                        blob_root=blob_root,
                    ),
                    env=_object_store_env(),
                    object_store=_FakeObjectStore(),
                    max_concurrency=1,
                )

    def test_cli_renders_backfill_summary(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            bundle_path = root / "bundle.json"
            blob_root = root / "blob-store"
            _write_json(bundle_path, _sample_notice_bundle())

            with (
                patch(
                    "campus_ingestion_worker.backfill_authenticated_notice_attachment_objects.load_worker_env"
                ),
                patch(
                    "campus_ingestion_worker.backfill_authenticated_notice_attachment_objects.backfill_authenticated_notice_attachment_objects",
                    return_value={
                        "candidate_count": 1,
                        "uploaded_count": 1,
                        "existing_verified_count": 0,
                    },
                ),
                patch("sys.stdout", new_callable=io.StringIO) as stdout,
            ):
                backfill_worker.main(
                    [
                        "--bundle-path",
                        str(bundle_path),
                        "--blob-root",
                        str(blob_root),
                        "--max-concurrency",
                        "4",
                    ]
                )

        payload = json.loads(stdout.getvalue())
        self.assertEqual(payload["candidate_count"], 1)
        self.assertEqual(payload["uploaded_count"], 1)
