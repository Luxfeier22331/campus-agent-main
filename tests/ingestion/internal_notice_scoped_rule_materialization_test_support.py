from __future__ import annotations

import json

from campus_ingestion_core.authenticated_notice_source_truth_inventory import (
    AuthenticatedNoticeSourceTruthInventoryEntry,
)
from campus_ingestion_core.models import DocumentRegistryRecord


class _FakeObjectStore:
    def __init__(self, *, objects: dict[tuple[str, str], bytes] | None = None) -> None:
        self.objects = dict(objects or {})
        self.uploads: list[dict[str, object]] = []

    def get_bytes(self, *, bucket: str, key: str) -> bytes:
        return self.objects[(bucket, key)]

    def put_bytes(
        self,
        *,
        bucket: str,
        key: str,
        data: bytes,
        content_type: str,
    ) -> None:
        self.uploads.append(
            {
                "bucket": bucket,
                "key": key,
                "data": data,
                "content_type": content_type,
            }
        )
        self.objects[(bucket, key)] = data


def _canonical_markdown(body: str) -> bytes:
    return body.encode("utf-8")


def _document_units(rows: list[dict[str, object]]) -> bytes:
    return ("\n".join(json.dumps(row, ensure_ascii=False) for row in rows) + "\n").encode("utf-8")


def _record(
    *,
    notice_id: str,
    title_slug: str,
    content_hash: str,
    body_key: str,
    units_key: str,
    is_current: bool = False,
) -> DocumentRegistryRecord:
    return DocumentRegistryRecord(
        document_id=f"notice:muc_internal_portal:{notice_id}",
        revision_track="source-faithful",
        version_id=f"sha256:{notice_id}:source-faithful",
        source_uri=f"https://portal.example.edu/notices/{notice_id}",
        content_hash=content_hash,
        corpus="campus_notices",
        collection="internal_notice",
        cleaning_policy_version="authenticated_notice_projection_v1",
        entitlement_groups=("campus_members",),
        visibility_scope="campus",
        visibility_level="restricted",
        status="active",
        ingestion_timestamp="2026-04-10T00:00:00+00:00",
        parser_version="authenticated_notice_source_projection_v1",
        embedding_model="Qwen3-Embedding-4B",
        source_channel="authenticated_notice_portal",
        is_current=is_current,
        document_units_object_key=units_key,
        canonical_markdown_object_key=body_key,
        processed_object_keys=(body_key, units_key),
        import_source="authenticated_notice_source_projection",
        published_date="2026-04-10",
    )


def _inventory_entry(
    *,
    notice_id: str,
    notice_title: str,
    published_date: str = "2026-04-10",
) -> AuthenticatedNoticeSourceTruthInventoryEntry:
    parent_document_id = f"notice:muc_internal_portal:{notice_id}"
    parent_snapshot = {
        "notice_id": notice_id,
        "site_id": "muc_internal_portal",
        "document_id": parent_document_id,
        "notice_title": notice_title,
        "notice_release_time": published_date,
        "attachment_projection_plans": [],
        "record": {
            "document_id": parent_document_id,
            "published_date": published_date,
        },
    }
    return AuthenticatedNoticeSourceTruthInventoryEntry(
        corpus="campus_notices",
        collection="internal_notice",
        notice_id=notice_id,
        site_id="muc_internal_portal",
        document_id=parent_document_id,
        revision_track="source-faithful",
        version_id=f"sha256:{notice_id}:inventory",
        raw_asset_id=f"raw:{notice_id}",
        raw_version_id=f"sha256:{notice_id}:raw",
        source_home_url="https://portal.example.edu",
        embedding_model="Qwen3-Embedding-4B",
        notice_manifest_key=f"source/{notice_id}/notice-manifest.json",
        content_blocks_key=f"source/{notice_id}/content-blocks.jsonl",
        attachment_refs_key=f"source/{notice_id}/attachment-refs.jsonl",
        attachment_document_count=0,
        attachment_ref_count=0,
        text_extractable_count=0,
        ocr_required_count=0,
        reference_only_count=0,
        manual_review_required_count=0,
        notice_risk_label="body_only",
        attachment_mix_score=0,
        has_text_table_attachment=False,
        has_spatial_attachment=False,
        has_reference_only_attachment=False,
        planning_weight=1,
        parent_snapshot=parent_snapshot,
    )


def _document_rows(upload: dict[str, object]) -> list[dict[str, object]]:
    payload = upload["data"]
    assert isinstance(payload, bytes)
    return [json.loads(line) for line in payload.decode("utf-8").splitlines() if line.strip()]
