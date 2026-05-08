from __future__ import annotations

import json
import re
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path


@dataclass(frozen=True, slots=True)
class RegulationConditionSubjectDefinition:
    subject_id: str
    description: str
    expected_answer_roles: tuple[str, ...]
    release_blocking: bool = True


@dataclass(frozen=True, slots=True)
class RegulationProcedureActionDefinition:
    action_id: str
    description: str
    expected_answer_roles: tuple[str, ...]
    release_blocking: bool = True


@dataclass(frozen=True, slots=True)
class RegulationProcedureActorDefinition:
    actor_id: str
    description: str
    expected_answer_roles: tuple[str, ...]
    release_blocking: bool = True


@dataclass(frozen=True, slots=True)
class RegulationCategoryDefinition:
    category_id: str
    display_name: str
    aliases: tuple[str, ...]
    audience: str
    member_policy_document_ids: tuple[str, ...]
    overview_document_id: str
    default_procedure_document_id: str = ""
    procedure_overrides: tuple[tuple[str, str], ...] = ()


@dataclass(frozen=True, slots=True)
class RegulationPolicyObjectDefinition:
    document_id: str
    title: str
    aliases: tuple[str, ...]


@dataclass(frozen=True, slots=True)
class RegulationDiscoveryConfig:
    clarification_cues: tuple[str, ...]
    policy_objects: tuple[RegulationPolicyObjectDefinition, ...]
    policy_titles_by_document_id: dict[str, str]
    categories: tuple[RegulationCategoryDefinition, ...]


@dataclass(frozen=True, slots=True)
class RegulationSemanticAssignment:
    value: str
    provenance: str


@dataclass(frozen=True, slots=True)
class RegulationSemanticKeywordRule:
    value: str
    markers: tuple[str, ...]
    provenance: str
    match_mode: str = "any"


REGULATION_GROUPED_ANSWER_ROLES = frozenset(
    {
        "eligibility_intro",
        "eligibility_condition",
        "exception_rule",
        "exclusion_rule",
        "example_evidence",
        "procedure_step",
        "time_constraint",
        "table_fact",
    }
)


