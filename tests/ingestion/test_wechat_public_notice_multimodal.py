from __future__ import annotations

import json
import unittest

from campus_ingestion_core.notice_consumption_projection import (
    NOTICE_ANSWERABILITY_REFERENCE_ONLY,
    NOTICE_COMPLETENESS_REQUIRES_MULTIMODAL_PROCESSING,
    NOTICE_CONSUMPTION_STATUS_PENDING_MULTIMODAL_PROCESSING,
    NOTICE_DEFAULT_AGENT_NOTICE,
    NOTICE_TARGET_SURFACE_MULTIMODAL_PROCESSING_CANDIDATE,
    NoticeConsumptionProjectionEntry,
)
from campus_ingestion_core.wechat_public_notice_multimodal import (
    ChatCompletionsWeChatPublicNoticeMultimodalProvider,
    InMemoryWeChatPublicNoticeMultimodalAttemptStore,
    WeChatPublicNoticeMultimodalAttempt,
    WeChatPublicNoticeMultimodalProviderResult,
    build_wechat_public_notice_inline_image_artifact_keys,
    build_wechat_public_notice_multimodal_attempt_store_from_env,
    load_wechat_public_notice_inline_image_outcome,
    process_wechat_public_notice_pending_multimodal_entries,
)

from tests.support.in_memory_registry import InMemoryDocumentRegistry


class _FakeObjectStore:
    def __init__(self, payloads: dict[tuple[str, str], bytes]) -> None:
        self.payloads = dict(payloads)

    def get_bytes(self, *, bucket: str, key: str) -> bytes:
        return self.payloads[(bucket, key)]

    def put_bytes(
        self,
        *,
        bucket: str,
        key: str,
        data: bytes,
        content_type: str,
    ) -> None:
        self.payloads[(bucket, key)] = data


class _FakeProvider:
    def __init__(self, response: WeChatPublicNoticeMultimodalProviderResult | Exception) -> None:
        self.response = response
        self.calls = []

    def process(self, request):
        self.calls.append(request)
        if isinstance(self.response, Exception):
            raise self.response
        return self.response


