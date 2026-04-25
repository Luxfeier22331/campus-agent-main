from __future__ import annotations

import importlib
import io
import json
import unittest
from unittest.mock import patch

from campus_ingestion_core.authenticated_notice_attachment_fetch_status import (
    FETCH_STATUS_TERMINAL_UNAVAILABLE,
    TERMINAL_REASON_HTTP_404,
    AuthenticatedNoticeAttachmentFetchStatusRecord,
    InMemoryAuthenticatedNoticeAttachmentFetchStatusStore,
    build_attachment_fetch_status_coverage_report,
    build_reference_only_attachment_explanation_report,
)
from campus_ingestion_core.authenticated_notice_source_truth_inventory import (
    AuthenticatedNoticeSourceTruthInventoryEntry,
)

record_worker = importlib.import_module(
    "campus_ingestion_worker.record_authenticated_notice_attachment_fetch_status"
)
show_worker = importlib.import_module(
    "campus_ingestion_worker.show_authenticated_notice_attachment_fetch_status"
)
check_worker = importlib.import_module(
    "campus_ingestion_worker.check_authenticated_notice_attachment_fetch_status"
)
check_reference_only_worker = importlib.import_module(
    "campus_ingestion_worker.check_authenticated_notice_reference_only_attachments"
)


class AuthenticatedNoticeAttachmentFetchStatusWorkerCliTest(unittest.TestCase):
    def test_record_main_builds_records_from_bundle_and_upserts_status_store(self) -> None:
        store = InMemoryAuthenticatedNoticeAttachmentFetchStatusStore()
        with (
            patch(
                "campus_ingestion_worker.record_authenticated_notice_attachment_fetch_status.load_worker_env"
            ),
            patch(
                "campus_ingestion_worker.record_authenticated_notice_attachment_fetch_status.load_authenticated_notice_bundle_payload",
                return_value=_bundle_with_missing_attachment(),
            ),
            patch(
                "campus_ingestion_worker.record_authenticated_notice_attachment_fetch_status.build_authenticated_notice_attachment_fetch_status_store_from_env",
                return_value=store,
            ) as build_store,
            patch("sys.stdout", new_callable=io.StringIO) as stdout,
        ):
            record_worker.main(
                [
                    "--bundle-path",
                    "/tmp/notices-bundle.json",
                    "--site-id",
                    "muc_internal_portal",
                    "--observed-at",
                    "2026-04-04T01:23:45.000Z",
                ]
            )

        build_store.assert_called_once()
        records = store.list_by_notice_ids(
            site_id="muc_internal_portal",
            notice_ids=("186977",),
        )
        self.assertEqual(len(records), 1)
        self.assertEqual(records[0].fetch_status, FETCH_STATUS_TERMINAL_UNAVAILABLE)
        self.assertEqual(records[0].terminal_reason, TERMINAL_REASON_HTTP_404)
        payload = json.loads(stdout.getvalue())
        self.assertEqual(payload["record_count"], 1)
        self.assertEqual(payload["status_counts"], {"terminal_unavailable": 1})
        self.assertEqual(payload["selected_notice_ids"], ["186977"])

    def test_show_main_lists_records_by_notice_ids(self) -> None:
        store = InMemoryAuthenticatedNoticeAttachmentFetchStatusStore()
        store.upsert_many(
            record_worker.build_attachment_fetch_status_records_from_bundle_records(
                bundle_records=_bundle_with_missing_attachment(),
                site_id="muc_internal_portal",
                observed_at="2026-04-04T01:23:45.000Z",
            )
        )
        with (
            patch(
                "campus_ingestion_worker.show_authenticated_notice_attachment_fetch_status.load_worker_env"
            ),
            patch(
                "campus_ingestion_worker.show_authenticated_notice_attachment_fetch_status.build_authenticated_notice_attachment_fetch_status_store_from_env",
                return_value=store,
            ),
            patch("sys.stdout", new_callable=io.StringIO) as stdout,
        ):
            show_worker.main(
                [
                    "--site-id",
                    "muc_internal_portal",
                    "--notice-id",
                    "186977",
                ]
            )

        payload = json.loads(stdout.getvalue())
        self.assertEqual(payload["record_count"], 1)
        self.assertEqual(payload["status_counts"], {"terminal_unavailable": 1})
        self.assertEqual(payload["records"][0]["notice_id"], "186977")
        self.assertEqual(payload["records"][0]["terminal_reason"], "http_404")

    def test_coverage_report_flags_missing_and_extra_fetch_status_rows(self) -> None:
        report = build_attachment_fetch_status_coverage_report(
            inventory_entries=(
                _inventory_entry("186977", attachment_ref_count=2),
                _inventory_entry("355119", attachment_ref_count=1),
            ),
            fetch_status_records=(
                _fetch_status_record("186977", "attachment-0001"),
                _fetch_status_record("999999", "attachment-0001"),
            ),
        )

        self.assertEqual(report.source_notice_count, 2)
        self.assertEqual(report.source_attachment_ref_count, 3)
        self.assertEqual(report.fetch_status_record_count, 2)
        self.assertEqual(
            report.missing_fetch_status_attachment_refs,
            (
                "muc_internal_portal:186977:attachment-0002",
                "muc_internal_portal:355119:attachment-0001",
            ),
        )
        self.assertEqual(
            report.extra_fetch_status_attachment_refs,
            ("muc_internal_portal:999999:attachment-0001",),
        )
        self.assertEqual(report.status_counts, {"terminal_unavailable": 2})

    def test_check_main_reports_fetch_status_coverage(self) -> None:
        inventory_store = _FakeInventoryStore(
            (
                _inventory_entry("186977", attachment_ref_count=2),
                _inventory_entry("355119", attachment_ref_count=1),
            )
        )
        fetch_status_store = InMemoryAuthenticatedNoticeAttachmentFetchStatusStore(
            (_fetch_status_record("186977", "attachment-0001"),)
        )
        with (
            patch(
                "campus_ingestion_worker.check_authenticated_notice_attachment_fetch_status.load_worker_env"
            ),
            patch(
                "campus_ingestion_worker.check_authenticated_notice_attachment_fetch_status.build_authenticated_notice_source_truth_inventory_store_from_env",
                return_value=inventory_store,
            ),
            patch(
                "campus_ingestion_worker.check_authenticated_notice_attachment_fetch_status.build_authenticated_notice_attachment_fetch_status_store_from_env",
                return_value=fetch_status_store,
            ),
            patch("sys.stdout", new_callable=io.StringIO) as stdout,
        ):
            check_worker.main(
                [
                    "--corpus",
                    "campus_notices",
                    "--collection",
                    "internal_notice",
                    "--site-id",
                    "muc_internal_portal",
                ]
            )

        payload = json.loads(stdout.getvalue())
        self.assertEqual(payload["source_attachment_ref_count"], 3)
        self.assertEqual(payload["fetch_status_record_count"], 1)
        self.assertEqual(
            payload["missing_fetch_status_attachment_refs"],
            [
                "muc_internal_portal:186977:attachment-0002",
                "muc_internal_portal:355119:attachment-0001",
            ],
        )

    def test_reference_only_explanation_report_separates_terminal_inline_and_action_required(
        self,
    ) -> None:
        report = build_reference_only_attachment_explanation_report(
            inventory_entries=(
                _inventory_entry(
                    "186977",
                    attachment_ref_count=2,
                    projected_attachment_ref_ids=("attachment-0001",),
                ),
                _inventory_entry("355119", attachment_ref_count=1),
                _inventory_entry("355120", attachment_ref_count=1),
            ),
            attachment_refs_by_key={
                "authenticated_notice_portal/186977/attachment-refs.jsonl": (
                    _attachment_ref("186977", "attachment-0001", object_key="doc.docx"),
                    _attachment_ref(
                        "186977",
                        "attachment-0002",
                        object_key=None,
                        content_sha256=None,
                    ),
                ),
                "authenticated_notice_portal/355119/attachment-refs.jsonl": (
                    _attachment_ref(
                        "355119",
                        "attachment-0001",
                        object_key="inline.png",
                        resource_role="inline_image",
                        content_kind="image",
                    ),
                ),
                "authenticated_notice_portal/355120/attachment-refs.jsonl": (
                    _attachment_ref(
                        "355120",
                        "attachment-0001",
                        object_key=None,
                        content_sha256=None,
                    ),
                ),
            },
            fetch_status_records=(
                _fetch_status_record("186977", "attachment-0002"),
                _collected_fetch_status_record("355119", "attachment-0001"),
            ),
        )

        self.assertEqual(report.reference_only_attachment_count, 3)
        self.assertEqual(report.action_required_count, 1)
        self.assertEqual(report.reason_counts["terminal_unavailable"], 1)
        self.assertEqual(report.reason_counts["object_backed_inline_image_reference_only"], 1)
        self.assertEqual(report.reason_counts["missing_object_key"], 1)
        self.assertEqual(
            [(row.notice_id, row.attachment_ref_id, row.reason) for row in report.rows],
            [
                ("186977", "attachment-0002", "terminal_unavailable"),
                (
                    "355119",
                    "attachment-0001",
                    "object_backed_inline_image_reference_only",
                ),
                ("355120", "attachment-0001", "missing_object_key"),
            ],
        )

    def test_reference_only_explanation_report_ignores_entries_without_reference_only_inventory(
        self,
    ) -> None:
        report = build_reference_only_attachment_explanation_report(
            inventory_entries=(
                _inventory_entry(
                    "355121",
                    attachment_ref_count=1,
                    reference_only_count=0,
                ),
            ),
            attachment_refs_by_key={
                "authenticated_notice_portal/355121/attachment-refs.jsonl": (
                    _attachment_ref(
                        "355121",
                        "attachment-0001",
                        object_key=None,
                        content_sha256=None,
                    ),
                ),
            },
            fetch_status_records=(),
        )

        self.assertEqual(report.reference_only_attachment_count, 0)
        self.assertEqual(report.action_required_count, 0)
        self.assertEqual(report.rows, ())

    def test_check_reference_only_main_reports_action_required_rows(self) -> None:
        inventory_store = _FakeInventoryStore(
            (
                _inventory_entry(
                    "186977",
                    attachment_ref_count=1,
                    projected_attachment_ref_ids=(),
                ),
                _inventory_entry(
                    "355119",
                    attachment_ref_count=1,
                    projected_attachment_ref_ids=(),
                ),
            )
        )
        fetch_status_store = InMemoryAuthenticatedNoticeAttachmentFetchStatusStore(
            (_fetch_status_record("186977", "attachment-0001"),)
        )
        object_store = _FakeSourceTruthObjectStore(
            {
                "authenticated_notice_portal/186977/attachment-refs.jsonl": (
                    _attachment_ref(
                        "186977",
                        "attachment-0001",
                        object_key=None,
                        content_sha256=None,
                    ),
                ),
                "authenticated_notice_portal/355119/attachment-refs.jsonl": (
                    _attachment_ref(
                        "355119",
                        "attachment-0001",
                        object_key=None,
                        content_sha256=None,
                    ),
                ),
            }
        )
        with (
            patch(
                "campus_ingestion_worker.check_authenticated_notice_reference_only_attachments.load_worker_env"
            ),
            patch(
                "campus_ingestion_worker.check_authenticated_notice_reference_only_attachments.build_authenticated_notice_source_truth_inventory_store_from_env",
                return_value=inventory_store,
            ),
            patch(
                "campus_ingestion_worker.check_authenticated_notice_reference_only_attachments.build_authenticated_notice_attachment_fetch_status_store_from_env",
                return_value=fetch_status_store,
            ),
            patch(
                "campus_ingestion_worker.check_authenticated_notice_reference_only_attachments.build_source_truth_object_store",
                return_value=object_store,
            ),
            patch("sys.stdout", new_callable=io.StringIO) as stdout,
        ):
            check_reference_only_worker.main(
                [
                    "--corpus",
                    "campus_notices",
                    "--collection",
                    "internal_notice",
                    "--site-id",
                    "muc_internal_portal",
                ]
            )

        payload = json.loads(stdout.getvalue())
        self.assertEqual(payload["reference_only_attachment_count"], 2)
        self.assertEqual(payload["action_required_count"], 1)
        self.assertEqual(payload["reason_counts"]["terminal_unavailable"], 1)
        self.assertEqual(payload["reason_counts"]["missing_object_key"], 1)
        self.assertEqual(payload["rows"][0]["reason"], "terminal_unavailable")
        self.assertEqual(payload["rows"][1]["reason"], "missing_object_key")