REGULATION_CONDITION_SUBJECT_DEFINITIONS: dict[str, RegulationConditionSubjectDefinition] = {
    "application_procedure": RegulationConditionSubjectDefinition(
        subject_id="application_procedure",
        description="办理、申请、审核、公示、补办等程序性步骤或流程条件。",
        expected_answer_roles=("procedure_step", "eligibility_intro"),
    ),
    "rank_threshold": RegulationConditionSubjectDefinition(
        subject_id="rank_threshold",
        description="成绩、排名、综测等排序阈值条件。",
        expected_answer_roles=(
            "eligibility_condition",
            "exception_rule",
            "example_evidence",
            "table_fact",
        ),
    ),
    "paper_or_publication": RegulationConditionSubjectDefinition(
        subject_id="paper_or_publication",
        description="论文、发表、科研成果、专利、竞赛成果等要求。",
        expected_answer_roles=("eligibility_condition", "exception_rule", "example_evidence"),
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
    ),
    "appeal_or_review_right": RegulationConditionSubjectDefinition(
        subject_id="appeal_or_review_right",
        description="申诉、复核、复议、听证等权利和救济路径。",
        expected_answer_roles=("procedure_step", "eligibility_condition", "exception_rule"),
    ),
    "discipline_relief_condition": RegulationConditionSubjectDefinition(
        subject_id="discipline_relief_condition",
        description="解除处分的正向资格条件。",
        expected_answer_roles=("eligibility_condition", "exception_rule", "example_evidence"),
    ),
    "discipline_relief_exclusion": RegulationConditionSubjectDefinition(
        subject_id="discipline_relief_exclusion",
        description="解除处分的不予受理、不得申请或排除情形。",
        expected_answer_roles=("exclusion_rule",),
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
        expected_answer_roles=("eligibility_condition", "exclusion_rule", "table_fact"),
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

REGULATION_PROCEDURE_ACTION_DEFINITIONS: dict[str, RegulationProcedureActionDefinition] = {
    "apply": RegulationProcedureActionDefinition(
        action_id="apply",
        description="发起申请或提交办理请求。",
        expected_answer_roles=("procedure_step",),
    ),
    "submit_materials": RegulationProcedureActionDefinition(
        action_id="submit_materials",
        description="提交申请表、证明或其他材料。",
        expected_answer_roles=("procedure_step",),
    ),
    "college_review": RegulationProcedureActionDefinition(
        action_id="college_review",
        description="学院、院系或基层单位审核。",
        expected_answer_roles=("procedure_step",),
    ),
    "office_review": RegulationProcedureActionDefinition(
        action_id="office_review",
        description="学校职能部门复核、审批或受理。",
        expected_answer_roles=("procedure_step",),
    ),
    "publish_notice": RegulationProcedureActionDefinition(
        action_id="publish_notice",
        description="公示、公告、结果发布。",
        expected_answer_roles=("procedure_step",),
    ),
    "appeal": RegulationProcedureActionDefinition(
        action_id="appeal",
        description="申诉、复核、提出异议。",
        expected_answer_roles=("procedure_step",),
    ),
    "report_loss": RegulationProcedureActionDefinition(
        action_id="report_loss",
        description="挂失、报告遗失或停用证件。",
        expected_answer_roles=("procedure_step",),
    ),
    "reissue": RegulationProcedureActionDefinition(
        action_id="reissue",
        description="补办、补发、换发证件或材料。",
        expected_answer_roles=("procedure_step",),
    ),
    "review": RegulationProcedureActionDefinition(
        action_id="review",
        description="尚未细分为学院或学校部门审核的泛化审核动作。",
        expected_answer_roles=("procedure_step",),
    ),
    "process": RegulationProcedureActionDefinition(
        action_id="process",
        description="受理、办理、协调、处理、答复等泛化办理动作。",
        expected_answer_roles=("procedure_step",),
    ),
    "procedure_step": RegulationProcedureActionDefinition(
        action_id="procedure_step",
        description="暂未细分到更窄动作 taxonomy 的占位程序动作。",
        expected_answer_roles=("procedure_step",),
    ),
}

REGULATION_PROCEDURE_ACTOR_DEFINITIONS: dict[str, RegulationProcedureActorDefinition] = {
    "applicant": RegulationProcedureActorDefinition(
        actor_id="applicant",
        description="申请人、申请者等发起办理请求的主体。",
        expected_answer_roles=("procedure_step",),
    ),
    "student": RegulationProcedureActorDefinition(
        actor_id="student",
        description="学生本人或学生群体作为流程执行主体。",
        expected_answer_roles=("procedure_step",),
    ),
    "instructor": RegulationProcedureActorDefinition(
        actor_id="instructor",
        description="指导教师、任课教师等教学主体作为流程执行者。",
        expected_answer_roles=("procedure_step",),
    ),
    "college": RegulationProcedureActorDefinition(
        actor_id="college",
        description="学院、院系、培养单位、分委员会等校内基层组织。",
        expected_answer_roles=("procedure_step",),
    ),
    "academic_affairs_office": RegulationProcedureActorDefinition(
        actor_id="academic_affairs_office",
        description="教务处等教学管理职能部门。",
        expected_answer_roles=("procedure_step",),
    ),
    "student_affairs_office": RegulationProcedureActorDefinition(
        actor_id="student_affairs_office",
        description="学生处等学生事务职能部门。",
        expected_answer_roles=("procedure_step",),
    ),
    "office": RegulationProcedureActorDefinition(
        actor_id="office",
        description="学校或未进一步细分的校级职能部门。",
        expected_answer_roles=("procedure_step",),
    ),
    "responsible_party": RegulationProcedureActorDefinition(
        actor_id="responsible_party",
        description="尚未细分到更窄 taxonomy 的责任主体或承办单位。",
        expected_answer_roles=("procedure_step",),
    ),
}

REGULATION_CONDITION_SUBJECT_ALIASES: dict[str, str] = {
    "discipline_relief_procedure": "application_procedure",
    "general_eligibility": "generic_condition",
}

REGULATION_PROCEDURE_ACTION_ALIASES: dict[str, str] = {}
REGULATION_PROCEDURE_ACTOR_ALIASES: dict[str, str] = {
    "申请人": "applicant",
    "申请者": "applicant",
    "学生": "student",
    "学生本人": "student",
    "教师": "instructor",
    "指导教师": "instructor",
    "学院": "college",
    "院系": "college",
    "培养单位": "college",
    "学位评定分委员会": "college",
    "党政联席会": "college",
    "教务处": "academic_affairs_office",
    "学生处": "student_affairs_office",
    "学校": "office",
    "部门": "office",
    "相关部门": "office",
    "责任主体": "responsible_party",
    "承办单位": "responsible_party",
}

REGULATION_PROCEDURE_ACTOR_RULES: tuple[RegulationSemanticKeywordRule, ...] = (
    RegulationSemanticKeywordRule(
        value="academic_affairs_office",
        markers=("教务处",),
        provenance="keyword:教务处",
    ),
    RegulationSemanticKeywordRule(
        value="student_affairs_office",
        markers=("学生处",),
        provenance="keyword:学生处",
    ),
    RegulationSemanticKeywordRule(
        value="applicant",
        markers=("申请人", "申请者"),
        provenance="keyword:申请人",
    ),
    RegulationSemanticKeywordRule(
        value="student",
        markers=("学生本人", "学生"),
        provenance="keyword:学生",
    ),
    RegulationSemanticKeywordRule(
        value="instructor",
        markers=("指导教师", "教师"),
        provenance="keyword:教师",
    ),
    RegulationSemanticKeywordRule(
        value="college",
        markers=("学院", "院系", "培养单位", "学位评定分委员会", "党政联席会"),
        provenance="keyword:学院单位",
    ),
    RegulationSemanticKeywordRule(
        value="office",
        markers=("学校", "部门"),
        provenance="keyword:学校部门职责",
    ),
    RegulationSemanticKeywordRule(
        value="office",
        markers=(
            "调解委员会",
            "负责",
            "受理",
            "审核",
            "审批",
            "公示",
            "办理",
            "协调",
            "答复",
            "查处",
            "制订",
            "制定",
            "组织",
            "管理",
            "监督",
            "汇总",
            "备案",
        ),
        provenance="keyword:学校部门职责",
    ),
)

REGULATION_PROCEDURE_NEXT_ACTOR_RULES: tuple[RegulationSemanticKeywordRule, ...] = (
    RegulationSemanticKeywordRule(
        value="academic_affairs_office",
        markers=("教务处",),
        provenance="keyword:教务处",
    ),
    RegulationSemanticKeywordRule(
        value="student_affairs_office",
        markers=("学生处",),
        provenance="keyword:学生处",
    ),
    RegulationSemanticKeywordRule(
        value="college",
        markers=("学院", "院系"),
        provenance="keyword:学院",
    ),
)

REGULATION_SECTION_SUBJECT_RULES: tuple[RegulationSemanticKeywordRule, ...] = (
    RegulationSemanticKeywordRule(
        value="material_requirement",
        markers=("申请材料", "证明材料", "材料"),
        provenance="section_path:materials",
    ),
    RegulationSemanticKeywordRule(
        value="deadline",
        markers=("截止", "期限", "公示", "时间"),
        provenance="section_path:deadline",
    ),
)

REGULATION_SECTION_PROCEDURE_ACTION_MARKERS: tuple[str, ...] = (
    "申请",
    "申报",
    "提交",
    "报送",
    "审核",
    "审批",
    "受理",
    "办理",
    "公示",
    "发放",
    "拨付",
    "复评",
    "复审",
    "签署意见",
)

REGULATION_PROCEDURE_ACTOR_ACTION_MARKERS: tuple[str, ...] = (
    "提交",
    "申请",
    "申报",
    "报送",
    "提供",
    "上交",
    "挂失",
    "补办",
    "补发",
    "审核",
    "审批",
    "审查",
    "审定",
    "核准",
    "签署意见",
    "受理",
    "办理",
    "协调",
    "答复",
    "处理",
    "公示",
    "组织",
    "管理",
    "监督",
    "汇总",
    "备案",
    "负责",
    "指导",
    "开展",
    "提名",
)

REGULATION_PROCEDURE_ACTION_RULES: tuple[RegulationSemanticKeywordRule, ...] = (
    RegulationSemanticKeywordRule(
        value="report_loss",
        markers=("挂失",),
        provenance="keyword:挂失",
    ),
    RegulationSemanticKeywordRule(
        value="reissue",
        markers=("补办", "补发", "补卡", "补证"),
        provenance="keyword:补办补发",
    ),
    RegulationSemanticKeywordRule(
        value="appeal",
        markers=("申诉", "听证"),
        provenance="keyword:申诉听证",
    ),
    RegulationSemanticKeywordRule(
        value="submit_materials",
        markers=("报送", "备案"),
        provenance="keyword:报送备案",
    ),
    RegulationSemanticKeywordRule(
        value="apply",
        markers=("定密申请", "提出申请", "提出学位论文定密申请"),
        provenance="keyword:定密申请",
    ),
    RegulationSemanticKeywordRule(
        value="submit_materials",
        markers=("提供", "提交", "上交"),
        provenance="keyword:提交+材料",
    ),
    RegulationSemanticKeywordRule(
        value="process",
        markers=("负责指导", "指导学生", "指导开展", "开展项目研究", "组织开展"),
        provenance="keyword:指导职责流程",
    ),
    RegulationSemanticKeywordRule(
        value="process",
        markers=("受理", "办理", "协调", "答复", "处理"),
        provenance="keyword:受理办理协调答复",
    ),
    RegulationSemanticKeywordRule(
        value="review",
        markers=("审定", "核准", "签署意见"),
        provenance="keyword:审定核准签署意见",
    ),
    RegulationSemanticKeywordRule(
        value="review",
        markers=("审核", "审批", "复审", "审查"),
        provenance="keyword:审核审批",
    ),
    RegulationSemanticKeywordRule(
        value="publish_notice",
        markers=("公示",),
        provenance="keyword:公示",
    ),
    RegulationSemanticKeywordRule(
        value="process",
        markers=("发放", "拨付"),
        provenance="keyword:发放拨付",
    ),
    RegulationSemanticKeywordRule(
        value="apply",
        markers=("申请",),
        provenance="keyword:申请",
    ),
)

REGULATION_PROCEDURE_ACTION_MATERIAL_MARKERS: tuple[str, ...] = (
    "材料",
    "成绩单",
    "大纲",
    "简介",
    "复印件",
    "原件",
    "申请表",
    "证明",
    "表",
)

REGULATION_PROCEDURE_PROCESS_DECISION_EXCLUSIONS: tuple[str, ...] = (
    "处理决定",
    "处理意见",
    "处理结果",
)

REGULATION_PROCEDURE_PROCESS_CONTEXT_MARKERS: tuple[str, ...] = (
    "统一",
    "受理",
    "协调",
    "答复",
    "办理",
)

REGULATION_NON_PROCEDURE_RESULT_USAGE_MARKERS: tuple[str, ...] = (
    "作为",
    "方可参评",
    "依据",
)

REGULATION_NON_PROCEDURE_QUOTA_MARKERS: tuple[str, ...] = (
    "名额",
    "金额",
    "额度",
    "比例",
    "人数",
    "支左右",
)

REGULATION_PROCEDURE_STEP_REQUIRED_ACTION_MARKERS: tuple[str, ...] = (
    "提交",
    "申请",
    "提出申请",
    "报送",
    "备案",
    "审核",
    "审批",
    "审查",
    "审定",
    "核准",
    "签署意见",
    "受理",
    "办理",
    "协调",
    "答复",
    "公示",
    "挂失",
    "补办",
    "补发",
    "申诉",
    "听证",
    "发放",
    "拨付",
)

REGULATION_CONDITION_SUBJECT_KEYWORD_RULES: tuple[RegulationSemanticKeywordRule, ...] = (
    RegulationSemanticKeywordRule(
        value="security_or_confidentiality_requirement",
        markers=(
            "安全等级要求",
            "涉密",
            "定密",
            "保密",
            "保密期限",
            "知悉范围",
            "核准后接入校园网",
            "接入校园网",
            "审定密级",
        ),
        provenance="keyword:安全保密要求",
    ),
    RegulationSemanticKeywordRule(
        value="amount_or_quota",
        markers=("金额", "名额", "额度", "比例", "人数", "标准", "拨付", "资助明细表"),
        provenance="keyword:额度上限",
    ),
    RegulationSemanticKeywordRule(
        value="rank_threshold",
        markers=("排名", "前10%", "前30%", "综合测评"),
        provenance="keyword:排名综测",
    ),
    RegulationSemanticKeywordRule(
        value="sports_competition",
        markers=("体育比赛", "体育竞赛"),
        provenance="keyword:体育比赛",
    ),
    RegulationSemanticKeywordRule(
        value="arts_competition",
        markers=("文艺比赛",),
        provenance="keyword:文艺比赛",
    ),
    RegulationSemanticKeywordRule(
        value="paper_or_publication",
        markers=("论文", "发表", "学术研究", "专利", "竞赛"),
        provenance="keyword:论文科研",
    ),
    RegulationSemanticKeywordRule(
        value="moral_or_social_contribution",
        markers=("精神文明", "见义勇为", "助人为乐", "奉献爱心", "服务社会", "自立自强"),
        provenance="keyword:德育社会贡献",
    ),
    RegulationSemanticKeywordRule(
        value="material_requirement",
        markers=("证明材料", "申请材料", "提交材料", "材料"),
        provenance="keyword:材料",
    ),
    RegulationSemanticKeywordRule(
        value="deadline",
        markers=("截止", "期限", "公示", "不少于", "每周", "时间"),
        provenance="keyword:时间期限",
    ),
    RegulationSemanticKeywordRule(
        value="audience_scope",
        markers=("本科", "预科", "学生", "年级", "专业"),
        provenance="keyword:对象范围",
    ),
)

REGULATION_EXCLUSION_SUBJECT_RULES: tuple[RegulationSemanticKeywordRule, ...] = (
    RegulationSemanticKeywordRule(
        value="amount_or_quota",
        markers=("不得超过", "不设上限", "上限"),
        provenance="keyword:额度上限",
    ),
    RegulationSemanticKeywordRule(
        value="disqualification_or_nonacceptance",
        markers=("不予受理", "不受理", "不予公开", "不予加分", "取消", "无资格"),
        provenance="keyword:不予受理取消资格",
    ),
    RegulationSemanticKeywordRule(
        value="activity_scope_restriction",
        markers=("不得以", "无关", "不得变更", "不得修改", "禁止"),
        provenance="keyword:范围限制",
    ),
    RegulationSemanticKeywordRule(
        value="safety_or_security_restriction",
        markers=("国家安全", "公共安全", "经济安全", "社会稳定", "学校安全"),
        provenance="keyword:安全稳定限制",
    ),
)

REGULATION_ACTION_TYPE_TEXT_RULES: tuple[RegulationSemanticKeywordRule, ...] = (
    RegulationSemanticKeywordRule(
        value="lift_discipline",
        markers=("解除处分", "处分解除"),
        provenance="text:lift_discipline",
    ),
    RegulationSemanticKeywordRule(
        value="reissue",
        markers=("补办", "补发", "挂失", "遗失", "丢失", "丢了", "损坏", "补卡", "补证"),
        provenance="text:reissue",
    ),
)

REGULATION_ACTION_TYPE_CONTEXT_RULES: tuple[RegulationSemanticKeywordRule, ...] = (
    RegulationSemanticKeywordRule(
        value="lift_discipline",
        markers=("解除处分", "处分解除"),
        provenance="context_text:lift_discipline",
    ),
    RegulationSemanticKeywordRule(
        value="reissue",
        markers=("补办", "补发", "挂失", "遗失", "丢失", "丢了", "损坏", "补卡", "补证"),
        provenance="context_text:reissue",
    ),
)

REGULATION_ACTION_TYPE_SECTION_RULES: tuple[RegulationSemanticKeywordRule, ...] = (
    RegulationSemanticKeywordRule(
        value="lift_discipline",
        markers=("解除处分", "处分解除"),
        provenance="section_path:lift_discipline",
    ),
    RegulationSemanticKeywordRule(
        value="reissue",
        markers=("补办", "补发", "挂失", "遗失", "丢失", "丢了", "损坏", "补卡", "补证"),
        provenance="section_path:reissue",
    ),
)

REGULATION_INTRO_TARGET_ROLE_SUBJECT_RULES: tuple[tuple[str, str, str], ...] = (
    ("procedure_step", "application_procedure", "intro_target_roles:procedure_step"),
    ("material_requirement", "material_requirement", "intro_target_roles:material_requirement"),
    ("time_constraint", "deadline", "intro_target_roles:time_constraint"),
    ("exclusion_rule", "generic_restriction", "intro_target_roles:exclusion_rule"),
    ("example_evidence", "example_evidence", "intro_target_roles:example_evidence"),
)

REGULATION_INTRO_SCOPE_TARGET_ROLE_RULES: tuple[tuple[frozenset[str], str, str], ...] = (
    (
        frozenset({"material_requirement"}),
        "material_list",
        "intro_target_roles:material_requirement",
    ),
    (
        frozenset({"time_constraint"}),
        "time_list",
        "intro_target_roles:time_constraint",
    ),
    (
        frozenset({"procedure_step"}),
        "procedure_list",
        "intro_target_roles:procedure_step",
    ),
)

REGULATION_GENERIC_POLICY_TABLE_SUBJECT_RULES: tuple[RegulationSemanticKeywordRule, ...] = (
    RegulationSemanticKeywordRule(
        value="rank_threshold",
        markers=("绩点", "成绩", "综测", "排名", "百分制"),
        provenance="table_fact_type:generic_policy_table+keyword:绩点成绩",
    ),
    RegulationSemanticKeywordRule(
        value="academic_performance",
        markers=("学分", "毕业要求", "培养方案"),
        provenance="table_fact_type:generic_policy_table+keyword:学分培养要求",
    ),
)

REGULATION_PROCEDURE_MATERIAL_MARKERS: tuple[str, ...] = (
    "申请材料",
    "证明材料",
    "书面申请",
    "补办申请表",
    "解除处分申请表",
)

REGULATION_ANSWER_ROLE_EXCLUSION_MARKERS: tuple[str, ...] = (
    "不得",
    "不能",
    "不予",
    "不合格",
    "未通过",
    "取消",
    "无资格",
    "禁止",
    "不受理",
    "不宜",
    "不适合",
)

REGULATION_ANSWER_ROLE_EXCEPTION_MARKERS: tuple[str, ...] = (
    "除外",
    "超出",
    "例外",
    "特殊情况",
    "特殊条件",
    "破格",
)

REGULATION_ANSWER_ROLE_ELIGIBILITY_MARKERS: tuple[str, ...] = (
    "条件",
    "资格",
    "对象",
    "参评",
    "申请",
    "应当",
    "须",
    "需",
)

REGULATION_ANSWER_ROLE_EXAMPLE_LIST_MARKERS: tuple[str, ...] = (
    "具体表现如下",
    "具体包括",
    "包括以下",
)

REGULATION_ANSWER_ROLE_TERMINAL_PROVISION_MARKERS: tuple[str, ...] = (
    "负责解释",
    "负责施行",
    "自发布之日起实施",
    "自发布之日起施行",
    "自印发之日起实施",
    "自印发之日起施行",
    "自公布之日起实施",
    "自公布之日起施行",
    "同时废止",
)


def regulation_repo_root() -> Path:
    return Path(__file__).resolve().parents[4]


def student_rules_query_planning_path() -> Path:
    return (
        regulation_repo_root()
        / "configs"
        / "ingestion"
        / "regulations"
        / "student_rules"
        / "query-planning.json"
    )


def public_regulation_consumption_manifest_path() -> Path:
    return (
        regulation_repo_root()
        / "configs"
        / "ingestion"
        / "regulations"
        / "public-regulation-consumption.v1.json"
    )


def load_student_rules_discovery_config() -> RegulationDiscoveryConfig:
    payload = _load_student_rules_query_planning_config()
    return _build_student_rules_discovery_config(payload)


def load_regulation_discovery_config(collection: str) -> RegulationDiscoveryConfig:
    normalized = collection.strip()
    if normalized == "student_rules":
        return load_student_rules_discovery_config()
    if normalized == "institutional_rules":
        return load_institutional_rules_discovery_config()
    return RegulationDiscoveryConfig(
        clarification_cues=(),
        policy_objects=(),
        policy_titles_by_document_id={},
        categories=(),
    )


def load_institutional_rules_discovery_config() -> RegulationDiscoveryConfig:
    payload = _load_public_regulation_consumption_manifest()
    policy = payload.get("institutional_rules_policy", {})
    documents = tuple(
        item
        for item in payload.get("documents", ())
        if isinstance(item, Mapping)
        and str(item.get("canonical_scope") or "").strip() == "regulations/institutional_rules"
    )
    policy_objects: list[RegulationPolicyObjectDefinition] = []
    policy_titles: dict[str, str] = {}
    docs_by_group: dict[str, list[Mapping[str, object]]] = {}
    for document in documents:
        document_id = str(document.get("document_id") or "").strip()
        title = str(document.get("title") or "").strip()
        if not document_id or not title:
            continue
        aliases = tuple(
            str(alias).strip() for alias in document.get("title_aliases", ()) if str(alias).strip()
        )
        policy_objects.append(
            RegulationPolicyObjectDefinition(
                document_id=document_id,
                title=title,
                aliases=aliases,
            )
        )
        policy_titles[document_id] = title
        docs_nav_group = str(document.get("docs_nav_group") or "").strip()
        if docs_nav_group:
            docs_by_group.setdefault(docs_nav_group, []).append(document)

    nav_groups = {
        str(group.get("group_id") or "").strip(): group
        for group in payload.get("nav_groups", ())
        if isinstance(group, Mapping) and str(group.get("group_id") or "").strip()
    }
    clarification_cues = tuple(
        str(cue).strip() for cue in policy.get("scope_signal_terms", ()) if str(cue).strip()
    )
    categories: list[RegulationCategoryDefinition] = []
    for group_id, documents_in_group in docs_by_group.items():
        nav_group = nav_groups.get(group_id)
        display_name = str((nav_group or {}).get("display_name") or "").strip()
        if not display_name:
            continue
        member_policy_document_ids = tuple(
            str(document.get("document_id") or "").strip()
            for document in documents_in_group
            if str(document.get("document_id") or "").strip()
        )
        if not member_policy_document_ids:
            continue
        first_member = documents_in_group[0]
        aliases = (display_name,)
        if group_id == "public_service":
            aliases = (
                display_name,
                "校园服务",
                "校园服务制度",
                "学校服务制度",
                "学校层面的学生管理制度",
            )
        elif group_id == "staff_governance":
            aliases = (
                display_name,
                "教职工与校级治理",
                "校级治理制度",
                "教职工治理制度",
            )
        categories.append(
            RegulationCategoryDefinition(
                category_id=group_id,
                display_name=display_name,
                aliases=aliases,
                audience=("校园成员" if group_id == "public_service" else "教职工与治理参与主体"),
                member_policy_document_ids=member_policy_document_ids,
                overview_document_id=str(first_member.get("document_id") or "").strip(),
            )
        )
    return RegulationDiscoveryConfig(
        clarification_cues=clarification_cues,
        policy_objects=tuple(policy_objects),
        policy_titles_by_document_id=policy_titles,
        categories=tuple(categories),
    )


def _build_student_rules_discovery_config(
    payload: Mapping[str, object],
) -> RegulationDiscoveryConfig:
    clarification_cues = tuple(
        str(cue).strip() for cue in payload.get("clarification_cues", ()) if str(cue).strip()
    )
    policy_objects: list[RegulationPolicyObjectDefinition] = []
    policy_titles: dict[str, str] = {}
    for policy_object in payload.get("policy_objects", ()):
        if not isinstance(policy_object, Mapping):
            continue
        document_id = str(policy_object.get("document_id") or "").strip()
        title = str(policy_object.get("title") or "").strip()
        if not document_id or not title:
            continue
        aliases = tuple(
            str(alias).strip() for alias in policy_object.get("aliases", ()) if str(alias).strip()
        )
        policy_objects.append(
            RegulationPolicyObjectDefinition(
                document_id=document_id,
                title=title,
                aliases=aliases,
            )
        )
        policy_titles[document_id] = title
    categories: list[RegulationCategoryDefinition] = []
    for item in payload.get("policy_categories", ()):
        if not isinstance(item, Mapping):
            continue
        category_id = str(item.get("category_id") or "").strip()
        if not category_id:
            continue
        member_policy_document_ids = tuple(
            str(document_id).strip()
            for document_id in item.get("member_policy_document_ids", ())
            if str(document_id).strip()
        )
        if not member_policy_document_ids:
            continue
        categories.append(
            RegulationCategoryDefinition(
                category_id=category_id,
                display_name=str(item.get("display_name") or "").strip(),
                aliases=tuple(
                    str(alias).strip() for alias in item.get("aliases", ()) if str(alias).strip()
                ),
                audience=str(item.get("audience") or "").strip(),
                member_policy_document_ids=member_policy_document_ids,
                overview_document_id=str(
                    item.get("overview_document_id") or member_policy_document_ids[0]
                ).strip(),
                default_procedure_document_id=str(
                    item.get("default_procedure_document_id") or ""
                ).strip(),
                procedure_overrides=tuple(
                    (
                        str(override.get("match_term") or "").strip(),
                        str(override.get("document_id") or "").strip(),
                    )
                    for override in item.get("procedure_overrides", ())
                    if isinstance(override, Mapping)
                    and str(override.get("match_term") or "").strip()
                    and str(override.get("document_id") or "").strip()
                ),
            )
        )
    return RegulationDiscoveryConfig(
        clarification_cues=clarification_cues,
        policy_objects=tuple(policy_objects),
        policy_titles_by_document_id=policy_titles,
        categories=tuple(categories),
    )


def regulation_categories_for_document(
    *,
    collection: str,
    document_id: str,
) -> tuple[RegulationCategoryDefinition, ...]:
    discovery = load_regulation_discovery_config(collection)
    return tuple(
        category
        for category in discovery.categories
        if document_id in category.member_policy_document_ids
    )


def canonical_regulation_condition_subject(value: str) -> str:
    normalized = value.strip()
    if not normalized:
        return ""
    return REGULATION_CONDITION_SUBJECT_ALIASES.get(normalized, normalized)


def canonical_regulation_procedure_action(value: str) -> str:
    normalized = value.strip()
    if not normalized:
        return ""
    return REGULATION_PROCEDURE_ACTION_ALIASES.get(normalized, normalized)


def canonical_regulation_procedure_actor(value: str) -> str:
    normalized = value.strip()
    if not normalized:
        return ""
    return REGULATION_PROCEDURE_ACTOR_ALIASES.get(normalized, normalized)


def resolve_regulation_procedure_actor(
    *,
    text: str,
    explicit_actor: str = "",
) -> RegulationSemanticAssignment:
    explicit = canonical_regulation_procedure_actor(explicit_actor.strip())
    if explicit:
        return RegulationSemanticAssignment(
            value=explicit,
            provenance="metadata:procedure_actor",
        )

    if resolve_regulation_group_intro_kind(text).value in {
        "condition_group_intro",
        "exclusion_group_intro",
    }:
        return RegulationSemanticAssignment(value="", provenance="")

    compact = _compact(text)
    if "学生信息" in compact and "学生本人" not in compact:
        compact = compact.replace("学生信息", "")
    if any(marker in compact for marker in ("核准后接入校园网", "接入校园网", "审定密级")):
        return RegulationSemanticAssignment(
            value="office",
            provenance="keyword:核准接入校园网职责",
        )
    actor_assignment = _resolve_procedure_actor_by_action_context(
        compact,
        REGULATION_PROCEDURE_ACTOR_RULES,
    )
    if actor_assignment.value:
        return actor_assignment
    actor_assignment = _resolve_keyword_rule(compact, REGULATION_PROCEDURE_ACTOR_RULES)
    if actor_assignment.value:
        return actor_assignment
    return RegulationSemanticAssignment(value="", provenance="")


def resolve_regulation_procedure_next_actor(
    *,
    text: str,
    explicit_actor: str = "",
) -> RegulationSemanticAssignment:
    explicit = canonical_regulation_procedure_actor(explicit_actor.strip())
    if explicit:
        return RegulationSemanticAssignment(
            value=explicit,
            provenance="metadata:procedure_next_actor",
        )

    return _resolve_keyword_rule(_compact(text), REGULATION_PROCEDURE_NEXT_ACTOR_RULES)


def resolve_regulation_section_subject_hint(
    *,
    section_path: Sequence[str] = (),
    answer_role: str = "",
    text: str = "",
) -> RegulationSemanticAssignment:
    normalized_section_path = tuple(item.strip() for item in section_path if item.strip())
    compact_section_path = _compact(" ".join(normalized_section_path))
    section_leaf = _compact(normalized_section_path[-1]) if normalized_section_path else ""
    compact = _compact(text)

    section_assignment = _resolve_keyword_rule(
        compact_section_path, REGULATION_SECTION_SUBJECT_RULES
    )
    if section_assignment.value:
        return section_assignment
    if any(marker in compact_section_path for marker in ("程序", "流程", "步骤", "办理")) and (
        answer_role == "procedure_step"
        or any(marker in compact for marker in REGULATION_SECTION_PROCEDURE_ACTION_MARKERS)
    ):
        return RegulationSemanticAssignment(
            value="application_procedure",
            provenance="section_path:procedure",
        )
    if (
        any(marker in section_leaf for marker in ("对象", "范围", "适用", "本科生", "学生"))
        and (answer_role in {"eligibility_condition", "eligibility_intro", "category_overview"})
        and not any(
            marker in compact
            for marker in (
                "专业",
                "一级学科",
                "学科领域",
                "名额",
                "金额",
                "比例",
                "标准",
            )
        )
    ):
        return RegulationSemanticAssignment(
            value="audience_scope",
            provenance="section_path_leaf:audience_scope",
        )
    return RegulationSemanticAssignment(value="", provenance="")


def resolve_regulation_action_type(
    *,
    text: str,
    context_text: str = "",
    section_path: Sequence[str] = (),
    document_title: str = "",
    explicit_action_type: str = "",
) -> RegulationSemanticAssignment:
    explicit = explicit_action_type.strip()
    if explicit:
        return RegulationSemanticAssignment(
            value=explicit,
            provenance="metadata:action_type",
        )

    compact = _compact(text)
    compact_context = _compact(context_text)
    normalized_section_path = tuple(item.strip() for item in section_path if item.strip())
    compact_section_path = _compact(" ".join(normalized_section_path))
    compact_title = _compact(document_title)

    text_assignment = _resolve_keyword_rule(compact, REGULATION_ACTION_TYPE_TEXT_RULES)
    if text_assignment.value:
        return text_assignment
    context_assignment = _resolve_keyword_rule(
        compact_context, REGULATION_ACTION_TYPE_CONTEXT_RULES
    )
    if context_assignment.value:
        return context_assignment
    section_assignment = _resolve_keyword_rule(
        compact_section_path, REGULATION_ACTION_TYPE_SECTION_RULES
    )
    if section_assignment.value:
        return section_assignment
    if "解除程序" in compact_section_path and "处分" in compact_title:
        return RegulationSemanticAssignment(
            value="lift_discipline",
            provenance="section_path+document_title:lift_discipline",
        )
    if any(marker in compact_title for marker in ("解除处分", "处分解除")) and any(
        marker in (compact_section_path or compact)
        for marker in ("解除", "程序", "情形", "考察期", "申请", "限制")
    ):
        return RegulationSemanticAssignment(
            value="lift_discipline",
            provenance="document_title:lift_discipline",
        )
    if any(
        marker in compact_title
        for marker in ("补办", "补发", "挂失", "遗失", "丢失", "丢了", "损坏", "补卡", "补证")
    ) and any(
        marker in (compact_section_path or compact)
        for marker in ("补办", "补发", "挂失", "遗失", "补卡", "补证", "程序")
    ):
        return RegulationSemanticAssignment(value="reissue", provenance="document_title:reissue")
    return RegulationSemanticAssignment(value="", provenance="")


def resolve_regulation_condition_subject(
    *,
    text: str,
    answer_role: str = "",
    explicit_condition_subject: str = "",
    condition_group_subject: str = "",
    introduced_condition_subject: str = "",
    intro_target_roles: Sequence[str] = (),
    table_fact_type: str = "",
    action_type: str = "",
    section_path: Sequence[str] = (),
    context_text: str = "",
    document_title: str = "",
) -> RegulationSemanticAssignment:
    explicit = canonical_regulation_condition_subject(explicit_condition_subject.strip())
    if explicit:
        return RegulationSemanticAssignment(
            value=explicit,
            provenance="metadata:condition_subject",
        )
    explicit_intro_subject = canonical_regulation_condition_subject(
        introduced_condition_subject.strip()
    )
    if explicit_intro_subject:
        return RegulationSemanticAssignment(
            value=explicit_intro_subject,
            provenance="metadata:introduced_condition_subject",
        )
    explicit_group_subject = canonical_regulation_condition_subject(condition_group_subject.strip())

    target_roles = {item.strip() for item in intro_target_roles if item.strip()}
    compact = _compact(text)
    resolved_action_type = (
        action_type.strip()
        or resolve_regulation_action_type(
            text=text,
            context_text=context_text,
            section_path=section_path,
            document_title=document_title,
        ).value
    )

    if answer_role == "procedure_step":
        return RegulationSemanticAssignment(
            value="application_procedure",
            provenance="answer_role:procedure_step",
        )
    if answer_role == "material_requirement":
        return RegulationSemanticAssignment(
            value="material_requirement",
            provenance="answer_role:material_requirement",
        )
    if answer_role == "time_constraint":
        return RegulationSemanticAssignment(
            value="deadline",
            provenance="answer_role:time_constraint",
        )
    if answer_role == "eligibility_intro":
        intro_target_assignment = _resolve_intro_target_role_subject(target_roles)
        if intro_target_assignment.value:
            return intro_target_assignment
        if "exclusion_rule" in target_roles:
            return RegulationSemanticAssignment(
                value="generic_restriction",
                provenance="intro_target_roles:exclusion_group",
            )
        if any(role in target_roles for role in ("eligibility_condition", "exception_rule")):
            return RegulationSemanticAssignment(
                value="generic_condition",
                provenance="intro_target_roles:eligibility_group",
            )
        return RegulationSemanticAssignment(
            value="generic_condition",
            provenance="answer_role:eligibility_intro",
        )
    if answer_role == "category_overview":
        return RegulationSemanticAssignment(
            value="audience_scope",
            provenance="answer_role:category_overview",
        )
    if table_fact_type == "amount_or_quota":
        return RegulationSemanticAssignment(
            value="amount_or_quota",
            provenance="table_fact_type:amount_or_quota",
        )
    if table_fact_type == "required_materials":
        return RegulationSemanticAssignment(
            value="material_requirement",
            provenance="table_fact_type:required_materials",
        )
    if table_fact_type == "timeline_or_deadline":
        return RegulationSemanticAssignment(
            value="deadline",
            provenance="table_fact_type:timeline_or_deadline",
        )
    if table_fact_type == "generic_policy_table":
        table_assignment = _resolve_keyword_rule(
            compact, REGULATION_GENERIC_POLICY_TABLE_SUBJECT_RULES
        )
        if table_assignment.value:
            return table_assignment
        return RegulationSemanticAssignment(
            value="generic_condition",
            provenance="table_fact_type:generic_policy_table",
        )
    if resolved_action_type == "lift_discipline" and answer_role == "exclusion_rule":
        return RegulationSemanticAssignment(
            value="discipline_relief_exclusion",
            provenance="action_type:lift_discipline+answer_role:exclusion_rule",
        )
    if resolved_action_type == "lift_discipline" and answer_role in {
        "eligibility_condition",
        "exception_rule",
    }:
        return RegulationSemanticAssignment(
            value="discipline_relief_condition",
            provenance="action_type:lift_discipline+answer_role:positive_condition",
        )
    if answer_role == "exclusion_rule":
        exclusion_assignment = _resolve_keyword_rule(compact, REGULATION_EXCLUSION_SUBJECT_RULES)
        if exclusion_assignment.value:
            return exclusion_assignment
        return RegulationSemanticAssignment(
            value=(
                explicit_group_subject
                if explicit_group_subject and answer_role != "example_evidence"
                else "generic_restriction"
            ),
            provenance=(
                "metadata:condition_group_subject"
                if explicit_group_subject and answer_role != "example_evidence"
                else "answer_role:exclusion_rule"
            ),
        )
    if any(
        marker in compact
        for marker in ("国家安全", "公共安全", "经济安全", "社会稳定", "学校安全", "国家秘密")
    ) and any(
        marker in compact
        for marker in (
            "安全等级要求",
            "涉密",
            "定密",
            "保密",
            "保密期限",
            "知悉范围",
            "核准后接入校园网",
            "接入校园网",
            "审定密级",
        )
    ):
        return RegulationSemanticAssignment(
            value="security_or_confidentiality_requirement",
            provenance="keyword:安全保密要求",
        )
    section_subject_assignment = resolve_regulation_section_subject_hint(
        section_path=section_path,
        answer_role=answer_role,
        text=text,
    )
    if section_subject_assignment.value:
        return section_subject_assignment
    keyword_assignment = _resolve_condition_subject_keyword_rule(
        compact,
        answer_role=answer_role,
    )
    if keyword_assignment.value:
        return keyword_assignment
    if answer_role == "example_evidence":
        return RegulationSemanticAssignment(
            value="example_evidence",
            provenance="answer_role:example_evidence",
        )
    if answer_role in {"eligibility_condition", "exception_rule"}:
        return RegulationSemanticAssignment(
            value=(
                explicit_group_subject
                if explicit_group_subject and answer_role != "example_evidence"
                else "generic_condition"
            ),
            provenance=(
                "metadata:condition_group_subject"
                if explicit_group_subject and answer_role != "example_evidence"
                else "answer_role:generic_condition"
            ),
        )
    if explicit_group_subject and answer_role != "example_evidence":
        return RegulationSemanticAssignment(
            value=explicit_group_subject,
            provenance="metadata:condition_group_subject",
        )
    return RegulationSemanticAssignment(value="", provenance="")


def resolve_regulation_group_subject(
    *,
    text: str,
    answer_role: str = "",
    action_type: str = "",
    section_path: Sequence[str] = (),
    context_text: str = "",
    document_title: str = "",
) -> RegulationSemanticAssignment:
    return resolve_regulation_condition_group_subject(
        text=text,
        answer_role=answer_role,
        explicit_condition_group_subject="",
        fallback_condition_subject="",
        intro_target_roles=(),
        table_fact_type="",
        action_type=action_type,
        section_path=section_path,
        context_text=context_text,
        document_title=document_title,
    )


def resolve_regulation_condition_group_subject(
    *,
    text: str,
    answer_role: str = "",
    explicit_condition_group_subject: str = "",
    fallback_condition_subject: str = "",
    intro_target_roles: Sequence[str] = (),
    table_fact_type: str = "",
    action_type: str = "",
    section_path: Sequence[str] = (),
    context_text: str = "",
    document_title: str = "",
) -> RegulationSemanticAssignment:
    explicit_group_subject = canonical_regulation_condition_subject(
        explicit_condition_group_subject.strip()
    )
    if explicit_group_subject:
        return RegulationSemanticAssignment(
            value=explicit_group_subject,
            provenance="metadata:condition_group_subject",
        )
    if answer_role and answer_role not in REGULATION_GROUPED_ANSWER_ROLES | {
        "material_requirement"
    }:
        return RegulationSemanticAssignment(value="", provenance="")
    if answer_role == "eligibility_intro":
        return resolve_regulation_intro_subject(
            intro_target_roles=intro_target_roles,
            fallback_condition_subject=fallback_condition_subject,
        )
    return resolve_regulation_condition_subject(
        text=text,
        answer_role=answer_role,
        explicit_condition_subject=fallback_condition_subject,
        condition_group_subject="",
        introduced_condition_subject="",
        intro_target_roles=intro_target_roles,
        table_fact_type=table_fact_type,
        action_type=action_type,
        section_path=section_path,
        context_text=context_text,
        document_title=document_title,
    )


def build_regulation_condition_group_id(
    *,
    parent_unit_id: str,
    group_subject: str = "",
    group_key: str = "",
) -> RegulationSemanticAssignment:
    normalized_parent_unit_id = parent_unit_id.strip()
    if not normalized_parent_unit_id:
        return RegulationSemanticAssignment(value="", provenance="")
    normalized_group_key = group_key.strip()
    if normalized_group_key:
        return RegulationSemanticAssignment(
            value=f"{normalized_parent_unit_id}:{normalized_group_key}",
            provenance="parent_unit_id+condition_group_key",
        )
    normalized_group_subject = canonical_regulation_condition_subject(group_subject.strip())
    if not normalized_group_subject:
        return RegulationSemanticAssignment(value="", provenance="")
    return RegulationSemanticAssignment(
        value=f"{normalized_parent_unit_id}:{normalized_group_subject}",
        provenance="parent_unit_id+condition_group_subject",
    )


def condition_group_subject_from_group_id(group_id: str) -> str:
    normalized_group_id = group_id.strip()
    if not normalized_group_id or ":" not in normalized_group_id:
        return ""
    candidate = normalized_group_id.rsplit(":", 1)[-1].strip()
    return canonical_regulation_condition_subject(candidate)


def resolve_regulation_procedure_action(
    *,
    text: str,
    actor: str = "",
    explicit_action: str = "",
) -> RegulationSemanticAssignment:
    explicit = canonical_regulation_procedure_action(explicit_action.strip())
    if explicit:
        return RegulationSemanticAssignment(
            value=explicit,
            provenance="metadata:procedure_action",
        )

    if resolve_regulation_group_intro_kind(text).value in {
        "condition_group_intro",
        "exclusion_group_intro",
    }:
        return RegulationSemanticAssignment(value="", provenance="")

    compact = _compact(text)
    review_signoff_assignment = _resolve_keyword_rule(
        compact,
        (
            RegulationSemanticKeywordRule(
                value="review",
                markers=("审定", "核准", "签署意见"),
                provenance="keyword:审定核准签署意见",
            ),
        ),
    )
    if review_signoff_assignment.value:
        if any(marker in compact for marker in ("核准后接入校园网", "接入校园网")):
            return RegulationSemanticAssignment(
                value="office_review",
                provenance="keyword:核准接入校园网+actor:office",
            )
        if actor == "college":
            return RegulationSemanticAssignment(
                value="college_review",
                provenance="keyword:审定核准签署意见+actor:college",
            )
        if actor in {"academic_affairs_office", "student_affairs_office", "office"}:
            return RegulationSemanticAssignment(
                value="office_review",
                provenance=f"keyword:审定核准签署意见+actor:{actor}",
            )
        return review_signoff_assignment

    review_assignment = _resolve_keyword_rule(
        compact,
        (
            RegulationSemanticKeywordRule(
                value="review",
                markers=("审核", "审批", "复审", "审查"),
                provenance="keyword:审核审批",
            ),
        ),
    )
    if review_assignment.value:
        if any(marker in compact for marker in ("不合格", "未通过")):
            return RegulationSemanticAssignment(value="", provenance="")
        if actor == "college":
            return RegulationSemanticAssignment(
                value="college_review",
                provenance="keyword:审核+actor:college",
            )
        if actor in {"academic_affairs_office", "student_affairs_office", "office"}:
            return RegulationSemanticAssignment(
                value="office_review",
                provenance=f"keyword:审核+actor:{actor}",
            )
        return review_assignment

    process_assignment = _resolve_keyword_rule(
        compact,
        (
            RegulationSemanticKeywordRule(
                value="process",
                markers=("负责指导", "指导学生", "指导开展", "开展项目研究", "组织开展"),
                provenance="keyword:指导职责流程",
            ),
            RegulationSemanticKeywordRule(
                value="process",
                markers=("受理", "办理", "协调", "答复"),
                provenance="keyword:受理办理协调答复",
            ),
        ),
    )
    if process_assignment.value:
        if "处理" in compact:
            return RegulationSemanticAssignment(value="process", provenance="keyword:处理")
        return process_assignment

    if (
        "处理" in compact
        and not any(
            marker in compact for marker in REGULATION_PROCEDURE_PROCESS_DECISION_EXCLUSIONS
        )
        and any(marker in compact for marker in REGULATION_PROCEDURE_PROCESS_CONTEXT_MARKERS)
    ):
        return RegulationSemanticAssignment(value="process", provenance="keyword:处理")

    if any(marker in compact for marker in ("提供", "提交", "上交")) and any(
        marker in compact for marker in REGULATION_PROCEDURE_ACTION_MATERIAL_MARKERS
    ):
        return RegulationSemanticAssignment(
            value="submit_materials",
            provenance="keyword:提交+材料",
        )
    if "提交" in compact and "申请" in compact:
        return RegulationSemanticAssignment(value="apply", provenance="keyword:提交+申请")

    action_assignment = _resolve_keyword_rule(compact, REGULATION_PROCEDURE_ACTION_RULES)
    if action_assignment.value:
        return action_assignment
    return RegulationSemanticAssignment(value="", provenance="")


def resolve_regulation_procedure_materials(text: str) -> tuple[str, ...]:
    compact = _compact(text)
    if not compact:
        return ()
    materials: list[str] = []
    for marker in REGULATION_PROCEDURE_MATERIAL_MARKERS:
        if marker in compact and marker not in materials:
            materials.append(marker)
    return tuple(materials)


def resolve_regulation_intro_list_role_hint(text: str) -> RegulationSemanticAssignment:
    compact = _compact(text).rstrip(":：；;，,。")
    if compact.endswith(
        (
            "申请材料如下",
            "提交以下材料",
            "应提交以下材料",
            "证明材料如下",
            "材料如下",
            "补充材料如下",
            "提交材料",
        )
    ):
        return RegulationSemanticAssignment(
            value="material_requirement",
            provenance="text:material_intro",
        )
    if compact.endswith(
        (
            "时间如下",
            "下列期限内提出",
            "期限如下",
            "补充期限如下",
            "申诉期限如下",
            "公示期限",
        )
    ):
        return RegulationSemanticAssignment(
            value="time_constraint",
            provenance="text:time_intro",
        )
    if compact.endswith(("程序", "程序如下", "按如下程序办理", "按以下程序办理", "按下列程序办理")):
        return RegulationSemanticAssignment(
            value="procedure_step",
            provenance="text:procedure_intro",
        )
    return RegulationSemanticAssignment(value="", provenance="")


def resolve_regulation_group_intro_kind(text: str) -> RegulationSemanticAssignment:
    list_intro_assignment = resolve_regulation_intro_list_role_hint(text)
    if list_intro_assignment.value == "material_requirement":
        return RegulationSemanticAssignment(
            value="material_list_intro",
            provenance=list_intro_assignment.provenance,
        )
    if list_intro_assignment.value == "time_constraint":
        return RegulationSemanticAssignment(
            value="time_list_intro",
            provenance=list_intro_assignment.provenance,
        )

    compact = _compact(text).rstrip(":：；;，,。")
    if any(
        marker in compact
        for marker in (
            "符合下列条件之一",
            "符合以下条件之一",
            "具备下列条件之一",
            "具备以下条件之一",
            "具有下列条件之一",
            "具有以下条件之一",
            "还须具备以下条件之一",
            "还应符合下列条件之一",
            "还应符合以下条件之一",
        )
    ):
        return RegulationSemanticAssignment(
            value="condition_group_intro",
            provenance="text:condition_group_intro",
        )
    if any(
        marker in compact
        for marker in (
            "有下列情形之一",
            "有以下情形之一",
        )
    ):
        return RegulationSemanticAssignment(
            value="exclusion_group_intro",
            provenance="text:exclusion_group_intro",
        )
    return RegulationSemanticAssignment(value="", provenance="")


def resolve_regulation_intro_scope(
    *,
    text: str,
    intro_target_roles: Sequence[str] = (),
    explicit_intro_scope: str = "",
) -> RegulationSemanticAssignment:
    explicit = explicit_intro_scope.strip()
    if explicit:
        return RegulationSemanticAssignment(
            value=explicit,
            provenance="metadata:intro_scope",
        )

    target_role_set = {item.strip() for item in intro_target_roles if item.strip()}
    for expected_roles, scope, provenance in REGULATION_INTRO_SCOPE_TARGET_ROLE_RULES:
        if target_role_set == expected_roles:
            return RegulationSemanticAssignment(
                value=scope,
                provenance=provenance,
            )
    if "example_evidence" in target_role_set and target_role_set.issubset(
        {"example_evidence", "exception_rule"}
    ):
        return RegulationSemanticAssignment(
            value="eligibility_group",
            provenance="intro_target_roles:eligibility_group",
        )
    if target_role_set & {
        "eligibility_condition",
        "exception_rule",
        "exclusion_rule",
        "example_evidence",
    }:
        return RegulationSemanticAssignment(
            value="eligibility_group",
            provenance="intro_target_roles:eligibility_group",
        )
    if "procedure_step" in target_role_set:
        return RegulationSemanticAssignment(
            value="procedure_list",
            provenance="intro_target_roles:procedure_step",
        )

    compact = _compact(text)
    if any(marker in compact for marker in ("程序", "流程", "步骤", "办理")):
        return RegulationSemanticAssignment(
            value="procedure_list",
            provenance="text:procedure_list",
        )
    return RegulationSemanticAssignment(
        value="eligibility_group",
        provenance="fallback:eligibility_group",
    )


def resolve_regulation_intro_subject(
    *,
    intro_target_roles: Sequence[str] = (),
    fallback_condition_subject: str = "",
) -> RegulationSemanticAssignment:
    target_role_set = {item.strip() for item in intro_target_roles if item.strip()}
    target_subject_assignment = (
        _resolve_intro_target_role_subject(target_role_set)
        if len(target_role_set) == 1
        else RegulationSemanticAssignment(value="", provenance="")
    )
    if target_subject_assignment.value:
        return target_subject_assignment
    fallback = canonical_regulation_condition_subject(fallback_condition_subject.strip())
    if fallback:
        return RegulationSemanticAssignment(
            value=fallback,
            provenance="fallback:condition_subject",
        )
    return RegulationSemanticAssignment(value="", provenance="")


def resolve_regulation_expected_polarity(
    *,
    answer_role: str,
    table_fact_type: str = "",
) -> RegulationSemanticAssignment:
    if answer_role == "exclusion_rule":
        return RegulationSemanticAssignment(
            value="negative",
            provenance="answer_role:exclusion_rule",
        )
    if answer_role in {
        "exception_rule",
        "eligibility_condition",
        "example_evidence",
        "procedure_step",
        "material_requirement",
        "time_constraint",
    }:
        return RegulationSemanticAssignment(
            value="positive",
            provenance=f"answer_role:{answer_role}",
        )
    if answer_role == "table_fact":
        if table_fact_type in {
            "amount_or_quota",
            "required_materials",
            "timeline_or_deadline",
            "procedure_table",
            "eligibility_table",
        }:
            return RegulationSemanticAssignment(
                value="positive",
                provenance=f"table_fact_type:{table_fact_type}",
            )
        return RegulationSemanticAssignment(
            value="neutral",
            provenance="answer_role:table_fact",
        )
    if answer_role in {"category_overview", "definition", "supporting_detail"}:
        return RegulationSemanticAssignment(
            value="neutral",
            provenance=f"answer_role:{answer_role}",
        )
    return RegulationSemanticAssignment(value="", provenance="")


def resolve_regulation_answer_role(
    *,
    text: str,
    prefix_text: str = "",
    role_hint: str | None = None,
) -> RegulationSemanticAssignment:
    if role_hint:
        if role_hint == "procedure_step" and _looks_like_procedure_intro_or_category(text):
            return RegulationSemanticAssignment(
                value="eligibility_intro",
                provenance="procedure_intro_or_category_heading",
            )
        if role_hint == "material_requirement" and _looks_like_material_intro_or_category(text):
            return RegulationSemanticAssignment(
                value="eligibility_intro",
                provenance="material_intro_or_category_heading",
            )
        if role_hint == "time_constraint" and _looks_like_time_intro_or_category(text):
            return RegulationSemanticAssignment(
                value="eligibility_intro",
                provenance="time_intro_or_category_heading",
            )
        if role_hint == "supporting_detail":
            return RegulationSemanticAssignment(
                value="supporting_detail",
                provenance="no_answer_ready_marker",
            )
        normalized_hint = role_hint if role_hint != "intro" else "eligibility_intro"
        return RegulationSemanticAssignment(
            value=normalized_hint,
            provenance=f"explicit_role_hint:{role_hint}",
        )

    text_only = _compact(text)
    context = _compact(" ".join(part for part in (prefix_text, text) if part))
    if any(marker in text_only for marker in REGULATION_ANSWER_ROLE_TERMINAL_PROVISION_MARKERS):
        return RegulationSemanticAssignment(
            value="supporting_detail",
            provenance="terminal_provision",
        )
    if any(marker in text_only for marker in REGULATION_ANSWER_ROLE_EXCLUSION_MARKERS):
        return RegulationSemanticAssignment(
            value="exclusion_rule",
            provenance="matched_exclusion_marker",
        )
    if _looks_like_material_intro_or_category(text):
        return RegulationSemanticAssignment(
            value="eligibility_intro",
            provenance="matched_material_intro_marker",
        )
    if _looks_like_time_intro_or_category(text):
        return RegulationSemanticAssignment(
            value="eligibility_intro",
            provenance="matched_time_intro_marker",
        )
    group_intro_assignment = resolve_regulation_group_intro_kind(text)
    if group_intro_assignment.value == "condition_group_intro":
        return RegulationSemanticAssignment(
            value="eligibility_intro",
            provenance="matched_condition_group_intro",
        )
    if group_intro_assignment.value == "exclusion_group_intro":
        return RegulationSemanticAssignment(
            value="eligibility_intro",
            provenance="matched_exclusion_group_intro",
        )
    if any(marker in text_only for marker in ("有权", "回避")) and any(
        marker in text_only for marker in ("情形之一", "下列情形")
    ):
        return RegulationSemanticAssignment(
            value="eligibility_intro",
            provenance="matched_exclusion_group_intro",
        )
    if _is_procedure_step_answer_role(text=text_only, context=context):
        return RegulationSemanticAssignment(
            value="procedure_step",
            provenance="matched_procedure_marker",
        )
    if _is_example_evidence_answer_role(text_only):
        return RegulationSemanticAssignment(
            value="example_evidence",
            provenance="matched_example_evidence_marker",
        )
    if any(marker in text_only for marker in REGULATION_ANSWER_ROLE_EXCEPTION_MARKERS) or (
        "超出" in text_only and "但" in text_only
    ):
        return RegulationSemanticAssignment(
            value="exception_rule",
            provenance="matched_exception_marker",
        )
    if any(marker in context for marker in REGULATION_ANSWER_ROLE_ELIGIBILITY_MARKERS):
        if any(marker in text_only for marker in REGULATION_ANSWER_ROLE_EXAMPLE_LIST_MARKERS) and (
            "条件" not in text_only
        ):
            return RegulationSemanticAssignment(
                value="eligibility_intro",
                provenance="matched_example_intro_marker",
            )
        return RegulationSemanticAssignment(
            value="eligibility_condition",
            provenance="matched_eligibility_marker",
        )
    return RegulationSemanticAssignment(
        value="supporting_detail",
        provenance="no_answer_ready_marker",
    )


def resolve_regulation_heading_role_hint(text: str) -> RegulationSemanticAssignment:
    stripped = text.strip()
    compact = _compact(stripped).rstrip(":：；;，,。")
    is_heading_like = (
        bool(stripped)
        and not any(punct in stripped for punct in ("。", "；", ";"))
        and len(compact) <= 24
    )
    if not is_heading_like:
        return RegulationSemanticAssignment(value="", provenance="")
    if compact.startswith("材料报送情况"):
        return RegulationSemanticAssignment(
            value="procedure_step",
            provenance="text:procedure_heading",
        )
    if compact in {"程序如下", "流程如下", "办理程序"}:
        return RegulationSemanticAssignment(
            value="procedure_step",
            provenance="text:procedure_heading",
        )
    if any(compact.endswith(marker) for marker in ("程序", "类别")) and len(compact) <= 24:
        if compact.endswith("程序"):
            return RegulationSemanticAssignment(
                value="procedure_step",
                provenance="text:procedure_heading",
            )
        return RegulationSemanticAssignment(
            value="eligibility_intro",
            provenance="text:generic_heading",
        )
    if compact.startswith("免试生类别"):
        return RegulationSemanticAssignment(
            value="eligibility_intro",
            provenance="text:generic_heading",
        )
    if any(compact.endswith(marker) for marker in ("申请材料", "证明材料", "申诉材料", "材料")):
        return RegulationSemanticAssignment(
            value="material_requirement",
            provenance="text:material_heading",
        )
    if any(compact.endswith(marker) for marker in ("申诉期限", "期限", "时间")):
        return RegulationSemanticAssignment(
            value="time_constraint",
            provenance="text:time_heading",
        )
    return RegulationSemanticAssignment(value="", provenance="")


def _resolve_keyword_rule(
    compact_text: str,
    rules: Sequence[RegulationSemanticKeywordRule],
) -> RegulationSemanticAssignment:
    if not compact_text:
        return RegulationSemanticAssignment(value="", provenance="")
    for rule in rules:
        if rule.match_mode == "all":
            matched = all(marker in compact_text for marker in rule.markers)
        else:
            matched = any(marker in compact_text for marker in rule.markers)
        if matched:
            return RegulationSemanticAssignment(
                value=rule.value,
                provenance=rule.provenance,
            )
    return RegulationSemanticAssignment(value="", provenance="")


def _resolve_intro_target_role_subject(
    target_roles: set[str],
) -> RegulationSemanticAssignment:
    if not target_roles:
        return RegulationSemanticAssignment(value="", provenance="")
    for target_role, subject, provenance in REGULATION_INTRO_TARGET_ROLE_SUBJECT_RULES:
        if target_role in target_roles:
            return RegulationSemanticAssignment(
                value=subject,
                provenance=provenance,
            )
    return RegulationSemanticAssignment(value="", provenance="")


def _resolve_procedure_actor_by_action_context(
    compact_text: str,
    rules: Sequence[RegulationSemanticKeywordRule],
) -> RegulationSemanticAssignment:
    if not compact_text:
        return RegulationSemanticAssignment(value="", provenance="")
    best_index: int | None = None
    best_negative_length: int | None = None
    best_assignment = RegulationSemanticAssignment(value="", provenance="")
    for rule in rules:
        for marker in rule.markers:
            search_start = 0
            while True:
                marker_index = compact_text.find(marker, search_start)
                if marker_index < 0:
                    break
                tail = compact_text[marker_index + len(marker) :]
                if any(action in tail for action in REGULATION_PROCEDURE_ACTOR_ACTION_MARKERS):
                    assignment = RegulationSemanticAssignment(
                        value=rule.value,
                        provenance=rule.provenance,
                    )
                    negative_length = -len(marker)
                    if (
                        best_index is None
                        or marker_index < best_index
                        or (
                            marker_index == best_index
                            and best_negative_length is not None
                            and negative_length < best_negative_length
                        )
                    ):
                        best_index = marker_index
                        best_negative_length = negative_length
                        best_assignment = assignment
                search_start = marker_index + 1
    if not best_assignment.value:
        return RegulationSemanticAssignment(value="", provenance="")
    return best_assignment


def _resolve_condition_subject_keyword_rule(
    compact_text: str,
    *,
    answer_role: str,
) -> RegulationSemanticAssignment:
    assignment = _resolve_keyword_rule(compact_text, REGULATION_CONDITION_SUBJECT_KEYWORD_RULES)
    if not assignment.value:
        return assignment
    if assignment.value == "material_requirement" and answer_role in {
        "exception_rule",
        "exclusion_rule",
    }:
        return RegulationSemanticAssignment(value="", provenance="")
    if assignment.value == "audience_scope" and answer_role not in {
        "category_overview",
        "eligibility_intro",
    }:
        return RegulationSemanticAssignment(value="", provenance="")
    return assignment


def _looks_like_procedure_intro_or_category(text: str) -> bool:
    if not text:
        return False
    assignment = resolve_regulation_heading_role_hint(text)
    if assignment.value in {"procedure_step", "eligibility_intro"}:
        return True
    assignment = resolve_regulation_intro_list_role_hint(text)
    return assignment.value == "procedure_step"


def _looks_like_material_intro_or_category(text: str) -> bool:
    if not text:
        return False
    assignment = resolve_regulation_heading_role_hint(text)
    if assignment.value == "material_requirement":
        return True
    assignment = resolve_regulation_intro_list_role_hint(text)
    return assignment.value == "material_requirement"


def _looks_like_time_intro_or_category(text: str) -> bool:
    if not text:
        return False
    assignment = resolve_regulation_heading_role_hint(text)
    if assignment.value == "time_constraint":
        return True
    assignment = resolve_regulation_intro_list_role_hint(text)
    return assignment.value == "time_constraint"


def _is_procedure_step_answer_role(*, text: str, context: str) -> bool:
    if _looks_like_procedure_intro_or_category(text):
        return False
    if resolve_regulation_group_intro_kind(text).value in {
        "condition_group_intro",
        "exclusion_group_intro",
    }:
        return False
    if any(marker in text for marker in ("不合格", "未通过", "不予", "不得", "不能", "取消资格")):
        return False
    if any(marker in text for marker in REGULATION_NON_PROCEDURE_QUOTA_MARKERS) and not any(
        marker in text for marker in REGULATION_PROCEDURE_STEP_REQUIRED_ACTION_MARKERS
    ):
        return False
    if any(marker in text for marker in REGULATION_NON_PROCEDURE_RESULT_USAGE_MARKERS) and not any(
        marker in text for marker in REGULATION_PROCEDURE_STEP_REQUIRED_ACTION_MARKERS
    ):
        return False
    if "发放" in text and not any(
        marker in text
        for marker in (
            "予以发放",
            "统一发放",
            "按时发放",
            "负责发放",
            "审核后发放",
            "审批后发放",
            "公示后发放",
        )
    ):
        return False
    if any(marker in text for marker in ("申报", "报送", "复评", "复审", "公示")):
        return True
    if _starts_procedure_list(text) or _starts_procedure_list(context):
        return True
    action_assignment = resolve_regulation_procedure_action(text=text)
    if action_assignment.value in {
        "review",
        "college_review",
        "office_review",
        "publish_notice",
        "process",
        "report_loss",
        "reissue",
    }:
        return True
    if action_assignment.value == "apply":
        return True
    return any(marker in context for marker in ("程序", "流程", "手续", "步骤", "办理")) and any(
        marker in text for marker in ("提交", "申请", "审核", "审批", "受理", "公示", "申诉")
    )


def _is_example_evidence_answer_role(text: str) -> bool:
    return "取得显著成绩" in text and any(
        marker in text for marker in ("学术研究", "发表", "专利", "竞赛", "文艺比赛", "体育竞赛")
    )


def _starts_procedure_list(text: str) -> bool:
    compact = _compact(text)
    if not compact:
        return False
    return compact.endswith(("程序如下", "流程如下", "办理程序")) or any(
        marker in compact
        for marker in (
            "按如下程序",
            "按以下程序",
            "按下列程序",
            "按照如下程序",
            "按照以下程序",
            "按照下列程序",
        )
    )


def _compact(value: str) -> str:
    return re.sub(r"\s+", "", value.strip())


@lru_cache(maxsize=1)
def _load_student_rules_query_planning_config() -> dict[str, object]:
    return json.loads(student_rules_query_planning_path().read_text(encoding="utf-8"))


@lru_cache(maxsize=1)
def _load_public_regulation_consumption_manifest() -> dict[str, object]:
    return json.loads(public_regulation_consumption_manifest_path().read_text(encoding="utf-8"))


__all__ = [
    "REGULATION_CONDITION_SUBJECT_ALIASES",
    "REGULATION_CONDITION_SUBJECT_DEFINITIONS",
    "REGULATION_GROUPED_ANSWER_ROLES",
    "REGULATION_PROCEDURE_ACTION_ALIASES",
    "REGULATION_PROCEDURE_ACTION_DEFINITIONS",
    "REGULATION_PROCEDURE_ACTOR_ALIASES",
    "REGULATION_PROCEDURE_ACTOR_DEFINITIONS",
    "RegulationCategoryDefinition",
    "RegulationConditionSubjectDefinition",
    "RegulationDiscoveryConfig",
    "RegulationPolicyObjectDefinition",
    "RegulationProcedureActionDefinition",
    "RegulationProcedureActorDefinition",
    "RegulationSemanticAssignment",
    "build_regulation_condition_group_id",
    "canonical_regulation_condition_subject",
    "canonical_regulation_procedure_action",
    "canonical_regulation_procedure_actor",
    "condition_group_subject_from_group_id",
    "load_institutional_rules_discovery_config",
    "load_regulation_discovery_config",
    "load_student_rules_discovery_config",
    "regulation_categories_for_document",
    "resolve_regulation_action_type",
    "resolve_regulation_answer_role",
    "resolve_regulation_condition_group_subject",
    "resolve_regulation_condition_subject",
    "resolve_regulation_expected_polarity",
    "resolve_regulation_group_intro_kind",
    "resolve_regulation_group_subject",
    "resolve_regulation_heading_role_hint",
    "resolve_regulation_intro_list_role_hint",
    "resolve_regulation_intro_scope",
    "resolve_regulation_intro_subject",
    "resolve_regulation_procedure_action",
    "resolve_regulation_procedure_actor",
    "resolve_regulation_procedure_materials",
    "resolve_regulation_procedure_next_actor",
    "resolve_regulation_section_subject_hint",
]
