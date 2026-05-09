from __future__ import annotations

import re
from collections.abc import Sequence

from .regulation_semantic_registry_answer_rules import (
    REGULATION_CONDITION_SUBJECT_KEYWORD_RULES,
    REGULATION_INTRO_TARGET_ROLE_SUBJECT_RULES,
)
from .regulation_semantic_registry_condition_rules import (
    REGULATION_CONDITION_SUBJECT_DEFINITIONS,
)
from .regulation_semantic_registry_procedure_rules import (
    REGULATION_DISBURSEMENT_POSITIVE_MARKERS,
    REGULATION_GENERIC_OFFICE_SUFFIX_ACTION_RE,
    REGULATION_IMPLICIT_EXCLUSION_TARGET_MARKERS,
    REGULATION_NON_PROCEDURE_QUOTA_MARKERS,
    REGULATION_NON_PROCEDURE_RESULT_USAGE_MARKERS,
    REGULATION_NON_PROCEDURE_REVIEW_STATUS_MARKERS,
    REGULATION_NON_PROCEDURE_STATUS_EMBEDDED_ACTION_PHRASES,
    REGULATION_PROCEDURE_ACTOR_ACTION_MARKERS,
    REGULATION_PROCEDURE_APPLY_STEP_CONTEXT_MARKERS,
    REGULATION_PROCEDURE_DISPOSITION_HEADING_MARKERS,
    REGULATION_PROCEDURE_DISPOSITION_RESULT_MARKERS,
    REGULATION_PROCEDURE_REVIEW_STEP_CONTEXT_MARKERS,
    REGULATION_PROCEDURE_STEP_REQUIRED_ACTION_MARKERS,
)
from .regulation_semantic_registry_types import (
    RegulationSemanticAssignment,
    RegulationSemanticKeywordRule,
)


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


def _condition_subject_supports_answer_role(subject: str, answer_role: str) -> bool:
    from .regulation_semantic_registry_base import canonical_regulation_condition_subject

    normalized_subject = canonical_regulation_condition_subject(subject)
    if not normalized_subject:
        return False
    if not answer_role:
        return True
    definition = REGULATION_CONDITION_SUBJECT_DEFINITIONS.get(normalized_subject)
    if definition is None:
        return False
    if answer_role in definition.expected_answer_roles:
        return True
    return answer_role == "eligibility_intro"


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


def _resolve_generic_office_actor_by_action_context(
    compact_text: str,
) -> RegulationSemanticAssignment:
    if not compact_text:
        return RegulationSemanticAssignment(value="", provenance="")
    for match in REGULATION_GENERIC_OFFICE_SUFFIX_ACTION_RE.finditer(compact_text):
        tail = match.group("tail")
        if any(
            action in tail
            for action in (
                *REGULATION_PROCEDURE_ACTOR_ACTION_MARKERS,
                *REGULATION_DISBURSEMENT_POSITIVE_MARKERS,
            )
        ):
            return RegulationSemanticAssignment(
                value="office",
                provenance="regex:generic_office_actor",
            )
    return RegulationSemanticAssignment(value="", provenance="")


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
    from .regulation_semantic_registry_intro import (
        resolve_regulation_heading_role_hint,
        resolve_regulation_intro_list_role_hint,
    )

    if not text:
        return False
    assignment = resolve_regulation_heading_role_hint(text)
    if assignment.value in {"procedure_step", "eligibility_intro"}:
        return True
    assignment = resolve_regulation_intro_list_role_hint(text)
    return assignment.value == "procedure_step"


def _looks_like_material_intro_or_category(text: str) -> bool:
    from .regulation_semantic_registry_intro import (
        resolve_regulation_heading_role_hint,
        resolve_regulation_intro_list_role_hint,
    )

    if not text:
        return False
    assignment = resolve_regulation_heading_role_hint(text)
    if assignment.value == "material_requirement":
        return True
    assignment = resolve_regulation_intro_list_role_hint(text)
    return assignment.value == "material_requirement"


