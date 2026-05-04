from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

if __package__ in {None, ""}:
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from campus_evals.official_web_selected_write_preview_runtime_verifier import (
    BUNDLE_SCOPE_FULL_IMPACT,
    BUNDLE_SCOPE_TASK_SCOPE,
    run_selected_write_preview_runtime_verification,
)
from campus_evals.official_web_selected_write_tool_readiness_audit import (
    audit_selected_write_preview_report,
)
from campus_ingestion_core.official_web_release_task_admission import (
    admit_selected_write_release_tasks_from_review,
)
from campus_ingestion_core.official_web_release_task_store import (
    InMemoryOfficialWebReleaseTaskStore,
    build_official_web_release_task_store_from_env,
)
from campus_ingestion_worker.env_bootstrap import load_worker_env

from scripts.official_web_selected_write_preview import (
    DEFAULT_REPORT_NAME as DEFAULT_PREVIEW_REPORT_NAME,
)
from scripts.official_web_selected_write_preview import (
    run_selected_write_preview,
)

DEFAULT_TARGET_INVENTORY_PATH = (
    Path("configs")
    / "sources"
    / "official_web"
    / "muc_public"
    / "target-inventory.json"
)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description=(
            "Run service-guide-only no-promotion replay proof from an existing official-web "
            "source-pack live seam report."
        )
    )
    parser.add_argument("--seam-report", required=True)
    parser.add_argument("--output-dir", required=True)
    parser.add_argument("--target-inventory-path", default=str(DEFAULT_TARGET_INVENTORY_PATH))
    parser.add_argument("--source-bucket")
    parser.add_argument("--derived-bucket")
    parser.add_argument("--declarations-path")
    return parser


def resolve_service_guide_task_ids_from_seam_report(
    seam_report: dict[str, object],
    *,
    release_store: object,
) -> list[str]:
    consumer = seam_report.get("consumer")
    if not isinstance(consumer, dict):
        raise ValueError("seam report consumer must be an object")
    release_tasks = consumer.get("release_tasks")
    if not isinstance(release_tasks, dict):
        raise ValueError("seam report consumer.release_tasks must be an object")
    raw_task_ids = release_tasks.get("taskIds")
    if not isinstance(raw_task_ids, list):
        raise ValueError("seam report consumer.release_tasks.taskIds must be a list")
    resolved: list[str] = []
    for raw_task_id in raw_task_ids:
        task_id = str(raw_task_id or "").strip()
        if not task_id:
            continue
        task = release_store.get_task(task_id)
        if task is None:
            raise RuntimeError(f"official web release task not found: {task_id}")
        task_type = str(getattr(task, "task_type", "") or "").strip()
        selected_write_target = str(getattr(task, "selected_write_target", "") or "").strip()
        if (
            task_type == "official_web_selected_write_service_guide"
            and selected_write_target == "campus_services/service_guide"
        ):
            resolved.append(task_id)
    if not resolved:
        raise RuntimeError("no service-guide selected-write tasks found in seam report")
    return resolved


def build_service_guide_task_ids_from_execution_report(
    execution_report: dict[str, object],
) -> list[dict[str, object]]:
    review_report = execution_report.get("consumerCandidateReview")
    if not isinstance(review_report, dict):
        raise ValueError("execution report consumerCandidateReview must be an object")
    run_id = str(execution_report.get("runId") or "").strip()
    if not run_id:
        raise ValueError("execution report runId is required")
    bundle_object_key = str(execution_report.get("bundleObjectKey") or "").strip()
    if not bundle_object_key:
        raise ValueError("execution report bundleObjectKey is required")
    store = InMemoryOfficialWebReleaseTaskStore()
    tasks = admit_selected_write_release_tasks_from_review(
        release_task_store=store,
        review_report=review_report,
        run_id=run_id,
        source_object_keys=[bundle_object_key],
    )
    task_payloads = [
        task.to_payload()
        for task in tasks
        if task.task_type == "official_web_selected_write_service_guide"
        and task.selected_write_target == "campus_services/service_guide"
    ]
    if not task_payloads:
        raise RuntimeError("consumerCandidateReview produced no service-guide selected-write tasks")
    return task_payloads


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


