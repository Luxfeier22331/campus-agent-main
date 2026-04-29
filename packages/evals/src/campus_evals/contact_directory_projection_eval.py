from __future__ import annotations

from dataclasses import dataclass
from typing import Any


@dataclass(frozen=True, slots=True)
class ContactDirectoryProjectionEvalCase:
    case_id: str
    display_name: str
    required_phone_numbers: tuple[str, ...] = ()
    required_aliases: tuple[str, ...] = ()
    required_source_refs: tuple[str, ...] = ()
    required_contact_group: str = ""
    required_department: str = ""


@dataclass(frozen=True, slots=True)
class ContactDirectoryProjectionCaseResult:
    case_id: str
    passed: bool
    display_name: str
    failures: list[str]
    observed_values: dict[str, list[str]]


@dataclass(frozen=True, slots=True)
class ContactDirectoryProjectionEvalReport:
    passed: bool
    summary: dict[str, int]
    failed_case_ids: list[str]
    case_results: tuple[ContactDirectoryProjectionCaseResult, ...]


def load_default_contact_directory_projection_eval_cases() -> tuple[
    ContactDirectoryProjectionEvalCase, ...
]:
    return (
        ContactDirectoryProjectionEvalCase(
            case_id="campus-security-hotline-phone",
            display_name="校园110",
            required_phone_numbers=("68932220",),
            required_aliases=("校园110",),
            required_source_refs=("handbook:student_rules:pages:261-261#page=261",),
            required_contact_group="校级办公与公共服务",
            required_department="校园110",
        ),
        ContactDirectoryProjectionEvalCase(
            case_id="graduate-office-phone",
            display_name="研究生院(学位办)办公室",
            required_phone_numbers=("68932649",),
            required_aliases=("研究生院(学位办)办公室", "研究生院(学位办)"),
            required_source_refs=("handbook:student_rules:pages:261-261#page=261",),
            required_contact_group="校级办公与公共服务",
            required_department="研究生院(学位办)",
        ),
        ContactDirectoryProjectionEvalCase(
            case_id="it-office-phone",
            display_name="信息化建设管理处办公室",
            required_phone_numbers=("68933381",),
            required_aliases=("信息化建设管理处办公室", "信息化建设管理处"),
            required_source_refs=("handbook:student_rules:pages:261-261#page=261",),
            required_contact_group="机关部门办公电话",
            required_department="信息化建设管理处",
        ),
    )


def evaluate_contact_directory_projection_bundle(
    bundle: dict[str, Any],
    *,
    cases: tuple[ContactDirectoryProjectionEvalCase, ...],
) -> ContactDirectoryProjectionEvalReport:
    records = {
        str(record.get("display_name") or ""): dict(record)
        for record in _list_of_dicts(bundle.get("contact_records"))
    }
    results = tuple(
        _evaluate_case(case=case, record=records.get(case.display_name)) for case in cases
    )
    failed_case_ids = [result.case_id for result in results if not result.passed]
    return ContactDirectoryProjectionEvalReport(
        passed=not failed_case_ids,
        summary={
            "total": len(results),
            "passed": len(results) - len(failed_case_ids),
            "failed": len(failed_case_ids),
        },
        failed_case_ids=failed_case_ids,
        case_results=results,
    )


def _evaluate_case(
    *,
    case: ContactDirectoryProjectionEvalCase,
    record: dict[str, Any] | None,
) -> ContactDirectoryProjectionCaseResult:
    failures: list[str] = []
    if record is None:
        return ContactDirectoryProjectionCaseResult(
            case_id=case.case_id,
            passed=False,
            display_name=case.display_name,
            failures=[f"missing contact record: {case.display_name}"],
            observed_values={},
        )

    observed_values = _observed_values(record)
    _require_all(
        failures,
        observed_values["phone_numbers"],
        case.required_phone_numbers,
        "phone",
    )
    _require_all(
        failures,
        observed_values["aliases"],
        case.required_aliases,
        "alias",
    )
    _require_all(
        failures,
        observed_values["source_refs"],
        case.required_source_refs,
        "source ref",
    )
    if case.required_contact_group and record.get("contact_group") != case.required_contact_group:
        failures.append(
            "contact_group mismatch: "
            f"expected={case.required_contact_group}, got={record.get('contact_group')!r}"
        )
    if case.required_department and record.get("department") != case.required_department:
        failures.append(
            "department mismatch: "
            f"expected={case.required_department}, got={record.get('department')!r}"
        )
    if str(record.get("extraction_status") or "") != "ready":
        failures.append(f"unexpected extraction_status: {record.get('extraction_status')!r}")

    return ContactDirectoryProjectionCaseResult(
        case_id=case.case_id,
        passed=not failures,
        display_name=case.display_name,
        failures=failures,
        observed_values=observed_values,
    )


def _observed_values(record: dict[str, Any]) -> dict[str, list[str]]:
    return {
        "phone_numbers": _unique_text(
            item.get("number") for item in _list_of_dicts(record.get("phones"))
        ),
        "aliases": _unique_text(record.get("aliases") or ()),
        "source_refs": _collect_source_refs(record),
    }


def _collect_source_refs(record: dict[str, Any]) -> list[str]:
    refs: list[str] = []
    refs.extend(_string_list(record.get("source_refs")))
    for field_name in ("phones", "emails", "location_refs", "office_hours"):
        for item in _list_of_dicts(record.get(field_name)):
            refs.extend(_string_list(item.get("source_refs")))
    return _unique_text(refs)


def _require_all(
    failures: list[str],
    observed: list[str],
    required: tuple[str, ...],
    label: str,
) -> None:
    observed_set = set(observed)
    for value in required:
        if value not in observed_set:
            failures.append(f"missing {label}: {value}")


def _list_of_dicts(value: object) -> list[dict[str, Any]]:
    if not isinstance(value, list | tuple):
        return []
    return [dict(item) for item in value if isinstance(item, dict)]


def _string_list(value: object) -> list[str]:
    if not isinstance(value, list | tuple):
        return []
    return [item.strip() for item in value if isinstance(item, str) and item.strip()]


def _unique_text(values: object) -> list[str]:
    seen: set[str] = set()
    result: list[str] = []
    for value in values:
        if not isinstance(value, str):
            continue
        normalized = value.strip()
        if not normalized or normalized in seen:
            continue
        seen.add(normalized)
        result.append(normalized)
    return result


__all__ = [
    "ContactDirectoryProjectionCaseResult",
    "ContactDirectoryProjectionEvalCase",
    "ContactDirectoryProjectionEvalReport",
    "evaluate_contact_directory_projection_bundle",
    "load_default_contact_directory_projection_eval_cases",
]