def _bundle_with_missing_attachment() -> tuple[dict[str, object], ...]:
    return (
        {
            "notice_id": 186977,
            "notice": {
                "notice_id": 186977,
                "notice_title": "药学院2021年硕博连读博士研究生招生实施细则",
            },
            "notice_attachments": [
                {
                    "notice_id": 186977,
                    "attachment_id": 1,
                    "link_id": None,
                    "relation_source": "detail_api",
                    "resource_role": "attachment",
                    "anchor_text": "missing.pdf",
                    "discovered_at": "2026-04-04T01:23:45.000Z",
                }
            ],
            "attachments": [
                {
                    "attachment_id": 1,
                    "source_url": "https://portal.example.edu/download?id=missing",
                    "normalized_source_url": "https://portal.example.edu/download?id=missing",
                    "final_url": "https://portal.example.edu/download?id=missing",
                    "original_filename": "missing.pdf",
                    "sha256": None,
                    "storage_provider": "reference_only",
                    "object_key": None,
                    "ingest_status": "reference_only",
                    "last_error": "downloadAttachment failed: 404 ",
                    "created_at": "2026-04-04T01:23:45.000Z",
                    "updated_at": "2026-04-04T01:23:45.000Z",
                }
            ],
        },
    )


def _inventory_entry(
    notice_id: str,
    *,
    attachment_ref_count: int,
    projected_attachment_ref_ids: tuple[str, ...] = (),
    reference_only_count: int | None = None,
) -> AuthenticatedNoticeSourceTruthInventoryEntry:
    attachment_projection_plans = [
        {
            "attachment_ref_id": attachment_ref_id,
            "classification": "text_extractable",
            "document_id": (
                f"notice_attachment:muc_internal_portal:{notice_id}:{attachment_ref_id}"
            ),
            "materialization_policy": "required_document",
        }
        for attachment_ref_id in projected_attachment_ref_ids
    ]
    return AuthenticatedNoticeSourceTruthInventoryEntry(
        attachment_document_count=0,
        attachment_mix_score=attachment_ref_count,
        attachment_ref_count=attachment_ref_count,
        attachment_refs_key=f"authenticated_notice_portal/{notice_id}/attachment-refs.jsonl",
        collection="internal_notice",
        content_blocks_key=f"authenticated_notice_portal/{notice_id}/content-blocks.jsonl",
        corpus="campus_notices",
        document_id=f"notice:muc_internal_portal:{notice_id}",
        embedding_model="Qwen3-Embedding-4B",
        has_reference_only_attachment=(
            (attachment_ref_count if reference_only_count is None else reference_only_count) > 0
        ),
        has_spatial_attachment=False,
        has_text_table_attachment=False,
        multimodal_processing_required_count=0,
        notice_id=notice_id,
        notice_manifest_key=f"authenticated_notice_portal/{notice_id}/notice-manifest.json",
        notice_risk_label="body_with_reference_only_attachments",
        ocr_required_count=0,
        parent_snapshot={"attachment_projection_plans": attachment_projection_plans},
        planning_weight=1,
        raw_asset_id=f"asset:authenticated-notice:muc_internal_portal:{notice_id}",
        raw_version_id="sha256:test",
        reference_only_count=(
            attachment_ref_count if reference_only_count is None else reference_only_count
        ),
        revision_track="source-faithful",
        site_id="muc_internal_portal",
        source_home_url="https://portal.example.edu",
        text_extractable_count=0,
        version_id="sha256:test",
    )


