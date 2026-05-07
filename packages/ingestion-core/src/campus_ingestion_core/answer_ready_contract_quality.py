from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from typing import Any

from campus_shared.answer_ready_evidence_contract import (
    ANSWER_READY_EVIDENCE_CONTRACT_VERSION,
    validate_answer_ready_evidence_metadata,
)

ANSWER_READY_CONTRACT_FAILURE_CLASS = "chunk_contract_missing"


@dataclass(frozen=True, slots=True)
class AnswerReadyContractQualityResult:
    issues: tuple[str, ...]

    @property
    def status(self) -> str:
        return "passed" if not self.issues else "failed"


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
    return AnswerReadyContractQualityResult(issues=_quality_issues(validation.issues))


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
