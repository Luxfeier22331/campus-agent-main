from __future__ import annotations

import json
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

from tests.support.in_memory_registry import InMemoryDocumentRegistry, InMemoryRawAssetRegistry

from .official_web_projection_import_worker_test_support import (
    _bundle_payload,
    _document_units_row,
    _document_units_row_for,
    _existing_raw_asset_record,
    _existing_record,
    _FakeObjectStore,
    _object_store_settings,
    _page_manifest,
    _projection_document,
    _projection_report,
    _write_json,
    _write_jsonl,
    worker,
)


class OfficialWebProjectionImportScopeTest(unittest.TestCase):
    def test_import_projection_output_scope_refresh_replaces_existing_scope(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            projection_dir = root / "projection-output"
            replay_input_dir = root / "replay-input"
            work_dir = root / "work"
            projection_report = _projection_report()
            canonical_path = projection_dir / "canonical.md"
            document_units_path = projection_dir / "document-units.jsonl"
            projection_report["documents"][0]["canonical_markdown_path"] = str(canonical_path)
            projection_report["documents"][0]["document_units_path"] = str(document_units_path)
            _write_json(projection_dir / "projection-report.json", projection_report)
            canonical_path.write_text("# 学校简介\n\n中央民族大学学校简介。", encoding="utf-8")
            _write_jsonl(document_units_path, [_document_units_row()])
            _write_json(replay_input_dir / "source-truth-bundle.json", _bundle_payload())
            _write_json(
                replay_input_dir
                / "source-assets"
                / "owasset_doc_1"
                / "owver_doc_1"
                / "source-truth"
                / "page-manifest.json",
                _page_manifest(),
            )
            _write_jsonl(
                replay_input_dir
                / "source-assets"
                / "owasset_doc_1"
                / "owver_doc_1"
                / "source-truth"
                / "content-blocks.jsonl",
                [
                    {"rowId": "title-1", "textRaw": "学校简介"},
                    {"rowId": "p-1", "textRaw": "中央民族大学学校简介。"},
                ],
            )
            object_store = _FakeObjectStore(
                objects={
                    (
                        "campus-rag-source",
                        "official_web/owasset_doc_1/undated/owver_doc_1/provider/cheerio-basic/page-extraction.json",
                    ): json.dumps({"title": "学校简介"}, ensure_ascii=False).encode("utf-8")
                }
            )
            document_registry = InMemoryDocumentRegistry((_existing_record(),))
            raw_asset_registry = InMemoryRawAssetRegistry((_existing_raw_asset_record(),))

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
        records = document_registry.list_by_scope("official_web", "muc_public_pages")
        self.assertEqual(len(records), 1)
        self.assertEqual(
            records[0].document_id, "official_web:muc_public_pages:article_detail:doc-1"
        )
        raw_records = raw_asset_registry.list_by_scope("official_web", "muc_public_pages")
        self.assertEqual(len(raw_records), 1)
        self.assertEqual(raw_records[0].raw_asset_id, "owasset_doc_1")

    def test_import_projection_output_filters_mixed_replay_to_requested_scope_refresh(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            projection_dir = root / "projection-output"
            replay_input_dir = root / "replay-input"
            work_dir = root / "work"

            stable_canonical_path = projection_dir / "stable-reference.md"
            stable_units_path = projection_dir / "stable-reference.jsonl"
            bridge_canonical_path = projection_dir / "bridge.md"
            bridge_units_path = projection_dir / "bridge.jsonl"

            stable_document = _projection_document(
                document_id="official_web:stable_reference:article_detail:stable-doc",
                version_id="owdocver:stable-doc",
                title="学校简介",
                normalized_canonical_url="https://www.muc.edu.cn/xxgk1/xxjj.htm",
                raw_asset_id="owasset_stable_doc",
                raw_version_id="owver_stable_doc",
                canonical_markdown_path=str(stable_canonical_path),
                document_units_path=str(stable_units_path),
            )
            stable_document["target_collection"] = "stable_reference"
            stable_document["routing_route_id"] = "stable-reference-bootstrap"

            bridge_document = _projection_document(
                document_id="official_web:muc_public_pages:article_detail:bridge-doc",
                version_id="owdocver:bridge-doc",
                title="校园新闻",
                normalized_canonical_url="https://news.muc.edu.cn/info/1011/61874.htm",
                raw_asset_id="owasset_bridge_doc",
                raw_version_id="owver_bridge_doc",
                canonical_markdown_path=str(bridge_canonical_path),
                document_units_path=str(bridge_units_path),
            )

            projection_report = {
                "schemaVersion": "official_web_projection_replay_report.v1",
                "siteId": "muc_public",
                "crawlRunId": "subset-run-001",
                "outputDir": "/tmp/replay",
                "projectionOutputDir": "/tmp/projection",
                "generatedAt": "2026-04-03T00:00:00+00:00",
                "counts": {"pages_seen": 2, "emitted_documents": 2, "manual_review_pages": 0},
                "documents": [stable_document, bridge_document],
                "manual_review_pages": [],
            }
            _write_json(projection_dir / "projection-report.json", projection_report)

            stable_canonical_path.write_text(
                "# 学校简介\n\n中央民族大学学校简介。", encoding="utf-8"
            )
            bridge_canonical_path.write_text(
                "# 校园新闻\n\n学校召开专题工作会议。", encoding="utf-8"
            )
            _write_jsonl(
                stable_units_path,
                [
                    _document_units_row_for(
                        document_id="official_web:stable_reference:article_detail:stable-doc",
                        version_id="owdocver:stable-doc",
                        source_url="https://www.muc.edu.cn/xxgk1/xxjj.htm",
                        title="学校简介",
                    )
                ],
            )
            _write_jsonl(
                bridge_units_path,
                [
                    _document_units_row_for(
                        document_id="official_web:muc_public_pages:article_detail:bridge-doc",
                        version_id="owdocver:bridge-doc",
                        source_url="https://news.muc.edu.cn/info/1011/61874.htm",
                        title="校园新闻",
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
                            "rawAssetId": "owasset_stable_doc",
                            "rawVersionId": "owver_stable_doc",
                            "normalizedCanonicalUrl": "https://www.muc.edu.cn/xxgk1/xxjj.htm",
                            "pageFamily": "article_detail",
                            "providerExtractionObjectKey": (
                                "official_web/owasset_stable_doc/undated/owver_stable_doc/provider/cheerio-basic/page-extraction.json"
                            ),
                            "responseHtmlObjectKey": (
                                "official_web/owasset_stable_doc/undated/owver_stable_doc/capture/response.html"
                            ),
                            "responseBodyHash": "sha256:body-stable",
                            "blockCount": 1,
                        },
                        {
                            "rawAssetId": "owasset_bridge_doc",
                            "rawVersionId": "owver_bridge_doc",
                            "normalizedCanonicalUrl": "https://news.muc.edu.cn/info/1011/61874.htm",
                            "pageFamily": "article_detail",
                            "providerExtractionObjectKey": (
                                "official_web/owasset_bridge_doc/undated/owver_bridge_doc/provider/cheerio-basic/page-extraction.json"
                            ),
                            "responseHtmlObjectKey": (
                                "official_web/owasset_bridge_doc/undated/owver_bridge_doc/capture/response.html"
                            ),
                            "responseBodyHash": "sha256:body-bridge",
                            "blockCount": 1,
                        },
                    ],
                },
            )

            object_store = _FakeObjectStore(
                objects={
                    (
                        "campus-rag-source",
                        "official_web/owasset_stable_doc/undated/owver_stable_doc/provider/cheerio-basic/page-extraction.json",
                    ): json.dumps({"title": "学校简介"}, ensure_ascii=False).encode("utf-8"),
                    (
                        "campus-rag-source",
                        "official_web/owasset_bridge_doc/undated/owver_bridge_doc/provider/cheerio-basic/page-extraction.json",
                    ): json.dumps({"title": "校园新闻"}, ensure_ascii=False).encode("utf-8"),
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
                scope_refresh=("official_web", "stable_reference"),
                require_promotable=True,
            )

        self.assertEqual(report.success_count, 1)
        stable_records = document_registry.list_by_scope("official_web", "stable_reference")
        self.assertEqual(len(stable_records), 1)
        self.assertEqual(
            stable_records[0].document_id, "official_web:stable_reference:article_detail:stable-doc"
        )
        self.assertEqual(
            len(document_registry.list_by_scope("official_web", "muc_public_pages")), 0
        )
        stable_raw_records = raw_asset_registry.list_by_scope("official_web", "stable_reference")
        self.assertEqual(len(stable_raw_records), 1)
        self.assertEqual(stable_raw_records[0].raw_asset_id, "owasset_stable_doc")
        self.assertEqual(
            len(raw_asset_registry.list_by_scope("official_web", "muc_public_pages")), 0
        )
