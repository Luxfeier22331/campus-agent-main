from __future__ import annotations

import re

from campus_shared.answer_ready_evidence_contract import (
    ANSWER_READY_CATEGORY_REGISTRY_VERSION,
    ANSWER_READY_CONDITION_SUBJECT_TAXONOMY_VERSION,
    ANSWER_READY_EVIDENCE_CONTRACT_VERSION,
    ANSWER_READY_PROCEDURE_ACTION_TAXONOMY_VERSION,
)
from campus_shared.regulation_semantic_registry import (
    REGULATION_GROUPED_ANSWER_ROLES,
    build_regulation_condition_group_id,
    condition_group_subject_from_group_id,
    resolve_regulation_condition_group_subject,
    resolve_regulation_condition_subject,
    resolve_regulation_expected_polarity,
    resolve_regulation_intro_scope,
    resolve_regulation_procedure_action,
    resolve_regulation_procedure_actor,
    resolve_regulation_procedure_materials,
    resolve_regulation_procedure_next_actor,
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
    normalized_metadata = dict(metadata)
    if answer_role == "eligibility_intro":
        inferred_intro_target_roles = infer_intro_target_roles(
            text=text, metadata=normalized_metadata
        )
        if inferred_intro_target_roles and not _text_tuple(
            normalized_metadata.get("intro_target_roles")
        ):
            normalized_metadata["intro_target_roles"] = inferred_intro_target_roles
        normalized_metadata["is_answer_bearing"] = False
    contract: dict[str, object] = {
        "evidence_contract_version": ANSWER_READY_EVIDENCE_CONTRACT_VERSION,
        "parent_unit_id": _text(normalized_metadata.get("parent_unit_id")) or root_unit_id,
    }
    clause_unit_id = infer_clause_unit_id(
        text=text,
        metadata=normalized_metadata,
        root_unit_id=root_unit_id,
    )
    if clause_unit_id:
        contract["clause_unit_id"] = clause_unit_id
    condition_subject_assignment = resolve_regulation_condition_subject(
        text=text,
        answer_role=answer_role,
        explicit_condition_subject=_text(normalized_metadata.get("condition_subject")),
        condition_group_subject=_text(normalized_metadata.get("condition_group_subject")),
        introduced_condition_subject=_text(normalized_metadata.get("introduced_condition_subject")),
        intro_target_roles=_text_tuple(normalized_metadata.get("intro_target_roles")),
        table_fact_type=_text(normalized_metadata.get("table_fact_type")),
        action_type=_text(normalized_metadata.get("action_type")),
        section_path=_section_path(normalized_metadata),
        document_title=_text(normalized_metadata.get("title")),
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
        condition_group_subject = infer_condition_group_subject(
            text=text,
            metadata={**normalized_metadata, **contract},
        )
        if condition_group_subject:
            contract["condition_group_subject"] = condition_group_subject
        if answer_role == "eligibility_intro":
            condition_group_id = _text(normalized_metadata.get("introduced_condition_group_id"))
        else:
            condition_group_id = ""
        if not condition_group_id:
            condition_group_id = infer_condition_group_id(
                text=text,
                metadata={**normalized_metadata, **contract},
                root_unit_id=root_unit_id,
            )
        if condition_group_id:
            contract["condition_group_id"] = condition_group_id
    condition_polarity = infer_condition_polarity(metadata=normalized_metadata)
    if condition_polarity:
        contract["condition_polarity"] = condition_polarity
    if answer_role == "eligibility_intro":
        contract.update(
            build_eligibility_intro_metadata(
                text=text,
                metadata={**normalized_metadata, **contract},
                root_unit_id=root_unit_id,
            )
        )
        contract["is_answer_bearing"] = False
    return contract


def build_category_overview_contract_metadata(
    *,
    category_id: str,
    parent_unit_id: str,
) -> dict[str, object]:
    group_subject = "audience_scope"
    return {
        "answer_role": "category_overview",
        "evidence_contract_version": ANSWER_READY_EVIDENCE_CONTRACT_VERSION,
        "parent_unit_id": parent_unit_id,
        "condition_polarity": "neutral",
        "condition_subject": group_subject,
        "condition_group_subject": group_subject,
        "condition_group_id": build_regulation_condition_group_id(
            parent_unit_id=parent_unit_id,
            group_subject=group_subject,
        ).value,
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
        condition_group_subject=_text(metadata.get("condition_group_subject")),
        introduced_condition_subject=_text(metadata.get("introduced_condition_subject")),
        intro_target_roles=_text_tuple(metadata.get("intro_target_roles")),
        table_fact_type=_text(metadata.get("table_fact_type")),
        action_type=_text(metadata.get("action_type")),
        section_path=_section_path(metadata),
        document_title=_text(metadata.get("title")),
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
    answer_role = _text(metadata.get("answer_role"))
    if answer_role and answer_role not in REGULATION_GROUPED_ANSWER_ROLES | {
        "material_requirement"
    }:
        return ""
    parent_unit_id = _text(metadata.get("parent_unit_id")) or root_unit_id
    if not parent_unit_id:
        return ""
    group_subject_assignment = resolve_regulation_condition_group_subject(
        text=text,
        answer_role=answer_role,
        explicit_condition_group_subject=_text(metadata.get("condition_group_subject")),
        inherited_condition_subject=(
            _text(metadata.get("introduced_condition_subject"))
            if answer_role == "eligibility_intro"
            else infer_condition_subject(text=text, metadata=metadata)
        ),
        intro_target_roles=_text_tuple(metadata.get("intro_target_roles")),
        table_fact_type=_text(metadata.get("table_fact_type")),
        action_type=_text(metadata.get("action_type")),
        section_path=_section_path(metadata),
        document_title=_text(metadata.get("title")),
    )
    group_subject = group_subject_assignment.value
    if not group_subject:
        return ""
    explicit = _text(metadata.get("condition_group_id"))
    if explicit and explicit.startswith(f"{parent_unit_id}:"):
        explicit_group_subject = condition_group_subject_from_group_id(explicit)
        if explicit_group_subject == group_subject:
            return explicit
    return build_regulation_condition_group_id(
        parent_unit_id=parent_unit_id,
        group_subject=group_subject,
    ).value


def infer_condition_group_subject(*, text: str, metadata: dict[str, object]) -> str:
    return resolve_regulation_condition_group_subject(
        text=text,
        answer_role=_text(metadata.get("answer_role")),
        explicit_condition_group_subject=_text(metadata.get("condition_group_subject")),
        inherited_condition_subject=(
            _text(metadata.get("introduced_condition_subject"))
            if _text(metadata.get("answer_role")) == "eligibility_intro"
            else infer_condition_subject(text=text, metadata=metadata)
        ),
        intro_target_roles=_text_tuple(metadata.get("intro_target_roles")),
        table_fact_type=_text(metadata.get("table_fact_type")),
        action_type=_text(metadata.get("action_type")),
        section_path=_section_path(metadata),
        document_title=_text(metadata.get("title")),
    ).value


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
        condition_group_subject=_text(metadata.get("condition_group_subject")),
        introduced_condition_subject=_text(metadata.get("introduced_condition_subject")),
        intro_target_roles=_text_tuple(metadata.get("intro_target_roles")),
        table_fact_type=_text(metadata.get("table_fact_type")),
        action_type=_text(metadata.get("action_type")),
        section_path=_section_path(metadata),
        document_title=_text(metadata.get("title")),
    )
    return assignment.provenance or f"resolved:{condition_subject}"


def infer_condition_polarity(*, metadata: dict[str, object]) -> str:
    explicit = _text(metadata.get("condition_polarity"))
    if explicit:
        return explicit
    answer_role = _text(metadata.get("answer_role"))
    table_fact_type = _text(metadata.get("table_fact_type"))
    expected = resolve_regulation_expected_polarity(
        answer_role=answer_role,
        table_fact_type=table_fact_type,
    ).value
    if expected:
        return expected
    polarity = _text(metadata.get("polarity"))
    if polarity:
        return polarity
    return ""


def build_procedure_step_metadata(*, text: str, metadata: dict[str, object]) -> dict[str, object]:
    step_index = _procedure_step_index(metadata=metadata, text=text)
    actor_assignment = resolve_regulation_procedure_actor(
        text=text,
        explicit_actor=_text(metadata.get("procedure_actor")),
    )
    actor = actor_assignment.value
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
    materials = resolve_regulation_procedure_materials(text)
    if materials:
        result["procedure_materials"] = list(materials)
    next_actor = resolve_regulation_procedure_next_actor(
        text=text,
        explicit_actor=_text(metadata.get("procedure_next_actor")),
    ).value
    if next_actor:
        result["procedure_next_actor"] = next_actor
    return result


def build_eligibility_intro_metadata(
    *,
    text: str,
    metadata: dict[str, object],
    root_unit_id: str,
) -> dict[str, object]:
    target_roles = _text_tuple(metadata.get("intro_target_roles")) or infer_intro_target_roles(
        text=text,
        metadata=metadata,
    )
    intro_scope = _text(metadata.get("intro_scope")) or infer_intro_scope(
        text=text,
        metadata={**metadata, "intro_target_roles": target_roles},
    )
    introduced_condition_group_id = _text(metadata.get("introduced_condition_group_id"))
    if not introduced_condition_group_id:
        introduced_condition_group_id = build_regulation_condition_group_id(
            parent_unit_id=_text(metadata.get("parent_unit_id")) or root_unit_id,
            group_subject=_text(metadata.get("introduced_condition_subject")),
        ).value
    if not introduced_condition_group_id:
        introduced_condition_group_id = build_regulation_condition_group_id(
            parent_unit_id=_text(metadata.get("parent_unit_id")) or root_unit_id,
            group_subject=_text(metadata.get("condition_subject")),
        ).value
    result: dict[str, object] = {}
    if intro_scope:
        result["intro_scope"] = intro_scope
    if introduced_condition_group_id:
        result["introduced_condition_group_id"] = introduced_condition_group_id
        result["condition_group_id"] = introduced_condition_group_id
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


def _procedure_action(compact: str, *, actor: str) -> str:
    return resolve_regulation_procedure_action(text=compact, actor=actor).value


def _procedure_action_provenance(compact: str, *, actor: str, action: str) -> str:
    return (
        resolve_regulation_procedure_action(text=compact, actor=actor).provenance
        or f"resolved:{action}"
    )


def infer_intro_scope(*, text: str, metadata: dict[str, object]) -> str:
    return resolve_regulation_intro_scope(
        text=text,
        intro_target_roles=_text_tuple(metadata.get("intro_target_roles")),
        explicit_intro_scope=_text(metadata.get("intro_scope")),
    ).value


def infer_intro_target_roles(*, text: str, metadata: dict[str, object]) -> tuple[str, ...]:
    explicit = _text_tuple(metadata.get("intro_target_roles"))
    if explicit:
        return explicit
    condition_subject = _text(metadata.get("condition_subject"))
    condition_group_subject = _text(metadata.get("condition_group_subject"))
    compact = _compact(text)
    if (
        condition_subject == "generic_restriction"
        or condition_group_subject == "generic_restriction"
    ):
        return ("exclusion_rule",)
    if (
        condition_subject == "application_procedure"
        or condition_group_subject == "application_procedure"
    ):
        return ("procedure_step",)
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
        return ("exclusion_rule",)
    if any(
        marker in compact
        for marker in (
            "符合下列条件之一",
            "符合以下条件之一",
            "符合下列条件",
            "符合以下条件",
            "具备下列条件之一",
            "具备以下条件之一",
            "具备下列条件",
            "具备以下条件",
            "具有下列条件之一",
            "具有以下条件之一",
            "具有下列条件",
            "具有以下条件",
            "须具备下列条件",
            "须具备以下条件",
            "应具备下列条件",
            "应具备以下条件",
        )
    ):
        return ("eligibility_condition",)
    return ()


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
