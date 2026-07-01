from __future__ import annotations

import json
import unittest
import unittest.mock

import campus_ingestion_core.internal_notice_regulation_materialization as regulation_materialization
from campus_ingestion_core.authenticated_notice_source_truth_inventory import (
    AuthenticatedNoticeSourceTruthInventoryEntry,
    InMemoryAuthenticatedNoticeSourceTruthInventoryStore,
)
from campus_ingestion_core.models import DocumentRegistryRecord
from campus_ingestion_core.notice_consumption_projection import (
    NOTICE_ANSWERABILITY_REFERENCE_ONLY,
    NOTICE_COMPLETENESS_REFERENCE_ONLY,
    NOTICE_CONSUMPTION_STATUS_READY_FOR_TARGET,
    NOTICE_CONSUMPTION_STATUS_RETAINED_FOR_NOTICE_QUERY,
    NOTICE_DEFAULT_AGENT_NOTICE,
    NOTICE_PRIMARY_ROLE_ATTACHMENT_RULE_BODY,
    NOTICE_SEMANTIC_OWNER_NOTICE_BODY,
    NOTICE_TARGET_SURFACE_INSTITUTIONAL_RULES,
    NOTICE_TEMPORAL_POLICY_STANDING_UNTIL_REPLACED,
    InMemoryNoticeConsumptionProjectionStore,
    NoticeConsumptionProjectionEntry,
)