class WeChatPublicNoticeMultimodalProcessingTest(unittest.TestCase):
    def test_process_pending_multimodal_entries_writes_manifests_and_child_document(self) -> None:
        projection_store = _InMemoryProjectionStore((_pending_entry("woa_article_1"),))
        image_object_key = "wechat/woa_article_1/capture/media/inline-1/original.png"
        object_store = _FakeObjectStore(
            {
                ("source", "wechat/woa_article_1/source-truth/media-refs.jsonl"): _media_refs_jsonl(
                    article_id="woa_article_1",
                    image_url="https://cdn.example.com/inline-1.png",
                    image_object_key=image_object_key,
                ),
                ("source", image_object_key): b"PNGDATA",
            }
        )
        registry = InMemoryDocumentRegistry()
        attempt_store = InMemoryWeChatPublicNoticeMultimodalAttemptStore()
        provider = _FakeProvider(
            WeChatPublicNoticeMultimodalProviderResult(
                provider="openai-chat-completions",
                model="gpt-4.1-mini",
                confidence="high",
                has_meaningful_text=True,
                summary="图中列出班车时间。",
                extracted_text="4月22日 08:00 海淀发车；18:30 丰台返程。",
                layout_elements=({"kind": "paragraph", "text": "4月22日 08:00 海淀发车"},),
                raw_response={"ok": True},
            )
        )

        report = process_wechat_public_notice_pending_multimodal_entries(
            source_corpus="campus_notices",
            source_collection="wechat_public_notice",
            notice_ids=("woa_article_1",),
            projection_store=projection_store,
            object_store=object_store,
            registry=registry,
            source_bucket="source",
            derived_bucket="derived",
            provider=provider,
            attempt_store=attempt_store,
            admission_batch_id="wechat-mm-001",
        )

        self.assertEqual(report.pending_entry_count, 1)
        self.assertEqual(report.scanned_image_count, 1)
        self.assertEqual(report.attempted_image_count, 1)
        self.assertEqual(report.admitted_count, 1)
        self.assertEqual(report.terminal_failure_count, 0)
        self.assertEqual(report.still_pending_count, 0)

        artifact_keys = build_wechat_public_notice_inline_image_artifact_keys(
            media_refs_key="wechat/woa_article_1/source-truth/media-refs.jsonl",
            media_ref_id="woa_article_1:media:1",
        )
        outcome = load_wechat_public_notice_inline_image_outcome(
            object_store=object_store,
            bucket="source",
            media_refs_key="wechat/woa_article_1/source-truth/media-refs.jsonl",
            inline_ref=_inline_ref("woa_article_1"),
        )
        self.assertEqual(outcome.status, "admitted")
        self.assertTrue(object_store.payloads[("source", artifact_keys.ocr_manifest_key)])
        self.assertNotIn(("source", artifact_keys.fetch_manifest_key), object_store.payloads)
        registry_records = registry.list_by_scope("campus_notices", "wechat_public_notice")
        self.assertEqual(len(registry_records), 1)
        self.assertTrue(registry_records[0].is_current)
        self.assertTrue(registry_records[0].canonical_markdown_object_key)
        self.assertEqual(
            len(
                attempt_store.list_by_image(
                    source_notice_id="woa_article_1",
                    media_ref_id="woa_article_1:media:1",
                )
            ),
            1,
        )

    def test_process_pending_multimodal_entries_retries_before_terminal_ocr_failure(self) -> None:
        projection_store = _InMemoryProjectionStore((_pending_entry("woa_article_retry"),))
        image_object_key = "wechat/woa_article_retry/capture/media/inline-1/original.png"
        object_store = _FakeObjectStore(
            {
                (
                    "source",
                    "wechat/woa_article_retry/source-truth/media-refs.jsonl",
                ): _media_refs_jsonl(
                    article_id="woa_article_retry",
                    image_url="https://cdn.example.com/inline-1.png",
                    image_object_key=image_object_key,
                ),
                ("source", image_object_key): b"PNGDATA",
            }
        )
        registry = InMemoryDocumentRegistry()
        attempt_store = InMemoryWeChatPublicNoticeMultimodalAttemptStore()
        provider = _FakeProvider(RuntimeError("provider timeout"))

        first = process_wechat_public_notice_pending_multimodal_entries(
            source_corpus="campus_notices",
            source_collection="wechat_public_notice",
            notice_ids=("woa_article_retry",),
            projection_store=projection_store,
            object_store=object_store,
            registry=registry,
            source_bucket="source",
            derived_bucket="derived",
            provider=provider,
            attempt_store=attempt_store,
            max_attempts=2,
            admission_batch_id="wechat-mm-002",
        )
        second = process_wechat_public_notice_pending_multimodal_entries(
            source_corpus="campus_notices",
            source_collection="wechat_public_notice",
            notice_ids=("woa_article_retry",),
            projection_store=projection_store,
            object_store=object_store,
            registry=registry,
            source_bucket="source",
            derived_bucket="derived",
            provider=provider,
            attempt_store=attempt_store,
            max_attempts=2,
            admission_batch_id="wechat-mm-003",
        )

        self.assertEqual(first.still_pending_count, 1)
        self.assertEqual(first.terminal_failure_count, 0)
        self.assertEqual(second.still_pending_count, 0)
        self.assertEqual(second.terminal_failure_count, 1)
        artifact_keys = build_wechat_public_notice_inline_image_artifact_keys(
            media_refs_key="wechat/woa_article_retry/source-truth/media-refs.jsonl",
            media_ref_id="woa_article_retry:media:1",
        )
        ocr_manifest = json.loads(
            object_store.payloads[("source", artifact_keys.ocr_manifest_key)].decode("utf-8")
        )
        self.assertEqual(ocr_manifest["status"], "ocr_failed")
        self.assertEqual(len(registry.list_by_scope("campus_notices", "wechat_public_notice")), 0)

    def test_attempt_lookup_is_scoped_by_corpus_and_collection(self) -> None:
        existing = WeChatPublicNoticeMultimodalAttempt(
            source_corpus="campus_notices",
            source_collection="other_collection",
            source_notice_id="woa_article_scope",
            unit_id="notice_unit:wechat:woa_article_scope",
            media_ref_id="woa_article_scope:media:1",
            attempt_number=1,
            admission_batch_id="other-batch",
            status="ocr_failed",
            provider="",
            model="",
            fetch_manifest_key="",
            ocr_manifest_key="",
            provider_response_key="",
            layout_elements_key="",
            error="other scope",
            created_at="2026-04-28T00:00:00+08:00",
        )
        projection_store = _InMemoryProjectionStore((_pending_entry("woa_article_scope"),))
        image_object_key = "wechat/woa_article_scope/capture/media/inline-1/original.png"
        object_store = _FakeObjectStore(
            {
                (
                    "source",
                    "wechat/woa_article_scope/source-truth/media-refs.jsonl",
                ): _media_refs_jsonl(
                    article_id="woa_article_scope",
                    image_url="https://cdn.example.com/inline-1.png",
                    image_object_key=image_object_key,
                ),
                ("source", image_object_key): b"PNGDATA",
            }
        )
        attempt_store = InMemoryWeChatPublicNoticeMultimodalAttemptStore((existing,))
        provider = _FakeProvider(RuntimeError("provider timeout"))

        report = process_wechat_public_notice_pending_multimodal_entries(
            source_corpus="campus_notices",
            source_collection="wechat_public_notice",
            notice_ids=("woa_article_scope",),
            projection_store=projection_store,
            object_store=object_store,
            registry=InMemoryDocumentRegistry(),
            source_bucket="source",
            derived_bucket="derived",
            provider=provider,
            attempt_store=attempt_store,
            max_attempts=2,
            admission_batch_id="wechat-mm-scope",
        )

        self.assertEqual(report.still_pending_count, 1)
        self.assertEqual(report.terminal_failure_count, 0)
        current_scope_attempts = attempt_store.list_by_image(
            source_corpus="campus_notices",
            source_collection="wechat_public_notice",
            source_notice_id="woa_article_scope",
            media_ref_id="woa_article_scope:media:1",
        )
        self.assertEqual(len(current_scope_attempts), 1)
        self.assertEqual(current_scope_attempts[0].attempt_number, 1)

    def test_attempt_store_builder_rejects_document_registry_url_without_attempt_or_shared_url(
        self,
    ) -> None:
        with self.assertRaisesRegex(
            RuntimeError,
            "Python database runtime is retired",
        ):
            build_wechat_public_notice_multimodal_attempt_store_from_env(
                {"DOCUMENT_REGISTRY_DATABASE_URL": "postgresql://registry.example/postgres"}
            )

    def test_attempt_store_builder_rejects_document_registry_operator_url_without_attempt_or_shared_operator_url(
        self,
    ) -> None:
        with self.assertRaisesRegex(
            RuntimeError,
            "Python database runtime is retired",
        ):
            build_wechat_public_notice_multimodal_attempt_store_from_env(
                {
                    "DOCUMENT_REGISTRY_OPERATOR_DATABASE_URL": (
                        "postgresql://registry-operator.example/postgres"
                    )
                },
                prefer_operator=True,
            )

    def test_chat_provider_from_env_requires_wechat_specific_credentials(self) -> None:
        with self.assertRaisesRegex(
            ValueError,
            "WECHAT_PUBLIC_NOTICE_MULTIMODAL_API_KEY is required",
        ):
            ChatCompletionsWeChatPublicNoticeMultimodalProvider.from_env(
                {
                    "INTERNAL_NOTICE_SCHEDULE_IMAGE_OCR_API_KEY": "other-lane-key",
                    "LLM_MODEL": "gpt-shared",
                    "LLM_BASE_URL": "https://shared.example/v1",
                }
            )

    def test_chat_provider_from_env_requires_wechat_specific_model(self) -> None:
        with self.assertRaisesRegex(
            ValueError,
            "WECHAT_PUBLIC_NOTICE_MULTIMODAL_MODEL is required",
        ):
            ChatCompletionsWeChatPublicNoticeMultimodalProvider.from_env(
                {
                    "WECHAT_PUBLIC_NOTICE_MULTIMODAL_API_KEY": "test-key",
                    "INTERNAL_NOTICE_SCHEDULE_IMAGE_OCR_MODEL": "gpt-other-lane",
                }
            )


