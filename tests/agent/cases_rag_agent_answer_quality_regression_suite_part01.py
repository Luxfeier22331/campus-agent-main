# ruff: noqa: F403,F405
from __future__ import annotations

import unittest

from tests.agent.rag_agent_answer_quality_regression_suite_support import *


class RagAgentAnswerQualityRegressionTestPart01(unittest.TestCase):
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

        draft = RagAgent().build_answer(evidence)

        self.assertIn("根据校级制度相关规定", draft.answer_text)
        self.assertNotIn("学生手册", draft.answer_text)

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

        draft = RagAgent().build_answer(evidence)

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

        draft = RagAgent().build_answer(evidence)

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

        draft = RagAgent().build_answer(evidence)

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

        draft = RagAgent().build_answer(evidence)

        self.assertIn("书面申请", draft.answer_text)
        self.assertIn("证明材料", draft.answer_text)
        self.assertNotIn("审核、答复程序", draft.answer_text)

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

        draft = RagAgent().build_answer(evidence)

        self.assertGreaterEqual(len({source.doc_id for source in draft.supporting_sources}), 4)
        self.assertIn("专项奖学金", draft.answer_text)
        self.assertIn("专业奖学金", draft.answer_text)
        self.assertIn("国家奖学金", draft.answer_text)
        self.assertIn("社会奖学金", draft.answer_text)

    def test_disciplinary_relief_how_long_answer_prefers_waiting_condition_over_approval_steps(
        self,
    ) -> None:
        title = "中央民族大学解除学生纪律处分实施办法"
        condition_source = replace(
            _make_policy_source(
                doc_id="handbook:demerit-relief",
                title=title,
                snippet="第三条 学生受处分满考察期后，可以申请解除纪律处分。",
                score=0.88,
                chunk="discipline-relief-condition",
                detail_label="第三条",
            ),
            content_role="eligibility",
            is_answer_bearing=True,
            anchor=_answer_ready_anchor(
                answer_role="eligibility_condition",
                semantic_role="eligibility_condition",
                claim_type="condition",
                condition_subject="discipline_relief_condition",
                condition_polarity="positive",
                action_type="lift_discipline",
                article_no="第三条",
            ),
        )
        approval_source = replace(
            _make_policy_source(
                doc_id="handbook:demerit-relief",
                title=title,
                snippet="学院审核后报学生处，学生处审核后报请主管校领导审批决定。",
                score=0.96,
                chunk="discipline-relief-approval",
            ),
            content_role="procedure",
            is_answer_bearing=True,
            anchor=_answer_ready_anchor(
                answer_role="procedure_step",
                semantic_role="procedure_step",
                claim_type="procedure",
                condition_subject="application_procedure",
                condition_polarity="positive",
                action_type="lift_discipline",
            ),
        )
        evidence = EvidenceBundle(
            query_text="被处分后多久可以申请解除处分",
            corpus="regulations",
            collection="student_rules",
            sources=(approval_source, condition_source),
        )

        draft = RagAgent().build_answer(evidence)

        self.assertIn("满考察期后", draft.answer_text)
        self.assertIn("申请解除纪律处分", draft.answer_text)
        self.assertNotIn("主管校领导审批", draft.answer_text)

    def test_attendance_absence_threshold_answer_prefers_absence_threshold_clause(self) -> None:
        title = "中央民族大学学生违纪处分实施办法"
        threshold_source = replace(
            _make_policy_source(
                doc_id="handbook:discipline",
                title=title,
                snippet="第三十三条 一学期内旷课累计达到10学时以上的，按违纪处理。",
                score=0.86,
                chunk="absence-threshold",
                detail_label="第三十三条",
            ),
            content_role="requirement",
            is_answer_bearing=True,
            anchor=_answer_ready_anchor(
                answer_role="eligibility_condition",
                semantic_role="eligibility_condition",
                claim_type="condition",
                condition_subject="generic_condition",
                condition_polarity="positive",
                article_no="第三十三条",
            ),
        )
        generic_source = replace(
            _make_policy_source(
                doc_id="handbook:discipline",
                title=title,
                snippet="学生应遵守学校纪律，违纪处分按照规定程序执行。",
                score=0.95,
                chunk="discipline-generic",
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
            query_text="旷课多少学时会按违纪处理",
            corpus="regulations",
            collection="student_rules",
            sources=(generic_source, threshold_source),
        )

        draft = RagAgent().build_answer(evidence)

        self.assertIn("10学时", draft.answer_text)
        self.assertIn("旷课", draft.answer_text)
        self.assertNotIn("按照规定程序执行", draft.answer_text)

    def test_detail_clause_prefers_statements_covering_query_critical_terms(self) -> None:
        evidence = EvidenceBundle(
            query_text="国奖第九条里对论文和著作怎么要求的？",
            corpus="regulations",
            collection="student_rules",
            sources=(
                _make_policy_source(
                    doc_id="handbook:national",
                    title="中央民族大学本科学生国家奖学金评审办法",
                    snippet="第九条 参评本科学生国家奖学金还须具备以下条件之一: 在体育竞赛中取得显著成绩。",
                    score=0.93,
                    chunk="national-sports",
                ),
                _make_policy_source(
                    doc_id="handbook:national",
                    title="中央民族大学本科学生国家奖学金评审办法",
                    snippet="第九条 学术研究方面取得显著成绩,以第一作者发表论文或以第一、二作者出版学术著作。",
                    score=0.91,
                    chunk="national-paper-book",
                ),
            ),
        )

        draft = RagAgent().build_answer(evidence)

        self.assertIn("论文", draft.answer_text)
        self.assertIn("著作", draft.answer_text)
        self.assertNotIn("体育竞赛", draft.answer_text)

    def test_rewritten_policy_title_detail_query_still_answers_clause_content(self) -> None:
        title = "中央民族大学本科学生国家奖学金评审办法"
        evidence = EvidenceBundle(
            query_text=f"{title} 国奖第九条里对论文和著作怎么要求的?",
            corpus="regulations",
            collection="student_rules",
            sources=(
                replace(
                    _make_policy_source(
                        doc_id="handbook:national",
                        title=title,
                        snippet=(
                            f"{title} / 第三章 评选条件 / 第九条\n"
                            "2. 在学术研究上取得显著成绩,以第一作者发表的论文被SCI、EI、"
                            "ISTP、SSCI全文收录,以第一、二作者出版学术专著。"
                        ),
                        score=0.96,
                        chunk="national-paper-book",
                        detail_label="第九条",
                    ),
                    anchor=_answer_ready_anchor(
                        answer_role="example_evidence",
                        semantic_role="example",
                        claim_type="condition",
                        condition_subject="paper_or_publication",
                        condition_polarity="positive",
                        article_no="第九条",
                        clause_no="2.",
                    ),
                ),
            ),
        )

        draft = RagAgent().build_answer(evidence)

        self.assertIn("第九条", draft.answer_text)
        self.assertIn("论文", draft.answer_text)
        self.assertIn("第一作者", draft.answer_text)
        self.assertIn("第一、二作者", draft.answer_text)
        self.assertNotIn("相关依据为", draft.answer_text)
        self.assertNotEqual(draft.presentation_kind, "document_identity")

    def test_detail_clause_answer_splits_paper_and_book_requirements_when_query_asks_both(
        self,
    ) -> None:
        title = "中央民族大学本科学生国家奖学金评审办法"
        evidence = EvidenceBundle(
            query_text="国奖第九条里对论文和著作怎么要求的？",
            corpus="regulations",
            collection="student_rules",
            sources=(
                replace(
                    _make_policy_source(
                        doc_id="handbook:national-scholarship",
                        title=title,
                        snippet=(
                            "第九条 在学术研究上取得显著成绩，以第一作者发表的论文被SCI、EI、"
                            "ISTP、SSCI全文收录，以第一、二作者出版学术专著(须通过专家鉴定)。"
                        ),
                        score=0.96,
                        chunk="national-paper-book",
                        detail_label="第九条",
                    ),
                    anchor=_answer_ready_anchor(
                        answer_role="example_evidence",
                        semantic_role="example",
                        claim_type="condition",
                        condition_subject="paper_or_publication",
                        condition_polarity="positive",
                        article_no="第九条",
                    ),
                ),
            ),
        )

        draft = RagAgent().build_answer(evidence)

        self.assertTrue(draft.answer_text.startswith("国家奖学金第九条对论文和著作的要求是"))
        self.assertIn("第九条对论文和著作的要求", draft.answer_text)
        self.assertIn("论文要求", draft.answer_text)
        self.assertIn("著作要求", draft.answer_text)
        self.assertIn("论文要求：以第一作者发表的论文", draft.answer_text)
        self.assertIn("著作要求：以第一、二作者出版学术专著", draft.answer_text)
        self.assertNotIn("著作要求：以第一作者发表的论文", draft.answer_text)
        self.assertNotIn("根据学生手册相关规定", draft.answer_text)
        self.assertIn(f"依据《{title}》第九条", draft.answer_text)
        self.assertIn("第一作者", draft.answer_text)
        self.assertIn("第一、二作者", draft.answer_text)
        self.assertIn("第九条", draft.answer_text)

    def test_detail_clause_answer_preserves_policy_title_and_detail_label(self) -> None:
        title = "中央民族大学本科学生国家奖学金评审办法"
        evidence = EvidenceBundle(
            query_text="国奖第九条里对论文和著作怎么要求的？",
            corpus="regulations",
            collection="student_rules",
            sources=(
                _make_policy_source(
                    doc_id="handbook:national",
                    title=title,
                    snippet=(
                        "第九条 学术研究方面取得显著成绩，以第一作者发表论文或以第一、二作者"
                        "出版学术著作。"
                    ),
                    score=0.91,
                    chunk="national-paper-book",
                    detail_label="第九条",
                ),
            ),
        )

        draft = RagAgent().build_answer(evidence)

        self.assertIn(f"《{title}》", draft.answer_text)
        self.assertIn("第九条", draft.answer_text)
        self.assertIn("第一作者", draft.answer_text)
        self.assertIn("第一、二作者", draft.answer_text)

    def test_judgment_query_prefers_rank_exception_clause_over_unrelated_subconditions(
        self,
    ) -> None:
        title = "中央民族大学本科学生国家奖学金评审办法"
        evidence = EvidenceBundle(
            query_text="成绩没前十还能评国奖吗？",
            corpus="regulations",
            collection="student_rules",
            sources=(
                _make_policy_source(
                    doc_id="handbook:national",
                    title=title,
                    snippet=(
                        "第九条 参评本科学生国家奖学金还须具备以下条件之一: "
                        "学习成绩优异,所评学年学习成绩排名与综合测评排名均位于前10%以内。"
                    ),
                    score=0.95,
                    chunk="national-top-ten",
                    detail_label="第九条",
                ),
                _make_policy_source(
                    doc_id="handbook:national",
                    title=title,
                    snippet=(
                        "第九条 学习成绩排名或综合测评排名超出前10%,但均位于前30%,"
                        "且单科成绩不低于80分,平均成绩不低于85分,必须在某一方面表现特别优秀"
                        "且可提供相应证明材料。"
                    ),
                    score=0.94,
                    chunk="national-rank-exception",
                    detail_label="第九条",
                ),
                _make_policy_source(
                    doc_id="handbook:national",
                    title=title,
                    snippet="在体育竞赛中取得显著成绩,为国家争得荣誉。",
                    score=0.93,
                    chunk="national-sports-subcondition",
                    detail_label="第九条",
                ),
                _make_policy_source(
                    doc_id="handbook:national",
                    title=title,
                    snippet="在学术研究上取得显著成绩,以第一作者发表的论文被SCI、EI全文收录。",
                    score=0.92,
                    chunk="national-paper-subcondition",
                    detail_label="第九条",
                ),
            ),
        )

        draft = RagAgent().build_answer(evidence)

        self.assertIn("超出前10%", draft.answer_text)
        self.assertIn("位于前30%", draft.answer_text)
        self.assertNotIn("体育竞赛", draft.answer_text)
        self.assertNotIn("学术研究上取得显著成绩", draft.answer_text)

    def test_judgment_query_prefers_paper_clause_without_basic_condition_boilerplate(self) -> None:
        title = "中央民族大学本科学生国家奖学金评审办法"
        evidence = EvidenceBundle(
            query_text="论文能不能算国奖条件？",
            corpus="regulations",
            collection="student_rules",
            sources=(
                _make_policy_source(
                    doc_id="handbook:national",
                    title=title,
                    snippet=(
                        "在学术研究上取得显著成绩,以第一作者发表的论文被SCI、EI、ISTP、SSCI全文收录,"
                        "以第一、二作者出版学术专著(须通过专家鉴定)。"
                    ),
                    score=0.95,
                    chunk="national-paper-condition",
                    detail_label="第九条",
                ),
                _make_policy_source(
                    doc_id="handbook:national",
                    title=title,
                    snippet="参评本科学生国家奖学金还须具备以下条件之一。",
                    score=0.94,
                    chunk="national-eligibility-intro",
                    detail_label="第九条",
                ),
                _make_policy_source(
                    doc_id="handbook:national",
                    title=title,
                    snippet="参评本科学生国家奖学金须具备以下基本条件。",
                    score=0.93,
                    chunk="national-basic-condition-intro",
                    detail_label="第八条",
                ),
            ),
        )

        draft = RagAgent().build_answer(evidence)

        self.assertIn("发表的论文", draft.answer_text)
        self.assertNotIn("还须具备以下条件之一", draft.answer_text)
        self.assertNotIn("须具备以下基本条件", draft.answer_text)

    def test_judgment_query_trims_rank_exception_clause_before_following_examples(self) -> None:
        title = "中央民族大学本科学生国家奖学金评审办法"
        evidence = EvidenceBundle(
            query_text="成绩没前十还能评国奖吗？",
            corpus="regulations",
            collection="student_rules",
            sources=(
                _make_policy_source(
                    doc_id="handbook:national",
                    title=title,
                    snippet=(
                        "第九条 参评本科学生国家奖学金还须具备以下条件之一:\n"
                        "(二)学习成绩排名或综合测评排名超出前10%,但均位于前30%,且单科成绩不低于80分,"
                        "平均成绩不低于85分,必须在道德风尚、学术研究、学科竞赛、创新发明、社会实践、"
                        "社会工作、体育竞赛、文艺比赛等某一方面表现特别优秀且可提供相应的证明材料。"
                        "具体表现如下:\n"
                        "1. 在社会主义精神文明建设中表现突出。\n"
                        "2. 在学术研究上取得显著成绩,以第一作者发表的论文被SCI、EI全文收录。\n"
                        "5. 在体育竞赛中取得显著成绩,为国家争得荣誉。"
                    ),
                    score=0.95,
                    chunk="national-rank-exception-tail",
                    detail_label="第九条",
                ),
            ),
        )

        draft = RagAgent().build_answer(evidence)

        self.assertIn("超出前10%", draft.answer_text)
        self.assertIn("位于前30%", draft.answer_text)
        self.assertNotIn("具体表现如下", draft.answer_text)
        self.assertNotIn("体育竞赛", draft.answer_text)
        self.assertNotIn("发表的论文", draft.answer_text)

    def test_curriculum_title_lookup_preserves_course_teaching_plan_title(self) -> None:
        title = "中央民族大学通识课程“大学英语”课程教学计划"
        evidence = EvidenceBundle(
            query_text="中央民族大学通识课程大学英语课程教学计划",
            corpus="curriculum",
            collection="curriculum_plan",
            sources=(
                _make_curriculum_plan_source(
                    doc_id=f"curriculum:{title}",
                    chunk_id=f"curriculum:{title}:chunk-0002",
                    source_title=title,
                    snippet=(
                        "各级别大学英语课程在1-4学期课程安排如下\n"
                        "普通级-3 | 大学英语(一) | 大学英语(二) | “X”高阶类课程"
                    ),
                    score=0.93,
                    is_answer_bearing=True,
                    structural_path=(title,),
                ),
            ),
        )

        draft = RagAgent().build_answer(evidence)

        self.assertIn(f"《{title}》", draft.answer_text)
        self.assertIn("课程教学计划", draft.answer_text)
        self.assertIn("大学英语", draft.answer_text)

    def test_curriculum_table_answer_preserves_relevant_section_label(self) -> None:
        title = "经济学拔尖人才创新班人才培养方案"
        evidence = EvidenceBundle(
            query_text="经济学拔尖人才创新班人才培养方案课程设置怎么安排？",
            corpus="curriculum",
            collection="curriculum_plan",
            sources=(
                _make_curriculum_plan_source(
                    doc_id=f"curriculum:{title}",
                    chunk_id=f"curriculum:{title}:chunk-0012",
                    source_title=title,
                    snippet=(
                        "五、课程设置和修读建议\n"
                        "1034030159 | 经济学经典原著选读 | 2 | 36 | 6 | 3\n"
                        "1034030090 | 中级微观经济学 | 3 | 54 | 9 | 2"
                    ),
                    score=0.94,
                    structural_path=(title, "五、课程设置和修读建议"),
                    content_kind="table_unit",
                    content_role="table_fact",
                    is_answer_bearing=True,
                ),
            ),
        )

        draft = RagAgent().build_answer(evidence)

        self.assertIn(f"《{title}》", draft.answer_text)
        self.assertIn("课程设置", draft.answer_text)
        self.assertIn("经济学经典原著选读", draft.answer_text)

    def test_program_semester_fact_answer_preserves_program_title(self) -> None:
        title = "法学（民族实验班）本科人才培养方案"
        evidence = EvidenceBundle(
            query_text="法学民族班培养方案里大二下有什么课",
            corpus="curriculum",
            collection="program_semester_facts",
            sources=(
                _make_program_semester_source(
                    source_document_id=f"curriculum:{title}",
                    semester_label="第四学期",
                    snippet="第四学期课程：刑事诉讼法、民事诉讼法、经济法。",
                    score=0.95,
                ),
            ),
        )

        draft = RagAgent().build_answer(evidence)

        self.assertIn(f"《{title}》", draft.answer_text)
        self.assertIn("第四学期", draft.answer_text)
        self.assertIn("刑事诉讼法", draft.answer_text)

    def test_curriculum_title_lookup_uses_answer_bearing_content_not_found_copy(self) -> None:
        title = "民族学本科人才培养方案"
        evidence = EvidenceBundle(
            query_text=title,
            corpus="curriculum",
            collection="curriculum_plan",
            sources=(
                _make_curriculum_plan_source(
                    doc_id=f"curriculum:{title}",
                    chunk_id=f"curriculum:{title}:chunk-0012",
                    source_title=title,
                    snippet="五、课程设置和修读建议 课程号 | 课程名称 | 学分 0304-1-05-04 | 民族学前沿研究 | 2",
                    score=0.92,
                    content_role="table_fact",
                    is_answer_bearing=True,
                ),
                _make_curriculum_plan_source(
                    doc_id=f"curriculum:{title}",
                    chunk_id=f"curriculum:{title}:chunk-0001",
                    source_title=title,
                    snippet="民族学本科人才培养方案 一、培养目标 本专业培养具有民族学理论基础和田野调查能力的人才。",
                    score=0.9,
                    is_answer_bearing=True,
                ),
            ),
        )

        draft = RagAgent().build_answer(evidence)

        self.assertIn(f"《{title}》", draft.answer_text)
        self.assertNotIn("已找到", draft.answer_text)
        self.assertIn("培养目标", draft.answer_text)
        self.assertNotIn("0304-1-05-04", draft.answer_text)


if __name__ == "__main__":
    unittest.main()