from tests.support.in_memory_registry import InMemoryDocumentRegistry, InMemoryRawAssetRegistry


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
    document_id: str,
    source_uri: str,
    canonical_key: str,
    units_key: str,
    content_hash: str,
    revision_track: str = "source-faithful",
    is_current: bool = False,
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
        is_current=is_current,
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
    published_date: str = "2026-04-10",
    notice_release_time: str | None = None,
) -> AuthenticatedNoticeSourceTruthInventoryEntry:
    parent_document_id = f"notice:example_internal_portal:{notice_id}"
    parent_snapshot = {
        "notice_id": notice_id,
        "site_id": "example_internal_portal",
        "document_id": parent_document_id,
        "notice_title": notice_title,
        "notice_release_time": notice_release_time or published_date,
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
        site_id="example_internal_portal",
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


def _regulation_record(document_id: str) -> DocumentRegistryRecord:
    return DocumentRegistryRecord(
        document_id=document_id,
        revision_track="source-faithful",
        version_id="sha256:stale-regulation-v1",
        source_uri=f"campus-agent://promotion/{document_id}",
        content_hash="stale-regulation-hash",
        corpus="regulations",
        collection="institutional_rules",
        cleaning_policy_version="institutional_rules_cleaning_v1",
        entitlement_groups=("campus_members",),
        visibility_scope="campus",
        visibility_level="restricted",
        status="active",
        ingestion_timestamp="2026-04-09T00:00:00+00:00",
        parser_version="internal_notice_regulation_materialization_v1",
        embedding_model="Qwen3-Embedding-4B",
        source_channel="manual_curated",
        is_current=False,
        document_units_object_key=(
            "regulations/documents/institutional_rules/stale-regulation--stale1234/"
            "source-faithful/2026/document-units.jsonl"
        ),
        canonical_markdown_object_key=(
            "regulations/documents/institutional_rules/stale-regulation--stale1234/"
            "source-faithful/2026/canonical.md"
        ),
        processed_object_keys=(
            "regulations/documents/institutional_rules/stale-regulation--stale1234/"
            "source-faithful/2026/document-units.jsonl",
            "regulations/documents/institutional_rules/stale-regulation--stale1234/"
            "source-faithful/2026/canonical.md",
        ),
        import_source="internal_notice_regulation_materialization",
        published_date="2026-04-09",
    )


def _target_regulation_record(
    *,
    document_id: str,
    document_units_key: str,
    canonical_key: str,
    source_uri: str = "campus-agent://promotion/synthetic_notice/stale-target",
) -> DocumentRegistryRecord:
    return DocumentRegistryRecord(
        document_id=document_id,
        revision_track="source-faithful",
        version_id=f"sha256:{document_id.split(':')[-1]}:target",
        source_uri=source_uri,
        content_hash=f"sha256:{document_id}:content",
        corpus="regulations",
        collection="institutional_rules",
        cleaning_policy_version="institutional_rules_cleaning_v1",
        entitlement_groups=("campus_members",),
        visibility_scope="campus",
        visibility_level="restricted",
        status="active",
        ingestion_timestamp="2026-04-09T00:00:00+00:00",
        parser_version="internal_notice_regulation_materialization_v1",
        embedding_model="Qwen3-Embedding-4B",
        source_channel="manual_curated",
        is_current=True,
        document_units_object_key=document_units_key,
        canonical_markdown_object_key=canonical_key,
        processed_object_keys=(document_units_key, canonical_key),
        import_source="internal_notice_regulation_materialization",
        published_date="2026-04-09",
    )


def _document_rows(upload: dict[str, object]) -> list[dict[str, object]]:
    payload = upload["data"]
    assert isinstance(payload, bytes)
    return [json.loads(line) for line in payload.decode("utf-8").splitlines() if line.strip()]


class _ReadOnlyProjectionStore(InMemoryNoticeConsumptionProjectionStore):
    def replace_scope(
        self,
        source_corpus: str,
        source_collection: str,
        records,
    ) -> None:
        raise AssertionError("downstream materialization must not rebuild projection")

    def replace_notices(
        self,
        source_corpus: str,
        source_collection: str,
        notice_ids,
        records,
    ) -> None:
        raise AssertionError("downstream materialization must not rebuild projection")


def _ready_institutional_projection_entry(
    *,
    notice_id: str,
    source_document_id: str,
) -> NoticeConsumptionProjectionEntry:
    return NoticeConsumptionProjectionEntry(
        source_family="internal_notice_restricted",
        source_corpus="campus_notices",
        source_collection="internal_notice",
        source_notice_id=notice_id,
        unit_id=f"notice_unit:{source_document_id}:attachment_rule_body",
        primary_role=NOTICE_PRIMARY_ROLE_ATTACHMENT_RULE_BODY,
        semantic_owner=NOTICE_SEMANTIC_OWNER_NOTICE_BODY,
        default_agent=NOTICE_DEFAULT_AGENT_NOTICE,
        target_surface=NOTICE_TARGET_SURFACE_INSTITUTIONAL_RULES,
        temporal_policy=NOTICE_TEMPORAL_POLICY_STANDING_UNTIL_REPLACED,
        completeness_status=NOTICE_COMPLETENESS_REFERENCE_ONLY,
        answerability=NOTICE_ANSWERABILITY_REFERENCE_ONLY,
        consumption_status=NOTICE_CONSUMPTION_STATUS_READY_FOR_TARGET,
        source_notice_document_id=f"notice:example_internal_portal:{notice_id}",
        source_document_id=source_document_id,
    )


__all__ = [
    "NOTICE_ANSWERABILITY_REFERENCE_ONLY",
    "NOTICE_COMPLETENESS_REFERENCE_ONLY",
    "NOTICE_CONSUMPTION_STATUS_READY_FOR_TARGET",
    "NOTICE_CONSUMPTION_STATUS_RETAINED_FOR_NOTICE_QUERY",
    "NOTICE_DEFAULT_AGENT_NOTICE",
    "NOTICE_PRIMARY_ROLE_ATTACHMENT_RULE_BODY",
    "NOTICE_SEMANTIC_OWNER_NOTICE_BODY",
    "NOTICE_TARGET_SURFACE_INSTITUTIONAL_RULES",
    "NOTICE_TEMPORAL_POLICY_STANDING_UNTIL_REPLACED",
    "InMemoryAuthenticatedNoticeSourceTruthInventoryStore",
    "InMemoryDocumentRegistry",
    "InMemoryNoticeConsumptionProjectionStore",
    "InMemoryRawAssetRegistry",
    "NoticeConsumptionProjectionEntry",
    "_FakeObjectStore",
    "_ReadOnlyProjectionStore",
    "_canonical_markdown",
    "_document_rows",
    "_document_units",
    "_inventory_entry",
    "_ready_institutional_projection_entry",
    "_record",
    "_regulation_record",
    "_target_regulation_record",
    "regulation_materialization",
    "unittest",
]
