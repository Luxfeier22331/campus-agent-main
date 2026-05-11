from __future__ import annotations

import json
from collections.abc import Mapping
from dataclasses import asdict, dataclass, field
from pathlib import Path

from campus_shared.regulation_semantic_registry import canonical_regulation_condition_subject

from campus_evals.profile_report import (
    load_json_object,
    load_observation_mapping,
    required_string,
    string_tuple,
)

ANSWER_READY_COMPONENT_CASES_PATH = (
    Path(__file__).resolve().parents[2] / "fixtures" / "answer_ready_component_cases.v1.json"
)


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
    expected_condition_polarity: str = ""
    expected_document_ids: tuple[str, ...] = field(default_factory=tuple)
    expected_min_category_coverage: int = 0


@dataclass(frozen=True, slots=True)
class AnswerReadyComponentCaseSet:
    schema_version: int
    case_family: str
    cases: tuple[AnswerReadyComponentCase, ...]


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
    no_answer_reason: str = ""
    release_contract_status: str = ""
    release_contract_failure_classes: tuple[str, ...] = field(default_factory=tuple)


@dataclass(frozen=True, slots=True)
class AnswerReadyComponentObservationSet:
    schema_version: int
    observations: dict[str, ObservedAnswerReadyComponents]


@dataclass(frozen=True, slots=True)
class AnswerReadyComponentResult:
    case_id: str
    collection: str
    passed: bool
    primary_failure_class: str
    secondary_failure_class: str
    failure_classes: tuple[str, ...]
    failure_gate_classifications: tuple[str, ...]
    mismatches: dict[str, str]


@dataclass(frozen=True, slots=True)
class AnswerReadyComponentReport:
    passed: bool
    total: int
    passed_count: int
    failed_count: int
    results: tuple[AnswerReadyComponentResult, ...]
    primary_failure_stage_counts: dict[str, int]
    secondary_failure_stage_counts: dict[str, int]
    scope_failure_counts: dict[str, int]
    gate_failure_counts: dict[str, int]


def load_answer_ready_component_cases(
    path: str | Path | None = None,
) -> AnswerReadyComponentCaseSet:
    payload = load_json_object(
        Path(path) if path is not None else ANSWER_READY_COMPONENT_CASES_PATH
    )
    if int(payload.get("schema_version") or 0) != 1:
        raise ValueError("answer ready component case schema_version must be 1")
    case_family = required_string(payload.get("case_family"), "case_family")
    if case_family != "answer_ready_component_eval.v1":
        raise ValueError("unsupported answer ready component case_family")
    raw_cases = payload.get("cases")
    if not isinstance(raw_cases, list) or not raw_cases:
        raise ValueError("answer ready component cases must be a non-empty list")
    cases = tuple(_parse_case(item) for item in raw_cases)
    _reject_duplicate_case_ids(case.case_id for case in cases)
    return AnswerReadyComponentCaseSet(
        schema_version=1,
        case_family=case_family,
        cases=cases,
    )


def load_answer_ready_component_observations(
    path: str | Path | None,
) -> AnswerReadyComponentObservationSet:
    if path is None:
        return AnswerReadyComponentObservationSet(schema_version=1, observations={})
    observations = {
        case_id: _parse_observation(item)
        for case_id, item in load_observation_mapping(Path(path)).items()
    }
    return AnswerReadyComponentObservationSet(schema_version=1, observations=observations)


