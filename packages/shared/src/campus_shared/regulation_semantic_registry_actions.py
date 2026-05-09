from __future__ import annotations

from .regulation_semantic_registry_answer_rules import REGULATION_PROCEDURE_MATERIAL_MARKERS
from .regulation_semantic_registry_base import canonical_regulation_procedure_action
from .regulation_semantic_registry_predicates import (
    _compact,
    _looks_like_disbursement_step,
    _looks_like_material_requirement_item,
    _resolve_keyword_rule,
    _starts_procedure_list,
)
from .regulation_semantic_registry_procedure_rules import (
    REGULATION_NON_PROCEDURE_REVIEW_STATUS_MARKERS,
    REGULATION_PROCEDURE_ACTION_MATERIAL_MARKERS,
    REGULATION_PROCEDURE_ACTION_RULES,
    REGULATION_PROCEDURE_MATERIAL_STRONG_CONTEXT_MARKERS,
    REGULATION_PROCEDURE_PROCESS_CONTEXT_MARKERS,
    REGULATION_PROCEDURE_PROCESS_DECISION_EXCLUSIONS,
    REGULATION_PROCEDURE_STEP_REQUIRED_ACTION_MARKERS,
)
from .regulation_semantic_registry_types import (
    RegulationSemanticAssignment,
    RegulationSemanticKeywordRule,
)


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

    from .regulation_semantic_registry_intro import resolve_regulation_group_intro_kind

    if resolve_regulation_group_intro_kind(text).value in {
        "condition_group_intro",
        "exclusion_group_intro",
    }:
        return RegulationSemanticAssignment(value="", provenance="")

    compact = _compact(text)
    if any(
        marker in compact for marker in REGULATION_NON_PROCEDURE_REVIEW_STATUS_MARKERS
    ) and not any(
        marker in compact for marker in REGULATION_PROCEDURE_STEP_REQUIRED_ACTION_MARKERS
    ):
        return RegulationSemanticAssignment(value="", provenance="")
    if any(marker in compact for marker in ("告知申请人", "说明理由")):
        return RegulationSemanticAssignment(
            value="process",
            provenance="keyword:告知说明理由",
        )
    if any(
        marker in compact for marker in ("提供信息", "代收代缴", "收取实际发生的")
    ) and actor in {
        "office",
        "academic_affairs_office",
        "student_affairs_office",
    }:
        return RegulationSemanticAssignment(
            value="process",
            provenance="keyword:提供信息收费办理",
        )
    if any(marker in compact for marker in ("公布", "公示", "发布")) and any(
        marker in compact for marker in ("结果", "名单", "结论", "决定")
    ):
        return RegulationSemanticAssignment(
            value="publish_notice",
            provenance="keyword:公布公示结果",
        )
    if any(marker in compact for marker in ("出具退学决定书", "公告即视为送达", "送交本人")):
        return RegulationSemanticAssignment(
            value="publish_notice",
            provenance="keyword:决定书送达公告",
        )
    if any(marker in compact for marker in ("签字确认", "签署姓名")):
        if actor == "student":
            return RegulationSemanticAssignment(
                value="submit_materials",
                provenance="keyword:签字确认签署姓名",
            )
        return RegulationSemanticAssignment(
            value="process",
            provenance="keyword:签字确认签署姓名+actor:office",
        )
    if (
        any(marker in compact for marker in ("处分或者处理的依据、建议", "处分建议"))
        and "提出" in compact
    ):
        return RegulationSemanticAssignment(
            value="appeal",
            provenance="keyword:听证调查处分建议",
        )
    if any(marker in compact for marker in ("现场答辩", "联合评审")):
        if actor in {"student_affairs_office", "academic_affairs_office", "office"}:
            return RegulationSemanticAssignment(
                value="office_review",
                provenance=f"keyword:现场答辩联合评审+actor:{actor}",
            )
        return RegulationSemanticAssignment(
            value="review",
            provenance="keyword:现场答辩联合评审",
        )
    if _looks_like_material_requirement_item(text) and (
        actor in {"applicant", "student"}
        or any(marker in compact for marker in ("申请人", "学生本人", "学生"))
    ):
        return RegulationSemanticAssignment(
            value="submit_materials",
            provenance="keyword:material_list_item",
        )
    if _starts_procedure_list(text) and any(
        marker in compact for marker in ("进行", "调解", "办理", "执行")
    ):
        return RegulationSemanticAssignment(
            value="process",
            provenance="keyword:procedure_intro_process",
        )
    if "个人申请" in compact or "本人申请" in compact:
        return RegulationSemanticAssignment(
            value="apply",
            provenance="keyword:个人申请",
        )
    if actor in {"office", "student_affairs_office", "academic_affairs_office"} and any(
        marker in compact for marker in ("调解委员会调解", "申请调解", "进行调解", "调解不成")
    ):
        return RegulationSemanticAssignment(
            value="process",
            provenance="keyword:调解处理流程",
        )
    if _looks_like_disbursement_step(compact):
        return RegulationSemanticAssignment(
            value="disburse",
            provenance="keyword:发放拨付+positive_step",
        )
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
    if any(marker in compact for marker in ("报党委审定", "党委审定", "全体会议审议", "初审意见")):
        if actor in {"academic_affairs_office", "student_affairs_office", "office"}:
            return RegulationSemanticAssignment(
                value="office_review",
                provenance=f"keyword:委员会党委审议+actor:{actor}",
            )
        return RegulationSemanticAssignment(
            value="review",
            provenance="keyword:委员会党委审议",
        )

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
    if any(
        marker in compact for marker in ("综合考评", "考评", "研究决定", "考核", "排序", "面试")
    ):
        if actor == "college":
            return RegulationSemanticAssignment(
                value="college_review",
                provenance="keyword:审核审批+actor:college",
            )
        if actor in {"academic_affairs_office", "student_affairs_office", "office"}:
            return RegulationSemanticAssignment(
                value="office_review",
                provenance=f"keyword:审核审批+actor:{actor}",
            )
        return RegulationSemanticAssignment(
            value="review",
            provenance="keyword:审核审批",
        )

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

    if "递交" in compact and any(
        marker in compact for marker in ("申请材料", "材料", "申请表", "申请书", "申报表")
    ):
        return RegulationSemanticAssignment(
            value="submit_materials",
            provenance="keyword:递交材料",
        )
    if (
        any(marker in compact for marker in ("提供", "提交", "上交", "递交"))
        and any(marker in compact for marker in REGULATION_PROCEDURE_ACTION_MATERIAL_MARKERS)
        and any(
            marker in compact for marker in REGULATION_PROCEDURE_MATERIAL_STRONG_CONTEXT_MARKERS
        )
    ):
        return RegulationSemanticAssignment(
            value="submit_materials",
            provenance="keyword:提交+材料",
        )
    if (
        "提交" in compact
        and "申请" in compact
        and any(
            marker in compact for marker in REGULATION_PROCEDURE_MATERIAL_STRONG_CONTEXT_MARKERS
        )
    ):
        return RegulationSemanticAssignment(value="apply", provenance="keyword:提交+申请")
    if "提出" in compact and "申请" in compact:
        return RegulationSemanticAssignment(value="apply", provenance="keyword:提出+申请")
    if any(marker in compact for marker in ("综合考评", "考评", "研究决定")):
        review_actor = actor
        if review_actor == "college":
            return RegulationSemanticAssignment(
                value="college_review",
                provenance="keyword:审核审批+actor:college",
            )
        if review_actor in {"academic_affairs_office", "student_affairs_office", "office"}:
            return RegulationSemanticAssignment(
                value="office_review",
                provenance=f"keyword:审核审批+actor:{review_actor}",
            )
        return RegulationSemanticAssignment(
            value="review",
            provenance="keyword:审核审批",
        )
    if any(marker in compact for marker in ("填写", "上报")) and any(
        marker in compact
        for marker in (
            *REGULATION_PROCEDURE_ACTION_MATERIAL_MARKERS,
            "申请书",
            "申报表",
        )
    ):
        return RegulationSemanticAssignment(
            value="submit_materials",
            provenance="keyword:填写上报材料",
        )

    action_assignment = _resolve_keyword_rule(compact, REGULATION_PROCEDURE_ACTION_RULES)
    if action_assignment.value == "apply" and not any(
        marker in compact
        for marker in (
            "提出申请",
            "申报",
            "定密申请",
            "申诉申请",
            "补办申请",
            "挂失申请",
        )
    ):
        return RegulationSemanticAssignment(value="", provenance="")
    if action_assignment.value:
        if action_assignment.value == "review":
            if actor == "college":
                return RegulationSemanticAssignment(
                    value="college_review",
                    provenance="keyword:审定核准签署意见+actor:college",
                )
            if actor in {"academic_affairs_office", "student_affairs_office", "office"}:
                return RegulationSemanticAssignment(
                    value="office_review",
                    provenance=f"{action_assignment.provenance}+actor:{actor}",
                )
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
