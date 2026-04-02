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
        acl_level="public",
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

        self.assertEqual(interpretation.normalized_query_text, "法学民族实验班培养方案里第四学期有什么课")
        self.assertEqual(interpretation.program_query_fragment, "法学民族实验班培养方案")
        self.assertEqual(interpretation.program_compact_key, "法学民族实验班")
        self.assertEqual(interpretation.semester_labels, ("第四学期",))
        self.assertEqual(interpretation.intent_kind, "course_list")

    def test_interpret_curriculum_query_supports_fifth_year_semester_alias(self) -> None:
        interpretation = interpret_curriculum_query("某培养方案里大五上有什么课")

        self.assertEqual(interpretation.normalized_query_text, "某培养方案里第九学期有什么课")
        self.assertEqual(interpretation.semester_labels, ("第九学期",))

    def test_query_targets_curriculum_source_title_accepts_alias_and_compact_title_match(self) -> None:
        self.assertTrue(
            query_targets_curriculum_source_title(
                query_text="法学民族班培养方案里大二下有什么课",
                source=_source(
                    doc_id="curriculum:法学（民族实验班）本科人才培养方案",
                    chunk_id="law-1",
                    snippet="第四学期 国际公法、知识产权法。",
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
                    snippet="第四学期 国际公法、知识产权法。",
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
        self.assertEqual(tuple(source.doc_id for source in scoped_sources), ("curriculum:法学（民族实验班）本科人才培养方案",))
        self.assertEqual(tuple(source.chunk_id for source in scoped_sources), ("law-4",))

    def test_filter_curriculum_query_sources_returns_empty_when_doc_is_resolved_but_semester_is_missing(self) -> None:
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


if __name__ == "__main__":
    unittest.main()
