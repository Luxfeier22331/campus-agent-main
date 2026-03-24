from __future__ import annotations

from pathlib import Path
import unittest

from campus_ingestion_core.curriculum_split_seed import (
    build_manifest_document_rows,
    build_curriculum_split_manifest_seed,
    derive_legacy_curriculum_source_uri,
    load_legacy_curriculum_documents,
    load_structured_rows,
)


class CurriculumSplitSeedTest(unittest.TestCase):
    def test_build_curriculum_split_manifest_seed_uses_structured_titles_for_non_overlapping_ranges(self) -> None:
        legacy_documents = load_legacy_curriculum_documents(
            Path("/home/reptilian/code/campusRag/rag-data/canonical/curriculum_plan/docs")
        )
        structured_rows = load_structured_rows(Path("/tmp/curriculum-structured-full.v3.jsonl"))

        seed = build_curriculum_split_manifest_seed(
            legacy_documents=legacy_documents,
            structured_rows=structured_rows,
            raw_asset_id="asset:curriculum-plan-2022",
        )

        self.assertEqual(seed.manifest.corpus, "curriculum_plan")
        self.assertEqual(seed.manifest.raw_asset_id, "asset:curriculum-plan-2022")
        self.assertEqual(len(seed.manifest.documents), 66)
        self.assertEqual(len(seed.missing_documents), 0)
        self.assertEqual(len(seed.retired_documents), 1)

        first = seed.manifest.documents[0]
        self.assertEqual(first.document_id, "plan:502c5e2920a21ecd86846c2debc629c82fd3a3e0")
        self.assertEqual(first.title, "中央民族大学通识课程教学计划")
        self.assertEqual((first.page_start, first.page_end), (20, 21))
        self.assertEqual(first.status, "active")

        last = seed.manifest.documents[-1]
        self.assertEqual(last.document_id, "plan:33c0626b28a888b9b6253d2f6881e9b951f7ec9b")
        self.assertEqual((last.page_start, last.page_end), (704, 710))

        retired_titles = {item.title for item in seed.retired_documents}
        self.assertEqual(retired_titles, {"各类课程教学计划"})

        matched_titles = {item.title for item in seed.manifest.documents}
        self.assertIn("中国少数民族语言文学（古文字学方向）强基计划本科人才培养方案", matched_titles)
        self.assertIn("民族学本科第二学士学位人才培养方案", matched_titles)
        self.assertIn("法学（民族实验班）本科人才培养方案", matched_titles)

    def test_derive_legacy_curriculum_source_uri_wraps_canonical_doc_path(self) -> None:
        self.assertEqual(
            derive_legacy_curriculum_source_uri("rag-data/canonical/curriculum_plan/docs/中国少数民族语言文学本科人才培养方案.md"),
            "campusrag://rag-data/canonical/curriculum_plan/docs/中国少数民族语言文学本科人才培养方案.md",
        )

    def test_curriculum_split_manifest_seed_retires_legacy_synthetic_umbrella_title(self) -> None:
        legacy_documents = load_legacy_curriculum_documents(
            Path("/home/reptilian/code/campusRag/rag-data/canonical/curriculum_plan/docs")
        )
        structured_rows = load_structured_rows(Path("/tmp/curriculum-structured-full.v3.jsonl"))
        seed = build_curriculum_split_manifest_seed(
            legacy_documents=legacy_documents,
            structured_rows=structured_rows,
            raw_asset_id="asset:curriculum-plan-2022",
        )
        self.assertEqual(len(seed.missing_documents), 0)
        self.assertEqual(len(seed.retired_documents), 1)
        retired = seed.retired_documents[0]
        self.assertEqual(retired.title, "各类课程教学计划")
        self.assertEqual(retired.reason, "legacy_synthetic_umbrella_title")

    def test_build_manifest_document_rows_produces_document_level_structured_shape(self) -> None:
        legacy_documents = load_legacy_curriculum_documents(
            Path("/home/reptilian/code/campusRag/rag-data/canonical/curriculum_plan/docs")
        )
        structured_rows = load_structured_rows(Path("/tmp/curriculum-structured-full.v3.jsonl"))
        seed = build_curriculum_split_manifest_seed(
            legacy_documents=legacy_documents,
            structured_rows=structured_rows,
            raw_asset_id="asset:curriculum-plan-2022",
        )
        document = next(
            item for item in seed.manifest.documents if item.document_id == "plan:7c25c4ea4aac4ea5ae2f1493f1351562cef666df"
        )
        legacy_document = next(item for item in legacy_documents if item.document_id == document.document_id)
        source_uri = derive_legacy_curriculum_source_uri(legacy_document.canonical_doc_path)

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
        self.assertEqual(summary_row["page_start"], 103)
        self.assertEqual(summary_row["page_end"], 115)
        self.assertEqual(summary_row["source_url"], source_uri)
        self.assertEqual(summary_row["source"], {"id": source_uri})
        self.assertEqual(summary_row["acl"], {"level": "public", "allow_groups": []})
        self.assertIn("中国少数民族语言文学本科人才培养方案", summary_row["clean_text"])

        first_page_row = rows[1]
        self.assertEqual(first_page_row["chunk_id"], "page-0103")
        self.assertEqual(first_page_row["page_start"], 103)
        self.assertEqual(first_page_row["page_end"], 103)
        self.assertEqual(first_page_row["doc_id"], document.document_id)
        self.assertEqual(first_page_row["source_url"], source_uri)


if __name__ == "__main__":
    unittest.main()
