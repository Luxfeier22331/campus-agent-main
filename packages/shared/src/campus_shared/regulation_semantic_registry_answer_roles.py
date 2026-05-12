from __future__ import annotations

from .regulation_semantic_registry_answer_rules import (
    REGULATION_ANSWER_ROLE_ELIGIBILITY_MARKERS,
    REGULATION_ANSWER_ROLE_EXAMPLE_LIST_MARKERS,
    REGULATION_ANSWER_ROLE_EXCEPTION_MARKERS,
    REGULATION_ANSWER_ROLE_EXCLUSION_MARKERS,
    REGULATION_ANSWER_ROLE_TERMINAL_PROVISION_MARKERS,
)
from .regulation_semantic_registry_intro import resolve_regulation_group_intro_kind
from .regulation_semantic_registry_predicates import (
    _compact,
    _has_required_procedure_action_marker,
    _is_example_evidence_answer_role,
    _is_procedure_step_answer_role,
    _looks_like_explicit_applicability_clause,
    _looks_like_implicit_exclusion_clause,
    _looks_like_large_guideline_manifesto,
    _looks_like_material_intro_or_category,
    _looks_like_material_requirement_item,
    _looks_like_non_action_assessment_heading,
    _looks_like_procedure_intro_or_category,
    _looks_like_time_intro_or_category,
)
from .regulation_semantic_registry_procedure_rules import (
    REGULATION_NON_PROCEDURE_REVIEW_STATUS_MARKERS,
)
from .regulation_semantic_registry_types import RegulationSemanticAssignment


def resolve_regulation_answer_role(
    *,
    text: str,
    prefix_text: str = "",
    role_hint: str | None = None,
) -> RegulationSemanticAssignment:
    text_only = _compact(text)
    context = _compact(" ".join(part for part in (prefix_text, text) if part))
    if _looks_like_large_guideline_manifesto(text):
        return RegulationSemanticAssignment(
            value="supporting_detail",
            provenance="no_answer_ready_marker",
        )
    if _looks_like_explicit_applicability_clause(text_only):
        return RegulationSemanticAssignment(
            value="eligibility_condition",
            provenance="matched_applicability_marker",
        )
    if any(marker in text_only for marker in REGULATION_ANSWER_ROLE_TERMINAL_PROVISION_MARKERS):
        return RegulationSemanticAssignment(
            value="supporting_detail",
            provenance="terminal_provision",
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
    if role_hint:
        if role_hint == "procedure_step" and _looks_like_material_requirement_item(text):
            return RegulationSemanticAssignment(
                value="material_requirement",
                provenance="material_item_not_procedure_override",
            )
        if role_hint == "procedure_step" and _looks_like_non_action_assessment_heading(text):
            return RegulationSemanticAssignment(
                value="supporting_detail",
                provenance="non_action_assessment_heading",
            )
        if role_hint == "procedure_step" and _looks_like_procedure_intro_or_category(text):
            return RegulationSemanticAssignment(
                value="eligibility_intro",
                provenance="procedure_intro_or_category_heading",
            )
        if (
            role_hint == "procedure_step"
            and any(
                marker in text_only for marker in REGULATION_NON_PROCEDURE_REVIEW_STATUS_MARKERS
            )
            and not _has_required_procedure_action_marker(text_only)
        ):
            if any(marker in context for marker in REGULATION_ANSWER_ROLE_ELIGIBILITY_MARKERS):
                return RegulationSemanticAssignment(
                    value="eligibility_condition",
                    provenance="review_status_not_procedure_override",
                )
            return RegulationSemanticAssignment(
                value="supporting_detail",
                provenance="review_status_not_procedure_override",
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

    if any(marker in text_only for marker in REGULATION_ANSWER_ROLE_EXCLUSION_MARKERS):
        return RegulationSemanticAssignment(
            value="exclusion_rule",
            provenance="matched_exclusion_marker",
        )
    if _looks_like_material_requirement_item(text):
        return RegulationSemanticAssignment(
            value="material_requirement",
            provenance="matched_material_requirement_item",
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
    if _looks_like_implicit_exclusion_clause(text_only):
        return RegulationSemanticAssignment(
            value="exclusion_rule",
            provenance="matched_implicit_exclusion_marker",
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
