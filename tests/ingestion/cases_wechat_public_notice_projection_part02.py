from __future__ import annotations

import json
import unittest

from tests.ingestion.wechat_public_notice_projection_test_support import (
    NOTICE_CONSUMPTION_STATUS_NO_ADOPTION,
    NOTICE_CONSUMPTION_STATUS_RETAINED_FOR_NOTICE_QUERY,
    NOTICE_SOURCE_FAMILY_OFFICIAL_WEB_PUBLIC,
    NOTICE_SOURCE_FAMILY_WECHAT_PUBLIC,
    NOTICE_TARGET_SURFACE_NOTICE_LEVEL_QUERY,
    NOTICE_TARGET_SURFACE_UNSUPPORTED,
    WECHAT_PUBLIC_NOTICE_MULTIMODAL_OCR_MANIFEST_SCHEMA,
    InMemoryInternalNoticeReadModelStore,
    InMemoryNoticeConsumptionProjectionStore,
    WeChatPublicNoticeProjectionRequest,
    _build_source_truth_fixture,
    _FakeDerivedObjectStore,
    _projection_entry,
    build_wechat_public_notice_inline_image_artifact_keys,
    materialize_wechat_public_notice_read_model,
    rebuild_wechat_public_notice_projection,
)


class WeChatPublicNoticeProjectionTestPart02(unittest.TestCase):
    def test_rebuild_reopens_captured_inline_image_articles_after_admitted_ocr(self) -> None:
        object_store, refs = _build_source_truth_fixture(
            bucket="source",
            prefix="wechat_official_account/muc/2026/woa_ver_multimodal_ready",
            article_stable_id="woa_article_multimodal_ready",
            normalized_article_url="https://mp.weixin.qq.com/s/multimodal-ready",
            publish_time="2026-04-20T08:00:00+08:00",
            provider_article_id="feedwe-multimodal-ready",
            title_raw="实践周班车安排图示",
            title_normalized="实践周班车安排图示",
            body_state="captured",
            inline_image_urls=("https://cdn.example.com/inline-1.png",),
        )
        inline_ref_id = "woa_article_multimodal_ready:media:1"
        artifact_keys = build_wechat_public_notice_inline_image_artifact_keys(
            media_refs_key=refs.media_refs_key,
            media_ref_id=inline_ref_id,
        )
        object_store.payloads[("source", artifact_keys.ocr_manifest_key)] = json.dumps(
            {
                "schema_version": WECHAT_PUBLIC_NOTICE_MULTIMODAL_OCR_MANIFEST_SCHEMA,
                "source_notice_id": "woa_article_multimodal_ready",
                "source_collection": "wechat_public_notice",
                "media_ref_id": inline_ref_id,
                "status": "admitted",
                "provider": "openai-chat-completions",
                "model": "gpt-4.1-mini",
                "confidence": "high",
                "summary": "图中列出了实践周班车加车安排。",
                "extracted_text": "4月22日 08:00 海淀校区发车；18:30 丰台校区返程。",
                "provider_response_key": "capture/provider-response.jsonl",
                "layout_elements_key": "capture/layout-elements.jsonl",
                "child_document_id": "wechat_notice_image:muc:woa_article_multimodal_ready:media-1",
                "child_canonical_markdown_key": "derived/child.md",
                "child_document_units_key": "derived/child.jsonl",
                "processed_at": "2026-04-28T10:00:00+08:00",
                "error": "",
                "image_object_key": "wechat_official_account/muc/2026/woa_ver_multimodal_ready/capture/media/inline-1/original.png",
                "ocr_manifest_key": artifact_keys.ocr_manifest_key,
            },
            ensure_ascii=False,
        ).encode("utf-8")

        report = rebuild_wechat_public_notice_projection(
            request=WeChatPublicNoticeProjectionRequest(artifact_refs=(refs,)),
            object_store=object_store,
            projection_store=InMemoryNoticeConsumptionProjectionStore(),
            dry_run=True,
        )

        entry = report.projection_entries[0]
        self.assertEqual(entry.target_surface, NOTICE_TARGET_SURFACE_NOTICE_LEVEL_QUERY)
        self.assertEqual(
            entry.consumption_status, NOTICE_CONSUMPTION_STATUS_RETAINED_FOR_NOTICE_QUERY
        )
        self.assertEqual(entry.role_metadata.get("ocr_status"), "admitted")
        self.assertIn("加车安排", str(entry.role_metadata.get("multimodal_summary")))
        self.assertIn("08:00", str(entry.role_metadata.get("multimodal_extracted_text")))

        derived_store = _FakeDerivedObjectStore()
        rows = materialize_wechat_public_notice_read_model(
            projection_entries=report.projection_entries,
            read_model_store=InMemoryInternalNoticeReadModelStore(),
            source_object_store=object_store,
            derived_object_store=derived_store,
            source_bucket="source",
            derived_bucket="derived",
        )

        self.assertEqual(len(rows), 1)
        self.assertTrue(rows[0].queryable)
        self.assertIn("08:00", rows[0].body_excerpt)
        self.assertIn("08:00", rows[0].search_text)
        canonical_payload = derived_store.payloads[
            ("derived", rows[0].canonical_markdown_object_key)
        ].decode("utf-8")
        self.assertIn("## OCR Summary", canonical_payload)
        self.assertIn("4月22日 08:00", canonical_payload)

    def test_rebuild_closes_captured_inline_image_articles_on_terminal_ocr_failure(self) -> None:
        object_store, refs = _build_source_truth_fixture(
            bucket="source",
            prefix="wechat_official_account/muc/2026/woa_ver_multimodal_failed",
            article_stable_id="woa_article_multimodal_failed",
            normalized_article_url="https://mp.weixin.qq.com/s/multimodal-failed",
            publish_time="2026-04-20T08:00:00+08:00",
            provider_article_id="feedwe-multimodal-failed",
            title_raw="实践周班车安排图示",
            title_normalized="实践周班车安排图示",
            body_state="captured",
            body_block_texts=("详情见配图。",),
            inline_image_urls=("https://cdn.example.com/inline-1.png",),
        )
        inline_ref_id = "woa_article_multimodal_failed:media:1"
        artifact_keys = build_wechat_public_notice_inline_image_artifact_keys(
            media_refs_key=refs.media_refs_key,
            media_ref_id=inline_ref_id,
        )
        object_store.payloads[("source", artifact_keys.ocr_manifest_key)] = json.dumps(
            {
                "schema_version": WECHAT_PUBLIC_NOTICE_MULTIMODAL_OCR_MANIFEST_SCHEMA,
                "source_notice_id": "woa_article_multimodal_failed",
                "source_collection": "wechat_public_notice",
                "media_ref_id": inline_ref_id,
                "status": "ocr_failed",
                "provider": "",
                "model": "",
                "confidence": "",
                "summary": "",
                "extracted_text": "",
                "provider_response_key": "",
                "layout_elements_key": "",
                "child_document_id": "",
                "child_canonical_markdown_key": "",
                "child_document_units_key": "",
                "processed_at": "2026-04-28T10:00:00+08:00",
                "error": "provider timeout",
                "image_object_key": "wechat_official_account/muc/2026/woa_ver_multimodal_failed/capture/media/inline-1/original.png",
                "ocr_manifest_key": artifact_keys.ocr_manifest_key,
            },
            ensure_ascii=False,
        ).encode("utf-8")

        report = rebuild_wechat_public_notice_projection(
            request=WeChatPublicNoticeProjectionRequest(artifact_refs=(refs,)),
            object_store=object_store,
            projection_store=InMemoryNoticeConsumptionProjectionStore(),
            dry_run=True,
        )

        entry = report.projection_entries[0]
        self.assertEqual(entry.target_surface, NOTICE_TARGET_SURFACE_UNSUPPORTED)
        self.assertEqual(entry.consumption_status, NOTICE_CONSUMPTION_STATUS_NO_ADOPTION)
        self.assertEqual(entry.role_metadata.get("ocr_status"), "terminal_failure")
        self.assertEqual(
            entry.role_metadata.get("multimodal_processing_status"),
            "terminal_failure",
        )
        self.assertEqual(
            entry.role_metadata.get("processing_gap_reason"),
            "multimodal_terminal_failure",
        )

    def test_rebuild_closes_captured_inline_image_articles_when_source_capture_failed(
        self,
    ) -> None:
        object_store, refs = _build_source_truth_fixture(
            bucket="source",
            prefix="wechat_official_account/muc/2026/woa_ver_multimodal_source_failed",
            article_stable_id="woa_article_multimodal_source_failed",
            normalized_article_url="https://mp.weixin.qq.com/s/multimodal-source-failed",
            publish_time="2026-04-20T08:00:00+08:00",
            provider_article_id="feedwe-multimodal-source-failed",
            title_raw="实践周班车安排图示",
            title_normalized="实践周班车安排图示",
            body_state="captured",
            body_block_texts=("详情见配图。",),
            inline_image_urls=("https://cdn.example.com/inline-1.png",),
            manifest_overrides={
                "capturedInlineImageCount": 0,
                "failedInlineImageCount": 1,
            },
        )
        media_rows = [
            json.loads(line)
            for line in object_store.payloads[("source", refs.media_refs_key)]
            .decode("utf-8")
            .splitlines()
            if line.strip()
        ]
        media_rows[1]["captureStatus"] = "fetch_failed"
        media_rows[1]["objectKey"] = None
        media_rows[1]["contentSha256"] = None
        media_rows[1]["mimeType"] = None
        media_rows[1]["byteSize"] = None
        media_rows[1]["finalUrl"] = None
        media_rows[1]["fetchErrorMessage"] = "403 Forbidden"
        object_store.payloads[("source", refs.media_refs_key)] = (
            "\n".join(json.dumps(row, ensure_ascii=False) for row in media_rows) + "\n"
        ).encode("utf-8")

        report = rebuild_wechat_public_notice_projection(
            request=WeChatPublicNoticeProjectionRequest(artifact_refs=(refs,)),
            object_store=object_store,
            projection_store=InMemoryNoticeConsumptionProjectionStore(),
            dry_run=True,
        )

        entry = report.projection_entries[0]
        self.assertEqual(entry.target_surface, NOTICE_TARGET_SURFACE_UNSUPPORTED)
        self.assertEqual(entry.consumption_status, NOTICE_CONSUMPTION_STATUS_NO_ADOPTION)
        self.assertEqual(entry.role_metadata.get("ocr_status"), "terminal_failure")
        self.assertEqual(
            entry.role_metadata.get("capture_gate_status"), "multimodal_terminal_failure"
        )
        self.assertEqual(
            entry.role_metadata.get("processing_gap_reason"),
            "multimodal_terminal_failure",
        )

    def test_rebuild_suppresses_duplicate_with_official_notice_precedence(self) -> None:
        object_store, refs = _build_source_truth_fixture(
            bucket="source",
            prefix="wechat_official_account/muc/2026/woa_ver_duplicate",
            article_stable_id="woa_article_duplicate",
            normalized_article_url="https://mp.weixin.qq.com/s/duplicate",
            publish_time="2026-04-20T08:00:00+08:00",
            provider_article_id="feedwe-duplicate",
            title_raw="校园开放日活动安排",
            title_normalized="校园开放日活动安排",
        )
        existing = _projection_entry(
            source_family=NOTICE_SOURCE_FAMILY_OFFICIAL_WEB_PUBLIC,
            source_collection="internal_notice",
            source_notice_id="official:notice:001",
            title_normalized="校园开放日活动安排",
            publish_time="2026-04-20T11:00:00+08:00",
            normalized_article_url="https://mp.weixin.qq.com/s/duplicate",
        )
        projection_store = InMemoryNoticeConsumptionProjectionStore((existing,))

        report = rebuild_wechat_public_notice_projection(
            request=WeChatPublicNoticeProjectionRequest(
                artifact_refs=(refs,),
                reference_scopes=(("campus_notices", "internal_notice"),),
            ),
            object_store=object_store,
            projection_store=projection_store,
            dry_run=True,
        )

        self.assertEqual(report.retained_count, 0)
        self.assertEqual(report.duplicate_suppressed_count, 1)
        self.assertEqual(
            report.duplicate_source_family_counts,
            {NOTICE_SOURCE_FAMILY_OFFICIAL_WEB_PUBLIC: 1},
        )
        entry = report.projection_entries[0]
        self.assertEqual(entry.target_surface, NOTICE_TARGET_SURFACE_UNSUPPORTED)
        self.assertEqual(entry.consumption_status, NOTICE_CONSUMPTION_STATUS_NO_ADOPTION)
        self.assertEqual(
            entry.role_metadata.get("duplicate_of_source_family"),
            NOTICE_SOURCE_FAMILY_OFFICIAL_WEB_PUBLIC,
        )
        self.assertEqual(entry.role_metadata.get("dedupe_status"), "suppressed_duplicate")

    def test_rebuild_is_idempotent_when_existing_wechat_notice_is_same_article(self) -> None:
        object_store, refs = _build_source_truth_fixture(
            bucket="source",
            prefix="wechat_official_account/muc/2026/woa_ver_same",
            article_stable_id="woa_article_same",
            normalized_article_url="https://mp.weixin.qq.com/s/same",
            publish_time="2026-04-21T08:00:00+08:00",
            provider_article_id="feedwe-same",
            title_raw="奖学金申请说明",
            title_normalized="奖学金申请说明",
            body_state="captured",
            body_block_texts=("奖学金申请正文",),
        )
        existing = _projection_entry(
            source_family=NOTICE_SOURCE_FAMILY_WECHAT_PUBLIC,
            source_collection="wechat_public_notice",
            source_notice_id="woa_article_same",
            title_normalized="奖学金申请说明",
            publish_time="2026-04-21T08:00:00+08:00",
            normalized_article_url="https://mp.weixin.qq.com/s/same",
            provider_article_id="feedwe-same",
            account_slug="muc",
            body_state="captured",
        )
        projection_store = InMemoryNoticeConsumptionProjectionStore((existing,))

        report = rebuild_wechat_public_notice_projection(
            request=WeChatPublicNoticeProjectionRequest(artifact_refs=(refs,)),
            object_store=object_store,
            projection_store=projection_store,
            dry_run=True,
        )

        self.assertEqual(report.retained_count, 1)
        self.assertEqual(report.duplicate_suppressed_count, 0)
        entry = report.projection_entries[0]
        self.assertEqual(entry.target_surface, NOTICE_TARGET_SURFACE_NOTICE_LEVEL_QUERY)
        self.assertEqual(
            entry.consumption_status, NOTICE_CONSUMPTION_STATUS_RETAINED_FOR_NOTICE_QUERY
        )
