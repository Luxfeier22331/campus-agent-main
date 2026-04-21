from __future__ import annotations

import unittest
from pathlib import Path

from campus_ingestion_core.curriculum_split_seed import (
    HistoricalCurriculumDocument,
    build_curriculum_split_manifest_seed,
    build_manifest_document_rows,
    derive_curriculum_source_uri_from_canonical_path,
    load_layout_elements_rows,
)
from campus_ingestion_core.split_manifest import SplitManifestDocument


class CurriculumSplitSeedTest(unittest.TestCase):
    def test_build_curriculum_split_manifest_seed_uses_heading_rows_for_non_overlapping_ranges(
        self,
    ) -> None:
        historical_documents = (
            HistoricalCurriculumDocument(
                document_id="curriculum:plan-a",
                title="计划甲",
                status="active",
                canonical_doc_path="rag-data/canonical/curriculum_plan/docs/计划甲.md",
                historical_page_start=None,
                historical_page_end=None,
                ocr_doc_decision_uri=None,
            ),
            HistoricalCurriculumDocument(
                document_id="curriculum:plan-b",
                title="计划乙",
                status="active",
                canonical_doc_path="rag-data/canonical/curriculum_plan/docs/计划乙.md",
                historical_page_start=None,
                historical_page_end=None,
                ocr_doc_decision_uri=None,
            ),
        )
        structured_rows = [
            {
                "row_type": "heading",
                "block_role": "doc_title",
                "title_candidate_score": 1.0,
                "text_normalized": "计划甲",
                "page_start": 20,
                "page_end": 20,
            },
            {
                "row_type": "paragraph",
                "block_role": "text",
                "title_candidate_score": 0.0,
                "text_normalized": "计划乙培养具有国际视野的人才。",
                "page_start": 21,
                "page_end": 21,
            },
            {
                "row_type": "heading",
                "block_role": "doc_title",
                "title_candidate_score": 1.0,
                "text_normalized": "计划乙",
                "page_start": 22,
                "page_end": 22,
            },
        ]

        seed = build_curriculum_split_manifest_seed(
            historical_documents=historical_documents,
            structured_rows=structured_rows,
            raw_asset_id="asset:curriculum-plan-2022",
        )

        self.assertEqual(seed.manifest.corpus, "curriculum")
        self.assertEqual(seed.manifest.collection, "curriculum_plan")
        self.assertEqual(seed.manifest.raw_asset_id, "asset:curriculum-plan-2022")
        self.assertEqual(len(seed.manifest.documents), 2)
        self.assertEqual(len(seed.missing_documents), 0)
        self.assertEqual(len(seed.retired_documents), 0)
        self.assertEqual(seed.manifest.documents[0].document_id, "curriculum:plan-a")
        self.assertEqual(
            (seed.manifest.documents[0].page_start, seed.manifest.documents[0].page_end), (20, 21)
        )
        self.assertEqual(seed.manifest.documents[1].document_id, "curriculum:plan-b")
        self.assertEqual(
            (seed.manifest.documents[1].page_start, seed.manifest.documents[1].page_end), (22, 22)
        )

    def test_derive_curriculum_source_uri_from_canonical_path_wraps_canonical_doc_path(
        self,
    ) -> None:
        self.assertEqual(
            derive_curriculum_source_uri_from_canonical_path(
                "rag-data/canonical/curriculum_plan/docs/中国少数民族语言文学本科人才培养方案.md"
            ),
            "campusrag://rag-data/canonical/curriculum_plan/docs/中国少数民族语言文学本科人才培养方案.md",
        )

    def test_curriculum_split_manifest_seed_retires_historical_synthetic_umbrella_title(
        self,
    ) -> None:
        historical_documents = (
            HistoricalCurriculumDocument(
                document_id="plan:78d25a2033e93fc5940e2d10648ae2d7e887cb74",
                title="各类课程教学计划",
                status="active",
                canonical_doc_path="rag-data/canonical/curriculum_plan/docs/各类课程教学计划.md",
                historical_page_start=None,
                historical_page_end=None,
                ocr_doc_decision_uri=None,
            ),
            HistoricalCurriculumDocument(
                document_id="curriculum:plan-a",
                title="计划甲",
                status="active",
                canonical_doc_path="rag-data/canonical/curriculum_plan/docs/计划甲.md",
                historical_page_start=None,
                historical_page_end=None,
                ocr_doc_decision_uri=None,
            ),
        )
        structured_rows = [
            {
                "row_type": "heading",
                "block_role": "doc_title",
                "title_candidate_score": 1.0,
                "text_normalized": "计划甲",
                "page_start": 20,
                "page_end": 20,
            },
        ]
        seed = build_curriculum_split_manifest_seed(
            historical_documents=historical_documents,
            structured_rows=structured_rows,
            raw_asset_id="asset:curriculum-plan-2022",
        )
        self.assertEqual(len(seed.missing_documents), 0)
        self.assertEqual(len(seed.retired_documents), 1)
        retired = seed.retired_documents[0]
        self.assertEqual(retired.title, "各类课程教学计划")
        self.assertEqual(retired.reason, "synthetic_umbrella_title")

    def test_build_curriculum_split_manifest_seed_marks_ambiguous_heading_titles_missing(
        self,
    ) -> None:
        historical_documents = (
            HistoricalCurriculumDocument(
                document_id="curriculum:plan-a",
                title="计划甲",
                status="active",
                canonical_doc_path="rag-data/canonical/curriculum_plan/docs/计划甲.md",
                historical_page_start=None,
                historical_page_end=None,
                ocr_doc_decision_uri=None,
            ),
            HistoricalCurriculumDocument(
                document_id="curriculum:plan-b",
                title="计划乙",
                status="active",
                canonical_doc_path="rag-data/canonical/curriculum_plan/docs/计划乙.md",
                historical_page_start=None,
                historical_page_end=None,
                ocr_doc_decision_uri=None,
            ),
        )
        structured_rows = [
            {
                "row_type": "heading",
                "block_role": "doc_title",
                "title_candidate_score": 1.0,
                "text_normalized": "计划甲",
                "page_start": 20,
                "page_end": 20,
            },
            {
                "row_type": "heading",
                "block_role": "doc_title",
                "title_candidate_score": 1.0,
                "text_normalized": "计划甲",
                "page_start": 30,
                "page_end": 30,
            },
            {
                "row_type": "heading",
                "block_role": "doc_title",
                "title_candidate_score": 1.0,
                "text_normalized": "计划乙",
                "page_start": 40,
                "page_end": 40,
            },
        ]

        seed = build_curriculum_split_manifest_seed(
            historical_documents=historical_documents,
            structured_rows=structured_rows,
            raw_asset_id="asset:curriculum-plan-2022",
        )

        self.assertEqual(len(seed.manifest.documents), 1)
        self.assertEqual(len(seed.missing_documents), 1)
        self.assertEqual(seed.missing_documents[0].reason, "ambiguous_title_in_structured_headings")

    def test_build_curriculum_split_manifest_seed_ignores_body_text_title_collisions(self) -> None:
        historical_documents = (
            HistoricalCurriculumDocument(
                document_id="curriculum:plan-a",
                title="计划甲",
                status="active",
                canonical_doc_path="rag-data/canonical/curriculum_plan/docs/计划甲.md",
                historical_page_start=None,
                historical_page_end=None,
                ocr_doc_decision_uri=None,
            ),
            HistoricalCurriculumDocument(
                document_id="curriculum:plan-b",
                title="计划乙",
                status="active",
                canonical_doc_path="rag-data/canonical/curriculum_plan/docs/计划乙.md",
                historical_page_start=None,
                historical_page_end=None,
                ocr_doc_decision_uri=None,
            ),
        )
        structured_rows = [
            {
                "row_type": "paragraph",
                "block_role": "text",
                "title_candidate_score": 0.0,
                "text_normalized": "计划甲培养具有国际视野的人才。",
                "page_start": 20,
                "page_end": 20,
            },
            {
                "row_type": "heading",
                "block_role": "doc_title",
                "title_candidate_score": 1.0,
                "text_normalized": "计划乙",
                "page_start": 21,
                "page_end": 21,
            },
        ]

        seed = build_curriculum_split_manifest_seed(
            historical_documents=historical_documents,
            structured_rows=structured_rows,
            raw_asset_id="asset:curriculum-plan-2022",
        )

        self.assertEqual(len(seed.manifest.documents), 1)
        self.assertEqual(len(seed.missing_documents), 1)
        self.assertEqual(seed.missing_documents[0].reason, "title_not_found_in_structured_headings")

    def test_build_manifest_document_rows_produces_document_level_structured_shape(self) -> None:
        structured_rows = load_layout_elements_rows(
            Path("tests/fixtures/curriculum_plan/layout-elements.pages-278-297.jsonl")
        )
        document = SplitManifestDocument(
            document_id="curriculum:国际经济与贸易本科人才培养方案",
            title="国际经济与贸易本科人才培养方案",
            page_start=278,
            page_end=288,
            status="active",
        )
        source_uri = derive_curriculum_source_uri_from_canonical_path(
            "rag-data/canonical/curriculum_plan/docs/国际经济与贸易本科人才培养方案.md"
        )

        rows = build_manifest_document_rows(
            structured_rows=structured_rows,
            manifest_document=document,
            version_id="sha256:curriculum-plan-2022:split:test",
            source_pdf="curriculum-plan-2022.pdf",
            source_uri=source_uri,
        )

        self.assertGreater(len(rows), 5)
        summary_row = rows[0]
        self.assertEqual(summary_row["doc_id"], document.document_id)
        self.assertEqual(summary_row["version_id"], "sha256:curriculum-plan-2022:split:test")
        self.assertEqual(summary_row["chunk_id"], "document-0000")
        self.assertEqual(summary_row["page_start"], 278)
        self.assertEqual(summary_row["page_end"], 288)
        self.assertEqual(summary_row["source_url"], source_uri)
        self.assertEqual(summary_row["source"], {"id": source_uri})
        self.assertEqual(summary_row["entitlement_groups"], [])
        self.assertIsNone(summary_row["visibility_scope"])
        self.assertEqual(summary_row["visibility_level"], "public")
        self.assertEqual(
            summary_row["policy_projection_version"],
            "phase1-authorization-projection-v1",
        )
        self.assertNotIn("acl", summary_row)
        self.assertIn("国际经济与贸易本科人才培养方案", summary_row["clean_text"])

        first_page_row = rows[1]
        self.assertEqual(first_page_row["chunk_id"], "page-0278-block-1-0001")
        self.assertEqual(first_page_row["row_id"], "page-0278-block-1-0001")
        self.assertEqual(first_page_row["page_start"], 278)
        self.assertEqual(first_page_row["page_end"], 278)
        self.assertEqual(first_page_row["doc_id"], document.document_id)
        self.assertEqual(first_page_row["source_url"], source_uri)
        self.assertEqual(first_page_row["entitlement_groups"], [])
        self.assertEqual(first_page_row["visibility_level"], "public")
        self.assertNotIn("acl", first_page_row)

    def test_build_manifest_document_rows_canonicalizes_root_heading_to_manifest_title(
        self,
    ) -> None:
        manifest_document = SplitManifestDocument(
            document_id="curriculum:民族学本科第二学士学位人才培养方案",
            title="民族学本科第二学士学位人才培养方案",
            page_start=100,
            page_end=101,
            status="active",
        )

        rows = build_manifest_document_rows(
            structured_rows=[
                {
                    "row_id": "page-0100-block-0001",
                    "row_type": "heading",
                    "block_role": "doc_title",
                    "heading_level": 1,
                    "text_normalized": "民族学本科第二学士学位人才培养方案(2020 版)",
                    "page_start": 100,
                    "page_end": 100,
                },
                {
                    "row_id": "page-0100-block-0002",
                    "row_type": "paragraph",
                    "text_normalized": "培养具备民族学基础理论与方法的复合型人才。",
                    "page_start": 100,
                    "page_end": 100,
                },
            ],
            manifest_document=manifest_document,
            version_id="sha256:test",
            source_pdf="curriculum-plan.pdf",
            source_uri="campusrag://source/curriculum/test/pages/100-101",
        )

        self.assertEqual(rows[1]["clean_text"], "民族学本科第二学士学位人才培养方案")
        self.assertNotIn("(2020 版)", rows[0]["clean_text"])
        self.assertNotIn("(2020 版)", rows[1]["clean_text"])

    def test_build_manifest_document_rows_rejects_clean_text_only_source_truth_rows(self) -> None:
        manifest_document = SplitManifestDocument(
            document_id="curriculum:test-001",
            title="测试培养方案",
            page_start=1,
            page_end=1,
            status="active",
        )

        with self.assertRaisesRegex(ValueError, "missing normalized text"):
            build_manifest_document_rows(
                structured_rows=[
                    {
                        "row_id": "page-0001-block-0001",
                        "row_type": "paragraph",
                        "clean_text": "这不应再被视为 source-truth 输入字段。",
                        "page_start": 1,
                        "page_end": 1,
                    }
                ],
                manifest_document=manifest_document,
                version_id="sha256:test",
                source_pdf="curriculum-plan.pdf",
                source_uri="campusrag://source/curriculum/test/pages/1-1",
            )


if __name__ == "__main__":
    unittest.main()
