from __future__ import annotations

import importlib
import io
import json
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
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
                    if self_key == "authenticated_notice_portal/355282/2026/sha256/abc/source-truth/attachment-refs.jsonl":
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

            fake_entry = type(
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
                for line in (output_dir / "referenced-legacy-keys.jsonl").read_text(
                    encoding="utf-8"
                ).splitlines()
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
                for line in (output_dir / "unreferenced-legacy-keys.jsonl").read_text(
                    encoding="utf-8"
                ).splitlines()
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


if __name__ == "__main__":
    unittest.main()