def run_service_guide_no_promotion_proof(
    *,
    seam_report_path: Path,
    output_dir: Path,
    target_inventory_path: Path,
    source_bucket: str | None = None,
    derived_bucket: str | None = None,
    declarations_path: Path | None = None,
) -> dict[str, object]:
    load_worker_env()
    seam_report = json.loads(seam_report_path.read_text(encoding="utf-8"))
    if not isinstance(seam_report, dict):
        raise ValueError("seam report must be an object")
    execution_report_path = (
        seam_report_path.parent / "executions" / str(seam_report["event_id"]) / "execution-report.json"
    )
    task_ids: list[str]
    re_admitted_release_tasks: list[dict[str, object]] | None = None
    preview_task_source = "persisted_release_tasks"
    if execution_report_path.exists():
        execution_report = json.loads(execution_report_path.read_text(encoding="utf-8"))
        if not isinstance(execution_report, dict):
            raise ValueError("execution report must be an object")
        re_admitted_release_tasks = build_service_guide_task_ids_from_execution_report(
            execution_report
        )
        task_ids = [
            str(task.get("taskId") or task.get("task_id") or "").strip()
            for task in re_admitted_release_tasks
            if str(task.get("taskId") or task.get("task_id") or "").strip()
        ]
        preview_task_source = "re_admitted_from_consumer_candidate_review"
    else:
        release_store = build_official_web_release_task_store_from_env()
        task_ids = resolve_service_guide_task_ids_from_seam_report(
            seam_report,
            release_store=release_store,
        )
    output_dir.mkdir(parents=True, exist_ok=True)
    preview_output_dir = output_dir / "selected-write-preview"
    preview_report = run_selected_write_preview(
        task_ids=[] if re_admitted_release_tasks is not None else task_ids,
        output_dir=preview_output_dir,
        source_bucket=source_bucket or seam_report.get("source_bucket") or "campus-rag-source",
        derived_bucket=derived_bucket,
        declarations_path=declarations_path,
        release_tasks=re_admitted_release_tasks,
    )
    preview_report_path = preview_output_dir / DEFAULT_PREVIEW_REPORT_NAME
    readiness_audit = audit_selected_write_preview_report(
        report_path=preview_report_path,
        output_dir=output_dir / "tool-readiness-audit",
    )
    task_scope_runtime = run_selected_write_preview_runtime_verification(
        report_path=preview_report_path,
        output_dir=output_dir / "runtime-verification-task-scope",
        bundle_scope=BUNDLE_SCOPE_TASK_SCOPE,
    )
    full_impact_runtime = run_selected_write_preview_runtime_verification(
        report_path=preview_report_path,
        output_dir=output_dir / "runtime-verification-full-impact",
        bundle_scope=BUNDLE_SCOPE_FULL_IMPACT,
    )
    quality_summary = build_service_guide_quality_summary(
        preview_report=preview_report,
        task_scope_runtime_report=task_scope_runtime,
        full_impact_runtime_report=full_impact_runtime,
        target_inventory_path=target_inventory_path,
    )
    quality_summary_path = output_dir / "service-guide-quality-summary.json"
    quality_summary_path.write_text(
        json.dumps(quality_summary, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    report = {
        "schema_version": "official_web_service_guide_no_promotion_proof.v1",
        "seam_report_path": str(seam_report_path.resolve()),
        "preview_task_source": preview_task_source,
        "task_ids": task_ids,
        "preview_report_path": str(preview_report_path.resolve()),
        "tool_readiness_audit_path": str(readiness_audit.output_path.resolve()),
        "task_scope_runtime_verification_path": str(task_scope_runtime.output_path.resolve()),
        "full_impact_runtime_verification_path": str(full_impact_runtime.output_path.resolve()),
        "quality_summary_path": str(quality_summary_path.resolve()),
        "passed": bool(
            readiness_audit.passed and task_scope_runtime.passed and full_impact_runtime.passed
        ),
    }
    (output_dir / "service-guide-no-promotion-proof-report.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    return report


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


def _string_list(value: object) -> list[str]:
    if isinstance(value, str):
        return [value.strip()] if value.strip() else []
    if not isinstance(value, list):
        return []
    return [str(item).strip() for item in value if str(item).strip()]


def main(argv: list[str] | None = None) -> None:
    args = build_parser().parse_args(argv)
    report = run_service_guide_no_promotion_proof(
        seam_report_path=Path(args.seam_report).resolve(),
        output_dir=Path(args.output_dir).resolve(),
        target_inventory_path=Path(args.target_inventory_path).resolve(),
        source_bucket=args.source_bucket,
        derived_bucket=args.derived_bucket,
        declarations_path=Path(args.declarations_path).resolve()
        if args.declarations_path
        else None,
    )
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
