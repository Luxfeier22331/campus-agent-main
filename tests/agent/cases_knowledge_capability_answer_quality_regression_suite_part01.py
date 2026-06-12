# ruff: noqa: F403,F405
from __future__ import annotations

import unittest

from campus_knowledge_capability.query_planning import plan_student_handbook_query

from tests.agent.knowledge_capability_answer_quality_regression_suite_support import *


class KnowledgeCapabilityAnswerQualityRegressionTestPart01(unittest.TestCase):
    def test_institutional_rules_answer_uses_policy_prefix_not_student_handbook_prefix(
        self,
    ) -> None:
        evidence = EvidenceBundle(
            query_text="研究生助教助研助管工作应该依据哪份管理办法？",
            corpus="regulations",
            collection="institutional_rules",
            sources=(
                _make_policy_source(
                    doc_id=(
                        "institutional_regulation:muc:"
                        "中央民族大学研究生-三助-工作管理办法:49319e7c44d3"
                    ),
                    title="中央民族大学研究生“三助”工作管理办法",
                    snippet=(
                        "标题：中央民族大学研究生“三助”工作管理办法 | "
                        "章节：第一章 总 则 | 条款：第三条 "
                        "第三条 研究生担任助教、助研、助管工作是研究生培养的重要环节。"
                    ),
                    score=0.96,
                    chunk="three-assists-article-3",
                    collection="institutional_rules",
                ),
            ),
        )

        draft = KnowledgeCapability().build_answer(evidence)

        self.assertIn("根据校级制度相关规定", draft.answer_text)
        self.assertNotIn("学生手册", draft.answer_text)

    def test_audience_scope_judgment_uses_applicability_fragment_not_terminal_tail(
        self,
    ) -> None:
        source = replace(
            _make_policy_source(
                doc_id="institutional_regulation:muc:employment-reward",
                title="中央民族大学毕业生就业奖励办法",
                snippet=(
                    "第十八条 本办法自公布之日起实施，适用于2019届及以后毕业的学生。"
                    "原《中央民族大学关于鼓励应届毕业生到西部到基层就业的奖励办法（修订）》"
                    "（民大校发〔2012〕126号）同时废止。"
                ),
                score=0.96,
                chunk="employment-reward-article-18",
                detail_label="第十八条",
                collection="institutional_rules",
            ),
            anchor=_answer_ready_anchor(
                answer_role="eligibility_condition",
                semantic_role="condition",
                claim_type="eligibility_condition",
                condition_subject="audience_scope",
                condition_group_subject="audience_scope",
                condition_group_id="institutional:employment-reward:article-18:audience_scope",
                condition_polarity="positive",
                condition_subject_taxonomy_version="condition_subject.v1",
                condition_subject_provenance="suite-fixture",
                article_no="第十八条",
            ),
        )
        evidence = EvidenceBundle(
            query_text="中央民族大学毕业生就业奖励办法适用于2019届及以后毕业生吗",
            corpus="regulations",
            collection="institutional_rules",
            sources=(source,),
        )

        draft = KnowledgeCapability().build_answer(evidence)

        self.assertIn("适用于2019届及以后毕业的学生", draft.answer_text)
        self.assertIn("《中央民族大学毕业生就业奖励办法》第十八条", draft.answer_text)
        self.assertNotIn("同时废止", draft.answer_text)

    def test_institutional_category_discovery_prefers_category_overview_listing(self) -> None:
        category_source = replace(
            _make_policy_source(
                doc_id="official_web_regulation:0a420e3fe367027c",
                title="校园服务制度目录",
                snippet=(
                    "当前已收录依据中，校园成员校园服务制度相关制度包括：《中央民族大学信息公开实施细则》、"
                    "《中央民族大学信息门户运行管理办法（试行）》、"
                    "《校园一卡通管理规定》。"
                ),
                score=0.88,
                chunk="public-service-category-overview",
                collection="institutional_rules",
            ),
            content_role="policy_list",
            is_answer_bearing=True,
            anchor=_answer_ready_anchor(
                answer_role="category_overview",
                semantic_role="category_overview",
                claim_type="policy_list",
                condition_subject="audience_scope",
                condition_polarity="neutral",
                category_id="public_service",
                category_audience="校园成员",
                audience="校园成员",
                category_member_document_ids=(
                    "official_web_regulation:0a420e3fe367027c",
                    "official_web_regulation:7c62688242b9f47b",
                    "official_web_regulation:e350a6f1f7c0fdb2",
                ),
                member_policy_document_ids=(
                    "official_web_regulation:0a420e3fe367027c",
                    "official_web_regulation:7c62688242b9f47b",
                    "official_web_regulation:e350a6f1f7c0fdb2",
                ),
                category_member_titles=(
                    "中央民族大学信息公开实施细则",
                    "中央民族大学信息门户运行管理办法（试行）",
                    "校园一卡通管理规定",
                ),
                member_policy_titles=(
                    "中央民族大学信息公开实施细则",
                    "中央民族大学信息门户运行管理办法（试行）",
                    "校园一卡通管理规定",
                ),
            ),
        )
        procedure_source = replace(
            _make_policy_source(
                doc_id="official_web_regulation:7c62688242b9f47b",
                title="中央民族大学信息门户运行管理办法（试行）",
                snippet="信息门户事项按申请、审核、公示程序办理。",
                score=0.94,
                chunk="portal-procedure",
                collection="institutional_rules",
            ),
            content_role="procedure",
            is_answer_bearing=True,
            anchor=_answer_ready_anchor(
                answer_role="procedure_step",
                semantic_role="procedure_step",
                claim_type="procedure",
                condition_subject="application_procedure",
                condition_polarity="positive",
                category_id="public_service",
            ),
        )
        evidence = EvidenceBundle(
            query_text="学校层面的学生管理制度有哪些",
            corpus="regulations",
            collection="institutional_rules",
            sources=(procedure_source, category_source),
        )

        draft = KnowledgeCapability().build_answer(evidence)

        self.assertIn("当前已收录依据中", draft.answer_text)
        self.assertIn("信息公开实施细则", draft.answer_text)
        self.assertIn("信息门户运行管理办法", draft.answer_text)
        self.assertNotIn("按申请、审核、公示程序办理", draft.answer_text)

    def test_category_discovery_infers_heading_from_typed_category_overview_evidence(self) -> None:
        category_source = replace(
            _make_policy_source(
                doc_id="handbook:national-scholarship",
                title="中央民族大学本科学生国家奖学金评审办法",
                snippet="国家奖学金用于奖励特别优秀的全日制本科学生。",
                score=0.91,
                chunk="national-scholarship-overview",
                collection="student_rules",
            ),
            content_role="policy_list",
            semantic_role="category_overview",
            is_answer_bearing=True,
            anchor=_answer_ready_anchor(
                answer_role="category_overview",
                semantic_role="category_overview",
                claim_type="policy_list",
                condition_subject="audience_scope",
                condition_polarity="positive",
                category_id="scholarship",
                category_display_name="奖学金",
                category_audience="本科生",
                audience="本科生",
                category_member_document_ids=("handbook:national-scholarship",),
                member_policy_document_ids=("handbook:national-scholarship",),
                category_member_titles=("中央民族大学本科学生国家奖学金评审办法",),
                member_policy_titles=("中央民族大学本科学生国家奖学金评审办法",),
            ),
        )
        evidence = EvidenceBundle(
            query_text="本科生有哪些奖学金能申请？",
            corpus="regulations",
            collection="student_rules",
            sources=(category_source,),
        )

        draft = KnowledgeCapability().build_answer(evidence)

        self.assertIn("当前已收录依据中，本科生奖学金相关制度包括：", draft.answer_text)
        self.assertNotIn("相关相关制度包括", draft.answer_text)

    def test_institutional_deadline_query_prefers_time_constraint_clause(self) -> None:
        deadline_source = replace(
            _make_policy_source(
                doc_id="official-web-regulation-appeal-deadline-test",
                title="中央民族大学学生申诉处理办法",
                snippet="学生应当在收到处理决定后5个工作日内提出申诉。",
                score=0.88,
                chunk="appeal-deadline",
                collection="institutional_rules",
            ),
            content_role="deadline",
            is_answer_bearing=True,
            anchor=_answer_ready_anchor(
                answer_role="time_constraint",
                semantic_role="time_constraint",
                claim_type="time_constraint",
                condition_subject="deadline",
                condition_polarity="positive",
            ),
        )
        generic_source = replace(
            _make_policy_source(
                doc_id="official-web-regulation-appeal-deadline-test",
                title="中央民族大学学生申诉处理办法",
                snippet="申诉应当符合规定条件，并按程序办理。",
                score=0.94,
                chunk="appeal-generic-condition",
                collection="institutional_rules",
            ),
            content_role="requirement",
            is_answer_bearing=True,
            anchor=_answer_ready_anchor(
                answer_role="eligibility_condition",
                semantic_role="eligibility_condition",
                claim_type="condition",
                condition_subject="generic_condition",
                condition_polarity="positive",
            ),
        )
        evidence = EvidenceBundle(
            query_text="申诉有时间限制吗",
            corpus="regulations",
            collection="institutional_rules",
            sources=(generic_source, deadline_source),
        )

        draft = KnowledgeCapability().build_answer(evidence)

        self.assertIn("5个工作日内", draft.answer_text)
        self.assertNotIn("符合规定条件", draft.answer_text)

    def test_institutional_material_query_prefers_material_requirement_clause(self) -> None:
        material_source = replace(
            _make_policy_source(
                doc_id="official-web-regulation-appeal-material-test",
                title="中央民族大学学生申诉处理办法",
                snippet="申诉申请应当提交书面申请、相关证明材料。",
                score=0.89,
                chunk="appeal-materials",
                collection="institutional_rules",
            ),
            content_role="requirement",
            is_answer_bearing=True,
            anchor=_answer_ready_anchor(
                answer_role="material_requirement",
                semantic_role="material_requirement",
                claim_type="material_requirement",
                condition_subject="material_requirement",
                condition_polarity="positive",
            ),
        )
        procedure_source = replace(
            _make_policy_source(
                doc_id="official-web-regulation-appeal-material-test",
                title="中央民族大学学生申诉处理办法",
                snippet="校级复核按提交申请、审核、答复程序办理。",
                score=0.94,
                chunk="appeal-procedure",
                collection="institutional_rules",
            ),
            content_role="procedure",
            is_answer_bearing=True,
            anchor=_answer_ready_anchor(
                answer_role="procedure_step",
                semantic_role="procedure_step",
                claim_type="procedure",
                condition_subject="application_procedure",
                condition_polarity="positive",
            ),
        )
        evidence = EvidenceBundle(
            query_text="申请复核要交什么材料",
            corpus="regulations",
            collection="institutional_rules",
            sources=(procedure_source, material_source),
        )

        draft = KnowledgeCapability().build_answer(evidence)

        self.assertIn("书面申请", draft.answer_text)
        self.assertIn("证明材料", draft.answer_text)
        self.assertNotIn("审核、答复程序", draft.answer_text)

    def test_student_appeal_procedure_answers_with_deadline_and_written_appeal_action(
        self,
    ) -> None:
        source = replace(
            _make_policy_source(
                doc_id="handbook:student-appeal",
                title="中央民族大学学生申诉管理办法",
                snippet=(
                    "学生对学校的处理或者处分决定有异议的,可以在接到学校处理或者处分"
                    "决定书之日起10日内,向学校学生申诉处理委员会提出书面申诉。"
                ),
                score=0.94,
                chunk="appeal-written-deadline",
                collection="student_rules",
            ),
            content_role="deadline",
            is_answer_bearing=True,
            anchor=_answer_ready_anchor(
                answer_role="time_constraint",
                semantic_role="time_constraint",
                claim_type="time_constraint",
                condition_subject="deadline",
                condition_group_subject="deadline",
                condition_group_id="handbook:student-appeal:article-7:deadline",
                condition_polarity="positive",
                procedure_step_index=7,
                procedure_actor="student",
                procedure_action="appeal",
            ),
        )
        evidence = EvidenceBundle(
            query_text="中央民族大学学生申诉管理办法 书面申诉 10日内 处分决定书 申诉材料",
            corpus="regulations",
            collection="student_rules",
            sources=(source,),
        )
        user_query = "学生对处分决定不服应该按什么程序申诉"

        draft = KnowledgeCapability().build_answer(
            evidence,
            query_text=user_query,
            retrieval_intent=plan_student_handbook_query(user_query).retrieval_intent,
        )

        self.assertIn("处分决定书之日起10日内", draft.answer_text)
        self.assertIn("书面申诉", draft.answer_text)
        self.assertIn("学生申诉处理委员会", draft.answer_text)
        self.assertIn("如对处分决定不服", draft.answer_text)
        self.assertIn("可在", draft.answer_text)
        self.assertIn(
            "10日内向学校学生申诉处理委员会提出书面申诉",
            draft.answer_text,
        )
        self.assertNotIn("可按以下步骤处理", draft.answer_text)
        self.assertNotIn("相关条件包括", draft.answer_text)

    def test_student_hearing_deadline_answers_when_student_can_apply_for_hearing(
        self,
    ) -> None:
        source = replace(
            _make_policy_source(
                doc_id="handbook:student-hearing",
                title="中央民族大学学生听证实施办法",
                snippet=(
                    "学校拟给予学生开除学籍、退学处理、取消学籍、取消入学资格时,"
                    "应当告知学生拟被处分或者处理的事实、理由、依据和意见,"
                    "拟被处分或者处理的学生有要求听证的权利。拟被处分或者处理的学生"
                    "如有听证要求,应在收到拟处分或处理告知书后10日内提交书面听证申请,"
                    "学校应在收到学生听证申请后15日内组织召开听证会。"
                ),
                score=0.94,
                chunk="hearing-application-deadline",
                collection="student_rules",
            ),
            content_role="deadline",
            is_answer_bearing=True,
            anchor=_answer_ready_anchor(
                answer_role="time_constraint",
                semantic_role="time_constraint",
                claim_type="time_constraint",
                condition_subject="deadline",
                condition_group_subject="deadline",
                condition_group_id="handbook:student-hearing:article-13:deadline",
                condition_polarity="positive",
                procedure_step_index=13,
                procedure_actor="student",
                procedure_action="hearing_request",
            ),
        )
        evidence = EvidenceBundle(
            query_text="学生什么时候可以申请听证",
            corpus="regulations",
            collection="student_rules",
            sources=(source,),
        )

        draft = KnowledgeCapability().build_answer(
            evidence,
            retrieval_intent=plan_student_handbook_query(evidence.query_text).retrieval_intent,
        )

        self.assertIn("收到拟处分或处理告知书后10日内", draft.answer_text)
        self.assertIn("书面听证申请", draft.answer_text)
        self.assertIn(
            "拟被处分或者处理的学生可以在收到拟处分或处理告知书后10日内提交书面听证申请",
            draft.answer_text,
        )
        self.assertIn("有要求听证的权利", draft.answer_text)
        self.assertIn("申请听证", draft.answer_text)
        self.assertLess(
            draft.answer_text.index("收到拟处分或处理告知书后10日内"),
            draft.answer_text.index("有要求听证的权利"),
        )
        self.assertNotIn("事实、理由、依据和意见", draft.answer_text)
        self.assertNotIn("依据中央民族大学学生听证实施办法", draft.answer_text)
        self.assertNotIn("相关条件包括", draft.answer_text)

    def test_condition_overview_keeps_distinct_policy_docs_in_support(self) -> None:
        evidence = EvidenceBundle(
            query_text="申请奖学金需要满足什么条件",
            corpus="regulations",
            collection="student_rules",
            sources=(
                _make_policy_source(
                    doc_id="handbook:special",
                    title="中央民族大学本科学生专项奖学金评定办法",
                    snippet="第十条 参评本科学生专项奖学金需具备以下基本条件: 热爱祖国,遵纪守法,诚实守信。",
                    score=0.92,
                    chunk="special-eligibility",
                ),
                _make_policy_source(
                    doc_id="handbook:professional",
                    title="中央民族大学本科学生专业奖学金评定办法",
                    snippet="第十条 参评本科学生专业奖学金需具备以下基本条件: 学习刻苦,成绩优异,品行良好。",
                    score=0.91,
                    chunk="professional-eligibility",
                ),
                _make_policy_source(
                    doc_id="handbook:national",
                    title="中央民族大学本科学生国家奖学金评审办法",
                    snippet="第八条 参评本科学生国家奖学金须具备以下基本条件: 品行测评等级为优秀,学习成绩优异。",
                    score=0.9,
                    chunk="national-eligibility",
                ),
                _make_policy_source(
                    doc_id="handbook:social",
                    title="中央民族大学社会奖助学金管理办法",
                    snippet="社会奖学金用于奖励品学兼优或在某一方面有特殊才华的学生。",
                    score=0.89,
                    chunk="social-eligibility",
                ),
            ),
        )

        draft = KnowledgeCapability().build_answer(evidence)

        self.assertGreaterEqual(len({source.doc_id for source in draft.supporting_sources}), 4)
        self.assertIn("专项奖学金", draft.answer_text)
        self.assertIn("专业奖学金", draft.answer_text)
        self.assertIn("国家奖学金", draft.answer_text)
        self.assertIn("社会奖助学金", draft.answer_text)

    def test_condition_overview_prioritizes_core_eligibility_rows_over_award_facts(
        self,
    ) -> None:
        evidence = EvidenceBundle(
            query_text="申请奖学金需要满足什么条件",
            corpus="regulations",
            collection="student_rules",
            sources=(
                replace(
                    _make_policy_source(
                        doc_id="handbook:special",
                        title="中央民族大学本科学生专项奖学金评定办法",
                        snippet="本科学生专项奖学金用以奖励在科研、文体、品德、学生工作等某一方面有突出表现的学生。",
                        score=1.0,
                        chunk="special-object",
                        detail_label="第九条",
                    ),
                    anchor=_answer_ready_anchor(
                        answer_role="eligibility_condition",
                        condition_subject="generic_condition",
                        condition_group_subject="generic_condition",
                        condition_polarity="positive",
                        semantic_role="condition",
                        claim_type="condition",
                    ),
                ),
                replace(
                    _make_policy_source(
                        doc_id="handbook:professional",
                        title="中央民族大学本科学生专业奖学金评定办法",
                        snippet="学校为本科学生专业奖学金获得者颁发荣誉证书和奖金。",
                        score=1.0,
                        chunk="professional-award",
                        detail_label="第十六条",
                    ),
                    content_role="table_fact",
                    anchor=_answer_ready_anchor(
                        answer_role="table_fact",
                        condition_subject="amount_or_quota",
                        condition_group_subject="amount_or_quota",
                        condition_polarity="neutral",
                        semantic_role="table_fact",
                        claim_type="amount_or_quota",
                    ),
                ),
                replace(
                    _make_policy_source(
                        doc_id="handbook:national",
                        title="中央民族大学本科学生国家奖学金评审办法",
                        snippet="(一)拥护中国共产党,热爱祖国,维护国家统一和民族团结;",
                        score=1.0,
                        chunk="national-core-1",
                        detail_label="第八条",
                    ),
                    anchor=_answer_ready_anchor(
                        answer_role="eligibility_condition",
                        condition_subject="generic_condition",
                        condition_group_subject="generic_condition",
                        condition_polarity="positive",
                        semantic_role="condition",
                        claim_type="condition",
                    ),
                ),
                replace(
                    _make_policy_source(
                        doc_id="handbook:national",
                        title="中央民族大学本科学生国家奖学金评审办法",
                        snippet="(二)遵纪守法,遵守学校规章制度;",
                        score=1.0,
                        chunk="national-core-2",
                        detail_label="第八条",
                    ),
                    anchor=_answer_ready_anchor(
                        answer_role="eligibility_condition",
                        condition_subject="generic_condition",
                        condition_group_subject="generic_condition",
                        condition_polarity="positive",
                        semantic_role="condition",
                        claim_type="condition",
                    ),
                ),
                replace(
                    _make_policy_source(
                        doc_id="handbook:national",
                        title="中央民族大学本科学生国家奖学金评审办法",
                        snippet="(三)诚实守信,道德品质优秀,所评学年品行测评等级为优秀;",
                        score=1.0,
                        chunk="national-core-3",
                        detail_label="第八条",
                    ),
                    anchor=_answer_ready_anchor(
                        answer_role="eligibility_condition",
                        condition_subject="generic_condition",
                        condition_group_subject="generic_condition",
                        condition_polarity="positive",
                        semantic_role="condition",
                        claim_type="condition",
                    ),
                ),
                replace(
                    _make_policy_source(
                        doc_id="handbook:national",
                        title="中央民族大学本科学生国家奖学金评审办法",
                        snippet="(一)学习成绩优异,所评学年学习成绩排名与综合测评排名均位于前10%以内。",
                        score=1.0,
                        chunk="national-core-4",
                        detail_label="第九条",
                    ),
                    anchor=_answer_ready_anchor(
                        answer_role="eligibility_condition",
                        condition_subject="generic_condition",
                        condition_group_subject="generic_condition",
                        condition_polarity="positive",
                        semantic_role="condition",
                        claim_type="condition",
                    ),
                ),
            ),
        )

        draft = KnowledgeCapability().build_answer(evidence)

        self.assertNotIn("颁发荣誉证书", draft.answer_text)
        self.assertIn("遵纪守法", draft.answer_text)
        self.assertIn("学习成绩", draft.answer_text)
