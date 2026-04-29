from __future__ import annotations

import argparse
import json
from collections.abc import Mapping, Sequence
from pathlib import Path
from typing import Any

from campus_ingestion_core.collected_notice_schedule_image_ocr_mini_batch import (
    build_schedule_image_ocr_mini_batch_manifest_from_paths,
    build_schedule_image_ocr_mini_batch_post_run_preview_from_paths,
    mini_batch_manifest_output_files,
    mini_batch_post_run_output_files,
)

from campus_ingestion_worker.env_bootstrap import load_worker_env


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Preview Phase 6.3 baseline-aware schedule image OCR mini-batch.",
    )
    parser.add_argument(
        "--mode",
        choices=("manifest", "post-run", "post_run"),
        default="manifest",
    )
    parser.add_argument("--consumer-admission-manifest-path")
    parser.add_argument("--multimodal-candidate-inventory-path")
    parser.add_argument("--searchable-notice-preview-path")
    parser.add_argument("--execution-manifest-path")
    parser.add_argument("--ocr-output-dir")
    parser.add_argument("--output-dir", required=True)
    return parser


def main(argv: Sequence[str] | None = None) -> None:
    load_worker_env()
    args = build_parser().parse_args(argv)
    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    mode = _normalize_mode(args.mode)
    if mode == "manifest":
        payload = build_schedule_image_ocr_mini_batch_manifest_from_paths(
            consumer_admission_manifest_path=_required_path(
                args.consumer_admission_manifest_path,
                "--consumer-admission-manifest-path",
            ),
            multimodal_candidate_inventory_path=_required_path(
                args.multimodal_candidate_inventory_path,
                "--multimodal-candidate-inventory-path",
            ),
        )
        _write_outputs(output_dir=output_dir, outputs=mini_batch_manifest_output_files(payload))
        counts = payload["execution_manifest"].get("counts") or {}
        summary = {
            "mode": "manifest",
            "write_enabled": False,
            "selected_notice_count": counts.get("selected_notice_count", 0),
            "selected_image_count": counts.get("selected_image_count", 0),
            "blocked_candidate_count": payload["gap_report"].get("blocked_candidate_count", 0),
        }
    else:
        payload = build_schedule_image_ocr_mini_batch_post_run_preview_from_paths(
            searchable_notice_preview_path=_required_path(
                args.searchable_notice_preview_path,
                "--searchable-notice-preview-path",
            ),
            execution_manifest_path=_required_path(
                args.execution_manifest_path,
                "--execution-manifest-path",
            ),
            ocr_output_dir=_required_path(args.ocr_output_dir, "--ocr-output-dir"),
        )
        _write_outputs(output_dir=output_dir, outputs=mini_batch_post_run_output_files(payload))
        summary = {
            "mode": "post_run",
            "write_enabled": False,
            "current_promotion_enabled": False,
            "extracted_schedule_row_count": payload["transport_replay_dry_run"][
                "extracted_schedule_row_count"
            ],
            "stage_candidate_count": payload["transport_stage_report"]["stage_candidate_count"],
            "transport_consistency_verdict": payload["transport_consistency_report"]["verdict"],
            "gap_verdict": payload["post_run_gap_report"]["verdict"],
        }
    print(json.dumps(summary, ensure_ascii=False, indent=2, sort_keys=True))


def _write_outputs(*, output_dir: Path, outputs: Mapping[str, Any]) -> None:
    for filename, payload in outputs.items():
        suffix = "\n" if filename.endswith(".json") else ""
        (output_dir / filename).write_text(
            json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True) + suffix,
            encoding="utf-8",
        )


def _required_path(value: str | None, label: str) -> Path:
    if not value:
        raise ValueError(f"{label} is required")
    return Path(value)


def _normalize_mode(value: str) -> str:
    normalized = str(value or "").strip().replace("_", "-")
    return "post-run" if normalized == "post-run" else "manifest"


if __name__ == "__main__":
    main()
