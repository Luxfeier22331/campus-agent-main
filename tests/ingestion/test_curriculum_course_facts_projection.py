from __future__ import annotations

import json
import unittest

from campus_ingestion_core.curriculum_course_facts_projection import (
    build_curriculum_course_facts_scope_refresh_documents,
)
from campus_ingestion_core.models import RawAssetRecord
from campus_ingestion_core.split_manifest import SplitManifestDocument


def _row(text: str) -> dict[str, object]:
    return {"clean_text": text}


class CurriculumCourseFactsProjectionTest(unittest.TestCase):
    def test_build_scope_refresh_documents_emits_current_course_family_aliases(self) -> None:
        documents = build_curriculum_course_facts_scope_refresh_documents(
            raw_asset_record=RawAssetRecord(
                raw_asset_id="asset:curriculum-course-facts-master-pdf",
                raw_version_id="sha256:course-facts-001",
                corpus="curriculum",
                collection="curriculum_plan",
                raw_source_uri="campus-agent://source/curriculum/curriculum-plan.pdf",
                content_hash="course-facts-001",
                source_filename="synthetic-curriculum-plan.pdf",
                object_key="official_pdf/curriculum-plan-master/provider-response.jsonl",
                ingestion_timestamp="2026-04-03T00:00:00+00:00",
                import_source="provider_response_replay",
            ),
            source_pdf="synthetic-curriculum-plan.pdf",
            split_manifest_documents=(
                SplitManifestDocument(
                    document_id="curriculum:示例大学通识课程思想政治理论课教学计划",
                    title="示例大学通识课程思想政治理论课教学计划",
                    page_start=22,
                    page_end=36,
                ),
            ),
            structured_rows=(
                _row(
                    "学校除开设马克思主义基本原理、中国近现代史纲要、毛泽东思想和中国特色社会主义理论体系概论、"
                    "习近平新时代中国特色社会主义思想概论、思想道德与法治、形势与政策等6门思政课外，还开设一门特色思政课“中华民族共同体概论”。"
                ),
                _row(
                    "思想政治理论课为全校性公共必修课，所有本预科学生应认真完成上述7门课程设置的各教学环节。"
                ),
                _row("2. 历史学专业不开设“中国近现代史纲要”课程。"),
                {
                    "clean_text": (
                        "<table><tr><td>课程名称</td><td>学分</td><td>学时</td><td>理论/实践学时</td><td>开设学期</td></tr>"
                        "<tr><td>马克思主义基本原理</td><td>3</td><td>54</td><td>36</td><td>第3学期(文科)</td></tr>"
                        "<tr><td>毛泽东思想和中国特色社会主义理论体系概论</td><td>3</td><td>54</td><td>36</td><td>第5学期(文科)</td></tr>"
                        "<tr><td>中国近现代史纲要</td><td>3</td><td>54</td><td>36</td><td>第1学期(文科)</td></tr>"
                        "<tr><td>思想道德与法治</td><td>3</td><td>54</td><td>36</td><td>第2学期(文科)</td></tr>"
                        "<tr><td>形势与政策</td><td>2</td><td>64</td><td>46</td><td>1-8学期</td></tr>"
                        "<tr><td>习近平新时代中国特色社会主义思想概论</td><td>3</td><td>54</td><td>36</td><td>第2学期(文科)</td></tr>"
                        "<tr><td>中华民族共同体概论</td><td>2</td><td>36</td><td>24</td><td>第4学期(文科)</td></tr></table>"
                    )
                },
            ),
            provider_response_key="derived/curriculum/provider-response.jsonl",
            layout_elements_key="derived/curriculum/layout-elements.jsonl",
        )

        self.assertTrue(documents)
        family_document = next(
            document for document in documents if document.title == "思想政治理论课课程事实"
        )
        row = json.loads(family_document.document_units_bytes.decode("utf-8").splitlines()[0])

        self.assertEqual(
            row["metadata"]["family_aliases"],
            ["思政课", "思修课", "思政", "思政课程"],
        )
        self.assertEqual(
            row["metadata"]["canonical_course_family_id"],
            "course_family:muc.ideological_political_theory",
        )


if __name__ == "__main__":
    unittest.main()
