from __future__ import annotations

from dataclasses import dataclass, field

from campus_contracts import EvidenceSource
from campus_shared.answer_ready_evidence_contract import (
    ANSWER_READY_BASE_REQUIRED_FIELDS,
    ANSWER_READY_INTERNAL_ATTRIBUTE_FIELDS,
)

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
class EvidenceFallbackDiagnostics:
    fallback_used: bool = False
    fallback_reason: str = ""
    missing_contract_fields: tuple[str, ...] = field(default_factory=tuple)
    source_index_contract_version: str = ""
    fallback_primary_signal: str = ""


def evidence_attributes_for_source(source: EvidenceSource) -> EvidenceAttributes:
    raw = _coerce_dict(source.anchor.get(INTERNAL_EVIDENCE_ATTRIBUTES_ANCHOR_KEY))
    answer_role = (
        _optional_text(raw.get("answer_role")) or source.semantic_role or source.content_role
    )
    condition_subject = _optional_text(raw.get("condition_subject")) or ""
    parent_unit_id = (
        _optional_text(raw.get("parent_unit_id"))
        or source.source_unit_key
        or _optional_text(source.anchor.get("root_unit_id"))
        or ""
    )
    clause_unit_id = _optional_text(raw.get("clause_unit_id")) or ""
    evidence_contract_version = _optional_text(raw.get("evidence_contract_version")) or ""
    semantic_role = _optional_text(raw.get("semantic_role")) or source.semantic_role
    polarity = _optional_text(raw.get("polarity")) or source.polarity
    action_type = _optional_text(raw.get("action_type")) or source.action_type
    claim_type = _optional_text(raw.get("claim_type")) or source.claim_type
    audience_scope = _optional_text(raw.get("audience_scope")) or source.audience_scope
    article_no = _optional_text(raw.get("article_no")) or source.article_no
    clause_no = _optional_text(raw.get("clause_no")) or source.clause_no
    section_kind = _optional_text(raw.get("section_kind")) or source.section_kind
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
        condition_group_id=_optional_text(raw.get("condition_group_id")) or "",
        condition_polarity=condition_polarity,
        intro_scope=_optional_text(raw.get("intro_scope")) or "",
        introduced_condition_group_id=(
            _optional_text(raw.get("introduced_condition_group_id")) or ""
        ),
        intro_target_roles=_coerce_text_tuple(raw.get("intro_target_roles")),
        procedure=procedure,
        missing_contract_fields=missing,
    )


def evidence_fallback_diagnostics_for_source(source: EvidenceSource) -> EvidenceFallbackDiagnostics:
    raw = _coerce_dict(source.anchor.get(INTERNAL_EVIDENCE_ATTRIBUTES_ANCHOR_KEY))
    source_index_contract_version = _optional_text(raw.get("evidence_contract_version")) or ""
    missing = _raw_missing_contract_fields(raw)
    if not missing:
        return EvidenceFallbackDiagnostics(
            source_index_contract_version=source_index_contract_version,
        )
    return EvidenceFallbackDiagnostics(
        fallback_used=True,
        fallback_reason="missing_contract",
        missing_contract_fields=missing,
        source_index_contract_version=source_index_contract_version,
        fallback_primary_signal=_fallback_primary_signal(source),
    )


def build_internal_evidence_attribute_payload(metadata: dict[str, object]) -> dict[str, object]:
    payload: dict[str, object] = {}
    for key in ANSWER_READY_INTERNAL_ATTRIBUTE_FIELDS:
        if key in metadata:
            payload[key] = metadata[key]
    return payload


def _raw_missing_contract_fields(raw: dict[str, object]) -> tuple[str, ...]:
    missing: list[str] = []
    for field_name in ANSWER_READY_BASE_REQUIRED_FIELDS:
        if not _optional_text(raw.get(field_name)):
            missing.append(field_name)
    return tuple(missing)


def _fallback_primary_signal(source: EvidenceSource) -> str:
    if source.semantic_role or source.polarity or source.action_type or source.claim_type:
        return "public_semantic"
    if source.content_role or source.content_kind:
        return "public_content_role"
    if source.snippet:
        return "text_cue"
    return "none"


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
    "EvidenceFallbackDiagnostics",
    "ProcedureAttributes",
    "build_internal_evidence_attribute_payload",
    "evidence_attributes_for_source",
    "evidence_fallback_diagnostics_for_source",
]
