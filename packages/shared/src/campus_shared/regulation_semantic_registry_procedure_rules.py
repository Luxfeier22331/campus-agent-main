from __future__ import annotations

import re

from .regulation_semantic_registry_types import (
    RegulationProcedureActionDefinition,
    RegulationProcedureActorDefinition,
    RegulationSemanticKeywordRule,
)

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
        description="申诉、复核、提出异议、听证陈述或听证流程步骤。",
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
    "disburse": RegulationProcedureActionDefinition(
        action_id="disburse",
        description="发放、拨付奖励、资助或其他经费。",
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
    "调查人员": "office",
    "考试工作人员": "office",
    "听证主持人": "office",
    "听证参加人员": "office",
    "考核机构": "office",
    "校长办公会": "office",
    "专门会议": "office",
    "责任主体": "office",
    "承办单位": "office",
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
        markers=("调查人员",),
        provenance="keyword:调查人员",
    ),
    RegulationSemanticKeywordRule(
        value="office",
        markers=("考试工作人员", "听证主持人", "听证参加人员"),
        provenance="keyword:hearing_or_exam_staff",
    ),
    RegulationSemanticKeywordRule(
        value="office",
        markers=("考核机构", "校长办公会", "专门会议"),
        provenance="keyword:office_actor",
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
    "填写",
    "报送",
    "上报",
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
    "研究决定",
    "考评",
)

REGULATION_PROCEDURE_ACTOR_ACTION_MARKERS: tuple[str, ...] = (
    "提交",
    "申请",
    "申报",
    "填写",
    "报送",
    "上报",
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
    "提出",
    "考评",
    "研究决定",
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
        markers=("申诉", "听证", "陈述", "申辩", "处分建议", "提出拟被处分"),
        provenance="keyword:申诉听证",
    ),
    RegulationSemanticKeywordRule(
        value="submit_materials",
        markers=("报送", "备案", "上报"),
        provenance="keyword:报送备案",
    ),
    RegulationSemanticKeywordRule(
        value="apply",
        markers=("定密申请", "提出申请", "提出学位论文定密申请"),
        provenance="keyword:定密申请",
    ),
    RegulationSemanticKeywordRule(
        value="apply",
        markers=("申报",),
        provenance="keyword:申请申报",
    ),
    RegulationSemanticKeywordRule(
        value="submit_materials",
        markers=("提交", "上交", "填写"),
        provenance="keyword:提交+材料",
    ),
    RegulationSemanticKeywordRule(
        value="process",
        markers=("负责指导", "指导学生", "指导开展", "开展项目研究", "组织开展"),
        provenance="keyword:指导职责流程",
    ),
    RegulationSemanticKeywordRule(
        value="process",
        markers=("约谈",),
        provenance="keyword:约谈核实",
    ),
    RegulationSemanticKeywordRule(
        value="process",
        markers=("受理", "办理", "协调", "答复"),
        provenance="keyword:受理办理协调答复",
    ),
    RegulationSemanticKeywordRule(
        value="review",
        markers=("审定", "核准", "签署意见", "研究决定", "作出复查决定", "作出决定", "提出建议"),
        provenance="keyword:审定核准签署意见",
    ),
    RegulationSemanticKeywordRule(
        value="review",
        markers=("审核", "审批", "复审", "审查", "考评", "综合考评", "考核", "排序", "面试"),
        provenance="keyword:审核审批",
    ),
    RegulationSemanticKeywordRule(
        value="publish_notice",
        markers=("公示",),
        provenance="keyword:公示",
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

REGULATION_PROCEDURE_MATERIAL_STRONG_CONTEXT_MARKERS: tuple[str, ...] = (
    "书面申请",
    "申请表",
    "申请书",
    "申报表",
    "申诉申请",
    "提出申请",
    "报送",
    "备案",
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

REGULATION_IMPLICIT_EXCLUSION_TARGET_MARKERS: tuple[str, ...] = (
    "任何形式的个人补助",
    "任何形式个人补助",
)

REGULATION_NON_PROCEDURE_REVIEW_STATUS_MARKERS: tuple[str, ...] = (
    "纪律审查",
    "司法调查",
    "尚未做出结论",
    "未做出结论",
    "正在接受",
)

REGULATION_DISBURSEMENT_POSITIVE_MARKERS: tuple[str, ...] = (
    "拨付",
    "汇总",
    "制作",
    "明细表",
    "按表",
    "银行卡",
    "缴纳学费",
    "转财务处",
)

REGULATION_GENERIC_OFFICE_SUFFIX_ACTION_RE = re.compile(
    r"(?P<name>[\u4e00-\u9fffA-Za-z()（）]{2,20}?(?:处|办公室|中心|委员会|研究院))"
    r"(?P<tail>[^。；;\n]{0,24})"
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
    "提出",
    "填写",
    "报送",
    "上报",
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
    "研究决定",
    "考评",
)

REGULATION_NON_PROCEDURE_STATUS_EMBEDDED_ACTION_PHRASES: tuple[str, ...] = (
    "纪律审查",
    "正在接受纪律审查",
    "接受纪律审查",
    "司法调查",
    "正在接受司法调查",
    "接受司法调查",
    "尚未做出结论",
    "未做出结论",
)

REGULATION_PROCEDURE_APPLY_STEP_CONTEXT_MARKERS: tuple[str, ...] = (
    "填写",
    "提交",
    "上报",
    "报送",
    "备案",
    "材料",
    "申请表",
    "证明",
    "自主申报",
    "提名申报",
    "提出申请",
)

REGULATION_PROCEDURE_REVIEW_STEP_CONTEXT_MARKERS: tuple[str, ...] = (
    "审核",
    "审批",
    "审查",
    "复审",
    "考评",
    "综合考评",
    "研究决定",
    "核准",
    "签署意见",
    "受理",
    "报送",
    "申报",
    "申请",
    "材料",
)

REGULATION_PROCEDURE_DISPOSITION_HEADING_MARKERS: tuple[str, ...] = (
    "行为的处理",
    "认定与处理",
    "给予退学处理",
    "给予解聘处理",
    "给予处分",
    "按相关法律法规及时处理",
)

REGULATION_PROCEDURE_DISPOSITION_RESULT_MARKERS: tuple[str, ...] = (
    "给予解聘处理",
    "给予退学处理",
    "给予处分",
    "按相关法律法规及时处理",
    "认定为",
)
