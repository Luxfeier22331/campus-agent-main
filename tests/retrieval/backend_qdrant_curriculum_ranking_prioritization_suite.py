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

    def test_prioritize_evidence_sources_preserves_curriculum_bracketed_program_identity(
        self,
    ) -> None:
        ranked = prioritize_evidence_sources(
            query_text="信息与计算科学本科人才培养方案",
            sources=(
                _make_source(
                    doc_id="curriculum:信息与计算科学（民族实验班）本科人才培养方案",
                    chunk_id="curriculum:ics-ethnic-experimental:chunk-0001",
                    snippet="信息与计算科学（民族实验班）本科人才培养方案 一、培养目标。",
                    score=0.82,
                    source_title="信息与计算科学（民族实验班）本科人才培养方案",
                    structural_path=(
                        "信息与计算科学（民族实验班）本科人才培养方案",
                        "一、培养目标",
                    ),
                ),
                _make_source(
                    doc_id="curriculum:信息与计算科学本科人才培养方案",
                    chunk_id="curriculum:ics:chunk-0001",
                    snippet="信息与计算科学本科人才培养方案 一、培养目标。",
                    score=0.49,
                    source_title="信息与计算科学本科人才培养方案",
                    structural_path=("信息与计算科学本科人才培养方案", "一、培养目标"),
                ),
            ),
        )

        self.assertEqual(ranked[0].doc_id, "curriculum:信息与计算科学本科人才培养方案")

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

    def test_select_supporting_evidence_sources_prefers_curriculum_total_credit_fact_chunk(
        self,
    ) -> None:
        title = "中央民族大学通识课程“大学英语”课程教学计划"

        selected = select_supporting_evidence_sources(
            query_text=f"{title} 大学英语课程教学计划一共多少学分",
            max_sources=3,
            sources=(
                _make_source(
                    doc_id=f"curriculum:{title}",
                    chunk_id=f"curriculum:{title}:chunk-0007",
                    snippet=(
                        "三、修读要求\n"
                        "(一)学分数及修读方式\n"
                        "类型 | 考试名称和要求\n"
                        "英语等级社会考试 | 托福(TOEFL)90分及以上"
                    ),
                    score=0.029,
                    source_title="中央民族大学通识课程 “大学英语”课程教学计划",
                    structural_path=(title, "三、修读要求", "(一)学分数及修读方式"),
                    content_kind="table_unit",
                    content_role="table_fact",
                    is_answer_bearing=True,
                ),
                _make_source(
                    doc_id=f"curriculum:{title}",
                    chunk_id=f"curriculum:{title}:chunk-0008",
                    snippet=(
                        "三、修读要求\n"
                        "(二)学期安排及各级别课程设置\n"
                        "级别 | 修读学期\n"
                        "普通级-4 | 在1-4学期达到表2中关于英语社会等级考试要求,"
                        "可自愿申请免修未修读完成的所有大学英语课程,成绩按照95分进行核算。"
                    ),
                    score=0.032,
                    source_title="中央民族大学通识课程 “大学英语”课程教学计划",
                    structural_path=(title, "三、修读要求", "(二)学期安排及各级别课程设置"),
                    content_kind="table_unit",
                    content_role="table_fact",
                    is_answer_bearing=True,
                ),
                _make_source(
                    doc_id=f"curriculum:{title}",
                    chunk_id=f"curriculum:{title}:chunk-0006",
                    snippet=(
                        "三、修读要求\n"
                        "(一)学分数及修读方式\n"
                        "本科在读期间,必须完成第1-4学期大学英语课程修读要求,"
                        "每学期修读完成2学分课程,共计获得8学分。"
                    ),
                    score=0.031,
                    source_title="中央民族大学通识课程 “大学英语”课程教学计划",
                    structural_path=(title, "三、修读要求", "(一)学分数及修读方式"),
                    content_kind="section_text",
                ),
            ),
        )

        self.assertEqual(selected[0].chunk_id, f"curriculum:{title}:chunk-0006")

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
