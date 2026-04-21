from __future__ import annotations

import json
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

from campus_ingestion_core.official_web_projection import (
    load_official_web_projection_declarations,
    replay_official_web_source_truth_local,
    validate_official_web_projection_output,
)


def _write_json(path: Path, payload: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def _write_jsonl(path: Path, rows: list[dict[str, object]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        "\n".join(json.dumps(row, ensure_ascii=False) for row in rows) + "\n",
        encoding="utf-8",
    )


def _declarations_payload() -> dict[str, object]:
    return {
        "schema_version": "official_web_projection_declarations.v1",
        "site_id": "campus_public",
        "projection_policy_version": "campus_public_projection_v1",
        "declarations": [
            {
                "declaration_id": "article-detail-primary",
                "page_family": "article_detail",
                "target_corpus": "official_web",
                "target_collection": "muc_public_pages",
                "projection_family": "content_document",
                "document_kind": "article",
                "action": "emit_document",
            },
            {
                "declaration_id": "listing-page-primary",
                "page_family": "listing_page",
                "target_corpus": "official_web",
                "target_collection": "muc_public_pages",
                "projection_family": "navigation_document",
                "document_kind": "listing",
                "action": "emit_document",
            },
            {
                "declaration_id": "generic-page-primary",
                "page_family": "generic_content_page",
                "target_corpus": "official_web",
                "target_collection": "muc_public_pages",
                "projection_family": "generic_content_document",
                "document_kind": "generic",
                "action": "emit_document",
            },
            {
                "declaration_id": "dynamic-shell-review",
                "page_family": "dynamic_shell_page",
                "target_corpus": "official_web",
                "target_collection": "muc_public_pages",
                "projection_family": "shell_review",
                "document_kind": "shell",
                "action": "manual_review",
            },
        ],
    }


def _routing_payload(
    *,
    titles: list[str] | None = None,
    extra_routes: list[dict[str, object]] | None = None,
) -> dict[str, object]:
    routes = [
        {
            "route_id": "stable-reference-bootstrap",
            "target_corpus": "official_web",
            "target_collection": "stable_reference",
            "page_families": ["article_detail", "directory_page", "generic_content_page"],
            "title_allowlist": titles or [],
        }
    ]
    if extra_routes:
        routes.extend(extra_routes)
    return {
        "schema_version": "official_web_projection_routing.v1",
        "site_id": "campus_public",
        "routing_policy_version": "campus_public_routing_v1",
        "routes": routes,
    }


def _page_bundle_entry(
    *,
    raw_asset_id: str,
    raw_version_id: str,
    normalized_canonical_url: str,
    page_family: str,
) -> dict[str, object]:
    return {
        "rawAssetId": raw_asset_id,
        "rawVersionId": raw_version_id,
        "normalizedCanonicalUrl": normalized_canonical_url,
        "pageFamily": page_family,
        "pageManifestObjectKey": f"official_web/{raw_asset_id}/undated/{raw_version_id}/source-truth/page-manifest.json",
        "contentBlocksObjectKey": f"official_web/{raw_asset_id}/undated/{raw_version_id}/source-truth/content-blocks.jsonl",
        "providerExtractionObjectKey": f"official_web/{raw_asset_id}/undated/{raw_version_id}/provider/cheerio-basic/page-extraction.json",
        "discoveredLinksObjectKey": f"official_web/{raw_asset_id}/undated/{raw_version_id}/provider/cheerio-basic/discovered-links.jsonl",
        "responseHtmlObjectKey": f"official_web/{raw_asset_id}/undated/{raw_version_id}/capture/response.html",
        "responseBodyHash": f"hash-{raw_asset_id}",
        "blockCount": 3,
    }


def _write_output_page(
    output_dir: Path,
    *,
    site_id: str,
    host: str,
    raw_asset_id: str,
    raw_version_id: str,
    normalized_canonical_url: str,
    page_title: str,
    page_family: str,
    blocks: list[dict[str, object]],
    published_at: str | None = None,
    last_modified: str | None = None,
) -> None:
    base_dir = output_dir / "source-assets" / raw_asset_id / raw_version_id
    _write_json(
        base_dir / "source-truth" / "page-manifest.json",
        {
            "schemaVersion": "official_web_page_manifest.v1",
            "sourceChannel": "official_web",
            "siteId": site_id,
            "host": host,
            "rawAssetId": raw_asset_id,
            "rawVersionId": raw_version_id,
            "requestedUrl": normalized_canonical_url,
            "finalUrl": normalized_canonical_url,
            "declaredCanonicalUrl": normalized_canonical_url,
            "normalizedCanonicalUrl": normalized_canonical_url,
            "urlIdentityBasis": "declared_canonical",
            "fetchedAt": "2026-03-31T09:00:00.000Z",
            "publishedAt": published_at,
            "httpStatus": 200,
            "contentType": "text/html",
            "etag": None,
            "lastModified": last_modified,
            "redirectChain": [],
            "responseBodyHash": f"hash-{raw_asset_id}",
            "retainedSnapshotHash": f"snapshot-{raw_asset_id}",
            "fetcherName": "collector-test",
            "fetcherVersion": "1.0",
            "parserName": "cheerio-basic",
            "parserVersion": "1.0",
            "pageTitleRaw": page_title,
            "pageTitleNormalized": page_title,
            "languageHint": "zh-CN",
            "pageFamily": page_family,
            "pageFamilyConfidence": 0.99,
            "pageFamilyReason": "test-fixture",
            "mainContentHash": f"main-{raw_asset_id}",
            "blockCount": len(blocks),
            "mainContentBlockCount": sum(1 for block in blocks if block.get("isMainContent")),
            "navigationBlockCount": 0,
            "boilerplateBlockCount": 0,
            "discoveredFromUrl": None,
            "discoveryMethod": "seed",
            "crawlRunId": "owrun_projection_001",
            "hostPolicyVersion": "campus_public_hosts_v1",
            "crawlPolicyVersion": "campus_public_crawl_policy_v1",
            "credentialsMode": "public",
        },
    )
    _write_jsonl(base_dir / "source-truth" / "content-blocks.jsonl", blocks)


def _block(
    *,
    raw_asset_id: str,
    raw_version_id: str,
    row_id: str,
    row_index: int,
    block_order: int,
    block_role: str,
    text: str,
    parent_heading_path: list[str] | None = None,
    is_main_content: bool = True,
    is_navigation: bool = False,
    is_boilerplate: bool = False,
) -> dict[str, object]:
    return {
        "schemaVersion": "official_web_content_block.v1",
        "rawAssetId": raw_asset_id,
        "rawVersionId": raw_version_id,
        "rowId": row_id,
        "rowIndex": row_index,
        "blockOrder": block_order,
        "blockRole": block_role,
        "headingLevel": 1 if block_role in {"title", "heading"} else None,
        "domPath": None,
        "parentHeadingPath": parent_heading_path or [],
        "listLevel": None,
        "tableId": None,
        "tableRowIndex": None,
        "tableColIndex": None,
        "textRaw": text,
        "textNormalized": text,
        "htmlFragment": None,
        "linkTarget": None,
        "linkText": None,
        "tableHtml": None,
        "tableCells": None,
        "isNavigation": is_navigation,
        "isBoilerplate": is_boilerplate,
        "isMainContent": is_main_content,
        "isRepeatedCandidate": False,
        "mainContentScore": 1.0 if is_main_content else 0.0,
        "titleCandidateScore": 1.0 if block_role == "title" else 0.0,
        "sectionHint": None,
        "classificationConfidence": 0.99,
        "classificationReason": "test",
        "parentHeadingHint": None,
    }


class OfficialWebProjectionTest(unittest.TestCase):
    def test_load_official_web_projection_declarations_rejects_shell_emit_action(self) -> None:
        with TemporaryDirectory() as temp_dir:
            path = Path(temp_dir) / "projection-declarations.json"
            payload = _declarations_payload()
            payload["declarations"][3]["action"] = "emit_document"
            _write_json(path, payload)

            with self.assertRaisesRegex(ValueError, "manual_review"):
                load_official_web_projection_declarations(path)

    def test_replay_official_web_source_truth_local_emits_listing_documents_and_keeps_shell_review(
        self,
    ) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            output_dir = root / "collector-output"
            projection_dir = root / "projection-output"
            declarations_path = root / "projection-declarations.json"
            _write_json(declarations_path, _declarations_payload())
            _write_json(
                output_dir / "source-truth-bundle.json",
                {
                    "schemaVersion": "official_web_source_truth_bundle.v1",
                    "sourceChannel": "official_web",
                    "siteId": "campus_public",
                    "crawlRunId": "owrun_projection_001",
                    "generatedAt": "2026-03-31T09:00:00.000Z",
                    "pages": [
                        _page_bundle_entry(
                            raw_asset_id="owasset_article_001",
                            raw_version_id="owver_article_001",
                            normalized_canonical_url="https://www.example.edu/news/1",
                            page_family="article_detail",
                        ),
                        _page_bundle_entry(
                            raw_asset_id="owasset_listing_001",
                            raw_version_id="owver_listing_001",
                            normalized_canonical_url="https://www.example.edu/news/",
                            page_family="listing_page",
                        ),
                        _page_bundle_entry(
                            raw_asset_id="owasset_shell_001",
                            raw_version_id="owver_shell_001",
                            normalized_canonical_url="https://www.example.edu/app/",
                            page_family="dynamic_shell_page",
                        ),
                    ],
                },
            )
            _write_output_page(
                output_dir,
                site_id="campus_public",
                host="www.example.edu",
                raw_asset_id="owasset_article_001",
                raw_version_id="owver_article_001",
                normalized_canonical_url="https://www.example.edu/news/1",
                page_title="新闻详情",
                page_family="article_detail",
                blocks=[
                    _block(
                        raw_asset_id="owasset_article_001",
                        raw_version_id="owver_article_001",
                        row_id="title-1",
                        row_index=0,
                        block_order=0,
                        block_role="title",
                        text="新闻详情",
                    ),
                    _block(
                        raw_asset_id="owasset_article_001",
                        raw_version_id="owver_article_001",
                        row_id="p-1",
                        row_index=1,
                        block_order=1,
                        block_role="paragraph",
                        text="中央民族大学召开专题工作会议，部署本学期重点任务。",
                    ),
                    _block(
                        raw_asset_id="owasset_article_001",
                        raw_version_id="owver_article_001",
                        row_id="p-2",
                        row_index=2,
                        block_order=2,
                        block_role="paragraph",
                        text="会议强调要持续提升教学质量和校园服务保障能力。",
                    ),
                ],
            )
            _write_output_page(
                output_dir,
                site_id="campus_public",
                host="www.example.edu",
                raw_asset_id="owasset_listing_001",
                raw_version_id="owver_listing_001",
                normalized_canonical_url="https://www.example.edu/news/",
                page_title="新闻网",
                page_family="listing_page",
                blocks=[
                    _block(
                        raw_asset_id="owasset_listing_001",
                        raw_version_id="owver_listing_001",
                        row_id="title-1",
                        row_index=0,
                        block_order=0,
                        block_role="title",
                        text="新闻网",
                    ),
                    _block(
                        raw_asset_id="owasset_listing_001",
                        raw_version_id="owver_listing_001",
                        row_id="li-1",
                        row_index=1,
                        block_order=1,
                        block_role="list_item",
                        text="学校召开就业工作推进会",
                    ),
                    _block(
                        raw_asset_id="owasset_listing_001",
                        raw_version_id="owver_listing_001",
                        row_id="li-2",
                        row_index=2,
                        block_order=2,
                        block_role="list_item",
                        text="2026年招生宣传工作启动",
                    ),
                ],
            )
            _write_output_page(
                output_dir,
                site_id="campus_public",
                host="www.example.edu",
                raw_asset_id="owasset_shell_001",
                raw_version_id="owver_shell_001",
                normalized_canonical_url="https://www.example.edu/app/",
                page_title="网上办事大厅",
                page_family="dynamic_shell_page",
                blocks=[
                    _block(
                        raw_asset_id="owasset_shell_001",
                        raw_version_id="owver_shell_001",
                        row_id="title-1",
                        row_index=0,
                        block_order=0,
                        block_role="title",
                        text="网上办事大厅",
                        is_main_content=False,
                    ),
                ],
            )

            report = replay_official_web_source_truth_local(
                output_dir=output_dir,
                projection_output_dir=projection_dir,
                declarations_path=declarations_path,
            )

            self.assertEqual(report.counts["pages_seen"], 3)
            self.assertEqual(report.counts["emitted_documents"], 2)
            self.assertEqual(report.counts["manual_review_pages"], 1)
            self.assertEqual(len(report.documents), 2)
            self.assertEqual(len(report.manual_review_pages), 1)
            self.assertTrue(
                any(
                    page["normalized_canonical_url"] == "https://www.example.edu/app/"
                    for page in report.manual_review_pages
                )
            )

            for document in report.documents:
                canonical_path = Path(document["canonical_markdown_path"])
                units_path = Path(document["document_units_path"])
                self.assertTrue(canonical_path.exists())
                self.assertTrue(units_path.exists())
                self.assertIn("# ", canonical_path.read_text(encoding="utf-8"))
                rows = [
                    json.loads(line)
                    for line in units_path.read_text(encoding="utf-8").splitlines()
                    if line.strip()
                ]
                self.assertGreater(len(rows), 0)
                self.assertTrue(all(row["doc_id"] == document["document_id"] for row in rows))

    def test_replay_official_web_source_truth_local_routes_stable_reference_titles_to_stable_reference_scope(
        self,
    ) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            output_dir = root / "collector-output"
            projection_dir = root / "projection-output"
            declarations_path = root / "projection-declarations.json"
            routing_path = root / "projection-routing.json"
            _write_json(declarations_path, _declarations_payload())
            _write_json(routing_path, _routing_payload(titles=["学校简介"]))
            _write_json(
                output_dir / "source-truth-bundle.json",
                {
                    "schemaVersion": "official_web_source_truth_bundle.v1",
                    "sourceChannel": "official_web",
                    "siteId": "campus_public",
                    "crawlRunId": "owrun_projection_001",
                    "generatedAt": "2026-03-31T09:00:00.000Z",
                    "pages": [
                        _page_bundle_entry(
                            raw_asset_id="owasset_intro_001",
                            raw_version_id="owver_intro_001",
                            normalized_canonical_url="https://www.example.edu/intro",
                            page_family="article_detail",
                        ),
                        _page_bundle_entry(
                            raw_asset_id="owasset_news_001",
                            raw_version_id="owver_news_001",
                            normalized_canonical_url="https://www.example.edu/news/1",
                            page_family="article_detail",
                        ),
                    ],
                },
            )
            _write_output_page(
                output_dir,
                site_id="campus_public",
                host="www.example.edu",
                raw_asset_id="owasset_intro_001",
                raw_version_id="owver_intro_001",
                normalized_canonical_url="https://www.example.edu/intro",
                page_title="学校简介",
                page_family="article_detail",
                blocks=[
                    _block(
                        raw_asset_id="owasset_intro_001",
                        raw_version_id="owver_intro_001",
                        row_id="title-1",
                        row_index=0,
                        block_order=0,
                        block_role="title",
                        text="学校简介",
                    ),
                    _block(
                        raw_asset_id="owasset_intro_001",
                        raw_version_id="owver_intro_001",
                        row_id="p-1",
                        row_index=1,
                        block_order=1,
                        block_role="paragraph",
                        text="中央民族大学是一所特色鲜明的高水平大学。",
                    ),
                ],
            )
            _write_output_page(
                output_dir,
                site_id="campus_public",
                host="www.example.edu",
                raw_asset_id="owasset_news_001",
                raw_version_id="owver_news_001",
                normalized_canonical_url="https://www.example.edu/news/1",
                page_title="校园新闻",
                page_family="article_detail",
                blocks=[
                    _block(
                        raw_asset_id="owasset_news_001",
                        raw_version_id="owver_news_001",
                        row_id="title-1",
                        row_index=0,
                        block_order=0,
                        block_role="title",
                        text="校园新闻",
                    ),
                    _block(
                        raw_asset_id="owasset_news_001",
                        raw_version_id="owver_news_001",
                        row_id="p-1",
                        row_index=1,
                        block_order=1,
                        block_role="paragraph",
                        text="学校召开专题工作会议，部署近期重点任务。",
                    ),
                ],
            )

            report = replay_official_web_source_truth_local(
                output_dir=output_dir,
                projection_output_dir=projection_dir,
                declarations_path=declarations_path,
                routing_path=routing_path,
            )

            self.assertEqual(report.counts["emitted_documents"], 2)
            documents_by_title = {document["title"]: document for document in report.documents}
            self.assertEqual(
                documents_by_title["学校简介"]["target_collection"], "stable_reference"
            )
            self.assertEqual(documents_by_title["学校简介"]["target_corpus"], "official_web")
            self.assertEqual(
                documents_by_title["学校简介"]["routing_route_id"], "stable-reference-bootstrap"
            )
            self.assertEqual(
                documents_by_title["校园新闻"]["target_collection"], "muc_public_pages"
            )
            self.assertIsNone(documents_by_title["校园新闻"]["routing_route_id"])

    def test_replay_official_web_source_truth_local_routes_fresh_news_seed_titles_to_fresh_news_scope(
        self,
    ) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            output_dir = root / "collector-output"
            projection_dir = root / "projection-output"
            declarations_path = root / "projection-declarations.json"
            routing_path = root / "projection-routing.json"
            _write_json(declarations_path, _declarations_payload())
            _write_json(
                routing_path,
                _routing_payload(
                    titles=["学校简介"],
                    extra_routes=[
                        {
                            "route_id": "fresh-news-seed-handoff",
                            "target_corpus": "official_web",
                            "target_collection": "fresh_news",
                            "page_families": ["article_detail"],
                            "title_allowlist": [
                                "中央民族大学唐鑫团队在红外高光谱成像系统研究获重大突破"
                            ],
                        }
                    ],
                ),
            )
            _write_json(
                output_dir / "source-truth-bundle.json",
                {
                    "schemaVersion": "official_web_source_truth_bundle.v1",
                    "sourceChannel": "official_web",
                    "siteId": "campus_public",
                    "crawlRunId": "owrun_projection_001",
                    "generatedAt": "2026-03-31T09:00:00.000Z",
                    "pages": [
                        _page_bundle_entry(
                            raw_asset_id="owasset_intro_001",
                            raw_version_id="owver_intro_001",
                            normalized_canonical_url="https://www.example.edu/intro",
                            page_family="article_detail",
                        ),
                        _page_bundle_entry(
                            raw_asset_id="owasset_news_001",
                            raw_version_id="owver_news_001",
                            normalized_canonical_url="https://www.example.edu/news/1",
                            page_family="article_detail",
                        ),
                        _page_bundle_entry(
                            raw_asset_id="owasset_misc_001",
                            raw_version_id="owver_misc_001",
                            normalized_canonical_url="https://www.example.edu/news/2",
                            page_family="article_detail",
                        ),
                    ],
                },
            )
            _write_output_page(
                output_dir,
                site_id="campus_public",
                host="www.example.edu",
                raw_asset_id="owasset_intro_001",
                raw_version_id="owver_intro_001",
                normalized_canonical_url="https://www.example.edu/intro",
                page_title="学校简介",
                page_family="article_detail",
                blocks=[
                    _block(
                        raw_asset_id="owasset_intro_001",
                        raw_version_id="owver_intro_001",
                        row_id="title-1",
                        row_index=0,
                        block_order=0,
                        block_role="title",
                        text="学校简介",
                    ),
                    _block(
                        raw_asset_id="owasset_intro_001",
                        raw_version_id="owver_intro_001",
                        row_id="p-1",
                        row_index=1,
                        block_order=1,
                        block_role="paragraph",
                        text="中央民族大学是一所特色鲜明的高水平大学。",
                    ),
                ],
            )
            _write_output_page(
                output_dir,
                site_id="campus_public",
                host="news.example.edu",
                raw_asset_id="owasset_news_001",
                raw_version_id="owver_news_001",
                normalized_canonical_url="https://www.example.edu/news/1",
                page_title="中央民族大学唐鑫团队在红外高光谱成像系统研究获重大突破",
                page_family="article_detail",
                blocks=[
                    _block(
                        raw_asset_id="owasset_news_001",
                        raw_version_id="owver_news_001",
                        row_id="title-1",
                        row_index=0,
                        block_order=0,
                        block_role="title",
                        text="中央民族大学唐鑫团队在红外高光谱成像系统研究获重大突破",
                    ),
                    _block(
                        raw_asset_id="owasset_news_001",
                        raw_version_id="owver_news_001",
                        row_id="p-1",
                        row_index=1,
                        block_order=1,
                        block_role="paragraph",
                        text="学校科研团队在红外高光谱成像系统研究中取得重要进展。",
                    ),
                ],
            )
            _write_output_page(
                output_dir,
                site_id="campus_public",
                host="news.example.edu",
                raw_asset_id="owasset_misc_001",
                raw_version_id="owver_misc_001",
                normalized_canonical_url="https://www.example.edu/news/2",
                page_title="校园新闻",
                page_family="article_detail",
                blocks=[
                    _block(
                        raw_asset_id="owasset_misc_001",
                        raw_version_id="owver_misc_001",
                        row_id="title-1",
                        row_index=0,
                        block_order=0,
                        block_role="title",
                        text="校园新闻",
                    ),
                    _block(
                        raw_asset_id="owasset_misc_001",
                        raw_version_id="owver_misc_001",
                        row_id="p-1",
                        row_index=1,
                        block_order=1,
                        block_role="paragraph",
                        text="学校召开专题工作会议，部署近期重点任务。",
                    ),
                ],
            )

            report = replay_official_web_source_truth_local(
                output_dir=output_dir,
                projection_output_dir=projection_dir,
                declarations_path=declarations_path,
                routing_path=routing_path,
            )

            documents_by_title = {document["title"]: document for document in report.documents}
            self.assertEqual(
                documents_by_title["学校简介"]["target_collection"], "stable_reference"
            )
            self.assertEqual(
                documents_by_title["中央民族大学唐鑫团队在红外高光谱成像系统研究获重大突破"][
                    "target_collection"
                ],
                "fresh_news",
            )
            self.assertEqual(
                documents_by_title["中央民族大学唐鑫团队在红外高光谱成像系统研究获重大突破"][
                    "routing_route_id"
                ],
                "fresh-news-seed-handoff",
            )
            self.assertEqual(
                documents_by_title["校园新闻"]["target_collection"], "muc_public_pages"
            )
            self.assertIsNone(documents_by_title["校园新闻"]["routing_route_id"])

    def test_replay_official_web_source_truth_local_keeps_generic_fallback_pages_in_manual_review_for_muc_public_pages(
        self,
    ) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            output_dir = root / "collector-output"
            projection_dir = root / "projection-output"
            declarations_path = root / "projection-declarations.json"
            _write_json(declarations_path, _declarations_payload())
            _write_json(
                output_dir / "source-truth-bundle.json",
                {
                    "schemaVersion": "official_web_source_truth_bundle.v1",
                    "sourceChannel": "official_web",
                    "siteId": "campus_public",
                    "crawlRunId": "owrun_projection_001",
                    "generatedAt": "2026-03-31T09:00:00.000Z",
                    "pages": [
                        _page_bundle_entry(
                            raw_asset_id="owasset_generic_001",
                            raw_version_id="owver_generic_001",
                            normalized_canonical_url="https://www.example.edu/",
                            page_family="generic_content_page",
                        ),
                    ],
                },
            )
            _write_output_page(
                output_dir,
                site_id="campus_public",
                host="www.example.edu",
                raw_asset_id="owasset_generic_001",
                raw_version_id="owver_generic_001",
                normalized_canonical_url="https://www.example.edu/",
                page_title="门户首页",
                page_family="generic_content_page",
                blocks=[
                    _block(
                        raw_asset_id="owasset_generic_001",
                        raw_version_id="owver_generic_001",
                        row_id="title-1",
                        row_index=0,
                        block_order=0,
                        block_role="title",
                        text="门户首页",
                    ),
                    _block(
                        raw_asset_id="owasset_generic_001",
                        raw_version_id="owver_generic_001",
                        row_id="link-1",
                        row_index=1,
                        block_order=1,
                        block_role="link",
                        text="学校召开就业工作推进会",
                    ),
                    _block(
                        raw_asset_id="owasset_generic_001",
                        raw_version_id="owver_generic_001",
                        row_id="link-2",
                        row_index=2,
                        block_order=2,
                        block_role="link",
                        text="2026年招生宣传工作启动",
                    ),
                ],
            )

            report = replay_official_web_source_truth_local(
                output_dir=output_dir,
                projection_output_dir=projection_dir,
                declarations_path=declarations_path,
            )

            self.assertEqual(report.counts["emitted_documents"], 0)
            self.assertEqual(report.counts["manual_review_pages"], 1)
            self.assertEqual(report.manual_review_pages[0]["page_family"], "generic_content_page")
            self.assertIn("staged_only", report.manual_review_pages[0]["reason"])

    def test_projection_emits_serving_intent_metadata_for_promotable_and_audit_only_documents(
        self,
    ) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            output_dir = root / "collector-output"
            projection_dir = root / "projection-output"
            declarations_path = root / "projection-declarations.json"
            _write_json(declarations_path, _declarations_payload())
            _write_json(
                output_dir / "source-truth-bundle.json",
                {
                    "schemaVersion": "official_web_source_truth_bundle.v1",
                    "sourceChannel": "official_web",
                    "siteId": "campus_public",
                    "crawlRunId": "owrun_projection_001",
                    "generatedAt": "2026-03-31T09:00:00.000Z",
                    "pages": [
                        _page_bundle_entry(
                            raw_asset_id="owasset_article_010",
                            raw_version_id="owver_article_010",
                            normalized_canonical_url="https://www.example.edu/news/10",
                            page_family="article_detail",
                        ),
                        _page_bundle_entry(
                            raw_asset_id="owasset_listing_010",
                            raw_version_id="owver_listing_010",
                            normalized_canonical_url="https://www.example.edu/news/",
                            page_family="listing_page",
                        ),
                    ],
                },
            )
            _write_output_page(
                output_dir,
                site_id="campus_public",
                host="www.example.edu",
                raw_asset_id="owasset_article_010",
                raw_version_id="owver_article_010",
                normalized_canonical_url="https://www.example.edu/news/10",
                page_title="新闻详情",
                page_family="article_detail",
                blocks=[
                    _block(
                        raw_asset_id="owasset_article_010",
                        raw_version_id="owver_article_010",
                        row_id="title-1",
                        row_index=0,
                        block_order=0,
                        block_role="title",
                        text="新闻详情",
                    ),
                    _block(
                        raw_asset_id="owasset_article_010",
                        raw_version_id="owver_article_010",
                        row_id="p-1",
                        row_index=1,
                        block_order=1,
                        block_role="paragraph",
                        text="中央民族大学召开专题工作会议，部署本学期重点任务。",
                    ),
                ],
            )
            _write_output_page(
                output_dir,
                site_id="campus_public",
                host="www.example.edu",
                raw_asset_id="owasset_listing_010",
                raw_version_id="owver_listing_010",
                normalized_canonical_url="https://www.example.edu/news/",
                page_title="新闻网",
                page_family="listing_page",
                blocks=[
                    _block(
                        raw_asset_id="owasset_listing_010",
                        raw_version_id="owver_listing_010",
                        row_id="title-1",
                        row_index=0,
                        block_order=0,
                        block_role="title",
                        text="新闻网",
                    ),
                    _block(
                        raw_asset_id="owasset_listing_010",
                        raw_version_id="owver_listing_010",
                        row_id="item-1",
                        row_index=1,
                        block_order=1,
                        block_role="list_item",
                        text="学校召开就业工作推进会",
                    ),
                ],
            )

            report = replay_official_web_source_truth_local(
                output_dir=output_dir,
                projection_output_dir=projection_dir,
                declarations_path=declarations_path,
            )

            article_document = next(
                document
                for document in report.documents
                if document["page_family"] == "article_detail"
            )
            listing_document = next(
                document
                for document in report.documents
                if document["page_family"] == "listing_page"
            )
            article_units = [
                json.loads(line)
                for line in Path(article_document["document_units_path"])
                .read_text(encoding="utf-8")
                .splitlines()
                if line.strip()
            ]
            listing_units = [
                json.loads(line)
                for line in Path(listing_document["document_units_path"])
                .read_text(encoding="utf-8")
                .splitlines()
                if line.strip()
            ]

            self.assertEqual(article_document["serving_intent"], "promotable")
            self.assertIsNone(article_document["promotion_block_reason"])
            self.assertEqual(article_units[0]["metadata"]["serving_intent"], "promotable")
            self.assertEqual(article_units[0]["metadata"]["content_role"], "primary_content")
            self.assertNotIn("promotion_block_reason", article_units[0]["metadata"])
            self.assertNotIn("acl", article_units[0])

            self.assertEqual(listing_document["serving_intent"], "audit_only")
            self.assertEqual(listing_document["promotion_block_reason"], "listing_page_audit_only")
            self.assertEqual(listing_units[0]["metadata"]["serving_intent"], "audit_only")
            self.assertEqual(
                listing_units[0]["metadata"]["promotion_block_reason"], "listing_page_audit_only"
            )
            self.assertEqual(listing_units[0]["metadata"]["content_role"], "navigation_audit")
            self.assertNotIn("acl", listing_units[0])

    def test_projection_propagates_publication_and_fetch_metadata(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            output_dir = root / "collector-output"
            projection_dir = root / "projection-output"
            declarations_path = root / "projection-declarations.json"
            _write_json(declarations_path, _declarations_payload())
            _write_json(
                output_dir / "source-truth-bundle.json",
                {
                    "schemaVersion": "official_web_source_truth_bundle.v1",
                    "sourceChannel": "official_web",
                    "siteId": "campus_public",
                    "crawlRunId": "owrun_projection_001",
                    "generatedAt": "2026-03-31T09:00:00.000Z",
                    "pages": [
                        _page_bundle_entry(
                            raw_asset_id="owasset_article_011",
                            raw_version_id="owver_article_011",
                            normalized_canonical_url="https://www.example.edu/news/11",
                            page_family="article_detail",
                        ),
                    ],
                },
            )
            _write_output_page(
                output_dir,
                site_id="campus_public",
                host="www.example.edu",
                raw_asset_id="owasset_article_011",
                raw_version_id="owver_article_011",
                normalized_canonical_url="https://www.example.edu/news/11",
                page_title="新闻详情",
                page_family="article_detail",
                published_at="2026-03-25T00:00:00+08:00",
                last_modified="Tue, 25 Mar 2026 08:00:00 GMT",
                blocks=[
                    _block(
                        raw_asset_id="owasset_article_011",
                        raw_version_id="owver_article_011",
                        row_id="title-1",
                        row_index=0,
                        block_order=0,
                        block_role="title",
                        text="新闻详情",
                    ),
                    _block(
                        raw_asset_id="owasset_article_011",
                        raw_version_id="owver_article_011",
                        row_id="p-1",
                        row_index=1,
                        block_order=1,
                        block_role="paragraph",
                        text="中央民族大学召开专题工作会议，部署本学期重点任务。",
                    ),
                ],
            )

            report = replay_official_web_source_truth_local(
                output_dir=output_dir,
                projection_output_dir=projection_dir,
                declarations_path=declarations_path,
            )
            document = report.documents[0]
            units = [
                json.loads(line)
                for line in Path(document["document_units_path"])
                .read_text(encoding="utf-8")
                .splitlines()
                if line.strip()
            ]

            self.assertEqual(document["published_at"], "2026-03-25T00:00:00+08:00")
            self.assertEqual(document["fetched_at"], "2026-03-31T09:00:00.000Z")
            self.assertEqual(document["last_modified"], "Tue, 25 Mar 2026 08:00:00 GMT")
            self.assertEqual(units[0]["metadata"]["published_at"], "2026-03-25T00:00:00+08:00")
            self.assertEqual(units[0]["metadata"]["fetched_at"], "2026-03-31T09:00:00.000Z")
            self.assertEqual(units[0]["metadata"]["last_modified"], "Tue, 25 Mar 2026 08:00:00 GMT")

    def test_projection_marks_low_value_public_notice_articles_as_audit_only(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            output_dir = root / "collector-output"
            projection_dir = root / "projection-output"
            declarations_path = root / "projection-declarations.json"
            _write_json(declarations_path, _declarations_payload())
            _write_json(
                output_dir / "source-truth-bundle.json",
                {
                    "schemaVersion": "official_web_source_truth_bundle.v1",
                    "sourceChannel": "official_web",
                    "siteId": "campus_public",
                    "crawlRunId": "owrun_projection_001",
                    "generatedAt": "2026-03-31T09:00:00.000Z",
                    "pages": [
                        _page_bundle_entry(
                            raw_asset_id="owasset_notice_001",
                            raw_version_id="owver_notice_001",
                            normalized_canonical_url="https://xxgk.example.edu/info/1297/5711.htm",
                            page_family="article_detail",
                        ),
                        _page_bundle_entry(
                            raw_asset_id="owasset_notice_002",
                            raw_version_id="owver_notice_002",
                            normalized_canonical_url="https://xxgk.example.edu/info/1358/28711.htm",
                            page_family="article_detail",
                        ),
                    ],
                },
            )
            _write_output_page(
                output_dir,
                site_id="campus_public",
                host="xxgk.example.edu",
                raw_asset_id="owasset_notice_001",
                raw_version_id="owver_notice_001",
                normalized_canonical_url="https://xxgk.example.edu/info/1297/5711.htm",
                page_title="中央民族大学公开招聘及公示信息",
                page_family="article_detail",
                blocks=[
                    _block(
                        raw_asset_id="owasset_notice_001",
                        raw_version_id="owver_notice_001",
                        row_id="title-1",
                        row_index=0,
                        block_order=0,
                        block_role="title",
                        text="中央民族大学公开招聘及公示信息",
                    ),
                    _block(
                        raw_asset_id="owasset_notice_001",
                        raw_version_id="owver_notice_001",
                        row_id="p-1",
                        row_index=1,
                        block_order=1,
                        block_role="paragraph",
                        text="现发布中央民族大学公开招聘及公示信息，请查阅附件和后续说明。",
                    ),
                ],
            )
            _write_output_page(
                output_dir,
                site_id="campus_public",
                host="xxgk.example.edu",
                raw_asset_id="owasset_notice_002",
                raw_version_id="owver_notice_002",
                normalized_canonical_url="https://xxgk.example.edu/info/1358/28711.htm",
                page_title="中央民族大学海淀校区为新购置家具加装嵌入式插座项目采购谈判结果公示",
                page_family="article_detail",
                blocks=[
                    _block(
                        raw_asset_id="owasset_notice_002",
                        raw_version_id="owver_notice_002",
                        row_id="title-1",
                        row_index=0,
                        block_order=0,
                        block_role="title",
                        text="中央民族大学海淀校区为新购置家具加装嵌入式插座项目采购谈判结果公示",
                    ),
                    _block(
                        raw_asset_id="owasset_notice_002",
                        raw_version_id="owver_notice_002",
                        row_id="p-1",
                        row_index=1,
                        block_order=1,
                        block_role="paragraph",
                        text="现将采购谈判结果予以公示，项目联系人与结果说明如下。",
                    ),
                ],
            )

            report = replay_official_web_source_truth_local(
                output_dir=output_dir,
                projection_output_dir=projection_dir,
                declarations_path=declarations_path,
            )

            documents_by_title = {document["title"]: document for document in report.documents}
            for title in (
                "中央民族大学公开招聘及公示信息",
                "中央民族大学海淀校区为新购置家具加装嵌入式插座项目采购谈判结果公示",
            ):
                document = documents_by_title[title]
                units = [
                    json.loads(line)
                    for line in Path(document["document_units_path"])
                    .read_text(encoding="utf-8")
                    .splitlines()
                    if line.strip()
                ]
                self.assertEqual(document["serving_intent"], "audit_only")
                self.assertEqual(
                    document["promotion_block_reason"], "low_value_public_notice_audit_only"
                )
                self.assertEqual(units[0]["metadata"]["serving_intent"], "audit_only")
                self.assertEqual(
                    units[0]["metadata"]["promotion_block_reason"],
                    "low_value_public_notice_audit_only",
                )

    def test_directory_projection_splits_dense_roster_into_multiple_directory_entries(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            output_dir = root / "collector-output"
            projection_dir = root / "projection-output"
            declarations_path = root / "projection-declarations.json"
            payload = _declarations_payload()
            payload["declarations"].insert(
                3,
                {
                    "declaration_id": "directory-page-primary",
                    "page_family": "directory_page",
                    "target_corpus": "official_web",
                    "target_collection": "muc_public_pages",
                    "projection_family": "directory_document",
                    "document_kind": "directory",
                    "action": "emit_document",
                },
            )
            _write_json(declarations_path, payload)
            _write_json(
                output_dir / "source-truth-bundle.json",
                {
                    "schemaVersion": "official_web_source_truth_bundle.v1",
                    "sourceChannel": "official_web",
                    "siteId": "campus_public",
                    "crawlRunId": "owrun_projection_001",
                    "generatedAt": "2026-03-31T09:00:00.000Z",
                    "pages": [
                        _page_bundle_entry(
                            raw_asset_id="owasset_directory_001",
                            raw_version_id="owver_directory_001",
                            normalized_canonical_url="https://www.example.edu/faculty",
                            page_family="directory_page",
                        ),
                    ],
                },
            )
            _write_output_page(
                output_dir,
                site_id="campus_public",
                host="www.example.edu",
                raw_asset_id="owasset_directory_001",
                raw_version_id="owver_directory_001",
                normalized_canonical_url="https://www.example.edu/faculty",
                page_title="师资队伍",
                page_family="directory_page",
                blocks=[
                    _block(
                        raw_asset_id="owasset_directory_001",
                        raw_version_id="owver_directory_001",
                        row_id="title-1",
                        row_index=0,
                        block_order=0,
                        block_role="title",
                        text="师资队伍",
                    ),
                    _block(
                        raw_asset_id="owasset_directory_001",
                        raw_version_id="owver_directory_001",
                        row_id="heading-1",
                        row_index=1,
                        block_order=1,
                        block_role="heading",
                        text="专任教师",
                    ),
                    _block(
                        raw_asset_id="owasset_directory_001",
                        raw_version_id="owver_directory_001",
                        row_id="p-1",
                        row_index=2,
                        block_order=2,
                        block_role="paragraph",
                        text="张三 教授 研究方向：民族法学 电子邮箱：zhangsan@example.edu",
                        parent_heading_path=["专任教师"],
                    ),
                    _block(
                        raw_asset_id="owasset_directory_001",
                        raw_version_id="owver_directory_001",
                        row_id="p-2",
                        row_index=3,
                        block_order=3,
                        block_role="paragraph",
                        text="李四 副教授 办公电话：010-68930001 电子邮箱：lisi@example.edu",
                        parent_heading_path=["专任教师"],
                    ),
                ],
            )

            report = replay_official_web_source_truth_local(
                output_dir=output_dir,
                projection_output_dir=projection_dir,
                declarations_path=declarations_path,
            )
            units = [
                json.loads(line)
                for line in Path(report.documents[0]["document_units_path"])
                .read_text(encoding="utf-8")
                .splitlines()
                if line.strip()
            ]

            self.assertEqual(
                [unit["unit_type"] for unit in units], ["directory_entry", "directory_entry"]
            )
            self.assertEqual(
                units[0]["clean_text"],
                "张三 教授 研究方向：民族法学 电子邮箱：zhangsan@example.edu",
            )
            self.assertEqual(
                units[1]["clean_text"],
                "李四 副教授 办公电话：010-68930001 电子邮箱：lisi@example.edu",
            )
            self.assertEqual(units[0]["metadata"]["serving_intent"], "promotable")
            self.assertEqual(units[0]["metadata"]["content_role"], "directory_reference")

    def test_projection_emits_stable_semantic_content_hash_for_cross_host_duplicate_articles(
        self,
    ) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            output_dir = root / "collector-output"
            projection_dir = root / "projection-output"
            declarations_path = root / "projection-declarations.json"
            _write_json(declarations_path, _declarations_payload())
            _write_json(
                output_dir / "source-truth-bundle.json",
                {
                    "schemaVersion": "official_web_source_truth_bundle.v1",
                    "sourceChannel": "official_web",
                    "siteId": "campus_public",
                    "crawlRunId": "owrun_projection_001",
                    "generatedAt": "2026-03-31T09:00:00.000Z",
                    "pages": [
                        _page_bundle_entry(
                            raw_asset_id="owasset_article_news",
                            raw_version_id="owver_article_news",
                            normalized_canonical_url="https://news.example.edu/info/1.htm",
                            page_family="article_detail",
                        ),
                        _page_bundle_entry(
                            raw_asset_id="owasset_article_xxgk",
                            raw_version_id="owver_article_xxgk",
                            normalized_canonical_url="https://xxgk.example.edu/info/2.htm",
                            page_family="article_detail",
                        ),
                    ],
                },
            )
            shared_blocks = [
                {
                    "row_id": "title-1",
                    "row_index": 0,
                    "block_order": 0,
                    "block_role": "title",
                    "text": "中央民族大学与北京丰台人才集团共建就业实习实践基地",
                },
                {
                    "row_id": "p-1",
                    "row_index": 1,
                    "block_order": 1,
                    "block_role": "paragraph",
                    "text": "中央民族大学与北京丰台人才集团共建就业实习实践基地。",
                },
                {
                    "row_id": "p-2",
                    "row_index": 2,
                    "block_order": 2,
                    "block_role": "paragraph",
                    "text": "双方将围绕就业见习、实践育人、人才输送等方面开展合作。",
                },
            ]
            _write_output_page(
                output_dir,
                site_id="campus_public",
                host="news.example.edu",
                raw_asset_id="owasset_article_news",
                raw_version_id="owver_article_news",
                normalized_canonical_url="https://news.example.edu/info/1.htm",
                page_title="中央民族大学与北京丰台人才集团共建就业实习实践基地",
                page_family="article_detail",
                blocks=[
                    _block(
                        raw_asset_id="owasset_article_news",
                        raw_version_id="owver_article_news",
                        row_id=item["row_id"],
                        row_index=item["row_index"],
                        block_order=item["block_order"],
                        block_role=item["block_role"],
                        text=item["text"],
                    )
                    for item in shared_blocks
                ],
            )
            _write_output_page(
                output_dir,
                site_id="campus_public",
                host="xxgk.example.edu",
                raw_asset_id="owasset_article_xxgk",
                raw_version_id="owver_article_xxgk",
                normalized_canonical_url="https://xxgk.example.edu/info/2.htm",
                page_title="中央民族大学与北京丰台人才集团共建就业实习实践基地",
                page_family="article_detail",
                blocks=[
                    _block(
                        raw_asset_id="owasset_article_xxgk",
                        raw_version_id="owver_article_xxgk",
                        row_id=item["row_id"],
                        row_index=item["row_index"],
                        block_order=item["block_order"],
                        block_role=item["block_role"],
                        text=item["text"],
                    )
                    for item in shared_blocks
                ],
            )

            report = replay_official_web_source_truth_local(
                output_dir=output_dir,
                projection_output_dir=projection_dir,
                declarations_path=declarations_path,
            )
            news_document = next(
                document
                for document in report.documents
                if document["raw_asset_id"] == "owasset_article_news"
            )
            xxgk_document = next(
                document
                for document in report.documents
                if document["raw_asset_id"] == "owasset_article_xxgk"
            )
            news_units = [
                json.loads(line)
                for line in Path(news_document["document_units_path"])
                .read_text(encoding="utf-8")
                .splitlines()
                if line.strip()
            ]
            xxgk_units = [
                json.loads(line)
                for line in Path(xxgk_document["document_units_path"])
                .read_text(encoding="utf-8")
                .splitlines()
                if line.strip()
            ]

            self.assertEqual(
                news_units[0]["metadata"]["semantic_content_hash"],
                xxgk_units[0]["metadata"]["semantic_content_hash"],
            )
            self.assertTrue(news_units[0]["metadata"]["semantic_content_hash"])

    def test_projection_semantic_content_hash_ignores_terminal_host_specific_boilerplate(
        self,
    ) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            output_dir = root / "collector-output"
            projection_dir = root / "projection-output"
            declarations_path = root / "projection-declarations.json"
            _write_json(declarations_path, _declarations_payload())
            _write_json(
                output_dir / "source-truth-bundle.json",
                {
                    "schemaVersion": "official_web_source_truth_bundle.v1",
                    "sourceChannel": "official_web",
                    "siteId": "campus_public",
                    "crawlRunId": "owrun_projection_001",
                    "generatedAt": "2026-03-31T09:00:00.000Z",
                    "pages": [
                        _page_bundle_entry(
                            raw_asset_id="owasset_article_news_boilerplate",
                            raw_version_id="owver_article_news_boilerplate",
                            normalized_canonical_url="https://news.example.edu/info/61874.htm",
                            page_family="article_detail",
                        ),
                        _page_bundle_entry(
                            raw_asset_id="owasset_article_xxgk_boilerplate",
                            raw_version_id="owver_article_xxgk_boilerplate",
                            normalized_canonical_url="https://xxgk.example.edu/info/28641.htm",
                            page_family="article_detail",
                        ),
                    ],
                },
            )
            shared_blocks = [
                {
                    "row_id": "title-1",
                    "row_index": 0,
                    "block_order": 0,
                    "block_role": "title",
                    "text": "中央民族大学与北京丰台人才集团共建就业实习实践基地",
                },
                {
                    "row_id": "p-1",
                    "row_index": 1,
                    "block_order": 1,
                    "block_role": "paragraph",
                    "text": "新闻网讯 为进一步推动教育科技人才一体发展，深化校地校企合作交流，双方围绕人才共育、产教融合、成果转化、学生就业实习等领域深入沟通。",
                },
                {
                    "row_id": "p-2",
                    "row_index": 2,
                    "block_order": 2,
                    "block_role": "paragraph",
                    "text": "中央民族大学招生就业工作处与丰台人才集团将围绕就业见习、实践育人、人才输送等方面开展合作。",
                },
            ]
            news_blocks = [
                *shared_blocks,
                {
                    "row_id": "bp-1",
                    "row_index": 3,
                    "block_order": 3,
                    "block_role": "paragraph",
                    "text": "新闻网版权与免责声明：",
                },
                {
                    "row_id": "bp-2",
                    "row_index": 4,
                    "block_order": 4,
                    "block_role": "paragraph",
                    "text": "① 凡本网未注明其他出处的作品，版权均属于中央民族大学新闻中心，转载、摘编或以其它方式使用本网作品的应注明“来源：中央民族大学新闻网”。违反上述声明者，本网将追究其相关法律责任。",
                },
                {
                    "row_id": "bp-3",
                    "row_index": 5,
                    "block_order": 5,
                    "block_role": "paragraph",
                    "text": "② 凡本网注明其他来源的作品，均转载自其它媒体，转载目的在于传递更多信息，并不代表本网赞同其观点和对其真实性负责。",
                },
                {
                    "row_id": "bp-4",
                    "row_index": 6,
                    "block_order": 6,
                    "block_role": "paragraph",
                    "text": "③ 有关作品内容、版权和其它问题请与我们联系。",
                },
                {
                    "row_id": "bp-5",
                    "row_index": 7,
                    "block_order": 7,
                    "block_role": "paragraph",
                    "text": "投稿方式：mucxcb@example.edu.cn",
                },
            ]
            xxgk_blocks = [
                *shared_blocks,
                {
                    "row_id": "bp-6",
                    "row_index": 3,
                    "block_order": 3,
                    "block_role": "paragraph",
                    "text": "Copyright@ 2018 -- 党委办公室 校长办公室 All Rights Reserved",
                },
            ]
            _write_output_page(
                output_dir,
                site_id="campus_public",
                host="news.example.edu",
                raw_asset_id="owasset_article_news_boilerplate",
                raw_version_id="owver_article_news_boilerplate",
                normalized_canonical_url="https://news.example.edu/info/61874.htm",
                page_title="中央民族大学与北京丰台人才集团共建就业实习实践基地",
                page_family="article_detail",
                blocks=[
                    _block(
                        raw_asset_id="owasset_article_news_boilerplate",
                        raw_version_id="owver_article_news_boilerplate",
                        row_id=item["row_id"],
                        row_index=item["row_index"],
                        block_order=item["block_order"],
                        block_role=item["block_role"],
                        text=item["text"],
                    )
                    for item in news_blocks
                ],
            )
            _write_output_page(
                output_dir,
                site_id="campus_public",
                host="xxgk.example.edu",
                raw_asset_id="owasset_article_xxgk_boilerplate",
                raw_version_id="owver_article_xxgk_boilerplate",
                normalized_canonical_url="https://xxgk.example.edu/info/28641.htm",
                page_title="中央民族大学与北京丰台人才集团共建就业实习实践基地",
                page_family="article_detail",
                blocks=[
                    _block(
                        raw_asset_id="owasset_article_xxgk_boilerplate",
                        raw_version_id="owver_article_xxgk_boilerplate",
                        row_id=item["row_id"],
                        row_index=item["row_index"],
                        block_order=item["block_order"],
                        block_role=item["block_role"],
                        text=item["text"],
                    )
                    for item in xxgk_blocks
                ],
            )

            report = replay_official_web_source_truth_local(
                output_dir=output_dir,
                projection_output_dir=projection_dir,
                declarations_path=declarations_path,
            )
            news_document = next(
                document
                for document in report.documents
                if document["raw_asset_id"] == "owasset_article_news_boilerplate"
            )
            xxgk_document = next(
                document
                for document in report.documents
                if document["raw_asset_id"] == "owasset_article_xxgk_boilerplate"
            )
            news_units = [
                json.loads(line)
                for line in Path(news_document["document_units_path"])
                .read_text(encoding="utf-8")
                .splitlines()
                if line.strip()
            ]
            xxgk_units = [
                json.loads(line)
                for line in Path(xxgk_document["document_units_path"])
                .read_text(encoding="utf-8")
                .splitlines()
                if line.strip()
            ]

            news_support_units = [
                unit for unit in news_units if unit["metadata"]["content_role"] == "boilerplate"
            ]
            xxgk_support_units = [
                unit for unit in xxgk_units if unit["metadata"]["content_role"] == "boilerplate"
            ]

            self.assertEqual(len(news_support_units), 1)
            self.assertEqual(len(xxgk_support_units), 1)
            self.assertIn("投稿方式：mucxcb@example.edu.cn", news_support_units[0]["clean_text"])
            self.assertIn("All Rights Reserved", xxgk_support_units[0]["clean_text"])
            self.assertEqual(
                news_units[0]["metadata"]["semantic_content_hash"],
                xxgk_units[0]["metadata"]["semantic_content_hash"],
            )

    def test_replay_official_web_source_truth_local_keeps_portal_like_directory_pages_in_manual_review(
        self,
    ) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            output_dir = root / "collector-output"
            projection_dir = root / "projection-output"
            declarations_path = root / "projection-declarations.json"
            payload = _declarations_payload()
            payload["declarations"].insert(
                3,
                {
                    "declaration_id": "directory-page-primary",
                    "page_family": "directory_page",
                    "target_corpus": "official_web",
                    "target_collection": "muc_public_pages",
                    "projection_family": "directory_document",
                    "document_kind": "directory",
                    "action": "emit_document",
                },
            )
            _write_json(declarations_path, payload)
            _write_json(
                output_dir / "source-truth-bundle.json",
                {
                    "schemaVersion": "official_web_source_truth_bundle.v1",
                    "sourceChannel": "official_web",
                    "siteId": "campus_public",
                    "crawlRunId": "owrun_projection_001",
                    "generatedAt": "2026-03-31T09:00:00.000Z",
                    "pages": [
                        _page_bundle_entry(
                            raw_asset_id="owasset_directory_portal_001",
                            raw_version_id="owver_directory_portal_001",
                            normalized_canonical_url="https://www.example.edu/",
                            page_family="directory_page",
                        ),
                    ],
                },
            )
            _write_output_page(
                output_dir,
                site_id="campus_public",
                host="www.example.edu",
                raw_asset_id="owasset_directory_portal_001",
                raw_version_id="owver_directory_portal_001",
                normalized_canonical_url="https://www.example.edu/",
                page_title="中央民族大学",
                page_family="directory_page",
                blocks=[
                    _block(
                        raw_asset_id="owasset_directory_portal_001",
                        raw_version_id="owver_directory_portal_001",
                        row_id="title-1",
                        row_index=0,
                        block_order=0,
                        block_role="title",
                        text="中央民族大学",
                    ),
                    _block(
                        raw_asset_id="owasset_directory_portal_001",
                        raw_version_id="owver_directory_portal_001",
                        row_id="heading-1",
                        row_index=1,
                        block_order=1,
                        block_role="heading",
                        text="中央民族大学与北京丰台人才集团共建就业实习实践基地",
                    ),
                    _block(
                        raw_asset_id="owasset_directory_portal_001",
                        raw_version_id="owver_directory_portal_001",
                        row_id="p-1",
                        row_index=2,
                        block_order=2,
                        block_role="paragraph",
                        text="2026.03.27",
                        parent_heading_path=["中央民族大学与北京丰台人才集团共建就业实习实践基地"],
                    ),
                    _block(
                        raw_asset_id="owasset_directory_portal_001",
                        raw_version_id="owver_directory_portal_001",
                        row_id="heading-2",
                        row_index=3,
                        block_order=3,
                        block_role="heading",
                        text="通知公告",
                    ),
                    _block(
                        raw_asset_id="owasset_directory_portal_001",
                        raw_version_id="owver_directory_portal_001",
                        row_id="link-1",
                        row_index=4,
                        block_order=4,
                        block_role="link",
                        text="图书馆",
                        parent_heading_path=["通知公告"],
                    ),
                    _block(
                        raw_asset_id="owasset_directory_portal_001",
                        raw_version_id="owver_directory_portal_001",
                        row_id="link-2",
                        row_index=5,
                        block_order=5,
                        block_role="link",
                        text="信息门户",
                        parent_heading_path=["通知公告"],
                    ),
                    _block(
                        raw_asset_id="owasset_directory_portal_001",
                        raw_version_id="owver_directory_portal_001",
                        row_id="heading-3",
                        row_index=6,
                        block_order=6,
                        block_role="heading",
                        text="中央民族大学党委举办树立和践行正确政绩观学习教育读书班",
                    ),
                    _block(
                        raw_asset_id="owasset_directory_portal_001",
                        raw_version_id="owver_directory_portal_001",
                        row_id="p-2",
                        row_index=7,
                        block_order=7,
                        block_role="paragraph",
                        text="2026.03.26",
                        parent_heading_path=[
                            "中央民族大学党委举办树立和践行正确政绩观学习教育读书班"
                        ],
                    ),
                ],
            )

            report = replay_official_web_source_truth_local(
                output_dir=output_dir,
                projection_output_dir=projection_dir,
                declarations_path=declarations_path,
            )

            self.assertEqual(report.counts["emitted_documents"], 0)
            self.assertEqual(report.counts["manual_review_pages"], 1)
            self.assertEqual(report.manual_review_pages[0]["page_family"], "directory_page")
            self.assertIn("staged_only", report.manual_review_pages[0]["reason"])

    def test_validate_official_web_projection_output_reports_missing_document_units(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            output_dir = root / "collector-output"
            projection_dir = root / "projection-output"
            declarations_path = root / "projection-declarations.json"
            _write_json(declarations_path, _declarations_payload())
            _write_json(
                output_dir / "source-truth-bundle.json",
                {
                    "schemaVersion": "official_web_source_truth_bundle.v1",
                    "sourceChannel": "official_web",
                    "siteId": "campus_public",
                    "crawlRunId": "owrun_projection_001",
                    "generatedAt": "2026-03-31T09:00:00.000Z",
                    "pages": [
                        _page_bundle_entry(
                            raw_asset_id="owasset_article_001",
                            raw_version_id="owver_article_001",
                            normalized_canonical_url="https://www.example.edu/news/1",
                            page_family="article_detail",
                        ),
                    ],
                },
            )
            _write_output_page(
                output_dir,
                site_id="campus_public",
                host="www.example.edu",
                raw_asset_id="owasset_article_001",
                raw_version_id="owver_article_001",
                normalized_canonical_url="https://www.example.edu/news/1",
                page_title="新闻详情",
                page_family="article_detail",
                blocks=[
                    _block(
                        raw_asset_id="owasset_article_001",
                        raw_version_id="owver_article_001",
                        row_id="title-1",
                        row_index=0,
                        block_order=0,
                        block_role="title",
                        text="新闻详情",
                    ),
                    _block(
                        raw_asset_id="owasset_article_001",
                        raw_version_id="owver_article_001",
                        row_id="p-1",
                        row_index=1,
                        block_order=1,
                        block_role="paragraph",
                        text="中央民族大学召开专题工作会议。",
                    ),
                ],
            )

            report = replay_official_web_source_truth_local(
                output_dir=output_dir,
                projection_output_dir=projection_dir,
                declarations_path=declarations_path,
            )
            document_units_path = Path(report.documents[0]["document_units_path"])
            document_units_path.unlink()

            validation = validate_official_web_projection_output(projection_dir)

            self.assertFalse(validation.valid)
            self.assertTrue(
                any(issue["code"] == "missing_document_units" for issue in validation.issues)
            )

    def test_article_projection_skips_leading_listing_noise_before_first_paragraph(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            output_dir = root / "collector-output"
            projection_dir = root / "projection-output"
            declarations_path = root / "projection-declarations.json"
            _write_json(declarations_path, _declarations_payload())
            _write_json(
                output_dir / "source-truth-bundle.json",
                {
                    "schemaVersion": "official_web_source_truth_bundle.v1",
                    "sourceChannel": "official_web",
                    "siteId": "campus_public",
                    "crawlRunId": "owrun_projection_001",
                    "generatedAt": "2026-03-31T09:00:00.000Z",
                    "pages": [
                        _page_bundle_entry(
                            raw_asset_id="owasset_article_001",
                            raw_version_id="owver_article_001",
                            normalized_canonical_url="https://www.example.edu/about",
                            page_family="article_detail",
                        ),
                    ],
                },
            )
            _write_output_page(
                output_dir,
                site_id="campus_public",
                host="www.example.edu",
                raw_asset_id="owasset_article_001",
                raw_version_id="owver_article_001",
                normalized_canonical_url="https://www.example.edu/about",
                page_title="学校概况",
                page_family="article_detail",
                blocks=[
                    _block(
                        raw_asset_id="owasset_article_001",
                        raw_version_id="owver_article_001",
                        row_id="title-1",
                        row_index=0,
                        block_order=0,
                        block_role="title",
                        text="学校概况",
                    ),
                    _block(
                        raw_asset_id="owasset_article_001",
                        raw_version_id="owver_article_001",
                        row_id="heading-1",
                        row_index=1,
                        block_order=1,
                        block_role="heading",
                        text="学校概况",
                    ),
                    _block(
                        raw_asset_id="owasset_article_001",
                        raw_version_id="owver_article_001",
                        row_id="list-1",
                        row_index=2,
                        block_order=2,
                        block_role="list_item",
                        text="学校简介",
                        parent_heading_path=["学校概况"],
                    ),
                    _block(
                        raw_asset_id="owasset_article_001",
                        raw_version_id="owver_article_001",
                        row_id="link-1",
                        row_index=3,
                        block_order=3,
                        block_role="link",
                        text="学校简介",
                        parent_heading_path=["学校概况"],
                    ),
                    _block(
                        raw_asset_id="owasset_article_001",
                        raw_version_id="owver_article_001",
                        row_id="heading-2",
                        row_index=4,
                        block_order=4,
                        block_role="heading",
                        text="学校简介",
                        parent_heading_path=["学校概况"],
                    ),
                    _block(
                        raw_asset_id="owasset_article_001",
                        raw_version_id="owver_article_001",
                        row_id="p-1",
                        row_index=5,
                        block_order=5,
                        block_role="paragraph",
                        text="中央民族大学是一所特色鲜明的高等院校。",
                        parent_heading_path=["学校概况", "学校简介"],
                    ),
                ],
            )

            report = replay_official_web_source_truth_local(
                output_dir=output_dir,
                projection_output_dir=projection_dir,
                declarations_path=declarations_path,
            )
            canonical = Path(report.documents[0]["canonical_markdown_path"]).read_text(
                encoding="utf-8"
            )

            self.assertIn("## 学校简介", canonical)
            self.assertIn("中央民族大学是一所特色鲜明的高等院校。", canonical)
            self.assertNotIn("- 学校简介", canonical)
            self.assertEqual(canonical.count("学校简介"), 1)

    def test_article_projection_splits_multi_paragraph_sections_before_becoming_one_giant_unit(
        self,
    ) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            output_dir = root / "collector-output"
            projection_dir = root / "projection-output"
            declarations_path = root / "projection-declarations.json"
            _write_json(declarations_path, _declarations_payload())
            _write_json(
                output_dir / "source-truth-bundle.json",
                {
                    "schemaVersion": "official_web_source_truth_bundle.v1",
                    "sourceChannel": "official_web",
                    "siteId": "campus_public",
                    "crawlRunId": "owrun_projection_article_split_001",
                    "generatedAt": "2026-04-03T09:00:00.000Z",
                    "pages": [
                        _page_bundle_entry(
                            raw_asset_id="owasset_article_split_001",
                            raw_version_id="owver_article_split_001",
                            normalized_canonical_url="https://www.example.edu/about/overview.htm",
                            page_family="article_detail",
                        ),
                    ],
                },
            )
            _write_output_page(
                output_dir,
                site_id="campus_public",
                host="www.example.edu",
                raw_asset_id="owasset_article_split_001",
                raw_version_id="owver_article_split_001",
                normalized_canonical_url="https://www.example.edu/about/overview.htm",
                page_title="学校概况",
                page_family="article_detail",
                blocks=[
                    _block(
                        raw_asset_id="owasset_article_split_001",
                        raw_version_id="owver_article_split_001",
                        row_id="title-1",
                        row_index=0,
                        block_order=0,
                        block_role="title",
                        text="学校概况",
                    ),
                    _block(
                        raw_asset_id="owasset_article_split_001",
                        raw_version_id="owver_article_split_001",
                        row_id="heading-1",
                        row_index=1,
                        block_order=1,
                        block_role="heading",
                        text="学校简介",
                        parent_heading_path=["学校概况"],
                    ),
                    _block(
                        raw_asset_id="owasset_article_split_001",
                        raw_version_id="owver_article_split_001",
                        row_id="p-1",
                        row_index=2,
                        block_order=2,
                        block_role="paragraph",
                        text="中央民族大学是一所特色鲜明的高等院校。",
                        parent_heading_path=["学校概况", "学校简介"],
                    ),
                    _block(
                        raw_asset_id="owasset_article_split_001",
                        raw_version_id="owver_article_split_001",
                        row_id="p-2",
                        row_index=3,
                        block_order=3,
                        block_role="paragraph",
                        text="学校坚持铸牢中华民族共同体意识主线。",
                        parent_heading_path=["学校概况", "学校简介"],
                    ),
                    _block(
                        raw_asset_id="owasset_article_split_001",
                        raw_version_id="owver_article_split_001",
                        row_id="p-3",
                        row_index=4,
                        block_order=4,
                        block_role="paragraph",
                        text="现有海淀校区、丰台校区和海南校区。",
                        parent_heading_path=["学校概况", "学校简介"],
                    ),
                    _block(
                        raw_asset_id="owasset_article_split_001",
                        raw_version_id="owver_article_split_001",
                        row_id="p-4",
                        row_index=5,
                        block_order=5,
                        block_role="paragraph",
                        text="学校形成了多学科协调发展的办学格局。",
                        parent_heading_path=["学校概况", "学校简介"],
                    ),
                ],
            )

            report = replay_official_web_source_truth_local(
                output_dir=output_dir,
                projection_output_dir=projection_dir,
                declarations_path=declarations_path,
            )
            units = [
                json.loads(line)
                for line in Path(report.documents[0]["document_units_path"])
                .read_text(encoding="utf-8")
                .splitlines()
                if line.strip()
            ]

            self.assertEqual(len(units), 2)
            self.assertTrue(all(unit["unit_type"] == "section_text" for unit in units))
            self.assertTrue(
                all(unit["anchor"]["section_path"] == ["学校概况", "学校简介"] for unit in units)
            )
            self.assertLessEqual(max(len(unit["anchor"]["row_ids"]) for unit in units), 3)
            combined_text = "\n".join(unit["clean_text"] for unit in units)
            self.assertIn("中央民族大学是一所特色鲜明的高等院校。", combined_text)
            self.assertIn("学校坚持铸牢中华民族共同体意识主线。", combined_text)
            self.assertIn("现有海淀校区、丰台校区和海南校区。", combined_text)
            self.assertIn("学校形成了多学科协调发展的办学格局。", combined_text)
            self.assertFalse(
                any(
                    "中央民族大学是一所特色鲜明的高等院校。" in unit["clean_text"]
                    and "学校形成了多学科协调发展的办学格局。" in unit["clean_text"]
                    for unit in units
                )
            )

    def test_article_projection_skips_trailing_qr_signup_tail_for_lecture_notice(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            output_dir = root / "collector-output"
            projection_dir = root / "projection-output"
            declarations_path = root / "projection-declarations.json"
            _write_json(declarations_path, _declarations_payload())
            _write_json(
                output_dir / "source-truth-bundle.json",
                {
                    "schemaVersion": "official_web_source_truth_bundle.v1",
                    "sourceChannel": "official_web",
                    "siteId": "campus_public",
                    "crawlRunId": "owrun_projection_lecture_001",
                    "generatedAt": "2026-04-03T09:00:00.000Z",
                    "pages": [
                        _page_bundle_entry(
                            raw_asset_id="owasset_article_lecture_001",
                            raw_version_id="owver_article_lecture_001",
                            normalized_canonical_url="https://lib.example.edu/lecture.htm",
                            page_family="article_detail",
                        ),
                    ],
                },
            )
            _write_output_page(
                output_dir,
                site_id="campus_public",
                host="lib.example.edu",
                raw_asset_id="owasset_article_lecture_001",
                raw_version_id="owver_article_lecture_001",
                normalized_canonical_url="https://lib.example.edu/lecture.htm",
                page_title="“民图一小时”信息素养讲座预告",
                page_family="article_detail",
                blocks=[
                    _block(
                        raw_asset_id="owasset_article_lecture_001",
                        raw_version_id="owver_article_lecture_001",
                        row_id="title-1",
                        row_index=0,
                        block_order=0,
                        block_role="title",
                        text="“民图一小时”信息素养讲座预告",
                    ),
                    _block(
                        raw_asset_id="owasset_article_lecture_001",
                        raw_version_id="owver_article_lecture_001",
                        row_id="heading-1",
                        row_index=1,
                        block_order=1,
                        block_role="heading",
                        text="“民图一小时”信息素养讲座预告",
                    ),
                    _block(
                        raw_asset_id="owasset_article_lecture_001",
                        raw_version_id="owver_article_lecture_001",
                        row_id="p-1",
                        row_index=2,
                        block_order=2,
                        block_role="paragraph",
                        text="讲座主题：聚焦人文社科前沿研究——人大复印报刊资料数据库助力科研创新",
                        parent_heading_path=["“民图一小时”信息素养讲座预告"],
                    ),
                    _block(
                        raw_asset_id="owasset_article_lecture_001",
                        raw_version_id="owver_article_lecture_001",
                        row_id="p-2",
                        row_index=3,
                        block_order=3,
                        block_role="paragraph",
                        text="讲座时间：2026年3月26日下午14:00—15:00",
                        parent_heading_path=["“民图一小时”信息素养讲座预告"],
                    ),
                    _block(
                        raw_asset_id="owasset_article_lecture_001",
                        raw_version_id="owver_article_lecture_001",
                        row_id="p-3",
                        row_index=4,
                        block_order=4,
                        block_role="paragraph",
                        text="讲座地点：丰台校区图书馆视听空间125室",
                        parent_heading_path=["“民图一小时”信息素养讲座预告"],
                    ),
                    _block(
                        raw_asset_id="owasset_article_lecture_001",
                        raw_version_id="owver_article_lecture_001",
                        row_id="p-4",
                        row_index=5,
                        block_order=5,
                        block_role="paragraph",
                        text="讲座内容：介绍人大复印报刊资料数据库在选题追踪与文献综述中的使用方法。",
                        parent_heading_path=["“民图一小时”信息素养讲座预告"],
                    ),
                    _block(
                        raw_asset_id="owasset_article_lecture_001",
                        raw_version_id="owver_article_lecture_001",
                        row_id="p-5",
                        row_index=6,
                        block_order=6,
                        block_role="paragraph",
                        text="欢迎全校师生报名参加。",
                        parent_heading_path=["“民图一小时”信息素养讲座预告"],
                    ),
                    _block(
                        raw_asset_id="owasset_article_lecture_001",
                        raw_version_id="owver_article_lecture_001",
                        row_id="tail-1",
                        row_index=7,
                        block_order=7,
                        block_role="paragraph",
                        text="请感兴趣的同学扫描下方二维码预约讲座信息",
                        parent_heading_path=["“民图一小时”信息素养讲座预告"],
                    ),
                    _block(
                        raw_asset_id="owasset_article_lecture_001",
                        raw_version_id="owver_article_lecture_001",
                        row_id="tail-2",
                        row_index=8,
                        block_order=8,
                        block_role="paragraph",
                        text="（活动结束后将累计参与者的图书馆积分）",
                        parent_heading_path=["“民图一小时”信息素养讲座预告"],
                    ),
                ],
            )

            report = replay_official_web_source_truth_local(
                output_dir=output_dir,
                projection_output_dir=projection_dir,
                declarations_path=declarations_path,
            )
            units_path = Path(report.documents[0]["document_units_path"])
            units = [
                json.loads(line)
                for line in units_path.read_text(encoding="utf-8").splitlines()
                if line.strip()
            ]

            self.assertEqual(len(units), 2)
            self.assertIn(
                "讲座主题：聚焦人文社科前沿研究——人大复印报刊资料数据库助力科研创新",
                units[0]["clean_text"],
            )
            self.assertIn("讲座时间：2026年3月26日下午14:00—15:00", units[0]["clean_text"])
            self.assertIn("讲座地点：丰台校区图书馆视听空间125室", units[0]["clean_text"])
            self.assertNotIn(
                "讲座内容：介绍人大复印报刊资料数据库在选题追踪与文献综述中的使用方法。",
                units[0]["clean_text"],
            )
            self.assertEqual(units[0]["anchor"]["row_ids"], ["p-1", "p-2", "p-3"])
            self.assertIn(
                "讲座内容：介绍人大复印报刊资料数据库在选题追踪与文献综述中的使用方法。",
                units[1]["clean_text"],
            )
            self.assertIn("欢迎全校师生报名参加。", units[1]["clean_text"])
            self.assertNotIn("二维码预约讲座信息", units[1]["clean_text"])
            self.assertNotIn("图书馆积分", units[1]["clean_text"])

    def test_article_projection_keeps_notice_fact_rows_grouped_and_marks_notice_fact_role(
        self,
    ) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            output_dir = root / "collector-output"
            projection_dir = root / "projection-output"
            declarations_path = root / "projection-declarations.json"
            _write_json(declarations_path, _declarations_payload())
            _write_json(
                output_dir / "source-truth-bundle.json",
                {
                    "schemaVersion": "official_web_source_truth_bundle.v1",
                    "sourceChannel": "official_web",
                    "siteId": "campus_public",
                    "crawlRunId": "owrun_projection_notice_fact_001",
                    "generatedAt": "2026-04-04T09:00:00.000Z",
                    "pages": [
                        _page_bundle_entry(
                            raw_asset_id="owasset_article_notice_fact_001",
                            raw_version_id="owver_article_notice_fact_001",
                            normalized_canonical_url="https://lib.example.edu/lecture-facts.htm",
                            page_family="article_detail",
                        ),
                    ],
                },
            )
            _write_output_page(
                output_dir,
                site_id="campus_public",
                host="lib.example.edu",
                raw_asset_id="owasset_article_notice_fact_001",
                raw_version_id="owver_article_notice_fact_001",
                normalized_canonical_url="https://lib.example.edu/lecture-facts.htm",
                page_title="“民图一小时”信息素养讲座预告",
                page_family="article_detail",
                blocks=[
                    _block(
                        raw_asset_id="owasset_article_notice_fact_001",
                        raw_version_id="owver_article_notice_fact_001",
                        row_id="title-1",
                        row_index=0,
                        block_order=0,
                        block_role="title",
                        text="“民图一小时”信息素养讲座预告",
                    ),
                    _block(
                        raw_asset_id="owasset_article_notice_fact_001",
                        raw_version_id="owver_article_notice_fact_001",
                        row_id="heading-1",
                        row_index=1,
                        block_order=1,
                        block_role="heading",
                        text="“民图一小时”信息素养讲座预告",
                    ),
                    _block(
                        raw_asset_id="owasset_article_notice_fact_001",
                        raw_version_id="owver_article_notice_fact_001",
                        row_id="p-1",
                        row_index=2,
                        block_order=2,
                        block_role="paragraph",
                        text="讲座主题：聚焦人文社科前沿研究——人大复印报刊资料数据库助力科研创新",
                        parent_heading_path=["“民图一小时”信息素养讲座预告"],
                    ),
                    _block(
                        raw_asset_id="owasset_article_notice_fact_001",
                        raw_version_id="owver_article_notice_fact_001",
                        row_id="p-2",
                        row_index=3,
                        block_order=3,
                        block_role="paragraph",
                        text="主 讲 人：张小艺",
                        parent_heading_path=["“民图一小时”信息素养讲座预告"],
                    ),
                    _block(
                        raw_asset_id="owasset_article_notice_fact_001",
                        raw_version_id="owver_article_notice_fact_001",
                        row_id="p-3",
                        row_index=4,
                        block_order=4,
                        block_role="paragraph",
                        text="讲座时间：2026年3月26日下午14:00—15:00",
                        parent_heading_path=["“民图一小时”信息素养讲座预告"],
                    ),
                    _block(
                        raw_asset_id="owasset_article_notice_fact_001",
                        raw_version_id="owver_article_notice_fact_001",
                        row_id="p-4",
                        row_index=5,
                        block_order=5,
                        block_role="paragraph",
                        text="讲座地点：丰台校区图书馆视听空间125室",
                        parent_heading_path=["“民图一小时”信息素养讲座预告"],
                    ),
                ],
            )

            report = replay_official_web_source_truth_local(
                output_dir=output_dir,
                projection_output_dir=projection_dir,
                declarations_path=declarations_path,
            )
            units = [
                json.loads(line)
                for line in Path(report.documents[0]["document_units_path"])
                .read_text(encoding="utf-8")
                .splitlines()
                if line.strip()
            ]

        self.assertEqual(len(units), 1)
        self.assertEqual(units[0]["metadata"]["content_role"], "notice_fact")
        self.assertEqual(
            units[0]["anchor"]["row_ids"],
            ["p-1", "p-2", "p-3", "p-4"],
        )
        self.assertIn(
            "讲座主题：聚焦人文社科前沿研究——人大复印报刊资料数据库助力科研创新",
            units[0]["clean_text"],
        )
        self.assertIn("讲座时间：2026年3月26日下午14:00—15:00", units[0]["clean_text"])
        self.assertIn("讲座地点：丰台校区图书馆视听空间125室", units[0]["clean_text"])

    def test_article_projection_classifies_support_only_lines_and_excludes_them_from_canonical_markdown(
        self,
    ) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            output_dir = root / "collector-output"
            projection_dir = root / "projection-output"
            declarations_path = root / "projection-declarations.json"
            _write_json(declarations_path, _declarations_payload())
            _write_json(
                output_dir / "source-truth-bundle.json",
                {
                    "schemaVersion": "official_web_source_truth_bundle.v1",
                    "sourceChannel": "official_web",
                    "siteId": "campus_public",
                    "crawlRunId": "owrun_projection_support_only_001",
                    "generatedAt": "2026-04-04T09:30:00.000Z",
                    "pages": [
                        _page_bundle_entry(
                            raw_asset_id="owasset_article_support_only_001",
                            raw_version_id="owver_article_support_only_001",
                            normalized_canonical_url="https://www.example.edu/undergraduate.htm",
                            page_family="article_detail",
                        ),
                    ],
                },
            )
            _write_output_page(
                output_dir,
                site_id="campus_public",
                host="www.example.edu",
                raw_asset_id="owasset_article_support_only_001",
                raw_version_id="owver_article_support_only_001",
                normalized_canonical_url="https://www.example.edu/undergraduate.htm",
                page_title="本科培养",
                page_family="article_detail",
                blocks=[
                    _block(
                        raw_asset_id="owasset_article_support_only_001",
                        raw_version_id="owver_article_support_only_001",
                        row_id="title-1",
                        row_index=0,
                        block_order=0,
                        block_role="title",
                        text="本科培养",
                    ),
                    _block(
                        raw_asset_id="owasset_article_support_only_001",
                        raw_version_id="owver_article_support_only_001",
                        row_id="heading-1",
                        row_index=1,
                        block_order=1,
                        block_role="heading",
                        text="人才培养",
                    ),
                    _block(
                        raw_asset_id="owasset_article_support_only_001",
                        raw_version_id="owver_article_support_only_001",
                        row_id="p-1",
                        row_index=2,
                        block_order=2,
                        block_role="paragraph",
                        text="学校现有本科专业71个，在招专业61个，涵盖11个学科门类。",
                        parent_heading_path=["人才培养"],
                    ),
                    _block(
                        raw_asset_id="owasset_article_support_only_001",
                        raw_version_id="owver_article_support_only_001",
                        row_id="p-2",
                        row_index=3,
                        block_order=3,
                        block_role="paragraph",
                        text="（来源：教务处）",
                        parent_heading_path=["人才培养"],
                    ),
                    _block(
                        raw_asset_id="owasset_article_support_only_001",
                        raw_version_id="owver_article_support_only_001",
                        row_id="p-3",
                        row_index=4,
                        block_order=4,
                        block_role="paragraph",
                        text="新闻网版权与免责声明：",
                        parent_heading_path=["人才培养"],
                        is_boilerplate=True,
                    ),
                    _block(
                        raw_asset_id="owasset_article_support_only_001",
                        raw_version_id="owver_article_support_only_001",
                        row_id="p-4",
                        row_index=5,
                        block_order=5,
                        block_role="paragraph",
                        text="投稿方式：mucxcb@muc.edu.cn",
                        parent_heading_path=["人才培养"],
                        is_boilerplate=True,
                    ),
                ],
            )

            report = replay_official_web_source_truth_local(
                output_dir=output_dir,
                projection_output_dir=projection_dir,
                declarations_path=declarations_path,
            )
            units = [
                json.loads(line)
                for line in Path(report.documents[0]["document_units_path"])
                .read_text(encoding="utf-8")
                .splitlines()
                if line.strip()
            ]
            canonical = Path(report.documents[0]["canonical_markdown_path"]).read_text(
                encoding="utf-8"
            )

        self.assertEqual(
            [unit["metadata"]["content_role"] for unit in units],
            ["reference_fact", "source_attribution", "boilerplate"],
        )
        self.assertIn(
            "学校现有本科专业71个，在招专业61个，涵盖11个学科门类。", units[0]["clean_text"]
        )
        self.assertEqual(units[1]["clean_text"], "（来源：教务处）")
        self.assertIn("新闻网版权与免责声明：", units[2]["clean_text"])
        self.assertNotIn("（来源：教务处）", canonical)
        self.assertNotIn("新闻网版权与免责声明：", canonical)
        self.assertNotIn("投稿方式：mucxcb@muc.edu.cn", canonical)

    def test_listing_projection_skips_section_badges_and_repeated_entries(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            output_dir = root / "collector-output"
            projection_dir = root / "projection-output"
            declarations_path = root / "projection-declarations.json"
            _write_json(declarations_path, _declarations_payload())
            _write_json(
                output_dir / "source-truth-bundle.json",
                {
                    "schemaVersion": "official_web_source_truth_bundle.v1",
                    "sourceChannel": "official_web",
                    "siteId": "campus_public",
                    "crawlRunId": "owrun_projection_001",
                    "generatedAt": "2026-03-31T09:00:00.000Z",
                    "pages": [
                        _page_bundle_entry(
                            raw_asset_id="owasset_listing_002",
                            raw_version_id="owver_listing_002",
                            normalized_canonical_url="https://www.example.edu/history/",
                            page_family="listing_page",
                        ),
                    ],
                },
            )
            _write_output_page(
                output_dir,
                site_id="campus_public",
                host="www.example.edu",
                raw_asset_id="owasset_listing_002",
                raw_version_id="owver_listing_002",
                normalized_canonical_url="https://www.example.edu/history/",
                page_title="历史文化学院首页",
                page_family="listing_page",
                blocks=[
                    _block(
                        raw_asset_id="owasset_listing_002",
                        raw_version_id="owver_listing_002",
                        row_id="title-1",
                        row_index=0,
                        block_order=0,
                        block_role="title",
                        text="历史文化学院首页",
                    ),
                    _block(
                        raw_asset_id="owasset_listing_002",
                        raw_version_id="owver_listing_002",
                        row_id="heading-1",
                        row_index=1,
                        block_order=1,
                        block_role="heading",
                        text="资讯公告NEWS&NOTICS",
                    ),
                    _block(
                        raw_asset_id="owasset_listing_002",
                        raw_version_id="owver_listing_002",
                        row_id="badge-1",
                        row_index=2,
                        block_order=2,
                        block_role="paragraph",
                        text="NEWS&NOTICS",
                        parent_heading_path=["资讯公告NEWS&NOTICS"],
                    ),
                    _block(
                        raw_asset_id="owasset_listing_002",
                        raw_version_id="owver_listing_002",
                        row_id="link-1",
                        row_index=3,
                        block_order=3,
                        block_role="link",
                        text="2025-2026-1学期缓补考时间安排",
                        parent_heading_path=["资讯公告NEWS&NOTICS"],
                    ),
                    _block(
                        raw_asset_id="owasset_listing_002",
                        raw_version_id="owver_listing_002",
                        row_id="date-1",
                        row_index=4,
                        block_order=4,
                        block_role="paragraph",
                        text="2026-03-12",
                        parent_heading_path=["资讯公告NEWS&NOTICS"],
                    ),
                    _block(
                        raw_asset_id="owasset_listing_002",
                        raw_version_id="owver_listing_002",
                        row_id="link-2",
                        row_index=5,
                        block_order=5,
                        block_role="link",
                        text="2025-2026-1学期缓补考时间安排",
                        parent_heading_path=["资讯公告NEWS&NOTICS"],
                    ),
                    _block(
                        raw_asset_id="owasset_listing_002",
                        raw_version_id="owver_listing_002",
                        row_id="date-2",
                        row_index=6,
                        block_order=6,
                        block_role="paragraph",
                        text="2026-03-12",
                        parent_heading_path=["资讯公告NEWS&NOTICS"],
                    ),
                ],
            )

            report = replay_official_web_source_truth_local(
                output_dir=output_dir,
                projection_output_dir=projection_dir,
                declarations_path=declarations_path,
            )
            canonical = Path(report.documents[0]["canonical_markdown_path"]).read_text(
                encoding="utf-8"
            )

            self.assertNotIn("- NEWS&NOTICS", canonical)
            self.assertEqual(canonical.count("2025-2026-1学期缓补考时间安排"), 1)
            self.assertEqual(canonical.count("2026-03-12"), 1)

    def test_listing_projection_normalizes_compacted_date_prefixes(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            output_dir = root / "collector-output"
            projection_dir = root / "projection-output"
            declarations_path = root / "projection-declarations.json"
            _write_json(declarations_path, _declarations_payload())
            _write_json(
                output_dir / "source-truth-bundle.json",
                {
                    "schemaVersion": "official_web_source_truth_bundle.v1",
                    "sourceChannel": "official_web",
                    "siteId": "campus_public",
                    "crawlRunId": "owrun_projection_001",
                    "generatedAt": "2026-03-31T09:00:00.000Z",
                    "pages": [
                        _page_bundle_entry(
                            raw_asset_id="owasset_listing_003",
                            raw_version_id="owver_listing_003",
                            normalized_canonical_url="https://www.example.edu/history/bks/",
                            page_family="listing_page",
                        ),
                    ],
                },
            )
            _write_output_page(
                output_dir,
                site_id="campus_public",
                host="www.example.edu",
                raw_asset_id="owasset_listing_003",
                raw_version_id="owver_listing_003",
                normalized_canonical_url="https://www.example.edu/history/bks/",
                page_title="本科教学",
                page_family="listing_page",
                blocks=[
                    _block(
                        raw_asset_id="owasset_listing_003",
                        raw_version_id="owver_listing_003",
                        row_id="title-1",
                        row_index=0,
                        block_order=0,
                        block_role="title",
                        text="本科教学",
                    ),
                    _block(
                        raw_asset_id="owasset_listing_003",
                        raw_version_id="owver_listing_003",
                        row_id="heading-1",
                        row_index=1,
                        block_order=1,
                        block_role="heading",
                        text="本科教学",
                    ),
                    _block(
                        raw_asset_id="owasset_listing_003",
                        raw_version_id="owver_listing_003",
                        row_id="item-1",
                        row_index=2,
                        block_order=2,
                        block_role="list_item",
                        text="2026-03-122025-2026-1学期缓补考时间安排",
                        parent_heading_path=["本科教学"],
                    ),
                    _block(
                        raw_asset_id="owasset_listing_003",
                        raw_version_id="owver_listing_003",
                        row_id="item-2",
                        row_index=3,
                        block_order=3,
                        block_role="list_item",
                        text="122026.03历史学动态调整结果公示",
                        parent_heading_path=["本科教学"],
                    ),
                ],
            )

            report = replay_official_web_source_truth_local(
                output_dir=output_dir,
                projection_output_dir=projection_dir,
                declarations_path=declarations_path,
            )
            canonical = Path(report.documents[0]["canonical_markdown_path"]).read_text(
                encoding="utf-8"
            )

            self.assertIn("- 2026-03-12 2025-2026-1学期缓补考时间安排", canonical)
            self.assertIn("- 2026.03.12 历史学动态调整结果公示", canonical)
            self.assertNotIn("2026-03-122025-2026-1学期缓补考时间安排", canonical)
            self.assertNotIn("122026.03历史学动态调整结果公示", canonical)

    def test_listing_projection_skips_aggregate_quick_link_rows(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            output_dir = root / "collector-output"
            projection_dir = root / "projection-output"
            declarations_path = root / "projection-declarations.json"
            _write_json(declarations_path, _declarations_payload())
            _write_json(
                output_dir / "source-truth-bundle.json",
                {
                    "schemaVersion": "official_web_source_truth_bundle.v1",
                    "sourceChannel": "official_web",
                    "siteId": "campus_public",
                    "crawlRunId": "owrun_projection_001",
                    "generatedAt": "2026-03-31T09:00:00.000Z",
                    "pages": [
                        _page_bundle_entry(
                            raw_asset_id="owasset_listing_004",
                            raw_version_id="owver_listing_004",
                            normalized_canonical_url="https://www.example.edu/history/links/",
                            page_family="listing_page",
                        ),
                    ],
                },
            )
            _write_output_page(
                output_dir,
                site_id="campus_public",
                host="www.example.edu",
                raw_asset_id="owasset_listing_004",
                raw_version_id="owver_listing_004",
                normalized_canonical_url="https://www.example.edu/history/links/",
                page_title="快速链接",
                page_family="listing_page",
                blocks=[
                    _block(
                        raw_asset_id="owasset_listing_004",
                        raw_version_id="owver_listing_004",
                        row_id="title-1",
                        row_index=0,
                        block_order=0,
                        block_role="title",
                        text="快速链接",
                    ),
                    _block(
                        raw_asset_id="owasset_listing_004",
                        raw_version_id="owver_listing_004",
                        row_id="heading-1",
                        row_index=1,
                        block_order=1,
                        block_role="heading",
                        text="快速链接",
                    ),
                    _block(
                        raw_asset_id="owasset_listing_004",
                        raw_version_id="owver_listing_004",
                        row_id="list-1",
                        row_index=2,
                        block_order=2,
                        block_role="list_item",
                        text="中山大学历史系 南开大学历史学院 东北师范大学历史文化学院",
                        parent_heading_path=["快速链接"],
                    ),
                    _block(
                        raw_asset_id="owasset_listing_004",
                        raw_version_id="owver_listing_004",
                        row_id="link-1",
                        row_index=3,
                        block_order=3,
                        block_role="link",
                        text="中山大学历史系",
                        parent_heading_path=["快速链接"],
                    ),
                    _block(
                        raw_asset_id="owasset_listing_004",
                        raw_version_id="owver_listing_004",
                        row_id="link-2",
                        row_index=4,
                        block_order=4,
                        block_role="link",
                        text="南开大学历史学院",
                        parent_heading_path=["快速链接"],
                    ),
                    _block(
                        raw_asset_id="owasset_listing_004",
                        raw_version_id="owver_listing_004",
                        row_id="link-3",
                        row_index=5,
                        block_order=5,
                        block_role="link",
                        text="东北师范大学历史文化学院",
                        parent_heading_path=["快速链接"],
                    ),
                ],
            )

            report = replay_official_web_source_truth_local(
                output_dir=output_dir,
                projection_output_dir=projection_dir,
                declarations_path=declarations_path,
            )
            canonical = Path(report.documents[0]["canonical_markdown_path"]).read_text(
                encoding="utf-8"
            )

            self.assertNotIn(
                "- 中山大学历史系 南开大学历史学院 东北师范大学历史文化学院", canonical
            )
            self.assertIn("- 中山大学历史系", canonical)
            self.assertIn("- 南开大学历史学院", canonical)
            self.assertIn("- 东北师范大学历史文化学院", canonical)

    def test_listing_projection_skips_navigation_short_label_rows(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            output_dir = root / "collector-output"
            projection_dir = root / "projection-output"
            declarations_path = root / "projection-declarations.json"
            _write_json(declarations_path, _declarations_payload())
            _write_json(
                output_dir / "source-truth-bundle.json",
                {
                    "schemaVersion": "official_web_source_truth_bundle.v1",
                    "sourceChannel": "official_web",
                    "siteId": "campus_public",
                    "crawlRunId": "owrun_projection_001",
                    "generatedAt": "2026-03-31T09:00:00.000Z",
                    "pages": [
                        _page_bundle_entry(
                            raw_asset_id="owasset_listing_004b",
                            raw_version_id="owver_listing_004b",
                            normalized_canonical_url="https://www.example.edu/news/",
                            page_family="listing_page",
                        ),
                    ],
                },
            )
            _write_output_page(
                output_dir,
                site_id="campus_public",
                host="www.example.edu",
                raw_asset_id="owasset_listing_004b",
                raw_version_id="owver_listing_004b",
                normalized_canonical_url="https://www.example.edu/news/",
                page_title="中央民族大学新闻网",
                page_family="listing_page",
                blocks=[
                    _block(
                        raw_asset_id="owasset_listing_004b",
                        raw_version_id="owver_listing_004b",
                        row_id="title-1",
                        row_index=0,
                        block_order=0,
                        block_role="title",
                        text="中央民族大学新闻网",
                    ),
                    _block(
                        raw_asset_id="owasset_listing_004b",
                        raw_version_id="owver_listing_004b",
                        row_id="item-1",
                        row_index=1,
                        block_order=1,
                        block_role="link",
                        text="中央民族大学党委举办树立和践行正确政绩观学习教育读书班",
                    ),
                    _block(
                        raw_asset_id="owasset_listing_004b",
                        raw_version_id="owver_listing_004b",
                        row_id="label-1",
                        row_index=2,
                        block_order=2,
                        block_role="list_item",
                        text="教学科研",
                        is_main_content=False,
                        is_navigation=True,
                        is_boilerplate=True,
                    ),
                    _block(
                        raw_asset_id="owasset_listing_004b",
                        raw_version_id="owver_listing_004b",
                        row_id="label-2",
                        row_index=3,
                        block_order=3,
                        block_role="link",
                        text="校园经纬",
                        is_main_content=False,
                        is_navigation=True,
                        is_boilerplate=True,
                    ),
                    _block(
                        raw_asset_id="owasset_listing_004b",
                        raw_version_id="owver_listing_004b",
                        row_id="label-3",
                        row_index=4,
                        block_order=4,
                        block_role="list_item",
                        text="全球合作",
                        is_main_content=False,
                        is_navigation=True,
                        is_boilerplate=True,
                    ),
                    _block(
                        raw_asset_id="owasset_listing_004b",
                        raw_version_id="owver_listing_004b",
                        row_id="item-2",
                        row_index=5,
                        block_order=5,
                        block_role="link",
                        text="《学习时报》孔新峰：政德何以重要",
                    ),
                ],
            )

            report = replay_official_web_source_truth_local(
                output_dir=output_dir,
                projection_output_dir=projection_dir,
                declarations_path=declarations_path,
            )
            canonical = Path(report.documents[0]["canonical_markdown_path"]).read_text(
                encoding="utf-8"
            )

            self.assertIn("- 中央民族大学党委举办树立和践行正确政绩观学习教育读书班", canonical)
            self.assertIn("- 《学习时报》孔新峰：政德何以重要", canonical)
            self.assertNotIn("教学科研", canonical)
            self.assertNotIn("校园经纬", canonical)
            self.assertNotIn("全球合作", canonical)

    def test_listing_projection_skips_interstitial_main_content_short_label_rows(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            output_dir = root / "collector-output"
            projection_dir = root / "projection-output"
            declarations_path = root / "projection-declarations.json"
            _write_json(declarations_path, _declarations_payload())
            _write_json(
                output_dir / "source-truth-bundle.json",
                {
                    "schemaVersion": "official_web_source_truth_bundle.v1",
                    "sourceChannel": "official_web",
                    "siteId": "campus_public",
                    "crawlRunId": "owrun_projection_001",
                    "generatedAt": "2026-03-31T09:00:00.000Z",
                    "pages": [
                        _page_bundle_entry(
                            raw_asset_id="owasset_listing_004c",
                            raw_version_id="owver_listing_004c",
                            normalized_canonical_url="https://www.example.edu/news/interstitial/",
                            page_family="listing_page",
                        ),
                    ],
                },
            )
            _write_output_page(
                output_dir,
                site_id="campus_public",
                host="www.example.edu",
                raw_asset_id="owasset_listing_004c",
                raw_version_id="owver_listing_004c",
                normalized_canonical_url="https://www.example.edu/news/interstitial/",
                page_title="中央民族大学新闻网",
                page_family="listing_page",
                blocks=[
                    _block(
                        raw_asset_id="owasset_listing_004c",
                        raw_version_id="owver_listing_004c",
                        row_id="title-1",
                        row_index=0,
                        block_order=0,
                        block_role="title",
                        text="中央民族大学新闻网",
                    ),
                    _block(
                        raw_asset_id="owasset_listing_004c",
                        raw_version_id="owver_listing_004c",
                        row_id="item-1",
                        row_index=1,
                        block_order=1,
                        block_role="link",
                        text="中央民族大学党委举办树立和践行正确政绩观学习教育读书班",
                    ),
                    _block(
                        raw_asset_id="owasset_listing_004c",
                        raw_version_id="owver_listing_004c",
                        row_id="label-1",
                        row_index=2,
                        block_order=2,
                        block_role="list_item",
                        text="教学科研",
                    ),
                    _block(
                        raw_asset_id="owasset_listing_004c",
                        raw_version_id="owver_listing_004c",
                        row_id="label-2",
                        row_index=3,
                        block_order=3,
                        block_role="list_item",
                        text="校园经纬",
                    ),
                    _block(
                        raw_asset_id="owasset_listing_004c",
                        raw_version_id="owver_listing_004c",
                        row_id="label-3",
                        row_index=4,
                        block_order=4,
                        block_role="list_item",
                        text="全球合作",
                    ),
                    _block(
                        raw_asset_id="owasset_listing_004c",
                        raw_version_id="owver_listing_004c",
                        row_id="item-2",
                        row_index=5,
                        block_order=5,
                        block_role="link",
                        text="中央民族大学举办中国历史研究院2025年度重大招标项目开题论证会",
                    ),
                ],
            )

            report = replay_official_web_source_truth_local(
                output_dir=output_dir,
                projection_output_dir=projection_dir,
                declarations_path=declarations_path,
            )
            canonical = Path(report.documents[0]["canonical_markdown_path"]).read_text(
                encoding="utf-8"
            )

            self.assertIn("- 中央民族大学党委举办树立和践行正确政绩观学习教育读书班", canonical)
            self.assertIn(
                "- 中央民族大学举办中国历史研究院2025年度重大招标项目开题论证会", canonical
            )
            self.assertNotIn("教学科研", canonical)
            self.assertNotIn("校园经纬", canonical)
            self.assertNotIn("全球合作", canonical)

    def test_listing_projection_skips_trailing_main_content_short_label_rows_before_next_heading(
        self,
    ) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            output_dir = root / "collector-output"
            projection_dir = root / "projection-output"
            declarations_path = root / "projection-declarations.json"
            _write_json(declarations_path, _declarations_payload())
            _write_json(
                output_dir / "source-truth-bundle.json",
                {
                    "schemaVersion": "official_web_source_truth_bundle.v1",
                    "sourceChannel": "official_web",
                    "siteId": "campus_public",
                    "crawlRunId": "owrun_projection_001",
                    "generatedAt": "2026-03-31T09:00:00.000Z",
                    "pages": [
                        _page_bundle_entry(
                            raw_asset_id="owasset_listing_004d",
                            raw_version_id="owver_listing_004d",
                            normalized_canonical_url="https://www.example.edu/news/trailing-tabs/",
                            page_family="listing_page",
                        ),
                    ],
                },
            )
            _write_output_page(
                output_dir,
                site_id="campus_public",
                host="www.example.edu",
                raw_asset_id="owasset_listing_004d",
                raw_version_id="owver_listing_004d",
                normalized_canonical_url="https://www.example.edu/news/trailing-tabs/",
                page_title="中央民族大学新闻网",
                page_family="listing_page",
                blocks=[
                    _block(
                        raw_asset_id="owasset_listing_004d",
                        raw_version_id="owver_listing_004d",
                        row_id="title-1",
                        row_index=0,
                        block_order=0,
                        block_role="title",
                        text="中央民族大学新闻网",
                    ),
                    _block(
                        raw_asset_id="owasset_listing_004d",
                        raw_version_id="owver_listing_004d",
                        row_id="heading-1",
                        row_index=1,
                        block_order=1,
                        block_role="heading",
                        text="校长强世功接受“统战新语”专访 解读民族团结进步促进法",
                    ),
                    _block(
                        raw_asset_id="owasset_listing_004d",
                        raw_version_id="owver_listing_004d",
                        row_id="item-1",
                        row_index=2,
                        block_order=2,
                        block_role="link",
                        text="中央民族大学党委举办树立和践行正确政绩观学习教育读书班",
                        parent_heading_path=["校长强世功接受“统战新语”专访 解读民族团结进步促进法"],
                    ),
                    _block(
                        raw_asset_id="owasset_listing_004d",
                        raw_version_id="owver_listing_004d",
                        row_id="label-1",
                        row_index=3,
                        block_order=3,
                        block_role="list_item",
                        text="教学科研",
                        parent_heading_path=["校长强世功接受“统战新语”专访 解读民族团结进步促进法"],
                    ),
                    _block(
                        raw_asset_id="owasset_listing_004d",
                        raw_version_id="owver_listing_004d",
                        row_id="label-2",
                        row_index=4,
                        block_order=4,
                        block_role="list_item",
                        text="校园经纬",
                        parent_heading_path=["校长强世功接受“统战新语”专访 解读民族团结进步促进法"],
                    ),
                    _block(
                        raw_asset_id="owasset_listing_004d",
                        raw_version_id="owver_listing_004d",
                        row_id="label-3",
                        row_index=5,
                        block_order=5,
                        block_role="list_item",
                        text="全球合作",
                        parent_heading_path=["校长强世功接受“统战新语”专访 解读民族团结进步促进法"],
                    ),
                    _block(
                        raw_asset_id="owasset_listing_004d",
                        raw_version_id="owver_listing_004d",
                        row_id="heading-2",
                        row_index=6,
                        block_order=6,
                        block_role="heading",
                        text="中央民族大学举办中国历史研究院2025年度重大招标项目开题论证会",
                        parent_heading_path=["校长强世功接受“统战新语”专访 解读民族团结进步促进法"],
                    ),
                    _block(
                        raw_asset_id="owasset_listing_004d",
                        raw_version_id="owver_listing_004d",
                        row_id="item-2",
                        row_index=7,
                        block_order=7,
                        block_role="link",
                        text="中央民族大学举办中国历史研究院2025年度重大招标项目开题论证会",
                        parent_heading_path=[
                            "校长强世功接受“统战新语”专访 解读民族团结进步促进法",
                            "中央民族大学举办中国历史研究院2025年度重大招标项目开题论证会",
                        ],
                    ),
                ],
            )

            report = replay_official_web_source_truth_local(
                output_dir=output_dir,
                projection_output_dir=projection_dir,
                declarations_path=declarations_path,
            )
            canonical = Path(report.documents[0]["canonical_markdown_path"]).read_text(
                encoding="utf-8"
            )

            self.assertIn("- 中央民族大学党委举办树立和践行正确政绩观学习教育读书班", canonical)
            self.assertIn(
                "- 中央民族大学举办中国历史研究院2025年度重大招标项目开题论证会", canonical
            )
            self.assertNotIn("教学科研", canonical)
            self.assertNotIn("校园经纬", canonical)
            self.assertNotIn("全球合作", canonical)

    def test_listing_projection_skips_trailing_teaser_cluster_rows(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            output_dir = root / "collector-output"
            projection_dir = root / "projection-output"
            declarations_path = root / "projection-declarations.json"
            _write_json(declarations_path, _declarations_payload())
            _write_json(
                output_dir / "source-truth-bundle.json",
                {
                    "schemaVersion": "official_web_source_truth_bundle.v1",
                    "sourceChannel": "official_web",
                    "siteId": "campus_public",
                    "crawlRunId": "owrun_projection_001",
                    "generatedAt": "2026-03-31T09:00:00.000Z",
                    "pages": [
                        _page_bundle_entry(
                            raw_asset_id="owasset_listing_004e",
                            raw_version_id="owver_listing_004e",
                            normalized_canonical_url="https://www.example.edu/news/special-topics/",
                            page_family="listing_page",
                        ),
                    ],
                },
            )
            _write_output_page(
                output_dir,
                site_id="campus_public",
                host="www.example.edu",
                raw_asset_id="owasset_listing_004e",
                raw_version_id="owver_listing_004e",
                normalized_canonical_url="https://www.example.edu/news/special-topics/",
                page_title="中央民族大学新闻网",
                page_family="listing_page",
                blocks=[
                    _block(
                        raw_asset_id="owasset_listing_004e",
                        raw_version_id="owver_listing_004e",
                        row_id="title-1",
                        row_index=0,
                        block_order=0,
                        block_role="title",
                        text="中央民族大学新闻网",
                    ),
                    _block(
                        raw_asset_id="owasset_listing_004e",
                        raw_version_id="owver_listing_004e",
                        row_id="heading-1",
                        row_index=1,
                        block_order=1,
                        block_role="heading",
                        text="专题报道",
                    ),
                    _block(
                        raw_asset_id="owasset_listing_004e",
                        raw_version_id="owver_listing_004e",
                        row_id="item-1",
                        row_index=2,
                        block_order=2,
                        block_role="link",
                        text="【专题报道】深入贯彻中央八项规定精神学习教育",
                        parent_heading_path=["专题报道"],
                    ),
                    _block(
                        raw_asset_id="owasset_listing_004e",
                        raw_version_id="owver_listing_004e",
                        row_id="teaser-1",
                        row_index=3,
                        block_order=3,
                        block_role="list_item",
                        text="24张，集齐一整年的民大",
                        parent_heading_path=["专题报道"],
                    ),
                    _block(
                        raw_asset_id="owasset_listing_004e",
                        raw_version_id="owver_listing_004e",
                        row_id="teaser-2",
                        row_index=4,
                        block_order=4,
                        block_role="list_item",
                        text="中国新闻网 | 这所大学如何让石榴花开别样红？",
                        parent_heading_path=["专题报道"],
                    ),
                    _block(
                        raw_asset_id="owasset_listing_004e",
                        raw_version_id="owver_listing_004e",
                        row_id="teaser-3",
                        row_index=5,
                        block_order=5,
                        block_role="list_item",
                        text="民大学子在帕米尔高原与边防官兵同唱国歌、同升国旗",
                        parent_heading_path=["专题报道"],
                    ),
                ],
            )

            report = replay_official_web_source_truth_local(
                output_dir=output_dir,
                projection_output_dir=projection_dir,
                declarations_path=declarations_path,
            )
            canonical = Path(report.documents[0]["canonical_markdown_path"]).read_text(
                encoding="utf-8"
            )
            units_lines = Path(report.documents[0]["document_units_path"]).read_text(
                encoding="utf-8"
            )

            self.assertIn("【专题报道】深入贯彻中央八项规定精神学习教育", canonical)
            self.assertNotIn("24张，集齐一整年的民大", canonical)
            self.assertNotIn("中国新闻网 | 这所大学如何让石榴花开别样红？", canonical)
            self.assertNotIn("民大学子在帕米尔高原与边防官兵同唱国歌、同升国旗", canonical)
            self.assertNotIn("24张，集齐一整年的民大", units_lines)
            self.assertNotIn("中国新闻网 | 这所大学如何让石榴花开别样红？", units_lines)
            self.assertNotIn("民大学子在帕米尔高原与边防官兵同唱国歌、同升国旗", units_lines)

    def test_listing_projection_skips_late_title_date_duplicate_after_summary_card(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            output_dir = root / "collector-output"
            projection_dir = root / "projection-output"
            declarations_path = root / "projection-declarations.json"
            _write_json(declarations_path, _declarations_payload())
            _write_json(
                output_dir / "source-truth-bundle.json",
                {
                    "schemaVersion": "official_web_source_truth_bundle.v1",
                    "sourceChannel": "official_web",
                    "siteId": "campus_public",
                    "crawlRunId": "owrun_projection_001",
                    "generatedAt": "2026-03-31T09:00:00.000Z",
                    "pages": [
                        _page_bundle_entry(
                            raw_asset_id="owasset_listing_005",
                            raw_version_id="owver_listing_005",
                            normalized_canonical_url="https://www.example.edu/history/news/",
                            page_family="listing_page",
                        ),
                    ],
                },
            )
            _write_output_page(
                output_dir,
                site_id="campus_public",
                host="www.example.edu",
                raw_asset_id="owasset_listing_005",
                raw_version_id="owver_listing_005",
                normalized_canonical_url="https://www.example.edu/history/news/",
                page_title="首页",
                page_family="listing_page",
                blocks=[
                    _block(
                        raw_asset_id="owasset_listing_005",
                        raw_version_id="owver_listing_005",
                        row_id="title-1",
                        row_index=0,
                        block_order=0,
                        block_role="title",
                        text="首页",
                    ),
                    _block(
                        raw_asset_id="owasset_listing_005",
                        raw_version_id="owver_listing_005",
                        row_id="heading-1",
                        row_index=1,
                        block_order=1,
                        block_role="heading",
                        text="资讯公告NEWS&NOTICS",
                    ),
                    _block(
                        raw_asset_id="owasset_listing_005",
                        raw_version_id="owver_listing_005",
                        row_id="link-1",
                        row_index=2,
                        block_order=2,
                        block_role="link",
                        text="徐庭云教授生平",
                        parent_heading_path=["资讯公告NEWS&NOTICS"],
                    ),
                    _block(
                        raw_asset_id="owasset_listing_005",
                        raw_version_id="owver_listing_005",
                        row_id="summary-1",
                        row_index=3,
                        block_order=3,
                        block_role="paragraph",
                        text="徐庭云教授长期从事北方民族史与少数民族妇女史研究。",
                        parent_heading_path=["资讯公告NEWS&NOTICS"],
                    ),
                    _block(
                        raw_asset_id="owasset_listing_005",
                        raw_version_id="owver_listing_005",
                        row_id="date-1",
                        row_index=4,
                        block_order=4,
                        block_role="paragraph",
                        text="2026-01-17",
                        parent_heading_path=["资讯公告NEWS&NOTICS"],
                    ),
                    _block(
                        raw_asset_id="owasset_listing_005",
                        raw_version_id="owver_listing_005",
                        row_id="link-2",
                        row_index=5,
                        block_order=5,
                        block_role="link",
                        text="徐庭云教授生平",
                        parent_heading_path=["资讯公告NEWS&NOTICS"],
                    ),
                    _block(
                        raw_asset_id="owasset_listing_005",
                        raw_version_id="owver_listing_005",
                        row_id="date-2",
                        row_index=6,
                        block_order=6,
                        block_role="paragraph",
                        text="2026-01-17",
                        parent_heading_path=["资讯公告NEWS&NOTICS"],
                    ),
                ],
            )

            report = replay_official_web_source_truth_local(
                output_dir=output_dir,
                projection_output_dir=projection_dir,
                declarations_path=declarations_path,
            )
            canonical = Path(report.documents[0]["canonical_markdown_path"]).read_text(
                encoding="utf-8"
            )

            self.assertIn("- 徐庭云教授生平", canonical)
            self.assertIn("- 徐庭云教授长期从事北方民族史与少数民族妇女史研究。", canonical)
            self.assertIn("- 2026-01-17", canonical)
            self.assertNotIn("- 徐庭云教授生平 2026-01-17", canonical)

    def test_listing_projection_skips_pagination_controls(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            output_dir = root / "collector-output"
            projection_dir = root / "projection-output"
            declarations_path = root / "projection-declarations.json"
            _write_json(declarations_path, _declarations_payload())
            _write_json(
                output_dir / "source-truth-bundle.json",
                {
                    "schemaVersion": "official_web_source_truth_bundle.v1",
                    "sourceChannel": "official_web",
                    "siteId": "campus_public",
                    "crawlRunId": "owrun_projection_001",
                    "generatedAt": "2026-03-31T09:00:00.000Z",
                    "pages": [
                        _page_bundle_entry(
                            raw_asset_id="owasset_listing_006",
                            raw_version_id="owver_listing_006",
                            normalized_canonical_url="https://www.example.edu/history/page/",
                            page_family="listing_page",
                        ),
                    ],
                },
            )
            _write_output_page(
                output_dir,
                site_id="campus_public",
                host="www.example.edu",
                raw_asset_id="owasset_listing_006",
                raw_version_id="owver_listing_006",
                normalized_canonical_url="https://www.example.edu/history/page/",
                page_title="本科教学",
                page_family="listing_page",
                blocks=[
                    _block(
                        raw_asset_id="owasset_listing_006",
                        raw_version_id="owver_listing_006",
                        row_id="title-1",
                        row_index=0,
                        block_order=0,
                        block_role="title",
                        text="本科教学",
                    ),
                    _block(
                        raw_asset_id="owasset_listing_006",
                        raw_version_id="owver_listing_006",
                        row_id="heading-1",
                        row_index=1,
                        block_order=1,
                        block_role="heading",
                        text="人才培养",
                    ),
                    _block(
                        raw_asset_id="owasset_listing_006",
                        raw_version_id="owver_listing_006",
                        row_id="item-1",
                        row_index=2,
                        block_order=2,
                        block_role="link",
                        text="2025-12-12 2025-2026-1学期期末考试安排",
                        parent_heading_path=["人才培养"],
                    ),
                    _block(
                        raw_asset_id="owasset_listing_006",
                        raw_version_id="owver_listing_006",
                        row_id="item-2",
                        row_index=3,
                        block_order=3,
                        block_role="link",
                        text="2025-10-23 近代中外关系史暨中国与周边国家关系史实验班建设研讨会顺利召开",
                        parent_heading_path=["人才培养"],
                    ),
                    _block(
                        raw_asset_id="owasset_listing_006",
                        raw_version_id="owver_listing_006",
                        row_id="page-2",
                        row_index=4,
                        block_order=4,
                        block_role="link",
                        text="2",
                        parent_heading_path=["人才培养"],
                    ),
                    _block(
                        raw_asset_id="owasset_listing_006",
                        raw_version_id="owver_listing_006",
                        row_id="page-3",
                        row_index=5,
                        block_order=5,
                        block_role="link",
                        text="3",
                        parent_heading_path=["人才培养"],
                    ),
                    _block(
                        raw_asset_id="owasset_listing_006",
                        raw_version_id="owver_listing_006",
                        row_id="next-1",
                        row_index=6,
                        block_order=6,
                        block_role="link",
                        text="下页",
                        parent_heading_path=["人才培养"],
                    ),
                    _block(
                        raw_asset_id="owasset_listing_006",
                        raw_version_id="owver_listing_006",
                        row_id="last-1",
                        row_index=7,
                        block_order=7,
                        block_role="link",
                        text="尾页",
                        parent_heading_path=["人才培养"],
                    ),
                ],
            )

            report = replay_official_web_source_truth_local(
                output_dir=output_dir,
                projection_output_dir=projection_dir,
                declarations_path=declarations_path,
            )
            canonical = Path(report.documents[0]["canonical_markdown_path"]).read_text(
                encoding="utf-8"
            )
            canonical_lines = canonical.splitlines()

            self.assertIn("2025-12-12 2025-2026-1学期期末考试安排", canonical)
            self.assertNotIn("- 2", canonical_lines)
            self.assertNotIn("- 3", canonical_lines)
            self.assertNotIn("- 下页", canonical_lines)
            self.assertNotIn("- 尾页", canonical_lines)

    def test_listing_projection_skips_utility_quick_links(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            output_dir = root / "collector-output"
            projection_dir = root / "projection-output"
            declarations_path = root / "projection-declarations.json"
            _write_json(declarations_path, _declarations_payload())
            _write_json(
                output_dir / "source-truth-bundle.json",
                {
                    "schemaVersion": "official_web_source_truth_bundle.v1",
                    "sourceChannel": "official_web",
                    "siteId": "campus_public",
                    "crawlRunId": "owrun_projection_001",
                    "generatedAt": "2026-03-31T09:00:00.000Z",
                    "pages": [
                        _page_bundle_entry(
                            raw_asset_id="owasset_listing_007",
                            raw_version_id="owver_listing_007",
                            normalized_canonical_url="https://www.example.edu/history/tools/",
                            page_family="listing_page",
                        ),
                    ],
                },
            )
            _write_output_page(
                output_dir,
                site_id="campus_public",
                host="www.example.edu",
                raw_asset_id="owasset_listing_007",
                raw_version_id="owver_listing_007",
                normalized_canonical_url="https://www.example.edu/history/tools/",
                page_title="首页",
                page_family="listing_page",
                blocks=[
                    _block(
                        raw_asset_id="owasset_listing_007",
                        raw_version_id="owver_listing_007",
                        row_id="title-1",
                        row_index=0,
                        block_order=0,
                        block_role="title",
                        text="首页",
                    ),
                    _block(
                        raw_asset_id="owasset_listing_007",
                        raw_version_id="owver_listing_007",
                        row_id="heading-1",
                        row_index=1,
                        block_order=1,
                        block_role="heading",
                        text="科学研究RESEARCH",
                    ),
                    _block(
                        raw_asset_id="owasset_listing_007",
                        raw_version_id="owver_listing_007",
                        row_id="item-1",
                        row_index=2,
                        block_order=2,
                        block_role="link",
                        text="我院教师裴艾琳学术专著《遐迩同风：宋代南方族群治理转型研究》出版发行",
                        parent_heading_path=["科学研究RESEARCH"],
                    ),
                    _block(
                        raw_asset_id="owasset_listing_007",
                        raw_version_id="owver_listing_007",
                        row_id="tool-1",
                        row_index=3,
                        block_order=3,
                        block_role="link",
                        text="信息门户",
                        parent_heading_path=["科学研究RESEARCH"],
                    ),
                    _block(
                        raw_asset_id="owasset_listing_007",
                        raw_version_id="owver_listing_007",
                        row_id="tool-2",
                        row_index=4,
                        block_order=4,
                        block_role="link",
                        text="图书馆",
                        parent_heading_path=["科学研究RESEARCH"],
                    ),
                ],
            )

            report = replay_official_web_source_truth_local(
                output_dir=output_dir,
                projection_output_dir=projection_dir,
                declarations_path=declarations_path,
            )
            canonical = Path(report.documents[0]["canonical_markdown_path"]).read_text(
                encoding="utf-8"
            )

            self.assertIn(
                "我院教师裴艾琳学术专著《遐迩同风：宋代南方族群治理转型研究》出版发行", canonical
            )
            self.assertNotIn("- 信息门户", canonical)
            self.assertNotIn("- 图书馆", canonical)

    def test_listing_projection_skips_long_summary_paragraphs(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            output_dir = root / "collector-output"
            projection_dir = root / "projection-output"
            declarations_path = root / "projection-declarations.json"
            _write_json(declarations_path, _declarations_payload())
            _write_json(
                output_dir / "source-truth-bundle.json",
                {
                    "schemaVersion": "official_web_source_truth_bundle.v1",
                    "sourceChannel": "official_web",
                    "siteId": "campus_public",
                    "crawlRunId": "owrun_projection_001",
                    "generatedAt": "2026-03-31T09:00:00.000Z",
                    "pages": [
                        _page_bundle_entry(
                            raw_asset_id="owasset_listing_008",
                            raw_version_id="owver_listing_008",
                            normalized_canonical_url="https://www.example.edu/history/research/",
                            page_family="listing_page",
                        ),
                    ],
                },
            )
            _write_output_page(
                output_dir,
                site_id="campus_public",
                host="www.example.edu",
                raw_asset_id="owasset_listing_008",
                raw_version_id="owver_listing_008",
                normalized_canonical_url="https://www.example.edu/history/research/",
                page_title="首页",
                page_family="listing_page",
                blocks=[
                    _block(
                        raw_asset_id="owasset_listing_008",
                        raw_version_id="owver_listing_008",
                        row_id="title-1",
                        row_index=0,
                        block_order=0,
                        block_role="title",
                        text="首页",
                    ),
                    _block(
                        raw_asset_id="owasset_listing_008",
                        raw_version_id="owver_listing_008",
                        row_id="heading-1",
                        row_index=1,
                        block_order=1,
                        block_role="heading",
                        text="科学研究RESEARCH",
                    ),
                    _block(
                        raw_asset_id="owasset_listing_008",
                        raw_version_id="owver_listing_008",
                        row_id="item-1",
                        row_index=2,
                        block_order=2,
                        block_role="link",
                        text="徐庭云教授生平",
                        parent_heading_path=["科学研究RESEARCH"],
                    ),
                    _block(
                        raw_asset_id="owasset_listing_008",
                        raw_version_id="owver_listing_008",
                        row_id="summary-1",
                        row_index=3,
                        block_order=3,
                        block_role="paragraph",
                        text="徐庭云教授长期从事北方民族史与少数民族妇女史研究，是沙陀学研究的重要开拓者。学术贡献突出，发表论文有《晚唐五代时期的沙陀》《一位有贡献的沙陀政治家》等。",
                        parent_heading_path=["科学研究RESEARCH"],
                    ),
                    _block(
                        raw_asset_id="owasset_listing_008",
                        raw_version_id="owver_listing_008",
                        row_id="date-1",
                        row_index=4,
                        block_order=4,
                        block_role="paragraph",
                        text="2026-01-17",
                        parent_heading_path=["科学研究RESEARCH"],
                    ),
                ],
            )

            report = replay_official_web_source_truth_local(
                output_dir=output_dir,
                projection_output_dir=projection_dir,
                declarations_path=declarations_path,
            )
            canonical = Path(report.documents[0]["canonical_markdown_path"]).read_text(
                encoding="utf-8"
            )

            self.assertIn("- 徐庭云教授生平", canonical)
            self.assertIn("- 2026-01-17", canonical)
            self.assertNotIn("徐庭云教授长期从事北方民族史与少数民族妇女史研究", canonical)

    def test_listing_projection_normalizes_section_heading_badges(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            output_dir = root / "collector-output"
            projection_dir = root / "projection-output"
            declarations_path = root / "projection-declarations.json"
            _write_json(declarations_path, _declarations_payload())
            _write_json(
                output_dir / "source-truth-bundle.json",
                {
                    "schemaVersion": "official_web_source_truth_bundle.v1",
                    "sourceChannel": "official_web",
                    "siteId": "campus_public",
                    "crawlRunId": "owrun_projection_001",
                    "generatedAt": "2026-03-31T09:00:00.000Z",
                    "pages": [
                        _page_bundle_entry(
                            raw_asset_id="owasset_listing_009",
                            raw_version_id="owver_listing_009",
                            normalized_canonical_url="https://www.example.edu/history/headings/",
                            page_family="listing_page",
                        ),
                    ],
                },
            )
            _write_output_page(
                output_dir,
                site_id="campus_public",
                host="www.example.edu",
                raw_asset_id="owasset_listing_009",
                raw_version_id="owver_listing_009",
                normalized_canonical_url="https://www.example.edu/history/headings/",
                page_title="首页",
                page_family="listing_page",
                blocks=[
                    _block(
                        raw_asset_id="owasset_listing_009",
                        raw_version_id="owver_listing_009",
                        row_id="title-1",
                        row_index=0,
                        block_order=0,
                        block_role="title",
                        text="首页",
                    ),
                    _block(
                        raw_asset_id="owasset_listing_009",
                        raw_version_id="owver_listing_009",
                        row_id="heading-1",
                        row_index=1,
                        block_order=1,
                        block_role="heading",
                        text="资讯公告NEWS&NOTICS",
                    ),
                    _block(
                        raw_asset_id="owasset_listing_009",
                        raw_version_id="owver_listing_009",
                        row_id="item-1",
                        row_index=2,
                        block_order=2,
                        block_role="link",
                        text="2025-2026-1学期缓补考时间安排",
                        parent_heading_path=["资讯公告NEWS&NOTICS"],
                    ),
                ],
            )

            report = replay_official_web_source_truth_local(
                output_dir=output_dir,
                projection_output_dir=projection_dir,
                declarations_path=declarations_path,
            )
            canonical = Path(report.documents[0]["canonical_markdown_path"]).read_text(
                encoding="utf-8"
            )

            self.assertIn("## 资讯公告", canonical)
            self.assertNotIn("## 资讯公告NEWS&NOTICS", canonical)

    def test_listing_projection_skips_short_label_rows_and_ellipsis_teasers(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            output_dir = root / "collector-output"
            projection_dir = root / "projection-output"
            declarations_path = root / "projection-declarations.json"
            _write_json(declarations_path, _declarations_payload())
            _write_json(
                output_dir / "source-truth-bundle.json",
                {
                    "schemaVersion": "official_web_source_truth_bundle.v1",
                    "sourceChannel": "official_web",
                    "siteId": "campus_public",
                    "crawlRunId": "owrun_projection_001",
                    "generatedAt": "2026-03-31T09:00:00.000Z",
                    "pages": [
                        _page_bundle_entry(
                            raw_asset_id="owasset_listing_010",
                            raw_version_id="owver_listing_010",
                            normalized_canonical_url="https://www.example.edu/news/",
                            page_family="listing_page",
                        ),
                    ],
                },
            )
            _write_output_page(
                output_dir,
                site_id="campus_public",
                host="www.example.edu",
                raw_asset_id="owasset_listing_010",
                raw_version_id="owver_listing_010",
                normalized_canonical_url="https://www.example.edu/news/",
                page_title="中央民族大学新闻网",
                page_family="listing_page",
                blocks=[
                    _block(
                        raw_asset_id="owasset_listing_010",
                        raw_version_id="owver_listing_010",
                        row_id="title-1",
                        row_index=0,
                        block_order=0,
                        block_role="title",
                        text="中央民族大学新闻网",
                    ),
                    _block(
                        raw_asset_id="owasset_listing_010",
                        raw_version_id="owver_listing_010",
                        row_id="heading-1",
                        row_index=1,
                        block_order=1,
                        block_role="heading",
                        text="校园经纬",
                    ),
                    _block(
                        raw_asset_id="owasset_listing_010",
                        raw_version_id="owver_listing_010",
                        row_id="item-1",
                        row_index=2,
                        block_order=2,
                        block_role="link",
                        text="中央民族大学党委举办树立和践行正确政绩观学习教育读书班",
                        parent_heading_path=["校园经纬"],
                    ),
                    _block(
                        raw_asset_id="owasset_listing_010",
                        raw_version_id="owver_listing_010",
                        row_id="label-1",
                        row_index=3,
                        block_order=3,
                        block_role="paragraph",
                        text="教学科研",
                        parent_heading_path=["校园经纬"],
                    ),
                    _block(
                        raw_asset_id="owasset_listing_010",
                        raw_version_id="owver_listing_010",
                        row_id="label-2",
                        row_index=4,
                        block_order=4,
                        block_role="paragraph",
                        text="校园经纬",
                        parent_heading_path=["校园经纬"],
                    ),
                    _block(
                        raw_asset_id="owasset_listing_010",
                        raw_version_id="owver_listing_010",
                        row_id="label-3",
                        row_index=5,
                        block_order=5,
                        block_role="paragraph",
                        text="全球合作",
                        parent_heading_path=["校园经纬"],
                    ),
                    _block(
                        raw_asset_id="owasset_listing_010",
                        raw_version_id="owver_listing_010",
                        row_id="item-2",
                        row_index=6,
                        block_order=6,
                        block_role="link",
                        text="《学习时报》孔新峰：政德何以重要",
                        parent_heading_path=["校园经纬"],
                    ),
                    _block(
                        raw_asset_id="owasset_listing_010",
                        raw_version_id="owver_listing_010",
                        row_id="summary-1",
                        row_index=7,
                        block_order=7,
                        block_role="paragraph",
                        text="新闻网讯 3月23日，《学习时报》刊发中央民族大学马克思主义学院党委书记、院长孔新峰教授撰写的理论文章《政德何以重要》，文章指出：新时代新征程对干部治理能力提出更高要求，政德建设成为干部队伍建设的关键抓手。政德作为党员干部从政履职的根本道德准则，是中华传统政治文明一脉相承的精神内核，唯有筑牢政德底...",
                        parent_heading_path=["校园经纬"],
                    ),
                    _block(
                        raw_asset_id="owasset_listing_010",
                        raw_version_id="owver_listing_010",
                        row_id="teaser-1",
                        row_index=8,
                        block_order=8,
                        block_role="paragraph",
                        text="2026“春晓逐梦”启航跑：迎着春光，和奥运选手一...",
                        parent_heading_path=["校园经纬"],
                    ),
                ],
            )

            report = replay_official_web_source_truth_local(
                output_dir=output_dir,
                projection_output_dir=projection_dir,
                declarations_path=declarations_path,
            )
            canonical = Path(report.documents[0]["canonical_markdown_path"]).read_text(
                encoding="utf-8"
            )

            self.assertIn("- 中央民族大学党委举办树立和践行正确政绩观学习教育读书班", canonical)
            self.assertIn("- 《学习时报》孔新峰：政德何以重要", canonical)
            self.assertNotIn("教学科研", canonical)
            self.assertNotIn("全球合作", canonical)
            self.assertNotIn("唯有筑牢政德底", canonical)
            self.assertNotIn("迎着春光", canonical)

    def test_listing_projection_does_not_persist_item_heading_as_section_path(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            output_dir = root / "collector-output"
            projection_dir = root / "projection-output"
            declarations_path = root / "projection-declarations.json"
            _write_json(declarations_path, _declarations_payload())
            _write_json(
                output_dir / "source-truth-bundle.json",
                {
                    "schemaVersion": "official_web_source_truth_bundle.v1",
                    "sourceChannel": "official_web",
                    "siteId": "campus_public",
                    "crawlRunId": "owrun_projection_001",
                    "generatedAt": "2026-03-31T09:00:00.000Z",
                    "pages": [
                        _page_bundle_entry(
                            raw_asset_id="owasset_listing_011",
                            raw_version_id="owver_listing_011",
                            normalized_canonical_url="https://www.example.edu/news/",
                            page_family="listing_page",
                        ),
                    ],
                },
            )
            polluted_heading = "校长强世功接受“统战新语”专访 解读民族团结进步促进法"
            _write_output_page(
                output_dir,
                site_id="campus_public",
                host="www.example.edu",
                raw_asset_id="owasset_listing_011",
                raw_version_id="owver_listing_011",
                normalized_canonical_url="https://www.example.edu/news/",
                page_title="中央民族大学新闻网",
                page_family="listing_page",
                blocks=[
                    _block(
                        raw_asset_id="owasset_listing_011",
                        raw_version_id="owver_listing_011",
                        row_id="title-1",
                        row_index=0,
                        block_order=0,
                        block_role="title",
                        text="中央民族大学新闻网",
                    ),
                    _block(
                        raw_asset_id="owasset_listing_011",
                        raw_version_id="owver_listing_011",
                        row_id="heading-hero",
                        row_index=1,
                        block_order=1,
                        block_role="heading",
                        text=polluted_heading,
                    ),
                    _block(
                        raw_asset_id="owasset_listing_011",
                        raw_version_id="owver_listing_011",
                        row_id="heading-item-1",
                        row_index=2,
                        block_order=2,
                        block_role="heading",
                        text=polluted_heading,
                        parent_heading_path=[polluted_heading],
                    ),
                    _block(
                        raw_asset_id="owasset_listing_011",
                        raw_version_id="owver_listing_011",
                        row_id="item-1",
                        row_index=3,
                        block_order=3,
                        block_role="link",
                        text=polluted_heading,
                        parent_heading_path=[polluted_heading],
                    ),
                    _block(
                        raw_asset_id="owasset_listing_011",
                        raw_version_id="owver_listing_011",
                        row_id="heading-item-2",
                        row_index=4,
                        block_order=4,
                        block_role="heading",
                        text="中央民族大学党委举办树立和践行正确政绩观学习教育读书班",
                        parent_heading_path=[polluted_heading],
                    ),
                    _block(
                        raw_asset_id="owasset_listing_011",
                        raw_version_id="owver_listing_011",
                        row_id="item-2",
                        row_index=5,
                        block_order=5,
                        block_role="link",
                        text="中央民族大学党委举办树立和践行正确政绩观学习教育读书班",
                        parent_heading_path=[polluted_heading],
                    ),
                    _block(
                        raw_asset_id="owasset_listing_011",
                        raw_version_id="owver_listing_011",
                        row_id="heading-item-3",
                        row_index=6,
                        block_order=6,
                        block_role="heading",
                        text="【专题报道】深入贯彻中央八项规定精神学习教育",
                        parent_heading_path=[polluted_heading],
                    ),
                    _block(
                        raw_asset_id="owasset_listing_011",
                        raw_version_id="owver_listing_011",
                        row_id="item-3",
                        row_index=7,
                        block_order=7,
                        block_role="link",
                        text="【专题报道】深入贯彻中央八项规定精神学习教育",
                        parent_heading_path=[polluted_heading],
                    ),
                ],
            )

            report = replay_official_web_source_truth_local(
                output_dir=output_dir,
                projection_output_dir=projection_dir,
                declarations_path=declarations_path,
            )
            units = [
                json.loads(line)
                for line in Path(report.documents[0]["document_units_path"])
                .read_text(encoding="utf-8")
                .splitlines()
                if line.strip()
            ]

            self.assertEqual(len(units), 3)
            self.assertEqual(units[1]["anchor"]["section_path"], [])
            self.assertEqual(units[2]["anchor"]["section_path"], [])
            self.assertNotEqual(units[1]["anchor"]["section_path"], [polluted_heading])
            self.assertNotEqual(units[2]["anchor"]["section_path"], [polluted_heading])

    def test_listing_projection_aligns_row_ids_with_retained_clean_lines(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            output_dir = root / "collector-output"
            projection_dir = root / "projection-output"
            declarations_path = root / "projection-declarations.json"
            _write_json(declarations_path, _declarations_payload())
            _write_json(
                output_dir / "source-truth-bundle.json",
                {
                    "schemaVersion": "official_web_source_truth_bundle.v1",
                    "sourceChannel": "official_web",
                    "siteId": "campus_public",
                    "crawlRunId": "owrun_projection_001",
                    "generatedAt": "2026-03-31T09:00:00.000Z",
                    "pages": [
                        _page_bundle_entry(
                            raw_asset_id="owasset_listing_012",
                            raw_version_id="owver_listing_012",
                            normalized_canonical_url="https://www.example.edu/news/",
                            page_family="listing_page",
                        ),
                    ],
                },
            )
            _write_output_page(
                output_dir,
                site_id="campus_public",
                host="www.example.edu",
                raw_asset_id="owasset_listing_012",
                raw_version_id="owver_listing_012",
                normalized_canonical_url="https://www.example.edu/news/",
                page_title="中央民族大学新闻网",
                page_family="listing_page",
                blocks=[
                    _block(
                        raw_asset_id="owasset_listing_012",
                        raw_version_id="owver_listing_012",
                        row_id="title-1",
                        row_index=0,
                        block_order=0,
                        block_role="title",
                        text="中央民族大学新闻网",
                    ),
                    _block(
                        raw_asset_id="owasset_listing_012",
                        raw_version_id="owver_listing_012",
                        row_id="heading-1",
                        row_index=1,
                        block_order=1,
                        block_role="heading",
                        text="校园经纬",
                    ),
                    _block(
                        raw_asset_id="owasset_listing_012",
                        raw_version_id="owver_listing_012",
                        row_id="item-1",
                        row_index=2,
                        block_order=2,
                        block_role="link",
                        text="中央民族大学党委举办树立和践行正确政绩观学习教育读书班",
                        parent_heading_path=["校园经纬"],
                    ),
                    _block(
                        raw_asset_id="owasset_listing_012",
                        raw_version_id="owver_listing_012",
                        row_id="label-1",
                        row_index=3,
                        block_order=3,
                        block_role="paragraph",
                        text="教学科研",
                        parent_heading_path=["校园经纬"],
                    ),
                    _block(
                        raw_asset_id="owasset_listing_012",
                        raw_version_id="owver_listing_012",
                        row_id="label-2",
                        row_index=4,
                        block_order=4,
                        block_role="paragraph",
                        text="校园经纬",
                        parent_heading_path=["校园经纬"],
                    ),
                    _block(
                        raw_asset_id="owasset_listing_012",
                        raw_version_id="owver_listing_012",
                        row_id="label-3",
                        row_index=5,
                        block_order=5,
                        block_role="paragraph",
                        text="全球合作",
                        parent_heading_path=["校园经纬"],
                    ),
                    _block(
                        raw_asset_id="owasset_listing_012",
                        raw_version_id="owver_listing_012",
                        row_id="item-2",
                        row_index=6,
                        block_order=6,
                        block_role="link",
                        text="【专题报道】深入贯彻中央八项规定精神学习教育",
                        parent_heading_path=["校园经纬"],
                    ),
                    _block(
                        raw_asset_id="owasset_listing_012",
                        raw_version_id="owver_listing_012",
                        row_id="teaser-1",
                        row_index=7,
                        block_order=7,
                        block_role="list_item",
                        text="24张，集齐一整年的民大",
                        parent_heading_path=["校园经纬"],
                    ),
                    _block(
                        raw_asset_id="owasset_listing_012",
                        raw_version_id="owver_listing_012",
                        row_id="teaser-2",
                        row_index=8,
                        block_order=8,
                        block_role="list_item",
                        text="中国新闻网 | 这所大学如何让石榴花开别样红？",
                        parent_heading_path=["校园经纬"],
                    ),
                    _block(
                        raw_asset_id="owasset_listing_012",
                        raw_version_id="owver_listing_012",
                        row_id="teaser-3",
                        row_index=9,
                        block_order=9,
                        block_role="list_item",
                        text="民大学子在帕米尔高原与边防官兵同唱国歌、同升国旗",
                        parent_heading_path=["校园经纬"],
                    ),
                ],
            )

            report = replay_official_web_source_truth_local(
                output_dir=output_dir,
                projection_output_dir=projection_dir,
                declarations_path=declarations_path,
            )
            units = [
                json.loads(line)
                for line in Path(report.documents[0]["document_units_path"])
                .read_text(encoding="utf-8")
                .splitlines()
                if line.strip()
            ]

            self.assertEqual(len(units), 1)
            self.assertEqual(
                units[0]["clean_text"],
                "中央民族大学党委举办树立和践行正确政绩观学习教育读书班\n【专题报道】深入贯彻中央八项规定精神学习教育",
            )
            self.assertEqual(units[0]["anchor"]["row_ids"], ["item-1", "item-2"])


if __name__ == "__main__":
    unittest.main()