class _InMemoryProjectionStore:
    def __init__(self, entries: tuple[NoticeConsumptionProjectionEntry, ...]) -> None:
        self.entries = entries

    def list_by_scope(self, source_corpus: str, source_collection: str, *, notice_ids=()):
        if not notice_ids:
            return self.entries
        selected = {str(item).strip() for item in notice_ids if str(item).strip()}
        return tuple(entry for entry in self.entries if entry.source_notice_id in selected)


def _pending_entry(source_notice_id: str) -> NoticeConsumptionProjectionEntry:
    return NoticeConsumptionProjectionEntry(
        source_family="wechat_public_notice",
        source_corpus="campus_notices",
        source_collection="wechat_public_notice",
        source_notice_id=source_notice_id,
        unit_id=f"notice_unit:wechat:{source_notice_id}",
        primary_role="notice_window",
        semantic_owner="notice_body",
        default_agent=NOTICE_DEFAULT_AGENT_NOTICE,
        target_surface=NOTICE_TARGET_SURFACE_MULTIMODAL_PROCESSING_CANDIDATE,
        temporal_policy="announcement_window",
        completeness_status=NOTICE_COMPLETENESS_REQUIRES_MULTIMODAL_PROCESSING,
        answerability=NOTICE_ANSWERABILITY_REFERENCE_ONLY,
        consumption_status=NOTICE_CONSUMPTION_STATUS_PENDING_MULTIMODAL_PROCESSING,
        source_notice_document_id=f"wechat_notice:muc:{source_notice_id}",
        source_document_id=f"wechat_notice:muc:{source_notice_id}",
        source_attachment_ref_ids=(f"{source_notice_id}:media:1",),
        role_metadata={
            "account_slug": "muc",
            "notice_title": "实践周班车安排",
            "source_url": f"https://mp.weixin.qq.com/s/{source_notice_id}",
            "publish_time": "2026-04-28T10:00:00+08:00",
            "publish_day": "2026-04-28",
            "media_refs_key": f"wechat/{source_notice_id}/source-truth/media-refs.jsonl",
            "source_bucket": "source",
        },
    )


