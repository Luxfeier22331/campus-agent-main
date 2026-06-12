from __future__ import annotations

from tests.agent.knowledge_capability_test_support import (
    EvidenceBundle,
    EvidenceSource,
    KnowledgeCapability,
    unittest,
)


class KnowledgeCapabilityCurriculumSemesterSelectionTest(unittest.TestCase):
    def test_curriculum_semester_answer_keeps_general_and_core_sections_ahead_of_elective_duplicates(
        self,
    ) -> None:
        evidence = EvidenceBundle(
            query_text="历史学强基计划培养方案里第四学期有什么课",
            corpus="curriculum",
            collection="curriculum_plan",
            sources=(
                EvidenceSource(
                    doc_id="curriculum:历史学（强基计划）本科人才培养方案",
                    revision_track="source-faithful",
                    version_id="v1:history-general-education",
                    chunk_id="curriculum:历史学（强基计划）本科人才培养方案:chunk-0010",
                    anchor={"page_start": 93, "page_end": 93},
                    canonical_url="https://campus.example/curriculum/history-strong-base",
                    latest_url="https://campus.example/curriculum/history-strong-base",
                    source_channel="pdf_ocr",
                    collection="curriculum_plan",
                    is_current=False,
                    snippet=(
                        "五、课程设置和修读建议\n\n"
                        "(一)大类培养\n\n"
                        "1. 通识教育\n\n"
                        "课程清单如下:\n"
                        "类别 | 课程号 | 课程名称 | 学分 | 学时 | 实践学时 | 修读学期\n"
                        "思政课 | 1037010044 | 中华民族共同体概论 | 2 | 36 | 12 | 4\n"
                        "培养课 | 1042010082 | 大学英语(四) | 2 | 54 | 36 | 4"
                    ),
                    score=0.95,
                    source_title="历史学（强基计划）本科人才培养方案",
                    structural_path=(
                        "历史学（强基计划）本科人才培养方案",
                        "五、课程设置和修读建议",
                        "(一)大类培养",
                        "1. 通识教育",
                    ),
                    content_kind="table_unit",
                    content_role="table_fact",
                ),
                EvidenceSource(
                    doc_id="curriculum:历史学（强基计划）本科人才培养方案",
                    revision_track="source-faithful",
                    version_id="v1:history-core-courses",
                    chunk_id="curriculum:历史学（强基计划）本科人才培养方案:chunk-0014",
                    anchor={"page_start": 95, "page_end": 96},
                    canonical_url="https://campus.example/curriculum/history-strong-base",
                    latest_url="https://campus.example/curriculum/history-strong-base",
                    source_channel="pdf_ocr",
                    collection="curriculum_plan",
                    is_current=False,
                    snippet=(
                        "五、课程设置和修读建议\n\n"
                        "(二)专业教育\n\n"
                        "1. 专业核心课程\n"
                        "课程清单如下:\n"
                        "课程号 | 课程名称 | 学分 | 学时 | 实践学时 | 修读学期\n"
                        "1040030131 | 中国近代边疆民族史料研读 | 3 | 54 | 6 | 4\n"
                        "1040030127 | 世界现当代史 | 3 | 54 | / | 4\n"
                        "1040030019 | 西方史学史 | 2 | 36 | / | 4\n"
                        "1040030017 | 中国历史地理 | 2 | 36 | 4 | 4\n"
                        "1040030122 | 史学经典研读(三) | 1 | 18 | / | 4"
                    ),
                    score=0.97,
                    source_title="历史学（强基计划）本科人才培养方案",
                    structural_path=(
                        "历史学（强基计划）本科人才培养方案",
                        "五、课程设置和修读建议",
                        "(二)专业教育",
                        "1. 专业核心课程",
                    ),
                    content_kind="table_unit",
                    content_role="table_fact",
                ),
                EvidenceSource(
                    doc_id="curriculum:历史学（强基计划）本科人才培养方案",
                    revision_track="source-faithful",
                    version_id="v1:history-elective-courses",
                    chunk_id="curriculum:历史学（强基计划）本科人才培养方案:chunk-0018",
                    anchor={"page_start": 97, "page_end": 98},
                    canonical_url="https://campus.example/curriculum/history-strong-base",
                    latest_url="https://campus.example/curriculum/history-strong-base",
                    source_channel="pdf_ocr",
                    collection="curriculum_plan",
                    is_current=False,
                    snippet=(
                        "五、课程设置和修读建议\n\n"
                        "(二)专业教育\n\n"
                        "2. 专业选修课程\n\n"
                        "课程清单如下:\n"
                        "专业方向名称 | 课程号 | 课程名称 | 学分 | 学时 | 实践学时 | 开设学期\n"
                        "强基班 | 1040040061 | 满族史 | 2 | 36 | / | 4\n"
                        "强基班 | 1040040228 | 满文文献选读 | 2 | 36 | / | 4\n"
                        "强基班 | 1040040239 | 中国传统村落概要 | 2 | 36 | / | 4"
                    ),
                    score=0.96,
                    source_title="历史学（强基计划）本科人才培养方案",
                    structural_path=(
                        "历史学（强基计划）本科人才培养方案",
                        "五、课程设置和修读建议",
                        "(二)专业教育",
                        "2. 专业选修课程",
                    ),
                    content_kind="table_unit",
                    content_role="table_fact",
                ),
            ),
        )

        draft = KnowledgeCapability().build_answer(evidence)

        self.assertIn("大学英语(四)", draft.answer_text)
        self.assertIn("中国近代边疆民族史料研读", draft.answer_text)
        self.assertEqual(
            {source.chunk_id for source in draft.supporting_sources},
            {
                "curriculum:历史学（强基计划）本科人才培养方案:chunk-0010",
                "curriculum:历史学（强基计划）本科人才培养方案:chunk-0014",
            },
        )
