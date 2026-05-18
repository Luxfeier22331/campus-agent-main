from __future__ import annotations

import json
from pathlib import Path


def build_service_guide_quality_summary(
    *,
    preview_report: dict[str, object],
    task_scope_runtime_report: object,
    full_impact_runtime_report: object,
    target_inventory_path: Path,
) -> dict[str, object]:
    inventory_lookup = _load_target_inventory_lookup(target_inventory_path)
    runtime_cases = [
        *_runtime_case_payloads(task_scope_runtime_report),
        *_runtime_case_payloads(full_impact_runtime_report),
    ]
    runtime_cases_by_inventory: dict[str, list[dict[str, object]]] = {}
    for case in runtime_cases:
        inventory_id = str(case.get("inventory_id") or "").strip()
        if not inventory_id:
            continue
        runtime_cases_by_inventory.setdefault(inventory_id, []).append(case)
    services_by_inventory: dict[str, dict[str, object]] = {}
    results = preview_report.get("results")
    if not isinstance(results, list):
        raise ValueError("selected-write preview report results must be a list")
    for item in results:
        if not isinstance(item, dict):
            continue
        if str(item.get("collection") or "").strip() != "service_guide":
            continue
        for bundle_name in ("bundle", "full_bundle"):
            bundle = item.get(bundle_name)
            if not isinstance(bundle, dict):
                continue
            for record in _mapping_list(bundle.get("service_guide_records")):
                inventory_id = _inventory_id_for_service_record(record, inventory_lookup)
                if not inventory_id:
                    continue
                services_by_inventory[inventory_id] = _service_quality_payload(
                    inventory_id=inventory_id,
                    record=record,
                    runtime_cases=runtime_cases_by_inventory.get(inventory_id, []),
                )
    targets = sorted(
        services_by_inventory.values(),
        key=lambda item: str(item.get("display_name") or ""),
    )
    return {
        "schema_version": "official_web_service_guide_no_promotion_quality_summary.v1",
        "service_count": len(targets),
        "service_guide_targets": targets,
    }


def _load_target_inventory_lookup(path: Path) -> dict[str, dict[str, object]]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    entries = payload.get("entries")
    if not isinstance(entries, list):
        raise ValueError("target inventory entries must be a list")
    lookup: dict[str, dict[str, object]] = {}
    for entry in entries:
        if not isinstance(entry, dict):
            continue
        if str(entry.get("selected_write_target") or "").strip() != "campus_services/service_guide":
            continue
        inventory_id = str(entry.get("inventory_id") or "").strip()
        if not inventory_id:
            continue
        lookup[inventory_id] = dict(entry)
    return lookup


def _runtime_case_payloads(report: object) -> list[dict[str, object]]:
    case_results = getattr(report, "case_results", ())
    payloads: list[dict[str, object]] = []
    for item in case_results:
        payloads.append(
            {
                "case_id": str(getattr(item, "case_id", "") or "").strip(),
                "inventory_id": str(getattr(item, "inventory_id", "") or "").strip(),
                "selected_write_id": str(getattr(item, "selected_write_id", "") or "").strip(),
                "passed": bool(getattr(item, "passed", False)),
                "failures": list(getattr(item, "failures", ()) or ()),
                "observed": dict(getattr(item, "observed", {}) or {}),
            }
        )
    return payloads


def _inventory_id_for_service_record(
    record: dict[str, object],
    inventory_lookup: dict[str, dict[str, object]],
) -> str:
    source_refs = set(_string_list(record.get("source_refs")))
    display_name = str(record.get("display_name") or "").strip()
    for inventory_id, entry in inventory_lookup.items():
        if display_name and display_name == str(entry.get("target_label") or "").strip():
            return inventory_id
        if source_refs & set(_string_list(entry.get("source_urls"))):
            return inventory_id
    return ""


