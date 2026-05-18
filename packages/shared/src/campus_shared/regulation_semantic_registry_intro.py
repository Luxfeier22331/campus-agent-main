from __future__ import annotations

from collections.abc import Sequence

from .regulation_semantic_registry_answer_rules import (
    REGULATION_INTRO_SCOPE_TARGET_ROLE_RULES,
)
from .regulation_semantic_registry_base import canonical_regulation_condition_subject
from .regulation_semantic_registry_predicates import (
    _compact,
    _resolve_intro_target_role_subject,
)
from .regulation_semantic_registry_types import RegulationSemanticAssignment


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
    if compact.endswith(
        (
            "程序",
            "程序如下",
            "按如下程序执行",
            "按以下程序执行",
            "按下列程序执行",
            "按如下程序办理",
            "按以下程序办理",
            "按下列程序办理",
            "按照如下程序进行",
            "按照以下程序进行",
            "按照下列程序进行",
            "按照如下程序执行",
            "按照以下程序执行",
            "按照下列程序执行",
            "按照以下程序组织进行",
            "按照下列程序组织进行",
            "按以下程序进行评选",
            "按下列程序进行评选",
        )
    ):
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
            "符合以下条件",
            "符合下列条件",
            "具备下列条件之一",
            "具备以下条件之一",
            "具备以下条件",
            "具备下列条件",
            "具有下列条件之一",
            "具有以下条件之一",
            "具有以下条件",
            "具有下列条件",
            "还须具备以下条件之一",
            "还须具备以下条件",
            "还应符合下列条件之一",
            "还应符合以下条件之一",
            "还应符合以下条件",
            "还应符合下列条件",
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
            "有下列情形",
            "有以下情形",
            "出现下列情形之一",
            "出现以下情形之一",
            "出现下列情形",
            "出现以下情形",
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
    if resolve_regulation_group_intro_kind(text).value == "condition_group_intro":
        return RegulationSemanticAssignment(
            value="eligibility_group",
            provenance="text:condition_group_intro",
        )
    return RegulationSemanticAssignment(
        value="eligibility_group",
        provenance="text:eligibility_group_default",
    )


def resolve_regulation_intro_subject(
    *,
    intro_target_roles: Sequence[str] = (),
    inherited_condition_subject: str = "",
) -> RegulationSemanticAssignment:
    target_role_set = {item.strip() for item in intro_target_roles if item.strip()}
    inherited_subject = canonical_regulation_condition_subject(inherited_condition_subject.strip())
    if (
        inherited_subject
        and inherited_subject != "generic_condition"
        and target_role_set.issubset({"eligibility_condition", "exception_rule"})
    ):
        return RegulationSemanticAssignment(
            value=inherited_subject,
            provenance="inherited:condition_subject",
        )
    target_subject_assignment = (
        _resolve_intro_target_role_subject(target_role_set)
        if len(target_role_set) == 1
        else RegulationSemanticAssignment(value="", provenance="")
    )
    if target_subject_assignment.value:
        return target_subject_assignment
    if inherited_subject:
        return RegulationSemanticAssignment(
            value=inherited_subject,
            provenance="inherited:condition_subject",
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
