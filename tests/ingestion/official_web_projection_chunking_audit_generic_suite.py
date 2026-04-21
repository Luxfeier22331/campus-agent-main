from __future__ import annotations

import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

from .official_web_projection_chunking_audit_test_support import (
    OFFICIAL_WEB_PROJECTION_CHUNKING_AUDIT_SCHEMA_VERSION,
    _write_json,
    _write_jsonl,
    audit_official_web_projection_chunking,
)


class OfficialWebProjectionChunkingAuditGenericTest(unittest.TestCase):
    def test_audit_projection_output_surfaces_cleaning_and_chunking_warnings(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            projection_output_dir = root / "projection-output"
            document_dir = (
                projection_output_dir
                / "documents"
                / "official_web"
                / "muc_public_pages"
                / "generic--abcd1234"
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

        self.assertEqual(
            report.schema_version, OFFICIAL_WEB_PROJECTION_CHUNKING_AUDIT_SCHEMA_VERSION
        )
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
        self.assertEqual(
            document.issue_codes,
            ("collapsed_section_path", "stacked_short_label_lines", "ellipsis_truncation"),
        )

    def test_audit_projection_output_flags_headline_only_generic_fragments(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            projection_output_dir = root / "projection-output"
            document_dir = (
                projection_output_dir
                / "documents"
                / "official_web"
                / "muc_public_pages"
                / "generic--efgh5678"
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
