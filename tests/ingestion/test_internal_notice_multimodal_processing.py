from __future__ import annotations

import json
import unittest

import httpx
from campus_ingestion_core.authenticated_notice_source_truth_inventory import (
    AuthenticatedNoticeSourceTruthInventoryEntry,
    InMemoryAuthenticatedNoticeSourceTruthInventoryStore,
)
from campus_ingestion_core.internal_notice_multimodal_processing import (
    ChatCompletionsInternalNoticeMultimodalProcessor,
    InMemoryInternalNoticeMultimodalAttemptStore,
    InternalNoticeMultimodalAttachment,
    InternalNoticeMultimodalDecision,
    InternalNoticeMultimodalProcessingRequest,
    process_internal_notice_pending_multimodal_entries,
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


class InternalNoticeMultimodalProcessingTest(unittest.TestCase):
    def test_process_pending_multimodal_retains_machine_summary_for_notice_query(
        self,
    ) -> None:
        projection_store = InMemoryNoticeConsumptionProjectionStore(
            (
                _pending_entry("351907"),
                _notice_window_entry("351907"),
            )
        )
        inventory_store = InMemoryAuthenticatedNoticeSourceTruthInventoryStore()
        inventory_store.upsert_many((_inventory_entry("351907"),))
        object_store = _FakeObjectStore(
            {
                ("campus-rag-source", "notice/351907/attachment-map.png"): b"PNGDATA",
                (
                    "campus-rag-source",
                    "notice/351907/attachment-refs.jsonl",
                ): _jsonl_bytes(
                    (
                        {
                            "attachment_ref_id": "attachment-map",
                            "object_key": "notice/351907/attachment-map.png",
                            "mime_type": "image/png",
                            "filename": "map.png",
                        },
                    )
                ),
            }
        )
        processor = _FakeProcessor(
            InternalNoticeMultimodalDecision(
                action="retain_for_notice_query",
                summary="图中说明了丰台校区办事地点分布。",
                extracted_text="丰台校区办事地点：北区服务大厅。",
                reasons=("machine_visual_summary_available",),
                confidence="high",
            )
        )

        report = process_internal_notice_pending_multimodal_entries(
            notice_ids=("351907",),
            projection_store=projection_store,
            source_truth_inventory_store=inventory_store,
            object_store=object_store,
            source_bucket="campus-rag-source",
            processor=processor,
        )

        self.assertEqual(report.pending_entry_count, 1)
        self.assertEqual(report.processed_count, 1)
        self.assertEqual(report.retained_for_notice_query_count, 1)
        self.assertEqual(report.no_adoption_count, 0)
        self.assertEqual(processor.requests[0].attachments[0].data, b"PNGDATA")
        stored = projection_store.list_by_scope(
            "campus_notices",
            "internal_notice",
            notice_ids=("351907",),
        )
        processed = next(
            entry for entry in stored if entry.unit_id == "notice_unit:351907:pending_multimodal"
        )
        self.assertEqual(processed.target_surface, NOTICE_TARGET_SURFACE_NOTICE_LEVEL_QUERY)
        self.assertEqual(
            processed.consumption_status,
            NOTICE_CONSUMPTION_STATUS_RETAINED_FOR_NOTICE_QUERY,
        )
        self.assertEqual(processed.completeness_status, NOTICE_COMPLETENESS_COMPLETE)
        self.assertEqual(processed.answerability, NOTICE_ANSWERABILITY_BODY_ONLY_ANSWERABLE)
        self.assertEqual(processed.default_agent, NOTICE_DEFAULT_AGENT_NOTICE)
        self.assertEqual(
            processed.role_metadata["multimodal_summary"],
            "图中说明了丰台校区办事地点分布。",
        )
        self.assertEqual(
            processed.role_metadata["multimodal_extracted_text"],
            "丰台校区办事地点：北区服务大厅。",
        )
        self.assertEqual(
            processed.role_metadata["previous_consumption_status"],
            NOTICE_CONSUMPTION_STATUS_PENDING_MULTIMODAL_PROCESSING,
        )

    def test_process_pending_multimodal_can_close_as_no_adoption(self) -> None:
        projection_store = InMemoryNoticeConsumptionProjectionStore((_pending_entry("351907"),))
        inventory_store = InMemoryAuthenticatedNoticeSourceTruthInventoryStore()
        inventory_store.upsert_many((_inventory_entry("351907"),))
        processor = _FakeProcessor(
            InternalNoticeMultimodalDecision(
                action="no_adoption",
                summary="图片是装饰性宣传图。",
                extracted_text="",
                reasons=("decorative_visual_asset",),
                confidence="medium",
            )
        )

        report = process_internal_notice_pending_multimodal_entries(
            notice_ids=("351907",),
            projection_store=projection_store,
            source_truth_inventory_store=inventory_store,
            object_store=_FakeObjectStore({}),
            source_bucket="campus-rag-source",
            processor=processor,
        )

        self.assertEqual(report.no_adoption_count, 1)
        stored = projection_store.list_by_scope(
            "campus_notices",
            "internal_notice",
            notice_ids=("351907",),
        )
        processed = stored[0]
        self.assertEqual(processed.target_surface, NOTICE_TARGET_SURFACE_UNSUPPORTED)
        self.assertEqual(processed.consumption_status, NOTICE_CONSUMPTION_STATUS_NO_ADOPTION)
        self.assertEqual(
            processed.role_metadata["no_adoption_reason"],
            "multimodal_no_adoption",
        )

    def test_process_pending_multimodal_records_attempts_and_closes_after_max_attempts(
        self,
    ) -> None:
        projection_store = InMemoryNoticeConsumptionProjectionStore((_pending_entry("351907"),))
        inventory_store = InMemoryAuthenticatedNoticeSourceTruthInventoryStore()
        inventory_store.upsert_many((_inventory_entry("351907"),))
        attempt_store = InMemoryInternalNoticeMultimodalAttemptStore()
        processor = _FakeProcessor(
            InternalNoticeMultimodalDecision(
                action="needs_additional_processing",
                summary="图像仍不可读。",
                extracted_text="",
                reasons=("low_visual_confidence",),
                confidence="low",
            )
        )

        report = process_internal_notice_pending_multimodal_entries(
            notice_ids=("351907",),
            projection_store=projection_store,
            source_truth_inventory_store=inventory_store,
            object_store=_FakeObjectStore({}),
            source_bucket="campus-rag-source",
            processor=processor,
            attempt_store=attempt_store,
            max_attempts=1,
        )

        self.assertEqual(report.no_adoption_count, 1)
        self.assertEqual(report.still_pending_count, 0)
        attempts = attempt_store.list_by_unit("notice_unit:351907:pending_multimodal")
        self.assertEqual(len(attempts), 1)
        self.assertEqual(attempts[0].attempt_number, 1)
        self.assertEqual(attempts[0].decision_action, "needs_additional_processing")
        stored = projection_store.list_by_scope(
            "campus_notices",
            "internal_notice",
            notice_ids=("351907",),
        )
        self.assertEqual(stored[0].consumption_status, NOTICE_CONSUMPTION_STATUS_NO_ADOPTION)
        self.assertEqual(
            stored[0].role_metadata["no_adoption_reason"],
            "multimodal_attempts_exhausted",
        )

    def test_process_pending_multimodal_requires_selected_notice_ids(self) -> None:
        with self.assertRaisesRegex(ValueError, "selected notice_ids are required"):
            process_internal_notice_pending_multimodal_entries(
                projection_store=InMemoryNoticeConsumptionProjectionStore(),
                source_truth_inventory_store=InMemoryAuthenticatedNoticeSourceTruthInventoryStore(),
                object_store=_FakeObjectStore({}),
                source_bucket="campus-rag-source",
                processor=_FakeProcessor(
                    InternalNoticeMultimodalDecision(
                        action="retain_for_notice_query",
                        summary="",
                        extracted_text="",
                        reasons=(),
                        confidence="low",
                    )
                ),
            )

    def test_process_selection_without_pending_rows_does_not_require_chat_or_object_env(
        self,
    ) -> None:
        projection_store = InMemoryNoticeConsumptionProjectionStore(
            (_notice_window_entry("351907"),)
        )

        report = process_internal_notice_pending_multimodal_entries(
            notice_ids=("351907",),
            env={},
            projection_store=projection_store,
        )

        self.assertEqual(report.projection_entry_count, 1)
        self.assertEqual(report.pending_entry_count, 0)
        self.assertEqual(report.processed_count, 0)
        self.assertEqual(report.failed_count, 0)
        stored = projection_store.list_by_scope(
            "campus_notices",
            "internal_notice",
            notice_ids=("351907",),
        )
        self.assertEqual(
            stored[0].consumption_status,
            NOTICE_CONSUMPTION_STATUS_RETAINED_FOR_NOTICE_QUERY,
        )

    def test_chat_processor_posts_to_env_chat_endpoint_with_image_url_content(self) -> None:
        requests: list[dict[str, object]] = []

        def handler(request: httpx.Request) -> httpx.Response:
            self.assertEqual(request.url.path, "/v1/chat/completions")
            payload = json.loads(request.content.decode("utf-8"))
            requests.append(payload)
            return httpx.Response(
                200,
                json={
                    "choices": [
                        {
                            "message": {
                                "content": json.dumps(
                                    {
                                        "action": "retain_for_notice_query",
                                        "summary": "图片说明服务地点。",
                                        "extracted_text": "服务大厅位于北区。",
                                        "reasons": ["visual_text_extracted"],
                                        "confidence": "high",
                                    },
                                    ensure_ascii=False,
                                )
                            }
                        }
                    ]
                },
            )

        http_client = httpx.Client(
            base_url="https://llm.example/v1",
            transport=httpx.MockTransport(handler),
        )
        processor = ChatCompletionsInternalNoticeMultimodalProcessor(
            api_key="test-key",
            model="vision-model",
            http_client=http_client,
        )

        decision = processor.process(
            InternalNoticeMultimodalProcessingRequest(
                source_notice_id="351907",
                unit_id="notice_unit:351907:pending_multimodal",
                notice_title="关于服务地点调整的通知",
                primary_role=NOTICE_PRIMARY_ROLE_ATTACHMENT_RULE_BODY,
                reasons=("multimodal_processing_required",),
                attachments=(
                    InternalNoticeMultimodalAttachment(
                        attachment_ref_id="attachment-map",
                        filename="map.png",
                        mime_type="image/png",
                        object_key="notice/351907/attachment-map.png",
                        data=b"PNGDATA",
                    ),
                ),
            )
        )

        self.assertEqual(decision.action, "retain_for_notice_query")
        self.assertEqual(decision.confidence, "high")
        user_content = requests[0]["messages"][1]["content"]
        self.assertEqual(user_content[1]["type"], "image_url")
        self.assertTrue(user_content[1]["image_url"]["url"].startswith("data:image/png;base64,"))


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


def _pending_entry(notice_id: str) -> NoticeConsumptionProjectionEntry:
    return NoticeConsumptionProjectionEntry(
        source_family="internal_notice_restricted",
        source_corpus="campus_notices",
        source_collection="internal_notice",
        source_notice_id=notice_id,
        unit_id=f"notice_unit:{notice_id}:pending_multimodal",
        primary_role=NOTICE_PRIMARY_ROLE_ATTACHMENT_RULE_BODY,
        semantic_owner="notice_body",
        default_agent="notice-agent",
        target_surface=NOTICE_TARGET_SURFACE_MULTIMODAL_PROCESSING_CANDIDATE,
        temporal_policy="point_in_time_publication",
        completeness_status="requires_multimodal_processing",
        answerability="not_answerable",
        consumption_status=NOTICE_CONSUMPTION_STATUS_PENDING_MULTIMODAL_PROCESSING,
        source_notice_document_id=f"notice:muc_internal_portal:{notice_id}",
        source_document_id=f"notice:muc_internal_portal:{notice_id}",
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
        default_agent="notice-agent",
        target_surface=NOTICE_TARGET_SURFACE_NOTICE_LEVEL_QUERY,
        temporal_policy="announcement_window",
        completeness_status="complete",
        answerability="answerable",
        consumption_status=NOTICE_CONSUMPTION_STATUS_RETAINED_FOR_NOTICE_QUERY,
        source_notice_document_id=f"notice:muc_internal_portal:{notice_id}",
        source_document_id=f"notice:muc_internal_portal:{notice_id}",
    )


def _inventory_entry(notice_id: str) -> AuthenticatedNoticeSourceTruthInventoryEntry:
    return AuthenticatedNoticeSourceTruthInventoryEntry(
        corpus="campus_notices",
        collection="internal_notice",
        notice_id=notice_id,
        site_id="muc_internal_portal",
        document_id=f"notice:muc_internal_portal:{notice_id}",
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
        manual_review_required_count=1,
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
                    "classification": "manual_review_required",
                    "materialization_policy": "manual_review",
                    "document_id": f"notice_attachment:muc_internal_portal:{notice_id}:attachment-map",
                    "review_reason": "spatial_visual_asset",
                }
            ],
        },
    )


def _jsonl_bytes(rows: tuple[dict[str, object], ...]) -> bytes:
    return "\n".join(json.dumps(row, ensure_ascii=False) for row in rows).encode("utf-8")


if __name__ == "__main__":
    unittest.main()
