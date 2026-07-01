from __future__ import annotations

import json

import unittest

import httpx

from campus_ingestion_core.authenticated_notice_source_truth_inventory import (
    AuthenticatedNoticeSourceTruthInventoryEntry,
    InMemoryAuthenticatedNoticeSourceTruthInventoryStore,
)

from campus_ingestion_core.internal_notice_multimodal_processing import (
    AgentsSdkInternalNoticeMultimodalProcessor,
    ChatCompletionsInternalNoticeMultimodalProcessor,
    InMemoryInternalNoticeMultimodalAttemptStore,
    InternalNoticeMultimodalAttachment,
    InternalNoticeMultimodalAttempt,
    InternalNoticeMultimodalDecision,
    InternalNoticeMultimodalProcessingRequest,
    build_internal_notice_multimodal_attempt_store_from_env,
    build_internal_notice_multimodal_processor_from_env,
    drain_internal_notice_pending_multimodal_entries,
    process_internal_notice_pending_multimodal_entries,
    select_internal_notice_pending_multimodal_notice_ids,
)

from campus_ingestion_core.internal_notice_read_model import (
    build_internal_notice_read_model_entries,
)

from campus_ingestion_core.notice_consumption_projection import (
    NOTICE_ANSWERABILITY_BODY_ONLY_ANSWERABLE,
    NOTICE_COMPLETENESS_COMPLETE,
    NOTICE_CONSUMPTION_STATUS_NO_ADOPTION,
    NOTICE_CONSUMPTION_STATUS_PENDING_MULTIMODAL_PROCESSING,
    NOTICE_CONSUMPTION_STATUS_RETAINED_FOR_NOTICE_QUERY,
    NOTICE_DEFAULT_AGENT_NOTICE,
    NOTICE_PRIMARY_ROLE_ATTACHMENT_RULE_BODY,
    NOTICE_TARGET_SURFACE_MULTIMODAL_PROCESSING_CANDIDATE,
    NOTICE_TARGET_SURFACE_NOTICE_LEVEL_QUERY,
    NOTICE_TARGET_SURFACE_UNSUPPORTED,
    InMemoryNoticeConsumptionProjectionStore,
    NoticeConsumptionProjectionEntry,
)

from tests.support.in_memory_registry import InMemoryDocumentRegistry

from .internal_notice_scoped_rule_materialization_test_support import (
    _canonical_markdown,
    _record,
)


class _FakeObjectStore:
    def __init__(self, objects: dict[tuple[str, str], bytes]) -> None:
        self.objects = objects

    def get_bytes(self, *, bucket: str, key: str) -> bytes:
        return self.objects[(bucket, key)]


class _FakeProcessor:
    def __init__(self, decision: InternalNoticeMultimodalDecision) -> None:
        self.decision = decision
        self.requests: list[InternalNoticeMultimodalProcessingRequest] = []

    def process(
        self,
        request: InternalNoticeMultimodalProcessingRequest,
    ) -> InternalNoticeMultimodalDecision:
        self.requests.append(request)
        return self.decision


class _FailingProcessor:
    def __init__(self, exc: Exception) -> None:
        self.exc = exc
        self.requests: list[InternalNoticeMultimodalProcessingRequest] = []

    def process(
        self,
        request: InternalNoticeMultimodalProcessingRequest,
    ) -> InternalNoticeMultimodalDecision:
        self.requests.append(request)
        raise self.exc


class _FakeAgentsSdkRunner:
    def __init__(self, result: dict[str, object]) -> None:
        self.result = result
        self.calls: list[dict[str, object]] = []

    def __call__(self, request: dict[str, object]) -> dict[str, object]:
        self.calls.append(request)
        return dict(self.result)