def evaluate_answer_ready_component_cases(
    cases: tuple[AnswerReadyComponentCase, ...],
    observations: Mapping[str, ObservedAnswerReadyComponents],
    *,
    output_path: Path | None = None,
) -> AnswerReadyComponentReport:
    results = tuple(
        evaluate_answer_ready_component_case(case, observations.get(case.case_id))
        if observations.get(case.case_id) is not None
        else AnswerReadyComponentResult(
            case_id=case.case_id,
            collection=case.collection,
            passed=False,
            primary_failure_class="missing_observation",
            secondary_failure_class="",
            failure_classes=("missing_observation",),
            failure_gate_classifications=("query_conditioned",),
            mismatches={"observation": "missing"},
        )
        for case in cases
    )
    passed_count = sum(1 for result in results if result.passed)
    report = AnswerReadyComponentReport(
        passed=passed_count == len(results),
        total=len(results),
        passed_count=passed_count,
        failed_count=len(results) - passed_count,
        results=results,
        primary_failure_stage_counts=_count_primary_failure_stages(results),
        secondary_failure_stage_counts=_count_secondary_failure_stages(results),
        scope_failure_counts=_count_scope_failures(results),
        gate_failure_counts=_count_gate_failures(results),
    )
    if output_path is not None:
        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_path.write_text(
            json.dumps(
                {
                    "schema_version": 1,
                    "case_family": "answer_ready_component_eval.v1",
                    "summary": {
                        "total": report.total,
                        "passed": report.passed_count,
                        "failed": report.failed_count,
                        "overall_passed": report.passed,
                        "primary_failure_stage_counts": report.primary_failure_stage_counts,
                        "secondary_failure_stage_counts": report.secondary_failure_stage_counts,
                        "scope_failure_counts": report.scope_failure_counts,
                        "gate_failure_counts": report.gate_failure_counts,
                    },
                    "results": [asdict(result) for result in report.results],
                },
                ensure_ascii=False,
                indent=2,
            )
            + "\n",
            encoding="utf-8",
        )
    return report