def _service_quality_payload(
    *,
    inventory_id: str,
    record: dict[str, object],
    runtime_cases: list[dict[str, object]],
) -> dict[str, object]:
    procedure_groups = _mapping_list(record.get("procedure_groups"))
    materials = _mapping_list(record.get("materials"))
    field_status = dict(record.get("field_status") or {})
    source_refs = set(_string_list(record.get("source_refs")))
    entry_refs = _mapping_list(record.get("entry_refs"))
    material_noise_count = 0
    for material in materials:
        refs = _string_list(material.get("source_refs"))
        if not refs:
            material_noise_count += 1
    source_ref_coverage_missing = 0
    step_count_by_group: dict[str, int] = {}
    for group in procedure_groups:
        group_id = str(group.get("group_id") or "").strip()
        steps = _mapping_list(group.get("steps"))
        step_count_by_group[group_id] = len(steps)
        if not _string_list(group.get("source_refs")):
            source_ref_coverage_missing += 1
        for step in steps:
            if not _string_list(step.get("source_refs")):
                source_ref_coverage_missing += 1
    source_not_provided_fields = sorted(
        field_name
        for field_name, status in field_status.items()
        if str(status or "").strip() == "source_not_provided"
    )
    present_fields = sorted(
        field_name
        for field_name, status in field_status.items()
        if str(status or "").strip() == "present"
    )
    entry_urls = [
        str(item.get("url") or "").strip()
        for item in entry_refs
        if str(item.get("url") or "").strip()
    ]
    selected_section_ids = sorted(
        {
            section_id
            for case in runtime_cases
            for section_id in _string_list(case.get("observed", {}).get("selected_section_ids"))
        }
    )
    omitted_section_ids = sorted(
        {
            section_id
            for case in runtime_cases
            for section_id in _string_list(case.get("observed", {}).get("omitted_section_ids"))
        }
    )
    return {
        "inventory_id": inventory_id,
        "display_name": str(record.get("display_name") or "").strip(),
        "procedure_group_count": len(procedure_groups),
        "step_count_by_group": step_count_by_group,
        "selected_section_ids": selected_section_ids,
        "omitted_section_ids": omitted_section_ids,
        "material_noise_count": material_noise_count,
        "entry_url_coverage": {
            "status": "present" if entry_urls else "source_not_provided",
            "entry_urls": entry_urls,
        },
        "field_source_coverage": {
            "present_fields": present_fields,
            "source_not_provided_fields": source_not_provided_fields,
        },
        "source_ref_coverage": {
            "record_source_ref_count": len(source_refs),
            "missing_nested_source_ref_count": source_ref_coverage_missing,
        },
        "runtime_cases": [
            {
                "case_id": case["case_id"],
                "selected_write_id": case["selected_write_id"],
                "passed": case["passed"],
                "failures": case["failures"],
                "guide_focus": str(case.get("observed", {}).get("guide_focus") or "").strip(),
                "selected_section_ids": _string_list(
                    case.get("observed", {}).get("selected_section_ids")
                ),
                "omitted_section_ids": _string_list(
                    case.get("observed", {}).get("omitted_section_ids")
                ),
            }
            for case in runtime_cases
        ],
    }


def _mapping_list(value: object) -> list[dict[str, object]]:
    if not isinstance(value, list):
        return []
    return [dict(item) for item in value if isinstance(item, dict)]


def _mapping(value: object) -> dict[str, object]:
    if not isinstance(value, dict):
        return {}
    return dict(value)


def _unique_strings(values: list[object]) -> list[str]:
    seen: set[str] = set()
    ordered: list[str] = []
    for value in values:
        text = str(value or "").strip()
        if not text or text in seen:
            continue
        seen.add(text)
        ordered.append(text)
    return ordered


def _string_list(value: object) -> list[str]:
    if isinstance(value, str):
        return [value.strip()] if value.strip() else []
    if not isinstance(value, list):
        return []
    return [str(item).strip() for item in value if str(item).strip()]
