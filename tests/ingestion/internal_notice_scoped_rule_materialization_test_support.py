from __future__ import annotations

import json
import importlib

from campus_ingestion_core.authenticated_notice_source_truth_inventory import (
    AuthenticatedNoticeSourceTruthInventoryEntry,
)
from campus_ingestion_core.models import DocumentRegistryRecord
from campus_ingestion_core.notice_consumption_projection import (
    NOTICE_ANSWERABILITY_BODY_ONLY_ANSWERABLE,
    NOTICE_COMPLETENESS_COMPLETE,
    NOTICE_CONSUMPTION_STATUS_READY_FOR_TARGET,
    NOTICE_DEFAULT_AGENT_RAG,
    NOTICE_PRIMARY_ROLE_ANNUAL_CYCLE_RULE,
    NOTICE_PRIMARY_ROLE_TIME_BOUND_OPERATIONAL_RULE,
    NOTICE_SEMANTIC_OWNER_NOTICE_BODY,
    NOTICE_TARGET_SURFACE_SCOPED_RULES,
    NOTICE_TEMPORAL_POLICY_EXPLICIT_YEAR_ONLY,
    NOTICE_TEMPORAL_POLICY_TIME_WINDOWED,
    NoticeConsumptionProjectionEntry,
)

scoped_materialization = importlib.import_module(
    "campus_ingestion_core.internal_notice_scoped_rule_materialization"
)


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
        document_id=f"notice:example_internal_portal:{notice_id}",
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


def _target_scoped_rule_record(
    *,
    document_id: str,
    document_units_key: str,
    canonical_key: str,
    source_uri: str = "campus-agent://promotion/synthetic_notice_scoped_rules/stale-target",
) -> DocumentRegistryRecord:
    return DocumentRegistryRecord(
        document_id=document_id,
        revision_track="source-faithful",
        version_id=f"sha256:{document_id.split(':')[-1]}:target",
        source_uri=source_uri,
        content_hash=f"sha256:{document_id}:content",
        corpus="regulations",
        collection="scoped_rules",
        cleaning_policy_version="scoped_rules_cleaning_v1",
        entitlement_groups=("campus_members",),
        visibility_scope="campus",
        visibility_level="restricted",
        status="active",
        ingestion_timestamp="2026-04-09T00:00:00+00:00",
        parser_version="internal_notice_scoped_rule_materialization_v1",
        embedding_model="Qwen3-Embedding-4B",
        source_channel="manual_curated",
        is_current=True,
        document_units_object_key=document_units_key,
        canonical_markdown_object_key=canonical_key,
        processed_object_keys=(document_units_key, canonical_key),
        import_source="internal_notice_scoped_rule_materialization",
        published_date="2026-04-09",
    )


def _inventory_entry(
    *,
    notice_id: str,
    notice_title: str,
    published_date: str = "2026-04-10",
) -> AuthenticatedNoticeSourceTruthInventoryEntry:
    parent_document_id = f"notice:example_internal_portal:{notice_id}"
    parent_snapshot = {
        "notice_id": notice_id,
        "site_id": "example_internal_portal",
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
        attachment_document_count=0,
        attachment_ref_count=0,
        text_extractable_count=0,
        ocr_required_count=0,
        reference_only_count=0,
        multimodal_processing_required_count=0,
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


def _ready_scoped_projection_entry(
    *,
    notice_id: str,
    primary_role: str,
) -> NoticeConsumptionProjectionEntry:
    temporal_policy = (
        NOTICE_TEMPORAL_POLICY_EXPLICIT_YEAR_ONLY
        if primary_role == NOTICE_PRIMARY_ROLE_ANNUAL_CYCLE_RULE
        else NOTICE_TEMPORAL_POLICY_TIME_WINDOWED
    )
    return NoticeConsumptionProjectionEntry(
        source_family="internal_notice_restricted",
        source_corpus="campus_notices",
        source_collection="internal_notice",
        source_notice_id=notice_id,
        unit_id=f"notice_unit:example_internal_portal:{notice_id}:{primary_role}",
        primary_role=primary_role,
        semantic_owner=NOTICE_SEMANTIC_OWNER_NOTICE_BODY,
        default_agent=NOTICE_DEFAULT_AGENT_RAG,
        target_surface=NOTICE_TARGET_SURFACE_SCOPED_RULES,
        temporal_policy=temporal_policy,
        completeness_status=NOTICE_COMPLETENESS_COMPLETE,
        answerability=NOTICE_ANSWERABILITY_BODY_ONLY_ANSWERABLE,
        consumption_status=NOTICE_CONSUMPTION_STATUS_READY_FOR_TARGET,
        source_notice_document_id=f"notice:example_internal_portal:{notice_id}",
        source_document_id=f"notice:example_internal_portal:{notice_id}",
    )


__all__ = [
    "NOTICE_PRIMARY_ROLE_ANNUAL_CYCLE_RULE",
    "NOTICE_PRIMARY_ROLE_TIME_BOUND_OPERATIONAL_RULE",
    "_FakeObjectStore",
    "_canonical_markdown",
    "_document_rows",
    "_document_units",
    "_inventory_entry",
    "_ready_scoped_projection_entry",
    "_record",
    "_target_scoped_rule_record",
    "scoped_materialization",
]