def _pending_entry(notice_id: str) -> NoticeConsumptionProjectionEntry:
    return NoticeConsumptionProjectionEntry(
        source_family="internal_notice_restricted",
        source_corpus="campus_notices",
        source_collection="internal_notice",
        source_notice_id=notice_id,
        unit_id=f"notice_unit:{notice_id}:pending_multimodal",
        primary_role=NOTICE_PRIMARY_ROLE_ATTACHMENT_RULE_BODY,
        semantic_owner="notice_body",
        default_agent="notice",
        target_surface=NOTICE_TARGET_SURFACE_MULTIMODAL_PROCESSING_CANDIDATE,
        temporal_policy="point_in_time_publication",
        completeness_status="requires_multimodal_processing",
        answerability="not_answerable",
        consumption_status=NOTICE_CONSUMPTION_STATUS_PENDING_MULTIMODAL_PROCESSING,
        source_notice_document_id=f"notice:example_internal_portal:{notice_id}",
        source_document_id=f"notice:example_internal_portal:{notice_id}",
        role_metadata={
            "notice_title": f"测试通知 {notice_id}",
            "reasons": ("multimodal_processing_required",),
        },
    )


def _notice_window_entry(notice_id: str) -> NoticeConsumptionProjectionEntry:
    return NoticeConsumptionProjectionEntry(
        source_family="internal_notice_restricted",
        source_corpus="campus_notices",
        source_collection="internal_notice",
        source_notice_id=notice_id,
        unit_id=f"notice_unit:{notice_id}:notice_window",
        primary_role="notice_window",
        semantic_owner="notice_body",
        default_agent="notice",
        target_surface=NOTICE_TARGET_SURFACE_NOTICE_LEVEL_QUERY,
        temporal_policy="announcement_window",
        completeness_status="complete",
        answerability="answerable",
        consumption_status=NOTICE_CONSUMPTION_STATUS_RETAINED_FOR_NOTICE_QUERY,
        source_notice_document_id=f"notice:example_internal_portal:{notice_id}",
        source_document_id=f"notice:example_internal_portal:{notice_id}",
    )


def _inventory_entry(notice_id: str) -> AuthenticatedNoticeSourceTruthInventoryEntry:
    return AuthenticatedNoticeSourceTruthInventoryEntry(
        corpus="campus_notices",
        collection="internal_notice",
        notice_id=notice_id,
        site_id="example_internal_portal",
        document_id=f"notice:example_internal_portal:{notice_id}",
        revision_track="source-faithful",
        version_id=f"sha256:{notice_id}:source-faithful",
        raw_asset_id=f"asset:{notice_id}",
        raw_version_id=f"sha256:{notice_id}",
        source_home_url="https://portal.example.edu",
        embedding_model="test-embedding",
        notice_manifest_key=f"notice/{notice_id}/manifest.json",
        content_blocks_key=f"notice/{notice_id}/content-blocks.jsonl",
        attachment_refs_key=f"notice/{notice_id}/attachment-refs.jsonl",
        attachment_document_count=0,
        attachment_ref_count=1,
        text_extractable_count=0,
        ocr_required_count=0,
        reference_only_count=0,
        multimodal_processing_required_count=1,
        notice_risk_label="body_with_spatial_attachments",
        attachment_mix_score=1,
        has_text_table_attachment=False,
        has_spatial_attachment=True,
        has_reference_only_attachment=False,
        planning_weight=1,
        parent_snapshot={
            "notice_title": f"测试通知 {notice_id}",
            "attachment_projection_plans": [
                {
                    "attachment_ref_id": "attachment-map",
                    "classification": "multimodal_processing_required",
                    "materialization_policy": "multimodal_processing",
                    "document_id": f"notice_attachment:example_internal_portal:{notice_id}:attachment-map",
                    "review_reason": "spatial_visual_asset",
                }
            ],
        },
    )


def _jsonl_bytes(rows: tuple[dict[str, object], ...]) -> bytes:
    return "\n".join(json.dumps(row, ensure_ascii=False) for row in rows).encode("utf-8")


def _multimodal_attachment_objects(
    notice_ids: tuple[str, ...] = ("351907",),
    *,
    bucket: str = "campus-agent-source",
) -> dict[tuple[str, str], bytes]:
    objects: dict[tuple[str, str], bytes] = {}
    for notice_id in notice_ids:
        objects[(bucket, f"notice/{notice_id}/attachment-map.png")] = b"PNGDATA"
        objects[(bucket, f"notice/{notice_id}/attachment-refs.jsonl")] = _jsonl_bytes(
            (
                {
                    "attachment_ref_id": "attachment-map",
                    "object_key": f"notice/{notice_id}/attachment-map.png",
                    "mime_type": "image/png",
                    "filename": "map.png",
                },
            )
        )
    return objects


__all__ = [name for name in globals() if not name.startswith("__")]
