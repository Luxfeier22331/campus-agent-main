from __future__ import annotations

import re
from collections.abc import Sequence

from .regulation_semantic_registry_answer_rules import (
    REGULATION_ACTION_TYPE_CONTEXT_RULES,
    REGULATION_ACTION_TYPE_SECTION_RULES,
    REGULATION_ACTION_TYPE_TEXT_RULES,
)
from .regulation_semantic_registry_predicates import (
    _compact,
    _resolve_generic_office_actor_by_action_context,
    _resolve_keyword_rule,
    _resolve_procedure_actor_by_action_context,
)
from .regulation_semantic_registry_procedure_rules import (
    REGULATION_CONDITION_SUBJECT_ALIASES,
    REGULATION_PROCEDURE_ACTION_ALIASES,
    REGULATION_PROCEDURE_ACTION_MATERIAL_MARKERS,
    REGULATION_PROCEDURE_ACTOR_ALIASES,
    REGULATION_PROCEDURE_ACTOR_RULES,
    REGULATION_PROCEDURE_NEXT_ACTOR_RULES,
    REGULATION_SECTION_SUBJECT_RULES,
)
from .regulation_semantic_registry_types import RegulationSemanticAssignment


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

    from .regulation_semantic_registry_intro import resolve_regulation_group_intro_kind

    if resolve_regulation_group_intro_kind(text).value in {
        "condition_group_intro",
        "exclusion_group_intro",
    }:
        return RegulationSemanticAssignment(value="", provenance="")

    compact = _compact(text)
    if "学生信息" in compact and "学生本人" not in compact:
        compact = compact.replace("学生信息", "")
    if compact.startswith("对学生的") and any(
        marker in compact for marker in ("研究决定", "校长办公会", "专门会议")
    ):
        compact = compact.replace("对学生的", "", 1)
    if any(marker in compact for marker in ("考核机构", "校长办公会", "专门会议")):
        return RegulationSemanticAssignment(
            value="office",
            provenance="keyword:office_actor",
        )
    if compact.startswith("研究决定") or re.match(
        r"^[（(]?[一二三四五六七八九十\d]+[)）.、]研究决定", compact
    ):
        return RegulationSemanticAssignment(
            value="office",
            provenance="fallback:review_office_step",
        )
    if any(marker in compact for marker in ("听证结束", "听证会结束")):
        return RegulationSemanticAssignment(
            value="office",
            provenance="keyword:听证结束",
        )
    if any(marker in compact for marker in ("告知申请人", "向申请人提供信息", "说明理由")):
        return RegulationSemanticAssignment(
            value="office",
            provenance="keyword:信息公开办理主体",
        )
    if any(marker in compact for marker in ("代收代缴", "收取实际发生的", "提供信息")) and any(
        marker in compact for marker in ("学校", "财务处", "申请人")
    ):
        return RegulationSemanticAssignment(
            value="office",
            provenance="keyword:收费办理主体",
        )
    if any(marker in compact for marker in ("核准后接入校园网", "接入校园网", "审定密级")):
        return RegulationSemanticAssignment(
            value="office",
            provenance="keyword:核准接入校园网职责",
        )
    if any(
        marker in compact for marker in ("报党委审定", "党委审定", "学术委员会", "全体会议审议")
    ):
        return RegulationSemanticAssignment(
            value="office",
            provenance="keyword:委员会党委审议",
        )
    if any(
        marker in compact
        for marker in ("听证主持人", "听证参加人员", "质证", "复查决定", "提出建议")
    ):
        return RegulationSemanticAssignment(
            value="office",
            provenance="fallback:hearing_or_review_office_step",
        )
    if "汇报" in compact and any(
        marker in compact for marker in ("工作小组", "筹备工作小组", "委员会", "评议小组")
    ):
        return RegulationSemanticAssignment(
            value="office",
            provenance="fallback:committee_reporting_step",
        )
    if "考试工作人员" in compact:
        return RegulationSemanticAssignment(
            value="office",
            provenance="keyword:hearing_or_exam_staff",
        )
    if any(marker in compact for marker in ("党委学生工作部", "学生处")) and any(
        marker in compact for marker in ("评审小组", "联合评审", "现场答辩")
    ):
        return RegulationSemanticAssignment(
            value="student_affairs_office",
            provenance="keyword:学生处",
        )
    if any(marker in compact for marker in ("出具退学决定书", "公告即视为送达", "送交本人")):
        return RegulationSemanticAssignment(
            value="office",
            provenance="fallback:dismissal_notice_delivery",
        )
    if any(marker in compact for marker in ("公布", "公示", "发布")) and any(
        marker in compact for marker in ("结果", "名单", "结论", "决定")
    ):
        return RegulationSemanticAssignment(
            value="office",
            provenance="fallback:publish_notice",
        )
    actor_assignment = _resolve_procedure_actor_by_action_context(
        compact,
        REGULATION_PROCEDURE_ACTOR_RULES,
    )
    if actor_assignment.value:
        return actor_assignment
    actor_assignment = _resolve_generic_office_actor_by_action_context(compact)
    if actor_assignment.value:
        return actor_assignment
    actor_assignment = _resolve_keyword_rule(compact, REGULATION_PROCEDURE_ACTOR_RULES)
    if actor_assignment.value:
        return actor_assignment
    if any(marker in compact for marker in ("提交", "递交", "报送", "上报", "填写")) and any(
        marker in compact
        for marker in (
            *REGULATION_PROCEDURE_ACTION_MATERIAL_MARKERS,
            "申请书",
            "申报表",
        )
    ):
        return RegulationSemanticAssignment(
            value="applicant",
            provenance="fallback:imperative_material_step",
        )
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
