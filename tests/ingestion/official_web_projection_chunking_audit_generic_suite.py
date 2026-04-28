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


def _write_single_generic_projection_fixture(
    root: Path,
    *,
    title: str,
    clean_text: str,
    row_ids: list[str],
    source_url: str = "https://www.example.edu/generic.htm",
) -> Path:
    projection_output_dir = root / "projection-output"
    document_dir = (
        projection_output_dir
        / "documents"
        / "official_web"
        / "muc_public_pages"
        / "generic--fixture"
    )
    canonical_path = document_dir / "canonical.md"
    units_path = document_dir / "document-units.jsonl"
    canonical_path.parent.mkdir(parents=True, exist_ok=True)
    canonical_path.write_text(
        f"# {title}\n\n> Source URL: {source_url}\n\n{clean_text}\n",
        encoding="utf-8",
    )
    document_id = "official_web:muc_public:generic_content_page:doc-fixture"
    _write_jsonl(
        units_path,
        [
            {
                "doc_id": document_id,
                "version_id": "owdocver:generic-fixture",
                "chunk_id": f"{document_id}:unit-0001",
                "root_unit_id": f"{document_id}:root-0001",
                "unit_type": "section_text",
                "clean_text": clean_text,
                "source_pdf": "official_web:muc_public",
                "source_url": source_url,
                "source_md": None,
                "source": {"id": source_url},
                "page_start": 1,
                "page_end": 1,
                "anchor": {
                    "page_start": 1,
                    "page_end": 1,
                    "normalized_canonical_url": source_url,
                    "page_family": "generic_content_page",
                    "section_path": [],
                    "row_ids": row_ids,
                },
                "metadata": {
                    "title": title,
                    "site_id": "muc_public",
                    "host": source_url.split("/")[2],
                    "page_family": "generic_content_page",
                    "projection_family": "generic_content_document",
                    "document_kind": "generic",
                    "declaration_id": "muc_public_generic_content_page_v1",
                    "serving_intent": "audit_only",
                    "promotion_block_reason": "generic_content_page_audit_only",
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
            "crawl_run_id": "owrun_generic_fixture",
            "output_dir": str(root / "collector-output"),
            "projection_output_dir": str(projection_output_dir),
            "generated_at": "2026-04-28T08:00:00+00:00",
            "counts": {
                "pages_seen": 1,
                "emitted_documents": 1,
                "manual_review_pages": 0,
            },
            "documents": [
                {
                    "document_id": document_id,
                    "version_id": "owdocver:generic-fixture",
                    "title": title,
                    "declaration_id": "muc_public_generic_content_page_v1",
                    "page_family": "generic_content_page",
                    "projection_family": "generic_content_document",
                    "document_kind": "generic",
                    "target_corpus": "official_web",
                    "target_collection": "muc_public_pages",
                    "normalized_canonical_url": source_url,
                    "raw_asset_id": "owasset_generic_fixture",
                    "raw_version_id": "owver_generic_fixture",
                    "unit_count": 1,
                    "canonical_markdown_path": str(canonical_path),
                    "document_units_path": str(units_path),
                }
            ],
            "manual_review_pages": [],
        },
    )
    return projection_output_dir


class OfficialWebProjectionChunkingAuditGenericTest(unittest.TestCase):
    def test_audit_allows_directory_name_rosters_but_flags_directory_navigation_label_stacks(
        self,
    ) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            projection_output_dir = root / "projection-output"
            roster_dir = (
                projection_output_dir
                / "documents"
                / "official_web"
                / "muc_public_pages"
                / "directory--roster001"
            )
            navigation_dir = (
                projection_output_dir
                / "documents"
                / "official_web"
                / "muc_public_pages"
                / "directory--nav001"
            )
            roster_canonical_path = roster_dir / "canonical.md"
            roster_units_path = roster_dir / "document-units.jsonl"
            navigation_canonical_path = navigation_dir / "canonical.md"
            navigation_units_path = navigation_dir / "document-units.jsonl"
            roster_canonical_path.parent.mkdir(parents=True, exist_ok=True)
            navigation_canonical_path.parent.mkdir(parents=True, exist_ok=True)
            roster_canonical_path.write_text(
                "# 专任教师\n\n> Source URL: https://law.example.edu/teachers.htm\n\n- 张步峰\n",
                encoding="utf-8",
            )
            navigation_canonical_path.write_text(
                "# 教学和科研单位\n\n> Source URL: https://www.example.edu/zzjg.htm\n\n- 职能部门\n",
                encoding="utf-8",
            )

            def directory_unit(
                *,
                doc_id: str,
                clean_text: str,
                title: str,
                source_url: str,
                row_ids: list[str],
            ) -> dict[str, object]:
                return {
                    "doc_id": doc_id,
                    "version_id": f"owdocver:{doc_id}",
                    "chunk_id": f"{doc_id}:unit-0001",
                    "root_unit_id": f"{doc_id}:root-0001",
                    "unit_type": "directory_entry",
                    "clean_text": clean_text,
                    "source_pdf": "official_web:muc_public",
                    "source_url": source_url,
                    "source_md": None,
                    "source": {"id": source_url},
                    "page_start": 1,
                    "page_end": 1,
                    "anchor": {
                        "page_start": 1,
                        "page_end": 1,
                        "normalized_canonical_url": source_url,
                        "page_family": "directory_page",
                        "section_path": [title],
                        "row_ids": row_ids,
                    },
                    "metadata": {
                        "title": title,
                        "site_id": "muc_public",
                        "host": source_url.split("/")[2],
                        "page_family": "directory_page",
                        "projection_family": "directory_document",
                        "document_kind": "directory",
                        "declaration_id": "muc_public_directory_page_v1",
                        "content_role": "directory_reference",
                    },
                    "acl": {"level": "public", "allow_groups": []},
                    "table_cells": None,
                }

            roster_doc_id = "official_web:muc_public:directory_page:doc-roster"
            navigation_doc_id = "official_web:muc_public:directory_page:doc-navigation"
            _write_jsonl(
                roster_units_path,
                [
                    directory_unit(
                        doc_id=roster_doc_id,
                        title="专任教师",
                        source_url="https://law.example.edu/teachers.htm",
                        clean_text="张步峰\n邵六益\n阿依古丽\n范依畴",
                        row_ids=["row-1", "row-2", "row-3", "row-4"],
                    )
                ],
            )
            _write_jsonl(
                navigation_units_path,
                [
                    directory_unit(
                        doc_id=navigation_doc_id,
                        title="教学和科研单位",
                        source_url="https://www.example.edu/zzjg.htm",
                        clean_text="职能部门\n校属机构\n教学和科研单位\n中华民族共同体学院",
                        row_ids=["row-5", "row-6", "row-7", "row-8"],
                    )
                ],
            )
            _write_json(
                projection_output_dir / "projection-report.json",
                {
                    "schema_version": "official_web_projection_replay_report.v1",
                    "site_id": "muc_public",
                    "crawl_run_id": "owrun_test_directory_stacks",
                    "output_dir": str(root / "collector-output"),
                    "projection_output_dir": str(projection_output_dir),
                    "generated_at": "2026-04-27T08:00:00+00:00",
                    "counts": {
                        "pages_seen": 2,
                        "emitted_documents": 2,
                        "manual_review_pages": 0,
                    },
                    "documents": [
                        {
                            "document_id": roster_doc_id,
                            "version_id": f"owdocver:{roster_doc_id}",
                            "title": "专任教师",
                            "declaration_id": "muc_public_directory_page_v1",
                            "page_family": "directory_page",
                            "projection_family": "directory_document",
                            "document_kind": "directory",
                            "target_corpus": "official_web",
                            "target_collection": "muc_public_pages",
                            "normalized_canonical_url": "https://law.example.edu/teachers.htm",
                            "raw_asset_id": "owasset_roster",
                            "raw_version_id": "owver_roster",
                            "unit_count": 1,
                            "canonical_markdown_path": str(roster_canonical_path),
                            "document_units_path": str(roster_units_path),
                        },
                        {
                            "document_id": navigation_doc_id,
                            "version_id": f"owdocver:{navigation_doc_id}",
                            "title": "教学和科研单位",
                            "declaration_id": "muc_public_directory_page_v1",
                            "page_family": "directory_page",
                            "projection_family": "directory_document",
                            "document_kind": "directory",
                            "target_corpus": "official_web",
                            "target_collection": "muc_public_pages",
                            "normalized_canonical_url": "https://www.example.edu/zzjg.htm",
                            "raw_asset_id": "owasset_navigation",
                            "raw_version_id": "owver_navigation",
                            "unit_count": 1,
                            "canonical_markdown_path": str(navigation_canonical_path),
                            "document_units_path": str(navigation_units_path),
                        },
                    ],
                    "manual_review_pages": [],
                },
            )

            report = audit_official_web_projection_chunking(projection_output_dir)

        self.assertFalse(report.passed)
        self.assertEqual(report.issue_counts["stacked_short_label_lines"], 1)
        roster_report = next(
            document for document in report.documents if document.title == "专任教师"
        )
        navigation_report = next(
            document for document in report.documents if document.title == "教学和科研单位"
        )
        self.assertNotIn("stacked_short_label_lines", roster_report.issue_codes)
        self.assertIn("stacked_short_label_lines", navigation_report.issue_codes)

    def test_audit_projection_output_allows_generic_labeled_roster_stack(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            projection_output_dir = _write_single_generic_projection_fixture(
                root,
                title="组织机构",
                clean_text="组织机构\n理事长：姚佳琳\n秘书长：白勇",
                row_ids=["row-1", "row-2", "row-3"],
                source_url="https://xiaoyou.example.edu/jjh/zzjg.htm",
            )

            report = audit_official_web_projection_chunking(projection_output_dir)

        self.assertTrue(report.passed)
        self.assertNotIn("stacked_short_label_lines", report.issue_counts)
        self.assertNotIn("stacked_short_label_lines", report.documents[0].issue_codes)

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
