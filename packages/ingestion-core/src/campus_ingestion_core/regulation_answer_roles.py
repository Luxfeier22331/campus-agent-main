from __future__ import annotations

from collections.abc import Mapping

from campus_ingestion_core.regulation_semantics import (
    compact_semantic_text,
    load_default_regulation_semantics_registry,
)
from campus_ingestion_core.regulation_semantics import (
    infer_table_fact_type as infer_table_fact_type_from_registry,
)
from campus_ingestion_core.regulation_semantics import (
    starts_example_list as starts_example_list_from_registry,
)
from campus_ingestion_core.regulation_semantics import (
    starts_procedure_list as starts_procedure_list_from_registry,
)


def build_answer_role_metadata(
    *,
    text: str,
    prefix_text: str = "",
    role_hint: str | None = None,
) -> dict[str, object]:
    decision = decide_answer_role(text=text, prefix_text=prefix_text, role_hint=role_hint)
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
    registry = load_default_regulation_semantics_registry()
    if role_hint:
        if role_hint == "procedure_step" and _looks_like_procedure_intro_or_category(text):
            return _role("eligibility_intro", "medium", "procedure_intro_or_category_heading")
        if role_hint == "supporting_detail":
            return _role("supporting_detail", "low", "no_answer_ready_marker")
        answer_role = role_hint if role_hint != "intro" else "eligibility_intro"
        return {
            "answer_role": answer_role,
            "role_confidence": "high",
            "role_reason": f"explicit_role_hint:{role_hint}",
        }
    context = compact_semantic_text(" ".join(part for part in (prefix_text, text) if part))
    text_only = compact_semantic_text(text)
    if any(marker in text_only for marker in registry.terminal_provision_markers):
        return _role("supporting_detail", "low", "terminal_provision")
    if any(marker in text_only for marker in registry.exclusion_markers):
        return _role("exclusion_rule", "high", "matched_exclusion_marker")
    if _is_procedure_step(text=text_only, context=context):
        return _role("procedure_step", "high", "matched_procedure_marker")
    if _is_example_evidence(text_only):
        return _role("example_evidence", "high", "matched_example_evidence_marker")
    if any(marker in text_only for marker in registry.exception_markers) or (
        "超出" in text_only and "但" in text_only
    ):
        return _role("exception_rule", "high", "matched_exception_marker")
    if any(marker in context for marker in registry.eligibility_markers):
        if (
            any(marker in text_only for marker in registry.example_list_markers)
            and "条件" not in text_only
        ):
            return _role("eligibility_intro", "medium", "matched_example_intro_marker")
        return _role("eligibility_condition", "medium", "matched_eligibility_marker")
    return _role("supporting_detail", "low", "no_answer_ready_marker")


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
    }


def starts_example_list(text: str) -> bool:
    return starts_example_list_from_registry(text)


def starts_procedure_list(text: str) -> bool:
    return starts_procedure_list_from_registry(text)


def compact_for_role(value: str) -> str:
    return compact_semantic_text(value)


def _role(answer_role: str, confidence: str, reason: str) -> dict[str, object]:
    return {"answer_role": answer_role, "role_confidence": confidence, "role_reason": reason}


def _is_procedure_step(*, text: str, context: str) -> bool:
    registry = load_default_regulation_semantics_registry()
    if _looks_like_procedure_intro_or_category(text):
        return False
    if starts_procedure_list(text) or starts_procedure_list(context):
        return True
    if any(marker in text for marker in registry.procedure_action_markers):
        return True
    return any(marker in context for marker in registry.procedure_context_markers) and any(
        marker in text for marker in registry.procedure_contextual_action_markers
    )


def _is_example_evidence(text: str) -> bool:
    return "取得显著成绩" in text and any(
        marker in text for marker in ("学术研究", "发表", "专利", "竞赛", "文艺比赛", "体育竞赛")
    )


def _looks_like_procedure_intro_or_category(text: str) -> bool:
    if not text:
        return False
    stripped = text.strip()
    compact = compact_semantic_text(stripped)
    if stripped.endswith(("程序", "程序:", "程序：", "类别", "类别:", "类别：")):
        return True
    if compact.endswith(("程序", "类别")) and len(compact) <= 24:
        return True
    if compact.startswith(("免试生类别", "材料报送情况")):
        return True
    return False


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