def evaluate_answer_ready_component_case(
    case: AnswerReadyComponentCase,
    observed: ObservedAnswerReadyComponents | None,
) -> AnswerReadyComponentResult:
    if observed is None:
        return AnswerReadyComponentResult(
            case_id=case.case_id,
            collection=case.collection,
            passed=False,
            primary_failure_class="missing_observation",
            secondary_failure_class="",
            failure_classes=("missing_observation",),
            failure_gate_classifications=("query_conditioned",),
            mismatches={"observation": "missing"},
        )

    failures: list[tuple[str, str, dict[str, str]]] = []
    intent_mismatches = _intent_mismatches(case, observed)
    if intent_mismatches:
        failures.append(("intent_mismatch", "query_conditioned", intent_mismatches))
    else:
        retrieval_mismatches = _retrieval_mismatches(case, observed)
        ranking_mismatches = _ranking_mismatches(case, observed)
        selection_mismatches = _selection_role_mismatches(case, observed)
        semantic_mismatches = _selection_semantic_mismatches(case, observed)
        draft_mismatches = _draft_mismatches(case, observed)
        grounding_mismatches = _grounding_mismatches(case, observed)

        if (
            selection_mismatches
            and ranking_mismatches
            and _selection_mismatch_is_derivative_of_ranking(case, observed)
        ):
            selection_mismatches = {}
        if semantic_mismatches and selection_mismatches:
            semantic_mismatches = {}
        if observed.no_answer_reason == "typed_answer_draft_invalid":
            grounding_mismatches = {}

        for failure_class, gate_classification, mismatches in (
            ("retrieval_miss", "query_conditioned", retrieval_mismatches),
            ("ranking_mismatch", "query_conditioned", ranking_mismatches),
            ("selection_not_answer_ready", "query_conditioned", selection_mismatches),
            ("semantic_contract_mismatch", "query_conditioned", semantic_mismatches),
            ("draft_contract_mismatch", "query_conditioned", draft_mismatches),
            ("grounding_mismatch", "query_conditioned", grounding_mismatches),
        ):
            if mismatches:
                failures.append((failure_class, gate_classification, mismatches))
    release_contract_mismatches = _release_contract_mismatches(observed)
    if release_contract_mismatches:
        failures.append(("release_contract_missing", "static_gate", release_contract_mismatches))

    if failures:
        primary_failure_class, _, primary_mismatches = failures[0]
        secondary_failure_class = failures[1][0] if len(failures) > 1 else ""
        return AnswerReadyComponentResult(
            case_id=case.case_id,
            collection=case.collection,
            passed=False,
            primary_failure_class=primary_failure_class,
            secondary_failure_class=secondary_failure_class,
            failure_classes=tuple(failure_class for failure_class, _, _ in failures),
            failure_gate_classifications=tuple(
                gate_classification for _, gate_classification, _ in failures
            ),
            mismatches=_merge_mismatches(primary_mismatches, failures[1:]),
        )

    return AnswerReadyComponentResult(
        case_id=case.case_id,
        collection=case.collection,
        passed=True,
        primary_failure_class="",
        secondary_failure_class="",
        failure_classes=(),
        failure_gate_classifications=(),
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
    if case.expected_answer_role in {"clarification", "unsupported"}:
        return {}
    if not observed.ranked_evidence_roles:
        return {"top_evidence_role": "missing ranked evidence"}

    first_role = observed.ranked_evidence_roles[0]
    expected_primary_role = case.expected_answer_role
    if (
        expected_primary_role
        and first_role != expected_primary_role
        and expected_primary_role in set(case.expected_top_evidence_roles)
    ):
        return {"top_evidence_role": f"{first_role} != preferred {expected_primary_role}"}

    expected_roles = set(case.expected_top_evidence_roles)
    if not expected_roles:
        return {}
    if first_role not in expected_roles:
        return {"top_evidence_role": f"{first_role} not in {case.expected_top_evidence_roles}"}
    return {}


def _selection_role_mismatches(
    case: AnswerReadyComponentCase,
    observed: ObservedAnswerReadyComponents,
) -> dict[str, str]:
    if case.expected_answer_role in {"clarification", "unsupported"}:
        return {}
    selected_roles = set(observed.selected_evidence_roles)
    if case.expected_answer_role and case.expected_answer_role not in selected_roles:
        return {
            "selected_evidence_roles": (
                f"{observed.selected_evidence_roles} missing {case.expected_answer_role}"
            )
        }
    return {}


def _selection_mismatch_is_derivative_of_ranking(
    case: AnswerReadyComponentCase,
    observed: ObservedAnswerReadyComponents,
) -> bool:
    if not observed.ranked_evidence_roles or not observed.selected_evidence_roles:
        return False
    top_ranked_role = observed.ranked_evidence_roles[0]
    if top_ranked_role == case.expected_answer_role:
        return False
    return set(observed.selected_evidence_roles) == {top_ranked_role}


def _selection_semantic_mismatches(
    case: AnswerReadyComponentCase,
    observed: ObservedAnswerReadyComponents,
) -> dict[str, str]:
    mismatches: dict[str, str] = {}
    if case.expected_answer_role in {"clarification", "unsupported"}:
        return mismatches
    if case.expected_condition_subject and canonical_regulation_condition_subject(
        case.expected_condition_subject
    ) not in {
        canonical_regulation_condition_subject(subject)
        for subject in observed.selected_condition_subjects
        if subject
    }:
        mismatches["selected_condition_subjects"] = (
            f"{observed.selected_condition_subjects} missing {case.expected_condition_subject}"
        )
    if case.expected_condition_polarity and case.expected_condition_polarity not in set(
        observed.selected_polarities
    ):
        mismatches["selected_polarities"] = (
            f"{observed.selected_polarities} missing {case.expected_condition_polarity}"
        )
    return mismatches


def _draft_mismatches(
    case: AnswerReadyComponentCase,
    observed: ObservedAnswerReadyComponents,
) -> dict[str, str]:
    if observed.no_answer_reason == "typed_answer_draft_invalid":
        return {
            "no_answer_reason": (
                "typed_answer_draft_invalid indicates synthesized typed draft contract failure"
            )
        }
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


def _release_contract_mismatches(
    observed: ObservedAnswerReadyComponents,
) -> dict[str, str]:
    if not observed.release_contract_status:
        return {}
    if observed.release_contract_status == "passed":
        return {}
    release_failure_classes = (
        ",".join(observed.release_contract_failure_classes)
        if observed.release_contract_failure_classes
        else "none"
    )
    return {
        "release_contract_status": (
            f"{observed.release_contract_status}; failures={release_failure_classes}"
        )
    }


def _parse_case(payload: object) -> AnswerReadyComponentCase:
    if not isinstance(payload, dict):
        raise ValueError("answer ready component case must be an object")
    return AnswerReadyComponentCase(
        case_id=required_string(payload.get("case_id"), "case_id"),
        query=required_string(payload.get("query"), "query"),
        collection=required_string(payload.get("collection"), "collection"),
        expected_task_kind=required_string(
            payload.get("expected_task_kind"),
            "expected_task_kind",
        ),
        expected_query_polarity=required_string(
            payload.get("expected_query_polarity"),
            "expected_query_polarity",
        ),
        expected_answer_role=required_string(
            payload.get("expected_answer_role"),
            "expected_answer_role",
        ),
        expected_top_evidence_roles=string_tuple(payload.get("expected_top_evidence_roles")),
        expected_draft_kind=required_string(
            payload.get("expected_draft_kind"),
            "expected_draft_kind",
        ),
        expected_grounding=bool(payload.get("expected_grounding")),
        expected_condition_subject=str(payload.get("expected_condition_subject") or "").strip(),
        expected_condition_polarity=str(payload.get("expected_condition_polarity") or "").strip(),
        expected_document_ids=string_tuple(payload.get("expected_document_ids")),
        expected_min_category_coverage=int(payload.get("expected_min_category_coverage") or 0),
    )


def _parse_observation(payload: Mapping[str, object]) -> ObservedAnswerReadyComponents:
    return ObservedAnswerReadyComponents(
        task_kind=str(payload.get("task_kind") or "").strip(),
        query_polarity=str(payload.get("query_polarity") or "").strip(),
        answer_role=str(payload.get("answer_role") or "").strip(),
        retrieved_document_ids=string_tuple(payload.get("retrieved_document_ids")),
        ranked_evidence_roles=string_tuple(payload.get("ranked_evidence_roles")),
        selected_evidence_roles=string_tuple(payload.get("selected_evidence_roles")),
        draft_kind=str(payload.get("draft_kind") or "").strip(),
        grounding_support_present=bool(payload.get("grounding_support_present")),
        condition_subject=str(payload.get("condition_subject") or "").strip(),
        selected_condition_subjects=string_tuple(payload.get("selected_condition_subjects")),
        selected_polarities=string_tuple(payload.get("selected_polarities")),
        no_answer_reason=str(payload.get("no_answer_reason") or "").strip(),
        release_contract_status=str(payload.get("release_contract_status") or "").strip(),
        release_contract_failure_classes=string_tuple(
            payload.get("release_contract_failure_classes")
        ),
    )


def _reject_duplicate_case_ids(case_ids: object) -> None:
    seen: set[str] = set()
    for case_id in case_ids:
        if case_id in seen:
            raise ValueError(f"duplicate answer ready component case_id: {case_id}")
        seen.add(case_id)


def _count_primary_failure_stages(
    results: tuple[AnswerReadyComponentResult, ...],
) -> dict[str, int]:
    counts: dict[str, int] = {}
    for result in results:
        if result.primary_failure_class:
            counts[result.primary_failure_class] = counts.get(result.primary_failure_class, 0) + 1
    return dict(sorted(counts.items()))


def _count_secondary_failure_stages(
    results: tuple[AnswerReadyComponentResult, ...],
) -> dict[str, int]:
    counts: dict[str, int] = {}
    for result in results:
        for failure_class in result.failure_classes[1:]:
            counts[failure_class] = counts.get(failure_class, 0) + 1
    return dict(sorted(counts.items()))


def _count_scope_failures(results: tuple[AnswerReadyComponentResult, ...]) -> dict[str, int]:
    counts: dict[str, int] = {}
    for result in results:
        if result.passed:
            continue
        counts[result.collection] = counts.get(result.collection, 0) + 1
    return dict(sorted(counts.items()))


def _count_gate_failures(results: tuple[AnswerReadyComponentResult, ...]) -> dict[str, int]:
    counts: dict[str, int] = {}
    for result in results:
        for gate in set(result.failure_gate_classifications):
            counts[gate] = counts.get(gate, 0) + 1
    return dict(sorted(counts.items()))


def _mismatches(checks: dict[str, tuple[object, object]]) -> dict[str, str]:
    return {
        name: f"{actual} != {expected}"
        for name, (actual, expected) in checks.items()
        if actual != expected
    }


def _merge_mismatches(
    primary: dict[str, str],
    secondary_failures: list[tuple[str, str, dict[str, str]]],
) -> dict[str, str]:
    merged = dict(primary)
    for failure_class, _, mismatches in secondary_failures:
        for key, value in mismatches.items():
            merged[f"{failure_class}.{key}"] = value
    return merged


__all__ = [
    "ANSWER_READY_COMPONENT_CASES_PATH",
    "AnswerReadyComponentCase",
    "AnswerReadyComponentCaseSet",
    "AnswerReadyComponentObservationSet",
    "AnswerReadyComponentReport",
    "AnswerReadyComponentResult",
    "ObservedAnswerReadyComponents",
    "evaluate_answer_ready_component_case",
    "evaluate_answer_ready_component_cases",
    "load_answer_ready_component_cases",
    "load_answer_ready_component_observations",
]
