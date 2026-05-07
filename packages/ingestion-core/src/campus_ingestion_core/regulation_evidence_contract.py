from __future__ import annotations

import re

from campus_shared.answer_ready_evidence_contract import (
    ANSWER_READY_CATEGORY_REGISTRY_VERSION,
    ANSWER_READY_CONDITION_SUBJECT_TAXONOMY_VERSION,
    ANSWER_READY_EVIDENCE_CONTRACT_VERSION,
    ANSWER_READY_GROUPED_ANSWER_ROLES,
    ANSWER_READY_PROCEDURE_ACTION_TAXONOMY_VERSION,
)
from campus_shared.regulation_semantic_registry import (
    resolve_regulation_condition_subject,
    resolve_regulation_procedure_action,
)


def build_answer_ready_contract_metadata(
    *,
    text: str,
    metadata: dict[str, object],
    root_unit_id: str,
) -> dict[str, object]:
    answer_role = _text(metadata.get("answer_role"))
    if not answer_role:
        return {}
    contract: dict[str, object] = {
        "evidence_contract_version": ANSWER_READY_EVIDENCE_CONTRACT_VERSION,
        "parent_unit_id": _text(metadata.get("parent_unit_id")) or root_unit_id,
    }
    clause_unit_id = infer_clause_unit_id(text=text, metadata=metadata, root_unit_id=root_unit_id)
    if clause_unit_id:
        contract["clause_unit_id"] = clause_unit_id
    condition_subject_assignment = resolve_regulation_condition_subject(
        text=text,
        answer_role=answer_role,
        explicit_condition_subject=_text(metadata.get("condition_subject")),
        intro_target_roles=_text_tuple(metadata.get("intro_target_roles")),
        table_fact_type=_text(metadata.get("table_fact_type")),
        action_type=_text(metadata.get("action_type")),
        section_path=_section_path(metadata),
    )
    if condition_subject_assignment.value:
        contract["condition_subject"] = condition_subject_assignment.value
        contract["condition_subject_taxonomy_version"] = (
            ANSWER_READY_CONDITION_SUBJECT_TAXONOMY_VERSION
        )
        contract["condition_subject_provenance"] = condition_subject_assignment.provenance
    if answer_role == "procedure_step":
        contract.update(build_procedure_step_metadata(text=text, metadata=metadata))
    condition_subject = _text(contract.get("condition_subject"))
    if condition_subject:
        condition_group_id = infer_condition_group_id(
            text=text,
            metadata={**metadata, **contract},
            root_unit_id=root_unit_id,
        )
        if condition_group_id:
            contract["condition_group_id"] = condition_group_id
    condition_polarity = infer_condition_polarity(metadata=metadata)
    if condition_polarity:
        contract["condition_polarity"] = condition_polarity
    if answer_role == "eligibility_intro":
        contract.update(
            build_eligibility_intro_metadata(
                text=text,
                metadata={**metadata, **contract},
                root_unit_id=root_unit_id,
            )
        )
    return contract


def build_category_overview_contract_metadata(
    *,
    category_id: str,
    parent_unit_id: str,
) -> dict[str, object]:
    return {
        "answer_role": "category_overview",
        "evidence_contract_version": ANSWER_READY_EVIDENCE_CONTRACT_VERSION,
        "parent_unit_id": parent_unit_id,
        "condition_polarity": "neutral",
        "condition_subject": "audience_scope",
        "condition_subject_taxonomy_version": ANSWER_READY_CONDITION_SUBJECT_TAXONOMY_VERSION,
        "condition_subject_provenance": "category_registry:audience_scope",
        "category_id": category_id,
        "category_registry_version": ANSWER_READY_CATEGORY_REGISTRY_VERSION,
    }


def infer_condition_subject(*, text: str, metadata: dict[str, object]) -> str:
    return resolve_regulation_condition_subject(
        text=text,
        answer_role=_text(metadata.get("answer_role")),
        explicit_condition_subject=_text(metadata.get("condition_subject")),
        intro_target_roles=_text_tuple(metadata.get("intro_target_roles")),
        table_fact_type=_text(metadata.get("table_fact_type")),
        action_type=_text(metadata.get("action_type")),
        section_path=_section_path(metadata),
    ).value


