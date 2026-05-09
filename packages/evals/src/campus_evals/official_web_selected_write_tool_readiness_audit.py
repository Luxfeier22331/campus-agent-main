from __future__ import annotations

import json
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any


@dataclass(frozen=True, slots=True)
class SelectedWritePreviewRecordAuditResult:
    selected_write_id: str
    collection: str
    inventory_id: str
    passed: bool
    failures: tuple[str, ...]


@dataclass(frozen=True, slots=True)
class SelectedWritePreviewToolReadinessAuditReport:
    passed: bool
    output_path: Path
    summary: dict[str, int]
    record_results: tuple[SelectedWritePreviewRecordAuditResult, ...]


def audit_selected_write_preview_report(
    *,
    report_path: Path,
    output_dir: Path,
) -> SelectedWritePreviewToolReadinessAuditReport:
    payload = json.loads(report_path.read_text(encoding="utf-8"))
    results_payload = payload.get("results")
    if not isinstance(results_payload, list):
        raise ValueError("selected-write preview report results must be a list")
    record_results = tuple(
        _audit_record(dict(item))
        for item in results_payload
        if isinstance(item, dict)
        and str(item.get("collection") or "").strip() in {"service_guide", "contact_directory"}
    )
    failed_count = sum(1 for item in record_results if not item.passed)
    summary = {
        "service_guide_records": sum(
            1 for item in record_results if item.collection == "service_guide"
        ),
        "contact_directory_records": sum(
            1 for item in record_results if item.collection == "contact_directory"
        ),
        "failed_records": failed_count,
    }
    output_dir.mkdir(parents=True, exist_ok=True)
    output_path = output_dir / "official-web-selected-write-tool-readiness-audit.json"
    report = SelectedWritePreviewToolReadinessAuditReport(
        passed=failed_count == 0,
        output_path=output_path,
        summary=summary,
        record_results=record_results,
    )
    output_path.write_text(
        json.dumps(
            {
                "schema_version": "official_web_selected_write_tool_readiness_audit.v1",
                "report_path": str(report_path),
                "passed": report.passed,
                "summary": report.summary,
                "record_results": [asdict(item) for item in report.record_results],
            },
            ensure_ascii=False,
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )
    return report


def _audit_record(item: dict[str, Any]) -> SelectedWritePreviewRecordAuditResult:
    selected_write_id = str(item.get("selected_write_id") or "").strip()
    collection = str(item.get("collection") or "").strip()
    inventory_id = str(item.get("inventory_id") or "").strip()
    failures: list[str] = []

    if not _non_empty_list(item.get("task_scope_display_names")):
        failures.append("missing task_scope_display_names for selected-write preview")
    if not _non_empty_list(item.get("full_impact_display_names")):
        failures.append("missing full_impact_display_names for selected-write preview")
    if int(item.get("record_count") or 0) <= 0:
        failures.append("record_count must be positive")
    if int(item.get("full_record_count") or 0) < int(item.get("record_count") or 0):
        failures.append("full_record_count must be >= record_count")

    bundle = item.get("bundle")
    if not isinstance(bundle, dict):
        failures.append("bundle must be an object")
    elif collection == "service_guide":
        failures.extend(_audit_service_guide_bundle(bundle))
    elif collection == "contact_directory":
        failures.extend(_audit_contact_directory_bundle(bundle))

    return SelectedWritePreviewRecordAuditResult(
        selected_write_id=selected_write_id,
        collection=collection,
        inventory_id=inventory_id,
        passed=not failures,
        failures=tuple(failures),
    )


def _audit_service_guide_bundle(bundle: dict[str, Any]) -> list[str]:
    records = bundle.get("service_guide_records")
    if not isinstance(records, list) or not records or not isinstance(records[0], dict):
        return ["service_guide bundle must contain at least one record"]
    record = dict(records[0])
    failures: list[str] = []
    source_refs = _string_list(record.get("source_refs"))
    if not source_refs:
        failures.append("missing source_refs for service_guide selected-write preview")
    field_status = record.get("field_status")
    if not isinstance(field_status, dict):
        failures.append("missing field_status for service_guide selected-write preview")
    else:
        for required_field in (
            "service_name",
            "process_steps",
            "source_url",
            "source_version_evidence",
        ):
            if str(field_status.get(required_field) or "").strip() != "present":
                failures.append(f"service_guide field_status {required_field} must be present")
        if str(field_status.get("service_entry") or "").strip() == "present" and not _labels(
            record.get("entry_refs")
        ):
            failures.append("service_entry marked present but entry_refs is empty")
    section_types = set(_section_types(record.get("guide_sections")))
    if "procedure" not in section_types:
        failures.append("missing procedure section for service_guide selected-write preview")
    procedure_groups = _procedure_groups(record.get("procedure_groups"))
    if procedure_groups:
        for group in procedure_groups:
            group_source_refs = _string_list(group.get("source_refs"))
            if not group_source_refs:
                failures.append("service_guide procedure_group missing source_refs")
            steps = _mapping_list(group.get("steps"))
            if not steps:
                failures.append("service_guide procedure_group missing steps")
                continue
            for step in steps:
                if not str(step.get("content") or "").strip():
                    failures.append("service_guide procedure_group step missing content")
                if not _string_list(step.get("source_refs")):
                    failures.append("service_guide procedure_group step missing source_refs")
    failures.extend(_audit_known_service_guide_composition(record, source_refs))
    return failures


def _audit_known_service_guide_composition(
    record: dict[str, Any],
    source_refs: list[str],
) -> list[str]:
    display_name = str(record.get("display_name") or "").strip()
    service_id = str(record.get("service_id") or "").strip()
    normalized_refs = set(source_refs)
    failures: list[str] = []
    if (
        "信息公开" in display_name
        or service_id == "service:official-web:information-disclosure-application"
    ):
        required_refs = (
            "https://xxgk.muc.edu.cn/info/1007/1113.htm",
            "https://xxgk.muc.edu.cn/info/1007/1114.htm",
        )
        for required_ref in required_refs:
            if required_ref not in normalized_refs:
                failures.append(
                    "information disclosure service guide must include material/source page: "
                    f"{required_ref}"
                )
    return failures


def _audit_contact_directory_bundle(bundle: dict[str, Any]) -> list[str]:
    records = bundle.get("contact_records")
    if not isinstance(records, list) or not records or not isinstance(records[0], dict):
        return ["contact_directory bundle must contain at least one record"]
    record = dict(records[0])
    failures: list[str] = []
    if str(record.get("extraction_status") or "").strip() != "ready":
        failures.append("contact_directory extraction_status must be ready")
    if not _string_list(record.get("source_refs")):
        failures.append("missing source_refs for contact_directory selected-write preview")
    field_status = record.get("field_status")
    if not isinstance(field_status, dict):
        failures.append("missing field_status for contact_directory selected-write preview")
    else:
        for required_field in (
            "organization_name",
            "phone",
            "source_url",
            "source_version_evidence",
        ):
            if str(field_status.get(required_field) or "").strip() != "present":
                failures.append(f"contact_directory field_status {required_field} must be present")
    if not _string_list(record.get("aliases")):
        failures.append("missing aliases for contact_directory selected-write preview")
    phones = record.get("phones")
    if not isinstance(phones, list) or not any(
        isinstance(item, dict) and str(item.get("number") or "").strip() for item in phones
    ):
        failures.append("missing phones for contact_directory selected-write preview")
    return failures


def _non_empty_list(value: object) -> bool:
    return bool(_string_list(value))


def _string_list(value: object) -> list[str]:
    if not isinstance(value, list | tuple):
        return []
    return [str(item).strip() for item in value if str(item).strip()]


def _labels(value: object) -> list[str]:
    if not isinstance(value, list | tuple):
        return []
    labels: list[str] = []
    for item in value:
        if not isinstance(item, dict):
            continue
        text = str(item.get("label") or "").strip()
        if text:
            labels.append(text)
    return labels


def _section_types(value: object) -> list[str]:
    if not isinstance(value, list | tuple):
        return []
    section_types: list[str] = []
    for item in value:
        if not isinstance(item, dict):
            continue
        text = str(item.get("section_type") or "").strip()
        if text:
            section_types.append(text)
    return section_types


def _mapping_list(value: object) -> list[dict[str, Any]]:
    if not isinstance(value, list | tuple):
        return []
    return [dict(item) for item in value if isinstance(item, dict)]


def _procedure_groups(value: object) -> list[dict[str, Any]]:
    return _mapping_list(value)


__all__ = [
    "SelectedWritePreviewRecordAuditResult",
    "SelectedWritePreviewToolReadinessAuditReport",
    "audit_selected_write_preview_report",
]
