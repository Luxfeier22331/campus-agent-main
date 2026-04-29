from __future__ import annotations

import json
from pathlib import Path
from tempfile import TemporaryDirectory

from campus_ingestion_core.authenticated_notice_source_truth_inventory import (
    AuthenticatedNoticeSourceTruthInventoryEntry,
    InMemoryAuthenticatedNoticeSourceTruthInventoryStore,
)
from campus_ingestion_core.in_memory_registries import InMemoryDocumentRegistry
from campus_ingestion_core.internal_notice_regulation_promotion import (
    InternalNoticeRegulationPromotionRequest,
    build_internal_notice_regulation_candidate_artifact_manifest,
    build_internal_notice_regulation_promotion_manifest,
    export_internal_notice_regulation_candidate_artifacts,
    extract_internal_notice_parent_regulation_body_preview,
)
from campus_ingestion_core.internal_notice_regulation_promotion_heuristics import (
    _split_regulation_title_fields,
)
from campus_ingestion_core.models import DocumentRegistryRecord


class _FakeObjectStore:
    def __init__(self, *, objects: dict[tuple[str, str], bytes]) -> None:
        self.objects = dict(objects)

    def get_bytes(self, *, bucket: str, key: str) -> bytes:
        return self.objects[(bucket, key)]


def _canonical_markdown(body: str) -> bytes:
    return body.encode("utf-8")


def _document_units(rows: list[dict[str, object]]) -> bytes:
    return ("\n".join(json.dumps(row, ensure_ascii=False) for row in rows) + "\n").encode("utf-8")


def _record(
    *,
    document_id: str,
    source_uri: str,
    canonical_key: str,
    units_key: str,
    content_hash: str,
    revision_track: str = "source-faithful",
) -> DocumentRegistryRecord:
    return DocumentRegistryRecord(
        document_id=document_id,
        revision_track=revision_track,
        version_id=f"sha256:{document_id.split(':')[-1]}:{revision_track}",
        source_uri=source_uri,
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
        is_current=True,
        document_units_object_key=units_key,
        canonical_markdown_object_key=canonical_key,
        processed_object_keys=(canonical_key, units_key),
        import_source="authenticated_notice_source_projection",
        published_date="2026-04-10",
    )


def _inventory_entry(
    *,
    notice_id: str,
    attachment_projection_plans: tuple[dict[str, object], ...] = (),
    notice_title: str,
    owner_expectations: tuple[dict[str, object], ...] = (),
    published_date: str = "2026-04-10",
    notice_release_time: str | None = None,
) -> AuthenticatedNoticeSourceTruthInventoryEntry:
    parent_document_id = f"notice:muc_internal_portal:{notice_id}"
    parent_snapshot = {
        "notice_id": notice_id,
        "site_id": "muc_internal_portal",
        "document_id": parent_document_id,
        "notice_title": notice_title,
        "notice_release_time": notice_release_time or published_date,
        "owner_expectation_count": len(owner_expectations),
        "owner_expectations": [dict(item) for item in owner_expectations],
        "attachment_projection_plans": [dict(item) for item in attachment_projection_plans],
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
        attachment_document_count=len(attachment_projection_plans),
        attachment_ref_count=len(attachment_projection_plans),
        text_extractable_count=sum(
            1
            for item in attachment_projection_plans
            if item.get("classification") == "text_extractable"
        ),
        ocr_required_count=sum(
            1
            for item in attachment_projection_plans
            if item.get("classification") == "ocr_required"
        ),
        reference_only_count=0,
        multimodal_processing_required_count=0,
        notice_risk_label="body_with_text_attachments"
        if attachment_projection_plans
        else "body_only",
        attachment_mix_score=len(attachment_projection_plans),
        has_text_table_attachment=bool(attachment_projection_plans),
        has_spatial_attachment=False,
        has_reference_only_attachment=False,
        planning_weight=1,
        parent_snapshot=parent_snapshot,
    )


__all__ = [name for name in globals() if not name.startswith("__")]
