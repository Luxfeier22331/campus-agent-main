from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from typing import Any

from campus_regulation_semantics.answer_ready_evidence_contract import (
    ANSWER_READY_EVIDENCE_CONTRACT_VERSION,
    validate_answer_ready_evidence_metadata,
)

ANSWER_READY_CONTRACT_FAILURE_CLASS = "chunk_contract_missing"


@dataclass(frozen=True, slots=True)
class AnswerReadyContractQualityResult:
    contract_version: str
    issues: tuple[str, ...]
    required_fields: tuple[str, ...]
    severity: str
    status: str


def evaluate_answer_ready_contract_metadata(
    *,
    corpus: str,
    collection: str,
    metadata: Mapping[str, Any],
    anchor: Mapping[str, Any] | None = None,
) -> AnswerReadyContractQualityResult:
    validation = validate_answer_ready_evidence_metadata(
        corpus=corpus,
        collection=collection,
        metadata=metadata,
        anchor=anchor,
    )
    return AnswerReadyContractQualityResult(
        contract_version=validation.contract_version,
        issues=_quality_issues(validation.issues),
        required_fields=validation.required_fields,
        severity=validation.severity,
        status=validation.status,
    )


def is_answer_ready_contract_issue(issue: str) -> bool:
    return issue.startswith(("answer_ready_", "category_overview_"))


def _quality_issues(issues: tuple[str, ...]) -> tuple[str, ...]:
    normalized = list(issues)
    procedure_missing = {
        "answer_ready_procedure_step_index_missing",
        "answer_ready_procedure_actor_missing",
        "answer_ready_procedure_action_missing",
        "answer_ready_procedure_action_taxonomy_version_missing",
        "answer_ready_procedure_action_provenance_missing",
    }
    if procedure_missing.intersection(normalized):
        normalized.append("answer_ready_procedure_step_fields_missing")
    intro_missing = {
        "answer_ready_intro_scope_missing",
        "answer_ready_introduced_condition_group_id_missing",
        "answer_ready_intro_target_roles_missing",
    }
    if intro_missing.intersection(normalized):
        normalized.append("answer_ready_intro_fields_missing")
    return tuple(dict.fromkeys(normalized))


__all__ = [
    "ANSWER_READY_CONTRACT_FAILURE_CLASS",
    "ANSWER_READY_EVIDENCE_CONTRACT_VERSION",
    "AnswerReadyContractQualityResult",
    "evaluate_answer_ready_contract_metadata",
    "is_answer_ready_contract_issue",
]
