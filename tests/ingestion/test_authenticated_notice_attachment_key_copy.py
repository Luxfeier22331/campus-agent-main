from __future__ import annotations

import hashlib
import importlib
import io
import json
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import patch

from campus_ingestion_core.authenticated_notice_attachment_key_copy import (
    AuthenticatedNoticeAttachmentKeyCopyRequest,
    copy_authenticated_notice_source_attachment_keys,
)
from tests.ingestion.test_authenticated_notice_import import (
    _FakeObjectStore,
    _write_json,
)


copy_worker = importlib.import_module(
    "campus_ingestion_worker.copy_authenticated_notice_source_attachment_keys"
)


def _object_store_env() -> dict[str, str]:
    return {
        "OBJECT_STORE_ENDPOINT": "http://localhost:9000",
        "OBJECT_STORE_ACCESS_KEY": "minioadmin",
        "OBJECT_STORE_SECRET_KEY": "minioadmin",
    }


def _mapping_row(
    *,
    attachment_bytes: bytes,
    filename: str = "application.docx",
    notice_id: str = "355119",
    attachment_ref_id: str = "attachment-0001",
) -> dict[str, object]:
    sha256 = hashlib.sha256(attachment_bytes).hexdigest()
    legacy_key = f"{sha256[:2]}/{sha256}/{filename}"
    canonical_key = (
        f"authenticated_notice_portal/attachment-{sha256[:12]}/2026/sha256/{sha256}/capture/{filename}"
    )
    return {
        "legacy_object_key": legacy_key,
        "canonical_object_key": canonical_key,
        "content_sha256": sha256,
        "original_filename": filename,
        "notice_id": notice_id,
        "attachment_ref_id": attachment_ref_id,
    }


def _write_jsonl(path: Path, rows: list[dict[str, object]]) -> None:
    path.write_text(
        "\n".join(json.dumps(row, ensure_ascii=False) for row in rows) + "\n",
        encoding="utf-8",
    )


