from __future__ import annotations

from campus_retrieval_core.backend_qdrant_policies import finalize_retrieval_sources

from tests.retrieval.backend_qdrant_test_support import (
    _apply_document_diversity_policy,
    _apply_official_web_low_signal_policy,
    _make_runtime_profile,
    _make_source,
    unittest,
)


class BackendQdrantPolicyTest(unittest.TestCase):
    def test_finalize_retrieval_sources_locks_curriculum_title_query_to_unique_document(
        self,
    ) -> None:
        profile = _make_runtime_profile(corpus="curriculum", collection="curriculum_plan")

        finalized = finalize_retrieval_sources(
            profile=profile,
            query_text="信息与计算科学本科人才培养方案",
            sources=(
                _make_source(
                    doc_id="curriculum:信息与计算科学（民族实验班）本科人才培养方案",
                    chunk_id="curriculum:ics-ethnic:chunk-0001",
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

        self.assertEqual(
            tuple(source.doc_id for source in finalized),
            ("curriculum:信息与计算科学本科人才培养方案",),
        )

    def test_finalize_retrieval_sources_uses_curriculum_family_alias_major_candidates(
        self,
    ) -> None:
        profile = _make_runtime_profile(corpus="curriculum", collection="curriculum_plan")

        finalized = finalize_retrieval_sources(
            profile=profile,
            query_text="中国少数民族语言文学强基计划本科人才培养方案",
            sources=(
                _make_source(
                    doc_id="curriculum:中国少数民族语言文学（古文字学方向）强基计划本科人才培养方案",
                    chunk_id="curriculum:minority-language-strong-base:chunk-0001",
                    snippet="中国少数民族语言文学（古文字学方向）强基计划本科人才培养方案 一、培养目标。",
                    score=0.91,
                    source_title="中国少数民族语言文学（古文字学方向）强基计划本科人才培养方案",
                    structural_path=(
                        "中国少数民族语言文学（古文字学方向）强基计划本科人才培养方案",
                        "一、培养目标",
                    ),
                ),
                _make_source(
                    doc_id="curriculum:中国少数民族语言文学本科人才培养方案",
                    chunk_id="curriculum:minority-language-ordinary:chunk-0001",
                    snippet="中国少数民族语言文学本科人才培养方案 一、培养目标。",
                    score=0.89,
                    source_title="中国少数民族语言文学本科人才培养方案",
                    structural_path=("中国少数民族语言文学本科人才培养方案", "一、培养目标"),
                ),
            ),
        )

        self.assertEqual(
            tuple(source.doc_id for source in finalized),
            ("curriculum:中国少数民族语言文学（古文字学方向）强基计划本科人才培养方案",),
        )

    def test_finalize_retrieval_sources_prefers_curriculum_title_overview_before_tables(
        self,
    ) -> None:
        profile = _make_runtime_profile(corpus="curriculum", collection="curriculum_plan")
        title = "民族学本科人才培养方案"

        finalized = finalize_retrieval_sources(
            profile=profile,
            query_text=title,
            sources=(
                _make_source(
                    doc_id=f"curriculum:{title}",
                    chunk_id=f"curriculum:{title}:chunk-0012",
                    snippet=(
                        "五、课程设置和修读建议 课程号 | 课程名称 | 学分 | 学时 | "
                        "实践学时 | 修读学期 1026030031 | 民族学导论 | 2 | 36 | 8 | 1"
                    ),
                    score=0.92,
                    source_title=title,
                    structural_path=(title, "五、课程设置和修读建议", "(一) 大类培养"),
                    content_kind="table_unit",
                    content_role="table_fact",
                    is_answer_bearing=True,
                ),
                _make_source(
                    doc_id=f"curriculum:{title}",
                    chunk_id=f"curriculum:{title}:chunk-0001",
                    snippet=(
                        "民族学本科人才培养方案 一、培养目标 本专业培养具有民族学理论基础"
                        "和田野调查能力的人才。"
                    ),
                    score=0.64,
                    source_title=title,
                    structural_path=(title, "一、培养目标"),
                    content_kind="section_text",
                    content_role="",
                    is_answer_bearing=False,
                ),
                _make_source(
                    doc_id=f"curriculum:{title}",
                    chunk_id=f"curriculum:{title}:chunk-0005",
                    snippet="三、学制、总学分和学位授予 学制:4年 总学分:159 学分 学位授予:法学学士",
                    score=0.63,
                    source_title=title,
                    structural_path=(title, "三、学制、总学分和学位授予"),
                    content_kind="section_text",
                    content_role="",
                    is_answer_bearing=False,
                ),
            ),
        )

        self.assertEqual(
            tuple(source.chunk_id for source in finalized[:2]),
            (
                f"curriculum:{title}:chunk-0001",
                f"curriculum:{title}:chunk-0005",
            ),
        )

    def test_finalize_retrieval_sources_prefers_curriculum_course_map_section_before_tables(
        self,
    ) -> None:
        profile = _make_runtime_profile(corpus="curriculum", collection="curriculum_plan")
        title = "经济学拔尖人才创新班人才培养方案"

        finalized = finalize_retrieval_sources(
            profile=profile,
            query_text=f"{title}课程地图怎么安排？",
            sources=(
                _make_source(
                    doc_id=f"curriculum:{title}",
                    chunk_id=f"curriculum:{title}:chunk-0013",
                    snippet=(
                        "五、课程设置和修读建议 1. 专业核心课程 课程号 | 课程名称 | 学分 | "
                        "开设学期 1034040237 | 中级宏观经济学 | 3 | 4"
                    ),
                    score=0.6,
                    source_title=title,
                    structural_path=(title, "五、课程设置和修读建议", "1. 专业核心课程"),
                    content_kind="table_unit",
                    content_role="table_fact",
                    is_answer_bearing=True,
                ),
                _make_source(
                    doc_id=f"curriculum:{title}",
                    chunk_id=f"curriculum:{title}:chunk-0023",
                    snippet="六、课程地图 经济学拔尖人才创新班本科课程结果拓扑图。",
                    score=0.63,
                    source_title=title,
                    structural_path=(title, "六、课程地图"),
                    content_kind="section_text",
                    content_role="lead_overview",
                    detail_label="六、课程地图",
                    is_answer_bearing=True,
                ),
                _make_source(
                    doc_id=f"curriculum:{title}",
                    chunk_id=f"curriculum:{title}:chunk-0014",
                    snippet="五、课程设置和修读建议 2. 专业选修课程至少任选 7 门课程。",
                    score=0.59,
                    source_title=title,
                    structural_path=(title, "五、课程设置和修读建议", "2. 专业选修课程"),
                    content_kind="table_unit",
                    content_role="table_fact",
                    is_answer_bearing=True,
                ),
            ),
        )

        self.assertEqual(
            tuple(source.chunk_id for source in finalized),
            (
                f"curriculum:{title}:chunk-0023",
                f"curriculum:{title}:chunk-0013",
                f"curriculum:{title}:chunk-0014",
            ),
        )

    def test_finalize_retrieval_sources_locks_curriculum_course_query_to_unique_program_semester(
        self,
    ) -> None:
        profile = _make_runtime_profile(corpus="curriculum", collection="curriculum_plan")

        finalized = finalize_retrieval_sources(
            profile=profile,
            query_text="法学民族班培养方案里大二下有什么课",
            sources=(
                _make_source(
                    doc_id="curriculum:信息与计算科学（民族实验班）本科人才培养方案",
                    chunk_id="curriculum:ics-ethnic:chunk-0004",
                    snippet=(
                        "信息与计算科学（民族实验班）本科人才培养方案\n第四学期 | 数学分析 | 4"
                    ),
                    score=0.86,
                    source_title="信息与计算科学（民族实验班）本科人才培养方案",
                    structural_path=("信息与计算科学（民族实验班）本科人才培养方案", "第四学期"),
                    content_kind="table_unit",
                    content_role="table_fact",
                ),
                _make_source(
                    doc_id="curriculum:法学（民族实验班）本科人才培养方案",
                    chunk_id="curriculum:law-ethnic:chunk-0004",
                    snippet="第四学期 | 侵权责任法 | 2",
                    score=0.64,
                    source_title="法学（民族实验班）本科人才培养方案",
                    structural_path=("法学（民族实验班）本科人才培养方案", "第四学期"),
                    content_kind="table_unit",
                    content_role="table_fact",
                ),
                _make_source(
                    doc_id="curriculum:法学（民族实验班）本科人才培养方案",
                    chunk_id="curriculum:law-ethnic:chunk-0003",
                    snippet="第三学期 | 民法总论 | 3",
                    score=0.63,
                    source_title="法学（民族实验班）本科人才培养方案",
                    structural_path=("法学（民族实验班）本科人才培养方案", "第三学期"),
                    content_kind="table_unit",
                    content_role="table_fact",
                ),
            ),
        )

        self.assertEqual(
            tuple(source.chunk_id for source in finalized),
            ("curriculum:law-ethnic:chunk-0004",),
        )

    def test_apply_official_web_low_signal_policy_fail_closes_generic_campus_name_query(
        self,
    ) -> None:
        profile = _make_runtime_profile(
            corpus="official_web",
            collection="stable_reference",
            serving_surface="stable_reference",
        )

        filtered = _apply_official_web_low_signal_policy(
            profile=profile,
            query_text="中央民族大学",
            sources=(
                _make_source(
                    doc_id="official_web:muc_public_pages:article:news-1",
                    chunk_id="official-web:news-1",
                    snippet="中央民族大学召开专题工作会议。",
                    score=0.93,
                    collection="stable_reference",
                    source_channel="official_web",
                    source_title="中央民族大学召开专题工作会议",
                    content_role="primary_content",
                    is_answer_bearing=True,
                ),
            ),
        )

        self.assertEqual(filtered, ())

    def test_apply_official_web_low_signal_policy_fail_closes_unanchored_life_service_query(
        self,
    ) -> None:
        profile = _make_runtime_profile(
            corpus="official_web",
            collection="stable_reference",
            serving_surface="stable_reference",
        )

        filtered = _apply_official_web_low_signal_policy(
            profile=profile,
            query_text="食堂营业时间",
            sources=(
                _make_source(
                    doc_id="official_web:muc_public_pages:article:news-2",
                    chunk_id="official-web:news-2",
                    snippet="中央民族大学与北京丰台人才集团共建就业实习实践基地。",
                    score=0.89,
                    collection="stable_reference",
                    source_channel="official_web",
                    source_title="中央民族大学与北京丰台人才集团共建就业实习实践基地",
                    content_role="primary_content",
                    is_answer_bearing=True,
                ),
            ),
        )

        self.assertEqual(filtered, ())

    def test_apply_official_web_low_signal_policy_fail_closes_unanchored_stable_reference_service_query(
        self,
    ) -> None:
        profile = _make_runtime_profile(
            corpus="official_web",
            collection="stable_reference",
            serving_surface="stable_reference",
        )

        filtered = _apply_official_web_low_signal_policy(
            profile=profile,
            query_text="中央民族大学火星校区宇宙签证办理处",
            sources=(
                _make_source(
                    doc_id="official_web:muc_public:article_detail:school-overview",
                    chunk_id="official-web:school-overview:chunk-0001",
                    snippet="学校现有北京海淀、丰台和海南陵水黎安国际教育创新试验区三个校区。",
                    score=0.92,
                    collection="stable_reference",
                    source_channel="official_web",
                    source_title="学校概况",
                    content_role="primary_content",
                    is_answer_bearing=True,
                ),
                _make_source(
                    doc_id="official_web:muc_public:article_detail:school-profile",
                    chunk_id="official-web:school-profile:chunk-0001",
                    snippet="中央民族大学是党和国家为解决民族问题而创建的一所特色鲜明的高等院校。",
                    score=0.91,
                    collection="stable_reference",
                    source_channel="official_web",
                    source_title="学校简介",
                    content_role="primary_content",
                    is_answer_bearing=True,
                ),
                _make_source(
                    doc_id="official_web:muc_public:article_detail:leaders",
                    chunk_id="official-web:leaders:chunk-0001",
                    snippet="现任领导包括学校党委和行政领导。",
                    score=0.9,
                    collection="stable_reference",
                    source_channel="official_web",
                    source_title="现任领导",
                    content_role="primary_content",
                    is_answer_bearing=True,
                ),
            ),
        )

        self.assertEqual(filtered, ())

    def test_apply_official_web_low_signal_policy_keeps_admitted_stable_reference_query(
        self,
    ) -> None:
        profile = _make_runtime_profile(
            corpus="official_web",
            collection="stable_reference",
            serving_surface="stable_reference",
        )

        filtered = _apply_official_web_low_signal_policy(
            profile=profile,
            query_text="中央民族大学学校简介",
            sources=(
                _make_source(
                    doc_id="official_web:muc_public:article_detail:e286aba2b39208a26af21e9dd518afc6faa49487",
                    chunk_id="official-web:school-profile:chunk-1",
                    snippet="中央民族大学是党和国家为解决民族问题而创建的一所特色鲜明的高等院校。",
                    score=0.91,
                    collection="stable_reference",
                    source_channel="official_web",
                    source_title="学校简介",
                    content_role="primary_content",
                    is_answer_bearing=True,
                ),
            ),
        )

        self.assertEqual(len(filtered), 1)

    def test_apply_official_web_low_signal_policy_does_not_treat_mixed_inventory_as_query_surface(
        self,
    ) -> None:
        profile = _make_runtime_profile(
            corpus="official_web",
            collection="muc_public_pages",
            serving_surface="mixed",
            supports_freshness_sensitive_queries=False,
        )

        filtered = _apply_official_web_low_signal_policy(
            profile=profile,
            query_text="中央民族大学今天有什么讲座",
            sources=(
                _make_source(
                    doc_id="official_web:muc_public_pages:article:notice-1",
                    chunk_id="official-web:notice-1",
                    snippet="民图一小时信息素养讲座将于4月2日14:00在丰台校区图书馆视听空间125室举行。",
                    score=0.92,
                    collection="muc_public_pages",
                    source_title="民图一小时信息素养讲座",
                    content_role="primary_content",
                    is_answer_bearing=True,
                ),
            ),
        )

        self.assertEqual(len(filtered), 1)

    def test_apply_official_web_low_signal_policy_applies_to_stable_reference_scope(self) -> None:
        profile = _make_runtime_profile(
            corpus="official_web",
            collection="stable_reference",
            serving_surface="stable_reference",
            supports_freshness_sensitive_queries=False,
        )

        filtered = _apply_official_web_low_signal_policy(
            profile=profile,
            query_text="中央民族大学今天有什么讲座",
            sources=(
                _make_source(
                    doc_id="official_web:stable_reference:article:notice-1",
                    chunk_id="official-web:stable-reference:notice-1",
                    snippet="讲座将于4月2日14:00举行。",
                    score=0.92,
                    collection="stable_reference",
                    source_channel="official_web",
                    source_title="讲座预告",
                    content_role="primary_content",
                    is_answer_bearing=True,
                ),
            ),
        )

        self.assertEqual(filtered, ())

    def test_apply_document_diversity_policy_collapses_same_doc_official_web_results(self) -> None:
        profile = _make_runtime_profile(
            corpus="official_web",
            collection="stable_reference",
            serving_surface="stable_reference",
        )

        collapsed = _apply_document_diversity_policy(
            profile=profile,
            query_text="中央民族大学与北京丰台人才集团共建就业实习实践基地",
            sources=(
                _make_source(
                    doc_id="official_web:muc_public:article_detail:e286aba2b39208a26af21e9dd518afc6faa49487",
                    chunk_id="official-web:school-profile:chunk-1",
                    snippet="中央民族大学是党和国家为解决民族问题而创建的一所特色鲜明的高等院校。",
                    score=0.93,
                    collection="stable_reference",
                    source_channel="official_web",
                    source_title="学校简介",
                    content_role="primary_content",
                    is_answer_bearing=True,
                ),
                _make_source(
                    doc_id="official_web:muc_public:article_detail:e286aba2b39208a26af21e9dd518afc6faa49487",
                    chunk_id="official-web:school-profile:chunk-2",
                    snippet="学校前身是延安民族学院。",
                    score=0.91,
                    collection="stable_reference",
                    source_channel="official_web",
                    source_title="学校简介",
                    content_role="supporting_detail",
                ),
                _make_source(
                    doc_id="official_web:muc_public:directory_page:b8993ee7004c02e028bc5f6bb166e26ac4eb5afc",
                    chunk_id="official-web:teaching-units:chunk-1",
                    snippet="教学和科研单位包括民族学与社会学学院、信息工程学院等。",
                    score=0.89,
                    collection="stable_reference",
                    source_channel="official_web",
                    source_title="教学和科研单位",
                    content_role="primary_content",
                    is_answer_bearing=True,
                ),
            ),
        )

        self.assertEqual(
            tuple((source.doc_id, source.chunk_id) for source in collapsed),
            (
                (
                    "official_web:muc_public:article_detail:e286aba2b39208a26af21e9dd518afc6faa49487",
                    "official-web:school-profile:chunk-1",
                ),
                (
                    "official_web:muc_public:directory_page:b8993ee7004c02e028bc5f6bb166e26ac4eb5afc",
                    "official-web:teaching-units:chunk-1",
                ),
            ),
        )

    def test_apply_document_diversity_policy_keeps_other_collections_unchanged(self) -> None:
        profile = _make_runtime_profile()
        original_sources = (
            _make_source(
                doc_id="handbook:library",
                chunk_id="handbook:library:chunk-1",
                snippet="图书馆开放时间为 08:00-22:00。",
                score=0.93,
                collection="student_rules",
            ),
            _make_source(
                doc_id="handbook:library",
                chunk_id="handbook:library:chunk-2",
                snippet="图书馆节假日开放时间另行通知。",
                score=0.91,
                collection="student_rules",
            ),
        )

        self.assertEqual(
            _apply_document_diversity_policy(
                profile=profile,
                query_text="图书馆开放时间",
                sources=original_sources,
            ),
            original_sources,
        )

    def test_apply_document_diversity_policy_locks_official_web_title_target_to_single_doc(
        self,
    ) -> None:
        profile = _make_runtime_profile(
            corpus="official_web",
            collection="stable_reference",
            serving_surface="stable_reference",
        )

        collapsed = _apply_document_diversity_policy(
            profile=profile,
            query_text="中央民族大学学校简介",
            sources=(
                _make_source(
                    doc_id="official_web:muc_public:article_detail:e286aba2b39208a26af21e9dd518afc6faa49487",
                    chunk_id="official-web:school-profile:chunk-1",
                    snippet="中央民族大学学校简介。",
                    score=0.91,
                    collection="stable_reference",
                    source_channel="official_web",
                    source_title="学校简介",
                    content_role="primary_content",
                    is_answer_bearing=True,
                ),
                _make_source(
                    doc_id="official_web:muc_public:article_detail:36021906c0348aa73ed1f5467c4cb57954295e85",
                    chunk_id="official-web:school-overview:chunk-1",
                    snippet="学校概况包含学校简介等内容。",
                    score=0.93,
                    collection="stable_reference",
                    source_channel="official_web",
                    source_title="学校概况",
                    structural_path=("学校概况", "学校简介"),
                    content_role="primary_content",
                    is_answer_bearing=True,
                ),
            ),
        )

        self.assertEqual(
            tuple((source.doc_id, source.chunk_id) for source in collapsed),
            (
                (
                    "official_web:muc_public:article_detail:e286aba2b39208a26af21e9dd518afc6faa49487",
                    "official-web:school-profile:chunk-1",
                ),
            ),
        )

    def test_apply_document_diversity_policy_prefers_lead_chunk_for_title_targeted_official_web_reference_doc(
        self,
    ) -> None:
        profile = _make_runtime_profile(
            corpus="official_web",
            collection="stable_reference",
            serving_surface="stable_reference",
        )

        collapsed = _apply_document_diversity_policy(
            profile=profile,
            query_text="中央民族大学学校简介",
            sources=(
                _make_source(
                    doc_id="official_web:muc_public:article_detail:e286aba2b39208a26af21e9dd518afc6faa49487",
                    chunk_id="school-profile:chunk-0003",
                    snippet="2021年，“中央民族学院开学”入选《中国共产党一百年大事记》。学校拥有一支结构合理的高水平师资队伍。",
                    score=0.95,
                    collection="stable_reference",
                    source_channel="official_web",
                    source_title="学校简介",
                    structural_path=("学校概况", "学校简介"),
                    content_kind="section_text",
                    content_role="primary_content",
                ),
                _make_source(
                    doc_id="official_web:muc_public:article_detail:e286aba2b39208a26af21e9dd518afc6faa49487",
                    chunk_id="school-profile:chunk-0001",
                    snippet="中央民族大学是党和国家为解决民族问题、培养各民族干部和高级专门人才而创建的一所特色鲜明的高等院校。",
                    score=0.91,
                    collection="stable_reference",
                    source_channel="official_web",
                    source_title="学校简介",
                    structural_path=("学校概况", "学校简介"),
                    content_kind="section_text",
                    content_role="primary_content",
                ),
            ),
        )

        self.assertEqual(
            tuple((source.doc_id, source.chunk_id) for source in collapsed),
            (
                (
                    "official_web:muc_public:article_detail:e286aba2b39208a26af21e9dd518afc6faa49487",
                    "school-profile:chunk-0001",
                ),
            ),
        )

    def test_apply_document_diversity_policy_keeps_directory_reference_entries_for_list_query(
        self,
    ) -> None:
        profile = _make_runtime_profile(
            corpus="official_web",
            collection="stable_reference",
            serving_surface="stable_reference",
        )

        sources = (
            _make_source(
                doc_id="official_web:muc_public:directory_page:b8993ee7004c02e028bc5f6bb166e26ac4eb5afc",
                chunk_id="teaching-units:chunk-0002",
                snippet="标题：教学和科研单位 | 章节：中华民族共同体学院\n民族学与社会学学院",
                score=0.91,
                collection="stable_reference",
                source_channel="official_web",
                source_title="教学和科研单位",
                structural_path=("组织机构", "组织机构", "中华民族共同体学院"),
                content_kind="directory_entry",
                content_role="directory_reference",
                is_answer_bearing=True,
                anchor={"segment_ord": 2},
            ),
            _make_source(
                doc_id="official_web:muc_public:directory_page:b8993ee7004c02e028bc5f6bb166e26ac4eb5afc",
                chunk_id="teaching-units:chunk-0003",
                snippet="标题：教学和科研单位 | 章节：信息工程学院\n信息工程学院",
                score=0.89,
                collection="stable_reference",
                source_channel="official_web",
                source_title="教学和科研单位",
                structural_path=("组织机构", "组织机构", "信息工程学院"),
                content_kind="directory_entry",
                content_role="directory_reference",
                is_answer_bearing=True,
                anchor={"segment_ord": 3},
            ),
        )

        retained = _apply_document_diversity_policy(
            profile=profile,
            query_text="中央民族大学教学和科研单位有哪些",
            sources=sources,
        )

        self.assertEqual(
            tuple(source.chunk_id for source in retained),
            ("teaching-units:chunk-0002", "teaching-units:chunk-0003"),
        )

    def test_apply_document_diversity_policy_applies_to_stable_reference_scope(self) -> None:
        profile = _make_runtime_profile(
            corpus="official_web",
            collection="stable_reference",
            serving_surface="stable_reference",
        )

        collapsed = _apply_document_diversity_policy(
            profile=profile,
            query_text="中央民族大学学校简介",
            sources=(
                _make_source(
                    doc_id="official_web:muc_public:article_detail:e286aba2b39208a26af21e9dd518afc6faa49487",
                    chunk_id="school-profile:chunk-0003",
                    snippet="学校拥有结构合理的高水平师资队伍。",
                    score=0.95,
                    collection="stable_reference",
                    source_channel="official_web",
                    source_title="学校简介",
                    structural_path=("学校概况", "学校简介"),
                    content_kind="section_text",
                    content_role="primary_content",
                ),
                _make_source(
                    doc_id="official_web:muc_public:article_detail:e286aba2b39208a26af21e9dd518afc6faa49487",
                    chunk_id="school-profile:chunk-0001",
                    snippet="中央民族大学是党和国家为解决民族问题而创建的一所特色鲜明的高等院校。",
                    score=0.91,
                    collection="stable_reference",
                    source_channel="official_web",
                    source_title="学校简介",
                    structural_path=("学校概况", "学校简介"),
                    content_kind="section_text",
                    content_role="primary_content",
                ),
            ),
        )

        self.assertEqual(
            tuple((source.doc_id, source.chunk_id) for source in collapsed),
            (
                (
                    "official_web:muc_public:article_detail:e286aba2b39208a26af21e9dd518afc6faa49487",
                    "school-profile:chunk-0001",
                ),
            ),
        )

    def test_apply_document_diversity_policy_keeps_direct_stable_reference_title_doc_only(
        self,
    ) -> None:
        profile = _make_runtime_profile(
            corpus="official_web",
            collection="stable_reference",
            serving_surface="stable_reference",
        )

        collapsed = _apply_document_diversity_policy(
            profile=profile,
            query_text="中央民族大学学校简介",
            sources=(
                _make_source(
                    doc_id="official_web:muc_public:article_detail:e286aba2b39208a26af21e9dd518afc6faa49487",
                    chunk_id="school-profile:chunk-0001",
                    snippet="标题：学校简介 中央民族大学是党和国家为解决民族问题而创建的一所特色鲜明的高等院校。",
                    score=0.91,
                    collection="stable_reference",
                    source_channel="official_web",
                    source_title="学校简介",
                    structural_path=("学校简介",),
                    content_kind="article_body",
                    content_role="primary_content",
                    anchor={"segment_ord": 1},
                ),
                _make_source(
                    doc_id="official_web:muc_public:article_detail:e286aba2b39208a26af21e9dd518afc6faa49487",
                    chunk_id="school-profile:chunk-0005",
                    snippet="标题：学校简介 学校设有1个学部、26个学院。",
                    score=0.89,
                    collection="stable_reference",
                    source_channel="official_web",
                    source_title="学校简介",
                    structural_path=("学校简介",),
                    content_kind="article_body",
                    content_role="primary_content",
                    anchor={"segment_ord": 5},
                ),
                _make_source(
                    doc_id="official_web:muc_public:directory_page:b8993ee7004c02e028bc5f6bb166e26ac4eb5afc",
                    chunk_id="teaching-units:chunk-0001",
                    snippet="标题：教学和科研单位 学校设有民族学与社会学学院、信息工程学院等。",
                    score=0.92,
                    collection="stable_reference",
                    source_channel="official_web",
                    source_title="教学和科研单位",
                    structural_path=("教学和科研单位",),
                    content_kind="article_body",
                    content_role="primary_content",
                    anchor={"segment_ord": 1, "section_path": ["教学和科研单位"]},
                ),
            ),
        )

        self.assertEqual(
            tuple((source.doc_id, source.chunk_id) for source in collapsed),
            (
                (
                    "official_web:muc_public:article_detail:e286aba2b39208a26af21e9dd518afc6faa49487",
                    "school-profile:chunk-0001",
                ),
            ),
        )
