from __future__ import annotations

import argparse
import json
from dataclasses import asdict
from pathlib import Path
from typing import Any

from campus_ingestion_core import DEFAULT_BUCKET_SOURCE, ObjectStoreSettings
from campus_ingestion_core.local_rebuild import S3ObjectStoreAdmin
from campus_ingestion_core.official_web_release_task_store import (
    build_official_web_release_task_store_from_env,
)
from campus_ingestion_worker.env_bootstrap import load_worker_env
from campus_ingestion_worker.release_official_web_selected_write import (
    preview_official_web_selected_write,
)

DEFAULT_REPORT_NAME = "official-web-selected-write-preview-report.json"


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Preview ingestion-owned official_web selected-write tasks without current write.",
    )
    parser.add_argument("--task-id", action="append", dest="task_ids", default=[])
    parser.add_argument("--tasks-json-path")
    parser.add_argument("--output-dir", required=True)
    parser.add_argument("--source-bucket", default=DEFAULT_BUCKET_SOURCE)
    parser.add_argument("--derived-bucket")
    parser.add_argument("--declarations-path")
    return parser


def run_selected_write_preview(
    *,
    task_ids: list[str],
    output_dir: Path,
    source_bucket: str = DEFAULT_BUCKET_SOURCE,
    derived_bucket: str | None = None,
    declarations_path: Path | None = None,
    release_tasks: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    load_worker_env()
    settings = ObjectStoreSettings.from_env()
    object_store = S3ObjectStoreAdmin(settings)
    release_store = build_official_web_release_task_store_from_env()
    normalized_task_ids = [item.strip() for item in task_ids if item.strip()]
    normalized_release_tasks = [
        dict(item) for item in (release_tasks or []) if isinstance(item, dict)
    ]
    if not normalized_task_ids and not normalized_release_tasks:
        raise ValueError("at least one task id is required")
    output_dir.mkdir(parents=True, exist_ok=True)
    results: list[dict[str, Any]] = []
    tasks_to_preview: list[tuple[str, dict[str, Any], str, str]] = []
    for task_id in normalized_task_ids:
        task = release_store.get_task(task_id)
        if task is None:
            raise RuntimeError(f"official web release task not found: {task_id}")
        tasks_to_preview.append(
            (
                task_id,
                {**task.to_payload(), "status": "claimed"},
                task.task_type,
                task.inventory_id,
            )
        )
    for task_payload in normalized_release_tasks:
        task_id = str(task_payload.get("taskId") or task_payload.get("task_id") or "").strip()
        if not task_id:
            raise ValueError("release task payload must contain taskId")
        tasks_to_preview.append(
            (
                task_id,
                {**task_payload, "status": "claimed"},
                str(task_payload.get("taskType") or task_payload.get("task_type") or "").strip(),
                str(task_payload.get("inventoryId") or task_payload.get("inventory_id") or "").strip(),
            )
        )
    for task_id, release_task_payload, task_type, inventory_id in tasks_to_preview:
        task_output_dir = output_dir / task_id
        preview = preview_official_web_selected_write(
            release_task=release_task_payload,
            object_store=object_store,
            work_dir=task_output_dir,
            object_store_settings=settings,
            source_bucket=source_bucket,
            derived_bucket=derived_bucket,
            declarations_path=declarations_path,
        )
        results.append(
            {
                **asdict(preview),
                "bundle_path": str(
                    (task_output_dir / "preview-output" / "projection-bundle.json").resolve()
                ),
                "full_bundle_path": str(
                    (task_output_dir / "preview-output" / "full-projection-bundle.json").resolve()
                ),
                "task_scope_display_names": _projection_display_names(
                    preview.bundle,
                    preview.collection,
                ),
                "full_impact_display_names": _projection_display_names(
                    preview.full_bundle,
                    preview.collection,
                ),
                "task_type": task_type,
                "inventory_id": inventory_id,
            }
        )
    summary = {
        "task_count": len(results),
        "collections": _count_by_field(results, "collection"),
        "inventories": [result["inventory_id"] for result in results],
        "task_ids": [result["selected_write_id"] for result in results],
        "task_scope_record_count": sum(int(result.get("record_count") or 0) for result in results),
        "full_record_count": sum(int(result.get("full_record_count") or 0) for result in results),
    }
    report = {
        "schema_version": "official_web_selected_write_preview_report.v1",
        "output_dir": str(output_dir.resolve()),
        "summary": summary,
        "results": results,
    }
    (output_dir / DEFAULT_REPORT_NAME).write_text(
        json.dumps(report, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    return report


def _count_by_field(results: list[dict[str, Any]], field_name: str) -> dict[str, int]:
    counts: dict[str, int] = {}
    for result in results:
        key = str(result.get(field_name) or "").strip()
        if not key:
            continue
        counts[key] = counts.get(key, 0) + 1
    return counts


def _projection_display_names(bundle: dict[str, Any], collection: str) -> list[str]:
    if collection == "service_guide":
        records = bundle.get("service_guide_records")
    elif collection == "contact_directory":
        records = bundle.get("contact_records")
    else:
        records = []
    if not isinstance(records, list):
        return []
    names: list[str] = []
    for item in records:
        if not isinstance(item, dict):
            continue
        text = str(item.get("display_name") or "").strip()
        if text:
            names.append(text)
    return names


def _load_task_ids_from_args(args: argparse.Namespace) -> list[str]:
    task_ids = list(args.task_ids or [])
    if args.tasks_json_path:
        payload = json.loads(Path(args.tasks_json_path).read_text(encoding="utf-8"))
        if not isinstance(payload, list):
            raise ValueError("tasks json must be an array of task ids")
        task_ids.extend(str(item) for item in payload)
    return task_ids


def main(argv: list[str] | None = None) -> None:
    args = build_parser().parse_args(argv)
    report = run_selected_write_preview(
        task_ids=_load_task_ids_from_args(args),
        output_dir=Path(args.output_dir).resolve(),
        source_bucket=args.source_bucket,
        derived_bucket=args.derived_bucket,
        declarations_path=Path(args.declarations_path).resolve()
        if args.declarations_path
        else None,
    )
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
