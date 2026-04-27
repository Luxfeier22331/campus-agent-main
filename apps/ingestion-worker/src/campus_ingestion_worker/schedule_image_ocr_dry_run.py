from __future__ import annotations

import argparse
import json
import os
from collections.abc import Mapping, Sequence
from dataclasses import asdict
from pathlib import Path

from campus_ingestion_core.internal_notice_schedule_image_ocr import (
    ChatCompletionsScheduleImageOcrProvider,
    ScheduleImageOcrProvider,
    ScheduleImageOcrProviderRequest,
    ScheduleImageOcrProviderResult,
    build_schedule_image_ocr_evidence_inventory_from_rows,
    load_schedule_image_ocr_evidence_inventory,
    run_schedule_image_ocr_dry_run,
)
from campus_ingestion_core.local_rebuild import S3ObjectStoreAdmin
from campus_ingestion_core.settings import ObjectStoreSettings

from campus_ingestion_worker.env_bootstrap import load_worker_env
from campus_ingestion_worker.schedule_router_dry_run import run_schedule_router_dry_run


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Run bounded OCR dry-run for selected authenticated notice schedule images.",
    )
    parser.add_argument("--evidence-inventory", required=True)
    parser.add_argument("--output-dir", required=True)
    parser.add_argument("--run-id", required=True)
    parser.add_argument("--source-bucket")
    parser.add_argument(
        "--fixture-provider-result",
        help="Local JSON fixture provider result for deterministic non-network dry-runs.",
    )
    parser.add_argument(
        "--skip-router",
        action="store_true",
        help="Bypass text router and send every eligible inventory image to OCR.",
    )
    return parser


def main(argv: Sequence[str] | None = None) -> None:
    load_worker_env()
    args = build_parser().parse_args(argv)
    settings = ObjectStoreSettings.from_env()
    source_bucket = args.source_bucket or settings.bucket_source
    object_store = S3ObjectStoreAdmin(settings)
    provider = build_schedule_image_ocr_provider_from_env(
        env=dict(os.environ),
        fixture_provider_result=Path(args.fixture_provider_result)
        if args.fixture_provider_result
        else None,
    )
    inventory_path = Path(args.evidence_inventory)
    output_dir = Path(args.output_dir)
    router_summary: Mapping[str, object] | None = None
    if args.skip_router:
        evidence_entries = load_schedule_image_ocr_evidence_inventory(inventory_path)
    else:
        router_result = run_schedule_router_dry_run(
            inventory_path=inventory_path,
            output_dir=output_dir,
            run_id=f"{args.run_id}:router",
        )
        router_summary = router_result.summary_payload
        evidence_entries = build_schedule_image_ocr_evidence_inventory_from_rows(
            router_result.image_ocr_inventory
        )
    report = run_schedule_image_ocr_dry_run(
        evidence_entries=evidence_entries,
        object_store=object_store,
        source_bucket=source_bucket,
        provider=provider,
        output_dir=output_dir,
        run_id=str(args.run_id),
    )
    payload = asdict(report)
    payload["router"] = router_summary or {
        "status": "skipped",
        "reason": "skip_router_flag",
    }
    payload["remote_write_status"] = "not_written_pg_or_object_storage"
    print(json.dumps(payload, ensure_ascii=False, indent=2))


def build_schedule_image_ocr_provider_from_env(
    *,
    env: Mapping[str, str] | None = None,
    fixture_provider_result: Path | None = None,
) -> ScheduleImageOcrProvider:
    if fixture_provider_result is not None:
        return _FixtureScheduleImageOcrProvider(fixture_provider_result)
    return ChatCompletionsScheduleImageOcrProvider.from_env(env)


class _FixtureScheduleImageOcrProvider:
    def __init__(self, path: Path) -> None:
        self._result = _load_fixture_provider_result(path)

    def process(self, request: ScheduleImageOcrProviderRequest) -> ScheduleImageOcrProviderResult:
        return self._result


def _load_fixture_provider_result(path: Path) -> ScheduleImageOcrProviderResult:
    payload = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        raise ValueError("fixture provider result must be a JSON object")
    return ScheduleImageOcrProviderResult(
        provider=str(payload.get("provider") or "fixture-ocr"),
        model=str(payload.get("model") or "fixture"),
        confidence=_confidence(str(payload.get("confidence") or "low")),
        extracted_text=str(payload.get("extracted_text") or ""),
        tables=_tables(payload.get("tables")),
        layout_elements=tuple(
            dict(item) for item in (payload.get("layout_elements") or ()) if isinstance(item, dict)
        ),
        raw_response=payload.get("raw_response") if "raw_response" in payload else payload,
    )


def _confidence(value: str) -> str:
    normalized = value.strip().lower()
    if normalized in {"high", "medium", "low"}:
        return normalized
    return "low"


def _tables(value: object) -> tuple[tuple[tuple[str, ...], ...], ...]:
    if not isinstance(value, list | tuple):
        return ()
    tables: list[tuple[tuple[str, ...], ...]] = []
    for raw_table in value:
        if not isinstance(raw_table, list | tuple):
            continue
        rows: list[tuple[str, ...]] = []
        for raw_row in raw_table:
            if isinstance(raw_row, list | tuple):
                rows.append(tuple(str(cell or "").strip() for cell in raw_row))
        if rows:
            tables.append(tuple(rows))
    return tuple(tables)


if __name__ == "__main__":
    main()
