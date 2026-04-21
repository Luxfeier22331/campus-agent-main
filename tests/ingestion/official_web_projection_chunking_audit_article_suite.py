from __future__ import annotations

import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

from campus_ingestion_core.process import IndexableChunk

from .official_web_projection_chunking_audit_test_support import (
    _write_json,
    _write_jsonl,
    audit_official_web_projection_chunking,
)


class OfficialWebProjectionChunkingAuditArticleTest(unittest.TestCase):
    def test_audit_projection_output_flags_article_section_over_aggregation(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            projection_output_dir = root / "projection-output"
            document_dir = (
                projection_output_dir
                / "documents"
                / "official_web"
                / "muc_public_pages"
                / "article--split001"
            )
            canonical_path = document_dir / "canonical.md"
            units_path = document_dir / "document-units.jsonl"
            canonical_path.parent.mkdir(parents=True, exist_ok=True)
            canonical_path.write_text(
                "# 学校概况\n\n> Source URL: https://www.example.edu/about/overview.htm\n\n学校简介正文\n",
                encoding="utf-8",
            )
            _write_jsonl(
                units_path,
                [
                    {
                        "doc_id": "official_web:muc_public:article_detail:doc-003",
                        "version_id": "owdocver:test-003",
                        "chunk_id": "unit-0001",
                        "root_unit_id": "root-0001",
                        "unit_type": "section_text",
                        "clean_text": "\n".join(
                            [
                                "中央民族大学是一所特色鲜明的高等院校。",
                                "学校坚持铸牢中华民族共同体意识主线。",
                                "现有海淀校区、丰台校区和海南校区。",
                                "学校形成了多学科协调发展的办学格局。",
                            ]
                        ),
                        "source_pdf": "official_web:muc_public",
                        "source_url": "https://www.example.edu/about/overview.htm",
                        "source_md": None,
                        "source": {"id": "https://www.example.edu/about/overview.htm"},
                        "page_start": 1,
                        "page_end": 1,
                        "anchor": {
                            "page_start": 1,
                            "page_end": 1,
                            "normalized_canonical_url": "https://www.example.edu/about/overview.htm",
                            "page_family": "article_detail",
                            "section_path": ["学校概况", "学校简介"],
                            "row_ids": ["p-1", "p-2", "p-3", "p-4"],
                        },
                        "metadata": {
                            "title": "学校概况",
                            "site_id": "muc_public",
                            "host": "www.example.edu",
                            "page_family": "article_detail",
                            "projection_family": "content_document",
                            "document_kind": "article",
                            "declaration_id": "muc_public_article_detail_v1",
                        },
                        "acl": {"level": "public", "allow_groups": []},
                        "table_cells": None,
                    },
                ],
            )
            _write_json(
                projection_output_dir / "projection-report.json",
                {
                    "schema_version": "official_web_projection_replay_report.v1",
                    "site_id": "muc_public",
                    "crawl_run_id": "owrun_test_003",
                    "output_dir": str(root / "collector-output"),
                    "projection_output_dir": str(projection_output_dir),
                    "generated_at": "2026-04-02T08:00:00+00:00",
                    "counts": {
                        "pages_seen": 1,
                        "emitted_documents": 1,
                        "manual_review_pages": 0,
                    },
                    "documents": [
                        {
                            "document_id": "official_web:muc_public:article_detail:doc-003",
                            "version_id": "owdocver:test-003",
                            "title": "学校概况",
                            "declaration_id": "muc_public_article_detail_v1",
                            "page_family": "article_detail",
                            "projection_family": "content_document",
                            "document_kind": "article",
                            "target_corpus": "official_web",
                            "target_collection": "muc_public_pages",
                            "normalized_canonical_url": "https://www.example.edu/about/overview.htm",
                            "raw_asset_id": "owasset_test_003",
                            "raw_version_id": "owver_test_003",
                            "unit_count": 1,
                            "canonical_markdown_path": str(canonical_path),
                            "document_units_path": str(units_path),
                        }
                    ],
                    "manual_review_pages": [],
                },
            )

            report = audit_official_web_projection_chunking(projection_output_dir)

        self.assertFalse(report.passed)
        self.assertEqual(report.issue_counts["article_section_over_aggregation"], 1)
        self.assertIn("article_section_over_aggregation", report.documents[0].issue_codes)

    def test_audit_projection_output_allows_notice_fact_grouping_for_article_detail(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            projection_output_dir = root / "projection-output"
            document_dir = (
                projection_output_dir
                / "documents"
                / "official_web"
                / "muc_public_pages"
                / "article--noticefact"
            )
            canonical_path = document_dir / "canonical.md"
            units_path = document_dir / "document-units.jsonl"
            canonical_path.parent.mkdir(parents=True, exist_ok=True)
            canonical_path.write_text(
                "# “民图一小时”信息素养讲座预告\n\n> Source URL: https://lib.example.edu/lecture.htm\n\n讲座信息\n",
                encoding="utf-8",
            )
            _write_jsonl(
                units_path,
                [
                    {
                        "doc_id": "official_web:muc_public:article_detail:doc-003b",
                        "version_id": "owdocver:test-003b",
                        "chunk_id": "unit-0001",
                        "root_unit_id": "root-0001",
                        "unit_type": "section_text",
                        "clean_text": "\n".join(
                            [
                                "讲座主题：聚焦人文社科前沿研究——人大复印报刊资料数据库助力科研创新",
                                "主 讲 人：张小艺",
                                "讲座时间：2026年3月26日下午 时间：14:00——15:00",
                                "讲座地点：丰台校区图书馆视听空间125室",
                                "线上腾讯会议：756 416 554",
                            ]
                        ),
                        "source_pdf": "official_web:muc_public",
                        "source_url": "https://lib.example.edu/lecture.htm",
                        "source_md": None,
                        "source": {"id": "https://lib.example.edu/lecture.htm"},
                        "page_start": 1,
                        "page_end": 1,
                        "anchor": {
                            "page_start": 1,
                            "page_end": 1,
                            "normalized_canonical_url": "https://lib.example.edu/lecture.htm",
                            "page_family": "article_detail",
                            "section_path": [
                                "“民图一小时”信息素养讲座预告 | 聚焦人文社科前沿研究——人大复印报刊资料数据库助力科研创新"
                            ],
                            "row_ids": ["row-1", "row-2", "row-3", "row-4", "row-5"],
                        },
                        "metadata": {
                            "title": "“民图一小时”信息素养讲座预告",
                            "site_id": "muc_public",
                            "host": "lib.example.edu",
                            "page_family": "article_detail",
                            "projection_family": "content_document",
                            "document_kind": "article",
                            "declaration_id": "muc_public_article_detail_v1",
                            "serving_intent": "promotable",
                            "content_role": "notice_fact",
                        },
                        "acl": {"level": "public", "allow_groups": []},
                        "table_cells": None,
                    },
                ],
            )
            _write_json(
                projection_output_dir / "projection-report.json",
                {
                    "schema_version": "official_web_projection_replay_report.v1",
                    "site_id": "muc_public",
                    "crawl_run_id": "owrun_test_003b",
                    "output_dir": str(root / "collector-output"),
                    "projection_output_dir": str(projection_output_dir),
                    "generated_at": "2026-04-04T08:00:00+00:00",
                    "counts": {
                        "pages_seen": 1,
                        "emitted_documents": 1,
                        "manual_review_pages": 0,
                    },
                    "documents": [
                        {
                            "document_id": "official_web:muc_public:article_detail:doc-003b",
                            "version_id": "owdocver:test-003b",
                            "title": "“民图一小时”信息素养讲座预告",
                            "declaration_id": "muc_public_article_detail_v1",
                            "page_family": "article_detail",
                            "projection_family": "content_document",
                            "document_kind": "article",
                            "target_corpus": "official_web",
                            "target_collection": "muc_public_pages",
                            "normalized_canonical_url": "https://lib.example.edu/lecture.htm",
                            "raw_asset_id": "owasset_test_003b",
                            "raw_version_id": "owver_test_003b",
                            "unit_count": 1,
                            "canonical_markdown_path": str(canonical_path),
                            "document_units_path": str(units_path),
                        }
                    ],
                    "manual_review_pages": [],
                },
            )

            report = audit_official_web_projection_chunking(projection_output_dir)

        self.assertTrue(report.passed)
        self.assertNotIn("article_section_over_aggregation", report.issue_counts)
        self.assertNotIn("article_section_over_aggregation", report.documents[0].issue_codes)

    def test_audit_projection_output_flags_source_only_and_terminal_boilerplate_chunks(
        self,
    ) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            projection_output_dir = root / "projection-output"
            document_dir = (
                projection_output_dir
                / "documents"
                / "official_web"
                / "muc_public_pages"
                / "article--support001"
            )
            canonical_path = document_dir / "canonical.md"
            units_path = document_dir / "document-units.jsonl"
            canonical_path.parent.mkdir(parents=True, exist_ok=True)
            canonical_path.write_text(
                "# 本科培养\n\n> Source URL: https://www.example.edu/undergraduate.htm\n\n正文节选\n",
                encoding="utf-8",
            )
            _write_jsonl(
                units_path,
                [
                    {
                        "doc_id": "official_web:muc_public:article_detail:doc-004",
                        "version_id": "owdocver:test-004",
                        "chunk_id": "unit-0001",
                        "root_unit_id": "root-0001",
                        "unit_type": "section_text",
                        "clean_text": "（来源：教务处）",
                        "source_pdf": "official_web:muc_public",
                        "source_url": "https://www.example.edu/undergraduate.htm",
                        "source_md": None,
                        "source": {"id": "https://www.example.edu/undergraduate.htm"},
                        "page_start": 1,
                        "page_end": 1,
                        "anchor": {
                            "page_start": 1,
                            "page_end": 1,
                            "normalized_canonical_url": "https://www.example.edu/undergraduate.htm",
                            "page_family": "article_detail",
                            "section_path": ["人才培养"],
                            "row_ids": ["row-1"],
                        },
                        "metadata": {
                            "title": "本科培养",
                            "site_id": "muc_public",
                            "host": "www.example.edu",
                            "page_family": "article_detail",
                            "projection_family": "content_document",
                            "document_kind": "article",
                            "declaration_id": "muc_public_article_detail_v1",
                        },
                        "acl": {"level": "public", "allow_groups": []},
                        "table_cells": None,
                    },
                    {
                        "doc_id": "official_web:muc_public:article_detail:doc-004",
                        "version_id": "owdocver:test-004",
                        "chunk_id": "unit-0002",
                        "root_unit_id": "root-0002",
                        "unit_type": "section_text",
                        "clean_text": "② 凡本网注明其他来源的作品，均转载自其它媒体，转载目的在于传递更多信息，并不代表本网赞同其观点和对其真实性负责。\n投稿方式：mucxcb@muc.edu.cn",
                        "source_pdf": "official_web:muc_public",
                        "source_url": "https://www.example.edu/undergraduate.htm",
                        "source_md": None,
                        "source": {"id": "https://www.example.edu/undergraduate.htm"},
                        "page_start": 1,
                        "page_end": 1,
                        "anchor": {
                            "page_start": 1,
                            "page_end": 1,
                            "normalized_canonical_url": "https://www.example.edu/undergraduate.htm",
                            "page_family": "article_detail",
                            "section_path": ["人才培养"],
                            "row_ids": ["row-2", "row-3"],
                        },
                        "metadata": {
                            "title": "本科培养",
                            "site_id": "muc_public",
                            "host": "www.example.edu",
                            "page_family": "article_detail",
                            "projection_family": "content_document",
                            "document_kind": "article",
                            "declaration_id": "muc_public_article_detail_v1",
                        },
                        "acl": {"level": "public", "allow_groups": []},
                        "table_cells": None,
                    },
                ],
            )
            _write_json(
                projection_output_dir / "projection-report.json",
                {
                    "schema_version": "official_web_projection_replay_report.v1",
                    "site_id": "muc_public",
                    "crawl_run_id": "owrun_test_004",
                    "output_dir": str(root / "collector-output"),
                    "projection_output_dir": str(projection_output_dir),
                    "generated_at": "2026-04-04T08:00:00+00:00",
                    "counts": {
                        "pages_seen": 1,
                        "emitted_documents": 1,
                        "manual_review_pages": 0,
                    },
                    "documents": [
                        {
                            "document_id": "official_web:muc_public:article_detail:doc-004",
                            "version_id": "owdocver:test-004",
                            "title": "本科培养",
                            "declaration_id": "muc_public_article_detail_v1",
                            "page_family": "article_detail",
                            "projection_family": "content_document",
                            "document_kind": "article",
                            "target_corpus": "official_web",
                            "target_collection": "muc_public_pages",
                            "normalized_canonical_url": "https://www.example.edu/undergraduate.htm",
                            "raw_asset_id": "owasset_test_004",
                            "raw_version_id": "owver_test_004",
                            "unit_count": 2,
                            "canonical_markdown_path": str(canonical_path),
                            "document_units_path": str(units_path),
                        }
                    ],
                    "manual_review_pages": [],
                },
            )

            report = audit_official_web_projection_chunking(projection_output_dir)

        self.assertFalse(report.passed)
        self.assertEqual(report.issue_counts["source_only_chunk"], 1)
        self.assertEqual(report.issue_counts["terminal_boilerplate_chunk"], 1)
        self.assertIn("source_only_chunk", report.documents[0].issue_codes)
        self.assertIn("terminal_boilerplate_chunk", report.documents[0].issue_codes)

    def test_audit_projection_output_flags_header_context_drift(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            projection_output_dir = root / "projection-output"
            document_dir = (
                projection_output_dir
                / "documents"
                / "official_web"
                / "muc_public_pages"
                / "article--header001"
            )
            canonical_path = document_dir / "canonical.md"
            units_path = document_dir / "document-units.jsonl"
            canonical_path.parent.mkdir(parents=True, exist_ok=True)
            canonical_path.write_text(
                "# 学校概况\n\n> Source URL: https://www.example.edu/about/overview.htm\n\n正文节选\n",
                encoding="utf-8",
            )
            _write_jsonl(
                units_path,
                [
                    {
                        "doc_id": "official_web:muc_public:article_detail:doc-005",
                        "version_id": "owdocver:test-005",
                        "chunk_id": "unit-0001",
                        "root_unit_id": "root-0001",
                        "unit_type": "section_text",
                        "clean_text": "图书馆馆藏图书500万余册，是首批全国古籍重点保护单位。",
                        "source_pdf": "official_web:muc_public",
                        "source_url": "https://www.example.edu/about/overview.htm",
                        "source_md": None,
                        "source": {"id": "https://www.example.edu/about/overview.htm"},
                        "page_start": 1,
                        "page_end": 1,
                        "anchor": {
                            "page_start": 1,
                            "page_end": 1,
                            "normalized_canonical_url": "https://www.example.edu/about/overview.htm",
                            "page_family": "article_detail",
                            "section_path": ["学校概况", "学校简介"],
                            "row_ids": ["row-1"],
                        },
                        "metadata": {
                            "title": "学校概况",
                            "site_id": "muc_public",
                            "host": "www.example.edu",
                            "page_family": "article_detail",
                            "projection_family": "content_document",
                            "document_kind": "article",
                            "declaration_id": "muc_public_article_detail_v1",
                        },
                        "acl": {"level": "public", "allow_groups": []},
                        "table_cells": None,
                    },
                ],
            )
            _write_json(
                projection_output_dir / "projection-report.json",
                {
                    "schema_version": "official_web_projection_replay_report.v1",
                    "site_id": "muc_public",
                    "crawl_run_id": "owrun_test_005",
                    "output_dir": str(root / "collector-output"),
                    "projection_output_dir": str(projection_output_dir),
                    "generated_at": "2026-04-04T08:00:00+00:00",
                    "counts": {
                        "pages_seen": 1,
                        "emitted_documents": 1,
                        "manual_review_pages": 0,
                    },
                    "documents": [
                        {
                            "document_id": "official_web:muc_public:article_detail:doc-005",
                            "version_id": "owdocver:test-005",
                            "title": "学校概况",
                            "declaration_id": "muc_public_article_detail_v1",
                            "page_family": "article_detail",
                            "projection_family": "content_document",
                            "document_kind": "article",
                            "target_corpus": "official_web",
                            "target_collection": "muc_public_pages",
                            "normalized_canonical_url": "https://www.example.edu/about/overview.htm",
                            "raw_asset_id": "owasset_test_005",
                            "raw_version_id": "owver_test_005",
                            "unit_count": 1,
                            "canonical_markdown_path": str(canonical_path),
                            "document_units_path": str(units_path),
                        }
                    ],
                    "manual_review_pages": [],
                },
            )

            drifted_chunks = (
                IndexableChunk(
                    document_id="official_web:muc_public:article_detail:doc-005",
                    revision_track="source-faithful",
                    version_id="owdocver:test-005",
                    chunk_id="official_web:muc_public:article_detail:doc-005:chunk-0001",
                    chunk_order=1,
                    corpus="official_web",
                    collection="muc_public_pages",
                    source_uri="https://www.example.edu/about/overview.htm",
                    source_chunk_id="unit-0001",
                    anchor={
                        "section_path": ["学校概况", "学校简介"],
                        "page_start": 1,
                        "page_end": 1,
                        "normalized_canonical_url": "https://www.example.edu/about/overview.htm",
                        "page_family": "article_detail",
                    },
                    text="学校概况 / 学校简介\n图书馆馆藏图书500万余册，是首批全国古籍重点保护单位。",
                    source_channel="official_web",
                    is_current=True,
                    parser_version="official_web_projection_replay.v1",
                    embedding_model="",
                    metadata={
                        "title": "学校概况",
                        "page_family": "article_detail",
                        "document_kind": "article",
                        "header_mode": "compact_identity",
                    },
                ),
            )

            with patch(
                "campus_ingestion_core.official_web_chunking_audit.build_indexable_chunks_from_jsonl",
                return_value=drifted_chunks,
            ):
                report = audit_official_web_projection_chunking(projection_output_dir)

        self.assertFalse(report.passed)
        self.assertEqual(report.issue_counts["header_context_drift"], 1)
        self.assertIn("header_context_drift", report.documents[0].issue_codes)

    def test_audit_projection_output_allows_title_only_header_when_section_collapses_to_title(
        self,
    ) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            projection_output_dir = root / "projection-output"
            document_dir = (
                projection_output_dir
                / "documents"
                / "official_web"
                / "muc_public_pages"
                / "article--header002"
            )
            canonical_path = document_dir / "canonical.md"
            units_path = document_dir / "document-units.jsonl"
            canonical_path.parent.mkdir(parents=True, exist_ok=True)
            canonical_path.write_text(
                "# 干部人事\n\n> Source URL: https://www.example.edu/gbrs.htm\n\n正文节选\n",
                encoding="utf-8",
            )
            _write_jsonl(
                units_path,
                [
                    {
                        "doc_id": "official_web:muc_public:article_detail:doc-005b",
                        "version_id": "owdocver:test-005b",
                        "chunk_id": "unit-0001",
                        "root_unit_id": "root-0001",
                        "unit_type": "section_text",
                        "clean_text": "“干部人事”信息公开内容包括：干部工作、人事制度、岗位聘任等。",
                        "source_pdf": "official_web:muc_public",
                        "source_url": "https://www.example.edu/gbrs.htm",
                        "source_md": None,
                        "source": {"id": "https://www.example.edu/gbrs.htm"},
                        "page_start": 1,
                        "page_end": 1,
                        "anchor": {
                            "page_start": 1,
                            "page_end": 1,
                            "normalized_canonical_url": "https://www.example.edu/gbrs.htm",
                            "page_family": "article_detail",
                            "section_path": ["干部人事"],
                            "row_ids": ["row-1"],
                        },
                        "metadata": {
                            "title": "干部人事",
                            "site_id": "muc_public",
                            "host": "www.example.edu",
                            "page_family": "article_detail",
                            "projection_family": "content_document",
                            "document_kind": "article",
                            "declaration_id": "muc_public_article_detail_v1",
                            "serving_intent": "promotable",
                            "content_role": "primary_content",
                        },
                        "acl": {"level": "public", "allow_groups": []},
                        "table_cells": None,
                    },
                ],
            )
            _write_json(
                projection_output_dir / "projection-report.json",
                {
                    "schema_version": "official_web_projection_replay_report.v1",
                    "site_id": "muc_public",
                    "crawl_run_id": "owrun_test_005b",
                    "output_dir": str(root / "collector-output"),
                    "projection_output_dir": str(projection_output_dir),
                    "generated_at": "2026-04-04T08:00:00+00:00",
                    "counts": {
                        "pages_seen": 1,
                        "emitted_documents": 1,
                        "manual_review_pages": 0,
                    },
                    "documents": [
                        {
                            "document_id": "official_web:muc_public:article_detail:doc-005b",
                            "version_id": "owdocver:test-005b",
                            "title": "干部人事",
                            "declaration_id": "muc_public_article_detail_v1",
                            "page_family": "article_detail",
                            "projection_family": "content_document",
                            "document_kind": "article",
                            "target_corpus": "official_web",
                            "target_collection": "muc_public_pages",
                            "normalized_canonical_url": "https://www.example.edu/gbrs.htm",
                            "raw_asset_id": "owasset_test_005b",
                            "raw_version_id": "owver_test_005b",
                            "unit_count": 1,
                            "canonical_markdown_path": str(canonical_path),
                            "document_units_path": str(units_path),
                        }
                    ],
                    "manual_review_pages": [],
                },
            )

            report = audit_official_web_projection_chunking(projection_output_dir)

        self.assertTrue(report.passed)
        self.assertNotIn("header_context_drift", report.issue_counts)
        self.assertNotIn("header_context_drift", report.documents[0].issue_codes)
