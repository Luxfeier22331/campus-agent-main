from __future__ import annotations

import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

from .official_web_projection_chunking_audit_test_support import (
    _write_json,
    _write_jsonl,
    audit_official_web_projection_chunking,
)


class OfficialWebProjectionChunkingAuditListingTest(unittest.TestCase):
    def test_audit_projection_output_flags_listing_teaser_cluster_lines(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            projection_output_dir = root / "projection-output"
            document_dir = (
                projection_output_dir
                / "documents"
                / "official_web"
                / "muc_public_pages"
                / "listing--ijkl9012"
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
                projection_output_dir
                / "documents"
                / "official_web"
                / "muc_public_pages"
                / "listing--mnop3456"
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
                projection_output_dir
                / "documents"
                / "official_web"
                / "muc_public_pages"
                / "listing--qrst7890"
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