def infer_clause_unit_id(
    *,
    text: str,
    metadata: dict[str, object],
    root_unit_id: str,
) -> str:
    explicit = _text(metadata.get("clause_unit_id"))
    if explicit:
        return explicit
    parent_unit_id = _text(metadata.get("parent_unit_id")) or root_unit_id
    if not parent_unit_id:
        return ""
    clause_ordinal = _resolve_clause_ordinal(text=text, metadata=metadata)
    if clause_ordinal is None:
        return ""
    return f"{parent_unit_id}:{clause_ordinal}"


def infer_condition_group_id(
    *,
    text: str,
    metadata: dict[str, object],
    root_unit_id: str,
) -> str:
    explicit = _text(metadata.get("condition_group_id"))
    if explicit:
        return explicit
    answer_role = _text(metadata.get("answer_role"))
    if answer_role and answer_role not in ANSWER_READY_GROUPED_ANSWER_ROLES:
        return ""
    parent_unit_id = _text(metadata.get("parent_unit_id")) or root_unit_id
    if not parent_unit_id:
        return ""
    group_subject = _text(metadata.get("condition_group_subject"))
    if not group_subject and answer_role == "eligibility_intro":
        group_subject = _text(metadata.get("introduced_condition_subject"))
    if not group_subject:
        group_subject = infer_condition_subject(text=text, metadata=metadata)
    if not group_subject:
        return ""
    explicit_group_key = _text(metadata.get("condition_group_key"))
    if not explicit_group_key and answer_role == "eligibility_intro":
        explicit_group_key = _text(metadata.get("introduced_condition_group_key"))
    if explicit_group_key:
        return f"{parent_unit_id}:{explicit_group_key}"
    return f"{parent_unit_id}:{group_subject}"


def infer_condition_subject_provenance(
    *,
    text: str,
    metadata: dict[str, object],
    condition_subject: str,
) -> str:
    assignment = resolve_regulation_condition_subject(
        text=text,
        answer_role=_text(metadata.get("answer_role")),
        explicit_condition_subject=_text(metadata.get("condition_subject")),
        intro_target_roles=_text_tuple(metadata.get("intro_target_roles")),
        table_fact_type=_text(metadata.get("table_fact_type")),
        action_type=_text(metadata.get("action_type")),
        section_path=_section_path(metadata),
    )
    return assignment.provenance or f"resolved:{condition_subject}"


def infer_condition_polarity(*, metadata: dict[str, object]) -> str:
    explicit = _text(metadata.get("condition_polarity"))
    if explicit:
        return explicit
    answer_role = _text(metadata.get("answer_role"))
    if answer_role == "exclusion_rule":
        return "negative"
    if answer_role == "exception_rule":
        return "positive"
    polarity = _text(metadata.get("polarity"))
    if polarity:
        return polarity
    if answer_role in {
        "eligibility_condition",
        "example_evidence",
        "procedure_step",
    }:
        return "positive"
    if answer_role in {"category_overview", "policy_list", "supporting_detail"}:
        return "neutral"
    return ""


def build_procedure_step_metadata(*, text: str, metadata: dict[str, object]) -> dict[str, object]:
    compact = _compact(text)
    step_index = _procedure_step_index(metadata=metadata, text=text)
    actor = _text(metadata.get("procedure_actor")) or _procedure_actor(compact)
    action_assignment = resolve_regulation_procedure_action(
        text=text,
        actor=actor,
        explicit_action=_text(metadata.get("procedure_action")),
    )
    action = action_assignment.value
    result: dict[str, object] = {}
    if step_index is not None:
        result["procedure_step_index"] = step_index
    if actor:
        result["procedure_actor"] = actor
    if action:
        result["procedure_action"] = action
        result["procedure_action_taxonomy_version"] = ANSWER_READY_PROCEDURE_ACTION_TAXONOMY_VERSION
        result["procedure_action_provenance"] = action_assignment.provenance
    materials = _procedure_materials(compact)
    if materials:
        result["procedure_materials"] = materials
    next_actor = _procedure_next_actor(compact)
    if next_actor:
        result["procedure_next_actor"] = next_actor
    return result


