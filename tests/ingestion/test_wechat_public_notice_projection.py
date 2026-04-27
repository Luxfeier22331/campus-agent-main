from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from campus_ingestion_core.internal_notice_read_model import InMemoryInternalNoticeReadModelStore
from campus_ingestion_core.notice_consumption_projection import (
    NOTICE_COMPLETENESS_REQUIRES_MULTIMODAL_PROCESSING,
    NOTICE_CONSUMPTION_STATUS_NO_ADOPTION,
    NOTICE_CONSUMPTION_STATUS_PENDING_MULTIMODAL_PROCESSING,
    NOTICE_CONSUMPTION_STATUS_RETAINED_FOR_NOTICE_QUERY,
    NOTICE_SOURCE_FAMILY_OFFICIAL_WEB_PUBLIC,
    NOTICE_SOURCE_FAMILY_WECHAT_PUBLIC,
    NOTICE_TARGET_SURFACE_MULTIMODAL_PROCESSING_CANDIDATE,
    NOTICE_TARGET_SURFACE_NOTICE_LEVEL_QUERY,
    NOTICE_TARGET_SURFACE_UNSUPPORTED,
    InMemoryNoticeConsumptionProjectionStore,
    NoticeConsumptionProjectionEntry,
)
from campus_ingestion_core.wechat_public_notice_multimodal import (
    WECHAT_PUBLIC_NOTICE_MULTIMODAL_OCR_MANIFEST_SCHEMA,
    build_wechat_public_notice_inline_image_artifact_keys,
)
from campus_ingestion_core.wechat_public_notice_projection import (
    WeChatPublicNoticeProjectionRequest,
    WeChatSourceTruthArtifactRefs,
    build_wechat_public_notice_read_model_entries,
    materialize_wechat_public_notice_read_model,
    parse_wechat_projection_selection_path,
    rebuild_wechat_public_notice_projection,
)


class _FakeObjectStore:
    def __init__(self, payloads: dict[tuple[str, str], bytes]) -> None:
        self.payloads = payloads

    def get_bytes(self, *, bucket: str, key: str) -> bytes:
        return self.payloads[(bucket, key)]


class _FakeDerivedObjectStore:
    def __init__(self) -> None:
        self.payloads: dict[tuple[str, str], bytes] = {}

    def put_bytes(
        self,
        *,
        bucket: str,
        key: str,
        data: bytes,
        content_type: str,
    ) -> None:
        self.payloads[(bucket, key)] = data


