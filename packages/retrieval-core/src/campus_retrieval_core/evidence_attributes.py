from __future__ import annotations

from dataclasses import dataclass, field

from campus_contracts import EvidenceSource
from campus_shared.answer_ready_evidence_contract import (
    ANSWER_READY_BASE_REQUIRED_FIELDS,
    ANSWER_READY_INTERNAL_ATTRIBUTE_FIELDS,
    answer_ready_contract_applies,
    answer_ready_contract_rules_for_scope,
)
from campus_shared.regulation_semantic_registry import condition_group_subject_from_group_id

INTERNAL_EVIDENCE_ATTRIBUTES_ANCHOR_KEY = "_retrieval_evidence_attributes"


@dataclass(frozen=True, slots=True)
class ProcedureAttributes:
    step_index: int | None = None
    actor: str = ""
    action: str = ""
    materials: tuple[str, ...] = field(default_factory=tuple)
    next_actor: str = ""


@dataclass(frozen=True, slots=True)
class EvidenceAttributes:
    answer_role: str = ""
    condition_subject: str = ""
    condition_group_subject: str = ""
    parent_unit_id: str = ""
    clause_unit_id: str = ""
    evidence_contract_version: str = ""
    semantic_role: str = ""
    polarity: str = ""
    action_type: str = ""
    claim_type: str = ""
    audience_scope: str = ""
    article_no: str = ""
    clause_no: str = ""
    section_kind: str = ""
    category_id: str = ""
    category_display_name: str = ""
    category_audience: str = ""
    category_member_document_ids: tuple[str, ...] = field(default_factory=tuple)
    category_member_titles: tuple[str, ...] = field(default_factory=tuple)
    condition_group_id: str = ""
    condition_polarity: str = ""
    intro_scope: str = ""
    introduced_condition_group_id: str = ""
    intro_target_roles: tuple[str, ...] = field(default_factory=tuple)
    procedure: ProcedureAttributes = field(default_factory=ProcedureAttributes)
    missing_contract_fields: tuple[str, ...] = field(default_factory=tuple)


@dataclass(frozen=True, slots=True)
class EvidenceContractDiagnostics:
    contract_missing: bool = False
    contract_issue_reason: str = ""
    missing_contract_fields: tuple[str, ...] = field(default_factory=tuple)
    source_index_contract_version: str = ""


def evidence_attributes_for_source(source: EvidenceSource) -> EvidenceAttributes:
    raw = _coerce_dict(source.anchor.get(INTERNAL_EVIDENCE_ATTRIBUTES_ANCHOR_KEY))
    answer_role = _optional_text(raw.get("answer_role")) or ""
    condition_subject = _optional_text(raw.get("condition_subject")) or ""
    condition_group_subject = _optional_text(raw.get("condition_group_subject")) or ""
    parent_unit_id = _optional_text(raw.get("parent_unit_id")) or ""
    clause_unit_id = _optional_text(raw.get("clause_unit_id")) or ""
    evidence_contract_version = _optional_text(raw.get("evidence_contract_version")) or ""
    semantic_role = _optional_text(raw.get("semantic_role")) or ""
    polarity = _optional_text(raw.get("polarity")) or ""
    action_type = _optional_text(raw.get("action_type")) or ""
    claim_type = _optional_text(raw.get("claim_type")) or ""
    audience_scope = _optional_text(raw.get("audience_scope")) or ""
    article_no = _optional_text(raw.get("article_no")) or ""
    clause_no = _optional_text(raw.get("clause_no")) or ""
    section_kind = _optional_text(raw.get("section_kind")) or ""
    condition_group_id = _optional_text(raw.get("condition_group_id")) or ""
    if not condition_group_subject:
        condition_group_subject = condition_group_subject_from_group_id(condition_group_id)
    condition_polarity = _optional_text(raw.get("condition_polarity")) or polarity
    procedure = ProcedureAttributes(
        step_index=_optional_int(raw.get("procedure_step_index")),
        actor=_optional_text(raw.get("procedure_actor")) or "",
        action=_optional_text(raw.get("procedure_action")) or "",
        materials=_coerce_text_tuple(raw.get("procedure_materials")),
        next_actor=_optional_text(raw.get("procedure_next_actor")) or "",
    )
    missing = _missing_contract_fields(
        answer_role=answer_role,
        parent_unit_id=parent_unit_id,
        evidence_contract_version=evidence_contract_version,
    )
    return EvidenceAttributes(
        answer_role=answer_role,
        condition_subject=condition_subject,
        condition_group_subject=condition_group_subject,
        parent_unit_id=parent_unit_id,
        clause_unit_id=clause_unit_id,
        evidence_contract_version=evidence_contract_version,
        semantic_role=semantic_role,
        polarity=polarity,
        action_type=action_type,
        claim_type=claim_type,
        audience_scope=audience_scope,
        article_no=article_no,
        clause_no=clause_no,
        section_kind=section_kind,
        category_id=_optional_text(raw.get("category_id")) or "",
        category_display_name=_optional_text(raw.get("category_display_name")) or "",
        category_audience=(
            _optional_text(raw.get("category_audience"))
            or _optional_text(raw.get("audience"))
            or ""
        ),
        category_member_document_ids=_coerce_text_tuple(
            raw.get("category_member_document_ids")
            if "category_member_document_ids" in raw
            else raw.get("member_policy_document_ids")
        ),
        category_member_titles=_coerce_text_tuple(
            raw.get("category_member_titles")
            if "category_member_titles" in raw
            else raw.get("member_policy_titles")
        ),
        condition_group_id=condition_group_id,
        condition_polarity=condition_polarity,
        intro_scope=_optional_text(raw.get("intro_scope")) or "",
        introduced_condition_group_id=(
            _optional_text(raw.get("introduced_condition_group_id")) or ""
        ),
        intro_target_roles=_coerce_text_tuple(raw.get("intro_target_roles")),
        procedure=procedure,
        missing_contract_fields=missing,
    )


