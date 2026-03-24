from __future__ import annotations

import json
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest

from campus_ingestion_core.raw_ingestion import (
    _build_split_manifest_document_input,
    _load_structured_rows,
)
from campus_ingestion_core.split_manifest import load_split_manifest


class SplitManifestTest(unittest.TestCase):
    def test_repo_curriculum_plan_manifest_contains_reviewed_document_boundaries(self) -> None:
        manifest = load_split_manifest(
            Path("configs/ingestion/curriculum_plan/split-manifest.v1.json"),
            expected_corpus="curriculum_plan",
        )

        self.assertEqual(manifest.manifest_version, "curriculum_plan_split_manifest_v1")
        self.assertEqual(manifest.raw_asset_id, "asset:curriculum-plan-2022")
        self.assertEqual(len(manifest.documents), 66)
        self.assertEqual(manifest.documents[0].document_id, "curriculum:中央民族大学通识课程教学计划")
        self.assertEqual(manifest.documents[0].page_start, 20)
        self.assertEqual(manifest.documents[0].page_end, 21)
        self.assertEqual(manifest.documents[-1].document_id, "curriculum:教育学本科第二学士学位人才培养方案")
        self.assertEqual(manifest.documents[-1].page_start, 704)
        self.assertEqual(manifest.documents[-1].page_end, 710)
        titles = {document.title for document in manifest.documents}
        self.assertNotIn("各类课程教学计划", titles)

    def test_real_curriculum_fixture_splits_cleanly_across_adjacent_documents(self) -> None:
        manifest = load_split_manifest(
            Path("configs/ingestion/curriculum_plan/split-manifest.v1.json"),
            expected_corpus="curriculum_plan",
        )
        documents = {document.document_id: document for document in manifest.documents}
        structured_rows = _load_structured_rows(
            Path("tests/fixtures/curriculum_plan/structured-full.pages-278-297.jsonl").read_bytes()
        )
        raw_version_id = "sha256:0416e3d70c48d86238d2869c477ab60407ddbb9a09a76bee57aaeb0c97ab3f67"

        first_input = _build_split_manifest_document_input(
            pdf_path=Path("/tmp/curriculum-plan-2022.pdf"),
            raw_source_uri="file:///tmp/curriculum-plan-2022.pdf",
            raw_asset_id=manifest.raw_asset_id,
            raw_version_id=raw_version_id,
            manifest_version=manifest.manifest_version,
            manifest_document=documents["curriculum:国际经济与贸易本科人才培养方案"],
            structured_rows=structured_rows,
            provider_result_key="curriculum_plan/assets/curriculum-plan-2022/sha256/test/provider-result.jsonl",
            structured_full_key="curriculum_plan/assets/curriculum-plan-2022/sha256/test/structured-full.jsonl",
            default_campus_scope="main",
            corpus="curriculum_plan",
        )
        second_input = _build_split_manifest_document_input(
            pdf_path=Path("/tmp/curriculum-plan-2022.pdf"),
            raw_source_uri="file:///tmp/curriculum-plan-2022.pdf",
            raw_asset_id=manifest.raw_asset_id,
            raw_version_id=raw_version_id,
            manifest_version=manifest.manifest_version,
            manifest_document=documents["curriculum:经济学拔尖人才创新班人才培养方案"],
            structured_rows=structured_rows,
            provider_result_key="curriculum_plan/assets/curriculum-plan-2022/sha256/test/provider-result.jsonl",
            structured_full_key="curriculum_plan/assets/curriculum-plan-2022/sha256/test/structured-full.jsonl",
            default_campus_scope="main",
            corpus="curriculum_plan",
        )

        first_rows = [json.loads(line) for line in first_input.structured_result_bytes.decode("utf-8").splitlines()]
        second_rows = [json.loads(line) for line in second_input.structured_result_bytes.decode("utf-8").splitlines()]

        self.assertTrue(all(row["chunk_id"] != "document-0000" for row in first_rows))
        self.assertTrue(all(row["chunk_id"] != "document-0000" for row in second_rows))
        self.assertEqual(first_rows[0]["doc_id"], "curriculum:国际经济与贸易本科人才培养方案")
        self.assertEqual(first_rows[0]["page_start"], 278)
        self.assertEqual(first_rows[0]["page_end"], 278)
        self.assertIn("国际经济与贸易本科人才培养方案", first_rows[0]["clean_text"])
        self.assertNotIn("经济学拔尖人才创新班人才培养方案", first_rows[0]["clean_text"])
        self.assertTrue(all(278 <= row["page_start"] <= 288 for row in first_rows))

        self.assertEqual(second_rows[0]["doc_id"], "curriculum:经济学拔尖人才创新班人才培养方案")
        self.assertEqual(second_rows[0]["page_start"], 289)
        self.assertEqual(second_rows[0]["page_end"], 289)
        self.assertIn("经济学拔尖人才创新班人才培养方案", second_rows[0]["clean_text"])
        self.assertNotIn("国际经济与贸易本科人才培养方案", second_rows[0]["clean_text"])
        self.assertTrue(all(289 <= row["page_start"] <= 297 for row in second_rows))

    def test_build_split_manifest_document_input_preserves_table_projection_fields(self) -> None:
        manifest = load_split_manifest(
            Path("configs/ingestion/curriculum_plan/split-manifest.v1.json"),
            expected_corpus="curriculum_plan",
        )
        manifest_document = manifest.documents[0]
        structured_rows = [
            {
                "row_id": "page-0020-block-0001",
                "chunk_id": "page-0020-block-0001",
                "row_type": "table_caption",
                "clean_text": "表 1 专业课程",
                "page_start": 20,
                "page_end": 20,
                "owner_row_id": "page-0020-block-0002",
                "relation_type": "caption_of",
                "continuation_group_id": "page-0020-block-0002",
                "html": None,
                "table_cells": None,
                "acl": {"level": "public", "allow_groups": []},
            },
            {
                "row_id": "page-0020-block-0002",
                "chunk_id": "page-0020-block-0002",
                "row_type": "table",
                "clean_text": "<table><tr><td>课程</td><td>学分</td></tr><tr><td>工程数学</td><td>4</td></tr></table>",
                "html": "<table><tr><td>课程</td><td>学分</td></tr><tr><td>工程数学</td><td>4</td></tr></table>",
                "table_cells": [
                    {"row": 1, "col": 1, "text": "课程", "rowspan": 1, "colspan": 1, "is_header": True},
                    {"row": 1, "col": 2, "text": "学分", "rowspan": 1, "colspan": 1, "is_header": True},
                    {"row": 2, "col": 1, "text": "工程数学", "rowspan": 1, "colspan": 1, "is_header": False},
                    {"row": 2, "col": 2, "text": "4", "rowspan": 1, "colspan": 1, "is_header": False},
                ],
                "page_start": 20,
                "page_end": 20,
                "owner_row_id": None,
                "relation_type": None,
                "continuation_group_id": "page-0020-block-0002",
                "acl": {"level": "public", "allow_groups": []},
            },
            {
                "row_id": "page-0021-block-0001",
                "chunk_id": "page-0021-block-0001",
                "row_type": "note",
                "clean_text": "备注：本表按学期执行。",
                "page_start": 21,
                "page_end": 21,
                "owner_row_id": "page-0020-block-0002",
                "relation_type": "note_of",
                "continuation_group_id": "page-0020-block-0002",
                "html": None,
                "table_cells": None,
                "acl": {"level": "public", "allow_groups": []},
            },
        ]
        document_input = _build_split_manifest_document_input(
            pdf_path=Path("/tmp/curriculum-plan-2022.pdf"),
            raw_source_uri="file:///tmp/curriculum-plan-2022.pdf",
            raw_asset_id=manifest.raw_asset_id,
            raw_version_id="sha256:test",
            manifest_version=manifest.manifest_version,
            manifest_document=manifest_document,
            structured_rows=structured_rows,
            provider_result_key="curriculum_plan/assets/curriculum-plan-2022/sha256/test/provider-result.jsonl",
            structured_full_key="curriculum_plan/assets/curriculum-plan-2022/sha256/test/structured-full.jsonl",
            default_campus_scope="main",
            corpus="curriculum_plan",
        )

        projected_rows = [
            json.loads(line) for line in document_input.structured_result_bytes.decode("utf-8").splitlines() if line.strip()
        ]
        expected_source_uri = "campusrag://source/curriculum_plan/curriculum-plan-2022/sha256/test/pages/20-21"

        self.assertEqual(len(projected_rows), 3)
        self.assertTrue(all(row["doc_id"] == manifest_document.document_id for row in projected_rows))
        self.assertTrue(all(row["version_id"] == document_input.metadata["version_id"] for row in projected_rows))
        self.assertEqual(projected_rows[0]["source_url"], expected_source_uri)
        self.assertEqual(projected_rows[1]["html"], structured_rows[1]["html"])
        self.assertEqual(projected_rows[1]["table_cells"], structured_rows[1]["table_cells"])
        self.assertEqual(projected_rows[2]["owner_row_id"], "page-0020-block-0002")
        self.assertEqual(projected_rows[2]["relation_type"], "note_of")
        self.assertEqual(projected_rows[2]["continuation_group_id"], "page-0020-block-0002")
        self.assertEqual(projected_rows[1]["source"]["id"], expected_source_uri)
        self.assertTrue(all(row["chunk_id"] != "document-0000" for row in projected_rows))

    def test_load_split_manifest_reads_curriculum_plan_documents(self) -> None:
        with TemporaryDirectory() as temp_dir:
            path = Path(temp_dir) / "split-manifest.v1.json"
            path.write_text(
                json.dumps(
                    {
                        "manifest_version": "curriculum_plan_split_manifest_v1",
                        "corpus": "curriculum_plan",
                        "raw_asset_id": "asset:curriculum-plan-master-pdf",
                        "documents": [
                            {
                                "document_id": "curriculum:plan-001",
                                "title": "Plan 001",
                                "page_start": 1,
                                "page_end": 12,
                            },
                            {
                                "document_id": "curriculum:plan-002",
                                "title": "Plan 002",
                                "page_start": 13,
                                "page_end": 20,
                                "acl_groups": ["students"],
                                "campus_scope": "main",
                            },
                        ],
                    },
                    ensure_ascii=False,
                    indent=2,
                ),
                encoding="utf-8",
            )

            manifest = load_split_manifest(path, expected_corpus="curriculum_plan")

            self.assertEqual(manifest.corpus, "curriculum_plan")
            self.assertEqual(manifest.raw_asset_id, "asset:curriculum-plan-master-pdf")
            self.assertEqual(len(manifest.documents), 2)
            self.assertEqual(manifest.documents[1].acl_groups, ("students",))
            self.assertEqual(manifest.documents[1].campus_scope, "main")

    def test_load_split_manifest_rejects_overlapping_page_ranges(self) -> None:
        with TemporaryDirectory() as temp_dir:
            path = Path(temp_dir) / "split-manifest.v1.json"
            path.write_text(
                json.dumps(
                    {
                        "manifest_version": "curriculum_plan_split_manifest_v1",
                        "corpus": "curriculum_plan",
                        "raw_asset_id": "asset:curriculum-plan-master-pdf",
                        "documents": [
                            {
                                "document_id": "curriculum:plan-001",
                                "title": "Plan 001",
                                "page_start": 1,
                                "page_end": 12,
                            },
                            {
                                "document_id": "curriculum:plan-002",
                                "title": "Plan 002",
                                "page_start": 12,
                                "page_end": 20,
                            },
                        ],
                    },
                    ensure_ascii=False,
                    indent=2,
                ),
                encoding="utf-8",
            )

            with self.assertRaisesRegex(ValueError, "overlap"):
                load_split_manifest(path, expected_corpus="curriculum_plan")


if __name__ == "__main__":
    unittest.main()