def _fetch_status_record(
    notice_id: str,
    attachment_ref_id: str,
) -> AuthenticatedNoticeAttachmentFetchStatusRecord:
    source_url = f"https://portal.example.edu/{notice_id}/{attachment_ref_id}.pdf"
    return AuthenticatedNoticeAttachmentFetchStatusRecord(
        site_id="muc_internal_portal",
        notice_id=notice_id,
        attachment_ref_id=attachment_ref_id,
        source_url=source_url,
        source_url_hash=record_worker.build_attachment_source_url_hash(source_url),
        fetch_status=FETCH_STATUS_TERMINAL_UNAVAILABLE,
        terminal_reason=TERMINAL_REASON_HTTP_404,
        last_http_status=404,
    )


def _collected_fetch_status_record(
    notice_id: str,
    attachment_ref_id: str,
) -> AuthenticatedNoticeAttachmentFetchStatusRecord:
    source_url = f"https://portal.example.edu/{notice_id}/{attachment_ref_id}.png"
    return AuthenticatedNoticeAttachmentFetchStatusRecord(
        site_id="muc_internal_portal",
        notice_id=notice_id,
        attachment_ref_id=attachment_ref_id,
        source_url=source_url,
        source_url_hash=record_worker.build_attachment_source_url_hash(source_url),
        fetch_status="collected_internal",
        object_key=f"objects/{notice_id}/{attachment_ref_id}.png",
        content_sha256="a" * 64,
    )


