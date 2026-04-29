from __future__ import annotations

import json
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

from campus_ingestion_core.models import RawAssetRecord
from campus_ingestion_core.raw_ingestion_split_manifest import (
    _build_split_manifest_document_input,
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


class SplitManifestDocumentInputTest(unittest.TestCase):
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

    def test_build_split_manifest_document_input_drops_page_markers_and_merges_cross_page_paragraphs(
        self,
    ) -> None:
        manifest = load_split_manifest(
            Path("configs/ingestion/curriculum/curriculum_plan/split-manifest.v1.json"),
            expected_corpus="curriculum",
            expected_collection="curriculum_plan",
        )
        manifest_document = manifest.documents[0]
        structured_rows = [
            {
                "row_id": "page-0020-body",
                "row_type": "paragraph",
                "row_index": 10,
                "reading_order": 1,
                "text_raw": "复杂软件工程",
                "text_normalized": "复杂软件工程",
                "page_start": 20,
                "page_end": 20,
                "continues_to_next_page": True,
            },
            {
                "row_id": "page-0021-number",
                "row_type": "page_number",
                "row_index": 11,
                "reading_order": 1,
                "text_raw": "476",
                "text_normalized": "476",
                "page_start": 21,
                "page_end": 21,
            },
            {
                "row_id": "page-0021-body",
                "row_type": "paragraph",
                "row_index": 12,
                "reading_order": 2,
                "text_raw": "问题",
                "text_normalized": "问题",
                "page_start": 21,
                "page_end": 21,
                "continues_from_previous_page": True,
            },
            {
                "row_id": "page-0021-footer",
                "row_type": "footer",
                "row_index": 13,
                "reading_order": 3,
                "text_raw": "中央民族大学教务处",
                "text_normalized": "中央民族大学教务处",
                "page_start": 21,
                "page_end": 21,
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

        self.assertEqual(len(projected_rows), 1)
        self.assertEqual(projected_rows[0]["row_type"], "paragraph")
        self.assertEqual(projected_rows[0]["clean_text"], "复杂软件工程问题")
        self.assertEqual(projected_rows[0]["page_start"], 20)
        self.assertEqual(projected_rows[0]["page_end"], 21)

    def test_build_split_manifest_document_input_keeps_repeated_structural_headings(
        self,
    ) -> None:
        manifest = load_split_manifest(
            Path("configs/ingestion/curriculum/curriculum_plan/split-manifest.v1.json"),
            expected_corpus="curriculum",
            expected_collection="curriculum_plan",
        )
        manifest_document = manifest.documents[0]
        structured_rows = [
            {
                "row_id": "page-0020-section-three",
                "row_type": "heading",
                "heading_level": 2,
                "row_index": 10,
                "reading_order": 1,
                "section_hint": "section",
                "text_raw": "三、学制、总学分和学位授予",
                "text_normalized": "三、学制、总学分和学位授予",
                "page_start": 20,
                "page_end": 20,
            },
            {
                "row_id": "page-0020-degree",
                "row_type": "paragraph",
                "row_index": 11,
                "reading_order": 2,
                "text_raw": "授予学位:工学学士",
                "text_normalized": "授予学位:工学学士",
                "page_start": 20,
                "page_end": 20,
                "continues_to_next_page": True,
            },
            {
                "row_id": "page-0020-number",
                "row_type": "page_number",
                "row_index": 12,
                "reading_order": 3,
                "text_raw": "513",
                "text_normalized": "513",
                "page_start": 20,
                "page_end": 20,
            },
            {
                "row_id": "page-0021-section-four",
                "row_type": "heading",
                "heading_level": 1,
                "row_index": 13,
                "reading_order": 1,
                "section_hint": "section",
                "text_raw": "四、各教学环节学时学分",
                "text_normalized": "四、各教学环节学时学分",
                "page_start": 21,
                "page_end": 21,
                "is_repeated_candidate": True,
            },
            {
                "row_id": "page-0021-body",
                "row_type": "paragraph",
                "row_index": 14,
                "reading_order": 2,
                "text_raw": "将本科修读阶段分为大类培养、专业培养和个性化培养三个阶段。",
                "text_normalized": "将本科修读阶段分为大类培养、专业培养和个性化培养三个阶段。",
                "page_start": 21,
                "page_end": 21,
                "continues_from_previous_page": True,
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

        self.assertEqual(
            [row["row_type"] for row in projected_rows],
            ["heading", "paragraph", "heading", "paragraph"],
        )
        self.assertEqual(projected_rows[1]["clean_text"], "授予学位:工学学士")
        self.assertEqual(projected_rows[2]["clean_text"], "四、各教学环节学时学分")
        self.assertEqual(projected_rows[2]["section_hint"], "section")
        self.assertEqual(
            projected_rows[3]["clean_text"],
            "将本科修读阶段分为大类培养、专业培养和个性化培养三个阶段。",
        )

    def test_build_split_manifest_document_input_keeps_repeated_table_continuations(
        self,
    ) -> None:
        manifest = load_split_manifest(
            Path("configs/ingestion/curriculum/curriculum_plan/split-manifest.v1.json"),
            expected_corpus="curriculum",
            expected_collection="curriculum_plan",
        )
        manifest_document = manifest.documents[0]
        structured_rows = [
            {
                "row_id": "page-0020-table",
                "row_type": "table",
                "row_index": 10,
                "reading_order": 1,
                "text_raw": "<table><tr><td>课程</td><td>学分</td></tr></table>",
                "text_normalized": "<table><tr><td>课程</td><td>学分</td></tr></table>",
                "html": "<table><tr><td>课程</td><td>学分</td></tr></table>",
                "page_start": 20,
                "page_end": 20,
                "continuation_group_id": "page-0020-table",
            },
            {
                "row_id": "page-0021-table",
                "row_type": "table",
                "row_index": 11,
                "reading_order": 1,
                "text_raw": "<table><tr><td>实践</td><td>2</td></tr></table>",
                "text_normalized": "<table><tr><td>实践</td><td>2</td></tr></table>",
                "html": "<table><tr><td>实践</td><td>2</td></tr></table>",
                "page_start": 21,
                "page_end": 21,
                "is_repeated_candidate": True,
                "relation_type": "table_continuation",
                "owner_row_id": "page-0020-table",
                "continuation_group_id": "page-0020-table",
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

        self.assertEqual(
            [row["row_id"] for row in projected_rows],
            ["page-0020-table", "page-0021-table"],
        )
        self.assertEqual(projected_rows[1]["relation_type"], "table_continuation")
        self.assertEqual(projected_rows[1]["owner_row_id"], "page-0020-table")

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
