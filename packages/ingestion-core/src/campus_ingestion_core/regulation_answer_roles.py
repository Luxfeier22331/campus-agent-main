from __future__ import annotations

from collections.abc import Mapping

from campus_shared.regulation_semantic_registry import (
    resolve_regulation_answer_role,
)

from campus_ingestion_core.regulation_semantics import compact_semantic_text
from campus_ingestion_core.regulation_semantics import (
    infer_table_fact_type as infer_table_fact_type_from_registry,
)
from campus_ingestion_core.regulation_semantics import (
    starts_example_list as starts_example_list_from_registry,
)
from campus_ingestion_core.regulation_semantics import (
    starts_procedure_list as starts_procedure_list_from_registry,
)

_PROCEDURE_STEP_HINT_OVERRIDE_ROLES = frozenset(
    {
        "eligibility_intro",
        "eligibility_condition",
        "exception_rule",
        "exclusion_rule",
        "material_requirement",
        "supporting_detail",
        "time_constraint",
    }
)
_ELIGIBILITY_CONDITION_HINT_OVERRIDE_ROLES = frozenset(
    {
        "exception_rule",
        "exclusion_rule",
        "example_evidence",
        "material_requirement",
        "supporting_detail",
        "time_constraint",
    }
)
_EXAMPLE_EVIDENCE_HINT_OVERRIDE_ROLES = frozenset(
    {
        "exception_rule",
        "eligibility_condition",
        "exclusion_rule",
    }
)


def build_answer_role_metadata(
    *,
    text: str,
    prefix_text: str = "",
    role_hint: str | None = None,
) -> dict[str, object]:
    decision = decide_answer_role(text=text, prefix_text=prefix_text, role_hint=role_hint)
    if decision["answer_role"] == "material_requirement":
        return {
            **decision,
            "content_role": "requirement",
            "semantic_role": "condition",
            "claim_type": "condition",
            "is_answer_bearing": True,
        }
    if decision["answer_role"] == "time_constraint":
        return {
            **decision,
            "content_role": "deadline",
            "semantic_role": "time_constraint",
            "claim_type": "time_constraint",
            "is_answer_bearing": True,
        }
    if decision["answer_role"] == "procedure_step":
        return {
            **decision,
            "content_role": "procedure",
            "semantic_role": "procedure_step",
            "claim_type": "procedure",
            "is_answer_bearing": True,
        }
    if decision["answer_role"] == "example_evidence":
        return {
            **decision,
            "content_role": "eligibility",
            "semantic_role": "example",
            "claim_type": "condition",
            "is_answer_bearing": True,
        }
    if decision["answer_role"] == "exclusion_rule":
        return {
            **decision,
            "content_role": "eligibility",
            "semantic_role": "exclusion",
            "claim_type": "cannot_do",
            "polarity": "negative",
            "is_answer_bearing": True,
        }
    if decision["answer_role"] == "exception_rule":
        return {
            **decision,
            "content_role": "eligibility",
            "semantic_role": "exception",
            "claim_type": "condition",
            "is_answer_bearing": True,
        }
    if decision["answer_role"] == "eligibility_intro":
        return {
            **decision,
            "content_role": "eligibility",
            "semantic_role": "intro",
            "claim_type": "condition",
            "is_answer_bearing": False,
        }
    if decision["answer_role"] == "eligibility_condition":
        return {
            **decision,
            "content_role": "eligibility",
            "semantic_role": "condition",
            "claim_type": "condition",
            "is_answer_bearing": True,
        }
    return {**decision, "is_answer_bearing": False}


def decide_answer_role(
    *,
    text: str,
    prefix_text: str = "",
    role_hint: str | None = None,
) -> dict[str, object]:
    assignment = _resolve_answer_role_assignment(
        text=text,
        prefix_text=prefix_text,
        role_hint=role_hint,
    )
    if (
        assignment.provenance.startswith("explicit_role_hint:")
        or assignment.value
        in {
            "procedure_step",
            "exclusion_rule",
            "example_evidence",
            "exception_rule",
        }
        or assignment.provenance
        in {
            "procedure_intro_or_category_heading",
            "material_intro_or_category_heading",
            "time_intro_or_category_heading",
            "matched_material_intro_marker",
            "matched_time_intro_marker",
            "matched_procedure_marker",
            "matched_exception_marker",
        }
    ):
        confidence = "high"
    elif assignment.value == "supporting_detail":
        confidence = "low"
    else:
        confidence = "medium"
    return _role(assignment.value, confidence, assignment.provenance)


def _resolve_answer_role_assignment(
    *,
    text: str,
    prefix_text: str,
    role_hint: str | None,
):
    hinted_assignment = resolve_regulation_answer_role(
        text=text,
        prefix_text=prefix_text,
        role_hint=role_hint,
    )
    if role_hint is None:
        return hinted_assignment

    if not hinted_assignment.provenance.startswith("explicit_role_hint:"):
        return hinted_assignment

    parsed_assignment = resolve_regulation_answer_role(
        text=text,
        prefix_text=prefix_text,
        role_hint=None,
    )
    if (
        role_hint == "procedure_step"
        and parsed_assignment.value in _PROCEDURE_STEP_HINT_OVERRIDE_ROLES
    ):
        return parsed_assignment
    if (
        role_hint == "eligibility_condition"
        and parsed_assignment.value in _ELIGIBILITY_CONDITION_HINT_OVERRIDE_ROLES
    ):
        return parsed_assignment
    if (
        role_hint == "example_evidence"
        and parsed_assignment.value in _EXAMPLE_EVIDENCE_HINT_OVERRIDE_ROLES
    ):
        return parsed_assignment
    return hinted_assignment


def build_table_answer_role_metadata(
    *,
    text: str,
    metadata: Mapping[str, object],
) -> dict[str, object]:
    fact_type = infer_table_fact_type(text=text, metadata=metadata)
    return {
        "answer_role": "table_fact",
        "content_role": "table_fact",
        "semantic_role": "table_fact",
        "claim_type": fact_type,
        "table_fact_type": fact_type,
        "role_confidence": "high" if fact_type != "generic_policy_table" else "medium",
        "role_reason": f"table_fact_type:{fact_type}",
        "is_answer_bearing": True,
    }


def infer_table_fact_type(*, text: str, metadata: Mapping[str, object]) -> str:
    return infer_table_fact_type_from_registry(text=text, metadata=metadata)


def is_answer_role_atomic(answer_role: str) -> bool:
    return answer_role in {
        "example_evidence",
        "exception_rule",
        "exclusion_rule",
        "procedure_step",
        "eligibility_condition",
        "material_requirement",
        "time_constraint",
    }


def starts_example_list(text: str) -> bool:
    return starts_example_list_from_registry(text)


def starts_procedure_list(text: str) -> bool:
    return starts_procedure_list_from_registry(text)


def compact_for_role(value: str) -> str:
    return compact_semantic_text(value)


def _role(answer_role: str, confidence: str, reason: str) -> dict[str, object]:
    return {"answer_role": answer_role, "role_confidence": confidence, "role_reason": reason}


__all__ = [
    "build_answer_role_metadata",
    "build_table_answer_role_metadata",
    "compact_for_role",
    "decide_answer_role",
    "infer_table_fact_type",
    "is_answer_role_atomic",
    "starts_example_list",
    "starts_procedure_list",
]
