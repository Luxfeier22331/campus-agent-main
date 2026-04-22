from __future__ import annotations

from tests.retrieval.backend_qdrant_test_support import (
    EvidenceSource,
    InMemoryDocumentRegistry,
    Mock,
    MockEmbeddingSettings,
    MockSparseEmbeddingSettings,
    QdrantRetrievalBackend,
    RetrievalRequest,
    RetrievalSettings,
    _apply_document_diversity_policy,
    _build_document_support_query_text,
    _make_runtime_profile,
    _make_source,
    _prefer_curriculum_semester_course_list_sources,
    build_mock_embedding_model,
    build_mock_sparse_embedding_model,
    patch,
    prioritize_evidence_sources,
    qdrant_models,
    query_targets_source_title,
    select_supporting_evidence_sources,
    unittest,
)


class BackendQdrantCurriculumRankingTest(unittest.TestCase):
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

    def test_query_targets_source_title_accepts_curriculum_title_with_inserted_direction_variant(
        self,
    ) -> None:
        self.assertTrue(
            query_targets_source_title(
                query_text="中国少数民族语言文学强基计划本科人才培养方案",
                source=_make_source(
                    doc_id="curriculum:中国少数民族语言文学（古文字学方向）强基计划本科人才培养方案",
                    chunk_id="curriculum:minority-language-strong-base:chunk-0001",
                    snippet="中国少数民族语言文学（古文字学方向）强基计划本科人才培养方案 一、培养目标。",
                    score=0.51,
                    source_title="中国少数民族语言文学（古文字学方向）强基计划本科人才培养方案",
                    structural_path=(
                        "中国少数民族语言文学（古文字学方向）强基计划本科人才培养方案",
                        "一、培养目标",
                    ),
                    content_kind="section_text",
                ),
            )
        )

    def test_query_targets_source_title_accepts_long_semantic_curriculum_title_paraphrase(
        self,
    ) -> None:
        self.assertTrue(
            query_targets_source_title(
                query_text="想看中国少数民族语言文学古文字学方向强基计划培养方案",
                source=_make_source(
                    doc_id="curriculum:中国少数民族语言文学（古文字学方向）强基计划本科人才培养方案",
                    chunk_id="curriculum:minority-language-strong-base:chunk-0001",
                    snippet="中国少数民族语言文学（古文字学方向）强基计划本科人才培养方案 一、培养目标。",
                    score=0.51,
                    source_title="中国少数民族语言文学（古文字学方向）强基计划本科人才培养方案",
                    structural_path=(
                        "中国少数民族语言文学（古文字学方向）强基计划本科人才培养方案",
                        "一、培养目标",
                    ),
                    content_kind="section_text",
                ),
            )
        )

    def test_query_targets_source_title_accepts_short_official_web_page_title_with_school_prefix(
        self,
    ) -> None:
        self.assertTrue(
            query_targets_source_title(
                query_text="中央民族大学博士后",
                source=EvidenceSource(
                    doc_id="official_web:muc_public:article_detail:c754a99f576af8d8e67869524e327781dbb2c916",
                    revision_track="source-faithful",
                    version_id="owdocver:test",
                    chunk_id="official_web:muc_public:article_detail:c754a99f576af8d8e67869524e327781dbb2c916:chunk-0001",
                    anchor={"segment_ord": 1},
                    canonical_url="https://www.muc.edu.cn/rcpy/bsh.htm",
                    latest_url="https://www.muc.edu.cn/rcpy/bsh.htm",
                    source_channel="official_web",
                    collection="muc_public_pages",
                    is_current=True,
                    snippet="博士后 学校现有6个博士后科研流动站。",
                    score=0.61,
                    source_title="博士后",
                    structural_path=("博士后",),
                    content_kind="article_body",
                ),
            )
        )

    def test_query_targets_source_title_ignores_parent_heading_for_official_web_reference_doc(
        self,
    ) -> None:
        self.assertFalse(
            query_targets_source_title(
                query_text="中央民族大学学校概况",
                source=EvidenceSource(
                    doc_id="official_web:muc_public:article_detail:e286aba2b39208a26af21e9dd518afc6faa49487",
                    revision_track="source-faithful",
                    version_id="owdocver:test-school-profile",
                    chunk_id="official_web:muc_public:article_detail:e286aba2b39208a26af21e9dd518afc6faa49487:chunk-0001",
                    anchor={"segment_ord": 1, "section_path": ["学校概况", "学校简介"]},
                    canonical_url="https://www.muc.edu.cn/xxgk1/xxjj.htm",
                    latest_url="https://www.muc.edu.cn/xxgk1/xxjj.htm",
                    source_channel="official_web",
                    collection="stable_reference",
                    is_current=True,
                    snippet="标题：学校简介 中央民族大学是党和国家为解决民族问题而创建的一所特色鲜明的高等院校。",
                    score=0.61,
                    source_title="学校简介",
                    structural_path=("学校概况", "学校简介"),
                    content_kind="article_body",
                ),
            )
        )

    def test_build_document_support_query_text_uses_fact_hints_for_official_web_reference_pages(
        self,
    ) -> None:
        school_overview_source = EvidenceSource(
            doc_id="official_web:muc_public:article_detail:36021906c0348aa73ed1f5467c4cb57954295e85",
            revision_track="source-faithful",
            version_id="owdocver:test-school-overview",
            chunk_id="official_web:muc_public:article_detail:36021906c0348aa73ed1f5467c4cb57954295e85:chunk-0001",
            anchor={"segment_ord": 1},
            canonical_url="https://www.muc.edu.cn/xxgk1.htm",
            latest_url="https://www.muc.edu.cn/xxgk1.htm",
            source_channel="official_web",
            collection="muc_public_pages",
            is_current=True,
            snippet="标题：学校概况 学校现有北京海淀、丰台和海南陵水黎安国际教育创新试验区三个校区。",
            score=0.6,
            source_title="学校概况",
            structural_path=("学校概况",),
            content_kind="article_body",
        )
        postdoctoral_source = EvidenceSource(
            doc_id="official_web:muc_public:article_detail:c754a99f576af8d8e67869524e327781dbb2c916",
            revision_track="source-faithful",
            version_id="owdocver:test-postdoc",
            chunk_id="official_web:muc_public:article_detail:c754a99f576af8d8e67869524e327781dbb2c916:chunk-0001",
            anchor={"segment_ord": 1},
            canonical_url="https://www.muc.edu.cn/rcpy/bsh.htm",
            latest_url="https://www.muc.edu.cn/rcpy/bsh.htm",
            source_channel="official_web",
            collection="muc_public_pages",
            is_current=True,
            snippet="标题：博士后 中央民族大学全面推动“双一流”建设和整体发展。",
            score=0.6,
            source_title="博士后",
            structural_path=("博士后",),
            content_kind="article_body",
        )
        scholar_source = EvidenceSource(
            doc_id="official_web:muc_public:article_detail:e5f0a4d0916a8a506036f1931a2f5a480e9db3f2",
            revision_track="source-faithful",
            version_id="owdocver:test-scholars",
            chunk_id="official_web:muc_public:article_detail:e5f0a4d0916a8a506036f1931a2f5a480e9db3f2:chunk-0001",
            anchor={"segment_ord": 1, "section_path": ["学校概况", "学校概况", "翦伯赞"]},
            canonical_url="https://www.muc.edu.cn/xxgk1/xsml.htm",
            latest_url="https://www.muc.edu.cn/xxgk1/xsml.htm",
            source_channel="official_web",
            collection="muc_public_pages",
            is_current=True,
            snippet="标题：学术名流 翦伯赞先生对改造旧史学、创建马克思主义新史学做出了卓越贡献。",
            score=0.6,
            source_title="学术名流",
            structural_path=("学术名流", "翦伯赞"),
            content_kind="article_body",
        )

        self.assertEqual(
            _build_document_support_query_text(
                query_text="中央民族大学学校概况",
                source=school_overview_source,
            ),
            "学校概况 三个校区 12个学科门类",
        )
        self.assertEqual(
            _build_document_support_query_text(
                query_text="中央民族大学博士后",
                source=postdoctoral_source,
            ),
            "博士后 博士后科研流动站 合格率",
        )
        self.assertEqual(
            _build_document_support_query_text(
                query_text="中央民族大学学术名流",
                source=scholar_source,
            ),
            "学术名流 历史学 社会学 民族学 人类学 语言学 音乐",
        )

    def test_build_document_support_query_text_uses_fact_hints_for_stable_reference_pages(
        self,
    ) -> None:
        school_overview_source = EvidenceSource(
            doc_id="official_web:muc_public:article_detail:36021906c0348aa73ed1f5467c4cb57954295e85",
            revision_track="source-faithful",
            version_id="owdocver:test-school-overview-stable-reference",
            chunk_id="official_web:muc_public:article_detail:36021906c0348aa73ed1f5467c4cb57954295e85:chunk-0001",
            anchor={"segment_ord": 1},
            canonical_url="https://www.muc.edu.cn/xxgk1.htm",
            latest_url="https://www.muc.edu.cn/xxgk1.htm",
            source_channel="official_web",
            collection="stable_reference",
            is_current=True,
            snippet="标题：学校概况 学校现有北京海淀、丰台和海南陵水黎安国际教育创新试验区三个校区。",
            score=0.6,
            source_title="学校概况",
            structural_path=("学校概况",),
            content_kind="article_body",
        )

        self.assertEqual(
            _build_document_support_query_text(
                query_text="中央民族大学学校概况",
                source=school_overview_source,
            ),
            "学校概况 三个校区 12个学科门类",
        )

    def test_apply_document_diversity_policy_prefers_fact_rich_chunk_for_stable_reference_queries(
        self,
    ) -> None:
        profile = _make_runtime_profile(corpus="official_web", collection="muc_public_pages")
        school_overview_sources = (
            EvidenceSource(
                doc_id="official_web:muc_public:article_detail:36021906c0348aa73ed1f5467c4cb57954295e85",
                revision_track="source-faithful",
                version_id="owdocver:test-overview-lead",
                chunk_id="official_web:muc_public:article_detail:36021906c0348aa73ed1f5467c4cb57954295e85:chunk-0001",
                anchor={"segment_ord": 1},
                canonical_url="https://www.muc.edu.cn/xxgk1.htm",
                latest_url="https://www.muc.edu.cn/xxgk1.htm",
                source_channel="official_web",
                collection="muc_public_pages",
                is_current=True,
                snippet="标题：学校概况 中央民族大学是党和国家为解决民族问题而创建的一所特色鲜明的高等院校。学校现有三个校区。",
                score=0.6,
                source_title="学校概况",
                structural_path=("学校概况",),
                content_kind="article_body",
            ),
            EvidenceSource(
                doc_id="official_web:muc_public:article_detail:36021906c0348aa73ed1f5467c4cb57954295e85",
                revision_track="source-faithful",
                version_id="owdocver:test-overview-facts",
                chunk_id="official_web:muc_public:article_detail:36021906c0348aa73ed1f5467c4cb57954295e85:chunk-0004",
                anchor={"segment_ord": 4},
                canonical_url="https://www.muc.edu.cn/xxgk1.htm",
                latest_url="https://www.muc.edu.cn/xxgk1.htm",
                source_channel="official_web",
                collection="muc_public_pages",
                is_current=True,
                snippet="标题：学校概况 学校拥有门类综合、特色鲜明的高水平学科专业体系。目前，学校设有1个学部、26个学院，有覆盖12个学科门类的71个本科专业。",
                score=0.58,
                source_title="学校概况",
                structural_path=("学校概况",),
                content_kind="article_body",
            ),
        )
        postdoctoral_sources = (
            EvidenceSource(
                doc_id="official_web:muc_public:article_detail:c754a99f576af8d8e67869524e327781dbb2c916",
                revision_track="source-faithful",
                version_id="owdocver:test-postdoc-lead",
                chunk_id="official_web:muc_public:article_detail:c754a99f576af8d8e67869524e327781dbb2c916:chunk-0001",
                anchor={"segment_ord": 1},
                canonical_url="https://www.muc.edu.cn/rcpy/bsh.htm",
                latest_url="https://www.muc.edu.cn/rcpy/bsh.htm",
                source_channel="official_web",
                collection="muc_public_pages",
                is_current=True,
                snippet="标题：博士后 中央民族大学全面推动“双一流”建设和整体发展，创新工作机制，强化服务保障。",
                score=0.62,
                source_title="博士后",
                structural_path=("博士后",),
                content_kind="article_body",
            ),
            EvidenceSource(
                doc_id="official_web:muc_public:article_detail:c754a99f576af8d8e67869524e327781dbb2c916",
                revision_track="source-faithful",
                version_id="owdocver:test-postdoc-facts",
                chunk_id="official_web:muc_public:article_detail:c754a99f576af8d8e67869524e327781dbb2c916:chunk-0003",
                anchor={"segment_ord": 3},
                canonical_url="https://www.muc.edu.cn/rcpy/bsh.htm",
                latest_url="https://www.muc.edu.cn/rcpy/bsh.htm",
                source_channel="official_web",
                collection="muc_public_pages",
                is_current=True,
                snippet="标题：博士后 学校现有6个博士后科研流动站。在全国博管会组织的历次流动站评估中，我校参评的流动站合格率均为100％。",
                score=0.57,
                source_title="博士后",
                structural_path=("博士后",),
                content_kind="article_body",
            ),
        )

        school_overview_filtered = _apply_document_diversity_policy(
            profile=profile,
            query_text="中央民族大学学校概况",
            sources=school_overview_sources,
        )
        postdoctoral_filtered = _apply_document_diversity_policy(
            profile=profile,
            query_text="中央民族大学博士后",
            sources=postdoctoral_sources,
        )

        self.assertEqual(
            tuple(source.chunk_id for source in school_overview_filtered),
            (
                "official_web:muc_public:article_detail:36021906c0348aa73ed1f5467c4cb57954295e85:chunk-0001",
                "official_web:muc_public:article_detail:36021906c0348aa73ed1f5467c4cb57954295e85:chunk-0004",
            ),
        )
        self.assertEqual(
            tuple(source.chunk_id for source in postdoctoral_filtered),
            (
                "official_web:muc_public:article_detail:c754a99f576af8d8e67869524e327781dbb2c916:chunk-0003",
            ),
        )

    def test_apply_document_diversity_policy_keeps_multiple_scholar_chunks_for_scholar_page(
        self,
    ) -> None:
        profile = _make_runtime_profile(corpus="official_web", collection="muc_public_pages")
        scholar_sources = (
            EvidenceSource(
                doc_id="official_web:muc_public:article_detail:e5f0a4d0916a8a506036f1931a2f5a480e9db3f2",
                revision_track="source-faithful",
                version_id="owdocver:test-scholar-history",
                chunk_id="official_web:muc_public:article_detail:e5f0a4d0916a8a506036f1931a2f5a480e9db3f2:chunk-0001",
                anchor={"segment_ord": 1, "section_path": ["学校概况", "学校概况", "翦伯赞"]},
                canonical_url="https://www.muc.edu.cn/xxgk1/xsml.htm",
                latest_url="https://www.muc.edu.cn/xxgk1/xsml.htm",
                source_channel="official_web",
                collection="muc_public_pages",
                is_current=True,
                snippet="标题：学术名流 翦伯赞先生与郭沫若、范文澜等一起筹建中国历史学会，对改造旧史学、创建马克思主义新史学做出了卓越贡献。",
                score=0.61,
                source_title="学术名流",
                structural_path=("学术名流", "翦伯赞"),
                content_kind="article_body",
            ),
            EvidenceSource(
                doc_id="official_web:muc_public:article_detail:e5f0a4d0916a8a506036f1931a2f5a480e9db3f2",
                revision_track="source-faithful",
                version_id="owdocver:test-scholar-social",
                chunk_id="official_web:muc_public:article_detail:e5f0a4d0916a8a506036f1931a2f5a480e9db3f2:chunk-0002",
                anchor={"segment_ord": 2, "section_path": ["学校概况", "学校概况", "吴泽霖"]},
                canonical_url="https://www.muc.edu.cn/xxgk1/xsml.htm",
                latest_url="https://www.muc.edu.cn/xxgk1/xsml.htm",
                source_channel="official_web",
                collection="muc_public_pages",
                is_current=True,
                snippet="标题：学术名流 吴泽霖先生将社会学与民族学、人类学等学科联系起来，对社会现象作跨学科研究。",
                score=0.6,
                source_title="学术名流",
                structural_path=("学术名流", "吴泽霖"),
                content_kind="article_body",
            ),
            EvidenceSource(
                doc_id="official_web:muc_public:article_detail:e5f0a4d0916a8a506036f1931a2f5a480e9db3f2",
                revision_track="source-faithful",
                version_id="owdocver:test-scholar-language",
                chunk_id="official_web:muc_public:article_detail:e5f0a4d0916a8a506036f1931a2f5a480e9db3f2:chunk-0006",
                anchor={"segment_ord": 6, "section_path": ["学校概况", "学校概况", "于道泉"]},
                canonical_url="https://www.muc.edu.cn/xxgk1/xsml.htm",
                latest_url="https://www.muc.edu.cn/xxgk1/xsml.htm",
                source_channel="official_web",
                collection="muc_public_pages",
                is_current=True,
                snippet="标题：学术名流 于道泉长期从事藏学人才培养，设计了效果良好的藏语拉丁化拼音方案。",
                score=0.59,
                source_title="学术名流",
                structural_path=("学术名流", "于道泉"),
                content_kind="article_body",
            ),
        )

        scholar_filtered = _apply_document_diversity_policy(
            profile=profile,
            query_text="中央民族大学学术名流",
            sources=scholar_sources,
        )

        self.assertEqual(
            tuple(source.chunk_id for source in scholar_filtered),
            (
                "official_web:muc_public:article_detail:e5f0a4d0916a8a506036f1931a2f5a480e9db3f2:chunk-0001",
                "official_web:muc_public:article_detail:e5f0a4d0916a8a506036f1931a2f5a480e9db3f2:chunk-0002",
                "official_web:muc_public:article_detail:e5f0a4d0916a8a506036f1931a2f5a480e9db3f2:chunk-0006",
            ),
        )

    def test_expand_named_document_support_uses_focused_query_for_same_document_followup(
        self,
    ) -> None:
        registry = InMemoryDocumentRegistry()
        embedding_model = Mock()
        embedding_model.get_query_embedding.side_effect = (
            (0.1, 0.2, 0.3),
            (0.4, 0.5, 0.6),
        )
        sparse_embedding_model = Mock()
        sparse_embedding_model.build_query.side_effect = ("sparse-full", "sparse-focused")
        qdrant_client = Mock()
        qdrant_client.collection_exists.return_value = True
        qdrant_client.get_aliases.return_value = qdrant_models.CollectionsAliasesResponse(
            aliases=[]
        )
        qdrant_client.query_points.side_effect = (
            qdrant_models.QueryResponse(
                points=[
                    qdrant_models.ScoredPoint(
                        id="point-intro",
                        version=0,
                        score=0.49,
                        payload={
                            "document_id": "curriculum:民族学本科第二学士学位人才培养方案",
                            "revision_track": "source-faithful",
                            "version_id": "v1:ethnology-second-degree",
                            "chunk_id": "curriculum:民族学本科第二学士学位人才培养方案:chunk-0001",
                            "corpus": "curriculum",
                            "collection": "curriculum_plan",
                            "visibility_level": "public",
                            "status": "active",
                            "source_uri": "https://campus.example/curriculum/ethnology-second-degree",
                            "canonical_url": "https://campus.example/curriculum/ethnology-second-degree",
                            "latest_url": "https://campus.example/curriculum/ethnology-second-degree",
                            "source_channel": "pdf_ocr",
                            "is_current": True,
                            "anchor": {
                                "section_path": [
                                    "民族学本科第二学士学位人才培养方案",
                                    "一、培养目标",
                                ]
                            },
                            "text": "民族学本科第二学士学位人才培养方案 一、培养目标。",
                        },
                    ),
                ]
            ),
            qdrant_models.QueryResponse(
                points=[
                    qdrant_models.ScoredPoint(
                        id="point-years",
                        version=0,
                        score=0.47,
                        payload={
                            "document_id": "curriculum:民族学本科第二学士学位人才培养方案",
                            "revision_track": "source-faithful",
                            "version_id": "v1:ethnology-second-degree",
                            "chunk_id": "curriculum:民族学本科第二学士学位人才培养方案:chunk-0005",
                            "corpus": "curriculum",
                            "collection": "curriculum_plan",
                            "visibility_level": "public",
                            "status": "active",
                            "source_uri": "https://campus.example/curriculum/ethnology-second-degree",
                            "canonical_url": "https://campus.example/curriculum/ethnology-second-degree",
                            "latest_url": "https://campus.example/curriculum/ethnology-second-degree",
                            "source_channel": "pdf_ocr",
                            "is_current": True,
                            "anchor": {
                                "section_path": [
                                    "民族学本科第二学士学位人才培养方案",
                                    "五、学制 两年",
                                ]
                            },
                            "text": "五、学制 两年",
                        },
                    ),
                ]
            ),
        )
        backend = QdrantRetrievalBackend(
            settings=RetrievalSettings(
                qdrant_url=":memory:",
                document_registry_database_url="postgresql://registry.example/postgres",
            ),
            registry=registry,
            qdrant_client=qdrant_client,
            embedding_model=embedding_model,
            sparse_embedding_model=sparse_embedding_model,
        )

        backend.retrieve(
            RetrievalRequest(
                query_text="民族学本科第二学士学位人才培养方案学制几年？",
                corpus="curriculum",
                collection="curriculum_plan",
                top_k=5,
            )
        )

        self.assertEqual(embedding_model.get_query_embedding.call_count, 2)
        self.assertEqual(
            embedding_model.get_query_embedding.call_args_list[1].args[0],
            "Instruct: Given a campus policy or handbook question, retrieve relevant passages that answer the query.\nQuery: 学制",
        )
        self.assertEqual(sparse_embedding_model.build_query.call_args_list[1].args[0], "学制")

    def test_build_document_support_query_text_strips_short_fact_question_noise(self) -> None:
        self.assertEqual(
            _build_document_support_query_text(
                query_text="民族学本科第二学士学位人才培养方案学制几年？",
                source=_make_source(
                    doc_id="curriculum:民族学本科第二学士学位人才培养方案",
                    chunk_id="curriculum:ethnology-second-degree:chunk-0001",
                    snippet="民族学本科第二学士学位人才培养方案 一、培养目标。",
                    score=0.49,
                    source_title="民族学本科第二学士学位人才培养方案",
                ),
            ),
            "学制",
        )

    def test_build_document_support_query_text_strips_table_question_noise(self) -> None:
        self.assertEqual(
            _build_document_support_query_text(
                query_text="经济学拔尖人才创新班人才培养方案课程地图怎么安排？",
                source=_make_source(
                    doc_id="curriculum:经济学拔尖人才创新班人才培养方案",
                    chunk_id="curriculum:economics-innovation:chunk-0001",
                    snippet="经济学拔尖人才创新班人才培养方案 一、培养目标。",
                    score=0.49,
                    source_title="经济学拔尖人才创新班人才培养方案",
                ),
            ),
            "课程地图",
        )

    def test_build_document_support_query_text_normalizes_curriculum_alias_and_semester_noise(
        self,
    ) -> None:
        self.assertEqual(
            _build_document_support_query_text(
                query_text="法学民族班培养方案里大二下有什么课",
                source=_make_source(
                    doc_id="curriculum:法学（民族实验班）本科人才培养方案",
                    chunk_id="curriculum:law-ethnic-experimental:chunk-0004",
                    snippet="第四学期 国际公法、知识产权法。",
                    score=0.49,
                    source_title="法学（民族实验班）本科人才培养方案",
                    structural_path=("法学（民族实验班）本科人才培养方案", "第四学期"),
                    detail_label="第四学期",
                ),
            ),
            "第四学期",
        )

    def test_prioritize_evidence_sources_uses_explicit_source_title_when_doc_ids_are_opaque(
        self,
    ) -> None:
        ranked = prioritize_evidence_sources(
            query_text="民族学本科第二学士学位人才培养方案学制几年？",
            sources=(
                _make_source(
                    doc_id="curriculum:doc-001",
                    chunk_id="curriculum:doc-001:chunk-0005",
                    snippet="学制：两年。",
                    score=0.49,
                    source_title="民族学本科第二学士学位人才培养方案",
                    content_kind="text",
                    content_role="time_rule",
                    detail_label="五、学制",
                    is_answer_bearing=True,
                ),
                _make_source(
                    doc_id="curriculum:doc-002",
                    chunk_id="curriculum:doc-002:chunk-0005",
                    snippet="学制：两年。",
                    score=0.82,
                    source_title="教育学本科第二学士学位人才培养方案",
                    content_kind="text",
                    content_role="time_rule",
                    detail_label="五、学制",
                    is_answer_bearing=True,
                ),
            ),
        )

        self.assertEqual(ranked[0].doc_id, "curriculum:doc-001")

    def test_prioritize_evidence_sources_prefers_answer_bearing_procedure_chunk_over_closing_provision(
        self,
    ) -> None:
        ranked = prioritize_evidence_sources(
            query_text="学生证丢失后怎么办理补办？",
            sources=(
                _make_source(
                    doc_id="handbook:student-card",
                    chunk_id="student-card-closing",
                    snippet="附则 本办法由学生处负责解释。",
                    score=0.91,
                    collection="student_rules",
                    source_title="中央民族大学学生证管理办法",
                    structural_path=("附则",),
                    content_kind="text",
                    content_role="closing_provision",
                    detail_label="附则",
                ),
                _make_source(
                    doc_id="handbook:student-card",
                    chunk_id="student-card-procedure",
                    snippet="学生证遗失后，应及时到学院挂失，填写补办申请表，经学院审批后到学生处办理。",
                    score=0.73,
                    collection="student_rules",
                    source_title="中央民族大学学生证管理办法",
                    structural_path=("第三章 学籍管理", "学生证管理"),
                    content_kind="text",
                    content_role="procedure",
                    detail_label="第十二条",
                    is_answer_bearing=True,
                ),
            ),
        )

        self.assertEqual(ranked[0].chunk_id, "student-card-procedure")

    def test_prioritize_evidence_sources_uses_content_role_to_demote_explanatory_background_chunks(
        self,
    ) -> None:
        ranked = prioritize_evidence_sources(
            query_text="学生证补办流程是什么？",
            sources=(
                _make_source(
                    doc_id="handbook:doc-opaque",
                    chunk_id="student-card-background",
                    snippet="学生证补办相关规定由学生处负责解释。",
                    score=0.92,
                    collection="student_rules",
                    source_title="中央民族大学学生证管理办法",
                    content_kind="text",
                    content_role="closing_provision",
                    detail_label="附则",
                ),
                _make_source(
                    doc_id="handbook:doc-opaque",
                    chunk_id="student-card-procedure-steps",
                    snippet="需先挂失，再提交补证申请，经学院审批后办理。",
                    score=0.67,
                    collection="student_rules",
                    source_title="中央民族大学学生证管理办法",
                    content_kind="text",
                    content_role="procedure",
                    detail_label="第十二条",
                    is_answer_bearing=True,
                ),
            ),
        )

        self.assertEqual(ranked[0].chunk_id, "student-card-procedure-steps")

    def test_prioritize_evidence_sources_demotes_official_web_support_only_roles(self) -> None:
        ranked = prioritize_evidence_sources(
            query_text="本科培养",
            sources=(
                _make_source(
                    doc_id="official_web:muc_public:article_detail:undergraduate",
                    chunk_id="undergraduate-source-attribution",
                    snippet="本科培养 来源：教务处",
                    score=0.96,
                    collection="muc_public_pages",
                    source_title="本科培养",
                    structural_path=("人才培养",),
                    content_kind="section_text",
                    content_role="source_attribution",
                ),
                _make_source(
                    doc_id="official_web:muc_public:article_detail:undergraduate",
                    chunk_id="undergraduate-reference-fact",
                    snippet="学校现有本科专业71个，在招专业61个，涵盖11个学科门类。",
                    score=0.62,
                    collection="muc_public_pages",
                    source_title="本科培养",
                    structural_path=("人才培养",),
                    content_kind="section_text",
                    content_role="reference_fact",
                ),
                _make_source(
                    doc_id="official_web:muc_public:article_detail:undergraduate",
                    chunk_id="undergraduate-boilerplate",
                    snippet="投稿方式：mucxcb@muc.edu.cn",
                    score=0.99,
                    collection="muc_public_pages",
                    source_title="本科培养",
                    structural_path=("人才培养",),
                    content_kind="section_text",
                    content_role="boilerplate",
                ),
            ),
        )

        self.assertEqual(ranked[0].chunk_id, "undergraduate-reference-fact")
        self.assertEqual(ranked[-1].chunk_id, "undergraduate-boilerplate")

    def test_build_evidence_sources_maps_structural_metadata_into_contract_fields(self) -> None:
        registry = InMemoryDocumentRegistry()
        embedding_model = build_mock_embedding_model(MockEmbeddingSettings(embed_dim=8))
        backend = QdrantRetrievalBackend(
            settings=RetrievalSettings(
                qdrant_url=":memory:",
                document_registry_database_url="postgresql://registry.example/postgres",
            ),
            registry=registry,
            qdrant_client=Mock(),
            embedding_model=embedding_model,
            sparse_embedding_model=build_mock_sparse_embedding_model(MockSparseEmbeddingSettings()),
        )

        sources = backend._build_evidence_sources(
            (
                qdrant_models.ScoredPoint(
                    id="point-student-card",
                    version=0,
                    score=0.77,
                    payload={
                        "document_id": "handbook:student-card",
                        "revision_track": "source-faithful",
                        "version_id": "v1:student-card",
                        "chunk_id": "student-card-procedure",
                        "collection": "student_rules",
                        "visibility_level": "public",
                        "canonical_url": "https://campus.example/handbook/student-card",
                        "latest_url": "https://campus.example/handbook/student-card",
                        "source_channel": "pdf_ocr",
                        "is_current": False,
                        "title": "中央民族大学学生证管理办法",
                        "unit_type": "article_body",
                        "content_role": "procedure",
                        "is_answer_bearing": True,
                        "anchor": {
                            "section_path": ["第三章 学籍管理", "学生证管理"],
                            "article_label": "第十二条",
                        },
                        "text": "学生证遗失后，应及时到学院挂失，填写补办申请表。",
                    },
                ),
            )
        )

        self.assertEqual(len(sources), 1)
        self.assertEqual(sources[0].source_title, "中央民族大学学生证管理办法")
        self.assertEqual(sources[0].structural_path, ("第三章 学籍管理", "学生证管理"))
        self.assertEqual(sources[0].content_kind, "article_body")
        self.assertEqual(sources[0].content_role, "procedure")
        self.assertEqual(sources[0].detail_label, "第十二条")
        self.assertTrue(sources[0].is_answer_bearing)

    def test_build_evidence_sources_maps_canonical_parent_and_semester_unit_metadata(self) -> None:
        registry = InMemoryDocumentRegistry()
        embedding_model = build_mock_embedding_model(MockEmbeddingSettings(embed_dim=8))
        backend = QdrantRetrievalBackend(
            settings=RetrievalSettings(
                qdrant_url=":memory:",
                document_registry_database_url="postgresql://registry.example/postgres",
            ),
            registry=registry,
            qdrant_client=Mock(),
            embedding_model=embedding_model,
            sparse_embedding_model=build_mock_sparse_embedding_model(MockSparseEmbeddingSettings()),
        )

        sources = backend._build_evidence_sources(
            (
                qdrant_models.ScoredPoint(
                    id="point-program-semester-fact",
                    version=0,
                    score=0.93,
                    payload={
                        "document_id": "program_semester_facts:law-ethnic-experimental:semester-4",
                        "revision_track": "source-faithful",
                        "version_id": "v1:law-ethnic-experimental:semester-4",
                        "chunk_id": "program_semester_facts:law-ethnic-experimental:semester-4:row-0001",
                        "collection": "program_semester_facts",
                        "visibility_level": "public",
                        "canonical_url": "https://campus.example/curriculum/law-ethnic-experimental",
                        "latest_url": "https://campus.example/curriculum/law-ethnic-experimental",
                        "source_channel": "pdf_ocr",
                        "is_current": False,
                        "source_title": "法学（民族实验班）本科人才培养方案 第四学期课程事实",
                        "content_kind": "program_semester_fact",
                        "content_role": "semester_course_list",
                        "detail_label": "第四学期课程",
                        "is_answer_bearing": True,
                        "source_doc_id": "curriculum:法学（民族实验班）本科人才培养方案",
                        "source_doc_title": "法学（民族实验班）本科人才培养方案",
                        "semester_label": "第四学期",
                        "semester_index": "4",
                        "anchor": {
                            "fact_type": "semester_course_list",
                            "section_path": ["法学（民族实验班）本科人才培养方案", "第四学期"],
                            "detail_label": "第四学期课程",
                        },
                        "text": "第四学期有中国少数民族文字学、侵权责任法、翻译学导论。",
                    },
                ),
            )
        )

        self.assertEqual(len(sources), 1)
        self.assertEqual(
            sources[0].canonical_source_id,
            "curriculum:法学（民族实验班）本科人才培养方案",
        )
        self.assertEqual(
            sources[0].canonical_source_title,
            "法学（民族实验班）本科人才培养方案",
        )
        self.assertEqual(sources[0].source_unit_kind, "semester_course_list")
        self.assertEqual(sources[0].source_unit_key, "semester-4")

    def test_build_evidence_sources_infers_curriculum_table_fact_when_runtime_payload_omits_unit_metadata(
        self,
    ) -> None:
        registry = InMemoryDocumentRegistry()
        embedding_model = build_mock_embedding_model(MockEmbeddingSettings(embed_dim=8))
        backend = QdrantRetrievalBackend(
            settings=RetrievalSettings(
                qdrant_url=":memory:",
                document_registry_database_url="postgresql://registry.example/postgres",
            ),
            registry=registry,
            qdrant_client=Mock(),
            embedding_model=embedding_model,
            sparse_embedding_model=build_mock_sparse_embedding_model(MockSparseEmbeddingSettings()),
        )

        sources = backend._build_evidence_sources(
            (
                qdrant_models.ScoredPoint(
                    id="point-curriculum-table",
                    version=0,
                    score=0.44,
                    payload={
                        "document_id": "curriculum:历史学（强基计划）本科人才培养方案",
                        "revision_track": "source-faithful",
                        "version_id": "v1:history-strong-base",
                        "collection": "curriculum_plan",
                        "visibility_level": "public",
                        "canonical_url": "https://campus.example/curriculum/history-strong-base",
                        "latest_url": "https://campus.example/curriculum/history-strong-base",
                        "source_channel": "pdf_ocr",
                        "is_current": True,
                        "anchor": {
                            "section_path": [
                                "历史学（强基计划）本科人才培养方案",
                                "五、课程设置和修读建议",
                                "(一)大类培养",
                                "1. 通识教育",
                            ],
                            "table_group_id": "page-0150-block-6-0007",
                        },
                        "text": (
                            "五、课程设置和修读建议\n\n"
                            "(一)大类培养\n\n"
                            "1. 通识教育\n\n"
                            "课程清单如下:\n"
                            "类别 | 课程号 | 课程名称 | 学分 | 学时 | 实践学时 | 修读学期\n"
                            "思政课 | 1037010044 | 中华民族共同体概论 | 2 | 36 | 12 | 4\n"
                            "培养课 | 1042010082 | 大学英语(四) | 2 | 54 | 36 | 4"
                        ),
                    },
                ),
            )
        )

        self.assertEqual(len(sources), 1)
        self.assertEqual(sources[0].content_kind, "table_unit")
        self.assertEqual(sources[0].content_role, "table_fact")

    def test_backend_expands_named_curriculum_document_support_with_same_doc_chunks(self) -> None:
        registry = InMemoryDocumentRegistry()
        embedding_model = build_mock_embedding_model(MockEmbeddingSettings(embed_dim=8))
        qdrant_client = Mock()
        qdrant_client.collection_exists = Mock(return_value=True)
        qdrant_client.get_aliases = Mock(return_value=type("Aliases", (), {"aliases": []})())
        qdrant_client.query_points = Mock(
            side_effect=[
                qdrant_models.QueryResponse(
                    points=[
                        qdrant_models.ScoredPoint(
                            id="point-intro",
                            version=0,
                            score=0.49,
                            payload={
                                "document_id": "curriculum:民族学本科第二学士学位人才培养方案",
                                "revision_track": "source-faithful",
                                "version_id": "v1:ethnology-second-degree",
                                "chunk_id": "curriculum:民族学本科第二学士学位人才培养方案:chunk-0001",
                                "corpus": "curriculum",
                                "collection": "curriculum_plan",
                                "visibility_level": "public",
                                "status": "active",
                                "source_uri": "https://campus.example/curriculum/ethnology-second-degree",
                                "canonical_url": "https://campus.example/curriculum/ethnology-second-degree",
                                "latest_url": "https://campus.example/curriculum/ethnology-second-degree",
                                "source_channel": "pdf_ocr",
                                "is_current": True,
                                "anchor": {
                                    "section_path": [
                                        "民族学本科第二学士学位人才培养方案",
                                        "一、培养目标",
                                    ]
                                },
                                "text": "民族学本科第二学士学位人才培养方案 一、培养目标。",
                            },
                        ),
                        qdrant_models.ScoredPoint(
                            id="point-other",
                            version=0,
                            score=0.82,
                            payload={
                                "document_id": "curriculum:教育学本科第二学士学位人才培养方案",
                                "revision_track": "source-faithful",
                                "version_id": "v1:education-second-degree",
                                "chunk_id": "curriculum:教育学本科第二学士学位人才培养方案:chunk-0005",
                                "corpus": "curriculum",
                                "collection": "curriculum_plan",
                                "visibility_level": "public",
                                "status": "active",
                                "source_uri": "https://campus.example/curriculum/education-second-degree",
                                "canonical_url": "https://campus.example/curriculum/education-second-degree",
                                "latest_url": "https://campus.example/curriculum/education-second-degree",
                                "source_channel": "pdf_ocr",
                                "is_current": True,
                                "anchor": {
                                    "section_path": [
                                        "教育学本科第二学士学位人才培养方案",
                                        "三、学制、总学分和学位授予",
                                    ]
                                },
                                "text": "三、学制、总学分和学位授予 学制:2年 总学分:60学分。",
                            },
                        ),
                    ]
                ),
                qdrant_models.QueryResponse(
                    points=[
                        qdrant_models.ScoredPoint(
                            id="point-intro",
                            version=0,
                            score=0.49,
                            payload={
                                "document_id": "curriculum:民族学本科第二学士学位人才培养方案",
                                "revision_track": "source-faithful",
                                "version_id": "v1:ethnology-second-degree",
                                "chunk_id": "curriculum:民族学本科第二学士学位人才培养方案:chunk-0001",
                                "corpus": "curriculum",
                                "collection": "curriculum_plan",
                                "visibility_level": "public",
                                "status": "active",
                                "source_uri": "https://campus.example/curriculum/ethnology-second-degree",
                                "canonical_url": "https://campus.example/curriculum/ethnology-second-degree",
                                "latest_url": "https://campus.example/curriculum/ethnology-second-degree",
                                "source_channel": "pdf_ocr",
                                "is_current": True,
                                "anchor": {
                                    "section_path": [
                                        "民族学本科第二学士学位人才培养方案",
                                        "一、培养目标",
                                    ]
                                },
                                "text": "民族学本科第二学士学位人才培养方案 一、培养目标。",
                            },
                        ),
                        qdrant_models.ScoredPoint(
                            id="point-years",
                            version=0,
                            score=0.47,
                            payload={
                                "document_id": "curriculum:民族学本科第二学士学位人才培养方案",
                                "revision_track": "source-faithful",
                                "version_id": "v1:ethnology-second-degree",
                                "chunk_id": "curriculum:民族学本科第二学士学位人才培养方案:chunk-0005",
                                "corpus": "curriculum",
                                "collection": "curriculum_plan",
                                "visibility_level": "public",
                                "status": "active",
                                "source_uri": "https://campus.example/curriculum/ethnology-second-degree",
                                "canonical_url": "https://campus.example/curriculum/ethnology-second-degree",
                                "latest_url": "https://campus.example/curriculum/ethnology-second-degree",
                                "source_channel": "pdf_ocr",
                                "is_current": True,
                                "anchor": {
                                    "section_path": [
                                        "民族学本科第二学士学位人才培养方案",
                                        "五、学制 两年",
                                    ]
                                },
                                "text": "五、学制 两年",
                            },
                        ),
                    ]
                ),
            ]
        )
        backend = QdrantRetrievalBackend(
            settings=RetrievalSettings(
                qdrant_url=":memory:",
                document_registry_database_url="postgresql://registry.example/postgres",
            ),
            registry=registry,
            qdrant_client=qdrant_client,
            embedding_model=embedding_model,
            sparse_embedding_model=build_mock_sparse_embedding_model(MockSparseEmbeddingSettings()),
        )

        result = backend.retrieve(
            RetrievalRequest(
                query_text="民族学本科第二学士学位人才培养方案学制几年？",
                corpus="curriculum",
                collection="curriculum_plan",
                top_k=5,
            )
        )

        self.assertEqual(
            [source.chunk_id for source in result.sources[:2]],
            [
                "curriculum:民族学本科第二学士学位人才培养方案:chunk-0005",
                "curriculum:民族学本科第二学士学位人才培养方案:chunk-0001",
            ],
        )
        self.assertEqual(qdrant_client.query_points.call_count, 2)

    def test_backend_supplements_curriculum_semester_followup_with_same_doc_semester_chunks(
        self,
    ) -> None:
        registry = InMemoryDocumentRegistry()
        embedding_model = Mock()
        embedding_model.get_query_embedding.side_effect = (
            (0.1, 0.2, 0.3),
            (0.4, 0.5, 0.6),
        )
        sparse_embedding_model = Mock()
        sparse_embedding_model.build_query.side_effect = ("sparse-full", "sparse-focused")
        qdrant_client = Mock()
        qdrant_client.collection_exists.return_value = True
        qdrant_client.get_aliases.return_value = qdrant_models.CollectionsAliasesResponse(
            aliases=[]
        )
        qdrant_client.query_points.side_effect = (
            qdrant_models.QueryResponse(
                points=[
                    qdrant_models.ScoredPoint(
                        id="point-history-0010",
                        version=0,
                        score=0.51,
                        payload={
                            "document_id": "curriculum:历史学（强基计划）本科人才培养方案",
                            "revision_track": "source-faithful",
                            "version_id": "v1:history-strong-base",
                            "chunk_id": "curriculum:历史学（强基计划）本科人才培养方案:chunk-0010",
                            "corpus": "curriculum",
                            "collection": "curriculum_plan",
                            "visibility_level": "public",
                            "status": "active",
                            "source_uri": "https://campus.example/curriculum/history-strong-base",
                            "canonical_url": "https://campus.example/curriculum/history-strong-base",
                            "latest_url": "https://campus.example/curriculum/history-strong-base",
                            "source_channel": "pdf_ocr",
                            "is_current": True,
                            "anchor": {
                                "section_path": [
                                    "历史学（强基计划）本科人才培养方案",
                                    "五、课程设置和修读建议",
                                    "(一)大类培养",
                                    "1. 通识教育",
                                ]
                            },
                            "text": (
                                "历史学（强基计划）本科人才培养方案\n"
                                "五、课程设置和修读建议\n"
                                "课程清单如下:\n"
                                "类别 | 课程号 | 课程名称 | 学分 | 学时 | 实践学时 | 修读学期\n"
                                "思政课 | 1037010044 | 中华民族共同体概论 | 2 | 36 | 12 | 4\n"
                                "培养课 | 1042010082 | 大学英语(四) | 2 | 54 | 36 | 4"
                            ),
                        },
                    ),
                ]
            ),
            qdrant_models.QueryResponse(
                points=[
                    qdrant_models.ScoredPoint(
                        id="point-history-0010",
                        version=0,
                        score=0.49,
                        payload={
                            "document_id": "curriculum:历史学（强基计划）本科人才培养方案",
                            "revision_track": "source-faithful",
                            "version_id": "v1:history-strong-base",
                            "chunk_id": "curriculum:历史学（强基计划）本科人才培养方案:chunk-0010",
                            "corpus": "curriculum",
                            "collection": "curriculum_plan",
                            "visibility_level": "public",
                            "status": "active",
                            "source_uri": "https://campus.example/curriculum/history-strong-base",
                            "canonical_url": "https://campus.example/curriculum/history-strong-base",
                            "latest_url": "https://campus.example/curriculum/history-strong-base",
                            "source_channel": "pdf_ocr",
                            "is_current": True,
                            "anchor": {
                                "section_path": [
                                    "历史学（强基计划）本科人才培养方案",
                                    "五、课程设置和修读建议",
                                    "(一)大类培养",
                                    "1. 通识教育",
                                ]
                            },
                            "text": (
                                "历史学（强基计划）本科人才培养方案\n"
                                "五、课程设置和修读建议\n"
                                "课程清单如下:\n"
                                "类别 | 课程号 | 课程名称 | 学分 | 学时 | 实践学时 | 修读学期\n"
                                "思政课 | 1037010044 | 中华民族共同体概论 | 2 | 36 | 12 | 4\n"
                                "培养课 | 1042010082 | 大学英语(四) | 2 | 54 | 36 | 4"
                            ),
                        },
                    ),
                ]
            ),
        )
        qdrant_client.scroll.return_value = (
            [
                qdrant_models.Record(
                    id="point-history-0010",
                    payload={
                        "document_id": "curriculum:历史学（强基计划）本科人才培养方案",
                        "revision_track": "source-faithful",
                        "version_id": "v1:history-strong-base",
                        "chunk_id": "curriculum:历史学（强基计划）本科人才培养方案:chunk-0010",
                        "corpus": "curriculum",
                        "collection": "curriculum_plan",
                        "visibility_level": "public",
                        "status": "active",
                        "source_uri": "https://campus.example/curriculum/history-strong-base",
                        "canonical_url": "https://campus.example/curriculum/history-strong-base",
                        "latest_url": "https://campus.example/curriculum/history-strong-base",
                        "source_channel": "pdf_ocr",
                        "is_current": True,
                        "anchor": {
                            "section_path": [
                                "历史学（强基计划）本科人才培养方案",
                                "五、课程设置和修读建议",
                                "(一)大类培养",
                                "1. 通识教育",
                            ]
                        },
                        "text": (
                            "历史学（强基计划）本科人才培养方案\n"
                            "五、课程设置和修读建议\n"
                            "课程清单如下:\n"
                            "类别 | 课程号 | 课程名称 | 学分 | 学时 | 实践学时 | 修读学期\n"
                            "思政课 | 1037010044 | 中华民族共同体概论 | 2 | 36 | 12 | 4\n"
                            "培养课 | 1042010082 | 大学英语(四) | 2 | 54 | 36 | 4"
                        ),
                    },
                ),
                qdrant_models.Record(
                    id="point-history-0014",
                    payload={
                        "document_id": "curriculum:历史学（强基计划）本科人才培养方案",
                        "revision_track": "source-faithful",
                        "version_id": "v1:history-strong-base",
                        "chunk_id": "curriculum:历史学（强基计划）本科人才培养方案:chunk-0014",
                        "corpus": "curriculum",
                        "collection": "curriculum_plan",
                        "visibility_level": "public",
                        "status": "active",
                        "source_uri": "https://campus.example/curriculum/history-strong-base",
                        "canonical_url": "https://campus.example/curriculum/history-strong-base",
                        "latest_url": "https://campus.example/curriculum/history-strong-base",
                        "source_channel": "pdf_ocr",
                        "is_current": True,
                        "anchor": {
                            "section_path": [
                                "历史学（强基计划）本科人才培养方案",
                                "五、课程设置和修读建议",
                                "(二)专业教育",
                                "1. 专业核心课程",
                            ]
                        },
                        "text": (
                            "历史学（强基计划）本科人才培养方案\n"
                            "五、课程设置和修读建议\n"
                            "课程清单如下:\n"
                            "类别 | 课程号 | 课程名称 | 学分 | 学时 | 实践学时 | 修读学期\n"
                            "专业核心课 | 1038030008 | 中国近代边疆民族史料研读 | 2 | 36 | / | 4\n"
                            "专业核心课 | 1038030011 | 世界现当代史 | 3 | 54 | / | 4\n"
                            "专业核心课 | 1038030012 | 中国史学史 | 2 | 36 | / | 5"
                        ),
                    },
                ),
            ],
            None,
        )
        backend = QdrantRetrievalBackend(
            settings=RetrievalSettings(
                qdrant_url=":memory:",
                document_registry_database_url="postgresql://registry.example/postgres",
            ),
            registry=registry,
            qdrant_client=qdrant_client,
            embedding_model=embedding_model,
            sparse_embedding_model=sparse_embedding_model,
        )

        result = backend.retrieve(
            RetrievalRequest(
                query_text="历史学（强基计划）本科人才培养方案里第四学期有什么课",
                corpus="curriculum",
                collection="curriculum_plan",
                top_k=5,
            )
        )

        self.assertEqual(qdrant_client.query_points.call_count, 2)
        qdrant_client.scroll.assert_called_once()
        scroll_filter = qdrant_client.scroll.call_args.kwargs["scroll_filter"]
        document_conditions = [
            condition
            for condition in scroll_filter.must or ()
            if getattr(condition, "key", None) == "document_id"
        ]
        self.assertEqual(len(document_conditions), 1)
        self.assertEqual(
            getattr(getattr(document_conditions[0], "match", None), "value", None),
            "curriculum:历史学（强基计划）本科人才培养方案",
        )
        self.assertIn(
            "curriculum:历史学（强基计划）本科人才培养方案:chunk-0010",
            tuple(source.chunk_id for source in result.sources),
        )
        self.assertIn(
            "curriculum:历史学（强基计划）本科人才培养方案:chunk-0014",
            tuple(source.chunk_id for source in result.sources),
        )

    def test_backend_targeted_overfetch_strategy_avoids_followup_support_query(self) -> None:
        embedding_model = Mock()
        embedding_model.get_query_embedding.return_value = (0.1, 0.2, 0.3)
        sparse_embedding_model = Mock()
        sparse_embedding_model.build_query.return_value = "sparse-targeted"
        qdrant_client = Mock()
        qdrant_client.collection_exists.return_value = True
        qdrant_client.get_aliases.return_value = qdrant_models.CollectionsAliasesResponse(
            aliases=[]
        )
        qdrant_client.query_points.return_value = qdrant_models.QueryResponse(
            points=[
                qdrant_models.ScoredPoint(
                    id="point-law-0010",
                    version=0,
                    score=0.61,
                    payload={
                        "document_id": "curriculum:法学（民族实验班）本科人才培养方案",
                        "revision_track": "source-faithful",
                        "version_id": "v1:law-ethnic-class",
                        "chunk_id": "curriculum:法学（民族实验班）本科人才培养方案:chunk-0010",
                        "corpus": "curriculum",
                        "collection": "curriculum_plan",
                        "visibility_level": "public",
                        "status": "active",
                        "source_uri": "https://campus.example/curriculum/law-ethnic-class",
                        "canonical_url": "https://campus.example/curriculum/law-ethnic-class",
                        "latest_url": "https://campus.example/curriculum/law-ethnic-class",
                        "source_channel": "pdf_ocr",
                        "is_current": True,
                        "anchor": {
                            "section_path": [
                                "法学（民族实验班）本科人才培养方案",
                                "五、课程设置和修读建议",
                                "(二)专业教育",
                                "1. 专业核心课程",
                            ]
                        },
                        "text": (
                            "法学（民族实验班）本科人才培养方案\n"
                            "五、课程设置和修读建议\n"
                            "课程清单如下:\n"
                            "类别 | 课程号 | 课程名称 | 学分 | 学时 | 实践学时 | 修读学期\n"
                            "专业核心课 | 1038030011 | 宪法学 | 3 | 54 | / | 4"
                        ),
                    },
                ),
                qdrant_models.ScoredPoint(
                    id="point-law-0014",
                    version=0,
                    score=0.6,
                    payload={
                        "document_id": "curriculum:法学（民族实验班）本科人才培养方案",
                        "revision_track": "source-faithful",
                        "version_id": "v1:law-ethnic-class",
                        "chunk_id": "curriculum:法学（民族实验班）本科人才培养方案:chunk-0014",
                        "corpus": "curriculum",
                        "collection": "curriculum_plan",
                        "visibility_level": "public",
                        "status": "active",
                        "source_uri": "https://campus.example/curriculum/law-ethnic-class",
                        "canonical_url": "https://campus.example/curriculum/law-ethnic-class",
                        "latest_url": "https://campus.example/curriculum/law-ethnic-class",
                        "source_channel": "pdf_ocr",
                        "is_current": True,
                        "anchor": {
                            "section_path": [
                                "法学（民族实验班）本科人才培养方案",
                                "五、课程设置和修读建议",
                                "(二)专业教育",
                                "2. 专业选修课程",
                            ]
                        },
                        "text": (
                            "法学（民族实验班）本科人才培养方案\n"
                            "五、课程设置和修读建议\n"
                            "课程清单如下:\n"
                            "类别 | 课程号 | 课程名称 | 学分 | 学时 | 实践学时 | 修读学期\n"
                            "专业选修课 | 1038030012 | 刑法学 | 3 | 54 | / | 4"
                        ),
                    },
                ),
            ]
        )
        backend = QdrantRetrievalBackend(
            settings=RetrievalSettings(
                qdrant_url=":memory:",
                document_registry_database_url="postgresql://registry.example/postgres",
            ),
            registry=InMemoryDocumentRegistry(),
            qdrant_client=qdrant_client,
            embedding_model=embedding_model,
            sparse_embedding_model=sparse_embedding_model,
        )

        with patch(
            "campus_retrieval_core.backend_qdrant.load_runtime_profile",
            return_value=_make_runtime_profile(
                corpus="curriculum",
                collection="curriculum_plan",
                retrieval_top_k=5,
                current_only=False,
                serving_revision_tracks=("source-faithful",),
                document_support_limit=24,
                document_support_strategy="targeted_overfetch",
            ),
        ):
            result = backend.retrieve(
                RetrievalRequest(
                    query_text="法学民族班培养方案里大二下有什么课？",
                    corpus="curriculum",
                    collection="curriculum_plan",
                    target_document_ids=("curriculum:法学（民族实验班）本科人才培养方案",),
                    top_k=5,
                )
            )

        self.assertEqual(qdrant_client.query_points.call_count, 1)
        qdrant_client.scroll.assert_not_called()
        self.assertEqual(qdrant_client.query_points.call_args.kwargs["limit"], 24)
        self.assertEqual(
            tuple(source.chunk_id for source in result.sources),
            (
                "curriculum:法学（民族实验班）本科人才培养方案:chunk-0010",
                "curriculum:法学（民族实验班）本科人才培养方案:chunk-0014",
            ),
        )

    def test_backend_targeted_overfetch_curriculum_title_target_query_recovers_same_doc_support_when_initial_results_are_too_narrow(
        self,
    ) -> None:
        embedding_model = Mock()
        embedding_model.get_query_embedding.side_effect = (
            (0.1, 0.2, 0.3),
            (0.4, 0.5, 0.6),
        )
        sparse_embedding_model = Mock()
        sparse_embedding_model.build_query.side_effect = ("sparse-initial", "sparse-focused")
        qdrant_client = Mock()
        qdrant_client.collection_exists.return_value = True
        qdrant_client.get_aliases.return_value = qdrant_models.CollectionsAliasesResponse(
            aliases=[]
        )
        qdrant_client.query_points.side_effect = (
            qdrant_models.QueryResponse(
                points=[
                    qdrant_models.ScoredPoint(
                        id="point-map-0023",
                        version=0,
                        score=0.63,
                        payload={
                            "document_id": "curriculum:经济学拔尖人才创新班人才培养方案",
                            "revision_track": "source-faithful",
                            "version_id": "v1:economics-innovation",
                            "chunk_id": "curriculum:经济学拔尖人才创新班人才培养方案:chunk-0023",
                            "corpus": "curriculum",
                            "collection": "curriculum_plan",
                            "visibility_level": "public",
                            "status": "active",
                            "source_uri": "https://campus.example/curriculum/economics-innovation",
                            "canonical_url": "https://campus.example/curriculum/economics-innovation",
                            "latest_url": "https://campus.example/curriculum/economics-innovation",
                            "source_channel": "pdf_ocr",
                            "is_current": True,
                            "anchor": {
                                "section_path": [
                                    "经济学拔尖人才创新班人才培养方案",
                                    "六、课程地图",
                                ]
                            },
                            "detail_label": "六、课程地图",
                            "content_kind": "section_text",
                            "content_role": "lead_overview",
                            "is_answer_bearing": True,
                            "text": "六、课程地图 经济学拔尖人才创新班本科课程结果拓扑图。",
                        },
                    ),
                ]
            ),
            qdrant_models.QueryResponse(
                points=[
                    qdrant_models.ScoredPoint(
                        id="point-map-0023",
                        version=0,
                        score=0.63,
                        payload={
                            "document_id": "curriculum:经济学拔尖人才创新班人才培养方案",
                            "revision_track": "source-faithful",
                            "version_id": "v1:economics-innovation",
                            "chunk_id": "curriculum:经济学拔尖人才创新班人才培养方案:chunk-0023",
                            "corpus": "curriculum",
                            "collection": "curriculum_plan",
                            "visibility_level": "public",
                            "status": "active",
                            "source_uri": "https://campus.example/curriculum/economics-innovation",
                            "canonical_url": "https://campus.example/curriculum/economics-innovation",
                            "latest_url": "https://campus.example/curriculum/economics-innovation",
                            "source_channel": "pdf_ocr",
                            "is_current": True,
                            "anchor": {
                                "section_path": [
                                    "经济学拔尖人才创新班人才培养方案",
                                    "六、课程地图",
                                ]
                            },
                            "detail_label": "六、课程地图",
                            "content_kind": "section_text",
                            "content_role": "lead_overview",
                            "is_answer_bearing": True,
                            "text": "六、课程地图 经济学拔尖人才创新班本科课程结果拓扑图。",
                        },
                    ),
                    qdrant_models.ScoredPoint(
                        id="point-core-0013",
                        version=0,
                        score=0.6,
                        payload={
                            "document_id": "curriculum:经济学拔尖人才创新班人才培养方案",
                            "revision_track": "source-faithful",
                            "version_id": "v1:economics-innovation",
                            "chunk_id": "curriculum:经济学拔尖人才创新班人才培养方案:chunk-0013",
                            "corpus": "curriculum",
                            "collection": "curriculum_plan",
                            "visibility_level": "public",
                            "status": "active",
                            "source_uri": "https://campus.example/curriculum/economics-innovation",
                            "canonical_url": "https://campus.example/curriculum/economics-innovation",
                            "latest_url": "https://campus.example/curriculum/economics-innovation",
                            "source_channel": "pdf_ocr",
                            "is_current": True,
                            "anchor": {
                                "section_path": [
                                    "经济学拔尖人才创新班人才培养方案",
                                    "五、课程设置和修读建议",
                                    "(二) 专业教育",
                                    "1. 专业核心课程",
                                ]
                            },
                            "detail_label": "1. 专业核心课程",
                            "content_kind": "table_unit",
                            "content_role": "table_fact",
                            "is_answer_bearing": True,
                            "text": (
                                "五、课程设置和修读建议\n"
                                "(二) 专业教育\n"
                                "1. 专业核心课程\n"
                                "专业核心课程 30 学分。\n"
                                "课程清单如下:\n"
                                "课程号 | 课程名称 | 学分 | 学时 | 实践学时 | 开设学期\n"
                                "1034040237 | 中级宏观经济学 | 3 | 54 | / | 4"
                            ),
                        },
                    ),
                    qdrant_models.ScoredPoint(
                        id="point-elective-0014",
                        version=0,
                        score=0.59,
                        payload={
                            "document_id": "curriculum:经济学拔尖人才创新班人才培养方案",
                            "revision_track": "source-faithful",
                            "version_id": "v1:economics-innovation",
                            "chunk_id": "curriculum:经济学拔尖人才创新班人才培养方案:chunk-0014",
                            "corpus": "curriculum",
                            "collection": "curriculum_plan",
                            "visibility_level": "public",
                            "status": "active",
                            "source_uri": "https://campus.example/curriculum/economics-innovation",
                            "canonical_url": "https://campus.example/curriculum/economics-innovation",
                            "latest_url": "https://campus.example/curriculum/economics-innovation",
                            "source_channel": "pdf_ocr",
                            "is_current": True,
                            "anchor": {
                                "section_path": [
                                    "经济学拔尖人才创新班人才培养方案",
                                    "五、课程设置和修读建议",
                                    "(二) 专业教育",
                                    "2. 专业选修课程",
                                ]
                            },
                            "detail_label": "2. 专业选修课程",
                            "content_kind": "table_unit",
                            "content_role": "table_fact",
                            "is_answer_bearing": True,
                            "text": (
                                "五、课程设置和修读建议\n"
                                "(二) 专业教育\n"
                                "2. 专业选修课程\n"
                                "专业选修课程至少任选 7 门课程,完成 14 学分。"
                            ),
                        },
                    ),
                ]
            ),
        )
        backend = QdrantRetrievalBackend(
            settings=RetrievalSettings(
                qdrant_url=":memory:",
                document_registry_database_url="postgresql://registry.example/postgres",
            ),
            registry=InMemoryDocumentRegistry(),
            qdrant_client=qdrant_client,
            embedding_model=embedding_model,
            sparse_embedding_model=sparse_embedding_model,
        )

        with patch(
            "campus_retrieval_core.backend_qdrant.load_runtime_profile",
            return_value=_make_runtime_profile(
                corpus="curriculum",
                collection="curriculum_plan",
                retrieval_top_k=5,
                current_only=False,
                serving_revision_tracks=("source-faithful",),
                document_support_limit=24,
                document_support_strategy="targeted_overfetch",
            ),
        ):
            result = backend.retrieve(
                RetrievalRequest(
                    query_text="经济学拔尖人才创新班人才培养方案课程地图怎么安排？",
                    corpus="curriculum",
                    collection="curriculum_plan",
                    target_document_ids=("curriculum:经济学拔尖人才创新班人才培养方案",),
                    top_k=5,
                )
            )

        self.assertEqual(qdrant_client.query_points.call_count, 2)
        self.assertEqual(qdrant_client.query_points.call_args_list[0].kwargs["limit"], 24)
        self.assertEqual(qdrant_client.query_points.call_args_list[1].kwargs["limit"], 24)
        self.assertEqual(embedding_model.get_query_embedding.call_count, 2)
        self.assertEqual(sparse_embedding_model.build_query.call_count, 2)
        self.assertEqual(
            tuple(source.chunk_id for source in result.sources),
            (
                "curriculum:经济学拔尖人才创新班人才培养方案:chunk-0023",
                "curriculum:经济学拔尖人才创新班人才培养方案:chunk-0013",
                "curriculum:经济学拔尖人才创新班人才培养方案:chunk-0014",
            ),
        )

    def test_backend_prioritizes_same_doc_course_list_chunks_over_other_semester_tables(
        self,
    ) -> None:
        registry = InMemoryDocumentRegistry()
        embedding_model = Mock()
        embedding_model.get_query_embedding.side_effect = (
            (0.1, 0.2, 0.3),
            (0.4, 0.5, 0.6),
        )
        sparse_embedding_model = Mock()
        sparse_embedding_model.build_query.side_effect = ("sparse-full", "sparse-focused")
        qdrant_client = Mock()
        qdrant_client.collection_exists.return_value = True
        qdrant_client.get_aliases.return_value = qdrant_models.CollectionsAliasesResponse(
            aliases=[]
        )
        qdrant_client.query_points.side_effect = (
            qdrant_models.QueryResponse(
                points=[
                    qdrant_models.ScoredPoint(
                        id="point-history-0032",
                        version=0,
                        score=0.57,
                        payload={
                            "document_id": "curriculum:历史学（强基计划）本科人才培养方案",
                            "revision_track": "source-faithful",
                            "version_id": "v1:history-strong-base",
                            "chunk_id": "curriculum:历史学（强基计划）本科人才培养方案:chunk-0032",
                            "corpus": "curriculum",
                            "collection": "curriculum_plan",
                            "visibility_level": "public",
                            "status": "active",
                            "source_uri": "https://campus.example/curriculum/history-strong-base",
                            "canonical_url": "https://campus.example/curriculum/history-strong-base",
                            "latest_url": "https://campus.example/curriculum/history-strong-base",
                            "source_channel": "pdf_ocr",
                            "is_current": True,
                            "anchor": {
                                "section_path": [
                                    "历史学（强基计划）本科人才培养方案",
                                    "七、其他说明",
                                ],
                                "table_group_id": "page-0158-block-3-0001",
                            },
                            "text": "七、其他说明\n学期 | 修读学分\n3 | 2\n4 | 4\n5 | 12\n6 | 6",
                        },
                    ),
                    qdrant_models.ScoredPoint(
                        id="point-history-0025",
                        version=0,
                        score=0.56,
                        payload={
                            "document_id": "curriculum:历史学（强基计划）本科人才培养方案",
                            "revision_track": "source-faithful",
                            "version_id": "v1:history-strong-base",
                            "chunk_id": "curriculum:历史学（强基计划）本科人才培养方案:chunk-0025",
                            "corpus": "curriculum",
                            "collection": "curriculum_plan",
                            "visibility_level": "public",
                            "status": "active",
                            "source_uri": "https://campus.example/curriculum/history-strong-base",
                            "canonical_url": "https://campus.example/curriculum/history-strong-base",
                            "latest_url": "https://campus.example/curriculum/history-strong-base",
                            "source_channel": "pdf_ocr",
                            "is_current": True,
                            "anchor": {
                                "section_path": [
                                    "历史学（强基计划）本科人才培养方案",
                                    "五、课程设置和修读建议",
                                    "(四) 实践环节",
                                    "1. 专业实践",
                                ],
                                "table_group_id": "page-0156-block-2-0001",
                            },
                            "text": (
                                "类别 | 学分 | 修读性质 | 学期 | 具体要求\n"
                                "专业实习 | 3 | 必修 | 4-6 | 以实习报告为依据"
                            ),
                        },
                    ),
                ]
            ),
            qdrant_models.QueryResponse(points=[]),
        )
        qdrant_client.scroll.return_value = (
            [
                qdrant_models.Record(
                    id="point-history-0010",
                    payload={
                        "document_id": "curriculum:历史学（强基计划）本科人才培养方案",
                        "revision_track": "source-faithful",
                        "version_id": "v1:history-strong-base",
                        "chunk_id": "curriculum:历史学（强基计划）本科人才培养方案:chunk-0010",
                        "corpus": "curriculum",
                        "collection": "curriculum_plan",
                        "visibility_level": "public",
                        "status": "active",
                        "source_uri": "https://campus.example/curriculum/history-strong-base",
                        "canonical_url": "https://campus.example/curriculum/history-strong-base",
                        "latest_url": "https://campus.example/curriculum/history-strong-base",
                        "source_channel": "pdf_ocr",
                        "is_current": True,
                        "anchor": {
                            "section_path": [
                                "历史学（强基计划）本科人才培养方案",
                                "五、课程设置和修读建议",
                                "(一)大类培养",
                                "1. 通识教育",
                            ],
                            "table_group_id": "page-0150-block-6-0007",
                        },
                        "text": (
                            "课程清单如下:\n"
                            "类别 | 课程号 | 课程名称 | 学分 | 学时 | 实践学时 | 修读学期\n"
                            "思政课 | 1037010044 | 中华民族共同体概论 | 2 | 36 | 12 | 4\n"
                            "培养课 | 1042010082 | 大学英语(四) | 2 | 54 | 36 | 4"
                        ),
                    },
                ),
                qdrant_models.Record(
                    id="point-history-0014",
                    payload={
                        "document_id": "curriculum:历史学（强基计划）本科人才培养方案",
                        "revision_track": "source-faithful",
                        "version_id": "v1:history-strong-base",
                        "chunk_id": "curriculum:历史学（强基计划）本科人才培养方案:chunk-0014",
                        "corpus": "curriculum",
                        "collection": "curriculum_plan",
                        "visibility_level": "public",
                        "status": "active",
                        "source_uri": "https://campus.example/curriculum/history-strong-base",
                        "canonical_url": "https://campus.example/curriculum/history-strong-base",
                        "latest_url": "https://campus.example/curriculum/history-strong-base",
                        "source_channel": "pdf_ocr",
                        "is_current": True,
                        "anchor": {
                            "section_path": [
                                "历史学（强基计划）本科人才培养方案",
                                "五、课程设置和修读建议",
                                "(二)专业教育",
                                "1. 专业核心课程",
                            ],
                            "table_group_id": "page-0153-block-5-0002",
                        },
                        "text": (
                            "课程清单如下:\n"
                            "类别 | 课程号 | 课程名称 | 学分 | 学时 | 实践学时 | 修读学期\n"
                            "专业核心课 | 1038030008 | 中国近代边疆民族史料研读 | 2 | 36 | / | 4\n"
                            "专业核心课 | 1038030011 | 世界现当代史 | 3 | 54 | / | 4\n"
                            "专业核心课 | 1038030012 | 中国史学史 | 2 | 36 | / | 5"
                        ),
                    },
                ),
                qdrant_models.Record(
                    id="point-history-0025",
                    payload={
                        "document_id": "curriculum:历史学（强基计划）本科人才培养方案",
                        "revision_track": "source-faithful",
                        "version_id": "v1:history-strong-base",
                        "chunk_id": "curriculum:历史学（强基计划）本科人才培养方案:chunk-0025",
                        "corpus": "curriculum",
                        "collection": "curriculum_plan",
                        "visibility_level": "public",
                        "status": "active",
                        "source_uri": "https://campus.example/curriculum/history-strong-base",
                        "canonical_url": "https://campus.example/curriculum/history-strong-base",
                        "latest_url": "https://campus.example/curriculum/history-strong-base",
                        "source_channel": "pdf_ocr",
                        "is_current": True,
                        "anchor": {
                            "section_path": [
                                "历史学（强基计划）本科人才培养方案",
                                "五、课程设置和修读建议",
                                "(四) 实践环节",
                                "1. 专业实践",
                            ],
                            "table_group_id": "page-0156-block-2-0001",
                        },
                        "text": (
                            "类别 | 学分 | 修读性质 | 学期 | 具体要求\n"
                            "专业实习 | 3 | 必修 | 4-6 | 以实习报告为依据"
                        ),
                    },
                ),
            ],
            None,
        )
        backend = QdrantRetrievalBackend(
            settings=RetrievalSettings(
                qdrant_url=":memory:",
                document_registry_database_url="postgresql://registry.example/postgres",
            ),
            registry=registry,
            qdrant_client=qdrant_client,
            embedding_model=embedding_model,
            sparse_embedding_model=sparse_embedding_model,
        )

        result = backend.retrieve(
            RetrievalRequest(
                query_text="历史学（强基计划）本科人才培养方案里第四学期有什么课",
                corpus="curriculum",
                collection="curriculum_plan",
                top_k=5,
            )
        )

        self.assertEqual(
            {source.chunk_id for source in result.sources[:2]},
            {
                "curriculum:历史学（强基计划）本科人才培养方案:chunk-0010",
                "curriculum:历史学（强基计划）本科人才培养方案:chunk-0014",
            },
        )

    def test_prefer_curriculum_semester_course_list_sources_keeps_core_and_general_sections_in_front(
        self,
    ) -> None:
        reordered = _prefer_curriculum_semester_course_list_sources(
            query_text="历史学（强基计划）本科人才培养方案里第四学期有什么课",
            sources=(
                _make_source(
                    doc_id="curriculum:历史学（强基计划）本科人才培养方案",
                    chunk_id="curriculum:历史学（强基计划）本科人才培养方案:chunk-0010",
                    snippet=(
                        "五、课程设置和修读建议\n\n"
                        "(一)大类培养\n\n"
                        "1. 通识教育\n\n"
                        "课程清单如下:\n"
                        "类别 | 课程号 | 课程名称 | 学分 | 学时 | 实践学时 | 修读学期\n"
                        "思政课 | 1037010044 | 中华民族共同体概论 | 2 | 36 | 12 | 4\n"
                        "培养课 | 1042010082 | 大学英语(四) | 2 | 54 | 36 | 4"
                    ),
                    score=1.0,
                    source_title="历史学（强基计划）本科人才培养方案",
                    structural_path=(
                        "历史学（强基计划）本科人才培养方案",
                        "五、课程设置和修读建议",
                        "(一)大类培养",
                        "1. 通识教育",
                    ),
                    content_kind="table_unit",
                    content_role="table_fact",
                    is_answer_bearing=True,
                ),
                _make_source(
                    doc_id="curriculum:历史学（强基计划）本科人才培养方案",
                    chunk_id="curriculum:历史学（强基计划）本科人才培养方案:chunk-0011",
                    snippet=(
                        "五、课程设置和修读建议\n\n"
                        "(一)大类培养\n\n"
                        "1. 通识教育\n\n"
                        "课程清单如下:\n"
                        "类别 | 课程号 | 课程名称 | 学分 | 学时 | 实践学时 | 修读学期\n"
                        "基本素养课 | 1049020004 | 大学体育(四) | 1 | 36 | 36 | 4"
                    ),
                    score=1.0,
                    source_title="历史学（强基计划）本科人才培养方案",
                    structural_path=(
                        "历史学（强基计划）本科人才培养方案",
                        "五、课程设置和修读建议",
                        "(一)大类培养",
                        "1. 通识教育",
                    ),
                    content_kind="table_unit",
                    content_role="table_fact",
                    is_answer_bearing=True,
                ),
                _make_source(
                    doc_id="curriculum:历史学（强基计划）本科人才培养方案",
                    chunk_id="curriculum:历史学（强基计划）本科人才培养方案:chunk-0018",
                    snippet=(
                        "五、课程设置和修读建议\n\n"
                        "(二)专业教育\n\n"
                        "2. 专业选修课程\n\n"
                        "课程清单如下:\n"
                        "专业方向名称 | 课程号 | 课程名称 | 学分 | 学时 | 实践学时 | 开设学期\n"
                        "强基班 | 1040040061 | 满族史 | 2 | 36 | / | 4\n"
                        "强基班 | 1040040228 | 满文文献选读 | 2 | 36 | / | 4\n"
                        "强基班 | 1040040239 | 中国传统村落概要 | 2 | 36 | / | 4\n"
                        "强基班 | 1040040160 | 回族史 | 2 | 36 | / | 4"
                    ),
                    score=1.0,
                    source_title="历史学（强基计划）本科人才培养方案",
                    structural_path=(
                        "历史学（强基计划）本科人才培养方案",
                        "五、课程设置和修读建议",
                        "(二)专业教育",
                        "2. 专业选修课程",
                    ),
                    content_kind="table_unit",
                    content_role="table_fact",
                    is_answer_bearing=True,
                ),
                _make_source(
                    doc_id="curriculum:历史学（强基计划）本科人才培养方案",
                    chunk_id="curriculum:历史学（强基计划）本科人才培养方案:chunk-0019",
                    snippet=(
                        "五、课程设置和修读建议\n\n"
                        "(二)专业教育\n\n"
                        "2. 专业选修课程\n\n"
                        "课程清单如下:\n"
                        "专业方向名称 | 课程号 | 课程名称 | 学分 | 学时 | 实践学时 | 开设学期\n"
                        "强基班 | 1040040140 | 亚太地区史专题 | 2 | 36 | / | 4\n"
                        "强基班 | 1040040227 | 冷战史专题 | 2 | 36 | / | 4"
                    ),
                    score=1.0,
                    source_title="历史学（强基计划）本科人才培养方案",
                    structural_path=(
                        "历史学（强基计划）本科人才培养方案",
                        "五、课程设置和修读建议",
                        "(二)专业教育",
                        "2. 专业选修课程",
                    ),
                    content_kind="table_unit",
                    content_role="table_fact",
                    is_answer_bearing=True,
                ),
                _make_source(
                    doc_id="curriculum:历史学（强基计划）本科人才培养方案",
                    chunk_id="curriculum:历史学（强基计划）本科人才培养方案:chunk-0014",
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
                    score=1.0,
                    source_title="历史学（强基计划）本科人才培养方案",
                    structural_path=(
                        "历史学（强基计划）本科人才培养方案",
                        "五、课程设置和修读建议",
                        "(二)专业教育",
                        "1. 专业核心课程",
                    ),
                    content_kind="table_unit",
                    content_role="table_fact",
                    is_answer_bearing=True,
                ),
                _make_source(
                    doc_id="curriculum:历史学（强基计划）本科人才培养方案",
                    chunk_id="curriculum:历史学（强基计划）本科人才培养方案:chunk-0013",
                    snippet=(
                        "五、课程设置和修读建议\n\n"
                        "(一)大类培养\n\n"
                        "2. 学科基础教育\n\n"
                        "课程清单如下:\n"
                        "课程号 | 课程名称 | 学分 | 学时 | 实践学时 | 修读学期\n"
                        "1040030117 | 人文学科研究方法 | 3 | 54 | / | 4"
                    ),
                    score=1.0,
                    source_title="历史学（强基计划）本科人才培养方案",
                    structural_path=(
                        "历史学（强基计划）本科人才培养方案",
                        "五、课程设置和修读建议",
                        "(一)大类培养",
                        "2. 学科基础教育",
                    ),
                    content_kind="table_unit",
                    content_role="table_fact",
                    is_answer_bearing=True,
                ),
            ),
        )

        first_three = tuple(source.chunk_id for source in reordered[:3])
        self.assertIn("curriculum:历史学（强基计划）本科人才培养方案:chunk-0010", first_three)
        self.assertIn("curriculum:历史学（强基计划）本科人才培养方案:chunk-0014", first_three)
        self.assertLess(
            next(
                index
                for index, source in enumerate(reordered)
                if source.chunk_id.endswith("chunk-0014")
            ),
            next(
                index
                for index, source in enumerate(reordered)
                if source.chunk_id.endswith("chunk-0019")
            ),
        )
