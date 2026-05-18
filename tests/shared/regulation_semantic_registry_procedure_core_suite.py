from __future__ import annotations

from campus_shared.regulation_semantic_registry import (
    canonical_regulation_procedure_action,
    resolve_regulation_answer_role,
    resolve_regulation_procedure_action,
    resolve_regulation_procedure_actor,
)


class RegulationSemanticRegistryProcedureCoreSuite:
    def test_shared_procedure_action_resolution_prefers_explicit_metadata(self) -> None:
        assignment = resolve_regulation_procedure_action(
            text="统一受理、协调处理、统一答复向学校提出的信息公开申请。",
            actor="office",
            explicit_action="office_review",
        )

        self.assertEqual(canonical_regulation_procedure_action(assignment.value), "office_review")
        self.assertEqual(assignment.provenance, "metadata:procedure_action")

    def test_shared_procedure_action_resolution_supports_guidance_duty_steps(self) -> None:
        assignment = resolve_regulation_procedure_action(
            text="负责指导学生开展项目研究。",
            actor="instructor",
        )

        self.assertEqual(canonical_regulation_procedure_action(assignment.value), "process")
        self.assertEqual(assignment.provenance, "keyword:指导职责流程")

    def test_shared_procedure_actor_and_action_resolution_supports_information_disclosure_notice_step(
        self,
    ) -> None:
        actor_assignment = resolve_regulation_procedure_actor(
            text="（一）属于公开范围的，应当告知申请人获取该信息的方式和途径。"
        )
        action_assignment = resolve_regulation_procedure_action(
            text="（一）属于公开范围的，应当告知申请人获取该信息的方式和途径。",
            actor=actor_assignment.value,
        )

        self.assertEqual(actor_assignment.value, "office")
        self.assertTrue(actor_assignment.provenance)
        self.assertEqual(canonical_regulation_procedure_action(action_assignment.value), "process")
        self.assertTrue(action_assignment.provenance)

    def test_shared_procedure_actor_and_action_resolution_supports_information_disclosure_reason_notice(
        self,
    ) -> None:
        actor_assignment = resolve_regulation_procedure_actor(text="应当告知申请人并说明理由。")
        action_assignment = resolve_regulation_procedure_action(
            text="应当告知申请人并说明理由。",
            actor=actor_assignment.value,
        )

        self.assertEqual(actor_assignment.value, "office")
        self.assertTrue(actor_assignment.provenance)
        self.assertEqual(canonical_regulation_procedure_action(action_assignment.value), "process")
        self.assertTrue(action_assignment.provenance)

    def test_shared_procedure_action_resolution_supports_application_reporting_steps(self) -> None:
        assignment = resolve_regulation_procedure_action(
            text="申报人可根据申报条件自主申报，也可由学院党政联席会提名申报。",
            actor="college",
        )

        self.assertEqual(canonical_regulation_procedure_action(assignment.value), "apply")
        self.assertEqual(assignment.provenance, "keyword:申请申报")

    def test_shared_procedure_action_resolution_supports_disbursement_steps(self) -> None:
        assignment = resolve_regulation_procedure_action(
            text="国际合作处汇总学生信息并制作资助明细表转财务处。财务处按表拨付至学生用于缴纳学费的银行卡内。",
            actor="office",
        )

        self.assertEqual(canonical_regulation_procedure_action(assignment.value), "disburse")
        self.assertEqual(assignment.provenance, "keyword:发放拨付+positive_step")

    def test_shared_procedure_action_resolution_prefers_college_review_over_student_object_submit(
        self,
    ) -> None:
        assignment = resolve_regulation_procedure_action(
            text="学院审核学生提交的申请材料。",
            actor="college",
        )

        self.assertEqual(canonical_regulation_procedure_action(assignment.value), "college_review")
        self.assertEqual(assignment.provenance, "keyword:审核+actor:college")

    def test_shared_procedure_action_resolution_prefers_office_review_over_student_object_submit(
        self,
    ) -> None:
        assignment = resolve_regulation_procedure_action(
            text="学生处审核学生提交的申请材料。",
            actor="student_affairs_office",
        )

        self.assertEqual(canonical_regulation_procedure_action(assignment.value), "office_review")
        self.assertEqual(
            assignment.provenance,
            "keyword:审核+actor:student_affairs_office",
        )

    def test_shared_procedure_action_resolution_does_not_treat_handling_decision_as_process(
        self,
    ) -> None:
        assignment = resolve_regulation_procedure_action(
            text="学生应当在收到处理决定后5个工作日内提出申诉。",
            actor="student",
        )

        self.assertEqual(canonical_regulation_procedure_action(assignment.value), "appeal")
        self.assertEqual(assignment.provenance, "keyword:申诉听证")

    def test_shared_procedure_action_resolution_treats_hearing_application_as_apply(
        self,
    ) -> None:
        assignment = resolve_regulation_procedure_action(
            text="学生应当在收到告知书后10日内提交书面听证申请。",
            actor="student",
        )

        self.assertEqual(canonical_regulation_procedure_action(assignment.value), "apply")
        self.assertEqual(assignment.provenance, "keyword:听证申请")

    def test_shared_answer_role_resolution_does_not_treat_quota_clause_in_procedure_section_as_step(
        self,
    ) -> None:
        assignment = resolve_regulation_answer_role(
            text="第九条 评选名额。全校每次评选优秀导师10名左右，评选优秀导师团队5支左右。",
            prefix_text="评选名额与评选程序",
        )

        self.assertNotEqual(assignment.value, "procedure_step")

    def test_shared_answer_role_resolution_does_not_treat_result_usage_clause_as_step(self) -> None:
        assignment = resolve_regulation_answer_role(
            text=(
                "第十三条 各级党组织考核为“好”的，作为申报上级党组织评优评先活动的依据；"
                "考核为“较好”以上的，方可参评校内评优评先。"
            ),
            prefix_text="考核程序",
        )

        self.assertNotEqual(assignment.value, "procedure_step")

    def test_shared_answer_role_resolution_does_not_treat_prohibition_clause_as_step(self) -> None:
        assignment = resolve_regulation_answer_role(
            text="（七）发放任何形式的个人补助；",
            prefix_text="经费使用程序",
        )

        self.assertEqual(assignment.value, "exclusion_rule")
        self.assertEqual(assignment.provenance, "matched_implicit_exclusion_marker")

    def test_shared_answer_role_resolution_does_not_treat_planning_prose_as_intro(self) -> None:
        assignment = resolve_regulation_answer_role(
            text=(
                "积极推进学校治理体系和治理能力现代化，完善内部治理结构，"
                "不断提升办学质量和服务水平。"
            ),
            prefix_text="中央民族大学事业发展“十三五”规划",
        )

        self.assertEqual(assignment.value, "supporting_detail")

    def test_shared_procedure_actor_resolution_prefers_explicit_metadata_alias(self) -> None:
        assignment = resolve_regulation_procedure_actor(
            text="申请人提交材料。",
            explicit_actor="申请人",
        )

        self.assertEqual(assignment.value, "applicant")
        self.assertEqual(assignment.provenance, "metadata:procedure_actor")

    def test_shared_procedure_actor_resolution_supports_student_rule_procedure_clause(self) -> None:
        assignment = resolve_regulation_procedure_actor(
            text="1. 学生本人提交解除处分申请材料。",
        )

        self.assertEqual(assignment.value, "student")
        self.assertEqual(assignment.provenance, "keyword:学生")

    def test_shared_procedure_actor_resolution_supports_institutional_office_clause(self) -> None:
        assignment = resolve_regulation_procedure_actor(
            text="统一受理、协调处理、统一答复向学校提出的信息公开申请。",
        )

        self.assertEqual(assignment.value, "office")
        self.assertEqual(assignment.provenance, "keyword:学校部门职责")

    def test_shared_procedure_actor_resolution_supports_generic_office_suffix_actor(self) -> None:
        assignment = resolve_regulation_procedure_actor(
            text="国际合作处汇总学生信息并制作资助明细表转财务处。财务处按表拨付至学生用于缴纳学费的银行卡内。",
        )

        self.assertEqual(assignment.value, "office")
        self.assertEqual(assignment.provenance, "regex:generic_office_actor")

    def test_shared_procedure_actor_resolution_prefers_student_affairs_office_over_student(
        self,
    ) -> None:
        assignment = resolve_regulation_procedure_actor(
            text="学生处受理学生提交的申请材料。",
        )

        self.assertEqual(assignment.value, "student_affairs_office")
        self.assertEqual(assignment.provenance, "keyword:学生处")

    def test_shared_procedure_actor_resolution_prefers_academic_affairs_office_over_student(
        self,
    ) -> None:
        assignment = resolve_regulation_procedure_actor(
            text="教务处审核学生提交的补办申请。",
        )

        self.assertEqual(assignment.value, "academic_affairs_office")
        self.assertEqual(assignment.provenance, "keyword:教务处")

    def test_shared_procedure_actor_resolution_prefers_college_over_student_object(
        self,
    ) -> None:
        assignment = resolve_regulation_procedure_actor(
            text="学院审核学生提交的申请材料。",
        )

        self.assertEqual(assignment.value, "college")
        self.assertEqual(assignment.provenance, "keyword:学院单位")

    def test_shared_procedure_actor_resolution_prefers_instructor_over_student_object(
        self,
    ) -> None:
        assignment = resolve_regulation_procedure_actor(
            text="指导教师审核学生提交的项目申请材料。",
        )

        self.assertEqual(assignment.value, "instructor")
        self.assertEqual(assignment.provenance, "keyword:教师")

    def test_shared_procedure_actor_resolution_supports_hearing_investigator_clause(self) -> None:
        assignment = resolve_regulation_procedure_actor(
            text="调查人员提出当事人违法、违纪或者违规的事实、证据和处分建议。",
        )

        self.assertEqual(assignment.value, "office")
        self.assertTrue(assignment.provenance)

    def test_shared_procedure_actor_resolution_supports_assessment_agency_clause(self) -> None:
        assignment = resolve_regulation_procedure_actor(
            text="考核机构对上交材料进行综合考评。",
        )

        self.assertEqual(assignment.value, "office")
        self.assertTrue(assignment.provenance)

    def test_shared_procedure_actor_resolution_defaults_imperative_material_step_to_applicant(
        self,
    ) -> None:
        assignment = resolve_regulation_procedure_actor(
            text="(一)提交认证材料。",
        )

        self.assertEqual(assignment.value, "applicant")
        self.assertEqual(assignment.provenance, "keyword:imperative_material_step")

    def test_shared_procedure_actor_resolution_defaults_publish_result_step_to_office(self) -> None:
        assignment = resolve_regulation_procedure_actor(
            text="(三)公布考核结果。",
        )

        self.assertEqual(assignment.value, "office")
        self.assertEqual(assignment.provenance, "keyword:publish_notice")

    def test_shared_procedure_actor_resolution_ignores_student_object_in_disposition_clause(
        self,
    ) -> None:
        assignment = resolve_regulation_procedure_actor(
            text="对学生的退学处理,由校长办公会或授权的专门会议研究决定。",
        )

        self.assertEqual(assignment.value, "office")
        self.assertTrue(assignment.provenance)

    def test_shared_procedure_actor_resolution_supports_hearing_cross_examination_clause(
        self,
    ) -> None:
        assignment = resolve_regulation_procedure_actor(
            text="(五)经听证主持人允许,听证参加人员可以对有关证据进行质证。",
        )

        self.assertEqual(assignment.value, "office")
        self.assertTrue(assignment.provenance)

    def test_shared_procedure_actor_resolution_supports_review_decision_clause(self) -> None:
        assignment = resolve_regulation_procedure_actor(
            text="(五)作出复查决定或提出建议。",
        )

        self.assertEqual(assignment.value, "office")
        self.assertTrue(assignment.provenance)

    def test_shared_procedure_actor_resolution_prefers_exam_staff_over_student_object(
        self,
    ) -> None:
        assignment = resolve_regulation_procedure_actor(
            text="(三)考试工作人员应及时没收、保存好违纪学生试卷、违规工具或材料,并要求违规学生在违规材料上签署姓名。",
        )

        self.assertEqual(assignment.value, "office")
        self.assertTrue(assignment.provenance)

    def test_shared_procedure_actor_resolution_prefers_student_affairs_office_for_live_defense_review(
        self,
    ) -> None:
        assignment = resolve_regulation_procedure_actor(
            text="2. 现场答辩。党委学生工作部、学生处组织成立学校评审小组,根据参评班级现场答辩情况进行联合评审。",
        )

        self.assertEqual(assignment.value, "student_affairs_office")
        self.assertTrue(assignment.provenance)

    def test_shared_procedure_actor_resolution_supports_dismissal_notice_delivery_clause(
        self,
    ) -> None:
        assignment = resolve_regulation_procedure_actor(
            text="(二)对退学的学生,由学校出具退学决定书并送交本人,无法送达本人的,在校内公告即视为送达。",
        )

        self.assertEqual(assignment.value, "office")
        self.assertTrue(assignment.provenance)

    def test_shared_answer_role_resolution_allows_non_procedure_status_to_override_procedure_hint(
        self,
    ) -> None:
        assignment = resolve_regulation_answer_role(
            text="（5）正在接受纪律审查或司法调查尚未做出结论者；",
            prefix_text="（四）七级职员岗位 任职条件",
            role_hint="procedure_step",
        )

        self.assertEqual(assignment.value, "eligibility_condition")
        self.assertEqual(assignment.provenance, "review_status_not_procedure_override")

    def test_shared_answer_role_resolution_allows_terminal_provision_to_override_hint(
        self,
    ) -> None:
        assignment = resolve_regulation_answer_role(
            text="1. 本办法自公布之日起施行。",
            prefix_text="申请奖学金应符合以下条件:",
            role_hint="eligibility_condition",
        )

        self.assertEqual(assignment.value, "supporting_detail")
        self.assertEqual(assignment.provenance, "terminal_provision")

    def test_shared_answer_role_resolution_allows_exclusion_intro_to_override_procedure_hint(
        self,
    ) -> None:
        assignment = resolve_regulation_answer_role(
            text="第二十二条 调解委员会成员有下列情形之一者，当事人有权以书面形式申请要求其回避：",
            prefix_text="第四章 调解程序",
            role_hint="procedure_step",
        )

        self.assertEqual(assignment.value, "eligibility_intro")
        self.assertEqual(assignment.provenance, "matched_exclusion_group_intro")

    def test_shared_answer_role_resolution_does_not_treat_joint_award_eligibility_as_procedure_step(
        self,
    ) -> None:
        assignment = resolve_regulation_answer_role(
            text="（二）在同一学年内,申请国家助学金的家庭经济困难学生可同时申请并获得国家奖学金或国家励志奖学金。",
            prefix_text="四、评审要求与程序",
        )

        self.assertEqual(assignment.value, "eligibility_condition")
        self.assertEqual(assignment.provenance, "matched_eligibility_marker")

    def test_shared_answer_role_resolution_does_not_treat_large_guideline_manifesto_as_procedure_step(
        self,
    ) -> None:
        assignment = resolve_regulation_answer_role(
            text=(
                "2005年3月25日\n"
                "一、志存高远,坚定信念。\n"
                "努力学习马克思列宁主义、毛泽东思想、邓小平理论和“三个代表”重要思想,面向世界,了解国情,确立在中国共产党领导下走社会主义道路、实现中华民族伟大复兴的共同理想和坚定信念,努力成为有理想、有道德、有文化、有纪律的社会主义新人。\n"
                "二、热爱祖国,服务人民。\n"
                "弘扬民族精神,维护国家利益和民族团结。不参与违反四项基本原则、影响国家统一和社会稳定的活动。培养同人民群众的深厚感情,正确处理国家、集体和个人三者利益关系,增强社会责任感,甘愿为祖国为人民奉献。\n"
                "三、勤奋学习,自强不息。\n"
                "追求真理,崇尚科学;刻苦钻研,严谨求实;积极实践,勇于创新;珍惜时间,学业有成。"
            ),
            prefix_text="",
        )

        self.assertEqual(assignment.value, "supporting_detail")
        self.assertEqual(assignment.provenance, "no_answer_ready_marker")

    def test_shared_answer_role_resolution_does_not_treat_misconduct_recognition_fragment_as_procedure_step(
        self,
    ) -> None:
        assignment = resolve_regulation_answer_role(
            text="(九)在答卷上填写与本人身份不符的姓名、考号等信息的;",
            prefix_text="第二章 违规行为的认定",
        )

        self.assertEqual(assignment.value, "supporting_detail")
        self.assertEqual(assignment.provenance, "no_answer_ready_marker")

    def test_shared_answer_role_resolution_does_not_treat_assessment_topic_headings_as_procedure_step(
        self,
    ) -> None:
        for text in ("（四）选拔考核方式", "（五）笔试考核", "（六）面试考核"):
            with self.subTest(text=text):
                assignment = resolve_regulation_answer_role(
                    text=text,
                    prefix_text="",
                    role_hint="procedure_step",
                )

                self.assertEqual(assignment.value, "supporting_detail")
                self.assertEqual(assignment.provenance, "non_action_assessment_heading")