def _media_refs_jsonl(*, article_id: str, image_url: str, image_object_key: str) -> bytes:
    return (
        "\n".join(
            [
                json.dumps(
                    {
                        "schemaVersion": "wechat_official_account_media_ref.v2",
                        "rawAssetId": f"woa_asset:{article_id}",
                        "rawVersionId": f"woa_ver:{article_id}",
                        "mediaRefId": f"{article_id}:media:1",
                        "refOrder": 1,
                        "resourceRole": "inline_image",
                        "sourceUrl": image_url,
                        "normalizedSourceUrl": image_url,
                        "captureStatus": "captured",
                        "finalUrl": image_url,
                        "objectKey": image_object_key,
                        "contentSha256": "a" * 64,
                        "mimeType": "image/png",
                        "byteSize": 7,
                        "capturedAt": "2026-04-28T10:00:00+08:00",
                        "fetchErrorMessage": None,
                    },
                    ensure_ascii=False,
                )
            ]
        )
        + "\n"
    ).encode("utf-8")


def _inline_ref(article_id: str):
    from campus_ingestion_core.wechat_public_notice_multimodal import (
        WeChatPublicNoticeInlineImageRef,
    )

    return WeChatPublicNoticeInlineImageRef(
        media_ref_id=f"{article_id}:media:1",
        ref_order=1,
        source_url="https://cdn.example.com/inline-1.png",
        normalized_source_url="https://cdn.example.com/inline-1.png",
        capture_status="captured",
        final_url="https://cdn.example.com/inline-1.png",
        object_key=f"wechat/{article_id}/capture/media/inline-1/original.png",
        content_sha256="a" * 64,
        mime_type="image/png",
        byte_size=7,
        captured_at="2026-04-28T10:00:00+08:00",
        fetch_error_message="",
    )


if __name__ == "__main__":
    unittest.main()