def _looks_like_material_requirement_item(text: str) -> bool:
    compact = _compact(text).rstrip("。；;，,")
    if not compact:
        return False
    if _looks_like_named_material_reference_clause(compact):
        return True
    if any(
        marker in compact
        for marker in (
            "共同提出",
            "提出申请",
            "提供",
            "填写",
            "交给",
            "交至",
            "报送",
            "上报",
            "审查",
            "审核",
            "审批",
            "签字",
            "加盖",
            "公示",
            "受理",
            "办理",
        )
    ):
        return False
    if any(
        marker in compact
        for marker in (
            "复评",
            "复审",
            "评选",
            "汇总",
            "报至",
            "完成",
            "由",
            "盖公章",
            "工作",
            "进行",
        )
    ):
        return False
    if any(
        marker in compact
        for marker in (
            "提交",
            "递交",
            "填写",
            "报送",
            "上报",
            "审核",
            "审批",
            "审查",
            "办理",
            "受理",
            "公示",
            "交给",
            "送交",
            "签字",
            "签署",
            "加盖",
        )
    ):
        return False
    return any(
        marker in compact
        for marker in (
            "申请表",
            "申请书",
            "证明材料",
            "申请材料",
            "复印件",
            "原件",
            "验证报告",
            "成绩单",
            "证明",
            "材料",
        )
    )


def _looks_like_named_material_reference_clause(compact: str) -> bool:
    if "《" not in compact or "》" not in compact:
        return False
    if not any(
        marker in compact
        for marker in ("申请表", "申请书", "报告", "证明", "复印件", "推荐信", "验证报告")
    ):
        return False
    if any(
        marker in compact
        for marker in ("如已", "如果", "不再", "方可", "资格", "获得", "具备", "同时")
    ):
        return False
    return not any(
        marker in compact
        for marker in (
            "并将",
            "交给",
            "交至",
            "报送",
            "上报",
            "审查",
            "审核",
            "审批",
            "共同提出",
            "提出申请",
            "提供可作为",
            "加盖",
            "公示",
            "受理",
            "办理",
        )
    )


def _looks_like_time_intro_or_category(text: str) -> bool:
    from .regulation_semantic_registry_intro import (
        resolve_regulation_heading_role_hint,
        resolve_regulation_intro_list_role_hint,
    )

    if not text:
        return False
    assignment = resolve_regulation_heading_role_hint(text)
    if assignment.value == "time_constraint":
        return True
    assignment = resolve_regulation_intro_list_role_hint(text)
    return assignment.value == "time_constraint"


