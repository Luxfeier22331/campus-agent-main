from __future__ import annotations

import json
import unittest
from dataclasses import replace
from pathlib import Path
from tempfile import TemporaryDirectory

from tests.support.in_memory_registry import InMemoryDocumentRegistry, InMemoryRawAssetRegistry

from .official_web_projection_import_worker_test_support import (
    _document_units_row_for,
    _FakeObjectStore,
    _object_store_settings,
    _projection_document,
    _write_json,
    _write_jsonl,
    worker,
)


class OfficialWebProjectionImportPromotionTest(unittest.TestCase):
    def test_import_projection_output_skips_audit_only_documents_when_required(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            projection_dir = root / "projection-output"
            replay_input_dir = root / "replay-input"
            work_dir = root / "work"

            promotable_canonical_path = projection_dir / "promotable.md"
            promotable_units_path = projection_dir / "promotable.jsonl"
            audit_only_canonical_path = projection_dir / "audit-only.md"
            audit_only_units_path = projection_dir / "audit-only.jsonl"

            projection_report = {
                "schemaVersion": "official_web_projection_replay_report.v1",
                "siteId": "muc_public",
                "crawlRunId": "subset-run-001",
                "outputDir": "/tmp/replay",
                "projectionOutputDir": "/tmp/projection",
                "generatedAt": "2026-04-03T00:00:00+00:00",
                "counts": {"pages_seen": 2, "emitted_documents": 2, "manual_review_pages": 0},
                "documents": [
                    _projection_document(
                        document_id="official_web:muc_public_pages:article_detail:doc-1",
                        version_id="owdocver:doc-1",
                        title="学校简介",
                        normalized_canonical_url="https://www.muc.edu.cn/xxgk1/xxjj.htm",
                        raw_asset_id="owasset_doc_1",
                        raw_version_id="owver_doc_1",
                        canonical_markdown_path=str(promotable_canonical_path),
                        document_units_path=str(promotable_units_path),
                    ),
                    _projection_document(
                        document_id="official_web:muc_public_pages:article_detail:doc-audit-only",
                        version_id="owdocver:doc-audit-only",
                        title="中央民族大学公开招聘及公示信息",
                        normalized_canonical_url="https://xxgk.muc.edu.cn/info/1297/5711.htm",
                        raw_asset_id="owasset_doc_2",
                        raw_version_id="owver_doc_2",
                        canonical_markdown_path=str(audit_only_canonical_path),
                        document_units_path=str(audit_only_units_path),
                        serving_intent="audit_only",
                        promotion_block_reason="low_value_public_notice_audit_only",
                    ),
                ],
                "manual_review_pages": [],
            }
            _write_json(projection_dir / "projection-report.json", projection_report)
            promotable_canonical_path.write_text(
                "# 学校简介\n\n中央民族大学学校简介。", encoding="utf-8"
            )
            audit_only_canonical_path.write_text(
                "# 招聘公示\n\n中央民族大学公开招聘及公示信息。", encoding="utf-8"
            )
            _write_jsonl(
                promotable_units_path,
                [
                    _document_units_row_for(
                        document_id="official_web:muc_public_pages:article_detail:doc-1",
                        version_id="owdocver:doc-1",
                        source_url="https://www.muc.edu.cn/xxgk1/xxjj.htm",
                        title="学校简介",
                    )
                ],
            )
            audit_only_row = _document_units_row_for(
                document_id="official_web:muc_public_pages:article_detail:doc-audit-only",
                version_id="owdocver:doc-audit-only",
                source_url="https://xxgk.muc.edu.cn/info/1297/5711.htm",
                title="中央民族大学公开招聘及公示信息",
            )
            audit_only_row["metadata"]["serving_intent"] = "audit_only"
            audit_only_row["metadata"]["promotion_block_reason"] = (
                "low_value_public_notice_audit_only"
            )
            _write_jsonl(audit_only_units_path, [audit_only_row])
            _write_json(
                replay_input_dir / "source-truth-bundle.json",
                {
                    "schemaVersion": "official_web_source_truth_bundle.v1",
                    "sourceChannel": "official_web",
                    "siteId": "muc_public",
                    "crawlRunId": "subset-run-001",
                    "generatedAt": "2026-04-03T00:00:00+00:00",
                    "pages": [
                        {
                            "rawAssetId": "owasset_doc_1",
                            "rawVersionId": "owver_doc_1",
                            "normalizedCanonicalUrl": "https://www.muc.edu.cn/xxgk1/xxjj.htm",
                            "pageFamily": "article_detail",
                            "providerExtractionObjectKey": (
                                "official_web/owasset_doc_1/undated/owver_doc_1/provider/cheerio-basic/page-extraction.json"
                            ),
                            "responseHtmlObjectKey": (
                                "official_web/owasset_doc_1/undated/owver_doc_1/capture/response.html"
                            ),
                            "responseBodyHash": "sha256:body-1",
                        },
                        {
                            "rawAssetId": "owasset_doc_2",
                            "rawVersionId": "owver_doc_2",
                            "normalizedCanonicalUrl": "https://xxgk.muc.edu.cn/info/1297/5711.htm",
                            "pageFamily": "article_detail",
                            "providerExtractionObjectKey": (
                                "official_web/owasset_doc_2/undated/owver_doc_2/provider/cheerio-basic/page-extraction.json"
                            ),
                            "responseHtmlObjectKey": (
                                "official_web/owasset_doc_2/undated/owver_doc_2/capture/response.html"
                            ),
                            "responseBodyHash": "sha256:body-2",
                        },
                    ],
                },
            )
            _write_json(
                replay_input_dir
                / "source-assets"
                / "owasset_doc_1"
                / "owver_doc_1"
                / "provider"
                / "cheerio-basic"
                / "page-extraction.json",
                {"title": "学校简介"},
            )
            _write_json(
                replay_input_dir
                / "source-assets"
                / "owasset_doc_2"
                / "owver_doc_2"
                / "provider"
                / "cheerio-basic"
                / "page-extraction.json",
                {"title": "中央民族大学公开招聘及公示信息"},
            )
            object_store = _FakeObjectStore()
            document_registry = InMemoryDocumentRegistry()
            raw_asset_registry = InMemoryRawAssetRegistry()

            report = worker.import_projection_output(
                work_dir=work_dir,
                projection_output_dir=projection_dir,
                replay_input_dir=replay_input_dir,
                source_object_store=object_store,
                derived_object_store=object_store,
                document_registry=document_registry,
                raw_asset_registry=raw_asset_registry,
                object_store_settings=_object_store_settings(),
                scope_refresh=("official_web", "muc_public_pages"),
                require_promotable=True,
            )

        self.assertEqual(report.success_count, 1)
        self.assertEqual(report.skipped_count, 1)
        self.assertEqual(
            report.skipped_document_ids,
            ("official_web:muc_public_pages:article_detail:doc-audit-only",),
        )
        records = document_registry.list_by_scope("official_web", "muc_public_pages")
        self.assertEqual(
            [record.document_id for record in records],
            ["official_web:muc_public_pages:article_detail:doc-1"],
        )

    def test_import_projection_output_scope_refresh_drops_existing_audit_only_truth(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            projection_dir = root / "projection-output"
            replay_input_dir = root / "replay-input"
            work_dir = root / "work"

            promotable_canonical_path = projection_dir / "promotable.md"
            promotable_units_path = projection_dir / "promotable.jsonl"
            audit_only_canonical_path = projection_dir / "audit-only.md"
            audit_only_units_path = projection_dir / "audit-only.jsonl"

            projection_report = {
                "schemaVersion": "official_web_projection_replay_report.v1",
                "siteId": "muc_public",
                "crawlRunId": "subset-run-001",
                "outputDir": "/tmp/replay",
                "projectionOutputDir": "/tmp/projection",
                "generatedAt": "2026-04-03T00:00:00+00:00",
                "counts": {"pages_seen": 2, "emitted_documents": 2, "manual_review_pages": 0},
                "documents": [
                    _projection_document(
                        document_id="official_web:muc_public_pages:article_detail:doc-1",
                        version_id="owdocver:doc-1",
                        title="学校简介",
                        normalized_canonical_url="https://www.muc.edu.cn/xxgk1/xxjj.htm",
                        raw_asset_id="owasset_doc_1",
                        raw_version_id="owver_doc_1",
                        canonical_markdown_path=str(promotable_canonical_path),
                        document_units_path=str(promotable_units_path),
                    ),
                    _projection_document(
                        document_id="official_web:muc_public_pages:article_detail:doc-audit-only",
                        version_id="owdocver:doc-audit-only",
                        title="中央民族大学公开招聘及公示信息",
                        normalized_canonical_url="https://xxgk.muc.edu.cn/info/1297/5711.htm",
                        raw_asset_id="owasset_doc_2",
                        raw_version_id="owver_doc_2",
                        canonical_markdown_path=str(audit_only_canonical_path),
                        document_units_path=str(audit_only_units_path),
                        serving_intent="audit_only",
                        promotion_block_reason="low_value_public_notice_audit_only",
                    ),
                ],
                "manual_review_pages": [],
            }
            _write_json(projection_dir / "projection-report.json", projection_report)
            promotable_canonical_path.write_text(
                "# 学校简介\n\n中央民族大学学校简介。", encoding="utf-8"
            )
            audit_only_canonical_path.write_text(
                "# 招聘公示\n\n中央民族大学公开招聘及公示信息。", encoding="utf-8"
            )
            _write_jsonl(
                promotable_units_path,
                [
                    _document_units_row_for(
                        document_id="official_web:muc_public_pages:article_detail:doc-1",
                        version_id="owdocver:doc-1",
                        source_url="https://www.muc.edu.cn/xxgk1/xxjj.htm",
                        title="学校简介",
                    )
                ],
            )
            audit_only_row = _document_units_row_for(
                document_id="official_web:muc_public_pages:article_detail:doc-audit-only",
                version_id="owdocver:doc-audit-only",
                source_url="https://xxgk.muc.edu.cn/info/1297/5711.htm",
                title="中央民族大学公开招聘及公示信息",
            )
            audit_only_row["metadata"]["serving_intent"] = "audit_only"
            audit_only_row["metadata"]["promotion_block_reason"] = (
                "low_value_public_notice_audit_only"
            )
            _write_jsonl(audit_only_units_path, [audit_only_row])
            _write_json(
                replay_input_dir / "source-truth-bundle.json",
                {
                    "schemaVersion": "official_web_source_truth_bundle.v1",
                    "sourceChannel": "official_web",
                    "siteId": "muc_public",
                    "crawlRunId": "subset-run-001",
                    "generatedAt": "2026-04-03T00:00:00+00:00",
                    "pages": [
                        {
                            "rawAssetId": "owasset_doc_1",
                            "rawVersionId": "owver_doc_1",
                            "normalizedCanonicalUrl": "https://www.muc.edu.cn/xxgk1/xxjj.htm",
                            "pageFamily": "article_detail",
                            "providerExtractionObjectKey": (
                                "official_web/owasset_doc_1/undated/owver_doc_1/provider/cheerio-basic/page-extraction.json"
                            ),
                            "responseHtmlObjectKey": (
                                "official_web/owasset_doc_1/undated/owver_doc_1/capture/response.html"
                            ),
                            "responseBodyHash": "sha256:body-1",
                        },
                        {
                            "rawAssetId": "owasset_doc_2",
                            "rawVersionId": "owver_doc_2",
                            "normalizedCanonicalUrl": "https://xxgk.muc.edu.cn/info/1297/5711.htm",
                            "pageFamily": "article_detail",
                            "providerExtractionObjectKey": (
                                "official_web/owasset_doc_2/undated/owver_doc_2/provider/cheerio-basic/page-extraction.json"
                            ),
                            "responseHtmlObjectKey": (
                                "official_web/owasset_doc_2/undated/owver_doc_2/capture/response.html"
                            ),
                            "responseBodyHash": "sha256:body-2",
                        },
                    ],
                },
            )
            _write_json(
                replay_input_dir
                / "source-assets"
                / "owasset_doc_1"
                / "owver_doc_1"
                / "provider"
                / "cheerio-basic"
                / "page-extraction.json",
                {"title": "学校简介"},
            )
            _write_json(
                replay_input_dir
                / "source-assets"
                / "owasset_doc_2"
                / "owver_doc_2"
                / "provider"
                / "cheerio-basic"
                / "page-extraction.json",
                {"title": "中央民族大学公开招聘及公示信息"},
            )
            object_store = _FakeObjectStore()
            document_registry = InMemoryDocumentRegistry()
            raw_asset_registry = InMemoryRawAssetRegistry()

            worker.import_projection_output(
                work_dir=work_dir,
                projection_output_dir=projection_dir,
                replay_input_dir=replay_input_dir,
                source_object_store=object_store,
                derived_object_store=object_store,
                document_registry=document_registry,
                raw_asset_registry=raw_asset_registry,
                object_store_settings=_object_store_settings(),
                scope_refresh=("official_web", "muc_public_pages"),
                require_promotable=True,
            )
            promotable_record = document_registry.list_by_scope("official_web", "muc_public_pages")[
                0
            ]
            audit_only_record = replace(
                promotable_record,
                document_id="official_web:muc_public_pages:article_detail:doc-audit-only",
                version_id="owdocver:doc-audit-only",
                source_uri="https://xxgk.muc.edu.cn/info/1297/5711.htm",
                content_hash="sha256:audit-only-stale",
            )
            document_registry.upsert(audit_only_record)

            report = worker.import_projection_output(
                work_dir=work_dir,
                projection_output_dir=projection_dir,
                replay_input_dir=replay_input_dir,
                source_object_store=object_store,
                derived_object_store=object_store,
                document_registry=document_registry,
                raw_asset_registry=raw_asset_registry,
                object_store_settings=_object_store_settings(),
                scope_refresh=("official_web", "muc_public_pages"),
                require_promotable=True,
            )

        self.assertEqual(report.success_count, 0)
        self.assertEqual(report.skipped_count, 2)
        records = document_registry.list_by_scope("official_web", "muc_public_pages")
        self.assertEqual(
            [record.document_id for record in records],
            ["official_web:muc_public_pages:article_detail:doc-1"],
        )

    def test_import_projection_output_merges_cross_host_equivalent_documents_into_single_scope_truth(
        self,
    ) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            projection_dir = root / "projection-output"
            replay_input_dir = root / "replay-input"
            work_dir = root / "work"
            semantic_hash = "sha256:semantic-duplicate"

            news_canonical_path = projection_dir / "news-canonical.md"
            news_units_path = projection_dir / "news-document-units.jsonl"
            xxgk_canonical_path = projection_dir / "xxgk-canonical.md"
            xxgk_units_path = projection_dir / "xxgk-document-units.jsonl"

            projection_report = {
                "schemaVersion": "official_web_projection_replay_report.v1",
                "siteId": "muc_public",
                "crawlRunId": "subset-run-001",
                "outputDir": "/tmp/replay",
                "projectionOutputDir": "/tmp/projection",
                "generatedAt": "2026-04-03T00:00:00+00:00",
                "counts": {"pages_seen": 2, "emitted_documents": 2, "manual_review_pages": 0},
                "documents": [
                    _projection_document(
                        document_id="official_web:muc_public_pages:article_detail:news-doc",
                        version_id="owdocver:news-doc",
                        title="中央民族大学与北京丰台人才集团共建就业实习实践基地",
                        normalized_canonical_url="https://news.muc.edu.cn/info/1011/61874.htm",
                        raw_asset_id="owasset_news_doc",
                        raw_version_id="owver_news_doc",
                        canonical_markdown_path=str(news_canonical_path),
                        document_units_path=str(news_units_path),
                    ),
                    _projection_document(
                        document_id="official_web:muc_public_pages:article_detail:xxgk-doc",
                        version_id="owdocver:xxgk-doc",
                        title="中央民族大学与北京丰台人才集团共建就业实习实践基地",
                        normalized_canonical_url="https://xxgk.muc.edu.cn/info/1362/28641.htm",
                        raw_asset_id="owasset_xxgk_doc",
                        raw_version_id="owver_xxgk_doc",
                        canonical_markdown_path=str(xxgk_canonical_path),
                        document_units_path=str(xxgk_units_path),
                    ),
                ],
                "manual_review_pages": [],
            }
            _write_json(projection_dir / "projection-report.json", projection_report)
            news_canonical_path.write_text("# 标题\n\n同文内容。", encoding="utf-8")
            xxgk_canonical_path.write_text("# 标题\n\n同文内容。", encoding="utf-8")
            _write_jsonl(
                news_units_path,
                [
                    _document_units_row_for(
                        document_id="official_web:muc_public_pages:article_detail:news-doc",
                        version_id="owdocver:news-doc",
                        source_url="https://news.muc.edu.cn/info/1011/61874.htm",
                        title="中央民族大学与北京丰台人才集团共建就业实习实践基地",
                        semantic_content_hash=semantic_hash,
                    )
                ],
            )
            _write_jsonl(
                xxgk_units_path,
                [
                    _document_units_row_for(
                        document_id="official_web:muc_public_pages:article_detail:xxgk-doc",
                        version_id="owdocver:xxgk-doc",
                        source_url="https://xxgk.muc.edu.cn/info/1362/28641.htm",
                        title="中央民族大学与北京丰台人才集团共建就业实习实践基地",
                        semantic_content_hash=semantic_hash,
                    )
                ],
            )
            _write_json(
                replay_input_dir / "source-truth-bundle.json",
                {
                    "schemaVersion": "official_web_source_truth_bundle.v1",
                    "sourceChannel": "official_web",
                    "siteId": "muc_public",
                    "crawlRunId": "subset-run-001",
                    "generatedAt": "2026-04-03T00:00:00+00:00",
                    "pages": [
                        {
                            "rawAssetId": "owasset_news_doc",
                            "rawVersionId": "owver_news_doc",
                            "normalizedCanonicalUrl": "https://news.muc.edu.cn/info/1011/61874.htm",
                            "pageFamily": "article_detail",
                            "providerExtractionObjectKey": (
                                "official_web/owasset_news_doc/undated/owver_news_doc/provider/cheerio-basic/page-extraction.json"
                            ),
                            "responseHtmlObjectKey": (
                                "official_web/owasset_news_doc/undated/owver_news_doc/capture/response.html"
                            ),
                            "responseBodyHash": "sha256:body-news",
                            "blockCount": 1,
                        },
                        {
                            "rawAssetId": "owasset_xxgk_doc",
                            "rawVersionId": "owver_xxgk_doc",
                            "normalizedCanonicalUrl": "https://xxgk.muc.edu.cn/info/1362/28641.htm",
                            "pageFamily": "article_detail",
                            "providerExtractionObjectKey": (
                                "official_web/owasset_xxgk_doc/undated/owver_xxgk_doc/provider/cheerio-basic/page-extraction.json"
                            ),
                            "responseHtmlObjectKey": (
                                "official_web/owasset_xxgk_doc/undated/owver_xxgk_doc/capture/response.html"
                            ),
                            "responseBodyHash": "sha256:body-xxgk",
                            "blockCount": 1,
                        },
                    ],
                },
            )
            object_store = _FakeObjectStore(
                objects={
                    (
                        "campus-rag-source",
                        "official_web/owasset_news_doc/undated/owver_news_doc/provider/cheerio-basic/page-extraction.json",
                    ): json.dumps({"title": "同文"}, ensure_ascii=False).encode("utf-8"),
                    (
                        "campus-rag-source",
                        "official_web/owasset_xxgk_doc/undated/owver_xxgk_doc/provider/cheerio-basic/page-extraction.json",
                    ): json.dumps({"title": "同文"}, ensure_ascii=False).encode("utf-8"),
                }
            )
            document_registry = InMemoryDocumentRegistry()
            raw_asset_registry = InMemoryRawAssetRegistry()

            report = worker.import_projection_output(
                work_dir=work_dir,
                projection_output_dir=projection_dir,
                replay_input_dir=replay_input_dir,
                source_object_store=object_store,
                derived_object_store=object_store,
                document_registry=document_registry,
                raw_asset_registry=raw_asset_registry,
                object_store_settings=_object_store_settings(),
                scope_refresh=("official_web", "muc_public_pages"),
                require_promotable=True,
            )

        self.assertEqual(report.success_count, 1)
        self.assertEqual(report.skipped_count, 1)
        records = document_registry.list_by_scope("official_web", "muc_public_pages")
        self.assertEqual(len(records), 1)
        self.assertEqual(
            records[0].document_id, "official_web:muc_public_pages:article_detail:news-doc"
        )
        self.assertEqual(len(records[0].source_observations), 2)
        self.assertEqual(
            {observation.source_uri for observation in records[0].source_observations},
            {
                "https://news.muc.edu.cn/info/1011/61874.htm",
                "https://xxgk.muc.edu.cn/info/1362/28641.htm",
            },
        )
        raw_records = raw_asset_registry.list_by_scope("official_web", "muc_public_pages")
        self.assertEqual(len(raw_records), 2)
