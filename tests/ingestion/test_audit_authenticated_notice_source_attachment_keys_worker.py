from __future__ import annotations

import importlib
import io
import json
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

worker = importlib.import_module(
    "campus_ingestion_worker.audit_authenticated_notice_source_attachment_keys"
)


class AuditAuthenticatedNoticeSourceAttachmentKeysWorkerCliTest(unittest.TestCase):
    def test_main_writes_expected_inventories(self) -> None:
        with TemporaryDirectory() as temp_dir:
            output_dir = Path(temp_dir) / "audit"

            class FakeObjectStore:
                def __init__(self, *_args, **_kwargs) -> None:
                    pass

                def get_bytes(self, *, bucket: str, key: str) -> bytes:
                    self_bucket = bucket
                    self_key = key
                    if self_bucket != "campus-rag-source":
                        raise AssertionError(f"unexpected bucket: {self_bucket}")
                    if (
                        self_key
                        == "authenticated_notice_portal/355282/2026/sha256/abc/source-truth/attachment-refs.jsonl"
                    ):
                        return (
                            json.dumps(
                                {
                                    "notice_id": "355282",
                                    "attachment_ref_id": "attachment-0001",
                                    "object_key": "5b/5b96373175bfe5cb0658348c1fe454b6b40f31b4ee2d00ecc006a77399216d87/sample.pdf",
                                    "content_sha256": "f3b90b4975d3a147cdf0258e640c027ec7c4f3634e132bdb2ea138a1323088cc",
                                    "mime_type": "application/pdf",
                                    "byte_size": 123,
                                    "original_filename": "审核评估应知应会手册.pdf",
                                },
                                ensure_ascii=False,
                            )
                            + "\n"
                        ).encode("utf-8")
                    raise AssertionError(f"unexpected key: {self_key}")

                def list_keys(self, *, bucket: str, prefix: str) -> tuple[str, ...]:
                    if bucket != "campus-rag-source":
                        raise AssertionError(f"unexpected bucket: {bucket}")
                    if prefix not in {"", "authenticated_notice_portal/"}:
                        raise AssertionError(f"unexpected prefix: {prefix}")
                    return (
                        "5b/5b96373175bfe5cb0658348c1fe454b6b40f31b4ee2d00ecc006a77399216d87/sample.pdf",
                        "00/00298d1c0b2aaf0046b15a7a9436a2400b4988465e4fdc1d75254d4dee9f7fd6/extra.jpeg",
                        "authenticated_notice_portal/355282/2026/sha256/abc/source-truth/attachment-refs.jsonl",
                    )

            type(
                "FakeEntry",
                (),
                {
                    "notice_id": "355282",
                    "document_id": "notice:muc_internal_portal:355282",
                    "attachment_refs_key": "authenticated_notice_portal/355282/2026/sha256/abc/source-truth/attachment-refs.jsonl",
                },
            )()

            with (
                patch(
                    "campus_ingestion_worker.audit_authenticated_notice_source_attachment_keys.load_worker_env"
                ),
                patch(
                    "campus_ingestion_worker.audit_authenticated_notice_source_attachment_keys.ObjectStoreSettings.from_env"
                ) as from_env,
                patch(
                    "campus_ingestion_worker.audit_authenticated_notice_source_attachment_keys.S3ObjectStoreAdmin",
                    FakeObjectStore,
                ),
                patch("sys.stdout", new_callable=io.StringIO) as stdout,
            ):
                from_env.return_value = type(
                    "Settings",
                    (),
                    {"bucket_source": "campus-rag-source"},
                )()

                worker.main(
                    [
                        "--corpus",
                        "campus_notices",
                        "--collection",
                        "internal_notice",
                        "--output-dir",
                        str(output_dir),
                    ]
                )

            payload = json.loads(stdout.getvalue())
            self.assertEqual(payload["audited_notice_count"], 1)
            self.assertEqual(payload["attachment_refs_object_count"], 1)
            self.assertEqual(payload["legacy_key_count"], 2)
            self.assertEqual(payload["referenced_legacy_row_count"], 1)
            self.assertEqual(payload["referenced_legacy_key_count"], 1)
            self.assertEqual(payload["unreferenced_legacy_key_count"], 1)
            self.assertEqual(payload["canonicalizable_referenced_row_count"], 1)
            self.assertEqual(payload["canonicalizable_referenced_key_count"], 1)

            referenced_rows = [
                json.loads(line)
                for line in (output_dir / "referenced-legacy-keys.jsonl")
                .read_text(encoding="utf-8")
                .splitlines()
                if line.strip()
            ]
            self.assertEqual(len(referenced_rows), 1)
            self.assertEqual(referenced_rows[0]["notice_id"], "355282")
            self.assertEqual(
                referenced_rows[0]["attachment_refs_key"],
                "authenticated_notice_portal/355282/2026/sha256/abc/source-truth/attachment-refs.jsonl",
            )
            self.assertEqual(
                referenced_rows[0]["canonical_object_key"],
                "authenticated_notice_portal/attachment-f3b90b4975d3/2026/sha256/f3b90b4975d3a147cdf0258e640c027ec7c4f3634e132bdb2ea138a1323088cc/capture/审核评估应知应会手册.pdf",
            )

            unreferenced_rows = [
                json.loads(line)
                for line in (output_dir / "unreferenced-legacy-keys.jsonl")
                .read_text(encoding="utf-8")
                .splitlines()
                if line.strip()
            ]
            self.assertEqual(
                unreferenced_rows,
                [
                    {
                        "legacy_object_key": "00/00298d1c0b2aaf0046b15a7a9436a2400b4988465e4fdc1d75254d4dee9f7fd6/extra.jpeg"
                    }
                ],
            )

    def test_builds_expected_canonical_key(self) -> None:
        key = worker._build_canonical_attachment_capture_key(
            corpus="campus_notices",
            content_sha256="f3b90b4975d3a147cdf0258e640c027ec7c4f3634e132bdb2ea138a1323088cc",
            filename="handbook.pdf",
            year="2026",
        )
        self.assertEqual(
            key,
            "authenticated_notice_portal/attachment-f3b90b4975d3/2026/sha256/f3b90b4975d3a147cdf0258e640c027ec7c4f3634e132bdb2ea138a1323088cc/capture/handbook.pdf",
        )

    def test_classifies_canonical_attachment_prefix_objects_by_retention_contract(self) -> None:
        with TemporaryDirectory() as temp_dir:
            output_dir = Path(temp_dir) / "audit"
            required_key = (
                "authenticated_notice_portal/attachment-required/2026/sha256/"
                + "a" * 64
                + "/capture/required.pdf"
            )
            expired_key = (
                "authenticated_notice_portal/attachment-expired/2026/sha256/"
                + "b" * 64
                + "/capture/expired.png"
            )
            future_key = (
                "authenticated_notice_portal/attachment-future/2026/sha256/"
                + "c" * 64
                + "/capture/future.png"
            )
            unreferenced_key = (
                "authenticated_notice_portal/attachment-unreferenced/2026/sha256/"
                + "d" * 64
                + "/capture/unreferenced.zip"
            )
            incomplete_key = (
                "authenticated_notice_portal/attachment-incomplete/2026/sha256/"
                + "e" * 64
                + "/capture/incomplete.bin"
            )

            class FakeObjectStore:
                def __init__(self, *_args, **_kwargs) -> None:
                    pass

                def get_bytes(self, *, bucket: str, key: str) -> bytes:
                    if bucket != "campus-rag-source":
                        raise AssertionError(f"unexpected bucket: {bucket}")
                    if key != (
                        "authenticated_notice_portal/355282/2026/sha256/abc/"
                        "source-truth/attachment-refs.jsonl"
                    ):
                        raise AssertionError(f"unexpected key: {key}")
                    return (
                        "\n".join(
                            json.dumps(row, ensure_ascii=False)
                            for row in [
                                {
                                    "notice_id": "355282",
                                    "attachment_ref_id": "attachment-required",
                                    "object_key": required_key,
                                    "content_sha256": "a" * 64,
                                    "retention_class": "permanent_source_truth",
                                    "required_source_object": True,
                                    "attachment_promotion_state": "not_applicable",
                                },
                                {
                                    "notice_id": "355282",
                                    "attachment_ref_id": "attachment-expired",
                                    "object_key": expired_key,
                                    "content_sha256": "b" * 64,
                                    "retention_class": "quarantine_candidate",
                                    "retention_expires_at": "2026-04-15T00:00:00+08:00",
                                    "required_source_object": False,
                                    "attachment_promotion_state": "candidate",
                                },
                                {
                                    "notice_id": "355282",
                                    "attachment_ref_id": "attachment-future",
                                    "object_key": future_key,
                                    "content_sha256": "c" * 64,
                                    "retention_class": "quarantine_candidate",
                                    "retention_expires_at": "2026-06-15T00:00:00+08:00",
                                    "required_source_object": False,
                                    "attachment_promotion_state": "candidate",
                                },
                                {
                                    "notice_id": "355282",
                                    "attachment_ref_id": "attachment-incomplete",
                                    "object_key": incomplete_key,
                                    "content_sha256": "e" * 64,
                                    "retention_class": "quarantine_candidate",
                                    "required_source_object": False,
                                    "attachment_promotion_state": "candidate",
                                },
                            ]
                        )
                        + "\n"
                    ).encode("utf-8")

                def list_keys(self, *, bucket: str, prefix: str) -> tuple[str, ...]:
                    if bucket != "campus-rag-source":
                        raise AssertionError(f"unexpected bucket: {bucket}")
                    if prefix not in {"", "authenticated_notice_portal/"}:
                        raise AssertionError(f"unexpected prefix: {prefix}")
                    return (
                        "authenticated_notice_portal/355282/2026/sha256/abc/source-truth/attachment-refs.jsonl",
                        required_key,
                        expired_key,
                        future_key,
                        unreferenced_key,
                        incomplete_key,
                    )

                def head_object(self, *, bucket: str, key: str) -> dict[str, object]:
                    if bucket != "campus-rag-source":
                        raise AssertionError(f"unexpected bucket: {bucket}")
                    return {
                        "ContentLength": len(key.encode("utf-8")),
                        "ETag": f"fake-etag:{key}",
                    }

            with (
                patch(
                    "campus_ingestion_worker.audit_authenticated_notice_source_attachment_keys.load_worker_env"
                ),
                patch(
                    "campus_ingestion_worker.audit_authenticated_notice_source_attachment_keys.ObjectStoreSettings.from_env"
                ) as from_env,
                patch(
                    "campus_ingestion_worker.audit_authenticated_notice_source_attachment_keys.S3ObjectStoreAdmin",
                    FakeObjectStore,
                ),
                patch("sys.stdout", new_callable=io.StringIO) as stdout,
            ):
                from_env.return_value = type(
                    "Settings",
                    (),
                    {"bucket_source": "campus-rag-source"},
                )()

                worker.main(
                    [
                        "--corpus",
                        "campus_notices",
                        "--collection",
                        "internal_notice",
                        "--output-dir",
                        str(output_dir),
                        "--now",
                        "2026-05-18T00:00:00+08:00",
                    ]
                )

            payload = json.loads(stdout.getvalue())
            self.assertEqual(payload["canonical_attachment_key_count"], 5)
            self.assertEqual(payload["canonical_attachment_keep_count"], 2)
            self.assertEqual(payload["canonical_attachment_cleanup_candidate_count"], 1)
            self.assertEqual(payload["canonical_attachment_unreferenced_count"], 1)
            self.assertEqual(payload["canonical_attachment_review_required_count"], 1)

            keep_rows = [
                json.loads(line)
                for line in (output_dir / "canonical-attachment-keep.jsonl")
                .read_text(encoding="utf-8")
                .splitlines()
                if line.strip()
            ]
            cleanup_rows = [
                json.loads(line)
                for line in (output_dir / "canonical-attachment-cleanup-candidates.jsonl")
                .read_text(encoding="utf-8")
                .splitlines()
                if line.strip()
            ]
            unreferenced_rows = [
                json.loads(line)
                for line in (output_dir / "canonical-attachment-unreferenced-candidates.jsonl")
                .read_text(encoding="utf-8")
                .splitlines()
                if line.strip()
            ]
            review_rows = [
                json.loads(line)
                for line in (output_dir / "canonical-attachment-review-required.jsonl")
                .read_text(encoding="utf-8")
                .splitlines()
                if line.strip()
            ]

        self.assertEqual({row["object_key"] for row in keep_rows}, {required_key, future_key})
        self.assertEqual(cleanup_rows[0]["object_key"], expired_key)
        self.assertEqual(cleanup_rows[0]["cleanup_reason"], "expired_quarantine_candidate")
        self.assertEqual(unreferenced_rows[0]["object_key"], unreferenced_key)
        self.assertEqual(unreferenced_rows[0]["cleanup_reason"], "unreferenced_attachment_object")
        self.assertEqual(review_rows[0]["object_key"], incomplete_key)
        self.assertEqual(review_rows[0]["review_reason"], "missing_retention_expires_at")


if __name__ == "__main__":
    unittest.main()
