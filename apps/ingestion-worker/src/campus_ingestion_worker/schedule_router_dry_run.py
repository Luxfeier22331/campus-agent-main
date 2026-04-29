from __future__ import annotations

import argparse
import json
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import asdict, dataclass
from pathlib import Path

from campus_ingestion_core.internal_notice_schedule_router import (
    ScheduleNoticeImageRoute,
    build_schedule_routing_input_from_inventory_row,
    route_schedule_notice_images,
)


@dataclass(frozen=True, slots=True)
class ScheduleRouterDryRunResult:
    report_payload: Mapping[str, object]
    summary_payload: Mapping[str, object]
    image_ocr_inventory: tuple[dict[str, object], ...]
    body_schedule_inventory: tuple[dict[str, object], ...]
    skipped_visual_inventory: tuple[dict[str, object], ...]


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Route authenticated notice schedule image candidates using text context only.",
    )
    parser.add_argument("--evidence-inventory", required=True)
    parser.add_argument("--output-dir", required=True)
    parser.add_argument("--run-id", required=True)
    return parser


def main(argv: Sequence[str] | None = None) -> None:
    args = build_parser().parse_args(argv)
    result = run_schedule_router_dry_run(
        inventory_path=Path(args.evidence_inventory),
        output_dir=Path(args.output_dir),
        run_id=str(args.run_id),
    )
    print(json.dumps(result.summary_payload, ensure_ascii=False, indent=2))


def run_schedule_router_dry_run(
    *,
    inventory_path: Path,
    output_dir: Path,
    run_id: str,
) -> ScheduleRouterDryRunResult:
    output_dir.mkdir(parents=True, exist_ok=True)
    raw_rows = _load_inventory_rows(inventory_path)
    result = route_schedule_inventory_rows(
        raw_rows=raw_rows,
        run_id=run_id,
        source_inventory=str(inventory_path),
    )
    _write_json(output_dir / "_router-dry-run.json", result.report_payload)
    _write_json(output_dir / "_image-ocr-inventory.json", result.image_ocr_inventory)
    _write_json(output_dir / "_body-schedule-inventory.json", result.body_schedule_inventory)
    _write_json(output_dir / "_skipped-visual-inventory.json", result.skipped_visual_inventory)
    return result


def route_schedule_inventory_rows(
    *,
    raw_rows: Sequence[Mapping[str, object]],
    run_id: str,
    source_inventory: str,
) -> ScheduleRouterDryRunResult:
    entries = tuple(build_schedule_routing_input_from_inventory_row(row) for row in raw_rows)
    report = route_schedule_notice_images(entries)
    route_by_key = {
        (route.notice_id, route.attachment_ref_id, route.image_index): route
        for route in report.routes
    }

    report_payload = {
        "run_id": run_id,
        "source_inventory": source_inventory,
        "remote_write_status": "not_written_pg_or_object_storage",
        **asdict(report),
    }
    image_ocr_inventory = tuple(
        _with_route(raw, route_by_key)
        for raw in raw_rows
        if route_by_key[_route_key(raw)].should_run_image_ocr
    )
    body_schedule_inventory = tuple(
        _dedupe_notice_rows(
            _with_route(raw, route_by_key)
            for raw in raw_rows
            if route_by_key[_route_key(raw)].should_run_body_extractor
        )
    )
    skipped_visual_inventory = tuple(
        _with_route(raw, route_by_key)
        for raw in raw_rows
        if route_by_key[_route_key(raw)].image_action == "visual_or_guide"
    )
    summary_payload = {
        "run_id": run_id,
        "image_count": report.image_count,
        "notice_count": report.notice_count,
        "image_ocr_count": report.image_ocr_count,
        "body_schedule_count": report.body_schedule_count,
        "skipped_visual_count": report.skipped_visual_count,
        "needs_review_count": report.needs_review_count,
        "counts": dict(report.counts),
        "remote_write_status": "not_written_pg_or_object_storage",
    }
    return ScheduleRouterDryRunResult(
        report_payload=report_payload,
        summary_payload=summary_payload,
        image_ocr_inventory=image_ocr_inventory,
        body_schedule_inventory=body_schedule_inventory,
        skipped_visual_inventory=skipped_visual_inventory,
    )


def _load_inventory_rows(path: Path) -> list[dict[str, object]]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(payload, list):
        raise ValueError("schedule router evidence inventory must be a JSON list")
    return [dict(item) for item in payload if isinstance(item, Mapping)]


def _with_route(
    raw: Mapping[str, object],
    route_by_key: Mapping[tuple[str, str, int], ScheduleNoticeImageRoute],
) -> dict[str, object]:
    route = route_by_key[_route_key(raw)]
    payload = dict(raw)
    payload["schedule_router"] = asdict(route)
    return payload


def _route_key(raw: Mapping[str, object]) -> tuple[str, str, int]:
    entry = build_schedule_routing_input_from_inventory_row(raw)
    return (entry.notice_id, entry.attachment_ref_id, entry.image_index)


def _dedupe_notice_rows(rows: Iterable[dict[str, object]]) -> list[dict[str, object]]:
    deduped: dict[str, dict[str, object]] = {}
    for row in rows:
        notice_id = str(row.get("notice_id") or "")
        if notice_id and notice_id not in deduped:
            deduped[notice_id] = row
    return list(deduped.values())


def _write_json(path: Path, payload: object) -> None:
    path.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True),
        encoding="utf-8",
    )


if __name__ == "__main__":
    main()