def _attachment_ref(
    notice_id: str,
    attachment_ref_id: str,
    *,
    object_key: str | None,
    content_sha256: str | None = "a" * 64,
    resource_role: str = "attachment",
    content_kind: str | None = None,
) -> dict[str, object]:
    return {
        "attachment_ref_id": attachment_ref_id,
        "notice_id": notice_id,
        "resource_role": resource_role,
        "content_kind": content_kind,
        "anchor_text": f"{attachment_ref_id}.png",
        "source_url": f"https://portal.example.edu/{notice_id}/{attachment_ref_id}.png",
        "final_url": f"https://portal.example.edu/{notice_id}/{attachment_ref_id}.png",
        "object_key": object_key,
        "content_sha256": content_sha256,
        "mime_type": "image/png" if content_kind == "image" else "application/pdf",
        "storage_provider": "object_store" if object_key else "reference_only",
        "ingest_status": "uploaded" if object_key else "reference_only",
    }


class _FakeInventoryStore:
    def __init__(
        self,
        records: tuple[AuthenticatedNoticeSourceTruthInventoryEntry, ...],
    ) -> None:
        self._records = records

    def list_by_scope(
        self,
        corpus: str,
        collection: str,
        *,
        notice_ids: tuple[str, ...] = (),
    ) -> tuple[AuthenticatedNoticeSourceTruthInventoryEntry, ...]:
        del corpus, collection
        selected = {str(item) for item in notice_ids}
        if not selected:
            return self._records
        return tuple(record for record in self._records if record.notice_id in selected)


class _FakeSourceTruthObjectStore:
    def __init__(self, rows_by_key: dict[str, tuple[dict[str, object], ...]]) -> None:
        self._rows_by_key = rows_by_key

    def get_bytes(self, *, bucket: str, key: str) -> bytes:
        del bucket
        rows = self._rows_by_key.get(key, ())
        return (
            "\n".join(json.dumps(row, ensure_ascii=False) for row in rows) + "\n" if rows else ""
        ).encode("utf-8")


if __name__ == "__main__":
    unittest.main()
