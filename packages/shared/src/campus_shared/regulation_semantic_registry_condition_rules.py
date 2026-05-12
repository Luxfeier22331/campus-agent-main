from __future__ import annotations

from .regulation_semantic_registry_types import RegulationConditionSubjectDefinition

REGULATION_GROUPED_ANSWER_ROLES = frozenset(
    {
        "eligibility_intro",
        "eligibility_condition",
        "exception_rule",
        "exclusion_rule",
        "example_evidence",
        "procedure_step",
        "supporting_detail",
        "time_constraint",
        "table_fact",
    }
)


REGULATION_CONDITION_SUBJECT_DEFINITIONS: dict[str, RegulationConditionSubjectDefinition] = {
    "application_procedure": RegulationConditionSubjectDefinition(
        subject_id="application_procedure",
        description="办理、申请、审核、公示、补办等程序性步骤或流程条件。",
        expected_answer_roles=("procedure_step", "eligibility_intro"),
        query_focus_terms=("申请", "办理", "流程", "程序"),
    ),
    "rank_threshold": RegulationConditionSubjectDefinition(
        subject_id="rank_threshold",
        description="成绩、排名、综测等排序阈值条件。",
        expected_answer_roles=(
            "exception_rule",
            "eligibility_condition",
            "example_evidence",
            "table_fact",
        ),
        query_focus_terms=("排名", "前10", "前30"),
    ),
    "paper_or_publication": RegulationConditionSubjectDefinition(
        subject_id="paper_or_publication",
        description="论文、发表、科研成果、专利、竞赛成果等要求。",
        expected_answer_roles=("example_evidence", "eligibility_condition", "exception_rule"),
        query_focus_terms=("论文", "著作", "发表", "出版"),
    ),
    "academic_performance": RegulationConditionSubjectDefinition(
        subject_id="academic_performance",
        description="课程成绩、学分、培养环节完成情况等学业表现要求。",
        expected_answer_roles=(
            "eligibility_condition",
            "exception_rule",
            "example_evidence",
            "table_fact",
        ),
        query_focus_terms=("成绩", "学分", "培养环节"),
        query_focus_equivalents=(("学时", "课时", "节"),),
    ),
    "attendance_absence_threshold": RegulationConditionSubjectDefinition(
        subject_id="attendance_absence_threshold",
        description="旷课、考勤缺勤累计节次或学时对应的违纪处分阈值。",
        expected_answer_roles=(
            "eligibility_condition",
            "table_fact",
            "supporting_detail",
        ),
        query_focus_terms=("旷课", "考勤", "学时", "课时", "节"),
        query_focus_equivalents=(("学时", "课时", "节"),),
    ),
    "conduct_or_discipline_status": RegulationConditionSubjectDefinition(
        subject_id="conduct_or_discipline_status",
        description="违纪处分、思想品德、行为规范等状态要求。",
        expected_answer_roles=("eligibility_condition", "exception_rule", "exclusion_rule"),
    ),
    "material_requirement": RegulationConditionSubjectDefinition(
        subject_id="material_requirement",
        description="申请表、证明、复印件、原件等材料要求。",
        expected_answer_roles=(
            "procedure_step",
            "eligibility_condition",
            "eligibility_intro",
            "material_requirement",
            "table_fact",
        ),
        query_focus_terms=("材料", "证明", "提交"),
    ),
    "deadline": RegulationConditionSubjectDefinition(
        subject_id="deadline",
        description="截止时间、办理时限、公示窗口等时间约束。",
        expected_answer_roles=(
            "eligibility_condition",
            "eligibility_intro",
            "exclusion_rule",
            "time_constraint",
            "table_fact",
        ),
        query_focus_terms=("时间", "截止", "期限"),
    ),
    "appeal_or_review_right": RegulationConditionSubjectDefinition(
        subject_id="appeal_or_review_right",
        description="申诉、复核、复议、听证等权利和救济路径。",
        expected_answer_roles=("procedure_step", "eligibility_condition", "exception_rule"),
    ),
    "discipline_relief_condition": RegulationConditionSubjectDefinition(
        subject_id="discipline_relief_condition",
        description="解除处分的正向资格条件。",
        expected_answer_roles=(
            "eligibility_condition",
            "exception_rule",
            "example_evidence",
        ),
        query_focus_terms=("解除处分", "条件", "考察期"),
    ),
    "discipline_relief_exclusion": RegulationConditionSubjectDefinition(
        subject_id="discipline_relief_exclusion",
        description="解除处分的不予受理、不得申请或排除情形。",
        expected_answer_roles=("exclusion_rule",),
        query_focus_terms=("解除处分", "不予", "情形"),
    ),
    "safety_or_security_restriction": RegulationConditionSubjectDefinition(
        subject_id="safety_or_security_restriction",
        description="国家安全、公共安全、经济安全、社会稳定、校园安全等限制。",
        expected_answer_roles=("exclusion_rule",),
    ),
    "security_or_confidentiality_requirement": RegulationConditionSubjectDefinition(
        subject_id="security_or_confidentiality_requirement",
        description="涉密、定密、保密期限、安全等级、接入前核准等正向安全或保密要求。",
        expected_answer_roles=("eligibility_condition", "exception_rule", "procedure_step"),
    ),
    "generic_condition": RegulationConditionSubjectDefinition(
        subject_id="generic_condition",
        description="当前还未细分到更窄 taxonomy 的通用资格条件。",
        expected_answer_roles=(
            "eligibility_condition",
            "exception_rule",
            "eligibility_intro",
            "table_fact",
        ),
    ),
    "generic_restriction": RegulationConditionSubjectDefinition(
        subject_id="generic_restriction",
        description="当前还未细分到更窄 taxonomy 的通用限制条款。",
        expected_answer_roles=("exclusion_rule",),
    ),
    "disqualification_or_nonacceptance": RegulationConditionSubjectDefinition(
        subject_id="disqualification_or_nonacceptance",
        description="不予受理、取消资格、无资格、不予加分等排除条款。",
        expected_answer_roles=("exclusion_rule",),
    ),
    "activity_scope_restriction": RegulationConditionSubjectDefinition(
        subject_id="activity_scope_restriction",
        description="范围限制、不得变更、不得以无关事项替代等限制。",
        expected_answer_roles=("exclusion_rule",),
    ),
    "amount_or_quota": RegulationConditionSubjectDefinition(
        subject_id="amount_or_quota",
        description="名额、金额、比例、额度等定量条件。",
        expected_answer_roles=("table_fact", "eligibility_condition", "exclusion_rule"),
        query_focus_terms=("金额", "名额", "比例", "额度"),
    ),
    "example_evidence": RegulationConditionSubjectDefinition(
        subject_id="example_evidence",
        description="作为示例或补充举证出现的佐证条件。",
        expected_answer_roles=("example_evidence", "eligibility_intro"),
    ),
    "moral_or_social_contribution": RegulationConditionSubjectDefinition(
        subject_id="moral_or_social_contribution",
        description="道德表现、见义勇为、服务社会、志愿奉献等条件。",
        expected_answer_roles=("example_evidence", "eligibility_condition", "exception_rule"),
    ),
    "arts_competition": RegulationConditionSubjectDefinition(
        subject_id="arts_competition",
        description="文艺比赛、艺术竞赛成果等条件。",
        expected_answer_roles=("example_evidence", "eligibility_condition", "exception_rule"),
    ),
    "sports_competition": RegulationConditionSubjectDefinition(
        subject_id="sports_competition",
        description="体育比赛、体育竞赛成果等条件。",
        expected_answer_roles=("example_evidence", "eligibility_condition", "exception_rule"),
    ),
    "student_card_or_identity_credential": RegulationConditionSubjectDefinition(
        subject_id="student_card_or_identity_credential",
        description="学生证、证件挂失、补办、身份凭证相关规则。",
        expected_answer_roles=("procedure_step", "eligibility_condition", "exclusion_rule"),
        query_focus_terms=("学生证", "挂失", "补办"),
    ),
    "dormitory_or_accommodation": RegulationConditionSubjectDefinition(
        subject_id="dormitory_or_accommodation",
        description="宿舍、住宿、电器和寝室管理相关规则。",
        expected_answer_roles=("eligibility_condition", "exclusion_rule", "example_evidence"),
    ),
    "degree_or_graduation_requirement": RegulationConditionSubjectDefinition(
        subject_id="degree_or_graduation_requirement",
        description="学位授予、毕业资格、培养完成要求。",
        expected_answer_roles=("eligibility_condition", "exception_rule", "example_evidence"),
    ),
    "audience_scope": RegulationConditionSubjectDefinition(
        subject_id="audience_scope",
        description="适用对象、受众范围、学生身份范围。",
        expected_answer_roles=(
            "category_overview",
            "eligibility_condition",
            "eligibility_intro",
            "exception_rule",
        ),
    ),
}