def build_eligibility_intro_metadata(
    *,
    text: str,
    metadata: dict[str, object],
    root_unit_id: str,
) -> dict[str, object]:
    intro_scope = _text(metadata.get("intro_scope")) or infer_intro_scope(
        text=text,
        metadata=metadata,
    )
    introduced_condition_group_id = _text(
        metadata.get("introduced_condition_group_id")
    ) or infer_condition_group_id(text=text, metadata=metadata, root_unit_id=root_unit_id)
    target_roles = _text_tuple(metadata.get("intro_target_roles"))
    result: dict[str, object] = {}
    if intro_scope:
        result["intro_scope"] = intro_scope
    if introduced_condition_group_id:
        result["introduced_condition_group_id"] = introduced_condition_group_id
    if target_roles:
        result["intro_target_roles"] = target_roles
    return result


def _procedure_step_index(*, metadata: dict[str, object], text: str) -> int | None:
    explicit = metadata.get("procedure_step_index")
    if isinstance(explicit, int) and not isinstance(explicit, bool):
        return explicit
    for value in (
        _text(metadata.get("provision_label")),
        _text(metadata.get("item_label")),
        _text(metadata.get("clause_no")),
        _text(metadata.get("article_label")),
        _text(metadata.get("article_no")),
    ):
        if not value:
            continue
        ordinal = _ordinal_from_label(value)
        if ordinal is not None:
            return ordinal
    for line in text.splitlines():
        ordinal = _ordinal_from_label(line.strip())
        if ordinal is not None:
            return ordinal
    if any(
        marker in _compact(text)
        for marker in ("按如下程序", "按以下程序", "按下列程序", "程序如下", "流程如下", "办理程序")
    ):
        return 0
    if _text(metadata.get("answer_role")) == "procedure_step":
        return 0
    return None


def _resolve_clause_ordinal(*, text: str, metadata: dict[str, object]) -> int | None:
    for value in (
        _text(metadata.get("clause_no")),
        _single_clause_label(_text(metadata.get("provision_label"))),
        _text(metadata.get("item_label")),
    ):
        if not value:
            continue
        ordinal = _ordinal_from_label(value)
        if ordinal is not None:
            return ordinal
    return _leading_single_clause_ordinal(text)


def _leading_single_clause_ordinal(text: str) -> int | None:
    lines = [line.strip() for line in text.splitlines() if line.strip()]
    if not lines:
        return None
    first_ordinal = _ordinal_from_label(lines[0])
    if first_ordinal is None:
        return None
    for line in lines[1:]:
        if _ordinal_from_label(line) is not None:
            return None
    return first_ordinal


def _single_clause_label(value: str) -> str:
    normalized = value.strip()
    if not normalized or "-" in normalized:
        return ""
    return normalized


def _procedure_actor(compact: str) -> str:
    if "申请人" in compact or "申请者" in compact:
        return "applicant"
    if "学生本人" in compact or "学生" in compact:
        return "student"
    if "指导教师" in compact or "教师" in compact:
        return "instructor"
    if "学院" in compact or "院系" in compact:
        return "college"
    if "教务处" in compact:
        return "academic_affairs_office"
    if "学生处" in compact:
        return "student_affairs_office"
    if "学校" in compact or "部门" in compact:
        return "office"
    if any(
        marker in compact
        for marker in (
            "调解委员会",
            "负责",
            "受理",
            "审核",
            "审批",
            "公示",
            "办理",
            "协调",
            "答复",
            "查处",
            "制订",
            "制定",
            "组织",
            "管理",
            "监督",
            "汇总",
            "备案",
        )
    ):
        return "office"
    if compact:
        return "responsible_party"
    return ""


def _procedure_action(compact: str, *, actor: str) -> str:
    return resolve_regulation_procedure_action(text=compact, actor=actor).value


