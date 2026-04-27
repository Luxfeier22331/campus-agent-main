from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from campus_ingestion_core.internal_notice_read_model import InMemoryInternalNoticeReadModelStore
from campus_ingestion_core.notice_consumption_projection import (
    NOTICE_CONSUMPTION_STATUS_NO_ADOPTION,
    NOTICE_CONSUMPTION_STATUS_RETAINED_FOR_NOTICE_QUERY,
    NOTICE_SOURCE_FAMILY_OFFICIAL_WEB_PUBLIC,
    NOTICE_SOURCE_FAMILY_WECHAT_PUBLIC,
    NOTICE_TARGET_SURFACE_NOTICE_LEVEL_QUERY,
    NOTICE_TARGET_SURFACE_UNSUPPORTED,
    InMemoryNoticeConsumptionProjectionStore,
    NoticeConsumptionProjectionEntry,
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


class WeChatPublicNoticeProjectionTest(unittest.TestCase):
    def test_rebuild_retains_unique_wechat_article(self) -> None:
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
        self.assertEqual(report.retained_count, 1)
        self.assertEqual(report.duplicate_suppressed_count, 0)
        self.assertEqual(report.duplicate_source_family_counts, {})
        self.assertEqual(len(report.projection_entries), 1)
        entry = report.projection_entries[0]
        self.assertEqual(entry.source_family, NOTICE_SOURCE_FAMILY_WECHAT_PUBLIC)
        self.assertEqual(entry.target_surface, NOTICE_TARGET_SURFACE_NOTICE_LEVEL_QUERY)
        self.assertEqual(
            entry.consumption_status, NOTICE_CONSUMPTION_STATUS_RETAINED_FOR_NOTICE_QUERY
        )
        self.assertEqual(entry.role_metadata.get("body_state"), "not_captured")
        self.assertEqual(entry.role_metadata.get("provider"), "feedwe")
        self.assertEqual(entry.role_metadata.get("dedupe_status"), "unique")

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

    def test_build_wechat_read_model_entries_marks_queryable_by_consumption_and_surface(self) -> None:
        retained_entry = _projection_entry(
            source_family=NOTICE_SOURCE_FAMILY_WECHAT_PUBLIC,
            source_collection="wechat_public_notice",
            source_notice_id="woa_article_queryable",
            title_normalized="保留用于查询",
            publish_time="2026-04-21T08:00:00+08:00",
            normalized_article_url="https://mp.weixin.qq.com/s/queryable",
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
                "source_url": "https://mp.weixin.qq.com/s/suppressed",
            },
        )

        rows = build_wechat_public_notice_read_model_entries((retained_entry, suppressed_entry))

        self.assertEqual(len(rows), 2)
        by_notice_id = {row.source_notice_id: row for row in rows}
        self.assertTrue(by_notice_id["woa_article_queryable"].queryable)
        self.assertFalse(by_notice_id["woa_article_suppressed"].queryable)
        self.assertEqual(
            by_notice_id["woa_article_queryable"].source_url,
            "https://mp.weixin.qq.com/s/queryable",
        )
        self.assertEqual(by_notice_id["woa_article_queryable"].canonical_markdown_object_key, "")

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
    manifest_overrides: dict[str, object] | None = None,
) -> tuple[_FakeObjectStore, WeChatSourceTruthArtifactRefs]:
    refs = WeChatSourceTruthArtifactRefs(
        article_manifest_key=f"{prefix}/source-truth/article-manifest.json",
        content_blocks_key=f"{prefix}/source-truth/content-blocks.jsonl",
        media_refs_key=f"{prefix}/source-truth/media-refs.jsonl",
        bucket=bucket,
    )
    manifest = {
        "schemaVersion": "wechat_official_account_article_manifest.v1",
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
        "bodyState": "not_captured",
        "metadataHash": f"sha256:{article_stable_id}",
        "blockCount": 1,
        "mediaRefCount": 1,
        "availabilityState": "observed",
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
    media_refs = [
        {
            "schemaVersion": "wechat_official_account_media_ref.v1",
            "rawAssetId": manifest["rawAssetId"],
            "rawVersionId": manifest["rawVersionId"],
            "mediaRefId": f"{article_stable_id}:media:0",
            "refOrder": 0,
            "resourceRole": "cover_image",
            "sourceUrl": "https://cdn.example.com/cover.png",
            "normalizedSourceUrl": "https://cdn.example.com/cover.png",
        }
    ]
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
        },
    )


if __name__ == "__main__":
    unittest.main()
