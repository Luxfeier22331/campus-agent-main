from __future__ import annotations

from campus_shared.regulation_semantic_registry import (
    resolve_regulation_answer_role,
    resolve_regulation_condition_subject,
    resolve_regulation_expected_polarity,
    resolve_regulation_heading_role_hint,
    resolve_regulation_intro_subject,
    resolve_regulation_section_subject_hint,
)


class RegulationSemanticRegistryExtendedRoleSuite:
    def test_shared_answer_role_resolution_does_not_upgrade_material_item_to_procedure_step_with_hint(
        self,
    ) -> None:
        assignment = resolve_regulation_answer_role(
            text="（一）《中央民族大学接收推荐免试攻读研究生申请表》。",
            prefix_text="第七条 申请材料",
            role_hint="procedure_step",
        )

        self.assertEqual(assignment.value, "material_requirement")

    def test_shared_answer_role_resolution_treats_recommendation_letter_clause_as_material_requirement(
        self,
    ) -> None:
        assignment = resolve_regulation_answer_role(
            text=(
                "（三）分别由2名所报考学科专业领域内的教授（或相当专业技术职称的专家）"
                "填写签字的《中央民族大学接收推荐免试研究生专家推荐信》。"
            ),
            prefix_text="申请程序",
        )

        self.assertEqual(assignment.value, "material_requirement")

    def test_shared_answer_role_resolution_does_not_treat_formula_definition_clause_as_step(
        self,
    ) -> None:
        assignment = resolve_regulation_answer_role(
            text=(
                "第十二条 免试生遴选坚持学生自愿申请原则，按总成绩从高到低进行排名。"
                "总成绩由学业成绩A、学业成绩B和奖励分共三部分组成，均实行百分制，"
                "计算公式为：总成绩=学业成绩A*80%+学业成绩B*10%+奖励分*10%。"
            ),
            prefix_text="推荐程序",
        )

        self.assertNotEqual(assignment.value, "procedure_step")

    def test_shared_answer_role_resolution_does_not_treat_ranking_without_actor_as_step(
        self,
    ) -> None:
        assignment = resolve_regulation_answer_role(
            text="（五）按综合成绩排序，从成绩合格考生中择优录取。",
            prefix_text="录取程序",
        )

        self.assertNotEqual(assignment.value, "procedure_step")

    def test_shared_answer_role_resolution_does_not_upgrade_transition_condition_to_procedure_step(
        self,
    ) -> None:
        assignment = resolve_regulation_answer_role(
            text=(
                "第四条 强基生完成规定的本科阶段有关课程并通过培养方案所要求的转段学业考核，"
                "获得转段申请资格后，可申请转段招生报名。未参加转段学业考核或未能通过考核者，"
                "视为退出强基计划，不再具有申请免试攻读研究生资格。"
            ),
            prefix_text="第三章 转段条件",
        )

        self.assertEqual(assignment.value, "eligibility_condition")

    def test_shared_intro_subject_resolution_prefers_target_roles(self) -> None:
        material = resolve_regulation_intro_subject(
            intro_target_roles=("material_requirement",),
            fallback_condition_subject="generic_condition",
        )
        time = resolve_regulation_intro_subject(
            intro_target_roles=("time_constraint",),
            fallback_condition_subject="generic_condition",
        )
        procedure = resolve_regulation_intro_subject(
            intro_target_roles=("procedure_step",),
            fallback_condition_subject="generic_condition",
        )
        generic = resolve_regulation_intro_subject(
            intro_target_roles=("exception_rule", "example_evidence"),
            fallback_condition_subject="rank_threshold",
        )

        self.assertEqual(material.value, "material_requirement")
        self.assertEqual(material.provenance, "intro_target_roles:material_requirement")
        self.assertEqual(time.value, "deadline")
        self.assertEqual(time.provenance, "intro_target_roles:time_constraint")
        self.assertEqual(procedure.value, "application_procedure")
        self.assertEqual(procedure.provenance, "intro_target_roles:procedure_step")
        self.assertEqual(generic.value, "rank_threshold")
        self.assertEqual(generic.provenance, "inherited:condition_subject")

    def test_shared_intro_subject_resolution_preserves_specialized_fallback_for_single_target_role(
        self,
    ) -> None:
        assignment = resolve_regulation_intro_subject(
            intro_target_roles=("eligibility_condition",),
            fallback_condition_subject="rank_threshold",
        )

        self.assertEqual(assignment.value, "rank_threshold")
        self.assertEqual(assignment.provenance, "inherited:condition_subject")

    def test_shared_condition_subject_resolution_does_not_apply_procedure_section_hint_to_non_procedure_eligibility(
        self,
    ) -> None:
        assignment = resolve_regulation_condition_subject(
            text="（二）在同一学年内,申请国家助学金的家庭经济困难学生可同时申请并获得国家奖学金或国家励志奖学金。",
            answer_role="eligibility_condition",
            section_path=("四、评审要求与程序",),
            document_title="中央民族大学国家助学金评审办法",
        )

        self.assertEqual(assignment.value, "generic_condition")
        self.assertEqual(assignment.provenance, "answer_role:generic_condition")

    def test_shared_expected_polarity_resolution_tracks_answer_role_and_table_type(self) -> None:
        self.assertEqual(
            resolve_regulation_expected_polarity(
                answer_role="exclusion_rule",
                table_fact_type="",
            ).value,
            "negative",
        )
        self.assertEqual(
            resolve_regulation_expected_polarity(
                answer_role="procedure_step",
                table_fact_type="",
            ).value,
            "positive",
        )
        self.assertEqual(
            resolve_regulation_expected_polarity(
                answer_role="table_fact",
                table_fact_type="generic_policy_table",
            ).value,
            "neutral",
        )
        self.assertEqual(
            resolve_regulation_expected_polarity(
                answer_role="table_fact",
                table_fact_type="timeline_or_deadline",
            ).value,
            "positive",
        )

    def test_shared_section_subject_hint_resolves_material_deadline_procedure_and_audience(
        self,
    ) -> None:
        self.assertEqual(
            resolve_regulation_section_subject_hint(
                section_path=("第三章 申诉材料",),
                answer_role="material_requirement",
                text="提交书面申请。",
            ).value,
            "material_requirement",
        )
        self.assertEqual(
            resolve_regulation_section_subject_hint(
                section_path=("第三章 申诉期限",),
                answer_role="time_constraint",
                text="应在5个工作日内提出。",
            ).value,
            "deadline",
        )
        self.assertEqual(
            resolve_regulation_section_subject_hint(
                section_path=("解除程序",),
                answer_role="procedure_step",
                text="学生本人提交申请材料。",
            ).value,
            "application_procedure",
        )
        self.assertEqual(
            resolve_regulation_section_subject_hint(
                section_path=("适用对象",),
                answer_role="eligibility_condition",
                text="本办法适用于本科生。",
            ).value,
            "audience_scope",
        )

    def test_shared_heading_role_hint_resolves_procedure_category_headings(self) -> None:
        for text in (
            "认定程序",
            "评选程序",
            "办理程序",
            "程序如下：",
            "材料报送情况",
        ):
            with self.subTest(text=text):
                assignment = resolve_regulation_heading_role_hint(text)
                self.assertEqual(assignment.value, "procedure_step")
                self.assertTrue(assignment.provenance.startswith("text:procedure_heading"))

    def test_shared_heading_role_hint_resolves_material_and_time_category_headings(self) -> None:
        material = resolve_regulation_heading_role_hint("申诉材料")
        time = resolve_regulation_heading_role_hint("申诉期限")

        self.assertEqual(material.value, "material_requirement")
        self.assertTrue(material.provenance.startswith("text:material_heading"))
        self.assertEqual(time.value, "time_constraint")
        self.assertTrue(time.provenance.startswith("text:time_heading"))

    def test_shared_heading_role_hint_resolves_generic_category_heading(self) -> None:
        assignment = resolve_regulation_heading_role_hint("免试生类别")

        self.assertEqual(assignment.value, "eligibility_intro")
        self.assertTrue(assignment.provenance.startswith("text:generic_heading"))

    def test_shared_answer_role_resolution_supports_procedure_scope_single_step(self) -> None:
        assignment = resolve_regulation_answer_role(
            text=(
                "(2)学生根据认定结果填写“中央民族大学交换学生课程学分成绩认定申请表”,"
                "并将填好后的表交给所在院系主管教学院长(主任)审查、签字,并加盖院系公章。"
            ),
            prefix_text="认定程序",
        )

        self.assertEqual(assignment.value, "procedure_step")
        self.assertEqual(assignment.provenance, "matched_procedure_marker")

    def test_shared_answer_role_resolution_supports_selection_review_step(self) -> None:
        assignment = resolve_regulation_answer_role(
            text=(
                "（二）研究生院复评。院系将初评结果汇总，附参评材料盖公章后报至研究生院，"
                "由研究生院完成材料复审及评选工作。"
            ),
            prefix_text="评选程序",
        )

        self.assertEqual(assignment.value, "procedure_step")
        self.assertEqual(assignment.provenance, "matched_procedure_marker")

    def test_shared_answer_role_resolution_distinguishes_material_and_time_intro(self) -> None:
        material = resolve_regulation_answer_role(text="申诉人应提交以下材料：")
        deadline = resolve_regulation_answer_role(text="申诉应在下列期限内提出：")

        self.assertEqual(material.value, "eligibility_intro")
        self.assertEqual(material.provenance, "matched_material_intro_marker")
        self.assertEqual(deadline.value, "eligibility_intro")
        self.assertEqual(deadline.provenance, "matched_time_intro_marker")

    def test_shared_answer_role_resolution_prefers_condition_group_intro_over_apply_keyword(
        self,
    ) -> None:
        assignment = resolve_regulation_answer_role(text="具有下列条件之一者，可申报六级职员岗位：")

        self.assertEqual(assignment.value, "eligibility_intro")
        self.assertEqual(assignment.provenance, "matched_condition_group_intro")

    def test_shared_answer_role_resolution_prefers_exclusion_group_intro_over_process_keyword(
        self,
    ) -> None:
        assignment = resolve_regulation_answer_role(
            text="研究生有下列情形之一者，应当办理休学手续："
        )

        self.assertEqual(assignment.value, "eligibility_intro")
        self.assertEqual(assignment.provenance, "matched_exclusion_group_intro")

    def test_shared_answer_role_resolution_prefers_exception_clause_over_material_note_cues(
        self,
    ) -> None:
        assignment = resolve_regulation_answer_role(
            text=(
                "（二）学习成绩排名或综合测评排名超出前10%,但均位于前30%,且单科成绩不低于80分,"
                "平均成绩不低于85分,必须在道德风尚、学术研究、学科竞赛、创新发明、社会实践、"
                "社会工作、体育竞赛、文艺比赛等某一方面表现特别优秀且可提供相应的证明材料。"
                "具体表现如下:"
            ),
            prefix_text="参评本科学生国家奖学金还须具备以下条件之一:",
        )

        self.assertEqual(assignment.value, "exception_rule")
        self.assertEqual(assignment.provenance, "matched_exception_marker")

    def test_shared_answer_role_resolution_rejects_review_failure_clause_as_procedure_step(
        self,
    ) -> None:
        assignment = resolve_regulation_answer_role(
            text="(三)休学、保留学籍期满,逾期二周末提出复学申请或者二次休学后的复学申请经审查不合格的;"
        )

        self.assertEqual(assignment.value, "exclusion_rule")
        self.assertEqual(assignment.provenance, "matched_exclusion_marker")

    def test_shared_answer_role_resolution_rejects_disposition_heading_as_procedure_step(
        self,
    ) -> None:
        assignment = resolve_regulation_answer_role(text="第九条 导师违反立德树人规范行为的处理")

        self.assertNotEqual(assignment.value, "procedure_step")

    def test_shared_answer_role_resolution_rejects_disposition_result_clause_as_procedure_step(
        self,
    ) -> None:
        assignment = resolve_regulation_answer_role(
            text="（二）认定为本细则第七条第一项至第五项的违反立德树人规范行为的，给予解聘处理。"
        )

        self.assertNotEqual(assignment.value, "procedure_step")

    def test_shared_answer_role_resolution_rejects_agenda_item_apply_clause_as_procedure_step(
        self,
    ) -> None:
        assignment = resolve_regulation_answer_role(
            text="（4）各级各类人才计划、人才项目人选推荐申报。"
        )

        self.assertNotEqual(assignment.value, "procedure_step")

    def test_shared_answer_role_resolution_rejects_scope_review_clause_as_procedure_step(
        self,
    ) -> None:
        assignment = resolve_regulation_answer_role(
            text="4. 年度财务预算决算的审定和执行，大额度资金使用以及接受大额捐赠等重要事项。主要包括："
        )

        self.assertNotEqual(assignment.value, "procedure_step")

    def test_shared_answer_role_resolution_rejects_handling_scope_clause_as_procedure_step(
        self,
    ) -> None:
        for text in (
            "8. 落实违反师德师风行为处理等。",
            "3. 研究违反师德师风行为处理等。",
            "第十六条 对暂停招生连续两年及以上的专业，应采取以下方式进行处理。",
            "（三）国家本科专业目录调整，被调整的专业按撤销专业处理；",
        ):
            with self.subTest(text=text):
                assignment = resolve_regulation_answer_role(text=text)
                self.assertNotEqual(assignment.value, "procedure_step")

    def test_shared_answer_role_resolution_rejects_material_keyword_false_positives_as_procedure_step(
        self,
    ) -> None:
        for text in (
            "（一）经查实提交的信息不真实、不准确，伪造证书或证明材料的；",
            "紧密结合（专业名称）人才培养目标，提供与甲方（专业名称）实习教学任务和要求相匹配的实习岗位，并确保实习质量。",
            "基地建设成果惠及甲方的全体师生，同时为乙方提供人才储备和科研合作机会。",
            "（一）使用乙方提供的实践教学设施和资源。",
            "可申请保留入学资格者，如本人在报到之日起两周内不提出申请，视为放弃入学资格。",
        ):
            with self.subTest(text=text):
                assignment = resolve_regulation_answer_role(text=text)
                self.assertNotEqual(assignment.value, "procedure_step")

    def test_shared_answer_role_resolution_rejects_submission_heading_as_procedure_step(
        self,
    ) -> None:
        assignment = resolve_regulation_answer_role(text="第十一条 论文提交、答辩")

        self.assertNotEqual(assignment.value, "procedure_step")

    def test_shared_answer_role_resolution_rejects_long_expository_prose_as_procedure_step(
        self,
    ) -> None:
        assignment = resolve_regulation_answer_role(
            text=(
                "正文是主体，是作者对研究工作的详细表述。人文社会类学科的论文一般包括对研究问题的论述及系统分析，"
                "比较研究，模型或方案设计，案例论证或实证分析，模型运行的结果分析或建议、改进措施等。"
            )
        )

        self.assertNotEqual(assignment.value, "procedure_step")

    def test_shared_answer_role_resolution_rejects_misconduct_clause_as_procedure_step(
        self,
    ) -> None:
        assignment = resolve_regulation_answer_role(
            text="（七）在培养环节中签署虚假意见，违规委托他人填写培养各环节的鉴定意见或评审意见；"
        )

        self.assertNotEqual(assignment.value, "procedure_step")

    def test_shared_answer_role_resolution_rejects_tiebreak_ranking_clause_as_procedure_step(
        self,
    ) -> None:
        assignment = resolve_regulation_answer_role(
            text="（四）总成绩相同者按学业成绩 A+学业成绩 B 由高至低排序；如上述成绩仍相同，则按学业成绩 A 由高至低排序。"
        )

        self.assertNotEqual(assignment.value, "procedure_step")

    def test_shared_answer_role_resolution_rejects_long_planning_prose_as_procedure_step(
        self,
    ) -> None:
        assignment = resolve_regulation_answer_role(
            text=(
                "12. 大学文化建设丰富多彩。我校60周年校庆工作取得圆满成功，时任中共中央政治局委员、"
                "国务院副总理回良玉、国务委员刘延东等领导出席庆祝大会，进一步弘扬和传承了学校文化。"
                "开设了民大名师纪念展，出版了民大名师纪念文集，对学生进行生动的爱校爱学教育。"
                "发挥新媒体的重要作用，建立了官方微信、微博等新媒体宣传平台，宣传民大品牌。"
                "通过知识竞赛、报告会等形式，加强民族团结主题教育，践行“美美与共，知行合一”的大学校训。"
                "通过“十二五”建设，学校其他各项工作也都取得了长足进展，学校获中国关工委授予的"
                "“全国科普基地”称号和“2015年北京国际田联世锦赛”优秀组织奖；顺利通过北京市“平安校园”验收；"
                "学校办公室获“北京市教育事业统计工作优秀集体一等奖”，研究生院获“北京地区学位授予信息报送工作先进单位”，"
                "后勤产业集团获“后勤节能先进集体”，离退休干部处获国家民委系统“老干部工作先进集体”。"
            )
        )

        self.assertNotEqual(assignment.value, "procedure_step")

    def test_shared_answer_role_resolution_accepts_explicit_security_application_step(self) -> None:
        assignment = resolve_regulation_answer_role(
            text="开题前应向学校提出学位论文定密申请（内容包括密级、保密期限和知悉范围等）。"
        )

        self.assertEqual(assignment.value, "procedure_step")
        self.assertEqual(assignment.provenance, "matched_procedure_marker")
