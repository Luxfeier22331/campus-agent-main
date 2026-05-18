from __future__ import annotations

from .regulation_semantic_registry_types import RegulationSemanticKeywordRule

REGULATION_CONDITION_SUBJECT_KEYWORD_RULES: tuple[RegulationSemanticKeywordRule, ...] = (
    RegulationSemanticKeywordRule(
        value="attendance_absence_threshold",
        markers=("旷课", "学时"),
        provenance="keyword:旷课学时阈值",
        match_mode="all",
    ),
    RegulationSemanticKeywordRule(
        value="attendance_absence_threshold",
        markers=("旷课", "节"),
        provenance="keyword:旷课节次阈值",
        match_mode="all",
    ),
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
        markers=("发表", "学术研究", "专利", "学术论文", "科研成果", "核心期刊"),
        provenance="keyword:论文科研",
    ),
    RegulationSemanticKeywordRule(
        value="paper_or_publication",
        markers=("论文", "发表"),
        provenance="keyword:论文科研",
        match_mode="all",
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
        markers=("截止", "期限", "时限", "公示", "不少于", "每周", "时间"),
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
    ("exclusion_rule", "generic_condition", "intro_target_roles:exclusion_rule"),
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
        value="attendance_absence_threshold",
        markers=("旷课", "节"),
        provenance="table_fact_type:generic_policy_table+keyword:旷课节次阈值",
        match_mode="all",
    ),
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
    "视为放弃",
    "放弃入学资格",
    "信息不真实",
    "信息不准确",
    "伪造证书",
    "伪造证明材料",
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