def _procedure_materials(compact: str) -> list[str]:
    materials: list[str] = []
    for marker in ("申请材料", "证明材料", "书面申请", "补办申请表", "解除处分申请表"):
        if marker in compact:
            materials.append(marker)
    return materials


def _procedure_action_provenance(compact: str, *, actor: str, action: str) -> str:
    return (
        resolve_regulation_procedure_action(text=compact, actor=actor).provenance
        or f"resolved:{action}"
    )


def _procedure_next_actor(compact: str) -> str:
    if "学院" in compact or "院系" in compact:
        return "college"
    if "教务处" in compact:
        return "academic_affairs_office"
    if "学生处" in compact:
        return "student_affairs_office"
    return ""


def infer_intro_scope(*, text: str, metadata: dict[str, object]) -> str:
    explicit = _text(metadata.get("intro_scope"))
    if explicit:
        return explicit
    target_roles = set(_text_tuple(metadata.get("intro_target_roles")))
    compact = _compact(text)
    if "procedure_step" in target_roles or any(
        marker in compact for marker in ("程序", "流程", "步骤", "办理")
    ):
        return "procedure_list"
    if "exception_rule" in target_roles or "eligibility_condition" in target_roles:
        return "eligibility_group"
    if "example_evidence" in target_roles:
        return "example_list"
    return "eligibility_group"


def _section_path_text(metadata: dict[str, object]) -> str:
    raw = _section_path(metadata)
    if not raw:
        return ""
    return _compact(" ".join(raw))


def _section_path(metadata: dict[str, object]) -> tuple[str, ...]:
    raw = metadata.get("section_path")
    if not isinstance(raw, list | tuple):
        return ()
    return tuple(str(item).strip() for item in raw if str(item).strip())


def _text_tuple(value: object) -> tuple[str, ...]:
    if isinstance(value, str):
        text = value.strip()
        return (text,) if text else ()
    if not isinstance(value, list | tuple):
        return ()
    items: list[str] = []
    for item in value:
        text = _text(item)
        if text:
            items.append(text)
    return tuple(items)


def _text(value: object) -> str:
    return value.strip() if isinstance(value, str) and value.strip() else ""


def _compact(value: str) -> str:
    return re.sub(r"\s+", "", value.strip())


_CHINESE_NUMBER_VALUES = {
    "零": 0,
    "〇": 0,
    "一": 1,
    "二": 2,
    "两": 2,
    "三": 3,
    "四": 4,
    "五": 5,
    "六": 6,
    "七": 7,
    "八": 8,
    "九": 9,
}
_CHINESE_UNIT_VALUES = {"十": 10, "百": 100, "千": 1000}


def _ordinal_from_label(value: str) -> int | None:
    normalized = value.strip()
    if not normalized:
        return None
    digit_match = re.match(r"^\s*(?:第|[（(])?(?P<number>\d+)", normalized)
    if digit_match:
        return int(digit_match.group("number"))
    chinese_match = re.match(
        r"^\s*(?:第|[（(])?(?P<number>[一二三四五六七八九十百千万〇零两]+)",
        normalized,
    )
    if not chinese_match:
        return None
    return _parse_chinese_number(chinese_match.group("number"))


def _parse_chinese_number(value: str) -> int | None:
    total = 0
    current = 0
    saw_value = False
    for char in value:
        if char in _CHINESE_NUMBER_VALUES:
            current = _CHINESE_NUMBER_VALUES[char]
            saw_value = True
            continue
        unit = _CHINESE_UNIT_VALUES.get(char)
        if unit is None:
            return None
        total += (current or 1) * unit
        current = 0
        saw_value = True
    total += current
    return total if saw_value and total > 0 else None


__all__ = [
    "ANSWER_READY_EVIDENCE_CONTRACT_VERSION",
    "build_answer_ready_contract_metadata",
    "build_category_overview_contract_metadata",
    "build_eligibility_intro_metadata",
    "build_procedure_step_metadata",
    "infer_clause_unit_id",
    "infer_condition_group_id",
    "infer_condition_polarity",
    "infer_condition_subject",
    "infer_intro_scope",
]