class AuthenticatedNoticeAttachmentKeyCopyTest(unittest.TestCase):
    def test_copy_copies_missing_target_and_writes_evidence(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            mapping_path = root / "mapping.jsonl"
            output_dir = root / "output"
            attachment_bytes = b"authenticated notice attachment"
            row = _mapping_row(attachment_bytes=attachment_bytes)
            _write_jsonl(mapping_path, [row])
            object_store = _FakeObjectStore()
            object_store.put_bytes(
                bucket="campus-rag-source",
                key=str(row["legacy_object_key"]),
                data=attachment_bytes,
                content_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            )

            summary = copy_authenticated_notice_source_attachment_keys(
                request=AuthenticatedNoticeAttachmentKeyCopyRequest(
                    mapping_path=mapping_path,
                    output_dir=output_dir,
                ),
                env=_object_store_env(),
                object_store=object_store,
                max_concurrency=1,
            )

            copied_rows = [
                json.loads(line)
                for line in (output_dir / "copied-objects.jsonl").read_text(
                    encoding="utf-8"
                ).splitlines()
                if line.strip()
            ]

        self.assertEqual(summary["mapping_row_count"], 1)
        self.assertEqual(summary["candidate_count"], 1)
        self.assertEqual(summary["copied_count"], 1)
        self.assertEqual(summary["existing_verified_count"], 0)
        self.assertEqual(
            object_store.get_bytes(
                bucket="campus-rag-source", key=str(row["canonical_object_key"])
            ),
            attachment_bytes,
        )
        self.assertEqual(len(copied_rows), 1)
        self.assertEqual(copied_rows[0]["legacy_object_key"], row["legacy_object_key"])
        self.assertEqual(copied_rows[0]["canonical_object_key"], row["canonical_object_key"])

    def test_copy_verifies_existing_target_without_recopied(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            mapping_path = root / "mapping.jsonl"
            output_dir = root / "output"
            attachment_bytes = b"authenticated notice attachment"
            row = _mapping_row(attachment_bytes=attachment_bytes)
            _write_jsonl(mapping_path, [row])
            object_store = _FakeObjectStore()
            object_store.put_bytes(
                bucket="campus-rag-source",
                key=str(row["legacy_object_key"]),
                data=attachment_bytes,
                content_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            )
            object_store.put_bytes(
                bucket="campus-rag-source",
                key=str(row["canonical_object_key"]),
                data=attachment_bytes,
                content_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            )
            upload_count_before = len(object_store.uploads)

            summary = copy_authenticated_notice_source_attachment_keys(
                request=AuthenticatedNoticeAttachmentKeyCopyRequest(
                    mapping_path=mapping_path,
                    output_dir=output_dir,
                ),
                env=_object_store_env(),
                object_store=object_store,
                max_concurrency=1,
            )

        self.assertEqual(summary["copied_count"], 0)
        self.assertEqual(summary["existing_verified_count"], 1)
        self.assertEqual(len(object_store.uploads), upload_count_before)

    def test_copy_deduplicates_duplicate_mapping_rows(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            mapping_path = root / "mapping.jsonl"
            output_dir = root / "output"
            attachment_bytes = b"authenticated notice attachment"
            first = _mapping_row(attachment_bytes=attachment_bytes, notice_id="355119")
            second = _mapping_row(
                attachment_bytes=attachment_bytes,
                notice_id="355120",
                attachment_ref_id="attachment-0002",
            )
            _write_jsonl(mapping_path, [first, second])
            object_store = _FakeObjectStore()
            object_store.put_bytes(
                bucket="campus-rag-source",
                key=str(first["legacy_object_key"]),
                data=attachment_bytes,
                content_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            )

            summary = copy_authenticated_notice_source_attachment_keys(
                request=AuthenticatedNoticeAttachmentKeyCopyRequest(
                    mapping_path=mapping_path,
                    output_dir=output_dir,
                ),
                env=_object_store_env(),
                object_store=object_store,
                max_concurrency=1,
            )

            copied_rows = [
                json.loads(line)
                for line in (output_dir / "copied-objects.jsonl").read_text(
                    encoding="utf-8"
                ).splitlines()
                if line.strip()
            ]

        self.assertEqual(summary["mapping_row_count"], 2)
        self.assertEqual(summary["candidate_count"], 1)
        self.assertEqual(copied_rows[0]["notice_ids"], ["355119", "355120"])
        self.assertEqual(
            copied_rows[0]["attachment_ref_ids"],
            ["attachment-0001", "attachment-0002"],
        )

    def test_copy_fails_when_source_bytes_do_not_match_expected_sha256(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            mapping_path = root / "mapping.jsonl"
            output_dir = root / "output"
            row = _mapping_row(attachment_bytes=b"expected bytes")
            _write_jsonl(mapping_path, [row])
            object_store = _FakeObjectStore()
            object_store.put_bytes(
                bucket="campus-rag-source",
                key=str(row["legacy_object_key"]),
                data=b"wrong bytes",
                content_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            )

            with self.assertRaisesRegex(ValueError, "content_sha256 mismatch"):
                copy_authenticated_notice_source_attachment_keys(
                    request=AuthenticatedNoticeAttachmentKeyCopyRequest(
                        mapping_path=mapping_path,
                        output_dir=output_dir,
                    ),
                    env=_object_store_env(),
                    object_store=object_store,
                    max_concurrency=1,
                )

    def test_cli_renders_copy_summary(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            mapping_path = root / "mapping.jsonl"
            output_dir = root / "output"
            _write_json(mapping_path, {"rows": []})

            with (
                patch(
                    "campus_ingestion_worker.copy_authenticated_notice_source_attachment_keys.load_worker_env"
                ),
                patch(
                    "campus_ingestion_worker.copy_authenticated_notice_source_attachment_keys.copy_authenticated_notice_source_attachment_keys",
                    return_value={
                        "mapping_row_count": 1,
                        "candidate_count": 1,
                        "copied_count": 1,
                        "existing_verified_count": 0,
                    },
                ),
                patch("sys.stdout", new_callable=io.StringIO) as stdout,
            ):
                copy_worker.main(
                    [
                        "--mapping-path",
                        str(mapping_path),
                        "--output-dir",
                        str(output_dir),
                        "--max-concurrency",
                        "4",
                    ]
                )

        payload = json.loads(stdout.getvalue())
        self.assertEqual(payload["mapping_row_count"], 1)
        self.assertEqual(payload["copied_count"], 1)


if __name__ == "__main__":
    unittest.main()