def _is_procedure_step_answer_role(*, text: str, context: str) -> bool:
    from .regulation_semantic_registry_actions import resolve_regulation_procedure_action
    from .regulation_semantic_registry_intro import resolve_regulation_group_intro_kind

    if _looks_like_procedure_intro_or_category(text):
        return False
    if resolve_regulation_group_intro_kind(text).value in {
        "condition_group_intro",
        "exclusion_group_intro",
    }:
        return False
    if _looks_like_material_requirement_item(text):
        return False
    if _looks_like_procedure_heading_only(text):
        return False
    if any(marker in text for marker in ("不合格", "未通过", "不予", "不得", "不能", "取消资格")):
        return False
    if _looks_like_implicit_exclusion_clause(text):
        return False
    if any(
        marker in text for marker in REGULATION_NON_PROCEDURE_QUOTA_MARKERS
    ) and not _has_required_procedure_action_marker(text):
        return False
    if any(
        marker in text for marker in REGULATION_NON_PROCEDURE_RESULT_USAGE_MARKERS
    ) and not _has_required_procedure_action_marker(text):
        return False
    if (
        "递交" in text
        and any(marker in text for marker in ("注:", "附件", "一份", "原件"))
        and not any(marker in context for marker in ("程序", "流程", "步骤", "办理", "评选"))
    ):
        return False
    if _looks_like_disposition_heading(text) or _looks_like_disposition_result_clause(text):
        return False
    if _looks_like_agenda_apply_scope_item(text):
        return False
    if _looks_like_scope_review_topic(text):
        return False
    if _looks_like_joint_eligibility_apply_clause(text):
        return False
    if _looks_like_result_counting_exception_clause(text):
        return False
    if _looks_like_large_guideline_manifesto(text):
        return False
    if _looks_like_misconduct_recognition_fragment(text=text, context=context):
        return False
    if _looks_like_formula_or_ranking_definition(text):
        return False
    if _looks_like_assessment_rule_definition(text):
        return False
    if _looks_like_award_or_achievement_summary(text):
        return False
    if _looks_like_disbursement_step(text):
        return True
    if (
        "递交" in text
        and not any(marker in context for marker in ("程序", "流程", "步骤", "办理", "评选"))
        and not any(marker in text for marker in ("申请人", "申请者", "学生本人", "院系", "学院"))
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
    if "申报" in text:
        return _has_apply_step_context(text)
    if any(
        marker in text for marker in REGULATION_NON_PROCEDURE_REVIEW_STATUS_MARKERS
    ) and not _has_required_procedure_action_marker(text):
        return False
    if any(marker in text for marker in ("报送", "复评", "复审", "公示")):
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
        "disburse",
        "report_loss",
        "reissue",
        "submit_materials",
    }:
        return not (
            action_assignment.value == "review" and not _has_review_step_context(text, context)
        )
    if action_assignment.value == "apply":
        return any(
            marker in text for marker in ("提出申请", "定密申请", "提出学位论文定密申请")
        ) or (_has_apply_step_context(text))
    return any(marker in context for marker in ("程序", "流程", "手续", "步骤", "办理")) and any(
        marker in text for marker in ("提交", "申请", "审核", "审批", "受理", "公示", "申诉")
    )


def _has_apply_step_context(text: str) -> bool:
    return any(marker in text for marker in REGULATION_PROCEDURE_APPLY_STEP_CONTEXT_MARKERS)


def _has_review_step_context(text: str, context: str) -> bool:
    if any(marker in context for marker in ("程序", "流程", "步骤", "办理", "审核")):
        return True
    return any(
        marker in text
        for marker in REGULATION_PROCEDURE_REVIEW_STEP_CONTEXT_MARKERS
        if marker != "申请"
    )


def _has_required_procedure_action_marker(text: str) -> bool:
    compact = _compact(text)
    sanitized = compact
    for phrase in REGULATION_NON_PROCEDURE_STATUS_EMBEDDED_ACTION_PHRASES:
        sanitized = sanitized.replace(phrase, "")
    return any(marker in sanitized for marker in REGULATION_PROCEDURE_STEP_REQUIRED_ACTION_MARKERS)


def _looks_like_disposition_heading(text: str) -> bool:
    stripped = text.strip()
    if not stripped or any(punct in stripped for punct in ("。", "；", ";", "：", ":")):
        return False
    compact = _compact(stripped)
    return any(marker in compact for marker in REGULATION_PROCEDURE_DISPOSITION_HEADING_MARKERS)


def _looks_like_disposition_result_clause(text: str) -> bool:
    if any(marker in text for marker in ("申诉", "受理", "办理", "公示", "审核", "审批")):
        return False
    return any(marker in text for marker in REGULATION_PROCEDURE_DISPOSITION_RESULT_MARKERS)


def _looks_like_agenda_apply_scope_item(text: str) -> bool:
    if "申报" not in text:
        return False
    if _has_apply_step_context(text):
        return False
    return not any(marker in text for marker in ("可", "应", "须", "由", "填写", "提交"))


def _looks_like_scope_review_topic(text: str) -> bool:
    if "审定" not in text and "执行" not in text:
        return False
    if any(marker in text for marker in ("审核", "审批", "审查", "复审", "核准")):
        return False
    return any(marker in text for marker in ("重要事项", "主要包括"))


def _looks_like_joint_eligibility_apply_clause(text: str) -> bool:
    if "申请" not in text:
        return False
    if not any(marker in text for marker in ("可同时申请并获得", "可申请并获得")):
        return False
    return any(marker in text for marker in ("同一学年内", "家庭经济困难学生", "奖学金"))


