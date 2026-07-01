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
from campus_ingestion_core.split_manifest import (
    SplitManifest,
    SplitManifestDocument,
    load_split_manifest,
)

from tests.ingestion.split_manifest_document_input_suite import *


def _curriculum_raw_asset_record(*, raw_version_id: str) -> RawAssetRecord:
    return RawAssetRecord(
        raw_asset_id="asset:synthetic-curriculum-plan",
        raw_version_id=raw_version_id,
        corpus="curriculum",
        collection="curriculum_plan",
        raw_source_uri="file:///tmp/synthetic-curriculum-plan.pdf",
        content_hash=raw_version_id.removeprefix("sha256:"),
        source_filename="synthetic-curriculum-plan.pdf",
        object_key=(
            "official_pdf/curriculum-plan/synthetic/sha256/test/capture/"
            "synthetic-curriculum-plan.pdf"
        ),
        ingestion_timestamp="2026-03-24T10:00:00+00:00",
        import_source="raw_online_ocr",
    )


def _synthetic_curriculum_split_manifest() -> SplitManifest:
    return SplitManifest(
        manifest_version="curriculum_plan_split_manifest_synthetic_fixture_v1",
        corpus="curriculum",
        collection="curriculum_plan",
        raw_asset_id="asset:synthetic-curriculum-plan",
        documents=(
            SplitManifestDocument(
                document_id="curriculum:示例公共事务本科人才培养方案",
                title="示例公共事务本科人才培养方案",
                page_start=278,
                page_end=288,
            ),
            SplitManifestDocument(
                document_id="curriculum:示例数据系统本科人才培养方案",
                title="示例数据系统本科人才培养方案",
                page_start=289,
                page_end=297,
            ),
        ),
    )


class SplitManifestTest(unittest.TestCase):
    def test_student_handbook_repo_manifest_is_public_synthetic_shape(self) -> None:
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
        self.assertEqual(payload["raw_asset_id"], "asset:synthetic-student-handbook")
        self.assertIn("documents", payload)
        self.assertEqual(len(payload["documents"]), 5)
        self.assertEqual(payload["documents"][0]["title"], "Synthetic student status rule")
        self.assertEqual(payload["documents"][0]["handbook_section"], "Synthetic student rules")
        self.assertEqual(payload["documents"][-1]["title"], "Synthetic dormitory management rule")
        self.assertTrue(
            payload["documents"][-1]["source_uri"].startswith(
                "campus-agent://synthetic/regulations/student_rules/docs/"
            )
        )
        titles = {document["title"] for document in payload["documents"]}
        self.assertNotIn("synthetic-student-handbook", titles)

    def test_repo_curriculum_plan_manifest_is_public_synthetic_shape(self) -> None:
        manifest = load_split_manifest(
            Path("configs/ingestion/curriculum/curriculum_plan/split-manifest.v1.json"),
            expected_corpus="curriculum",
            expected_collection="curriculum_plan",
        )

        self.assertEqual(manifest.manifest_version, "curriculum_plan_split_manifest_v1")
        self.assertEqual(manifest.raw_asset_id, "asset:synthetic-curriculum-plan")
        self.assertEqual(len(manifest.documents), 2)
        self.assertEqual(
            manifest.documents[0].document_id, "curriculum:synthetic-public-affairs-plan"
        )
        self.assertEqual(manifest.documents[0].page_start, 278)
        self.assertEqual(manifest.documents[0].page_end, 288)
        self.assertEqual(manifest.documents[0].entitlement_groups, ())
        self.assertEqual(
            manifest.documents[1].document_id, "curriculum:synthetic-data-systems-plan"
        )
        self.assertEqual(manifest.documents[1].page_start, 289)
        self.assertEqual(manifest.documents[1].page_end, 297)
        self.assertEqual(manifest.documents[1].entitlement_groups, ("campus_members",))
        self.assertEqual(manifest.documents[1].visibility_scope, "campus")
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

    def test_repo_curriculum_plan_candidate_manifest_matches_formal_synthetic_inventory(
        self,
    ) -> None:
        formal = load_split_manifest(
            Path("configs/ingestion/curriculum/curriculum_plan/split-manifest.v1.json"),
            expected_corpus="curriculum",
            expected_collection="curriculum_plan",
        )
        candidate = load_split_manifest(
            Path("configs/ingestion/curriculum/curriculum_plan/split-manifest.candidate.v1.json"),
            expected_corpus="curriculum",
            expected_collection="curriculum_plan",
        )

        self.assertEqual(candidate.raw_asset_id, formal.raw_asset_id)
        self.assertEqual(candidate.documents, formal.documents)

    def test_load_split_manifest_rejects_overlapping_curriculum_page_ranges(self) -> None:
        with TemporaryDirectory() as temp_dir:
            path = Path(temp_dir) / "split-manifest.overlap.json"
            path.write_text(
                json.dumps(
                    {
                        "manifest_version": "curriculum_plan_split_manifest_v1",
                        "corpus": "curriculum",
                        "collection": "curriculum_plan",
                        "raw_asset_id": "asset:synthetic-curriculum-plan",
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

    def test_synthetic_curriculum_fixture_splits_cleanly_across_adjacent_documents(self) -> None:
        manifest = _synthetic_curriculum_split_manifest()
        documents = {document.document_id: document for document in manifest.documents}
        structured_rows = _load_layout_elements_rows(
            Path(
                "packages/ingestion-core/testdata/curriculum_plan/layout-elements.synthetic.jsonl"
            ).read_bytes()
        )
        self.assertEqual(structured_rows[0]["corpus"], "curriculum")
        self.assertEqual(structured_rows[0]["collection"], "curriculum_plan")
        raw_version_id = "sha256:0416e3d70c48d86238d2869c477ab60407ddbb9a09a76bee57aaeb0c97ab3f67"
        raw_asset_record = _curriculum_raw_asset_record(raw_version_id=raw_version_id)

        first_input = _build_split_manifest_document_input(
            raw_asset_record=raw_asset_record,
            manifest_version=manifest.manifest_version,
            manifest_document=documents["curriculum:示例公共事务本科人才培养方案"],
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
            manifest_document=documents["curriculum:示例数据系统本科人才培养方案"],
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

        self.assertEqual(first_rows[0]["doc_id"], "curriculum:示例公共事务本科人才培养方案")
        self.assertEqual(first_rows[0]["page_start"], 278)
        self.assertEqual(first_rows[0]["page_end"], 278)
        self.assertIn("示例公共事务本科人才培养方案", first_rows[0]["clean_text"])
        self.assertNotIn("示例数据系统本科人才培养方案", first_rows[0]["clean_text"])
        self.assertTrue(all(278 <= row["page_start"] <= 288 for row in first_rows))

        self.assertEqual(second_rows[0]["doc_id"], "curriculum:示例数据系统本科人才培养方案")
        self.assertEqual(second_rows[0]["page_start"], 289)
        self.assertEqual(second_rows[0]["page_end"], 289)
        self.assertIn("示例数据系统本科人才培养方案", second_rows[0]["clean_text"])
        self.assertNotIn("示例公共事务本科人才培养方案", second_rows[0]["clean_text"])
        self.assertTrue(all(289 <= row["page_start"] <= 297 for row in second_rows))


if __name__ == "__main__":
    unittest.main()
