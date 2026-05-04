from __future__ import annotations

import unittest

from campus_contracts import EvidenceSource
from campus_retrieval_core.curriculum_query_resolution import (
    filter_curriculum_query_sources,
    interpret_curriculum_query,
    query_targets_curriculum_source_title,
)


def _source(
    *,
    doc_id: str,
    chunk_id: str,
    snippet: str,
    score: float,
    source_title: str,
    structural_path: tuple[str, ...] = (),
    detail_label: str = "",
) -> EvidenceSource:
    return EvidenceSource(
        doc_id=doc_id,
        revision_track="source-faithful",
        version_id="v1:test",
        chunk_id=chunk_id,
        anchor={"page_start": 1, "page_end": 1},
        canonical_url="https://campus.example/doc",
        latest_url="https://campus.example/doc",
        source_channel="pdf_ocr",
        collection="curriculum_plan",
        is_current=True,
        snippet=snippet,
        score=score,
        source_title=source_title,
        structural_path=structural_path,
        detail_label=detail_label,
        content_kind="table_unit",
        content_role="table_fact",
        is_answer_bearing=True,
    )


class CurriculumQueryResolutionTest(unittest.TestCase):
    def test_interpret_curriculum_query_normalizes_alias_and_semester(self) -> None:
        interpretation = interpret_curriculum_query("法学民族班培养方案里大二下有什么课")

        self.assertEqual(
            interpretation.normalized_query_text, "法学民族实验班培养方案里第四学期有什么课"
        )
        self.assertEqual(interpretation.program_query_fragment, "法学民族实验班培养方案")
        self.assertEqual(interpretation.program_compact_key, "法学民族实验班")
        self.assertEqual(interpretation.semester_labels, ("第四学期",))
        self.assertEqual(interpretation.intent_kind, "course_list")

    def test_interpret_curriculum_query_marks_course_map_as_structured_lookup(self) -> None:
        interpretation = interpret_curriculum_query(
            "经济学拔尖人才创新班人才培养方案课程地图怎么安排？"
        )

        self.assertEqual(
            interpretation.program_query_fragment,
            "经济学拔尖人才创新班人才培养方案",
        )
        self.assertEqual(interpretation.intent_kind, "curriculum_lookup")
        self.assertEqual(interpretation.curriculum_lookup_target, "course_map")

    def test_interpret_curriculum_query_extracts_implementation_plan_title(self) -> None:
        interpretation = interpret_curriculum_query("中央民族大学大学生社会实践环节实施方案")

        self.assertEqual(
            interpretation.program_query_fragment,
            "中央民族大学大学生社会实践环节实施方案",
        )
        self.assertEqual(
            interpretation.program_compact_key,
            "中央民族大学大学生社会实践环节实施",
        )

    def test_interpret_curriculum_query_marks_course_settings_and_study_advice_as_structured_lookup(
        self,
    ) -> None:
        for query_text, expected_target in (
            ("法学民族实验班培养方案课程设置怎么安排", "course_settings"),
            ("法学民族实验班培养方案修读建议怎么安排", "study_advice"),
        ):
            with self.subTest(query_text=query_text):
                interpretation = interpret_curriculum_query(query_text)
                self.assertEqual(interpretation.intent_kind, "curriculum_lookup")
                self.assertEqual(interpretation.curriculum_lookup_target, expected_target)

    def test_interpret_curriculum_query_supports_fifth_year_semester_alias(self) -> None:
        interpretation = interpret_curriculum_query("某培养方案里大五上有什么课")

        self.assertEqual(interpretation.normalized_query_text, "某培养方案里第九学期有什么课")
        self.assertEqual(interpretation.semester_labels, ("第九学期",))

    def test_query_targets_curriculum_source_title_accepts_alias_and_compact_title_match(
        self,
    ) -> None:
        self.assertTrue(
            query_targets_curriculum_source_title(
                query_text="法学民族班培养方案里大二下有什么课",
                source=_source(
                    doc_id="curriculum:法学（民族实验班）本科人才培养方案",
                    chunk_id="law-1",
                    snippet="第四学期 侵权责任法、中国少数民族文字学。",
                    score=0.92,
                    source_title="法学（民族实验班）本科人才培养方案",
                    structural_path=("法学（民族实验班）本科人才培养方案", "第四学期"),
                    detail_label="第四学期",
                ),
            )
        )

    def test_filter_curriculum_query_sources_locks_to_unique_doc_and_semester(self) -> None:
        scoped_sources, scope_applied = filter_curriculum_query_sources(
            query_text="法学民族班培养方案里大二下有什么课",
            sources=(
                _source(
                    doc_id="curriculum:法学（民族实验班）本科人才培养方案",
                    chunk_id="law-4",
                    snippet="第四学期 侵权责任法、中国少数民族文字学。",
                    score=0.92,
                    source_title="法学（民族实验班）本科人才培养方案",
                    structural_path=("法学（民族实验班）本科人才培养方案", "第四学期"),
                    detail_label="第四学期",
                ),
                _source(
                    doc_id="curriculum:法学（民族实验班）本科人才培养方案",
                    chunk_id="law-3",
                    snippet="第三学期 民法总论、宪法学。",
                    score=0.89,
                    source_title="法学（民族实验班）本科人才培养方案",
                    structural_path=("法学（民族实验班）本科人才培养方案", "第三学期"),
                    detail_label="第三学期",
                ),
                _source(
                    doc_id="curriculum:信息与计算科学（民族实验班）本科人才培养方案",
                    chunk_id="ics-4",
                    snippet="第四学期 常微分方程、概率论。",
                    score=0.88,
                    source_title="信息与计算科学（民族实验班）本科人才培养方案",
                    structural_path=("信息与计算科学（民族实验班）本科人才培养方案", "第四学期"),
                    detail_label="第四学期",
                ),
            ),
        )

        self.assertTrue(scope_applied)
        self.assertEqual(
            tuple(source.doc_id for source in scoped_sources),
            ("curriculum:法学（民族实验班）本科人才培养方案",),
        )
        self.assertEqual(tuple(source.chunk_id for source in scoped_sources), ("law-4",))

    def test_filter_curriculum_query_sources_returns_empty_when_doc_is_resolved_but_semester_is_missing(
        self,
    ) -> None:
        scoped_sources, scope_applied = filter_curriculum_query_sources(
            query_text="法学民族班培养方案里大二下有什么课",
            sources=(
                _source(
                    doc_id="curriculum:法学（民族实验班）本科人才培养方案",
                    chunk_id="law-3",
                    snippet="第三学期 民法总论、宪法学。",
                    score=0.89,
                    source_title="法学（民族实验班）本科人才培养方案",
                    structural_path=("法学（民族实验班）本科人才培养方案", "第三学期"),
                    detail_label="第三学期",
                ),
            ),
        )

        self.assertTrue(scope_applied)
        self.assertEqual(scoped_sources, ())

    def test_filter_curriculum_query_sources_accepts_numeric_semester_columns_in_tables(
        self,
    ) -> None:
        scoped_sources, scope_applied = filter_curriculum_query_sources(
            query_text="法学民族班培养方案里大一上有什么课",
            sources=(
                _source(
                    doc_id="curriculum:法学（民族实验班）本科人才培养方案",
                    chunk_id="law-1",
                    snippet=(
                        "五、课程设置和修读建议\n\n"
                        "(一)大类培养\n\n"
                        "2. 学科基础教育\n\n"
                        "课程清单如下:\n"
                        "专业方向 | 课程号 | 课程名称 | 学分 | 学时 | 实践学时 | 修读学期\n"
                        "民族班 | 1036030166 | 习近平法治思想概论 | 2 | 36 | / | 1\n"
                        "民族班 | 1036030001 | 法学导论 | 2 | 36 | / | 1"
                    ),
                    score=0.92,
                    source_title="法学（民族实验班）本科人才培养方案",
                    structural_path=(
                        "法学（民族实验班）本科人才培养方案",
                        "五、课程设置和修读建议",
                    ),
                ),
                _source(
                    doc_id="curriculum:法学（民族实验班）本科人才培养方案",
                    chunk_id="law-4",
                    snippet=(
                        "五、课程设置和修读建议\n\n"
                        "(二)专业教育\n\n"
                        "2. 专业选修课程\n\n"
                        "课程清单如下:\n"
                        "专业方向 | 课程号 | 课程名称 | 学分 | 学时 | 实践学时 | 开设学期\n"
                        "民族班 | 1036040175 | 侵权责任法 | 2 | 36 | / | 4\n"
                        "民族班 | 1036040023 | 公司法 | 2 | 36 | / | 4"
                    ),
                    score=0.91,
                    source_title="法学（民族实验班）本科人才培养方案",
                    structural_path=(
                        "法学（民族实验班）本科人才培养方案",
                        "五、课程设置和修读建议",
                    ),
                ),
            ),
        )

        self.assertTrue(scope_applied)
        self.assertEqual(tuple(source.chunk_id for source in scoped_sources), ("law-1",))


if __name__ == "__main__":
    unittest.main()
