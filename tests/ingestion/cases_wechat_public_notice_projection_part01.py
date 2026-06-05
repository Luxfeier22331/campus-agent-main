from __future__ import annotations

import unittest

from tests.ingestion.wechat_public_notice_projection_test_support import (
    NOTICE_COMPLETENESS_REQUIRES_MULTIMODAL_PROCESSING,
    NOTICE_CONSUMPTION_STATUS_NO_ADOPTION,
    NOTICE_CONSUMPTION_STATUS_PENDING_MULTIMODAL_PROCESSING,
    NOTICE_CONSUMPTION_STATUS_RETAINED_FOR_NOTICE_QUERY,
    NOTICE_SOURCE_FAMILY_WECHAT_PUBLIC,
    NOTICE_TARGET_SURFACE_MULTIMODAL_PROCESSING_CANDIDATE,
    NOTICE_TARGET_SURFACE_NOTICE_LEVEL_QUERY,
    NOTICE_TARGET_SURFACE_UNSUPPORTED,
    InMemoryNoticeConsumptionProjectionStore,
    WeChatPublicNoticeProjectionRequest,
    _build_source_truth_fixture,
    rebuild_wechat_public_notice_projection,
)


class WeChatPublicNoticeProjectionTestPart01(unittest.TestCase):
    def test_rebuild_demotes_uncaptured_unique_wechat_article_to_reference_only(self) -> None:
        object_store, refs = _build_source_truth_fixture(
            bucket="source",
            prefix="wechat_official_account/muc/2026/woa_ver_alpha",
            article_stable_id="woa_article_alpha",
            normalized_article_url="https://mp.weixin.qq.com/s/alpha",
            publish_time="2026-04-20T08:00:00+08:00",
            provider_article_id="feedwe-alpha",
            title_raw="关于教学安排调整的通知",
            title_normalized="关于教学安排调整的通知",
        )
        report = rebuild_wechat_public_notice_projection(
            request=WeChatPublicNoticeProjectionRequest(artifact_refs=(refs,)),
            object_store=object_store,
            projection_store=InMemoryNoticeConsumptionProjectionStore(),
            dry_run=True,
        )

        self.assertEqual(report.total_article_count, 1)
        self.assertEqual(report.retained_count, 0)
        self.assertEqual(report.duplicate_suppressed_count, 0)
        self.assertEqual(report.duplicate_source_family_counts, {})
        self.assertEqual(len(report.projection_entries), 1)
        entry = report.projection_entries[0]
        self.assertEqual(entry.source_family, NOTICE_SOURCE_FAMILY_WECHAT_PUBLIC)
        self.assertEqual(entry.target_surface, NOTICE_TARGET_SURFACE_UNSUPPORTED)
        self.assertEqual(entry.consumption_status, NOTICE_CONSUMPTION_STATUS_NO_ADOPTION)
        self.assertEqual(entry.role_metadata.get("body_state"), "not_captured")
        self.assertEqual(entry.role_metadata.get("provider"), "feedwe")
        self.assertEqual(entry.role_metadata.get("dedupe_status"), "capture_pending")
        self.assertEqual(entry.role_metadata.get("capture_gate_status"), "body_not_captured")
        self.assertEqual(entry.role_metadata.get("ocr_required"), False)

    def test_rebuild_retains_captured_unique_wechat_article_for_notice_query(self) -> None:
        object_store, refs = _build_source_truth_fixture(
            bucket="source",
            prefix="wechat_official_account/muc/2026/woa_ver_captured_unique",
            article_stable_id="woa_article_captured_unique",
            normalized_article_url="https://mp.weixin.qq.com/s/captured-unique",
            publish_time="2026-04-20T08:00:00+08:00",
            provider_article_id="feedwe-captured-unique",
            title_raw="关于教学安排调整的通知",
            title_normalized="关于教学安排调整的通知",
            body_state="captured",
            body_block_texts=("第一段正文",),
        )
        report = rebuild_wechat_public_notice_projection(
            request=WeChatPublicNoticeProjectionRequest(artifact_refs=(refs,)),
            object_store=object_store,
            projection_store=InMemoryNoticeConsumptionProjectionStore(),
            dry_run=True,
        )

        self.assertEqual(report.retained_count, 1)
        entry = report.projection_entries[0]
        self.assertEqual(entry.target_surface, NOTICE_TARGET_SURFACE_NOTICE_LEVEL_QUERY)
        self.assertEqual(
            entry.consumption_status, NOTICE_CONSUMPTION_STATUS_RETAINED_FOR_NOTICE_QUERY
        )
        self.assertEqual(entry.role_metadata.get("dedupe_status"), "unique")
        self.assertEqual(entry.role_metadata.get("capture_gate_status"), "captured_body")

    def test_rebuild_carries_consumer_admission_batch_id_into_projection_metadata(self) -> None:
        object_store, refs = _build_source_truth_fixture(
            bucket="source",
            prefix="wechat_official_account/muc/2026/woa_ver_batch_alpha",
            article_stable_id="woa_article_batch_alpha",
            normalized_article_url="https://mp.weixin.qq.com/s/batch-alpha",
            publish_time="2026-04-20T08:00:00+08:00",
            provider_article_id="feedwe-batch-alpha",
            title_raw="关于教学安排调整的通知",
            title_normalized="关于教学安排调整的通知",
            body_state="captured",
            body_block_texts=("第一段正文",),
        )
        report = rebuild_wechat_public_notice_projection(
            request=WeChatPublicNoticeProjectionRequest(
                artifact_refs=(refs,),
                consumer_admission_batch_id="batch-wechat-001",
            ),
            object_store=object_store,
            projection_store=InMemoryNoticeConsumptionProjectionStore(),
            dry_run=True,
        )

        entry = report.projection_entries[0]
        self.assertEqual(
            entry.role_metadata.get("consumer_admission_batch_id"),
            "batch-wechat-001",
        )

    def test_rebuild_keeps_uncaptured_inline_image_articles_reference_only(self) -> None:
        object_store, refs = _build_source_truth_fixture(
            bucket="source",
            prefix="wechat_official_account/muc/2026/woa_ver_ocr_pending",
            article_stable_id="woa_article_ocr_pending",
            normalized_article_url="https://mp.weixin.qq.com/s/ocr-pending",
            publish_time="2026-04-20T08:00:00+08:00",
            provider_article_id="feedwe-ocr-pending",
            title_raw="详情见配图的通知",
            title_normalized="详情见配图的通知",
            inline_image_urls=("https://cdn.example.com/inline-1.png",),
        )

        report = rebuild_wechat_public_notice_projection(
            request=WeChatPublicNoticeProjectionRequest(artifact_refs=(refs,)),
            object_store=object_store,
            projection_store=InMemoryNoticeConsumptionProjectionStore(),
            dry_run=True,
        )

        entry = report.projection_entries[0]
        self.assertEqual(entry.target_surface, NOTICE_TARGET_SURFACE_UNSUPPORTED)
        self.assertEqual(entry.consumption_status, NOTICE_CONSUMPTION_STATUS_NO_ADOPTION)
        self.assertEqual(entry.role_metadata.get("ocr_required"), False)
        self.assertEqual(entry.role_metadata.get("ocr_status"), "not_admitted")
        self.assertEqual(entry.role_metadata.get("capture_gate_status"), "body_not_captured")
        self.assertEqual(entry.role_metadata.get("inline_image_count"), 1)

    def test_rebuild_marks_captured_inline_image_articles_as_pending_multimodal_processing(
        self,
    ) -> None:
        object_store, refs = _build_source_truth_fixture(
            bucket="source",
            prefix="wechat_official_account/muc/2026/woa_ver_multimodal_pending",
            article_stable_id="woa_article_multimodal_pending",
            normalized_article_url="https://mp.weixin.qq.com/s/multimodal-pending",
            publish_time="2026-04-20T08:00:00+08:00",
            provider_article_id="feedwe-multimodal-pending",
            title_raw="实践周班车安排图示",
            title_normalized="实践周班车安排图示",
            body_state="captured",
            body_block_texts=("详情见配图。",),
            inline_image_urls=("https://cdn.example.com/inline-1.png",),
        )

        report = rebuild_wechat_public_notice_projection(
            request=WeChatPublicNoticeProjectionRequest(artifact_refs=(refs,)),
            object_store=object_store,
            projection_store=InMemoryNoticeConsumptionProjectionStore(),
            dry_run=True,
        )

        entry = report.projection_entries[0]
        self.assertEqual(
            entry.target_surface,
            NOTICE_TARGET_SURFACE_MULTIMODAL_PROCESSING_CANDIDATE,
        )
        self.assertEqual(
            entry.consumption_status,
            NOTICE_CONSUMPTION_STATUS_PENDING_MULTIMODAL_PROCESSING,
        )
        self.assertEqual(
            entry.completeness_status,
            NOTICE_COMPLETENESS_REQUIRES_MULTIMODAL_PROCESSING,
        )
        self.assertEqual(entry.role_metadata.get("ocr_required"), True)
        self.assertEqual(entry.role_metadata.get("ocr_status"), "pending")
        self.assertEqual(entry.role_metadata.get("capture_gate_status"), "multimodal_pending")
        self.assertEqual(
            entry.source_attachment_ref_ids,
            ("woa_article_multimodal_pending:media:1",),
        )
