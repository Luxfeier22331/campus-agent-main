from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from tests.ingestion.wechat_public_notice_projection_test_support import (
    NOTICE_CONSUMPTION_STATUS_NO_ADOPTION,
    NOTICE_SOURCE_FAMILY_WECHAT_PUBLIC,
    NOTICE_TARGET_SURFACE_UNSUPPORTED,
    InMemoryInternalNoticeReadModelStore,
    InMemoryNoticeConsumptionProjectionStore,
    NoticeConsumptionProjectionEntry,
    WeChatPublicNoticeProjectionRequest,
    _build_source_truth_fixture,
    _FakeDerivedObjectStore,
    _projection_entry,
    build_wechat_public_notice_read_model_entries,
    materialize_wechat_public_notice_read_model,
    parse_wechat_projection_selection_path,
    rebuild_wechat_public_notice_projection,
)


class WeChatPublicNoticeProjectionTestPart03(unittest.TestCase):
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
