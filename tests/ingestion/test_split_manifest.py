from __future__ import annotations

import json
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

from campus_ingestion_core.models import RawAssetRecord
from campus_ingestion_core.raw_ingestion_split_manifest import (
    _build_split_manifest_document_input,
    _load_layout_elements_rows,
)
from campus_ingestion_core.split_manifest import SplitManifestDocument, load_split_manifest


def _curriculum_raw_asset_record(*, raw_version_id: str) -> RawAssetRecord:
    return RawAssetRecord(
        raw_asset_id="asset:curriculum-plan-2022",
        raw_version_id=raw_version_id,
        corpus="curriculum",
        collection="curriculum_plan",
        raw_source_uri="file:///tmp/curriculum-plan-2022.pdf",
        content_hash=raw_version_id.removeprefix("sha256:"),
        source_filename="curriculum-plan-2022.pdf",
        object_key="official_pdf/curriculum-plan/2022/sha256/test/capture/curriculum-plan-2022.pdf",
        ingestion_timestamp="2026-03-24T10:00:00+00:00",
        import_source="raw_online_ocr",
    )


class SplitManifestTest(unittest.TestCase):
    def test_student_handbook_repo_manifest_matches_real_reference_shape(self) -> None:
        path = (
            Path(__file__).resolve().parents[2]
            / "configs"
            / "ingestion"
            / "regulations"
            / "student_rules"
            / "split-manifest.v1.json"
        )

        payload = json.loads(path.read_text(encoding="utf-8"))

        self.assertEqual(payload["manifest_version"], "student_rules_split_manifest_v1")
        self.assertEqual(payload["corpus"], "regulations")
        self.assertEqual(payload["collection"], "student_rules")
        self.assertEqual(payload["raw_asset_id"], "asset:student-handbook-pdf")
        self.assertIn("documents", payload)
        self.assertEqual(len(payload["documents"]), 46)
        self.assertEqual(payload["documents"][0]["title"], "普通高等学校学生管理规定")
        self.assertEqual(payload["documents"][0]["handbook_section"], "国家高等教育管理有关规定")
        self.assertEqual(payload["documents"][-1]["title"], "中央民族大学学生公费医疗管理办法")
        self.assertTrue(
            payload["documents"][-1]["source_uri"].startswith(
                "campus-agent://regulations/student_rules/docs/"
            )
        )
        titles = {document["title"] for document in payload["documents"]}
        self.assertNotIn("中央民族大学校内常用电话", titles)
        self.assertNotIn("中央民族大学公寓及公费医疗管理规定", titles)

    def test_repo_curriculum_plan_manifest_contains_reviewed_document_boundaries(self) -> None:
        manifest = load_split_manifest(
            Path("configs/ingestion/curriculum/curriculum_plan/split-manifest.v1.json"),
            expected_corpus="curriculum",
            expected_collection="curriculum_plan",
        )

        self.assertEqual(manifest.manifest_version, "curriculum_plan_split_manifest_v1")
        self.assertEqual(manifest.raw_asset_id, "asset:curriculum-plan-2022")
        self.assertEqual(len(manifest.documents), 69)
        self.assertEqual(
            manifest.documents[0].document_id, "curriculum:中央民族大学通识课程教学计划"
        )
        self.assertEqual(manifest.documents[0].page_start, 20)
        self.assertEqual(manifest.documents[0].page_end, 21)
        self.assertEqual(
            manifest.documents[1].document_id,
            "curriculum:中央民族大学通识课程思想政治理论课教学计划",
        )
        self.assertEqual(manifest.documents[1].page_start, 22)
        self.assertEqual(manifest.documents[1].page_end, 26)
        self.assertEqual(
            manifest.documents[2].document_id,
            "curriculum:中央民族大学通识课程“大学英语”课程教学计划",
        )
        self.assertEqual(manifest.documents[2].page_start, 27)
        self.assertEqual(manifest.documents[2].page_end, 29)
        self.assertEqual(
            manifest.documents[3].document_id,
            "curriculum:中央民族大学通识课程“信息素养”课程教学计划",
        )
        self.assertEqual(manifest.documents[3].page_start, 30)
        self.assertEqual(manifest.documents[3].page_end, 31)
        self.assertEqual(
            manifest.documents[4].document_id,
            "curriculum:中央民族大学通识课程“大学体育”课程教学计划",
        )
        self.assertEqual(manifest.documents[4].page_start, 32)
        self.assertEqual(manifest.documents[4].page_end, 36)
        self.assertEqual(
            manifest.documents[-1].document_id, "curriculum:教育学本科第二学士学位人才培养方案"
        )
        self.assertEqual(manifest.documents[-1].page_start, 704)
        self.assertEqual(manifest.documents[-1].page_end, 710)
        titles = {document.title for document in manifest.documents}
        self.assertNotIn("各类课程教学计划", titles)

    def test_repo_curriculum_plan_manifests_use_canonical_authorization_projection_keys(
        self,
    ) -> None:
        root = (
            Path(__file__).resolve().parents[2]
            / "configs"
            / "ingestion"
            / "curriculum"
            / "curriculum_plan"
        )

        for filename in ("split-manifest.v1.json", "split-manifest.candidate.v1.json"):
            payload = json.loads((root / filename).read_text(encoding="utf-8"))
            for document in payload["documents"]:
                self.assertNotIn("acl_groups", document, msg=f"{filename} still uses acl_groups")
                self.assertNotIn(
                    "campus_scope", document, msg=f"{filename} still uses campus_scope"
                )
                self.assertIn(
                    "entitlement_groups", document, msg=f"{filename} is missing entitlement_groups"
                )
                if document["entitlement_groups"]:
                    self.assertIn(
                        "visibility_scope",
                        document,
                        msg=f"{filename} restricted document should keep explicit visibility_scope",
                    )
                else:
                    self.assertNotIn(
                        "visibility_scope",
                        document,
                        msg=f"{filename} public curriculum document should not carry visibility_scope",
                    )

    def test_load_split_manifest_rejects_overlapping_curriculum_page_ranges(self) -> None:
        with TemporaryDirectory() as temp_dir:
            path = Path(temp_dir) / "split-manifest.overlap.json"
            path.write_text(
                json.dumps(
                    {
                        "manifest_version": "curriculum_plan_split_manifest_v1",
                        "corpus": "curriculum",
                        "collection": "curriculum_plan",
                        "raw_asset_id": "asset:curriculum-plan-2022",
                        "documents": [
                            {
                                "document_id": "curriculum:plan-a",
                                "title": "计划甲",
                                "page_start": 20,
                                "page_end": 22,
                            },
                            {
                                "document_id": "curriculum:plan-b",
                                "title": "计划乙",
                                "page_start": 22,
                                "page_end": 23,
                            },
                        ],
                    },
                    ensure_ascii=False,
                ),
                encoding="utf-8",
            )

            with self.assertRaisesRegex(ValueError, "page ranges overlap"):
                load_split_manifest(path)

    def test_real_curriculum_fixture_splits_cleanly_across_adjacent_documents(self) -> None:
        manifest = load_split_manifest(
            Path("configs/ingestion/curriculum/curriculum_plan/split-manifest.v1.json"),
            expected_corpus="curriculum",
            expected_collection="curriculum_plan",
        )
        documents = {document.document_id: document for document in manifest.documents}
        structured_rows = _load_layout_elements_rows(
            Path("tests/fixtures/curriculum_plan/layout-elements.pages-278-297.jsonl").read_bytes()
        )
        self.assertEqual(structured_rows[0]["corpus"], "curriculum")
        self.assertEqual(structured_rows[0]["collection"], "curriculum_plan")
        raw_version_id = "sha256:0416e3d70c48d86238d2869c477ab60407ddbb9a09a76bee57aaeb0c97ab3f67"
        raw_asset_record = _curriculum_raw_asset_record(raw_version_id=raw_version_id)

        first_input = _build_split_manifest_document_input(
            raw_asset_record=raw_asset_record,
            manifest_version=manifest.manifest_version,
            manifest_document=documents["curriculum:国际经济与贸易本科人才培养方案"],
            structured_rows=structured_rows,
            provider_response_key=(
                "official_pdf/curriculum-plan/2022/sha256/test/provider/vlm/provider-response.jsonl"
            ),
            layout_elements_key="official_pdf/curriculum-plan/2022/sha256/test/source-truth/layout-elements.jsonl",
            default_visibility_scope="main",
            corpus="curriculum",
            collection="curriculum_plan",
        )
        second_input = _build_split_manifest_document_input(
            raw_asset_record=raw_asset_record,
            manifest_version=manifest.manifest_version,
            manifest_document=documents["curriculum:经济学拔尖人才创新班人才培养方案"],
            structured_rows=structured_rows,
            provider_response_key=(
                "official_pdf/curriculum-plan/2022/sha256/test/provider/vlm/provider-response.jsonl"
            ),
            layout_elements_key="official_pdf/curriculum-plan/2022/sha256/test/source-truth/layout-elements.jsonl",
            default_visibility_scope="main",
            corpus="curriculum",
            collection="curriculum_plan",
        )

        first_rows = [
            json.loads(line)
            for line in first_input.document_units_bytes.decode("utf-8").splitlines()
        ]
        second_rows = [
            json.loads(line)
            for line in second_input.document_units_bytes.decode("utf-8").splitlines()
        ]

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
            Path("configs/ingestion/curriculum/curriculum_plan/split-manifest.v1.json"),
            expected_corpus="curriculum",
            expected_collection="curriculum_plan",
        )
        manifest_document = manifest.documents[0]
        structured_rows = [
            {
                "row_id": "page-0020-block-0001",
                "row_type": "table_caption",
                "text_raw": "表 1 专业课程",
                "text_normalized": "表 1 专业课程",
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
                "row_type": "table",
                "text_raw": "<table><tr><td>课程</td><td>学分</td></tr><tr><td>工程数学</td><td>4</td></tr></table>",
                "text_normalized": "<table><tr><td>课程</td><td>学分</td></tr><tr><td>工程数学</td><td>4</td></tr></table>",
                "html": "<table><tr><td>课程</td><td>学分</td></tr><tr><td>工程数学</td><td>4</td></tr></table>",
                "table_cells": [
                    {
                        "row": 1,
                        "col": 1,
                        "text": "课程",
                        "rowspan": 1,
                        "colspan": 1,
                        "is_header": True,
                    },
                    {
                        "row": 1,
                        "col": 2,
                        "text": "学分",
                        "rowspan": 1,
                        "colspan": 1,
                        "is_header": True,
                    },
                    {
                        "row": 2,
                        "col": 1,
                        "text": "工程数学",
                        "rowspan": 1,
                        "colspan": 1,
                        "is_header": False,
                    },
                    {
                        "row": 2,
                        "col": 2,
                        "text": "4",
                        "rowspan": 1,
                        "colspan": 1,
                        "is_header": False,
                    },
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
                "row_type": "note",
                "text_raw": "备注：本表按学期执行。",
                "text_normalized": "备注：本表按学期执行。",
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
            raw_asset_record=_curriculum_raw_asset_record(raw_version_id="sha256:test"),
            manifest_version=manifest.manifest_version,
            manifest_document=manifest_document,
            structured_rows=structured_rows,
            provider_response_key=(
                "official_pdf/curriculum-plan/2022/sha256/test/provider/vlm/provider-response.jsonl"
            ),
            layout_elements_key="official_pdf/curriculum-plan/2022/sha256/test/source-truth/layout-elements.jsonl",
            default_visibility_scope="main",
            corpus="curriculum",
            collection="curriculum_plan",
        )

        projected_rows = [
            json.loads(line)
            for line in document_input.document_units_bytes.decode("utf-8").splitlines()
            if line.strip()
        ]
        expected_source_uri = (
            "campusrag://source/curriculum/curriculum-plan-2022/sha256/test/capture/pages/20-21"
        )

        self.assertEqual(len(projected_rows), 3)
        self.assertTrue(
            all(row["doc_id"] == manifest_document.document_id for row in projected_rows)
        )
        self.assertTrue(
            all(
                row["version_id"] == document_input.metadata["version_id"] for row in projected_rows
            )
        )
        self.assertEqual(projected_rows[0]["source_url"], expected_source_uri)
        self.assertEqual(projected_rows[1]["html"], structured_rows[1]["html"])
        self.assertEqual(projected_rows[1]["table_cells"], structured_rows[1]["table_cells"])
        self.assertEqual(projected_rows[2]["owner_row_id"], "page-0020-block-0002")
        self.assertEqual(projected_rows[2]["relation_type"], "note_of")
        self.assertEqual(projected_rows[2]["continuation_group_id"], "page-0020-block-0002")
        self.assertEqual(projected_rows[1]["source"]["id"], expected_source_uri)

    def test_build_split_manifest_document_input_preserves_heading_structure_fields(self) -> None:
        manifest = load_split_manifest(
            Path("configs/ingestion/curriculum/curriculum_plan/split-manifest.v1.json"),
            expected_corpus="curriculum",
            expected_collection="curriculum_plan",
        )
        manifest_document = manifest.documents[0]
        structured_rows = [
            {
                "row_id": "page-0020-block-0001",
                "row_type": "heading",
                "heading_level": 1,
                "row_index": 10,
                "reading_order": 1,
                "section_hint": "doc_title",
                "text_raw": "测试培养方案",
                "text_normalized": "测试培养方案",
                "page_start": 20,
                "page_end": 20,
                "html": None,
                "table_cells": None,
                "acl": {"level": "public", "allow_groups": []},
            },
            {
                "row_id": "page-0020-block-0002",
                "row_type": "heading",
                "heading_level": 2,
                "row_index": 11,
                "reading_order": 2,
                "section_hint": "section",
                "text_raw": "一、培养目标",
                "text_normalized": "一、培养目标",
                "page_start": 20,
                "page_end": 20,
                "html": None,
                "table_cells": None,
                "acl": {"level": "public", "allow_groups": []},
            },
            {
                "row_id": "page-0020-block-0003",
                "row_type": "paragraph",
                "row_index": 12,
                "reading_order": 3,
                "text_raw": "培养具有系统分析能力的人才。",
                "text_normalized": "培养具有系统分析能力的人才。",
                "page_start": 20,
                "page_end": 20,
                "html": None,
                "table_cells": None,
                "acl": {"level": "public", "allow_groups": []},
            },
        ]
        document_input = _build_split_manifest_document_input(
            raw_asset_record=_curriculum_raw_asset_record(raw_version_id="sha256:test"),
            manifest_version=manifest.manifest_version,
            manifest_document=manifest_document,
            structured_rows=structured_rows,
            provider_response_key=(
                "official_pdf/curriculum-plan/2022/sha256/test/provider/vlm/provider-response.jsonl"
            ),
            layout_elements_key="official_pdf/curriculum-plan/2022/sha256/test/source-truth/layout-elements.jsonl",
            default_visibility_scope="main",
            corpus="curriculum",
            collection="curriculum_plan",
        )

        projected_rows = [
            json.loads(line)
            for line in document_input.document_units_bytes.decode("utf-8").splitlines()
            if line.strip()
        ]

        self.assertEqual(projected_rows[0]["row_type"], "heading")
        self.assertEqual(projected_rows[0]["heading_level"], 1)
        self.assertEqual(projected_rows[0]["row_index"], 10)
        self.assertEqual(projected_rows[0]["reading_order"], 1)
        self.assertEqual(projected_rows[0]["section_hint"], "doc_title")
        self.assertEqual(projected_rows[1]["heading_level"], 2)
        self.assertEqual(projected_rows[1]["section_hint"], "section")

    def test_load_split_manifest_reads_curriculum_plan_documents(self) -> None:
        with TemporaryDirectory() as temp_dir:
            path = Path(temp_dir) / "split-manifest.v1.json"
            path.write_text(
                json.dumps(
                    {
                        "manifest_version": "curriculum_plan_split_manifest_v1",
                        "corpus": "curriculum",
                        "collection": "curriculum_plan",
                        "raw_asset_id": "asset:curriculum-plan-2022",
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
                                "entitlement_groups": ["students"],
                                "visibility_scope": "main",
                            },
                        ],
                    },
                    ensure_ascii=False,
                    indent=2,
                ),
                encoding="utf-8",
            )

            manifest = load_split_manifest(
                path,
                expected_corpus="curriculum",
                expected_collection="curriculum_plan",
            )

            self.assertEqual(manifest.corpus, "curriculum")
            self.assertEqual(manifest.collection, "curriculum_plan")
            self.assertEqual(manifest.raw_asset_id, "asset:curriculum-plan-2022")
            self.assertEqual(len(manifest.documents), 2)
            self.assertEqual(manifest.documents[1].entitlement_groups, ("students",))
            self.assertEqual(manifest.documents[1].visibility_scope, "main")
            self.assertIsNone(manifest.documents[0].source_uri)

    def test_load_split_manifest_rejects_unsupported_authorization_projection_keys(self) -> None:
        with TemporaryDirectory() as temp_dir:
            path = Path(temp_dir) / "split-manifest.v1.json"
            path.write_text(
                json.dumps(
                    {
                        "manifest_version": "curriculum_plan_split_manifest_v1",
                        "corpus": "curriculum",
                        "collection": "curriculum_plan",
                        "raw_asset_id": "asset:curriculum-plan-2022",
                        "documents": [
                            {
                                "document_id": "curriculum:plan-001",
                                "title": "Plan 001",
                                "page_start": 1,
                                "page_end": 12,
                                "entitlement_groups": ["students"],
                                "visibility_scope": "main",
                                "visibility_level": "restricted",
                                "acl_groups": ["legacy-staff"],
                                "campus_scope": "south",
                            },
                        ],
                    },
                    ensure_ascii=False,
                    indent=2,
                ),
                encoding="utf-8",
            )

            with self.assertRaisesRegex(ValueError, "unsupported authorization projection keys"):
                load_split_manifest(
                    path,
                    expected_corpus="curriculum",
                    expected_collection="curriculum_plan",
                )

    def test_load_split_manifest_requires_handbook_section_for_student_handbook(self) -> None:
        with TemporaryDirectory() as temp_dir:
            path = Path(temp_dir) / "split-manifest.v1.json"
            path.write_text(
                json.dumps(
                    {
                        "manifest_version": "student_rules_split_manifest_v1",
                        "corpus": "regulations",
                        "collection": "student_rules",
                        "raw_asset_id": "asset:student-handbook-pdf",
                        "documents": [
                            {
                                "document_id": "handbook:test-001",
                                "title": "制度标题",
                                "page_start": 1,
                                "page_end": 1,
                                "source_uri": "campus-agent://regulations/student_rules/docs/handbook:test-001",
                            }
                        ],
                    },
                    ensure_ascii=False,
                    indent=2,
                ),
                encoding="utf-8",
            )

            with self.assertRaisesRegex(ValueError, "handbook_section"):
                load_split_manifest(
                    path,
                    expected_corpus="regulations",
                    expected_collection="student_rules",
                )

    def test_load_split_manifest_rejects_overlapping_page_ranges(self) -> None:
        with TemporaryDirectory() as temp_dir:
            path = Path(temp_dir) / "split-manifest.v1.json"
            path.write_text(
                json.dumps(
                    {
                        "manifest_version": "curriculum_plan_split_manifest_v1",
                        "corpus": "curriculum",
                        "collection": "curriculum_plan",
                        "raw_asset_id": "asset:curriculum-plan-2022",
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
                load_split_manifest(
                    path,
                    expected_corpus="curriculum",
                    expected_collection="curriculum_plan",
                )

    def test_build_split_manifest_document_input_prefers_new_authorization_projection_fields(
        self,
    ) -> None:
        manifest_document = SplitManifestDocument(
            document_id="curriculum:plan-002",
            title="Plan 002",
            page_start=13,
            page_end=20,
            entitlement_groups=("students",),
            visibility_scope="main",
            visibility_level="restricted",
        )
        structured_rows = [
            {
                "row_id": "page-0013-block-0001",
                "row_type": "paragraph",
                "text_raw": "测试培养方案正文",
                "text_normalized": "测试培养方案正文",
                "page_start": 13,
                "page_end": 13,
                "html": None,
                "table_cells": None,
                "acl": {"level": "public", "allow_groups": []},
            },
        ]

        document_input = _build_split_manifest_document_input(
            raw_asset_record=_curriculum_raw_asset_record(raw_version_id="sha256:test"),
            manifest_version="curriculum_plan_split_manifest_v1",
            manifest_document=manifest_document,
            structured_rows=structured_rows,
            provider_response_key=(
                "official_pdf/curriculum-plan/2022/sha256/test/provider/vlm/provider-response.jsonl"
            ),
            layout_elements_key="official_pdf/curriculum-plan/2022/sha256/test/source-truth/layout-elements.jsonl",
            default_visibility_scope="fallback-campus",
            corpus="curriculum",
            collection="curriculum_plan",
        )

        self.assertEqual(document_input.metadata["entitlement_groups"], ["students"])
        self.assertEqual(document_input.metadata["visibility_scope"], "main")
        self.assertEqual(document_input.metadata["visibility_level"], "restricted")
        self.assertEqual(
            document_input.metadata["policy_projection_version"],
            "phase1-authorization-projection-v1",
        )
        self.assertEqual(document_input.visibility_scope, "main")

    def test_build_split_manifest_document_input_keeps_public_curriculum_visibility_scope_null(
        self,
    ) -> None:
        manifest_document = SplitManifestDocument(
            document_id="curriculum:plan-public",
            title="Plan Public",
            page_start=13,
            page_end=20,
            entitlement_groups=(),
            visibility_scope=None,
            visibility_level="public",
        )
        structured_rows = [
            {
                "row_id": "page-0013-block-0001",
                "row_type": "paragraph",
                "text_raw": "公开培养方案正文",
                "text_normalized": "公开培养方案正文",
                "page_start": 13,
                "page_end": 13,
                "html": None,
                "table_cells": None,
                "acl": {"level": "public", "allow_groups": []},
            },
        ]

        document_input = _build_split_manifest_document_input(
            raw_asset_record=_curriculum_raw_asset_record(raw_version_id="sha256:test"),
            manifest_version="curriculum_plan_split_manifest_v1",
            manifest_document=manifest_document,
            structured_rows=structured_rows,
            provider_response_key=(
                "official_pdf/curriculum-plan/2022/sha256/test/provider/vlm/provider-response.jsonl"
            ),
            layout_elements_key="official_pdf/curriculum-plan/2022/sha256/test/source-truth/layout-elements.jsonl",
            default_visibility_scope=None,
            corpus="curriculum",
            collection="curriculum_plan",
        )

        self.assertEqual(document_input.metadata["entitlement_groups"], [])
        self.assertEqual(document_input.metadata["visibility_level"], "public")
        self.assertIsNone(document_input.metadata["visibility_scope"])
        self.assertIsNone(document_input.visibility_scope)

    def test_public_curriculum_manifest_document_does_not_inherit_default_visibility_scope(
        self,
    ) -> None:
        manifest_document = SplitManifestDocument(
            document_id="curriculum:plan-public",
            title="Plan Public",
            page_start=1,
            page_end=2,
            entitlement_groups=(),
            visibility_scope=None,
            visibility_level="public",
        )

        self.assertIsNone(manifest_document.resolved_visibility_scope("main"))


if __name__ == "__main__":
    unittest.main()