def _looks_like_result_counting_exception_clause(text: str) -> bool:
    if "不计入" not in text:
        return False
    return any(marker in text for marker in ("次数", "名额", "额度", "比例"))


def _looks_like_large_guideline_manifesto(text: str) -> bool:
    if text.count("\n") < 4:
        return False
    if re.match(r"^\d{4}年\d{1,2}月\d{1,2}日", text.strip()) is None:
        return False
    return sum(text.count(marker) for marker in ("一、", "二、", "三、", "四、", "五、")) >= 3


def _looks_like_misconduct_recognition_fragment(*, text: str, context: str) -> bool:
    compact = _compact(text)
    compact_context = _compact(context)
    if "与本人身份不符" in compact:
        return True
    if any(marker in compact for marker in ("虚假意见", "违规委托", "弄虚作假")):
        return True
    if not any(marker in compact_context for marker in ("认定", "违规行为")):
        return False
    if any(marker in compact for marker in ("评审意见", "鉴定意见")):
        return True
    return compact.endswith(("的;", "的；", "的。"))


def _looks_like_procedure_heading_only(text: str) -> bool:
    stripped = text.strip()
    if not stripped or any(punct in stripped for punct in ("。", "；", ";", "：", ":")):
        return False
    compact = _compact(stripped)
    return any(marker in compact for marker in ("提交、答辩", "提交答辩"))


def _looks_like_non_action_assessment_heading(text: str) -> bool:
    stripped = text.strip()
    if not stripped or any(punct in stripped for punct in ("。", "；", ";", "：", ":")):
        return False
    compact = _compact(stripped)
    return compact.endswith(("选拔考核方式", "笔试考核", "面试考核"))


def _looks_like_formula_or_ranking_definition(text: str) -> bool:
    compact = _compact(text)
    if not compact:
        return False
    if "计算公式" in compact or "=" in compact:
        return True
    if any(marker in compact for marker in ("总成绩由", "均实行百分制")):
        return True
    return any(
        marker in compact
        for marker in ("从高到低排序", "由高至低排序", "按综合成绩排序", "择优录取")
    ) and not any(
        marker in compact
        for marker in ("教务处", "学生处", "学院", "院系", "学校", "委员会", "工作小组")
    )


def _looks_like_assessment_rule_definition(text: str) -> bool:
    compact = _compact(text)
    if not compact:
        return False
    if "形式原则上应有" in compact:
        return True
    return "考核内容由" in compact and "确定" in compact


def _looks_like_award_or_achievement_summary(text: str) -> bool:
    compact = _compact(text)
    if len(compact) < 120:
        return False
    if sum(compact.count(marker) for marker in ("。", "；", ";")) < 2:
        return False
    if not any(
        marker in compact
        for marker in ("先进单位", "先进集体", "一等奖", "优秀组织奖", "称号", "荣誉")
    ):
        return False
    return any(
        marker in compact
        for marker in ("取得", "建设", "发展", "建立", "开设", "出版", "开展", "发挥", "完成")
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


def _looks_like_implicit_exclusion_clause(text: str) -> bool:
    if not text:
        return False
    return any(marker in text for marker in REGULATION_IMPLICIT_EXCLUSION_TARGET_MARKERS)


def _looks_like_disbursement_step(text: str) -> bool:
    from .regulation_semantic_registry_base import resolve_regulation_procedure_actor

    if not text:
        return False
    if _looks_like_implicit_exclusion_clause(text):
        return False
    if not any(marker in text for marker in ("发放", "拨付")):
        return False
    if any(marker in text for marker in REGULATION_DISBURSEMENT_POSITIVE_MARKERS):
        return True
    actor_assignment = resolve_regulation_procedure_actor(text=text)
    return actor_assignment.value and any(marker in text for marker in ("发放", "拨付", "按表"))


def _compact(value: str) -> str:
    return re.sub(r"\s+", "", value.strip())
