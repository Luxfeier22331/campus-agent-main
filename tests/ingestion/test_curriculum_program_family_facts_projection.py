from __future__ import annotations

import json
import unittest

from campus_ingestion_core.curriculum_program_family_facts_projection import (
    build_curriculum_program_family_facts_scope_refresh_documents,
)
from campus_ingestion_core.models import RawAssetRecord
from campus_ingestion_core.split_manifest import SplitManifestDocument


class CurriculumProgramFamilyFactsProjectionTest(unittest.TestCase):
    def test_build_scope_refresh_documents_emits_direct_answer_family_facts(self) -> None:
        documents = build_curriculum_program_family_facts_scope_refresh_documents(
            raw_asset_record=RawAssetRecord(
                raw_asset_id="asset:curriculum-plan-master-pdf",
                raw_version_id="sha256:program-family-facts-001",
                corpus="curriculum",
                collection="curriculum_plan",
                raw_source_uri="campusrag://source/curriculum/curriculum-plan.pdf",
                content_hash="program-family-facts-001",
                source_filename="curriculum-plan.pdf",
                object_key="official_pdf/curriculum-plan-master/provider-response.jsonl",
                ingestion_timestamp="2026-04-02T00:00:00+00:00",
                import_source="provider_response_replay",
            ),
            source_pdf="curriculum-plan.pdf",
            split_manifest_documents=(
                SplitManifestDocument(
                    document_id="curriculum:法学（民族实验班）本科人才培养方案",
                    title="法学（民族实验班）本科人才培养方案",
                    page_start=1,
                    page_end=10,
                ),
                SplitManifestDocument(
                    document_id="curriculum:信息与计算科学（民族实验班）本科人才培养方案",
                    title="信息与计算科学（民族实验班）本科人才培养方案",
                    page_start=11,
                    page_end=20,
                ),
                SplitManifestDocument(
                    document_id="curriculum:计算机科学与技术（民族实验班）本科人才培养方案",
                    title="计算机科学与技术（民族实验班）本科人才培养方案",
                    page_start=21,
                    page_end=30,
                ),
                SplitManifestDocument(
                    document_id="curriculum:历史学（强基计划）本科人才培养方案",
                    title="历史学（强基计划）本科人才培养方案",
                    page_start=31,
                    page_end=40,
                ),
                SplitManifestDocument(
                    document_id="curriculum:哲学（强基计划）本科人才培养方案",
                    title="哲学（强基计划）本科人才培养方案",
                    page_start=41,
                    page_end=50,
                ),
                SplitManifestDocument(
                    document_id="curriculum:中国少数民族语言文学（古文字学方向）强基计划本科人才培养方案",
                    title="中国少数民族语言文学（古文字学方向）强基计划本科人才培养方案",
                    page_start=51,
                    page_end=60,
                ),
                SplitManifestDocument(
                    document_id="curriculum:孝通实验班本科人才培养方案",
                    title="孝通实验班本科人才培养方案",
                    page_start=61,
                    page_end=70,
                ),
                SplitManifestDocument(
                    document_id="curriculum:理工科交叉创新人才培养实验班本科人才培养方案",
                    title="理工科交叉创新人才培养实验班本科人才培养方案",
                    page_start=71,
                    page_end=80,
                ),
                SplitManifestDocument(
                    document_id="curriculum:光电科学与工程创新实验班本科人才培养方案",
                    title="光电科学与工程创新实验班本科人才培养方案",
                    page_start=81,
                    page_end=90,
                ),
                SplitManifestDocument(
                    document_id="curriculum:经济学拔尖人才创新班人才培养方案",
                    title="经济学拔尖人才创新班人才培养方案",
                    page_start=91,
                    page_end=100,
                ),
                SplitManifestDocument(
                    document_id="curriculum:民族学本科第二学士学位人才培养方案",
                    title="民族学本科第二学士学位人才培养方案",
                    page_start=101,
                    page_end=110,
                ),
                SplitManifestDocument(
                    document_id="curriculum:社会学本科第二学士学位人才培养方案",
                    title="社会学本科第二学士学位人才培养方案",
                    page_start=111,
                    page_end=120,
                ),
                SplitManifestDocument(
                    document_id="curriculum:文物与博物馆学本科第二学士学位人才培养方案",
                    title="文物与博物馆学本科第二学士学位人才培养方案",
                    page_start=121,
                    page_end=130,
                ),
                SplitManifestDocument(
                    document_id="curriculum:金融学本科第二学士学位人才培养方案",
                    title="金融学本科第二学士学位人才培养方案",
                    page_start=131,
                    page_end=140,
                ),
                SplitManifestDocument(
                    document_id="curriculum:会计学本科第二学士学位人才培养方案",
                    title="会计学本科第二学士学位人才培养方案",
                    page_start=141,
                    page_end=150,
                ),
                SplitManifestDocument(
                    document_id="curriculum:法学本科第二学士学位人才培养方案",
                    title="法学本科第二学士学位人才培养方案",
                    page_start=151,
                    page_end=160,
                ),
                SplitManifestDocument(
                    document_id="curriculum:环境工程本科第二学士学位人才培养方案",
                    title="环境工程本科第二学士学位人才培养方案",
                    page_start=161,
                    page_end=170,
                ),
                SplitManifestDocument(
                    document_id="curriculum:数据科学与大数据技术本科第二学士学位人才培养方案",
                    title="数据科学与大数据技术本科第二学士学位人才培养方案",
                    page_start=171,
                    page_end=180,
                ),
                SplitManifestDocument(
                    document_id="curriculum:教育学本科第二学士学位人才培养方案",
                    title="教育学本科第二学士学位人才培养方案",
                    page_start=181,
                    page_end=190,
                ),
            ),
        )

        self.assertEqual(
            [document.collection for document in documents],
            [
                "program_family_facts",
                "program_family_facts",
                "program_family_facts",
                "program_family_facts",
                "program_family_facts",
                "program_family_facts",
            ],
        )
        self.assertEqual(
            [document.title for document in documents],
            [
                "中央民族大学民族班项目一览",
                "中央民族大学基地班项目一览",
                "中央民族大学强基计划项目一览",
                "中央民族大学第二学士学位项目一览",
                "中央民族大学实验班相关培养方案一览",
                "中央民族大学创新班相关培养方案一览",
            ],
        )

    def test_scope_refresh_document_units_embed_program_family_semantics_in_metadata(self) -> None:
        documents = build_curriculum_program_family_facts_scope_refresh_documents(
            raw_asset_record=RawAssetRecord(
                raw_asset_id="asset:curriculum-plan-master-pdf",
                raw_version_id="sha256:program-family-facts-001",
                corpus="curriculum",
                collection="curriculum_plan",
                raw_source_uri="campusrag://source/curriculum/curriculum-plan.pdf",
                content_hash="program-family-facts-001",
                source_filename="curriculum-plan.pdf",
                object_key="official_pdf/curriculum-plan-master/provider-response.jsonl",
                ingestion_timestamp="2026-04-02T00:00:00+00:00",
                import_source="provider_response_replay",
            ),
            source_pdf="curriculum-plan.pdf",
            split_manifest_documents=(
                SplitManifestDocument(
                    document_id="curriculum:法学（民族实验班）本科人才培养方案",
                    title="法学（民族实验班）本科人才培养方案",
                    page_start=1,
                    page_end=10,
                ),
                SplitManifestDocument(
                    document_id="curriculum:信息与计算科学（民族实验班）本科人才培养方案",
                    title="信息与计算科学（民族实验班）本科人才培养方案",
                    page_start=11,
                    page_end=20,
                ),
                SplitManifestDocument(
                    document_id="curriculum:计算机科学与技术（民族实验班）本科人才培养方案",
                    title="计算机科学与技术（民族实验班）本科人才培养方案",
                    page_start=21,
                    page_end=30,
                ),
            ),
        )

        first_row = json.loads(documents[0].document_units_bytes.decode("utf-8").splitlines()[0])

        self.assertIn("metadata", first_row)
        self.assertEqual(
            first_row["metadata"]["canonical_program_family_id"],
            "program_family:muc.ethnic_experimental_class",
        )
        self.assertEqual(first_row["metadata"]["content_role"], "family_membership")
        self.assertEqual(first_row["metadata"]["detail_label"], "成员专业")
        self.assertEqual(
            first_row["metadata"]["member_program_titles"],
            ["法学", "信息与计算科学", "计算机科学与技术"],
        )
        self.assertTrue(first_row["metadata"]["is_answer_bearing"])


if __name__ == "__main__":
    unittest.main()
