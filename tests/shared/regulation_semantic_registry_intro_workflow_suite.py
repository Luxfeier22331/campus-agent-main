from __future__ import annotations

from campus_ingestion_core.regulation_evidence_contract import infer_intro_target_roles
from campus_shared.regulation_semantic_registry import (
    canonical_regulation_procedure_action,
    resolve_regulation_group_intro_kind,
    resolve_regulation_intro_list_role_hint,
    resolve_regulation_intro_scope,
    resolve_regulation_procedure_action,
    resolve_regulation_procedure_actor,
    resolve_regulation_procedure_materials,
    resolve_regulation_procedure_next_actor,
)


class RegulationSemanticRegistryIntroWorkflowSuite:
    def test_shared_procedure_next_actor_resolution_supports_college_followup(self) -> None:
        assignment = resolve_regulation_procedure_next_actor(
            text="学生提交后由学院审核。",
        )

        self.assertEqual(assignment.value, "college")
        self.assertEqual(assignment.provenance, "keyword:学院")

    def test_shared_intro_list_role_hint_resolves_material_list_variants(self) -> None:
        for text in (
            "申请材料如下:",
            "申诉人应提交以下材料：",
            "补充材料如下：",
        ):
            with self.subTest(text=text):
                assignment = resolve_regulation_intro_list_role_hint(text)
                self.assertEqual(assignment.value, "material_requirement")
                self.assertTrue(assignment.provenance.startswith("text:material_intro"))

    def test_shared_intro_list_role_hint_resolves_time_list_variants(self) -> None:
        for text in (
            "申诉期限如下:",
            "申诉应在下列期限内提出：",
            "补充期限如下：",
        ):
            with self.subTest(text=text):
                assignment = resolve_regulation_intro_list_role_hint(text)
                self.assertEqual(assignment.value, "time_constraint")
                self.assertTrue(assignment.provenance.startswith("text:time_intro"))

    def test_shared_intro_list_role_hint_distinguishes_procedure_list(self) -> None:
        assignment = resolve_regulation_intro_list_role_hint("按如下程序办理:")

        self.assertEqual(assignment.value, "procedure_step")
        self.assertTrue(assignment.provenance.startswith("text:procedure_intro"))

    def test_shared_intro_list_role_hint_supports_according_to_below_procedure(self) -> None:
        assignment = resolve_regulation_intro_list_role_hint("听证会应当按照下列程序进行:")

        self.assertEqual(assignment.value, "procedure_step")
        self.assertTrue(assignment.provenance.startswith("text:procedure_intro"))

    def test_shared_intro_list_role_hint_supports_extended_procedure_intro_phrasings(
        self,
    ) -> None:
        for text in (
            "优秀本科毕业生评选工作在学校党委的领导下,按照以下程序组织进行:",
            "本科学生国家励志奖学金按以下程序进行评选:",
            "学生临时困难补助的申请按以下程序执行:",
        ):
            with self.subTest(text=text):
                assignment = resolve_regulation_intro_list_role_hint(text)
                self.assertEqual(assignment.value, "procedure_step")
                self.assertTrue(assignment.provenance.startswith("text:procedure_intro"))

    def test_shared_group_intro_kind_resolves_condition_intro_variants(self) -> None:
        for text in (
            "符合下列条件之一:",
            "参评学生还应符合下列条件之一：",
            "同时,还须具备以下条件之一:",
        ):
            with self.subTest(text=text):
                assignment = resolve_regulation_group_intro_kind(text)
                self.assertEqual(assignment.value, "condition_group_intro")
                self.assertTrue(assignment.provenance.startswith("text:condition_group_intro"))

    def test_shared_group_intro_kind_resolves_exclusion_intro_variants(self) -> None:
        for text in (
            "有下列情形之一:",
            "有以下情形之一：",
            "有下列情形之一的，不予解除处分:",
            "出现下列情形之一的,由院系核实并报学校助学服务中心备案,从当月起中止其助学金发放:",
        ):
            with self.subTest(text=text):
                assignment = resolve_regulation_group_intro_kind(text)
                self.assertEqual(assignment.value, "exclusion_group_intro")
                self.assertTrue(assignment.provenance.startswith("text:exclusion_group_intro"))

    def test_shared_group_intro_kind_reuses_typed_list_intros(self) -> None:
        material = resolve_regulation_group_intro_kind("申请材料如下:")
        time = resolve_regulation_group_intro_kind("申诉期限如下：")

        self.assertEqual(material.value, "material_list_intro")
        self.assertTrue(material.provenance.startswith("text:material_intro"))
        self.assertEqual(time.value, "time_list_intro")
        self.assertTrue(time.provenance.startswith("text:time_intro"))

    def test_shared_group_intro_kind_supports_plain_condition_list_prefix(self) -> None:
        assignment = resolve_regulation_group_intro_kind("申请专项奖学金应符合以下条件:")

        self.assertEqual(assignment.value, "condition_group_intro")
        self.assertEqual(assignment.provenance, "text:condition_group_intro")

    def test_shared_intro_scope_resolution_prefers_target_roles(self) -> None:
        material = resolve_regulation_intro_scope(
            text="申请材料如下:",
            intro_target_roles=("material_requirement",),
        )
        time = resolve_regulation_intro_scope(
            text="申诉期限如下:",
            intro_target_roles=("time_constraint",),
        )
        procedure = resolve_regulation_intro_scope(
            text="按如下程序办理:",
            intro_target_roles=("procedure_step",),
        )
        eligibility = resolve_regulation_intro_scope(
            text="符合下列条件之一:",
            intro_target_roles=("exception_rule", "example_evidence"),
        )

        self.assertEqual(material.value, "material_list")
        self.assertEqual(material.provenance, "intro_target_roles:material_requirement")
        self.assertEqual(time.value, "time_list")
        self.assertEqual(time.provenance, "intro_target_roles:time_constraint")
        self.assertEqual(procedure.value, "procedure_list")
        self.assertEqual(procedure.provenance, "intro_target_roles:procedure_step")
        self.assertEqual(eligibility.value, "eligibility_group")
        self.assertEqual(eligibility.provenance, "intro_target_roles:eligibility_group")

    def test_shared_intro_scope_resolution_supports_text_fallback(self) -> None:
        procedure = resolve_regulation_intro_scope(
            text="办理程序如下:",
            intro_target_roles=(),
        )
        generic = resolve_regulation_intro_scope(
            text="符合下列条件之一:",
            intro_target_roles=(),
        )

        self.assertEqual(procedure.value, "procedure_list")
        self.assertEqual(procedure.provenance, "text:procedure_list")
        self.assertEqual(generic.value, "eligibility_group")
        self.assertEqual(generic.provenance, "text:condition_group_intro")

    def test_shared_intro_scope_resolution_ignores_supporting_detail_pollution(self) -> None:
        procedure = resolve_regulation_intro_scope(
            text="指导教师(组)应:",
            intro_target_roles=("supporting_detail", "procedure_step"),
        )
        eligibility = resolve_regulation_intro_scope(
            text="本科生研究训练计划项目分为自由申报项目和双向选择项目:",
            intro_target_roles=("procedure_step", "supporting_detail"),
        )

        self.assertEqual(procedure.value, "procedure_list")
        self.assertEqual(procedure.provenance, "intro_target_roles:procedure_step")
        self.assertEqual(eligibility.value, "procedure_list")
        self.assertEqual(eligibility.provenance, "intro_target_roles:procedure_step")

    def test_shared_procedure_materials_resolution_extracts_controlled_material_markers(
        self,
    ) -> None:
        materials = resolve_regulation_procedure_materials(
            "学生补办学生证时，必须提出书面申请，并填写补办申请表后到学生处办理。"
        )
        relief_materials = resolve_regulation_procedure_materials(
            "学生提交解除处分申请表，经学院审核后报学生处。"
        )

        self.assertEqual(
            materials,
            ("书面申请", "补办申请表"),
        )
        self.assertEqual(relief_materials, ("解除处分申请表",))

    def test_shared_procedure_action_resolution_supports_fill_and_report_steps(self) -> None:
        assignment = resolve_regulation_procedure_action(
            text="2. 学生填写《本科生研究训练计划项目申请书》并上报项目负责人所在院系;",
            actor="student",
        )

        self.assertEqual(
            canonical_regulation_procedure_action(assignment.value), "submit_materials"
        )
        self.assertTrue(assignment.provenance)

    def test_shared_procedure_action_resolution_supports_hearing_investigator_proposal_step(
        self,
    ) -> None:
        assignment = resolve_regulation_procedure_action(
            text="(二)调查人员提出拟被处分或者处理学生违法或违规违纪的事实、证据。",
            actor="office",
        )

        self.assertEqual(canonical_regulation_procedure_action(assignment.value), "appeal")
        self.assertTrue(assignment.provenance)

    def test_shared_procedure_action_resolution_supports_assessment_review_step(self) -> None:
        assignment = resolve_regulation_procedure_action(
            text="(二)考核机构对上交材料进行综合考评。",
            actor="office",
        )

        self.assertEqual(canonical_regulation_procedure_action(assignment.value), "office_review")
        self.assertTrue(assignment.provenance)

    def test_shared_procedure_action_resolution_supports_research_decision_step(self) -> None:
        assignment = resolve_regulation_procedure_action(
            text="(一)对学生的退学处理,由校长办公会或授权的专门会议研究决定。",
            actor="office",
        )

        self.assertEqual(canonical_regulation_procedure_action(assignment.value), "office_review")
        self.assertTrue(assignment.provenance)

    def test_shared_procedure_action_resolution_supports_material_delivery_step(self) -> None:
        assignment = resolve_regulation_procedure_action(
            text="符合申请条件的毕业生向所在院系递交申请材料。",
            actor="college",
        )

        self.assertEqual(
            canonical_regulation_procedure_action(assignment.value), "submit_materials"
        )
        self.assertTrue(assignment.provenance)

    def test_shared_procedure_action_resolution_supports_interview_assessment_step(self) -> None:
        assignment = resolve_regulation_procedure_action(
            text="面试主要考核申请者的口语表达能力和综合素质。",
            actor="applicant",
        )

        self.assertEqual(canonical_regulation_procedure_action(assignment.value), "review")
        self.assertTrue(assignment.provenance)

    def test_shared_procedure_action_resolution_supports_ranking_review_step(self) -> None:
        assignment = resolve_regulation_procedure_action(
            text="教务处综合申请者的笔试、面试成绩总分,从高到低排序。",
            actor="academic_affairs_office",
        )

        self.assertEqual(canonical_regulation_procedure_action(assignment.value), "office_review")
        self.assertTrue(assignment.provenance)

    def test_shared_procedure_action_resolution_supports_interview_clause(self) -> None:
        assignment = resolve_regulation_procedure_action(
            text="约谈涉及学生处理或者处分事宜的相关部门和相关人员,进一步了解核实有关情况。",
            actor="office",
        )

        self.assertEqual(canonical_regulation_procedure_action(assignment.value), "process")
        self.assertTrue(assignment.provenance)

    def test_shared_procedure_action_resolution_supports_review_decision_clause(self) -> None:
        assignment = resolve_regulation_procedure_action(
            text="作出复查决定或提出建议。",
            actor="office",
        )

        self.assertEqual(canonical_regulation_procedure_action(assignment.value), "office_review")
        self.assertTrue(assignment.provenance)

    def test_shared_procedure_action_resolution_supports_department_request_application_step(
        self,
    ) -> None:
        assignment = resolve_regulation_procedure_action(
            text="岗位需求单位在规定时间内通过学校学生工作管理系统向学校助学服务中心提出岗位需求申请。",
            actor="office",
        )

        self.assertEqual(canonical_regulation_procedure_action(assignment.value), "apply")
        self.assertTrue(assignment.provenance)

    def test_shared_procedure_action_resolution_supports_hearing_department_basis_proposal_step(
        self,
    ) -> None:
        assignment = resolve_regulation_procedure_action(
            text="(三)学校学生违纪处理部门提出处分或者处理的依据、建议。",
            actor="office",
        )

        self.assertEqual(canonical_regulation_procedure_action(assignment.value), "appeal")
        self.assertTrue(assignment.provenance)

    def test_shared_procedure_action_resolution_supports_cross_examination_clause(self) -> None:
        assignment = resolve_regulation_procedure_action(
            text="(五)经听证主持人允许,听证参加人员可以对有关证据进行质证。",
            actor="office",
        )

        self.assertEqual(canonical_regulation_procedure_action(assignment.value), "appeal")
        self.assertTrue(assignment.provenance)

    def test_shared_procedure_action_resolution_supports_signature_confirmation_step(
        self,
    ) -> None:
        assignment = resolve_regulation_procedure_action(
            text="(二)违规学生应在考场记录上签字确认。若违规学生拒绝签字确认,由2名或以上考试工作人员共同写明情况后签字确认。",
            actor="student",
        )

        self.assertEqual(
            canonical_regulation_procedure_action(assignment.value), "submit_materials"
        )
        self.assertTrue(assignment.provenance)

    def test_shared_procedure_action_resolution_supports_exam_staff_violation_handling_step(
        self,
    ) -> None:
        assignment = resolve_regulation_procedure_action(
            text="(三)考试工作人员应及时没收、保存好违纪学生试卷、违规工具或材料,并要求违规学生在违规材料上签署姓名。若违规学生拒绝签字确认,由2名或以上考试工作人员共同写明情况后签字确认。",
            actor="office",
        )

        self.assertEqual(canonical_regulation_procedure_action(assignment.value), "process")
        self.assertTrue(assignment.provenance)

    def test_shared_procedure_action_resolution_supports_live_defense_joint_review_step(
        self,
    ) -> None:
        assignment = resolve_regulation_procedure_action(
            text="2. 现场答辩。党委学生工作部、学生处组织成立学校评审小组,根据参评班级现场答辩情况进行联合评审。",
            actor="student_affairs_office",
        )

        self.assertEqual(canonical_regulation_procedure_action(assignment.value), "office_review")
        self.assertTrue(assignment.provenance)

    def test_shared_procedure_action_resolution_supports_dismissal_notice_delivery_step(
        self,
    ) -> None:
        assignment = resolve_regulation_procedure_action(
            text="(二)对退学的学生,由学校出具退学决定书并送交本人,无法送达本人的,在校内公告即视为送达。",
            actor="office",
        )

        self.assertEqual(canonical_regulation_procedure_action(assignment.value), "publish_notice")
        self.assertTrue(assignment.provenance)

    def test_shared_intro_target_roles_infer_condition_group_intro_without_one_of_suffix(
        self,
    ) -> None:
        target_roles = infer_intro_target_roles(
            text="第四条 申请成立学生社团，须具备以下条件：",
            metadata={"answer_role": "eligibility_intro"},
        )

        self.assertEqual(target_roles, ("eligibility_condition",))

    def test_shared_intro_target_roles_infer_exclusion_group_intro_without_one_of_suffix(
        self,
    ) -> None:
        target_roles = infer_intro_target_roles(
            text="第十五条 出现以下情形的专业应予以暂停招生。",
            metadata={"answer_role": "eligibility_intro"},
        )

        self.assertEqual(target_roles, ("exclusion_rule",))

    def test_shared_procedure_actor_resolution_supports_research_decision_clause(self) -> None:
        assignment = resolve_regulation_procedure_actor(
            text="2. 研究决定师德考核评议等；",
        )

        self.assertEqual(assignment.value, "office")
        self.assertTrue(assignment.provenance)

    def test_shared_procedure_actor_resolution_supports_reporting_clause(self) -> None:
        assignment = resolve_regulation_procedure_actor(
            text="（二）筹备工作小组向全体代表汇报代表资格审查及代表增补情况；",
        )

        self.assertEqual(assignment.value, "office")
        self.assertTrue(assignment.provenance)

    def test_shared_procedure_action_resolution_supports_material_list_item(self) -> None:
        assignment = resolve_regulation_procedure_action(
            text="（一）《中央民族大学接收推荐免试攻读研究生申请表》。",
            actor="applicant",
        )

        self.assertEqual(
            canonical_regulation_procedure_action(assignment.value), "submit_materials"
        )
        self.assertTrue(assignment.provenance)

    def test_shared_procedure_action_resolution_supports_identity_material_clause(self) -> None:
        assignment = resolve_regulation_procedure_action(
            text="（六）申请人有效居民身份证复印件及《教育部学籍在线验证报告》。",
            actor="applicant",
        )

        self.assertEqual(
            canonical_regulation_procedure_action(assignment.value), "submit_materials"
        )
        self.assertTrue(assignment.provenance)

    def test_shared_procedure_action_resolution_supports_procedure_intro_clause(self) -> None:
        assignment = resolve_regulation_procedure_action(
            text="第二十条 调解委员会按下列程序进行调解：",
            actor="office",
        )

        self.assertEqual(canonical_regulation_procedure_action(assignment.value), "process")
        self.assertTrue(assignment.provenance)

    def test_shared_procedure_action_resolution_supports_timed_mediation_clause(self) -> None:
        assignment = resolve_regulation_procedure_action(
            text=(
                "第二十一条 调解委员会调解劳动、人事争议，应当自当事人申请调解之日起三十日内结束，"
                "到期未结束的，视为调解不成。"
            ),
            actor="office",
        )

        self.assertEqual(canonical_regulation_procedure_action(assignment.value), "process")
        self.assertTrue(assignment.provenance)

    def test_shared_procedure_action_resolution_supports_personal_application_clause(self) -> None:
        assignment = resolve_regulation_procedure_action(
            text="（二）个人申请。",
            actor="applicant",
        )

        self.assertEqual(canonical_regulation_procedure_action(assignment.value), "apply")
        self.assertTrue(assignment.provenance)