class WeChatPublicNoticeProjectionTest(unittest.TestCase):
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

    def test_rebuild_fails_when_source_truth_contains_forbidden_field(self) -> None:
        object_store, refs = _build_source_truth_fixture(
            bucket="source",
            prefix="wechat_official_account/muc/2026/woa_ver_bad",
            article_stable_id="woa_article_bad",
            normalized_article_url="https://mp.weixin.qq.com/s/bad",
            publish_time="2026-04-22T08:00:00+08:00",
            provider_article_id="feedwe-bad",
            title_raw="错误示例",
            title_normalized="错误示例",
            manifest_overrides={"document_id": "forbidden"},
        )
        with self.assertRaisesRegex(ValueError, "forbidden fields"):
            rebuild_wechat_public_notice_projection(
                request=WeChatPublicNoticeProjectionRequest(artifact_refs=(refs,)),
                object_store=object_store,
                projection_store=InMemoryNoticeConsumptionProjectionStore(),
                dry_run=True,
            )

    def test_parse_selection_supports_artifact_object_entries(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            selection_path = Path(temp_dir) / "selection.json"
            selection_path.write_text(
                json.dumps(
                    [
                        {
                            "bucket": "source",
                            "objectKey": (
                                "wechat_official_account/muc/2026/woa_ver_sel/"
                                "source-truth/article-manifest.json"
                            ),
                        }
                    ]
                ),
                encoding="utf-8",
            )
            refs = parse_wechat_projection_selection_path(selection_path)

        self.assertEqual(len(refs), 1)
        self.assertEqual(
            refs[0].article_manifest_key,
            "wechat_official_account/muc/2026/woa_ver_sel/source-truth/article-manifest.json",
        )
        self.assertEqual(
            refs[0].content_blocks_key,
            "wechat_official_account/muc/2026/woa_ver_sel/source-truth/content-blocks.jsonl",
        )
        self.assertEqual(
            refs[0].media_refs_key,
            "wechat_official_account/muc/2026/woa_ver_sel/source-truth/media-refs.jsonl",
        )

    def test_build_wechat_read_model_entries_marks_queryable_by_consumption_and_surface(
        self,
    ) -> None:
        retained_entry = _projection_entry(
            source_family=NOTICE_SOURCE_FAMILY_WECHAT_PUBLIC,
            source_collection="wechat_public_notice",
            source_notice_id="woa_article_queryable",
            title_normalized="保留用于查询",
            publish_time="2026-04-21T08:00:00+08:00",
            normalized_article_url="https://mp.weixin.qq.com/s/queryable",
            body_state="captured",
        )
        suppressed_entry = NoticeConsumptionProjectionEntry(
            source_family=NOTICE_SOURCE_FAMILY_WECHAT_PUBLIC,
            source_corpus="campus_notices",
            source_collection="wechat_public_notice",
            source_notice_id="woa_article_suppressed",
            unit_id="notice_unit:wechat:woa_article_suppressed",
            primary_role="notice_window",
            semantic_owner="notice_body",
            default_agent="notice-agent",
            target_surface=NOTICE_TARGET_SURFACE_UNSUPPORTED,
            temporal_policy="announcement_window",
            completeness_status="reference_only",
            answerability="reference_only",
            consumption_status=NOTICE_CONSUMPTION_STATUS_NO_ADOPTION,
            source_notice_document_id="notice:woa_article_suppressed",
            source_document_id="notice:woa_article_suppressed",
            role_metadata={
                "notice_title": "抑制样例",
                "body_state": "captured",
                "source_url": "https://mp.weixin.qq.com/s/suppressed",
            },
        )
        reference_only_entry = _projection_entry(
            source_family=NOTICE_SOURCE_FAMILY_WECHAT_PUBLIC,
            source_collection="wechat_public_notice",
            source_notice_id="woa_article_reference_only",
            title_normalized="只有链接",
            publish_time="2026-04-21T08:00:00+08:00",
            normalized_article_url="https://mp.weixin.qq.com/s/reference-only",
            body_state="not_captured",
        )

        rows = build_wechat_public_notice_read_model_entries(
            (retained_entry, suppressed_entry, reference_only_entry)
        )

        self.assertEqual(len(rows), 3)
        by_notice_id = {row.source_notice_id: row for row in rows}
        self.assertTrue(by_notice_id["woa_article_queryable"].queryable)
        self.assertFalse(by_notice_id["woa_article_suppressed"].queryable)
        self.assertFalse(by_notice_id["woa_article_reference_only"].queryable)
        self.assertEqual(
            by_notice_id["woa_article_queryable"].source_url,
            "https://mp.weixin.qq.com/s/queryable",
        )

    def test_materialize_wechat_read_model_writes_canonical_markdown_for_captured_body(
        self,
    ) -> None:
        object_store, refs = _build_source_truth_fixture(
            bucket="source",
            prefix="wechat_official_account/muc/2026/woa_ver_captured",
            article_stable_id="woa_article_captured",
            normalized_article_url="https://mp.weixin.qq.com/s/captured",
            publish_time="2026-04-21T08:00:00+08:00",
            provider_article_id="feedwe-captured",
            title_raw="实践周班车安排",
            title_normalized="实践周班车安排",
            body_state="captured",
            body_block_texts=("第一段正文", "第二段正文"),
        )
        report = rebuild_wechat_public_notice_projection(
            request=WeChatPublicNoticeProjectionRequest(artifact_refs=(refs,)),
            object_store=object_store,
            projection_store=InMemoryNoticeConsumptionProjectionStore(),
            dry_run=True,
        )
        derived_store = _FakeDerivedObjectStore()
        read_model_store = InMemoryInternalNoticeReadModelStore()

        rows = materialize_wechat_public_notice_read_model(
            projection_entries=report.projection_entries,
            read_model_store=read_model_store,
            source_object_store=object_store,
            derived_object_store=derived_store,
            source_bucket="source",
            derived_bucket="derived",
        )

        self.assertEqual(len(rows), 1)
        self.assertTrue(rows[0].queryable)
        self.assertTrue(rows[0].canonical_markdown_object_key)
        canonical_payload = derived_store.payloads[
            ("derived", rows[0].canonical_markdown_object_key)
        ].decode("utf-8")
        self.assertIn("# 实践周班车安排", canonical_payload)
        self.assertIn("第一段正文", canonical_payload)
        self.assertIn("第二段正文", canonical_payload)

    def test_materialize_wechat_read_model_replaces_selected_notices(self) -> None:
        stale_entry = _projection_entry(
            source_family=NOTICE_SOURCE_FAMILY_WECHAT_PUBLIC,
            source_collection="wechat_public_notice",
            source_notice_id="woa_article_refresh",
            title_normalized="旧标题",
            publish_time="2026-04-20T08:00:00+08:00",
            normalized_article_url="https://mp.weixin.qq.com/s/refresh-old",
        )
        store = InMemoryInternalNoticeReadModelStore(
            build_wechat_public_notice_read_model_entries((stale_entry,))
        )
        refreshed_entry = _projection_entry(
            source_family=NOTICE_SOURCE_FAMILY_WECHAT_PUBLIC,
            source_collection="wechat_public_notice",
            source_notice_id="woa_article_refresh",
            title_normalized="新标题",
            publish_time="2026-04-21T08:00:00+08:00",
            normalized_article_url="https://mp.weixin.qq.com/s/refresh-new",
        )

        rows = materialize_wechat_public_notice_read_model(
            projection_entries=(refreshed_entry,),
            read_model_store=store,
        )

        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0].source_notice_id, "woa_article_refresh")
        self.assertEqual(rows[0].source_url, "https://mp.weixin.qq.com/s/refresh-new")


