from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from typing import Any

ANSWER_READY_CONTRACT_FAILURE_CLASS = "chunk_contract_missing"
ANSWER_READY_EVIDENCE_CONTRACT_VERSION = "answer_ready_evidence.v1"

_JUDGMENT_ANSWER_ROLES = frozenset(
    {
        "eligibility_condition",
        "exception_rule",
        "exclusion_rule",
        "example_evidence",
    }
)


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
    if corpus != "regulations" or collection != "student_rules":
        return AnswerReadyContractQualityResult(issues=())

    runtime_anchor = anchor or {}
    answer_role = _text(metadata.get("answer_role"))
    content_role = _text(metadata.get("content_role"))
    unit_type = _text(metadata.get("unit_type"))
    issues: list[str] = []

    if (
        not answer_role
        and _requires_answer_role(
            metadata=metadata,
            content_role=content_role,
            unit_type=unit_type,
        )
    ):
        issues.append("answer_ready_answer_role_missing")

    if not _is_answer_ready_chunk(answer_role=answer_role, content_role=content_role, unit_type=unit_type):
        return AnswerReadyContractQualityResult(issues=tuple(dict.fromkeys(issues)))

    if _text(metadata.get("evidence_contract_version")) != ANSWER_READY_EVIDENCE_CONTRACT_VERSION:
        issues.append("answer_ready_evidence_contract_version_missing")
    if not (_has_value(metadata.get("parent_unit_id")) or _has_value(runtime_anchor.get("parent_unit_id"))):
        issues.append("answer_ready_parent_unit_id_missing")
    if answer_role in _JUDGMENT_ANSWER_ROLES and not _has_value(metadata.get("condition_subject")):
        issues.append("answer_ready_condition_subject_missing")
    if answer_role == "procedure_step" and not _has_required_procedure_step_fields(metadata):
        issues.append("answer_ready_procedure_step_fields_missing")
    if _is_category_overview(answer_role=answer_role, content_role=content_role, unit_type=unit_type):
        if not _has_non_empty_sequence(metadata.get("category_member_document_ids")):
            issues.append("category_overview_missing_member_document_ids")
        if not _has_non_empty_sequence(metadata.get("category_member_titles")):
            issues.append("category_overview_missing_member_titles")

    return AnswerReadyContractQualityResult(issues=tuple(dict.fromkeys(issues)))


def is_answer_ready_contract_issue(issue: str) -> bool:
    return issue.startswith("answer_ready_") or issue in {
        "category_overview_missing_member_document_ids",
        "category_overview_missing_member_titles",
    }


def _requires_answer_role(
    *,
    metadata: Mapping[str, Any],
    content_role: str,
    unit_type: str,
) -> bool:
    return bool(
        metadata.get("is_answer_bearing")
        or unit_type in {"category_overview", "table_unit"}
        or content_role in {"eligibility", "requirement", "procedure", "policy_list", "table_fact"}
    )


def _is_answer_ready_chunk(
    *,
    answer_role: str,
    content_role: str,
    unit_type: str,
) -> bool:
    if not answer_role or answer_role == "supporting_detail":
        return False
    return bool(
        answer_role
        or unit_type in {"category_overview", "table_unit"}
        or content_role in {"eligibility", "requirement", "procedure", "policy_list", "table_fact"}
    )


def _is_category_overview(
    *,
    answer_role: str,
    content_role: str,
    unit_type: str,
) -> bool:
    return answer_role == "category_overview" or unit_type == "category_overview" or content_role == "policy_list"


def _has_required_procedure_step_fields(metadata: Mapping[str, Any]) -> bool:
    return all(
        _has_value(metadata.get(field_name))
        for field_name in (
            "procedure_step_index",
            "procedure_actor",
            "procedure_action",
        )
    )


def _has_non_empty_sequence(value: object) -> bool:
    if not isinstance(value, list | tuple):
        return False
    return any(_has_value(item) for item in value)


def _has_value(value: object) -> bool:
    if value is None:
        return False
    if isinstance(value, str):
        return bool(value.strip())
    if isinstance(value, list | tuple | set | dict):
        return bool(value)
    return True


def _text(value: object) -> str:
    return value.strip() if isinstance(value, str) and value.strip() else ""


__all__ = [
    "ANSWER_READY_CONTRACT_FAILURE_CLASS",
    "ANSWER_READY_EVIDENCE_CONTRACT_VERSION",
    "AnswerReadyContractQualityResult",
    "evaluate_answer_ready_contract_metadata",
    "is_answer_ready_contract_issue",
]
