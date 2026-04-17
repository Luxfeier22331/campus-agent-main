from __future__ import annotations

import importlib
import io
import json
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import patch

from campus_ingestion_core.official_web_chunking_audit import (
    OFFICIAL_WEB_PROJECTION_CHUNKING_AUDIT_SCHEMA_VERSION,
    OfficialWebProjectionChunkingAuditDocumentReport,
    OfficialWebProjectionChunkingAuditReport,
    audit_official_web_projection_chunking,
)
from campus_ingestion_core.process import IndexableChunk

worker = importlib.import_module("campus_ingestion_worker.audit_official_web_projection_chunking")


def _write_json(path: Path, payload: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def _write_jsonl(path: Path, rows: list[dict[str, object]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        "\n".join(json.dumps(row, ensure_ascii=False) for row in rows) + "\n",
        encoding="utf-8",
    )


class OfficialWebProjectionChunkingAuditTest(unittest.TestCase):
    def test_audit_projection_output_surfaces_cleaning_and_chunking_warnings(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            projection_output_dir = root / "projection-output"
            document_dir = (
                projection_output_dir / "documents" / "official_web" / "muc_public_pages" / "generic--abcd1234"
            )
            canonical_path = document_dir / "canonical.md"
            units_path = document_dir / "document-units.jsonl"
            canonical_path.parent.mkdir(parents=True, exist_ok=True)
            canonical_path.write_text(
                "# 中央民族大学新闻网\n\n> Source URL: https://news.muc.edu.cn/\n\n正文节选\n",
                encoding="utf-8",
            )
            _write_jsonl(
                units_path,
                [
                    {
                        "doc_id": "official_web:muc_public:generic_content_page:doc-001",
                        "version_id": "owdocver:test-001",
                        "chunk_id": "unit-0001",
                        "root_unit_id": "root-0001",
                        "unit_type": "section_text",
                        "clean_text": "头条导语内容。",
                        "source_pdf": "official_web:muc_public",
                        "source_url": "https://news.muc.edu.cn/",
                        "source_md": None,
                        "source": {"id": "https://news.muc.edu.cn/"},
                        "page_start": 1,
                        "page_end": 1,
                        "anchor": {
                            "page_start": 1,
                            "page_end": 1,
                            "normalized_canonical_url": "https://news.muc.edu.cn/",
                            "page_family": "generic_content_page",
                            "section_path": ["首页头条"],
                            "row_ids": ["row-1"],
                        },
                        "metadata": {
                            "title": "中央民族大学新闻网",
                            "site_id": "muc_public",
                            "host": "news.muc.edu.cn",
                            "page_family": "generic_content_page",
                            "projection_family": "generic_content_document",
                            "document_kind": "generic",
                            "declaration_id": "muc_public_generic_content_page_v1",
                        },
                        "acl": {"level": "public", "allow_groups": []},
                        "table_cells": None,
                    },
                    {
                        "doc_id": "official_web:muc_public:generic_content_page:doc-001",
                        "version_id": "owdocver:test-001",
                        "chunk_id": "unit-0002",
                        "root_unit_id": "root-0002",
                        "unit_type": "section_text",
                        "clean_text": "第二条新闻\n教学科研\n校园经纬\n全球合作",
                        "source_pdf": "official_web:muc_public",
                        "source_url": "https://news.muc.edu.cn/",
                        "source_md": None,
                        "source": {"id": "https://news.muc.edu.cn/"},
                        "page_start": 1,
                        "page_end": 1,
                        "anchor": {
                            "page_start": 1,
                            "page_end": 1,
                            "normalized_canonical_url": "https://news.muc.edu.cn/",
                            "page_family": "generic_content_page",
                            "section_path": ["首页头条"],
                            "row_ids": ["row-2", "row-3", "row-4", "row-5"],
                        },
                        "metadata": {
                            "title": "中央民族大学新闻网",
                            "site_id": "muc_public",
                            "host": "news.muc.edu.cn",
                            "page_family": "generic_content_page",
                            "projection_family": "generic_content_document",
                            "document_kind": "generic",
                            "declaration_id": "muc_public_generic_content_page_v1",
                        },
                        "acl": {"level": "public", "allow_groups": []},
                        "table_cells": None,
                    },
                    {
                        "doc_id": "official_web:muc_public:generic_content_page:doc-001",
                        "version_id": "owdocver:test-001",
                        "chunk_id": "unit-0003",
                        "root_unit_id": "root-0003",
                        "unit_type": "section_text",
                        "clean_text": "第三条新闻摘要截断...",
                        "source_pdf": "official_web:muc_public",
                        "source_url": "https://news.muc.edu.cn/",
                        "source_md": None,
                        "source": {"id": "https://news.muc.edu.cn/"},
                        "page_start": 1,
                        "page_end": 1,
                        "anchor": {
                            "page_start": 1,
                            "page_end": 1,
                            "normalized_canonical_url": "https://news.muc.edu.cn/",
                            "page_family": "generic_content_page",
                            "section_path": ["首页头条"],
                            "row_ids": ["row-6"],
                        },
                        "metadata": {
                            "title": "中央民族大学新闻网",
                            "site_id": "muc_public",
                            "host": "news.muc.edu.cn",
                            "page_family": "generic_content_page",
                            "projection_family": "generic_content_document",
                            "document_kind": "generic",
                            "declaration_id": "muc_public_generic_content_page_v1",
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
                    "crawl_run_id": "owrun_test_001",
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
                            "document_id": "official_web:muc_public:generic_content_page:doc-001",
                            "version_id": "owdocver:test-001",
                            "title": "中央民族大学新闻网",
                            "declaration_id": "muc_public_generic_content_page_v1",
                            "page_family": "generic_content_page",
                            "projection_family": "generic_content_document",
                            "document_kind": "generic",
                            "target_corpus": "official_web",
                            "target_collection": "muc_public_pages",
                            "normalized_canonical_url": "https://news.muc.edu.cn/",
                            "raw_asset_id": "owasset_test_001",
                            "raw_version_id": "owver_test_001",
                            "unit_count": 3,
                            "canonical_markdown_path": str(canonical_path),
                            "document_units_path": str(units_path),
                        }
                    ],
                    "manual_review_pages": [],
                },
            )

            report = audit_official_web_projection_chunking(projection_output_dir)

        self.assertEqual(report.schema_version, OFFICIAL_WEB_PROJECTION_CHUNKING_AUDIT_SCHEMA_VERSION)
        self.assertFalse(report.passed)
        self.assertEqual(report.document_count, 1)
        self.assertEqual(report.total_units, 3)
        self.assertEqual(report.total_chunks, 3)
        self.assertEqual(report.issue_counts["collapsed_section_path"], 1)
        self.assertEqual(report.issue_counts["stacked_short_label_lines"], 1)
        self.assertEqual(report.issue_counts["ellipsis_truncation"], 1)
        document = report.documents[0]
        self.assertEqual(document.unit_count, 3)
        self.assertEqual(document.chunk_count, 3)
        self.assertEqual(document.distinct_section_path_count, 1)
        self.assertEqual(document.issue_codes, ("collapsed_section_path", "stacked_short_label_lines", "ellipsis_truncation"))

    def test_audit_projection_output_flags_headline_only_generic_fragments(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            projection_output_dir = root / "projection-output"
            document_dir = (
                projection_output_dir / "documents" / "official_web" / "muc_public_pages" / "generic--efgh5678"
            )
            canonical_path = document_dir / "canonical.md"
            units_path = document_dir / "document-units.jsonl"
            canonical_path.parent.mkdir(parents=True, exist_ok=True)
            canonical_path.write_text(
                "# 中央民族大学新闻网\n\n> Source URL: https://news.muc.edu.cn/\n\n若干标题碎片\n",
                encoding="utf-8",
            )
            _write_jsonl(
                units_path,
                [
                    {
                        "doc_id": "official_web:muc_public:generic_content_page:doc-002",
                        "version_id": "owdocver:test-002",
                        "chunk_id": "unit-0001",
                        "root_unit_id": "root-0001",
                        "unit_type": "section_text",
                        "clean_text": "中央民族大学党委举办树立和践行正确政绩观学习教育读书班",
                        "source_pdf": "official_web:muc_public",
                        "source_url": "https://news.muc.edu.cn/",
                        "source_md": None,
                        "source": {"id": "https://news.muc.edu.cn/"},
                        "page_start": 1,
                        "page_end": 1,
                        "anchor": {
                            "page_start": 1,
                            "page_end": 1,
                            "normalized_canonical_url": "https://news.muc.edu.cn/",
                            "page_family": "generic_content_page",
                            "section_path": ["校园新闻一"],
                            "row_ids": ["row-1"],
                        },
                        "metadata": {
                            "title": "中央民族大学新闻网",
                            "site_id": "muc_public",
                            "host": "news.muc.edu.cn",
                            "page_family": "generic_content_page",
                            "projection_family": "generic_content_document",
                            "document_kind": "generic",
                            "declaration_id": "muc_public_generic_content_page_v1",
                        },
                        "acl": {"level": "public", "allow_groups": []},
                        "table_cells": None,
                    },
                    {
                        "doc_id": "official_web:muc_public:generic_content_page:doc-002",
                        "version_id": "owdocver:test-002",
                        "chunk_id": "unit-0002",
                        "root_unit_id": "root-0002",
                        "unit_type": "section_text",
                        "clean_text": "中央民族大学唐鑫团队在红外高光谱成像系统研究获重大突破",
                        "source_pdf": "official_web:muc_public",
                        "source_url": "https://news.muc.edu.cn/",
                        "source_md": None,
                        "source": {"id": "https://news.muc.edu.cn/"},
                        "page_start": 1,
                        "page_end": 1,
                        "anchor": {
                            "page_start": 1,
                            "page_end": 1,
                            "normalized_canonical_url": "https://news.muc.edu.cn/",
                            "page_family": "generic_content_page",
                            "section_path": ["校园新闻二"],
                            "row_ids": ["row-2"],
                        },
                        "metadata": {
                            "title": "中央民族大学新闻网",
                            "site_id": "muc_public",
                            "host": "news.muc.edu.cn",
                            "page_family": "generic_content_page",
                            "projection_family": "generic_content_document",
                            "document_kind": "generic",
                            "declaration_id": "muc_public_generic_content_page_v1",
                        },
                        "acl": {"level": "public", "allow_groups": []},
                        "table_cells": None,
                    },
                    {
                        "doc_id": "official_web:muc_public:generic_content_page:doc-002",
                        "version_id": "owdocver:test-002",
                        "chunk_id": "unit-0003",
                        "root_unit_id": "root-0003",
                        "unit_type": "section_text",
                        "clean_text": "中央民族大学举办中国历史研究院2025年度重大招标项目开题论证会",
                        "source_pdf": "official_web:muc_public",
                        "source_url": "https://news.muc.edu.cn/",
                        "source_md": None,
                        "source": {"id": "https://news.muc.edu.cn/"},
                        "page_start": 1,
                        "page_end": 1,
                        "anchor": {
                            "page_start": 1,
                            "page_end": 1,
                            "normalized_canonical_url": "https://news.muc.edu.cn/",
                            "page_family": "generic_content_page",
                            "section_path": ["校园新闻三"],
                            "row_ids": ["row-3"],
                        },
                        "metadata": {
                            "title": "中央民族大学新闻网",
                            "site_id": "muc_public",
                            "host": "news.muc.edu.cn",
                            "page_family": "generic_content_page",
                            "projection_family": "generic_content_document",
                            "document_kind": "generic",
                            "declaration_id": "muc_public_generic_content_page_v1",
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
                    "crawl_run_id": "owrun_test_002",
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
                            "document_id": "official_web:muc_public:generic_content_page:doc-002",
                            "version_id": "owdocver:test-002",
                            "title": "中央民族大学新闻网",
                            "declaration_id": "muc_public_generic_content_page_v1",
                            "page_family": "generic_content_page",
                            "projection_family": "generic_content_document",
                            "document_kind": "generic",
                            "target_corpus": "official_web",
                            "target_collection": "muc_public_pages",
                            "normalized_canonical_url": "https://news.muc.edu.cn/",
                            "raw_asset_id": "owasset_test_002",
                            "raw_version_id": "owver_test_002",
                            "unit_count": 3,
                            "canonical_markdown_path": str(canonical_path),
                            "document_units_path": str(units_path),
                        }
                    ],
                    "manual_review_pages": [],
                },
            )

            report = audit_official_web_projection_chunking(projection_output_dir)

        self.assertFalse(report.passed)
        self.assertEqual(report.issue_counts["headline_only_fragments"], 1)
        self.assertIn("headline_only_fragments", report.documents[0].issue_codes)

    def test_audit_projection_output_flags_article_section_over_aggregation(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            projection_output_dir = root / "projection-output"
            document_dir = (
                projection_output_dir / "documents" / "official_web" / "muc_public_pages" / "article--split001"
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
                projection_output_dir / "documents" / "official_web" / "muc_public_pages" / "article--noticefact"
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

    def test_audit_projection_output_flags_source_only_and_terminal_boilerplate_chunks(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            projection_output_dir = root / "projection-output"
            document_dir = (
                projection_output_dir / "documents" / "official_web" / "muc_public_pages" / "article--support001"
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
                projection_output_dir / "documents" / "official_web" / "muc_public_pages" / "article--header001"
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

    def test_audit_projection_output_allows_title_only_header_when_section_collapses_to_title(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            projection_output_dir = root / "projection-output"
            document_dir = (
                projection_output_dir / "documents" / "official_web" / "muc_public_pages" / "article--header002"
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

    def test_audit_projection_output_flags_listing_teaser_cluster_lines(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            projection_output_dir = root / "projection-output"
            document_dir = (
                projection_output_dir / "documents" / "official_web" / "muc_public_pages" / "listing--ijkl9012"
            )
            canonical_path = document_dir / "canonical.md"
            units_path = document_dir / "document-units.jsonl"
            canonical_path.parent.mkdir(parents=True, exist_ok=True)
            canonical_path.write_text(
                "# 中央民族大学新闻网\n\n> Source URL: https://news.muc.edu.cn/\n\n专题报道节选\n",
                encoding="utf-8",
            )
            _write_jsonl(
                units_path,
                [
                    {
                        "doc_id": "official_web:muc_public:listing_page:doc-003",
                        "version_id": "owdocver:test-003",
                        "chunk_id": "unit-0001",
                        "root_unit_id": "root-0001",
                        "unit_type": "link_list",
                        "clean_text": "【专题报道】深入贯彻中央八项规定精神学习教育\n24张，集齐一整年的民大\n中国新闻网 | 这所大学如何让石榴花开别样红？\n民大学子在帕米尔高原与边防官兵同唱国歌、同升国旗",
                        "source_pdf": "official_web:muc_public",
                        "source_url": "https://news.muc.edu.cn/",
                        "source_md": None,
                        "source": {"id": "https://news.muc.edu.cn/"},
                        "page_start": 1,
                        "page_end": 1,
                        "anchor": {
                            "page_start": 1,
                            "page_end": 1,
                            "normalized_canonical_url": "https://news.muc.edu.cn/",
                            "page_family": "listing_page",
                            "section_path": ["专题报道"],
                            "row_ids": ["row-1", "row-2", "row-3", "row-4"],
                        },
                        "metadata": {
                            "title": "中央民族大学新闻网",
                            "site_id": "muc_public",
                            "host": "news.muc.edu.cn",
                            "page_family": "listing_page",
                            "projection_family": "navigation_document",
                            "document_kind": "listing",
                            "declaration_id": "muc_public_listing_page_v1",
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
                            "document_id": "official_web:muc_public:listing_page:doc-003",
                            "version_id": "owdocver:test-003",
                            "title": "中央民族大学新闻网",
                            "declaration_id": "muc_public_listing_page_v1",
                            "page_family": "listing_page",
                            "projection_family": "navigation_document",
                            "document_kind": "listing",
                            "target_corpus": "official_web",
                            "target_collection": "muc_public_pages",
                            "normalized_canonical_url": "https://news.muc.edu.cn/",
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
        self.assertEqual(report.issue_counts["teaser_cluster_lines"], 1)
        self.assertIn("teaser_cluster_lines", report.documents[0].issue_codes)

    def test_audit_projection_output_flags_listing_context_pollution(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            projection_output_dir = root / "projection-output"
            document_dir = (
                projection_output_dir / "documents" / "official_web" / "muc_public_pages" / "listing--mnop3456"
            )
            canonical_path = document_dir / "canonical.md"
            units_path = document_dir / "document-units.jsonl"
            canonical_path.parent.mkdir(parents=True, exist_ok=True)
            canonical_path.write_text(
                "# 中央民族大学新闻网\n\n> Source URL: https://news.muc.edu.cn/\n\n首页新闻节选\n",
                encoding="utf-8",
            )
            polluted_heading = "校长强世功接受“统战新语”专访 解读民族团结进步促进法"
            _write_jsonl(
                units_path,
                [
                    {
                        "doc_id": "official_web:muc_public:listing_page:doc-004",
                        "version_id": "owdocver:test-004",
                        "chunk_id": f"unit-{index:04d}",
                        "root_unit_id": f"root-{index:04d}",
                        "unit_type": "link_list",
                        "clean_text": text,
                        "source_pdf": "official_web:muc_public",
                        "source_url": "https://news.muc.edu.cn/",
                        "source_md": None,
                        "source": {"id": "https://news.muc.edu.cn/"},
                        "page_start": 1,
                        "page_end": 1,
                        "anchor": {
                            "page_start": 1,
                            "page_end": 1,
                            "normalized_canonical_url": "https://news.muc.edu.cn/",
                            "page_family": "listing_page",
                            "section_path": [polluted_heading],
                            "row_ids": [f"row-{index}"],
                        },
                        "metadata": {
                            "title": "中央民族大学新闻网",
                            "site_id": "muc_public",
                            "host": "news.muc.edu.cn",
                            "page_family": "listing_page",
                            "projection_family": "navigation_document",
                            "document_kind": "listing",
                            "declaration_id": "muc_public_listing_page_v1",
                        },
                        "acl": {"level": "public", "allow_groups": []},
                        "table_cells": None,
                    }
                    for index, text in enumerate(
                        [
                            "校长强世功接受“统战新语”专访 解读民族团结进步促进法",
                            "深耕团结沃土 共育石榴花开——中央民族大学扎实推进加强“铸牢”教育改革试点工作",
                            "校领导拜会北京市委组织部领导交流高质量就业工作",
                            "中央民族大学与北京丰台人才集团共建就业实习实践基地",
                            "中央民族大学党委举办树立和践行正确政绩观学习教育读书班",
                        ],
                        start=1,
                    )
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
                    "generated_at": "2026-04-02T08:00:00+00:00",
                    "counts": {
                        "pages_seen": 1,
                        "emitted_documents": 1,
                        "manual_review_pages": 0,
                    },
                    "documents": [
                        {
                            "document_id": "official_web:muc_public:listing_page:doc-004",
                            "version_id": "owdocver:test-004",
                            "title": "中央民族大学新闻网",
                            "declaration_id": "muc_public_listing_page_v1",
                            "page_family": "listing_page",
                            "projection_family": "navigation_document",
                            "document_kind": "listing",
                            "target_corpus": "official_web",
                            "target_collection": "muc_public_pages",
                            "normalized_canonical_url": "https://news.muc.edu.cn/",
                            "raw_asset_id": "owasset_test_004",
                            "raw_version_id": "owver_test_004",
                            "unit_count": 5,
                            "canonical_markdown_path": str(canonical_path),
                            "document_units_path": str(units_path),
                        }
                    ],
                    "manual_review_pages": [],
                },
            )

            report = audit_official_web_projection_chunking(projection_output_dir)

        self.assertFalse(report.passed)
        self.assertEqual(report.issue_counts["listing_context_pollution"], 1)
        self.assertIn("listing_context_pollution", report.documents[0].issue_codes)

    def test_audit_projection_output_flags_listing_row_id_mismatch_after_cleaning(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            projection_output_dir = root / "projection-output"
            document_dir = (
                projection_output_dir / "documents" / "official_web" / "muc_public_pages" / "listing--qrst7890"
            )
            canonical_path = document_dir / "canonical.md"
            units_path = document_dir / "document-units.jsonl"
            canonical_path.parent.mkdir(parents=True, exist_ok=True)
            canonical_path.write_text(
                "# 中央民族大学新闻网\n\n> Source URL: https://news.muc.edu.cn/\n\n条目节选\n",
                encoding="utf-8",
            )
            _write_jsonl(
                units_path,
                [
                    {
                        "doc_id": "official_web:muc_public:listing_page:doc-005",
                        "version_id": "owdocver:test-005",
                        "chunk_id": "unit-0001",
                        "root_unit_id": "root-0001",
                        "unit_type": "link_list",
                        "clean_text": "中央民族大学党委举办树立和践行正确政绩观学习教育读书班",
                        "source_pdf": "official_web:muc_public",
                        "source_url": "https://news.muc.edu.cn/",
                        "source_md": None,
                        "source": {"id": "https://news.muc.edu.cn/"},
                        "page_start": 1,
                        "page_end": 1,
                        "anchor": {
                            "page_start": 1,
                            "page_end": 1,
                            "normalized_canonical_url": "https://news.muc.edu.cn/",
                            "page_family": "listing_page",
                            "section_path": ["校园经纬"],
                            "row_ids": ["row-1", "row-2", "row-3", "row-4"],
                        },
                        "metadata": {
                            "title": "中央民族大学新闻网",
                            "site_id": "muc_public",
                            "host": "news.muc.edu.cn",
                            "page_family": "listing_page",
                            "projection_family": "navigation_document",
                            "document_kind": "listing",
                            "declaration_id": "muc_public_listing_page_v1",
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
                    "generated_at": "2026-04-02T08:00:00+00:00",
                    "counts": {
                        "pages_seen": 1,
                        "emitted_documents": 1,
                        "manual_review_pages": 0,
                    },
                    "documents": [
                        {
                            "document_id": "official_web:muc_public:listing_page:doc-005",
                            "version_id": "owdocver:test-005",
                            "title": "中央民族大学新闻网",
                            "declaration_id": "muc_public_listing_page_v1",
                            "page_family": "listing_page",
                            "projection_family": "navigation_document",
                            "document_kind": "listing",
                            "target_corpus": "official_web",
                            "target_collection": "muc_public_pages",
                            "normalized_canonical_url": "https://news.muc.edu.cn/",
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

            report = audit_official_web_projection_chunking(projection_output_dir)

        self.assertFalse(report.passed)
        self.assertEqual(report.issue_counts["row_id_mismatch_after_cleaning"], 1)
        self.assertIn("row_id_mismatch_after_cleaning", report.documents[0].issue_codes)


class OfficialWebProjectionChunkingAuditWorkerCliTest(unittest.TestCase):
    def test_main_prints_audit_report_as_json(self) -> None:
        report = OfficialWebProjectionChunkingAuditReport(
            schema_version=OFFICIAL_WEB_PROJECTION_CHUNKING_AUDIT_SCHEMA_VERSION,
            projection_output_dir="/tmp/projection-output",
            passed=False,
            document_count=1,
            total_units=3,
            total_chunks=3,
            issue_counts={"collapsed_section_path": 1},
            documents=(
                OfficialWebProjectionChunkingAuditDocumentReport(
                    document_id="official_web:muc_public:generic_content_page:doc-001",
                    title="中央民族大学新闻网",
                    target_corpus="official_web",
                    target_collection="muc_public_pages",
                    normalized_canonical_url="https://news.muc.edu.cn/",
                    page_family="generic_content_page",
                    unit_count=3,
                    chunk_count=3,
                    distinct_section_path_count=1,
                    token_summary={"min": 10, "max": 20, "avg": 15.0, "median": 15},
                    short_chunk_count=1,
                    stacked_short_label_unit_count=1,
                    ellipsis_unit_count=0,
                    issue_codes=("collapsed_section_path",),
                    examples=(),
                ),
            ),
        )
        with (
            patch("campus_ingestion_worker.audit_official_web_projection_chunking.load_worker_env"),
            patch(
                "campus_ingestion_worker.audit_official_web_projection_chunking.audit_official_web_projection_chunking"
            ) as audit_projection,
            patch("sys.stdout", new_callable=io.StringIO) as stdout,
        ):
            audit_projection.return_value = report
            worker.main(["--projection-output-dir", "/tmp/projection-output"])

        self.assertEqual(
            Path(audit_projection.call_args.kwargs["projection_output_dir"]),
            Path("/tmp/projection-output").resolve(),
        )
        payload = json.loads(stdout.getvalue())
        self.assertEqual(payload["issue_counts"]["collapsed_section_path"], 1)
        self.assertEqual(payload["documents"][0]["document_id"], "official_web:muc_public:generic_content_page:doc-001")


if __name__ == "__main__":
    unittest.main()
