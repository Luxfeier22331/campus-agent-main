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
from campus_ingestion_core.raw_ingestion_split_manifest_curriculum import (
    CURRICULUM_SPLIT_MANIFEST_ROW_POLICY,
)
from campus_ingestion_core.split_manifest import load_split_manifest

from tests.ingestion.split_manifest_document_input_suite import *


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
        self.assertEqual(len(manifest.documents), 70)
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
        documents = {document.document_id: document for document in manifest.documents}
        self.assertEqual(
            documents["curriculum:中央民族大学通识课程综合素养课建设方案"].page_start, 47
        )
        self.assertEqual(
            documents["curriculum:中央民族大学通识课程综合素养课建设方案"].page_end, 49
        )
        self.assertEqual(
            documents["curriculum:中央民族大学大学生社会实践环节实施方案"].page_start, 50
        )
        self.assertEqual(
            documents["curriculum:中央民族大学大学生社会实践环节实施方案"].page_end, 51
        )
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

    def test_repo_curriculum_plan_candidate_manifest_keeps_social_practice_split_boundary(
        self,
    ) -> None:
        candidate = load_split_manifest(
            Path("configs/ingestion/curriculum/curriculum_plan/split-manifest.candidate.v1.json"),
            expected_corpus="curriculum",
            expected_collection="curriculum_plan",
        )
        documents = {document.document_id: document for document in candidate.documents}

        self.assertEqual(
            documents["curriculum:中央民族大学通识课程综合素养课建设方案"].page_end, 49
        )
        self.assertEqual(
            documents["curriculum:中央民族大学大学生社会实践环节实施方案"].page_start, 50
        )
        self.assertEqual(
            documents["curriculum:中央民族大学大学生社会实践环节实施方案"].page_end, 51
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
            row_policy=CURRICULUM_SPLIT_MANIFEST_ROW_POLICY,
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
            row_policy=CURRICULUM_SPLIT_MANIFEST_ROW_POLICY,
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


if __name__ == "__main__":
    unittest.main()
