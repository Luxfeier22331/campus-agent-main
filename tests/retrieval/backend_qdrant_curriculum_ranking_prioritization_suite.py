from __future__ import annotations

from tests.retrieval.backend_qdrant_test_support import (
    _make_source,
    prioritize_evidence_sources,
    select_supporting_evidence_sources,
    unittest,
)


class BackendQdrantCurriculumRankingPrioritizationTest(unittest.TestCase):
    def test_prioritize_evidence_sources_prefers_exact_curriculum_title_over_longer_superset(
        self,
    ) -> None:
        ranked = prioritize_evidence_sources(
            query_text="民族学本科人才培养方案",
            sources=(
                _make_source(
                    doc_id="curriculum:民族学本科第二学士学位人才培养方案",
                    chunk_id="curriculum:ethnology-second-degree:chunk-0001",
                    snippet="民族学本科第二学士学位人才培养方案 一、培养目标。",
                    score=0.7,
                ),
                _make_source(
                    doc_id="curriculum:民族学本科人才培养方案",
                    chunk_id="curriculum:ethnology:chunk-0001",
                    snippet="民族学本科人才培养方案 一、培养目标。",
                    score=0.4761905,
                ),
            ),
        )

        self.assertEqual(ranked[0].doc_id, "curriculum:民族学本科人才培养方案")

    def test_prioritize_evidence_sources_prefers_curriculum_fact_chunk_for_short_fact_query(
        self,
    ) -> None:
        ranked = prioritize_evidence_sources(
            query_text="民族学本科第二学士学位人才培养方案学制几年？",
            sources=(
                _make_source(
                    doc_id="curriculum:民族学本科第二学士学位人才培养方案",
                    chunk_id="curriculum:ethnology-second-degree:chunk-0001",
                    snippet="民族学本科第二学士学位人才培养方案 一、培养目标。",
                    score=0.9,
                ),
                _make_source(
                    doc_id="curriculum:法学本科第二学士学位人才培养方案",
                    chunk_id="curriculum:law-second-degree:chunk-0005",
                    snippet="三、学制、总学分和学位授予 学制:2年 总学分:60学分。",
                    score=0.82,
                ),
                _make_source(
                    doc_id="curriculum:教育学本科第二学士学位人才培养方案",
                    chunk_id="curriculum:education-second-degree:chunk-0005",
                    snippet="三、学制、总学分和学位授予 学制:2年 总学分:60学分。",
                    score=0.81,
                ),
                _make_source(
                    doc_id="curriculum:民族学本科第二学士学位人才培养方案",
                    chunk_id="curriculum:ethnology-second-degree:chunk-0005",
                    snippet="三、学制、总学分和学位授予 学制:2年 总学分:60学分。",
                    score=0.78,
                ),
            ),
        )

        self.assertEqual(ranked[0].chunk_id, "curriculum:ethnology-second-degree:chunk-0005")

    def test_prioritize_evidence_sources_prefers_named_curriculum_document_over_other_docs_fact_chunks(
        self,
    ) -> None:
        ranked = prioritize_evidence_sources(
            query_text="民族学本科第二学士学位人才培养方案学制几年？",
            sources=(
                _make_source(
                    doc_id="curriculum:教育学本科第二学士学位人才培养方案",
                    chunk_id="curriculum:education-second-degree:chunk-0005",
                    snippet="三、学制、总学分和学位授予 学制:2年 总学分:60学分。",
                    score=0.82,
                ),
                _make_source(
                    doc_id="curriculum:应用统计学本科专业第二学位人才培养方案",
                    chunk_id="curriculum:stats-second-degree:chunk-0005",
                    snippet="三、学制、总学分和学位授予 学制:2年 总学分:48.5学分。",
                    score=0.81,
                ),
                _make_source(
                    doc_id="curriculum:民族学本科第二学士学位人才培养方案",
                    chunk_id="curriculum:ethnology-second-degree:chunk-0001",
                    snippet="民族学本科第二学士学位人才培养方案 一、培养目标。",
                    score=0.49,
                ),
            ),
        )

        self.assertEqual(ranked[0].doc_id, "curriculum:民族学本科第二学士学位人才培养方案")

    def test_prioritize_evidence_sources_prefers_same_document_academic_years_chunk_over_generic_tables(
        self,
    ) -> None:
        ranked = prioritize_evidence_sources(
            query_text="民族学本科第二学士学位人才培养方案学制几年？",
            sources=(
                _make_source(
                    doc_id="curriculum:民族学本科第二学士学位人才培养方案",
                    chunk_id="curriculum:ethnology-second-degree:chunk-0007",
                    snippet="七、各教学环节学时学分分配表 合计 56 学分。",
                    score=0.015873017,
                    source_title="民族学本科第二学士学位人才培养方案",
                    structural_path=(
                        "民族学本科第二学士学位人才培养方案",
                        "七、各教学环节学时学分分配表",
                    ),
                    content_kind="table_unit",
                    content_role="table_fact",
                ),
                _make_source(
                    doc_id="curriculum:民族学本科第二学士学位人才培养方案",
                    chunk_id="curriculum:ethnology-second-degree:chunk-0010",
                    snippet="八、民族学本科专业教学进程计划表 社会研究方法。",
                    score=0.014925373,
                    source_title="民族学本科第二学士学位人才培养方案",
                    structural_path=(
                        "民族学本科第二学士学位人才培养方案",
                        "八、民族学本科专业教学进程计划表",
                    ),
                    content_kind="table_unit",
                    content_role="table_fact",
                ),
                _make_source(
                    doc_id="curriculum:民族学本科第二学士学位人才培养方案",
                    chunk_id="curriculum:ethnology-second-degree:chunk-0005",
                    snippet="五、学制 两年",
                    score=0.033333335,
                    source_title="民族学本科第二学士学位人才培养方案",
                    structural_path=("民族学本科第二学士学位人才培养方案", "五、学制 两年"),
                    content_kind="section_text",
                    detail_label="五、学制",
                    is_answer_bearing=True,
                ),
            ),
        )

        self.assertEqual(ranked[0].chunk_id, "curriculum:ethnology-second-degree:chunk-0005")

    def test_prioritize_evidence_sources_prefers_same_document_course_map_chunk_over_generic_tables(
        self,
    ) -> None:
        ranked = prioritize_evidence_sources(
            query_text="经济学拔尖人才创新班人才培养方案课程地图怎么安排？",
            sources=(
                _make_source(
                    doc_id="curriculum:经济学拔尖人才创新班人才培养方案",
                    chunk_id="curriculum:economics-innovation:chunk-0013",
                    snippet="五、课程设置和修读建议 1. 专业核心课程 经济学说史。",
                    score=0.032002047,
                    source_title="经济学拔尖人才创新班人才培养方案",
                    structural_path=(
                        "经济学拔尖人才创新班人才培养方案",
                        "五、课程设置和修读建议",
                        "(二) 专业教育",
                        "1. 专业核心课程",
                    ),
                    content_kind="table_unit",
                    content_role="table_fact",
                ),
                _make_source(
                    doc_id="curriculum:经济学拔尖人才创新班人才培养方案",
                    chunk_id="curriculum:economics-innovation:chunk-0014",
                    snippet="五、课程设置和修读建议 2. 专业选修课程 中国近现代经济史。",
                    score=0.031257633,
                    source_title="经济学拔尖人才创新班人才培养方案",
                    structural_path=(
                        "经济学拔尖人才创新班人才培养方案",
                        "五、课程设置和修读建议",
                        "(二) 专业教育",
                        "2. 专业选修课程",
                    ),
                    content_kind="table_unit",
                    content_role="table_fact",
                ),
                _make_source(
                    doc_id="curriculum:经济学拔尖人才创新班人才培养方案",
                    chunk_id="curriculum:economics-innovation:chunk-0023",
                    snippet="六、课程地图 经济学拔尖人才创新班本科课程结果拓扑图",
                    score=0.033333335,
                    source_title="经济学拔尖人才创新班人才培养方案",
                    structural_path=("经济学拔尖人才创新班人才培养方案", "六、课程地图"),
                    content_kind="section_text",
                    detail_label="六、课程地图",
                    is_answer_bearing=True,
                ),
            ),
        )

        self.assertEqual(ranked[0].chunk_id, "curriculum:economics-innovation:chunk-0023")

    def test_select_supporting_evidence_sources_fail_closes_course_map_lookup(self) -> None:
        selected = select_supporting_evidence_sources(
            query_text="经济学拔尖人才创新班人才培养方案课程地图怎么安排？",
            max_sources=3,
            sources=(
                _make_source(
                    doc_id="curriculum:经济学拔尖人才创新班人才培养方案",
                    chunk_id="curriculum:economics-innovation:chunk-0023",
                    snippet="六、课程地图 经济学拔尖人才创新班本科课程结果拓扑图。",
                    score=0.99,
                    source_title="经济学拔尖人才创新班人才培养方案",
                    structural_path=("经济学拔尖人才创新班人才培养方案", "六、课程地图"),
                    content_kind="section_text",
                    detail_label="六、课程地图",
                    is_answer_bearing=True,
                ),
                _make_source(
                    doc_id="curriculum:经济学拔尖人才创新班人才培养方案",
                    chunk_id="curriculum:economics-innovation:chunk-0014",
                    snippet="五、课程设置和修读建议 2. 专业选修课程 中国近现代经济史。",
                    score=0.98,
                    source_title="经济学拔尖人才创新班人才培养方案",
                    structural_path=(
                        "经济学拔尖人才创新班人才培养方案",
                        "五、课程设置和修读建议",
                        "(二) 专业教育",
                        "2. 专业选修课程",
                    ),
                    content_kind="table_unit",
                    content_role="table_fact",
                ),
                _make_source(
                    doc_id="curriculum:经济学拔尖人才创新班人才培养方案",
                    chunk_id="curriculum:economics-innovation:chunk-0015",
                    snippet="五、课程设置和修读建议 2. 专业选修课程 发展经济学专题。",
                    score=0.97,
                    source_title="经济学拔尖人才创新班人才培养方案",
                    structural_path=(
                        "经济学拔尖人才创新班人才培养方案",
                        "五、课程设置和修读建议",
                        "(二) 专业教育",
                        "2. 专业选修课程",
                    ),
                    content_kind="table_unit",
                    content_role="table_fact",
                ),
                _make_source(
                    doc_id="curriculum:经济学拔尖人才创新班人才培养方案",
                    chunk_id="curriculum:economics-innovation:chunk-0013",
                    snippet="五、课程设置和修读建议 1. 专业核心课程 专业核心课程 30 学分。",
                    score=0.96,
                    source_title="经济学拔尖人才创新班人才培养方案",
                    structural_path=(
                        "经济学拔尖人才创新班人才培养方案",
                        "五、课程设置和修读建议",
                        "(二) 专业教育",
                        "1. 专业核心课程",
                    ),
                    content_kind="table_unit",
                    content_role="table_fact",
                ),
            ),
        )

        self.assertEqual(selected, ())

    def test_prioritize_evidence_sources_does_not_force_shortest_title_for_ambiguous_ethnic_experimental_fragment(
        self,
    ) -> None:
        ranked = prioritize_evidence_sources(
            query_text="民族实验班",
            sources=(
                _make_source(
                    doc_id="curriculum:计算机科学与技术（民族实验班）本科人才培养方案",
                    chunk_id="curriculum:cs-ethnic-experimental:chunk-0011",
                    snippet="培养要求表 必修课 40 学分。",
                    score=0.91,
                    source_title="计算机科学与技术（民族实验班）本科人才培养方案",
                    structural_path=(
                        "计算机科学与技术（民族实验班）本科人才培养方案",
                        "七、培养要求",
                    ),
                    content_kind="table_unit",
                    content_role="table_fact",
                ),
                _make_source(
                    doc_id="curriculum:法学（民族实验班）本科人才培养方案",
                    chunk_id="curriculum:law-ethnic-experimental:chunk-0001",
                    snippet="法学（民族实验班）本科人才培养方案 一、培养目标。",
                    score=0.49,
                    source_title="法学（民族实验班）本科人才培养方案",
                    structural_path=("法学（民族实验班）本科人才培养方案", "一、培养目标"),
                    content_kind="section_text",
                ),
                _make_source(
                    doc_id="curriculum:信息与计算科学（民族实验班）本科人才培养方案",
                    chunk_id="curriculum:ics-ethnic-experimental:chunk-0001",
                    snippet="信息与计算科学（民族实验班）本科人才培养方案 一、培养目标。",
                    score=0.48,
                    source_title="信息与计算科学（民族实验班）本科人才培养方案",
                    structural_path=(
                        "信息与计算科学（民族实验班）本科人才培养方案",
                        "一、培养目标",
                    ),
                    content_kind="section_text",
                ),
            ),
        )

        self.assertEqual(
            ranked[0].doc_id, "curriculum:计算机科学与技术（民族实验班）本科人才培养方案"
        )