def _build_source_truth_fixture(
    *,
    bucket: str,
    prefix: str,
    article_stable_id: str,
    normalized_article_url: str,
    publish_time: str,
    provider_article_id: str,
    title_raw: str,
    title_normalized: str,
    body_state: str = "not_captured",
    body_block_texts: tuple[str, ...] = (),
    inline_image_urls: tuple[str, ...] = (),
    manifest_overrides: dict[str, object] | None = None,
) -> tuple[_FakeObjectStore, WeChatSourceTruthArtifactRefs]:
    refs = WeChatSourceTruthArtifactRefs(
        article_manifest_key=f"{prefix}/source-truth/article-manifest.json",
        content_blocks_key=f"{prefix}/source-truth/content-blocks.jsonl",
        media_refs_key=f"{prefix}/source-truth/media-refs.jsonl",
        bucket=bucket,
    )
    manifest = {
        "schemaVersion": "wechat_official_account_article_manifest.v2",
        "sourceChannel": "wechat_official_account",
        "accountName": "中央民族大学学生会",
        "accountSlug": "muc",
        "articleStableId": article_stable_id,
        "rawAssetId": f"woa_asset:{article_stable_id}",
        "rawVersionId": f"woa_ver:{article_stable_id}",
        "articleUrl": normalized_article_url,
        "normalizedArticleUrl": normalized_article_url,
        "articleIdentityBasis": "article_url",
        "provider": "feedwe",
        "providerArticleId": provider_article_id,
        "capturedAt": "2026-04-22T00:00:00+08:00",
        "titleRaw": title_raw,
        "titleNormalized": title_normalized,
        "publishTime": publish_time,
        "publishTimeSource": "provider",
        "coverImageUrl": "https://cdn.example.com/cover.png",
        "bodyState": body_state,
        "metadataHash": f"sha256:{article_stable_id}",
        "blockCount": 1 + len(body_block_texts),
        "mediaRefCount": 1 + len(inline_image_urls),
        "availabilityState": "observed",
        "captureBoundary": "real_mp_weixin_page",
        "pageKind": "article" if body_state == "captured" else "verification",
        "pageParserVersion": "wechat-page-parser.v1",
        "capturedPageFinalUrl": normalized_article_url,
        "inlineImageCount": len(inline_image_urls),
        "capturedInlineImageCount": len(inline_image_urls),
        "failedInlineImageCount": 0,
    }
    manifest.update(manifest_overrides or {})
    content_blocks = [
        {
            "schemaVersion": "wechat_official_account_content_block.v1",
            "rawAssetId": manifest["rawAssetId"],
            "rawVersionId": manifest["rawVersionId"],
            "rowId": f"{article_stable_id}:block:0",
            "rowIndex": 0,
            "blockOrder": 0,
            "blockRole": "title",
            "textRaw": title_raw,
            "textNormalized": title_normalized,
        }
    ]
    for index, text in enumerate(body_block_texts, start=1):
        content_blocks.append(
            {
                "schemaVersion": "wechat_official_account_content_block.v1",
                "rawAssetId": manifest["rawAssetId"],
                "rawVersionId": manifest["rawVersionId"],
                "rowId": f"{article_stable_id}:block:{index}",
                "rowIndex": index,
                "blockOrder": index,
                "blockRole": "body_paragraph",
                "textRaw": text,
                "textNormalized": text,
            }
        )
    media_refs = [
        {
            "schemaVersion": "wechat_official_account_media_ref.v2",
            "rawAssetId": manifest["rawAssetId"],
            "rawVersionId": manifest["rawVersionId"],
            "mediaRefId": f"{article_stable_id}:media:0",
            "refOrder": 0,
            "resourceRole": "cover_image",
            "sourceUrl": "https://cdn.example.com/cover.png",
            "normalizedSourceUrl": "https://cdn.example.com/cover.png",
            "captureStatus": "captured",
            "finalUrl": "https://cdn.example.com/cover.png",
            "objectKey": f"{prefix}/capture/media/cover/original.png",
            "contentSha256": "c" * 64,
            "mimeType": "image/png",
            "byteSize": 11,
            "capturedAt": "2026-04-22T00:00:00+08:00",
            "fetchErrorMessage": None,
        }
    ]
    for index, image_url in enumerate(inline_image_urls, start=1):
        media_refs.append(
            {
                "schemaVersion": "wechat_official_account_media_ref.v2",
                "rawAssetId": manifest["rawAssetId"],
                "rawVersionId": manifest["rawVersionId"],
                "mediaRefId": f"{article_stable_id}:media:{index}",
                "refOrder": index,
                "resourceRole": "inline_image",
                "sourceUrl": image_url,
                "normalizedSourceUrl": image_url,
                "captureStatus": "captured",
                "finalUrl": image_url,
                "objectKey": f"{prefix}/capture/media/inline-{index}/original.png",
                "contentSha256": str(index) * 64,
                "mimeType": "image/png",
                "byteSize": 100 + index,
                "capturedAt": "2026-04-22T00:00:00+08:00",
                "fetchErrorMessage": None,
            }
        )
    payloads = {
        (bucket, refs.article_manifest_key): json.dumps(manifest, ensure_ascii=False).encode(
            "utf-8"
        ),
        (bucket, refs.content_blocks_key): (
            "\n".join(json.dumps(row, ensure_ascii=False) for row in content_blocks).encode("utf-8")
        ),
        (bucket, refs.media_refs_key): (
            "\n".join(json.dumps(row, ensure_ascii=False) for row in media_refs).encode("utf-8")
        ),
    }
    return _FakeObjectStore(payloads), refs


