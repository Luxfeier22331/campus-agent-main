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
fetch_status_module = importlib.import_module(
    "campus_ingestion_core.authenticated_notice_attachment_fetch_status"
)


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
    terminal_attachment_outcomes: tuple[dict[str, object], ...] = (),
    owner_expectations: tuple[dict[str, object], ...] = (),
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
    unsupported_binary_count = sum(
        1
        for item in terminal_attachment_outcomes
        if str(item.get("classification") or "") == "unsupported_binary"
    )
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
        has_unsupported_binary_attachment=unsupported_binary_count > 0,
        multimodal_processing_required_count=0,
        notice_id=notice_id,
        notice_manifest_key=f"authenticated_notice_portal/{notice_id}/notice-manifest.json",
        notice_risk_label="body_with_reference_only_attachments",
        ocr_required_count=0,
        parent_snapshot={
            "attachment_projection_plans": attachment_projection_plans,
            "terminal_attachment_outcomes": [dict(item) for item in terminal_attachment_outcomes],
            "owner_expectations": [dict(item) for item in owner_expectations],
            "owner_expectation_count": len(owner_expectations),
        },
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
        unsupported_binary_count=unsupported_binary_count,
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


__all__ = [
    "FETCH_STATUS_TERMINAL_UNAVAILABLE",
    "TERMINAL_REASON_HTTP_404",
    "AuthenticatedNoticeAttachmentFetchStatusRecord",
    "InMemoryAuthenticatedNoticeAttachmentFetchStatusStore",
    "_FakeInventoryStore",
    "_FakeSourceTruthObjectStore",
    "_attachment_ref",
    "_bundle_with_missing_attachment",
    "_collected_fetch_status_record",
    "_fetch_status_record",
    "_inventory_entry",
    "build_attachment_fetch_status_coverage_report",
    "build_reference_only_attachment_explanation_report",
    "check_reference_only_worker",
    "check_worker",
    "fetch_status_module",
    "importlib",
    "io",
    "json",
    "patch",
    "record_worker",
    "show_worker",
    "unittest",
]
