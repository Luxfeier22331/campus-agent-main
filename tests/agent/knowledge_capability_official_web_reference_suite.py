from __future__ import annotations

from campus_knowledge_capability.retrieval_intent import (
    retrieval_intent_for_official_web_stable_reference,
)

from tests.agent.knowledge_capability_test_support import (
    CapabilityRequest,
    KnowledgeCapability,
    KnowledgeScope,
    RagRequestPayload,
    _make_official_web_evidence,
    _make_official_web_source,
    delegate_to_knowledge_capability,
    unittest,
)

STABLE_REFERENCE_SCOPE = KnowledgeScope(corpus="official_web", collection="stable_reference")
INVENTORY_SCOPE = KnowledgeScope(corpus="official_web", collection="muc_public_pages")
SCHOOL_PROFILE_DOC_ID = (
    "official_web:muc_public:article_detail:e286aba2b39208a26af21e9dd518afc6faa49487"
)
TEACHING_UNITS_DOC_ID = (
    "official_web:muc_public:directory_page:b8993ee7004c02e028bc5f6bb166e26ac4eb5afc"
)
TUITION_NOTICE_DOC_ID = (
    "official_web:muc_public:directory_page:9d7917bb1eb39649f02c6285c51280d811790cae"
)


class KnowledgeCapabilityOfficialWebReferenceTest(unittest.TestCase):
    def test_official_web_stable_reference_reference_page_uses_official_web_answering(self) -> None:
        evidence = _make_official_web_evidence(
            query_text="中央民族大学学校简介",
            collection="stable_reference",
            sources=(
                _stable_reference_source(
                    doc_id=SCHOOL_PROFILE_DOC_ID,
                    title="学校简介",
                    snippet="标题：学校简介 | 章节：学校概况\n中央民族大学坐落于北京市海淀区，直属国家民委。",
                    chunk_id_suffix="school-profile-stable-reference",
                ),
            ),
        )

        response = delegate_to_knowledge_capability(
            CapabilityRequest(
                capability="knowledge",
                user_goal="中央民族大学学校简介",
                payload=RagRequestPayload(scope=STABLE_REFERENCE_SCOPE),
            ),
            retriever=lambda *args, **kwargs: evidence,
        )

        self.assertEqual(response.status, "completed")
        self.assertEqual(response.confidence, "medium")
        self.assertNotIn("学生手册", response.answer_text)
        self.assertNotIn("培养方案", response.answer_text)
        self.assertIn("学校简介", response.answer_text)

    def test_official_web_school_profile_answer_prefers_intro_fact_over_late_background_detail(
        self,
    ) -> None:
        evidence = _make_official_web_evidence(
            query_text="中央民族大学学校简介",
            collection="stable_reference",
            sources=(
                _stable_reference_source(
                    doc_id=SCHOOL_PROFILE_DOC_ID,
                    title="学校简介",
                    snippet=(
                        "标题：学校简介 | 章节：学校概况\n"
                        "中央民族大学是党和国家为解决民族问题、培养各民族干部和高级专门人才而创建的一所特色鲜明的高等院校。"
                    ),
                    score=0.03175403,
                    chunk_id_suffix="school-profile-intro",
                ),
                _stable_reference_source(
                    doc_id=SCHOOL_PROFILE_DOC_ID,
                    title="学校简介",
                    snippet=(
                        "标题：学校简介 | 章节：学校概况\n"
                        "2021年，“中央民族学院开学”先后入选《中国共产党一百年大事记》。"
                    ),
                    score=0.04175403,
                    chunk_id_suffix="school-profile-late",
                ),
            ),
        )

        response = delegate_to_knowledge_capability(
            CapabilityRequest(
                capability="knowledge",
                user_goal="中央民族大学学校简介",
                payload=RagRequestPayload(scope=STABLE_REFERENCE_SCOPE),
            ),
            retriever=lambda *args, **kwargs: evidence,
        )

        self.assertEqual(response.status, "completed")
        self.assertIn("特色鲜明的高等院校", response.answer_text)
        self.assertNotIn("中国共产党一百年大事记", response.answer_text)

    def test_official_web_school_profile_answer_compresses_long_reference_page(self) -> None:
        evidence = _make_official_web_evidence(
            query_text="中央民族大学学校简介",
            collection="stable_reference",
            sources=(
                _stable_reference_source(
                    doc_id=SCHOOL_PROFILE_DOC_ID,
                    title="学校简介",
                    snippet=(
                        "标题：学校简介 | 章节：学校概况\n"
                        "中央民族大学是党和国家为解决民族问题、培养各民族干部和高级专门人才、促进中华民族大团结而创建的一所特色鲜明的高等院校。"
                        "学校前身是中国共产党1941年9月在延安创办的延安民族学院。"
                        "新中国成立后，经中央人民政府批准于1951年6月在北京成立中央民族学院。"
                        "1978年确立为国家重点大学，1993年更名为中央民族大学，1999年进入国家“211工程”重点建设高校行列，"
                        "2002年成为国家民委、教育部、北京市人民政府重点共建高校，2004年进入国家“985工程”重点建设高校行列，"
                        "2017年和2022年先后入选首轮“双一流”建设A类高校和第二轮“双一流”建设高校。"
                        "学校现有北京海淀、丰台和海南陵水黎安国际教育创新试验区三个校区。\n"
                        "党和国家格外关心和高度重视学校建设发展。"
                    ),
                    score=0.033333335,
                    chunk_id_suffix="school-profile-long",
                ),
            ),
        )

        response = delegate_to_knowledge_capability(
            CapabilityRequest(
                capability="knowledge",
                user_goal="中央民族大学学校简介",
                payload=RagRequestPayload(scope=STABLE_REFERENCE_SCOPE),
            ),
            retriever=lambda *args, **kwargs: evidence,
        )

        self.assertEqual(response.status, "completed")
        self.assertIn("延安民族学院", response.answer_text)
        self.assertIn("双一流", response.answer_text)
        self.assertNotIn("1999年进入国家“211工程”重点建设高校行列", response.answer_text)
        self.assertNotIn("党和国家格外关心和高度重视学校建设发展", response.answer_text)

    def test_official_web_teaching_units_reference_answers_only_admitted_stable_reference_doc(
        self,
    ) -> None:
        evidence = _make_official_web_evidence(
            query_text="中央民族大学教学和科研单位",
            collection="stable_reference",
            sources=(
                _stable_reference_source(
                    doc_id=TEACHING_UNITS_DOC_ID,
                    title="教学和科研单位",
                    snippet=(
                        "标题：教学和科研单位\n"
                        "学校设有民族学与社会学学院、中国少数民族语言文学学院、经济学院、管理学院、法学院、教育学院、"
                        "生命与环境科学学院、信息工程学院、美术学院、舞蹈学院、音乐学院等教学和科研单位。"
                    ),
                    score=0.033333335,
                    chunk_id_suffix="teaching-units",
                ),
            ),
        )

        response = delegate_to_knowledge_capability(
            CapabilityRequest(
                capability="knowledge",
                user_goal="中央民族大学教学和科研单位",
                payload=RagRequestPayload(scope=STABLE_REFERENCE_SCOPE),
            ),
            retriever=lambda *args, **kwargs: evidence,
        )

        self.assertEqual(response.status, "completed")
        self.assertIn("民族学与社会学学院", response.answer_text)
        self.assertIn("信息工程学院", response.answer_text)
        self.assertNotIn("学生手册", response.answer_text)

    def test_official_web_tuition_notice_reference_answers_public_charge_table(self) -> None:
        evidence = _make_official_web_evidence(
            query_text="中央民族大学大学教育收费公示表",
            collection="stable_reference",
            sources=(
                _stable_reference_source(
                    doc_id=TUITION_NOTICE_DOC_ID,
                    title="中央民族大学大学教育收费公示表",
                    snippet=(
                        "标题：中央民族大学大学教育收费公示表\n"
                        "公示表列明学费、住宿费等收费项目，收费标准按专业类别和住宿条件分别公示。"
                    ),
                    score=0.033333335,
                    chunk_id_suffix="tuition-notice",
                ),
            ),
        )

        draft = KnowledgeCapability().build_answer(
            evidence,
            retrieval_intent=retrieval_intent_for_official_web_stable_reference(
                query_text=evidence.query_text,
                scope=STABLE_REFERENCE_SCOPE,
            ),
        )

        self.assertIn("学费", draft.answer_text)
        self.assertIn("住宿费", draft.answer_text)
        self.assertIn("收费", " ".join(draft.supporting_contexts))

    def test_official_web_stable_reference_directory_entry_is_supporting_evidence(
        self,
    ) -> None:
        evidence = _make_official_web_evidence(
            query_text="中央民族大学教学和科研单位有哪些",
            collection="stable_reference",
            sources=(
                _stable_reference_source(
                    doc_id=TEACHING_UNITS_DOC_ID,
                    title="教学和科研单位",
                    snippet=("标题：教学和科研单位 | 章节：中华民族共同体学院\n民族学与社会学学院"),
                    score=0.0,
                    chunk_id_suffix="teaching-units-directory-entry",
                    content_role="directory_reference",
                    content_kind="directory_entry",
                    structural_path=("组织机构", "组织机构", "中华民族共同体学院"),
                ),
            ),
        )

        draft = KnowledgeCapability().build_answer(
            evidence,
            retrieval_intent=retrieval_intent_for_official_web_stable_reference(
                query_text=evidence.query_text,
                scope=STABLE_REFERENCE_SCOPE,
            ),
        )

        self.assertIn("民族学与社会学学院", draft.answer_text)
        self.assertEqual(len(draft.supporting_sources), 1)
        self.assertEqual(draft.supporting_sources[0].content_role, "directory_reference")
        self.assertIn("民族学与社会学学院", " ".join(draft.supporting_contexts))

    def test_official_web_stable_reference_directory_list_keeps_multiple_entries(
        self,
    ) -> None:
        evidence = _make_official_web_evidence(
            query_text="中央民族大学教学和科研单位有哪些",
            collection="stable_reference",
            sources=(
                _stable_reference_source(
                    doc_id=TEACHING_UNITS_DOC_ID,
                    title="教学和科研单位",
                    snippet="标题：教学和科研单位 | 章节：民族学与社会学学院\n民族学与社会学学院",
                    score=0.0,
                    chunk_id_suffix="teaching-units-directory-entry-ethnology",
                    content_role="directory_reference",
                    content_kind="directory_entry",
                    structural_path=("组织机构", "教学单位", "民族学与社会学学院"),
                ),
                _stable_reference_source(
                    doc_id=TEACHING_UNITS_DOC_ID,
                    title="教学和科研单位",
                    snippet="标题：教学和科研单位 | 章节：信息工程学院\n信息工程学院",
                    score=0.0,
                    chunk_id_suffix="teaching-units-directory-entry-information",
                    content_role="directory_reference",
                    content_kind="directory_entry",
                    structural_path=("组织机构", "教学单位", "信息工程学院"),
                ),
                _stable_reference_source(
                    doc_id=TEACHING_UNITS_DOC_ID,
                    title="教学和科研单位",
                    snippet="标题：教学和科研单位 | 章节：法学院\n法学院",
                    score=0.0,
                    chunk_id_suffix="teaching-units-directory-entry-law",
                    content_role="directory_reference",
                    content_kind="directory_entry",
                    structural_path=("组织机构", "教学单位", "法学院"),
                ),
                _stable_reference_source(
                    doc_id=TEACHING_UNITS_DOC_ID,
                    title="教学和科研单位",
                    snippet=(
                        "标题：教学和科研单位 | 章节：世界民族学与人类学研究中心\n"
                        "世界民族学与人类学研究中心"
                    ),
                    score=0.0,
                    chunk_id_suffix="teaching-units-directory-entry-research-center",
                    content_role="directory_reference",
                    content_kind="directory_entry",
                    structural_path=("组织机构", "科研平台", "世界民族学与人类学研究中心"),
                ),
            ),
        )

        draft = KnowledgeCapability().build_answer(
            evidence,
            retrieval_intent=retrieval_intent_for_official_web_stable_reference(
                query_text=evidence.query_text,
                scope=STABLE_REFERENCE_SCOPE,
            ),
        )

        self.assertIn("民族学与社会学学院", draft.answer_text)
        self.assertIn("信息工程学院", draft.answer_text)
        self.assertIn("法学院", draft.answer_text)
        self.assertGreaterEqual(len(draft.supporting_sources), 3)

    def test_official_web_stable_reference_table_unit_is_supporting_evidence(self) -> None:
        evidence = _make_official_web_evidence(
            query_text="中央民族大学大学教育收费公示表",
            collection="stable_reference",
            sources=(
                _stable_reference_source(
                    doc_id=TUITION_NOTICE_DOC_ID,
                    title="中央民族大学大学教育收费公示表",
                    snippet=(
                        "标题：中央民族大学大学教育收费公示表 | 表格：中央民族大学大学教育收费公示表\n"
                        "收费项目 | 计费单位 | 收费标准 | 收费范围 收费对象 | 批准收费的机关及文号\n"
                        "自费来华留学生硕士生文科类专业学费 | 元/生.学年 | 1.8万-3.0万 | | 国家教委、国家计委 教外来[1998]7号\n"
                        "住宿费 | 元/生.学年 | 900-1200 | 学生公寓 | 京发改规[2021]6号"
                    ),
                    score=0.0,
                    chunk_id_suffix="fee-disclosure-table-unit",
                    content_role="directory_reference",
                    content_kind="table_unit",
                    structural_path=("中央民族大学大学教育收费公示表",),
                ),
            ),
        )

        draft = KnowledgeCapability().build_answer(
            evidence,
            retrieval_intent=retrieval_intent_for_official_web_stable_reference(
                query_text=evidence.query_text,
                scope=STABLE_REFERENCE_SCOPE,
            ),
        )

        self.assertIn("学费", draft.answer_text)
        self.assertEqual(len(draft.supporting_sources), 1)
        self.assertEqual(draft.supporting_sources[0].content_kind, "table_unit")
        self.assertIn("住宿费", " ".join(draft.supporting_contexts))

    def test_official_web_stable_reference_fee_table_answer_summarizes_table_contract(
        self,
    ) -> None:
        evidence = _make_official_web_evidence(
            query_text="中央民族大学大学教育收费公示表",
            collection="stable_reference",
            sources=(
                _stable_reference_source(
                    doc_id=TUITION_NOTICE_DOC_ID,
                    title="中央民族大学大学教育收费公示表",
                    snippet=(
                        "标题：中央民族大学大学教育收费公示表 | 表格：中央民族大学大学教育收费公示表\n"
                        "收费项目 | 计费单位 | 收费标准 | 收费范围 收费对象 | 批准收费的机关及文号\n"
                        "自费来华留学生硕士生文科类专业学费 | 元/生.学年 | 1.8万-3.0万 | | 国家教委、国家计委 教外来[1998]7号\n"
                        "住宿费 | 元/生.学年 | 900-1200 | 学生公寓 | 京发改规[2021]6号"
                    ),
                    score=0.0,
                    chunk_id_suffix="fee-disclosure-table-contract",
                    content_role="directory_reference",
                    content_kind="table_unit",
                    structural_path=("中央民族大学大学教育收费公示表",),
                ),
            ),
        )

        draft = KnowledgeCapability().build_answer(
            evidence,
            retrieval_intent=retrieval_intent_for_official_web_stable_reference(
                query_text=evidence.query_text,
                scope=STABLE_REFERENCE_SCOPE,
            ),
        )

        self.assertIn(
            "收费项目、计费单位、收费标准、收费范围/对象、批准机关及文号", draft.answer_text
        )
        self.assertIn("收费公示", draft.answer_text)
        self.assertNotIn("覆盖", draft.answer_text)
        self.assertNotIn("等项目", draft.answer_text)
        self.assertNotIn("自费来华留学生硕士生文科类专业学费 | 元/生.学年", draft.answer_text)

    def test_official_web_stable_reference_no_answer_marks_scope_class_in_scope(
        self,
    ) -> None:
        cases = (
            (
                "中央民族大学今天有什么讲座",
                "freshness_fail_close",
                "freshness_fail_close",
            ),
            (
                "食堂营业时间",
                "unsupported_by_evidence",
                "",
            ),
        )
        for user_goal, semantic_outcome, no_answer_reason in cases:
            with self.subTest(user_goal=user_goal):
                response = delegate_to_knowledge_capability(
                    CapabilityRequest(
                        capability="knowledge",
                        user_goal=user_goal,
                        payload=RagRequestPayload(scope=STABLE_REFERENCE_SCOPE),
                    ),
                    retriever=lambda *args, user_goal=user_goal, **kwargs: (
                        _make_official_web_evidence(
                            query_text=user_goal,
                            collection="stable_reference",
                            sources=(),
                        )
                    ),
                )

                self.assertEqual(response.status, "no_answer")
                self.assertEqual(response.result.diagnostics.semantic_outcome, semantic_outcome)
                self.assertEqual(response.result.diagnostics.no_answer_reason, no_answer_reason)
                self.assertEqual(response.result.diagnostics.scope_class, "in_scope")

    def test_official_web_inventory_pages_fail_closed_before_retrieval_answering(self) -> None:
        cases = (
            ("中央民族大学学校概况", "学校概况"),
            ("中央民族大学本科培养", "本科培养"),
            ("中央民族大学博士后", "博士后"),
            ("中央民族大学基金会简介", "基金会简介"),
        )
        for user_goal, title in cases:
            with self.subTest(title=title):
                response = delegate_to_knowledge_capability(
                    CapabilityRequest(
                        capability="knowledge",
                        user_goal=user_goal,
                        payload=RagRequestPayload(scope=INVENTORY_SCOPE),
                    ),
                    retriever=lambda *args, user_goal=user_goal, title=title, **kwargs: (
                        _make_official_web_evidence(
                            query_text=user_goal,
                            sources=(
                                _make_official_web_source(
                                    doc_id=f"official_web:muc_public:article_detail:{title}",
                                    title=title,
                                    snippet=f"标题：{title}\n旧 mixed bridge 中的官网页面内容。",
                                    score=0.9,
                                    chunk_id_suffix=title,
                                    content_role="primary_content",
                                ),
                            ),
                        )
                    ),
                )

                self.assertEqual(response.status, "no_answer")
                self.assertEqual(response.confidence, "low")
                self.assertIn("非默认官网页面库存范围", response.answer_text)
                self.assertEqual(
                    response.result.diagnostics.no_answer_reason, "scope_not_query_enabled"
                )
                self.assertEqual(response.result.diagnostics.semantic_outcome, "unsupported_scope")


def _stable_reference_source(
    *,
    doc_id: str,
    title: str,
    snippet: str,
    chunk_id_suffix: str,
    score: float = 0.033333335,
    content_role: str = "primary_content",
    content_kind: str = "article_body",
    structural_path: tuple[str, ...] | None = None,
):
    return _make_official_web_source(
        doc_id=doc_id,
        title=title,
        snippet=snippet,
        score=score,
        chunk_id_suffix=chunk_id_suffix,
        content_role=content_role,
        content_kind=content_kind,
        structural_path=structural_path,
        collection="stable_reference",
    )
