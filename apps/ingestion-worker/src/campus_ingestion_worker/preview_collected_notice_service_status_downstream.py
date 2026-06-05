from __future__ import annotations

import argparse
import json
from collections.abc import Sequence
from pathlib import Path

from campus_ingestion_core.collected_notice_service_status_downstream_replay import (
    CollectedNoticeServiceStatusReplayPreview,
    build_service_status_batch_preview_from_paths,
    preview_to_output_files,
)

from campus_ingestion_worker.env_bootstrap import load_worker_env

DEFAULT_PHASE_04_INPUT_DIR = Path(
    "var/ingestion-evidence/collected-notice-consumption-replay-closeout/"
    "evidence/phase-04-dry-run-reimport-and-universal-search-preview"
)
DEFAULT_PHASE_05_INPUT_DIR = Path(
    "var/ingestion-evidence/collected-notice-consumption-replay-closeout/"
    "evidence/phase-05-multimodal-ocr-consumption-readiness"
)
DEFAULT_OUTPUT_DIR = Path(
    "var/ingestion-evidence/collected-notice-consumption-replay-closeout/"
    "evidence/phase-06-batched-downstream-replay/"
    "batch-service-status"
)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Preview Phase 6 service_status downstream replay without writes."
    )
    parser.add_argument(
        "--searchable-notice-preview-path",
        default=str(DEFAULT_PHASE_04_INPUT_DIR / "searchable-notice-preview.json"),
    )
    parser.add_argument(
        "--multimodal-candidate-inventory-path",
        default=str(DEFAULT_PHASE_05_INPUT_DIR / "multimodal-candidate-inventory.json"),
    )
    parser.add_argument("--output-dir", default=str(DEFAULT_OUTPUT_DIR))
    parser.add_argument("--generated-at", default="")
    return parser


def main(argv: Sequence[str] | None = None) -> None:
    load_worker_env()
    args = build_parser().parse_args(list(argv) if argv is not None else None)
    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    preview = build_service_status_batch_preview_from_paths(
        searchable_notice_preview_path=Path(args.searchable_notice_preview_path),
        multimodal_candidate_inventory_path=Path(args.multimodal_candidate_inventory_path),
        generated_at=str(args.generated_at or "") or None,
    )
    files = write_preview_evidence_files(preview=preview, output_dir=output_dir)
    admission_counts = preview.admission_manifest["counts"]
    print(
        json.dumps(
            {
                "mode": "dry_run",
                "write_enabled": False,
                "current_promotion_enabled": False,
                "target": "service_status",
                "source_notice_ids": preview.replay_dry_run["source_notice_ids"],
                "output_dir": str(output_dir),
                "files": {name: str(path) for name, path in files.items()},
                "entry_count": admission_counts["entry_count"],
                "downstream_admitted": admission_counts["downstream_admitted"],
                "needs_multimodal": admission_counts["needs_multimodal"],
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
    preview: CollectedNoticeServiceStatusReplayPreview,
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
    "CollectedNoticeServiceStatusReplayPreview",
    "build_parser",
    "build_service_status_batch_preview_from_paths",
    "main",
    "preview_to_output_files",
    "write_preview_evidence_files",
]


if __name__ == "__main__":
    main()
