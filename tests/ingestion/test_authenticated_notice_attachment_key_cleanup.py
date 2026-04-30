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


def _write_json(path: Path, payload: dict[str, object]) -> None:
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def _sha256_file(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _quarantine_ref(attachment_ref_id: str, object_key: str, sha_prefix: str) -> dict[str, object]:
    return {
        "attachment_ref_id": attachment_ref_id,
        "object_key": object_key,
        "content_sha256": sha_prefix * 64,
        "retention_class": "quarantine_candidate",
        "retention_expires_at": "2026-04-15T00:00:00+08:00",
        "attachment_promotion_state": "candidate",
        "required_source_object": False,
    }


def _blocking_candidate(candidate_id: str, object_key: str, status: str) -> dict[str, object]:
    return {
        "candidate_id": candidate_id,
        "status": status,
        "target_blocking": True,
        "source_object_ref": {
            "bucket": "campus-rag-source",
            "key": object_key,
        },
    }


def _passed_media_audit(*, candidate_inventory_path: Path) -> dict[str, object]:
    return {
        "schema_version": "notice_media_closeout_target_admission_state_machine_audit.v1",
        "verdict": "passed",
        "strict_gate": True,
        "finding_count": 0,
        "finding_counts_by_severity": {},
        "input_hashes": {
            "candidate_inventory_sha256": _sha256_file(candidate_inventory_path),
        },
    }


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
            candidate_inventory_path = root / "media-extraction-candidate-inventory.json"
            audit_path = root / "media-closeout-state-machine-audit.json"
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
            _write_json(candidate_inventory_path, {"candidates": []})
            _write_json(
                audit_path,
                _passed_media_audit(candidate_inventory_path=candidate_inventory_path),
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
                    media_extraction_candidate_inventory_path=candidate_inventory_path,
                    media_closeout_audit_path=audit_path,
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

    def test_quarantine_cleanup_requires_passed_media_audit_before_delete(self) -> None:
        cleanup_module = _load_cleanup_module()
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            attachment_refs_path = root / "attachment-refs.jsonl"
            candidate_inventory_path = root / "media-extraction-candidate-inventory.json"
            output_dir = root / "output"
            expired_key = (
                "authenticated_notice_portal/attachment-expired/2026/sha256/"
                + "a" * 64
                + "/capture/schedule.png"
            )
            _write_jsonl(
                attachment_refs_path,
                [_quarantine_ref("attachment-0001", expired_key, "a")],
            )
            _write_json(candidate_inventory_path, {"candidates": []})
            object_store = _FakeCleanupObjectStore()
            object_store.put_bytes(
                bucket="campus-rag-source",
                key=expired_key,
                data=b"expired",
                content_type="image/png",
            )

            with self.assertRaisesRegex(ValueError, "media closeout audit"):
                cleanup_module.cleanup_authenticated_notice_quarantine_attachment_keys(
                    request=cleanup_module.AuthenticatedNoticeQuarantineAttachmentCleanupRequest(
                        attachment_refs_path=attachment_refs_path,
                        media_extraction_candidate_inventory_path=candidate_inventory_path,
                        output_dir=output_dir,
                        now="2026-04-30T00:00:00+08:00",
                    ),
                    env=_object_store_env(),
                    object_store=object_store,
                )

        self.assertIn(("campus-rag-source", expired_key), object_store.objects)
        self.assertEqual(object_store.deleted, [])

    def test_quarantine_cleanup_rejects_stale_media_audit_candidate_inventory_hash(
        self,
    ) -> None:
        cleanup_module = _load_cleanup_module()
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            attachment_refs_path = root / "attachment-refs.jsonl"
            candidate_inventory_path = root / "media-extraction-candidate-inventory.json"
            audit_path = root / "media-closeout-state-machine-audit.json"
            output_dir = root / "output"
            expired_key = (
                "authenticated_notice_portal/attachment-expired/2026/sha256/"
                + "b" * 64
                + "/capture/schedule.png"
            )
            _write_jsonl(
                attachment_refs_path,
                [_quarantine_ref("attachment-0002", expired_key, "b")],
            )
            _write_json(candidate_inventory_path, {"candidates": []})
            _write_json(
                audit_path,
                {
                    **_passed_media_audit(candidate_inventory_path=candidate_inventory_path),
                    "input_hashes": {"candidate_inventory_sha256": "0" * 64},
                },
            )
            object_store = _FakeCleanupObjectStore()
            object_store.put_bytes(
                bucket="campus-rag-source",
                key=expired_key,
                data=b"expired",
                content_type="image/png",
            )

            with self.assertRaisesRegex(ValueError, "stale media closeout audit"):
                cleanup_module.cleanup_authenticated_notice_quarantine_attachment_keys(
                    request=cleanup_module.AuthenticatedNoticeQuarantineAttachmentCleanupRequest(
                        attachment_refs_path=attachment_refs_path,
                        media_extraction_candidate_inventory_path=candidate_inventory_path,
                        media_closeout_audit_path=audit_path,
                        output_dir=output_dir,
                        now="2026-04-30T00:00:00+08:00",
                    ),
                    env=_object_store_env(),
                    object_store=object_store,
                )

        self.assertIn(("campus-rag-source", expired_key), object_store.objects)
        self.assertEqual(object_store.deleted, [])

    def test_quarantine_cleanup_blocks_pending_target_media_extraction_refs(self) -> None:
        cleanup_module = _load_cleanup_module()
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            attachment_refs_path = root / "attachment-refs.jsonl"
            candidate_inventory_path = root / "media-extraction-candidate-inventory.json"
            output_dir = root / "output"
            expired_key = (
                "authenticated_notice_portal/attachment-expired/2026/sha256/"
                + "c" * 64
                + "/capture/schedule.png"
            )
            _write_jsonl(
                attachment_refs_path,
                [
                    {
                        "attachment_ref_id": "attachment-0003",
                        "object_key": expired_key,
                        "content_sha256": "c" * 64,
                        "retention_class": "quarantine_candidate",
                        "retention_expires_at": "2026-04-15T00:00:00+08:00",
                        "attachment_promotion_state": "candidate",
                        "required_source_object": False,
                    }
                ],
            )
            candidate_inventory_path.write_text(
                json.dumps(
                    {
                        "schema_version": "notice_media_extraction_candidate_inventory.v1",
                        "candidates": [
                            {
                                "candidate_id": "candidate-0003",
                                "status": "pending",
                                "target_blocking": True,
                                "source_object_ref": {
                                    "bucket": "campus-rag-source",
                                    "key": expired_key,
                                },
                            }
                        ],
                    },
                    ensure_ascii=False,
                    indent=2,
                )
                + "\n",
                encoding="utf-8",
            )
            object_store = _FakeCleanupObjectStore()
            object_store.put_bytes(
                bucket="campus-rag-source",
                key=expired_key,
                data=b"pending schedule image",
                content_type="image/png",
            )

            summary = cleanup_module.cleanup_authenticated_notice_quarantine_attachment_keys(
                request=cleanup_module.AuthenticatedNoticeQuarantineAttachmentCleanupRequest(
                    attachment_refs_path=attachment_refs_path,
                    media_extraction_candidate_inventory_path=candidate_inventory_path,
                    output_dir=output_dir,
                    now="2026-04-30T00:00:00+08:00",
                ),
                env=_object_store_env(),
                object_store=object_store,
            )

            blocked_rows = [
                json.loads(line)
                for line in (output_dir / "blocked-quarantine-objects.jsonl")
                .read_text(encoding="utf-8")
                .splitlines()
                if line.strip()
            ]

        self.assertEqual(summary["candidate_count"], 0)
        self.assertEqual(summary["blocked_by_media_extraction_count"], 1)
        self.assertIn(("campus-rag-source", expired_key), object_store.objects)
        self.assertEqual(object_store.deleted, [])
        self.assertEqual(blocked_rows[0]["object_key"], expired_key)
        self.assertEqual(blocked_rows[0]["blocking_media_candidate_ids"], ["candidate-0003"])

    def test_quarantine_cleanup_blocks_manual_review_and_failed_retryable_refs(self) -> None:
        cleanup_module = _load_cleanup_module()
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            attachment_refs_path = root / "attachment-refs.jsonl"
            candidate_inventory_path = root / "media-extraction-candidate-inventory.json"
            output_dir = root / "output"
            manual_review_key = (
                "authenticated_notice_portal/attachment-manual-review/2026/sha256/"
                + "d" * 64
                + "/capture/schedule.png"
            )
            retryable_key = (
                "authenticated_notice_portal/attachment-retryable/2026/sha256/"
                + "e" * 64
                + "/capture/schedule.png"
            )
            _write_jsonl(
                attachment_refs_path,
                [
                    _quarantine_ref("attachment-0004", manual_review_key, "d"),
                    _quarantine_ref("attachment-0005", retryable_key, "e"),
                ],
            )
            candidate_inventory_path.write_text(
                json.dumps(
                    {
                        "schema_version": "notice_media_extraction_candidate_inventory.v1",
                        "candidates": [
                            _blocking_candidate(
                                "candidate-0004", manual_review_key, "manual_review"
                            ),
                            _blocking_candidate(
                                "candidate-0005",
                                retryable_key,
                                "failed_retryable",
                            ),
                        ],
                    },
                    ensure_ascii=False,
                    indent=2,
                )
                + "\n",
                encoding="utf-8",
            )
            object_store = _FakeCleanupObjectStore()
            object_store.put_bytes(
                bucket="campus-rag-source",
                key=manual_review_key,
                data=b"manual review",
                content_type="image/png",
            )
            object_store.put_bytes(
                bucket="campus-rag-source",
                key=retryable_key,
                data=b"retryable",
                content_type="image/png",
            )

            summary = cleanup_module.cleanup_authenticated_notice_quarantine_attachment_keys(
                request=cleanup_module.AuthenticatedNoticeQuarantineAttachmentCleanupRequest(
                    attachment_refs_path=attachment_refs_path,
                    media_extraction_candidate_inventory_path=candidate_inventory_path,
                    output_dir=output_dir,
                    now="2026-04-30T00:00:00+08:00",
                ),
                env=_object_store_env(),
                object_store=object_store,
            )

        self.assertEqual(summary["candidate_count"], 0)
        self.assertEqual(summary["blocked_by_media_extraction_count"], 2)
        self.assertEqual(object_store.deleted, [])

    def test_quarantine_cleanup_releases_terminal_media_extraction_refs(self) -> None:
        cleanup_module = _load_cleanup_module()
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            attachment_refs_path = root / "attachment-refs.jsonl"
            candidate_inventory_path = root / "media-extraction-candidate-inventory.json"
            audit_path = root / "media-closeout-state-machine-audit.json"
            output_dir = root / "output"
            terminal_key = (
                "authenticated_notice_portal/attachment-terminal/2026/sha256/"
                + "f" * 64
                + "/capture/schedule.png"
            )
            _write_jsonl(
                attachment_refs_path, [_quarantine_ref("attachment-0006", terminal_key, "f")]
            )
            candidate_inventory_path.write_text(
                json.dumps(
                    {
                        "schema_version": "notice_media_extraction_candidate_inventory.v1",
                        "candidates": [
                            _blocking_candidate(
                                "candidate-0006",
                                terminal_key,
                                "failed_terminal",
                            )
                        ],
                    },
                    ensure_ascii=False,
                    indent=2,
                )
                + "\n",
                encoding="utf-8",
            )
            _write_json(
                audit_path,
                _passed_media_audit(candidate_inventory_path=candidate_inventory_path),
            )
            object_store = _FakeCleanupObjectStore()
            object_store.put_bytes(
                bucket="campus-rag-source",
                key=terminal_key,
                data=b"terminal",
                content_type="image/png",
            )

            summary = cleanup_module.cleanup_authenticated_notice_quarantine_attachment_keys(
                request=cleanup_module.AuthenticatedNoticeQuarantineAttachmentCleanupRequest(
                    attachment_refs_path=attachment_refs_path,
                    media_extraction_candidate_inventory_path=candidate_inventory_path,
                    media_closeout_audit_path=audit_path,
                    output_dir=output_dir,
                    now="2026-04-30T00:00:00+08:00",
                ),
                env=_object_store_env(),
                object_store=object_store,
            )

        self.assertEqual(summary["candidate_count"], 1)
        self.assertEqual(summary["blocked_by_media_extraction_count"], 0)
        self.assertEqual(
            object_store.deleted, [{"bucket": "campus-rag-source", "key": terminal_key}]
        )

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
            candidate_inventory_path = root / "media-extraction-candidate-inventory.json"
            audit_path = root / "media-closeout-state-machine-audit.json"
            output_dir = root / "output"
            attachment_refs_path.write_text("", encoding="utf-8")
            candidate_inventory_path.write_text('{"candidates":[]}\n', encoding="utf-8")
            audit_path.write_text('{"verdict":"passed"}\n', encoding="utf-8")

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
                ) as cleanup_mock,
                patch("sys.stdout", new_callable=io.StringIO) as stdout,
            ):
                cleanup_worker.main(
                    [
                        "--quarantine-attachment-refs-path",
                        str(attachment_refs_path),
                        "--media-extraction-candidate-inventory-path",
                        str(candidate_inventory_path),
                        "--media-closeout-audit-path",
                        str(audit_path),
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
        request = cleanup_mock.call_args.kwargs["request"]
        self.assertEqual(request.attachment_refs_path, attachment_refs_path)
        self.assertEqual(
            request.media_extraction_candidate_inventory_path, candidate_inventory_path
        )
        self.assertEqual(request.media_closeout_audit_path, audit_path)


if __name__ == "__main__":
    unittest.main()
