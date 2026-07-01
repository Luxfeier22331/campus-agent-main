from __future__ import annotations

import unittest

from campus_ingestion_core.models import RawAssetRecord
from campus_ingestion_core.raw_ingestion_split_manifest import (
    _build_split_manifest_document_input,
)
from campus_ingestion_core.raw_ingestion_split_manifest_curriculum import (
    CURRICULUM_SPLIT_MANIFEST_ROW_POLICY,
)
from campus_ingestion_core.split_manifest import SplitManifestDocument


def _raw_asset_record() -> RawAssetRecord:
    return RawAssetRecord(
        raw_asset_id="asset:synthetic-curriculum-plan",
        raw_version_id="sha256:test",
        corpus="curriculum",
        collection="curriculum_plan",
        raw_source_uri="file:///tmp/synthetic-curriculum-plan.pdf",
        content_hash="test",
        source_filename="synthetic-curriculum-plan.pdf",
        object_key="official_pdf/curriculum-plan/2022/sha256/test/capture/synthetic-curriculum-plan.pdf",
        ingestion_timestamp="2026-03-24T10:00:00+00:00",
        import_source="raw_online_ocr",
    )


class SplitManifestCanonicalMarkdownTest(unittest.TestCase):
    def test_curriculum_split_document_produces_reader_canonical_markdown(self) -> None:
        document_input = _build_split_manifest_document_input(
            raw_asset_record=_raw_asset_record(),
            manifest_version="curriculum_plan_split_manifest_v1",
            manifest_document=SplitManifestDocument(
                document_id="curriculum:plan-001",
                title="测试本科人才培养方案",
                page_start=20,
                page_end=21,
            ),
            structured_rows=[
                {
                    "row_id": "page-0020-title",
                    "row_type": "heading",
                    "heading_level": 1,
                    "text_normalized": "测试本科人才培养方案",
                    "page_start": 20,
                    "page_end": 20,
                },
                {
                    "row_id": "page-0020-section",
                    "row_type": "heading",
                    "heading_level": 2,
                    "text_normalized": "一、培养目标",
                    "page_start": 20,
                    "page_end": 20,
                },
                {
                    "row_id": "page-0020-body",
                    "row_type": "paragraph",
                    "text_normalized": "培养具有系统分析能力的人才。",
                    "page_start": 20,
                    "page_end": 20,
                },
            ],
            provider_response_key="official_pdf/curriculum-plan/2022/sha256/test/provider/vlm/provider-response.jsonl",
            layout_elements_key="official_pdf/curriculum-plan/2022/sha256/test/source-truth/layout-elements.jsonl",
            corpus="curriculum",
            collection="curriculum_plan",
            row_policy=CURRICULUM_SPLIT_MANIFEST_ROW_POLICY,
        )

        self.assertIsNotNone(document_input.canonical_markdown_bytes)
        markdown = document_input.canonical_markdown_bytes.decode("utf-8")

        self.assertTrue(markdown.startswith("# 测试本科人才培养方案\n\n"))
        self.assertIn("## 一、培养目标", markdown)
        self.assertIn("培养具有系统分析能力的人才。", markdown)
        self.assertEqual(markdown.count("# 测试本科人才培养方案"), 1)

    def test_curriculum_split_markdown_renders_position_preserving_tables(self) -> None:
        document_input = _build_split_manifest_document_input(
            raw_asset_record=_raw_asset_record(),
            manifest_version="curriculum_plan_split_manifest_v1",
            manifest_document=SplitManifestDocument(
                document_id="curriculum:plan-001",
                title="测试本科人才培养方案",
                page_start=20,
                page_end=20,
            ),
            structured_rows=[
                {
                    "row_id": "page-0020-caption",
                    "row_type": "table_caption",
                    "text_normalized": "表1 课程学分",
                    "page_start": 20,
                    "page_end": 20,
                },
                {
                    "row_id": "page-0020-table",
                    "row_type": "table",
                    "text_normalized": "<table><tr><th>课程</th><th>学分</th></tr><tr><td>工程数学</td><td>4</td></tr></table>",
                    "html": "<table><tr><th>课程</th><th>学分</th></tr><tr><td>工程数学</td><td>4</td></tr></table>",
                    "table_cells": [
                        {"row": 1, "col": 1, "text": "课程", "rowspan": 1, "colspan": 1},
                        {"row": 1, "col": 2, "text": "学分", "rowspan": 1, "colspan": 1},
                        {"row": 2, "col": 1, "text": "工程数学", "rowspan": 1, "colspan": 1},
                        {"row": 2, "col": 2, "text": "4", "rowspan": 1, "colspan": 1},
                    ],
                    "page_start": 20,
                    "page_end": 20,
                },
            ],
            provider_response_key="official_pdf/curriculum-plan/2022/sha256/test/provider/vlm/provider-response.jsonl",
            layout_elements_key="official_pdf/curriculum-plan/2022/sha256/test/source-truth/layout-elements.jsonl",
            corpus="curriculum",
            collection="curriculum_plan",
            row_policy=CURRICULUM_SPLIT_MANIFEST_ROW_POLICY,
        )

        self.assertIsNotNone(document_input.canonical_markdown_bytes)
        markdown = document_input.canonical_markdown_bytes.decode("utf-8")

        self.assertIn("表1 课程学分", markdown)
        self.assertIn("| 课程 | 学分 |", markdown)
        self.assertIn("| --- | --- |", markdown)
        self.assertIn("| 工程数学 | 4 |", markdown)
        self.assertNotIn("<table", markdown)


if __name__ == "__main__":
    unittest.main()
