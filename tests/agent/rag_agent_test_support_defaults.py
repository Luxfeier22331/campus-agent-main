from __future__ import annotations


def default_condition_subject_for_source(
    *,
    content_role: str,
    semantic_role: str,
    answer_role: str,
    action_type: str,
) -> str:
    if action_type == "lift_discipline":
        if answer_role == "exclusion_rule":
            return "discipline_relief_exclusion"
        if answer_role == "procedure_step":
            return "application_procedure"
        return "discipline_relief_condition"
    if action_type == "reissue":
        return "student_card_or_identity_credential"
    if answer_role == "material_requirement":
        return "material_requirement"
    if answer_role == "time_constraint":
        return "deadline"
    if answer_role == "table_fact":
        return "amount_or_quota"
    if semantic_role == "example_evidence" or answer_role == "example_evidence":
        return "example_evidence"
    if content_role == "procedure" or answer_role == "procedure_step":
        return "application_procedure"
    return "generic_condition"


def default_procedure_action_for_source(*, action_type: str) -> str:
    if action_type == "reissue":
        return "reissue"
    if action_type == "lift_discipline":
        return "apply"
    return "process"
