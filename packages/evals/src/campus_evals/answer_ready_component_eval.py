from __future__ import annotations

from dataclasses import dataclass, field

from campus_shared.regulation_semantic_registry import canonical_regulation_condition_subject


@dataclass(frozen=True, slots=True)
class AnswerReadyComponentCase:
    case_id: str
    query: str
    collection: str
    expected_task_kind: str
    expected_query_polarity: str
    expected_answer_role: str
    expected_top_evidence_roles: tuple[str, ...]
    expected_draft_kind: str
    expected_grounding: bool
    expected_condition_subject: str = ""
    expected_document_ids: tuple[str, ...] = field(default_factory=tuple)
    expected_min_category_coverage: int = 0


@dataclass(frozen=True, slots=True)
class ObservedAnswerReadyComponents:
    task_kind: str
    query_polarity: str
    answer_role: str
    retrieved_document_ids: tuple[str, ...] = field(default_factory=tuple)
    ranked_evidence_roles: tuple[str, ...] = field(default_factory=tuple)
    selected_evidence_roles: tuple[str, ...] = field(default_factory=tuple)
    draft_kind: str = ""
    grounding_support_present: bool = False
    condition_subject: str = ""
    selected_condition_subjects: tuple[str, ...] = field(default_factory=tuple)
    selected_polarities: tuple[str, ...] = field(default_factory=tuple)


@dataclass(frozen=True, slots=True)
class AnswerReadyComponentResult:
    case_id: str
    passed: bool
    primary_failure_class: str
    failure_classes: tuple[str, ...]
    mismatches: dict[str, str]


def evaluate_answer_ready_component_case(
    case: AnswerReadyComponentCase,
    observed: ObservedAnswerReadyComponents,
) -> AnswerReadyComponentResult:
    for failure_class, mismatches in (
        ("intent_mismatch", _intent_mismatches(case, observed)),
        ("retrieval_miss", _retrieval_mismatches(case, observed)),
        ("ranking_mismatch", _ranking_mismatches(case, observed)),
        ("selection_not_answer_ready", _selection_mismatches(case, observed)),
        ("draft_contract_mismatch", _draft_mismatches(case, observed)),
        ("grounding_mismatch", _grounding_mismatches(case, observed)),
    ):
        if mismatches:
            return AnswerReadyComponentResult(
                case_id=case.case_id,
                passed=False,
                primary_failure_class=failure_class,
                failure_classes=(failure_class,),
                mismatches=mismatches,
            )
    return AnswerReadyComponentResult(
        case_id=case.case_id,
        passed=True,
        primary_failure_class="",
        failure_classes=(),
        mismatches={},
    )


def _intent_mismatches(
    case: AnswerReadyComponentCase,
    observed: ObservedAnswerReadyComponents,
) -> dict[str, str]:
    checks = {
        "task_kind": (observed.task_kind, case.expected_task_kind),
        "query_polarity": (observed.query_polarity, case.expected_query_polarity),
        "answer_role": (observed.answer_role, case.expected_answer_role),
    }
    if case.expected_condition_subject:
        checks["condition_subject"] = (
            canonical_regulation_condition_subject(observed.condition_subject),
            canonical_regulation_condition_subject(case.expected_condition_subject),
        )
    return _mismatches(checks)


def _retrieval_mismatches(
    case: AnswerReadyComponentCase,
    observed: ObservedAnswerReadyComponents,
) -> dict[str, str]:
    mismatches: dict[str, str] = {}
    if case.expected_document_ids and not set(case.expected_document_ids).issubset(
        set(observed.retrieved_document_ids)
    ):
        mismatches["expected_document_ids"] = (
            f"{observed.retrieved_document_ids} missing {case.expected_document_ids}"
        )
    if (
        case.expected_min_category_coverage > 0
        and len(set(observed.retrieved_document_ids)) < case.expected_min_category_coverage
    ):
        mismatches["category_coverage"] = (
            f"{len(set(observed.retrieved_document_ids))} < {case.expected_min_category_coverage}"
        )
    return mismatches


def _ranking_mismatches(
    case: AnswerReadyComponentCase,
    observed: ObservedAnswerReadyComponents,
) -> dict[str, str]:
    expected_roles = set(case.expected_top_evidence_roles)
    if not expected_roles:
        return {}
    first_role = observed.ranked_evidence_roles[0] if observed.ranked_evidence_roles else ""
    if first_role not in expected_roles:
        return {"top_evidence_role": f"{first_role} not in {case.expected_top_evidence_roles}"}
    return {}


def _selection_mismatches(
    case: AnswerReadyComponentCase,
    observed: ObservedAnswerReadyComponents,
) -> dict[str, str]:
    selected_roles = set(observed.selected_evidence_roles)
    if case.expected_answer_role and case.expected_answer_role not in selected_roles:
        return {
            "selected_evidence_roles": (
                f"{observed.selected_evidence_roles} missing {case.expected_answer_role}"
            )
        }
    if (
        case.expected_condition_subject
        and observed.selected_condition_subjects
        and canonical_regulation_condition_subject(case.expected_condition_subject)
        not in {
            canonical_regulation_condition_subject(subject)
            for subject in observed.selected_condition_subjects
        }
    ):
        return {
            "selected_condition_subjects": (
                f"{observed.selected_condition_subjects} missing {case.expected_condition_subject}"
            )
        }
    return {}


def _draft_mismatches(
    case: AnswerReadyComponentCase,
    observed: ObservedAnswerReadyComponents,
) -> dict[str, str]:
    if observed.draft_kind != case.expected_draft_kind:
        return {"draft_kind": f"{observed.draft_kind} != {case.expected_draft_kind}"}
    return {}


def _grounding_mismatches(
    case: AnswerReadyComponentCase,
    observed: ObservedAnswerReadyComponents,
) -> dict[str, str]:
    if bool(observed.grounding_support_present) != bool(case.expected_grounding):
        return {
            "grounding_support_present": (
                f"{observed.grounding_support_present} != {case.expected_grounding}"
            )
        }
    return {}


def _mismatches(checks: dict[str, tuple[object, object]]) -> dict[str, str]:
    return {
        name: f"{actual} != {expected}"
        for name, (actual, expected) in checks.items()
        if actual != expected
    }


__all__ = [
    "AnswerReadyComponentCase",
    "AnswerReadyComponentResult",
    "ObservedAnswerReadyComponents",
    "evaluate_answer_ready_component_case",
]
