from __future__ import annotations

import re

from campus_ingestion_core.regulation_answer_roles import (
    compact_for_role,
    decide_answer_role,
    starts_example_list,
)

from .regulation_chunking_shared import (
    _INLINE_EXAMPLE_TAIL_RE,
    _RegulationListBlock,
    _strip_section_label,
)


def _forced_role_metadata(*, answer_role: str, reason: str) -> dict[str, object]:
    if answer_role == "procedure_step":
        return {
            "answer_role": "procedure_step",
            "role_confidence": "high",
            "role_reason": reason,
            "content_role": "procedure",
            "semantic_role": "procedure_step",
            "claim_type": "procedure",
            "is_answer_bearing": True,
        }
    return {
        "answer_role": answer_role,
        "role_confidence": "high",
        "role_reason": reason,
    }


def _answer_role(
    *,
    text: str,
    prefix_text: str,
    role_hint: str | None,
) -> str:
    hinted_role = str(
        decide_answer_role(text=text, prefix_text=prefix_text, role_hint=role_hint)["answer_role"]
    )
    if role_hint is None:
        return hinted_role
    parsed_role = str(
        decide_answer_role(text=text, prefix_text=prefix_text, role_hint=None)["answer_role"]
    )
    if role_hint == "procedure_step" and parsed_role in {
        "eligibility_intro",
        "eligibility_condition",
        "exception_rule",
        "exclusion_rule",
        "material_requirement",
        "supporting_detail",
    }:
        return parsed_role
    if role_hint == "eligibility_condition" and parsed_role in {
        "exception_rule",
        "exclusion_rule",
        "example_evidence",
        "material_requirement",
        "supporting_detail",
        "time_constraint",
    }:
        return parsed_role
    if role_hint == "example_evidence" and parsed_role in {
        "exception_rule",
        "eligibility_condition",
        "exclusion_rule",
    }:
        return parsed_role
    return hinted_role


def _inherited_scope_role(*, prefix_text: str) -> str | None:
    if not prefix_text.strip():
        return None
    scope_role = _answer_role(text=prefix_text, prefix_text="", role_hint=None)
    if scope_role in {
        "eligibility_condition",
        "exception_rule",
        "exclusion_rule",
        "procedure_step",
        "material_requirement",
        "time_constraint",
    }:
        return scope_role
    return None


def _is_terminal_supporting_detail(*, text: str) -> bool:
    compact = compact_for_role(text)
    return any(
        marker in compact
        for marker in (
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
    )


def _starts_example_list(text: str) -> bool:
    return starts_example_list(text)


def _is_numeric_list_label(label: str) -> bool:
    return bool(re.match(r"^\s*(?:\d+[.．、]|[（(]\d+[)）])\s*$", label or ""))


def _single_item_context_prefix(
    *,
    block: _RegulationListBlock,
    section_path: tuple[str, ...],
) -> str:
    if not block.label.strip():
        return ""
    if not section_path:
        return ""
    for raw_part in reversed(section_path):
        part = _strip_section_label(raw_part)
        if any(marker in part for marker in ("程序", "流程", "步骤", "办理")):
            return part
    return ""


def _atomic_item_should_reparse(*, role: str, text: str, prefix_text: str) -> bool:
    if role != "procedure_step":
        return False
    reparsed_role = _answer_role(text=text, prefix_text=prefix_text, role_hint=None)
    if reparsed_role == "procedure_step":
        return False
    if reparsed_role in {
        "eligibility_condition",
        "eligibility_intro",
        "exception_rule",
        "exclusion_rule",
        "material_requirement",
    }:
        return True
    compact = compact_for_role(text)
    if reparsed_role == "supporting_detail" and any(
        marker in compact
        for marker in (
            "复查决定",
            "提出建议",
            "决定书",
            "送交",
            "公告即视为送达",
            "现场答辩",
            "联合评审",
            "签字确认",
            "签署姓名",
            "听证",
            "质证",
        )
    ):
        return False
    return reparsed_role == "supporting_detail"


def _intro_role_hint(text: str) -> str | None:
    answer_role = _answer_role(text=text, prefix_text="", role_hint=None)
    if answer_role in {
        "procedure_step",
        "exclusion_rule",
        "exception_rule",
        "material_requirement",
        "time_constraint",
    }:
        return answer_role
    return "intro"


def _inline_example_head_role(*, text: str, prefix_text: str) -> str | None:
    match = _INLINE_EXAMPLE_TAIL_RE.search(text)
    if match is None:
        return None
    head_text = text[: match.start("tail")].rstrip("，,；;、 ")
    if not head_text:
        return None
    head_role = _answer_role(text=head_text, prefix_text=prefix_text, role_hint=None)
    if head_role in {"eligibility_condition", "exception_rule"}:
        return head_role
    return None