def evidence_contract_diagnostics_for_source(source: EvidenceSource) -> EvidenceContractDiagnostics:
    if not answer_ready_contract_applies(corpus="regulations", collection=source.collection):
        return EvidenceContractDiagnostics()
    raw = _coerce_dict(source.anchor.get(INTERNAL_EVIDENCE_ATTRIBUTES_ANCHOR_KEY))
    source_index_contract_version = _optional_text(raw.get("evidence_contract_version")) or ""
    missing = _raw_missing_contract_fields(raw, collection=source.collection)
    if not missing:
        return EvidenceContractDiagnostics(
            source_index_contract_version=source_index_contract_version,
        )
    return EvidenceContractDiagnostics(
        contract_missing=True,
        contract_issue_reason="missing_contract",
        missing_contract_fields=missing,
        source_index_contract_version=source_index_contract_version,
    )


def build_internal_evidence_attribute_payload(metadata: dict[str, object]) -> dict[str, object]:
    payload: dict[str, object] = {}
    for key in ANSWER_READY_INTERNAL_ATTRIBUTE_FIELDS:
        if key in metadata:
            payload[key] = metadata[key]
    return payload


def _raw_missing_contract_fields(raw: dict[str, object], *, collection: str) -> tuple[str, ...]:
    if not answer_ready_contract_applies(corpus="regulations", collection=collection):
        return ()
    missing: list[str] = []
    for field_name in ANSWER_READY_BASE_REQUIRED_FIELDS:
        if not _optional_text(raw.get(field_name)):
            missing.append(field_name)
    answer_role = _optional_text(raw.get("answer_role")) or ""
    if not answer_role:
        return tuple(missing)
    rules = answer_ready_contract_rules_for_scope(
        corpus="regulations",
        collection=collection,
    )
    for field_name in rules.required_fields_for_role(answer_role=answer_role):
        if field_name in ANSWER_READY_BASE_REQUIRED_FIELDS:
            continue
        if not _has_contract_field_value(raw, field_name):
            missing.append(field_name)
    if rules.requires_condition_group_id(metadata=raw) and not _has_contract_field_value(
        raw, "condition_group_id"
    ):
        missing.append("condition_group_id")
    if rules.requires_condition_group_subject(metadata=raw) and not _has_contract_field_value(
        raw, "condition_group_subject"
    ):
        missing.append("condition_group_subject")
    return tuple(dict.fromkeys(missing))


def _missing_contract_fields(
    *,
    answer_role: str,
    parent_unit_id: str,
    evidence_contract_version: str,
) -> tuple[str, ...]:
    missing: list[str] = []
    values = {
        "answer_role": answer_role,
        "parent_unit_id": parent_unit_id,
        "evidence_contract_version": evidence_contract_version,
    }
    for field_name in ANSWER_READY_BASE_REQUIRED_FIELDS:
        if not values[field_name]:
            missing.append(field_name)
    return tuple(missing)


def _has_contract_field_value(raw: dict[str, object], field_name: str) -> bool:
    if field_name == "condition_group_subject":
        explicit = _optional_text(raw.get("condition_group_subject"))
        if explicit:
            return True
        group_id = _optional_text(raw.get("condition_group_id")) or ""
        return bool(condition_group_subject_from_group_id(group_id))
    if field_name == "member_policy_document_ids":
        return _coerce_text_tuple(raw.get("member_policy_document_ids")) or _coerce_text_tuple(
            raw.get("category_member_document_ids")
        )
    if field_name == "member_policy_titles":
        return _coerce_text_tuple(raw.get("member_policy_titles")) or _coerce_text_tuple(
            raw.get("category_member_titles")
        )
    if field_name == "audience":
        return (
            _optional_text(raw.get("audience")) or _optional_text(raw.get("category_audience"))
        ) is not None
    if field_name == "parent_unit_id":
        return _optional_text(raw.get("parent_unit_id")) is not None
    if field_name == "intro_target_roles":
        return bool(_coerce_text_tuple(raw.get("intro_target_roles")))
    return _has_value(raw.get(field_name))


def _has_value(value: object) -> bool:
    if value is None:
        return False
    if isinstance(value, str):
        return bool(value.strip())
    if isinstance(value, list | tuple | set):
        return any(_has_value(item) for item in value)
    if isinstance(value, dict):
        return bool(value)
    return True


def _coerce_dict(value: object) -> dict[str, object]:
    return dict(value) if isinstance(value, dict) else {}


def _optional_text(value: object) -> str | None:
    if not isinstance(value, str):
        return None
    normalized = value.strip()
    return normalized or None


def _optional_int(value: object) -> int | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, int):
        return value
    if isinstance(value, str) and value.strip().isdigit():
        return int(value.strip())
    return None


def _coerce_text_tuple(value: object) -> tuple[str, ...]:
    if isinstance(value, str):
        text = value.strip()
        return (text,) if text else ()
    if not isinstance(value, list | tuple):
        return ()
    items: list[str] = []
    for item in value:
        if not isinstance(item, str):
            continue
        text = item.strip()
        if text:
            items.append(text)
    return tuple(items)


__all__ = [
    "INTERNAL_EVIDENCE_ATTRIBUTES_ANCHOR_KEY",
    "EvidenceAttributes",
    "EvidenceContractDiagnostics",
    "ProcedureAttributes",
    "build_internal_evidence_attribute_payload",
    "evidence_attributes_for_source",
    "evidence_contract_diagnostics_for_source",
]
