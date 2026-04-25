from __future__ import annotations

from dataclasses import dataclass
from typing import Any


@dataclass(frozen=True, slots=True)
class ServiceGuideProjectionEvalCase:
    case_id: str
    service_id: str
    required_material_names: tuple[str, ...] = ()
    required_entry_labels: tuple[str, ...] = ()
    required_office_hours: tuple[str, ...] = ()
    required_contact_labels: tuple[str, ...] = ()
    required_section_types: tuple[str, ...] = ()
    required_source_refs: tuple[str, ...] = ()
    expected_missing_fields: tuple[str, ...] = ()


@dataclass(frozen=True, slots=True)
class ServiceGuideProjectionCaseResult:
    case_id: str
    passed: bool
    service_id: str
    failures: list[str]
    observed_values: dict[str, list[str]]
    observed_missing_fields: list[str]


@dataclass(frozen=True, slots=True)
class ServiceGuideProjectionEvalReport:
    passed: bool
    summary: dict[str, int]
    failed_case_ids: list[str]
    case_results: tuple[ServiceGuideProjectionCaseResult, ...]


def load_default_service_guide_projection_eval_cases() -> tuple[
    ServiceGuideProjectionEvalCase, ...
]:
    return (
        ServiceGuideProjectionEvalCase(
            case_id="student-card-materials",
            service_id="service:handbook:student-card-replacement",
            required_material_names=("书面申请", "《中央民族大学补办学生证申请表》", "本人照片"),
            required_entry_labels=("学院（系）", "学生处"),
            required_section_types=("procedure", "required_materials"),
            required_source_refs=(
                "handbook:student_rules:pages:163-165#page=164",
                "handbook:student_rules:pages:163-165#page=165",
            ),
        ),
        ServiceGuideProjectionEvalCase(
            case_id="student-card-office-hours",
            service_id="service:handbook:student-card-replacement",
            required_office_hours=("每周四下午",),
            required_source_refs=("handbook:student_rules:pages:163-165#page=164",),
        ),
        ServiceGuideProjectionEvalCase(
            case_id="student-loan-materials-entry",
            service_id="service:handbook:national-student-loan-application",
            required_material_names=(
                "国家助学贷款申请书",
                "国家助学贷款申请审批表",
                "相关材料",
                "院系申请国家助学贷款学生审核信息表",
            ),
            required_entry_labels=("所在院系", "学校助学服务中心", "户籍所在县（区）资助中心"),
            required_section_types=("procedure", "required_materials", "entry"),
            required_source_refs=(
                "handbook:student_rules:pages:240-246#page=241",
                "handbook:student_rules:pages:240-246#page=242",
            ),
        ),
        ServiceGuideProjectionEvalCase(
            case_id="work-study-procedure-entry",
            service_id="service:handbook:work-study-position",
            required_entry_labels=("学校学生工作管理系统", "学校助学服务中心"),
            required_section_types=("procedure", "entry"),
            required_source_refs=(
                "handbook:student_rules:pages:220-225#page=222",
                "handbook:student_rules:pages:220-225#page=223",
            ),
        ),
        ServiceGuideProjectionEvalCase(
            case_id="public-medical-contact-fail-close",
            service_id="service:handbook:student-public-medical-reimbursement",
            required_section_types=("procedure", "required_materials"),
            required_source_refs=(
                "handbook:student_rules:pages:259-260#page=259",
                "handbook:student_rules:pages:259-260#page=260",
            ),
            expected_missing_fields=("contact_refs",),
        ),
    )


def evaluate_service_guide_projection_bundle(
    bundle: dict[str, Any],
    *,
    cases: tuple[ServiceGuideProjectionEvalCase, ...],
) -> ServiceGuideProjectionEvalReport:
    records = {
        str(record.get("service_id") or ""): dict(record)
        for record in _list_of_dicts(bundle.get("service_guide_records"))
    }
    results = tuple(
        _evaluate_case(case=case, record=records.get(case.service_id)) for case in cases
    )
    failed_case_ids = [result.case_id for result in results if not result.passed]
    return ServiceGuideProjectionEvalReport(
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
    case: ServiceGuideProjectionEvalCase,
    record: dict[str, Any] | None,
) -> ServiceGuideProjectionCaseResult:
    failures: list[str] = []
    if record is None:
        return ServiceGuideProjectionCaseResult(
            case_id=case.case_id,
            passed=False,
            service_id=case.service_id,
            failures=[f"missing service record: {case.service_id}"],
            observed_values={},
            observed_missing_fields=[],
        )

    observed_values = _observed_values(record)
    observed_missing_fields = _observed_missing_fields(record, case.expected_missing_fields)
    _require_all(
        failures,
        observed_values["materials"],
        case.required_material_names,
        "material",
    )
    _require_all(
        failures,
        observed_values["entries"],
        case.required_entry_labels,
        "entry",
    )
    _require_all(
        failures,
        observed_values["office_hours"],
        case.required_office_hours,
        "office hour",
    )
    _require_all(
        failures,
        observed_values["contacts"],
        case.required_contact_labels,
        "contact",
    )
    _require_all(
        failures,
        observed_values["section_types"],
        case.required_section_types,
        "section type",
    )
    _require_all(
        failures,
        observed_values["source_refs"],
        case.required_source_refs,
        "source ref",
    )
    for field_name in case.expected_missing_fields:
        if field_name not in observed_missing_fields:
            failures.append(f"expected missing field has data: {field_name}")
    return ServiceGuideProjectionCaseResult(
        case_id=case.case_id,
        passed=not failures,
        service_id=case.service_id,
        failures=failures,
        observed_values=observed_values,
        observed_missing_fields=observed_missing_fields,
    )


def _observed_values(record: dict[str, Any]) -> dict[str, list[str]]:
    guide_sections = _list_of_dicts(record.get("guide_sections"))
    materials = _list_of_dicts(record.get("materials"))
    entry_refs = _list_of_dicts(record.get("entry_refs"))
    office_hours = _list_of_dicts(record.get("office_hours"))
    contact_refs = _list_of_dicts(record.get("contact_refs"))
    return {
        "materials": _unique_text(item.get("name") for item in materials),
        "entries": _unique_text(item.get("label") for item in entry_refs),
        "office_hours": _unique_text(
            item.get("time_range") or item.get("effective_note") or item.get("label")
            for item in office_hours
        ),
        "contacts": _unique_text(
            item.get("label") or item.get("department") for item in contact_refs
        ),
        "section_types": _unique_text(item.get("section_type") for item in guide_sections),
        "source_refs": _collect_source_refs(record),
    }


def _observed_missing_fields(
    record: dict[str, Any],
    expected_missing_fields: tuple[str, ...],
) -> list[str]:
    missing: list[str] = []
    for field_name in expected_missing_fields:
        value = record.get(field_name)
        if value in (None, "", [], ()):
            missing.append(field_name)
    return missing


def _collect_source_refs(record: dict[str, Any]) -> list[str]:
    refs: list[str] = []
    refs.extend(_string_list(record.get("source_refs")))
    for field_name in ("guide_sections", "materials", "entry_refs", "office_hours", "contact_refs"):
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
    "ServiceGuideProjectionCaseResult",
    "ServiceGuideProjectionEvalCase",
    "ServiceGuideProjectionEvalReport",
    "evaluate_service_guide_projection_bundle",
    "load_default_service_guide_projection_eval_cases",
]
