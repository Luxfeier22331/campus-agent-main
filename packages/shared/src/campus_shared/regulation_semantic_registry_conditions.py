from __future__ import annotations

from collections.abc import Sequence

from .regulation_semantic_registry_answer_rules import (
    REGULATION_EXCLUSION_SUBJECT_RULES,
    REGULATION_GENERIC_POLICY_TABLE_SUBJECT_RULES,
)
from .regulation_semantic_registry_base import (
    canonical_regulation_condition_subject,
    resolve_regulation_action_type,
    resolve_regulation_section_subject_hint,
)
from .regulation_semantic_registry_condition_rules import REGULATION_GROUPED_ANSWER_ROLES
from .regulation_semantic_registry_intro import resolve_regulation_intro_subject
from .regulation_semantic_registry_predicates import (
    _compact,
    _condition_subject_supports_answer_role,
    _resolve_condition_subject_keyword_rule,
    _resolve_intro_target_role_subject,
    _resolve_keyword_rule,
)
from .regulation_semantic_registry_types import RegulationSemanticAssignment


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
    if explicit and _condition_subject_supports_answer_role(explicit, answer_role):
        return RegulationSemanticAssignment(
            value=explicit,
            provenance="metadata:condition_subject",
        )
    explicit_intro_subject = canonical_regulation_condition_subject(
        introduced_condition_subject.strip()
    )
    if explicit_intro_subject and (
        answer_role == "eligibility_intro"
        or _condition_subject_supports_answer_role(explicit_intro_subject, answer_role)
    ):
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
                value="generic_condition",
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
                if explicit_group_subject
                and _condition_subject_supports_answer_role(explicit_group_subject, answer_role)
                and explicit_group_subject != "generic_condition"
                and answer_role != "example_evidence"
                else "generic_restriction"
            ),
            provenance=(
                "metadata:condition_group_subject"
                if explicit_group_subject
                and _condition_subject_supports_answer_role(explicit_group_subject, answer_role)
                and explicit_group_subject != "generic_condition"
                and answer_role != "example_evidence"
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
                if explicit_group_subject
                and answer_role != "example_evidence"
                and _condition_subject_supports_answer_role(explicit_group_subject, answer_role)
                else "generic_condition"
            ),
            provenance=(
                "metadata:condition_group_subject"
                if explicit_group_subject
                and answer_role != "example_evidence"
                and _condition_subject_supports_answer_role(explicit_group_subject, answer_role)
                else "answer_role:generic_condition"
            ),
        )
    if (
        explicit_group_subject
        and answer_role != "example_evidence"
        and _condition_subject_supports_answer_role(explicit_group_subject, answer_role)
    ):
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
        inherited_condition_subject="",
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
    inherited_condition_subject: str = "",
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
    if explicit_group_subject and _condition_subject_supports_answer_role(
        explicit_group_subject, answer_role
    ):
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
            inherited_condition_subject=inherited_condition_subject,
        )
    return resolve_regulation_condition_subject(
        text=text,
        answer_role=answer_role,
        explicit_condition_subject=inherited_condition_subject,
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
