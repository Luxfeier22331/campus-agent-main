# ruff: noqa: F403,F405
from __future__ import annotations

import unittest

from tests.ingestion.test_internal_notice_multimodal_processing_support import *


class InternalNoticeMultimodalProcessingTestPart01(unittest.TestCase):
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
                ("campus-agent-source", "notice/351907/attachment-map.png"): b"PNGDATA",
                (
                    "campus-agent-source",
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
            source_bucket="campus-agent-source",
            processor=processor,
            admission_batch_id="batch-multimodal-001",
            admission_command="multimodal_process",
            admission_created_at="2026-04-25T00:00:00Z",
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

    def test_process_pending_multimodal_fails_closed_when_attachment_refs_are_missing(
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
        object_store = _FakeObjectStore({})
        processor = _FakeProcessor(
            InternalNoticeMultimodalDecision(
                action="no_adoption",
                summary="",
                extracted_text="",
                reasons=("no_visual_asset",),
                confidence="low",
            )
        )

        with self.assertRaisesRegex(ValueError, "attachment refs"):
            process_internal_notice_pending_multimodal_entries(
                notice_ids=("351907",),
                projection_store=projection_store,
                source_truth_inventory_store=inventory_store,
                object_store=object_store,
                source_bucket="campus-agent-source",
                processor=processor,
                admission_batch_id="batch-multimodal-001",
                admission_command="multimodal_process",
                admission_created_at="2026-04-25T00:00:00Z",
            )
        self.assertEqual(processor.requests, [])

    def test_process_pending_multimodal_fails_closed_when_declared_attachment_object_is_missing(
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
                (
                    "campus-agent-source",
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
                action="no_adoption",
                summary="",
                extracted_text="",
                reasons=("no_visual_asset",),
                confidence="low",
            )
        )

        with self.assertRaisesRegex(ValueError, "attachment object"):
            process_internal_notice_pending_multimodal_entries(
                notice_ids=("351907",),
                projection_store=projection_store,
                source_truth_inventory_store=inventory_store,
                object_store=object_store,
                source_bucket="campus-agent-source",
                processor=processor,
                admission_batch_id="batch-multimodal-001",
                admission_command="multimodal_process",
                admission_created_at="2026-04-25T00:00:00Z",
            )
        self.assertEqual(processor.requests, [])

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
            object_store=_FakeObjectStore(_multimodal_attachment_objects()),
            source_bucket="campus-agent-source",
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

    def test_low_confidence_retain_decision_stays_pending(self) -> None:
        projection_store = InMemoryNoticeConsumptionProjectionStore((_pending_entry("351907"),))
        inventory_store = InMemoryAuthenticatedNoticeSourceTruthInventoryStore()
        inventory_store.upsert_many((_inventory_entry("351907"),))
        processor = _FakeProcessor(
            InternalNoticeMultimodalDecision(
                action="retain_for_notice_query",
                summary="图片可能包含服务地点。",
                extracted_text="服务大厅",
                reasons=("weak_visual_guess",),
                confidence="low",
            )
        )

        report = process_internal_notice_pending_multimodal_entries(
            notice_ids=("351907",),
            projection_store=projection_store,
            source_truth_inventory_store=inventory_store,
            object_store=_FakeObjectStore(_multimodal_attachment_objects()),
            source_bucket="campus-agent-source",
            processor=processor,
            max_attempts=3,
        )

        self.assertEqual(report.retained_for_notice_query_count, 0)
        self.assertEqual(report.still_pending_count, 1)
        stored = projection_store.list_by_scope(
            "campus_notices",
            "internal_notice",
            notice_ids=("351907",),
        )
        self.assertEqual(
            stored[0].consumption_status,
            NOTICE_CONSUMPTION_STATUS_PENDING_MULTIMODAL_PROCESSING,
        )
        self.assertEqual(
            stored[0].target_surface,
            NOTICE_TARGET_SURFACE_MULTIMODAL_PROCESSING_CANDIDATE,
        )
        self.assertEqual(
            stored[0].role_metadata["processing_gap_reason"],
            "multimodal_retain_guard_failed",
        )
        self.assertEqual(
            stored[0].role_metadata["multimodal_processing_status"],
            "needs_additional_processing",
        )
        self.assertIn("retain_low_confidence", stored[0].role_metadata["multimodal_reasons"])

    def test_no_adoption_with_extracted_text_stays_pending(self) -> None:
        projection_store = InMemoryNoticeConsumptionProjectionStore((_pending_entry("351907"),))
        inventory_store = InMemoryAuthenticatedNoticeSourceTruthInventoryStore()
        inventory_store.upsert_many((_inventory_entry("351907"),))
        processor = _FakeProcessor(
            InternalNoticeMultimodalDecision(
                action="no_adoption",
                summary="图片不是通知。",
                extracted_text="报名截止：2026年5月10日",
                reasons=("decorative_visual_asset",),
                confidence="medium",
            )
        )

        report = process_internal_notice_pending_multimodal_entries(
            notice_ids=("351907",),
            projection_store=projection_store,
            source_truth_inventory_store=inventory_store,
            object_store=_FakeObjectStore(_multimodal_attachment_objects()),
            source_bucket="campus-agent-source",
            processor=processor,
            max_attempts=3,
        )

        self.assertEqual(report.no_adoption_count, 0)
        self.assertEqual(report.still_pending_count, 1)
        stored = projection_store.list_by_scope(
            "campus_notices",
            "internal_notice",
            notice_ids=("351907",),
        )
        self.assertEqual(
            stored[0].consumption_status,
            NOTICE_CONSUMPTION_STATUS_PENDING_MULTIMODAL_PROCESSING,
        )
        self.assertEqual(
            stored[0].role_metadata["processing_gap_reason"],
            "multimodal_no_adoption_guard_failed",
        )
        self.assertIn(
            "no_adoption_with_extracted_text",
            stored[0].role_metadata["multimodal_reasons"],
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
            object_store=_FakeObjectStore(_multimodal_attachment_objects()),
            source_bucket="campus-agent-source",
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
        self.assertEqual(
            attempts[0].admission_batch_id,
            "",
        )

    def test_processor_exception_closes_after_max_attempts(self) -> None:
        projection_store = InMemoryNoticeConsumptionProjectionStore((_pending_entry("351907"),))
        inventory_store = InMemoryAuthenticatedNoticeSourceTruthInventoryStore()
        inventory_store.upsert_many((_inventory_entry("351907"),))
        attempt_store = InMemoryInternalNoticeMultimodalAttemptStore()

        report = process_internal_notice_pending_multimodal_entries(
            notice_ids=("351907",),
            projection_store=projection_store,
            source_truth_inventory_store=inventory_store,
            object_store=_FakeObjectStore(_multimodal_attachment_objects()),
            source_bucket="campus-agent-source",
            processor=_FailingProcessor(RuntimeError("provider timeout")),
            attempt_store=attempt_store,
            max_attempts=1,
        )

        self.assertEqual(report.failed_count, 1)
        self.assertEqual(report.no_adoption_count, 1)
        self.assertEqual(report.still_pending_count, 0)
        attempts = attempt_store.list_by_unit("notice_unit:351907:pending_multimodal")
        self.assertEqual(len(attempts), 1)
        self.assertEqual(attempts[0].status, "failed_terminal")
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

    def test_processed_multimodal_summary_enters_read_model_content(self) -> None:
        projection_store = InMemoryNoticeConsumptionProjectionStore((_pending_entry("351907"),))
        inventory_store = InMemoryAuthenticatedNoticeSourceTruthInventoryStore()
        inventory_store.upsert_many((_inventory_entry("351907"),))
        processor = _FakeProcessor(
            InternalNoticeMultimodalDecision(
                action="retain_for_notice_query",
                summary="图中说明丰台校区校园卡业务办理地点。",
                extracted_text="北区服务大厅办理校园卡业务。",
                reasons=("visual_text_extracted",),
                confidence="high",
            )
        )

        process_internal_notice_pending_multimodal_entries(
            notice_ids=("351907",),
            projection_store=projection_store,
            source_truth_inventory_store=inventory_store,
            object_store=_FakeObjectStore(_multimodal_attachment_objects()),
            source_bucket="campus-agent-source",
            processor=processor,
        )

        record = _record(
            notice_id="351907",
            title_slug="campus-card-map",
            content_hash="sha256:campus-card-map",
            body_key="campus_notices/documents/internal_notice/351907/canonical.md",
            units_key="campus_notices/documents/internal_notice/351907/document-units.jsonl",
            is_current=True,
        )
        object_store = _FakeObjectStore(
            {
                (
                    "campus-agent-derived",
                    record.canonical_markdown_object_key,
                ): _canonical_markdown("# 校园卡业务办理地点通知\n\n见附件示意图。"),
            }
        )
        rows = build_internal_notice_read_model_entries(
            projection_store.list_by_scope(
                "campus_notices",
                "internal_notice",
                notice_ids=("351907",),
            ),
            registry=InMemoryDocumentRegistry((record,)),
            object_store=object_store,
            bucket_derived="campus-agent-derived",
        )

        self.assertEqual(len(rows), 1)
        self.assertTrue(rows[0].queryable)
        self.assertIn("丰台校区校园卡业务办理地点", rows[0].body_excerpt)
        self.assertIn("北区服务大厅办理校园卡业务", rows[0].search_text)

    def test_attempt_store_builder_fails_closed_after_python_db_runtime_retirement(self) -> None:
        with self.assertRaisesRegex(RuntimeError, "Python database runtime is retired"):
            build_internal_notice_multimodal_attempt_store_from_env(
                {
                    "INTERNAL_NOTICE_MULTIMODAL_ATTEMPT_DATABASE_URL": "postgresql://attempt/db",
                    "CAMPUS_SHARED_POSTGRES_URL": "postgresql://shared/db",
                }
            )

    def test_attempt_store_builder_rejects_admission_url_after_python_db_runtime_retirement(
        self,
    ) -> None:
        with self.assertRaisesRegex(
            RuntimeError,
            "Python database runtime is retired",
        ):
            build_internal_notice_multimodal_attempt_store_from_env(
                {
                    "INTERNAL_NOTICE_CONSUMPTION_ADMISSION_DATABASE_URL": "postgresql://admission/db",
                }
            )

    def test_process_pending_multimodal_requires_selected_notice_ids(self) -> None:
        with self.assertRaisesRegex(ValueError, "selected notice_ids are required"):
            process_internal_notice_pending_multimodal_entries(
                projection_store=InMemoryNoticeConsumptionProjectionStore(),
                source_truth_inventory_store=InMemoryAuthenticatedNoticeSourceTruthInventoryStore(),
                object_store=_FakeObjectStore({}),
                source_bucket="campus-agent-source",
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

    def test_select_pending_multimodal_notice_ids_reads_projection_only(self) -> None:
        projection_store = InMemoryNoticeConsumptionProjectionStore(
            (
                _pending_entry("351907"),
                _notice_window_entry("351907"),
                _pending_entry("355222"),
            )
        )

        pending_notice_ids = select_internal_notice_pending_multimodal_notice_ids(
            projection_store=projection_store,
            source_corpus="campus_notices",
            source_collection="internal_notice",
            limit=1,
        )

        self.assertEqual(pending_notice_ids, ("351907",))

    def test_drain_pending_multimodal_batches_projection_selected_pending_notices(
        self,
    ) -> None:
        projection_store = InMemoryNoticeConsumptionProjectionStore(
            (
                _pending_entry("351907"),
                _pending_entry("355222"),
                _notice_window_entry("355333"),
            )
        )
        inventory_store = InMemoryAuthenticatedNoticeSourceTruthInventoryStore()
        inventory_store.upsert_many(
            (
                _inventory_entry("351907"),
                _inventory_entry("355222"),
            )
        )
        attempt_store = InMemoryInternalNoticeMultimodalAttemptStore()
        processor = _FakeProcessor(
            InternalNoticeMultimodalDecision(
                action="retain_for_notice_query",
                summary="图片可用于通知问答。",
                extracted_text="服务大厅。",
                reasons=("visual_text_extracted",),
                confidence="high",
            )
        )

        report = drain_internal_notice_pending_multimodal_entries(
            projection_store=projection_store,
            source_truth_inventory_store=inventory_store,
            object_store=_FakeObjectStore(_multimodal_attachment_objects(("351907", "355222"))),
            source_bucket="campus-agent-source",
            processor=processor,
            attempt_store=attempt_store,
            limit=10,
            batch_size=1,
            admission_batch_id="batch-drain-001",
            admission_command="multimodal_drain",
            admission_created_at="2026-04-25T00:00:00Z",
        )

        self.assertEqual(report.pending_notice_ids, ("351907", "355222"))
        self.assertEqual(report.batch_count, 2)
        self.assertEqual(report.processed_count, 2)
        self.assertEqual(len(processor.requests), 2)
        attempts = attempt_store.list_by_unit("notice_unit:351907:pending_multimodal")
        self.assertEqual(attempts[0].admission_batch_id, "batch-drain-001")
        stored = projection_store.list_by_scope(
            "campus_notices",
            "internal_notice",
            notice_ids=("351907", "355222"),
        )
        self.assertEqual(
            {
                entry.source_notice_id
                for entry in stored
                if entry.consumption_status == NOTICE_CONSUMPTION_STATUS_RETAINED_FOR_NOTICE_QUERY
            },
            {"351907", "355222"},
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

    def test_processor_builder_selects_agents_sdk_runtime_when_requested(self) -> None:
        processor = build_internal_notice_multimodal_processor_from_env(
            {
                "INTERNAL_NOTICE_MULTIMODAL_RUNTIME": "agents_sdk",
                "INTERNAL_NOTICE_MULTIMODAL_API_KEY": "test-key",
                "INTERNAL_NOTICE_MULTIMODAL_MODEL": "gpt-4.1-mini",
            }
        )

        self.assertIsInstance(processor, AgentsSdkInternalNoticeMultimodalProcessor)


if __name__ == "__main__":
    unittest.main()
