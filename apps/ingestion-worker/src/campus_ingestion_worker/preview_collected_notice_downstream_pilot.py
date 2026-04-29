from __future__ import annotations

import argparse
import json
from collections.abc import Sequence
from pathlib import Path

from campus_ingestion_core.collected_notice_downstream_pilot import (
    CollectedNoticeDownstreamPilotPreview,
    build_transport_schedule_batch_preview_from_paths,
    build_transport_schedule_single_notice_pilot_preview_from_paths,
    preview_to_output_files,
)

from campus_ingestion_worker.env_bootstrap import load_worker_env

DEFAULT_PHASE_04_INPUT_DIR = Path(
    ".planning/workstreams/collected-notice-consumption-replay-closeout/"
    "evidence/phase-04-dry-run-reimport-and-universal-search-preview"
)
DEFAULT_PHASE_05_INPUT_DIR = Path(
    ".planning/workstreams/collected-notice-consumption-replay-closeout/"
    "evidence/phase-05-multimodal-ocr-consumption-readiness"
)
DEFAULT_PILOT_OUTPUT_DIR = Path(
    ".planning/workstreams/collected-notice-consumption-replay-closeout/"
    "evidence/phase-06-batched-downstream-replay/"
    "pilot-transport-schedule-355512"
)
DEFAULT_BATCH_OUTPUT_DIR = Path(
    ".planning/workstreams/collected-notice-consumption-replay-closeout/"
    "evidence/phase-06-batched-downstream-replay/"
    "batch-transport-schedule"
)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Preview Phase 6 single-notice downstream pilot without writes."
    )
    parser.add_argument(
        "--mode",
        choices=("pilot", "batch"),
        default="pilot",
        help="Preview one pilot notice or the whole transport_schedule target batch.",
    )
    parser.add_argument(
        "--searchable-notice-preview-path",
        default=str(DEFAULT_PHASE_04_INPUT_DIR / "searchable-notice-preview.json"),
    )
    parser.add_argument(
        "--multimodal-candidate-inventory-path",
        default=str(DEFAULT_PHASE_05_INPUT_DIR / "multimodal-candidate-inventory.json"),
    )
    parser.add_argument("--source-notice-id", default="355512")
    parser.add_argument("--output-dir", default="")
    parser.add_argument(
        "--transport-baseline-effective-date",
        default="",
        help="Official transport baseline effective date, e.g. 2026-03-01. Empty means missing.",
    )
    parser.add_argument(
        "--transport-baseline-source-notice-id",
        action="append",
        default=[],
        help="Notice id covered by the imported official transport baseline.",
    )
    return parser


def main(argv: Sequence[str] | None = None) -> None:
    load_worker_env()
    args = build_parser().parse_args(list(argv) if argv is not None else None)
    output_dir = Path(
        args.output_dir
        or (DEFAULT_BATCH_OUTPUT_DIR if args.mode == "batch" else DEFAULT_PILOT_OUTPUT_DIR)
    )
    output_dir.mkdir(parents=True, exist_ok=True)
    if args.mode == "batch":
        preview = build_transport_schedule_batch_preview_from_paths(
            searchable_notice_preview_path=Path(args.searchable_notice_preview_path),
            multimodal_candidate_inventory_path=Path(args.multimodal_candidate_inventory_path),
            transport_baseline_effective_date=str(args.transport_baseline_effective_date),
            transport_baseline_source_notice_ids=tuple(args.transport_baseline_source_notice_id),
        )
    else:
        preview = build_transport_schedule_single_notice_pilot_preview_from_paths(
            searchable_notice_preview_path=Path(args.searchable_notice_preview_path),
            multimodal_candidate_inventory_path=Path(args.multimodal_candidate_inventory_path),
            source_notice_id=str(args.source_notice_id),
            transport_baseline_effective_date=str(args.transport_baseline_effective_date),
            transport_baseline_source_notice_ids=tuple(args.transport_baseline_source_notice_id),
        )
    files = write_preview_evidence_files(preview=preview, output_dir=output_dir)
    admission_counts = preview.admission_manifest["counts"]
    source_scope = (
        {"source_notice_ids": preview.replay_dry_run.get("source_notice_ids", [])}
        if args.mode == "batch"
        else {"source_notice_id": str(args.source_notice_id)}
    )
    print(
        json.dumps(
            {
                "mode": "dry_run",
                "selection_mode": str(args.mode),
                "write_enabled": False,
                "current_promotion_enabled": False,
                "target": "transport_schedule",
                "transport_baseline_status": (
                    preview.admission_manifest.get("transport_baseline", {}).get("status", "")
                ),
                "transport_baseline_effective_date": (
                    preview.admission_manifest.get("transport_baseline", {}).get(
                        "effective_date", ""
                    )
                ),
                "transport_baseline_source_notice_ids": (
                    preview.admission_manifest.get("transport_baseline", {}).get(
                        "source_notice_ids", []
                    )
                ),
                **source_scope,
                "output_dir": str(output_dir),
                "files": {name: str(path) for name, path in files.items()},
                "entry_count": admission_counts.get("entry_count", 0),
                "downstream_admitted": admission_counts["downstream_admitted"],
                "rejected_deferred_count": preview.rejected_deferred_source_report["entry_count"],
                "stage_candidate_count": preview.stage_report["stage_candidate_count"],
                "consistency_verdict": preview.consistency_report["verdict"],
            },
            ensure_ascii=False,
            indent=2,
        )
    )


def write_preview_evidence_files(
    *,
    preview: CollectedNoticeDownstreamPilotPreview,
    output_dir: Path,
) -> dict[str, Path]:
    written: dict[str, Path] = {}
    for filename, payload in preview_to_output_files(preview).items():
        path = output_dir / filename
        path.write_text(
            json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
        written[filename] = path
    return written


__all__ = [
    "CollectedNoticeDownstreamPilotPreview",
    "build_parser",
    "build_transport_schedule_batch_preview_from_paths",
    "build_transport_schedule_single_notice_pilot_preview_from_paths",
    "main",
    "preview_to_output_files",
    "write_preview_evidence_files",
]


if __name__ == "__main__":
    main()
