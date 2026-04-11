from __future__ import annotations

import json
import unittest

import campus_ingestion_core.curriculum_program_semester_facts_projection as semester_projection
from campus_ingestion_core.curriculum_program_semester_facts_projection import (
    build_curriculum_program_semester_fact_document_id,
    build_curriculum_program_semester_facts_scope_refresh_documents,
)
from campus_ingestion_core.models import RawAssetRecord
from campus_ingestion_core.split_manifest import SplitManifestDocument


def _row(text: str, *, page_start: int, page_end: int | None = None) -> dict[str, object]:
    return {
        "clean_text": text,
        "page_start": page_start,
        "page_end": page_start if page_end is None else page_end,
    }


def _document_row(document: object) -> dict[str, object]:
    return json.loads(document.document_units_bytes.decode("utf-8").splitlines()[0])


class CurriculumProgramSemesterFactsProjectionTest(unittest.TestCase):
    def test_build_scope_refresh_documents_supports_canonical_materialization_without_source_artifact_keys(self) -> None:
        documents = build_curriculum_program_semester_facts_scope_refresh_documents(
            raw_asset_record=RawAssetRecord(
                raw_asset_id="asset:curriculum-plan-master-pdf",
                raw_version_id="sha256:program-semester-facts-000",
                corpus="curriculum",
                collection="curriculum_plan",
                raw_source_uri="campusrag://source/curriculum/curriculum-plan.pdf",
                content_hash="program-semester-facts-000",
                source_filename="curriculum-plan.pdf",
                object_key="official_pdf/curriculum-plan-master/provider-response.jsonl",
                ingestion_timestamp="2026-04-06T00:00:00+00:00",
                import_source="provider_response_replay",
            ),
            source_pdf="curriculum-plan.pdf",
            split_manifest_documents=(
                SplitManifestDocument(
                    document_id="curriculum:法学（民族实验班）本科人才培养方案",
                    title="法学（民族实验班）本科人才培养方案",
                    page_start=1,
                    page_end=1,
                ),
            ),
            structured_rows=(
                _row(
                    (
                        "<table><tr><td>课程名称</td><td>修读学期</td></tr>"
                        "<tr><td>习近平法治思想概论</td><td>1</td></tr></table>"
                    ),
                    page_start=1,
                ),
            ),
            provider_response_key=None,
            layout_elements_key=None,
        )

        self.assertEqual(len(documents), 1)
        document = documents[0]
        self.assertIsNone(document.provider_response_object_key)
        self.assertEqual(document.additional_processed_object_keys, ())
        self.assertNotIn("None#", document.source_label)

    def test_build_scope_refresh_documents_emits_program_semester_projection_rows(self) -> None:
        documents = build_curriculum_program_semester_facts_scope_refresh_documents(
            raw_asset_record=RawAssetRecord(
                raw_asset_id="asset:curriculum-plan-master-pdf",
                raw_version_id="sha256:program-semester-facts-001",
                corpus="curriculum",
                collection="curriculum_plan",
                raw_source_uri="campusrag://source/curriculum/curriculum-plan.pdf",
                content_hash="program-semester-facts-001",
                source_filename="curriculum-plan.pdf",
                object_key="official_pdf/curriculum-plan-master/provider-response.jsonl",
                ingestion_timestamp="2026-04-06T00:00:00+00:00",
                import_source="provider_response_replay",
            ),
            source_pdf="curriculum-plan.pdf",
            split_manifest_documents=(
                SplitManifestDocument(
                    document_id="curriculum:法学（民族实验班）本科人才培养方案",
                    title="法学（民族实验班）本科人才培养方案",
                    page_start=1,
                    page_end=2,
                ),
            ),
            structured_rows=(
                _row(
                    (
                        "五、课程设置和修读建议\n"
                        "课程清单如下:\n"
                        "专业方向 | 课程号 | 课程名称 | 学分 | 学时 | 实践学时 | 开设学期\n"
                        "民族班 | 1036030166 | 习近平法治思想概论 | 2 | 36 | / | 1\n"
                        "民族班 | 1036030001 | 法学导论 | 2 | 36 | / | 1"
                    ),
                    page_start=1,
                ),
                _row(
                    (
                        "五、课程设置和修读建议\n"
                        "课程清单如下:\n"
                        "专业方向 | 课程号 | 课程名称 | 学分 | 学时 | 实践学时 | 开设学期\n"
                        "民族班 | 1036040175 | 侵权责任法 | 2 | 36 | / | 4\n"
                        "民族班 | 1036040023 | 公司法 | 2 | 36 | / | 4\n"
                        "民族班 | 1036040201 | 翻译学导论 | 2 | 36 | / | 4"
                    ),
                    page_start=2,
                ),
            ),
            provider_response_key="derived/curriculum/provider-response.jsonl",
            layout_elements_key="derived/curriculum/layout-elements.jsonl",
        )

        self.assertEqual(
            [_document_row(document)["doc_id"] for document in documents],
            [
                build_curriculum_program_semester_fact_document_id(
                    "curriculum:法学（民族实验班）本科人才培养方案",
                    "第一学期",
                ),
                build_curriculum_program_semester_fact_document_id(
                    "curriculum:法学（民族实验班）本科人才培养方案",
                    "第四学期",
                ),
            ],
        )
        self.assertEqual([document.collection for document in documents], ["program_semester_facts", "program_semester_facts"])
        self.assertEqual(
            [document.title for document in documents],
            [
                "法学（民族实验班）本科人才培养方案 第一学期课程事实",
                "法学（民族实验班）本科人才培养方案 第四学期课程事实",
            ],
        )

        first_row = _document_row(documents[1])
        self.assertEqual(first_row["metadata"]["source_doc_id"], "curriculum:法学（民族实验班）本科人才培养方案")
        self.assertEqual(first_row["metadata"]["semester_label"], "第四学期")
        self.assertEqual(first_row["metadata"]["course_titles"], ["侵权责任法", "公司法", "翻译学导论"])
        self.assertEqual(first_row["metadata"]["content_role"], "semester_course_list")
        self.assertTrue(first_row["metadata"]["is_answer_bearing"])
        self.assertIn("第四学期有侵权责任法、公司法、翻译学导论", first_row["clean_text"])

    def test_build_scope_refresh_documents_supports_numeric_semester_distribution_columns(self) -> None:
        documents = build_curriculum_program_semester_facts_scope_refresh_documents(
            raw_asset_record=RawAssetRecord(
                raw_asset_id="asset:curriculum-plan-master-pdf",
                raw_version_id="sha256:program-semester-facts-002",
                corpus="curriculum",
                collection="curriculum_plan",
                raw_source_uri="campusrag://source/curriculum/curriculum-plan.pdf",
                content_hash="program-semester-facts-002",
                source_filename="curriculum-plan.pdf",
                object_key="official_pdf/curriculum-plan-master/provider-response.jsonl",
                ingestion_timestamp="2026-04-06T00:00:00+00:00",
                import_source="provider_response_replay",
            ),
            source_pdf="curriculum-plan.pdf",
            split_manifest_documents=(
                SplitManifestDocument(
                    document_id="curriculum:民族学本科第二学士学位人才培养方案",
                    title="民族学本科第二学士学位人才培养方案",
                    page_start=10,
                    page_end=10,
                ),
            ),
            structured_rows=(
                _row(
                    (
                        "八、民族学本科专业教学进程计划表\n"
                        "课程类别 | — | 课程编号 | 课程名称 | 学分 | 总计 | 其中实践 | 1 | 2 | 3 | 4\n"
                        "专业教育 | 专业必修课共30学分 | 1026030031 | 民族学导论 | 2 | 36 | — | 2\n"
                        "专业教育 | 专业必修课共30学分 | 1026030067 | 人类学导论 | 2 | 36 | — | — | 2\n"
                        "专业教育 | 专业必修课共30学分 | 1026030081 | 民族学田野调查方法 | 2 | 36 | 9 | — | 2\n"
                        "专业教育 | 专业必修课共30学分 | 1026030047 | 民族学人类学经典导读 | 2 | 36 | — | — | — | — | 2"
                    ),
                    page_start=10,
                ),
            ),
            provider_response_key="derived/curriculum/provider-response.jsonl",
            layout_elements_key="derived/curriculum/layout-elements.jsonl",
        )

        second_semester = next(
            document
            for document in documents
            if _document_row(document)["doc_id"]
            == build_curriculum_program_semester_fact_document_id(
                "curriculum:民族学本科第二学士学位人才培养方案",
                "第二学期",
            )
        )
        row = _document_row(second_semester)
        self.assertEqual(
            row["metadata"]["course_titles"],
            ["人类学导论", "民族学田野调查方法"],
        )

        fourth_semester = next(
            document
            for document in documents
            if _document_row(document)["doc_id"]
            == build_curriculum_program_semester_fact_document_id(
                "curriculum:民族学本科第二学士学位人才培养方案",
                "第四学期",
            )
        )
        self.assertEqual(
            _document_row(fourth_semester)["metadata"]["course_titles"],
            ["民族学人类学经典导读"],
        )

    def test_projection_module_exposes_canonical_scope_materialization_entrypoint(self) -> None:
        materialize = getattr(
            semester_projection,
            "materialize_curriculum_program_semester_facts_from_canonical_scope",
            None,
        )
        self.assertIsNotNone(materialize)


if __name__ == "__main__":
    unittest.main()