def _projection_entry(
    *,
    source_family: str,
    source_collection: str,
    source_notice_id: str,
    title_normalized: str,
    publish_time: str,
    normalized_article_url: str,
    provider_article_id: str = "",
    account_slug: str = "",
    body_state: str = "not_captured",
) -> NoticeConsumptionProjectionEntry:
    return NoticeConsumptionProjectionEntry(
        source_family=source_family,
        source_corpus="campus_notices",
        source_collection=source_collection,
        source_notice_id=source_notice_id,
        unit_id=f"notice_unit:{source_family}:{source_notice_id}",
        primary_role="notice_window",
        semantic_owner="notice_body",
        default_agent="notice-agent",
        target_surface=NOTICE_TARGET_SURFACE_NOTICE_LEVEL_QUERY,
        temporal_policy="announcement_window",
        completeness_status="reference_only",
        answerability="reference_only",
        consumption_status=NOTICE_CONSUMPTION_STATUS_RETAINED_FOR_NOTICE_QUERY,
        source_notice_document_id=f"notice:{source_notice_id}",
        source_document_id=f"notice:{source_notice_id}",
        role_metadata={
            "title_normalized": title_normalized,
            "publish_time": publish_time,
            "normalized_article_url": normalized_article_url,
            "provider_article_id": provider_article_id,
            "account_slug": account_slug,
            "body_state": body_state,
        },
    )


if __name__ == "__main__":
    unittest.main()
