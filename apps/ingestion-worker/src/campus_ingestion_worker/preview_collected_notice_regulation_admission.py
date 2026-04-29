from __future__ import annotations

import argparse
import json
from collections.abc import Sequence
from pathlib import Path

from campus_ingestion_core.campusrag_ingestion_support import S3ObjectStoreWriter
from campus_ingestion_core.collected_notice_regulation_admission import (
    CollectedNoticeRegulationAdmissionPreview,
    build_collected_notice_regulation_admission_preview_from_paths,
    preview_to_output_files,
)
from campus_ingestion_core.settings import ObjectStoreSettings

from campus_ingestion_worker.env_bootstrap import load_worker_env

DEFAULT_PHASE_04_INPUT_DIR = Path(
    ".planning/workstreams/collected-notice-consumption-replay-closeout/"
    "evidence/phase-04-dry-run-reimport-and-universal-search-preview"
)
DEFAULT_PHASE_04_8_INPUT_DIR = Path(
    ".planning/workstreams/collected-notice-consumption-replay-closeout/"
    "evidence/phase-04-8-queue-consumer-reimport-path"
)
DEFAULT_PHASE_05_INPUT_DIR = Path(
    ".planning/workstreams/collected-notice-consumption-replay-closeout/"
    "evidence/phase-05-multimodal-ocr-consumption-readiness"
)
DEFAULT_OUTPUT_DIR = Path(
    ".planning/workstreams/collected-notice-consumption-replay-closeout/"
    "evidence/phase-06-r1-regulation-candidate-audit-and-admission"
)
DEFAULT_OWNER_TEXT_EXECUTION_REPORT_PATH = Path(
    ".planning/workstreams/collected-notice-consumption-replay-closeout/"
    "evidence/phase-06-r1b-regulation-owner-text-recovery-execution/"
    "regulation-owner-text-execution-report.json"
)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Preview Phase 6R.1 regulation candidate admission without writes."
    )
    parser.add_argument(
        "--searchable-notice-preview-path",
        default=str(DEFAULT_PHASE_04_INPUT_DIR / "searchable-notice-preview.json"),
    )
    parser.add_argument(
        "--multimodal-candidate-inventory-path",
        default=str(DEFAULT_PHASE_05_INPUT_DIR / "multimodal-candidate-inventory.json"),
    )
    parser.add_argument(
        "--queue-consume-trace-path",
        default=str(DEFAULT_PHASE_04_8_INPUT_DIR / "queue-consume.trace.json"),
    )
    parser.add_argument(
        "--owner-text-execution-report-path",
        default="",
        help=(
            "Optional Phase 6R.1b execution report. When set, the worker reads "
            "declared owner-text refs from object storage and overlays ready owner text "
            "before admission."
        ),
    )
    parser.add_argument("--output-dir", default=str(DEFAULT_OUTPUT_DIR))
    return parser


def main(argv: Sequence[str] | None = None) -> None:
    load_worker_env()
    args = build_parser().parse_args(list(argv) if argv is not None else None)
    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    owner_text_execution_report_path = _optional_report_path(args.owner_text_execution_report_path)
    preview = build_collected_notice_regulation_admission_preview_from_paths(
        searchable_notice_preview_path=Path(args.searchable_notice_preview_path),
        multimodal_candidate_inventory_path=Path(args.multimodal_candidate_inventory_path),
        queue_consume_trace_path=Path(args.queue_consume_trace_path),
        owner_text_execution_report_path=owner_text_execution_report_path,
        owner_text_object_store=build_runtime_object_store()
        if owner_text_execution_report_path is not None
        else None,
    )
    files = write_preview_evidence_files(preview=preview, output_dir=output_dir)
    counts = preview.admission_manifest["counts"]
    print(
        json.dumps(
            {
                "mode": "dry_run",
                "write_enabled": False,
                "current_promotion_enabled": False,
                "target": "regulation",
                "owner_text_execution_report_path": str(owner_text_execution_report_path or ""),
                "output_dir": str(output_dir),
                "files": {name: str(path) for name, path in files.items()},
                "entry_count": counts.get("entry_count", 0),
                "downstream_admitted": counts.get("downstream_admitted", 0),
                "needs_multimodal": counts.get("needs_multimodal", 0),
                "rejected_deferred_count": preview.rejected_deferred_source_report.get(
                    "entry_count", 0
                ),
                "candidate_count": preview.candidate_audit.get("candidate_count", 0),
                "class_counts": preview.candidate_audit.get("class_counts", {}),
            },
            ensure_ascii=False,
            indent=2,
            sort_keys=True,
        )
    )


def write_preview_evidence_files(
    *,
    preview: CollectedNoticeRegulationAdmissionPreview,
    output_dir: Path,
) -> dict[str, Path]:
    written: dict[str, Path] = {}
    for filename, payload in preview_to_output_files(preview).items():
        path = output_dir / filename
        path.write_text(
            json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
            encoding="utf-8",
        )
        written[filename] = path
    return written


def build_runtime_object_store() -> S3ObjectStoreWriter:
    return S3ObjectStoreWriter(ObjectStoreSettings.from_env())


def _optional_report_path(value: object) -> Path | None:
    normalized = str(value or "").strip()
    if not normalized:
        return None
    path = Path(normalized)
    if not path.exists():
        raise FileNotFoundError(f"owner text execution report does not exist: {path}")
    return path


__all__ = [
    "DEFAULT_OWNER_TEXT_EXECUTION_REPORT_PATH",
    "CollectedNoticeRegulationAdmissionPreview",
    "build_collected_notice_regulation_admission_preview_from_paths",
    "build_parser",
    "build_runtime_object_store",
    "main",
    "preview_to_output_files",
    "write_preview_evidence_files",
]


if __name__ == "__main__":
    main()
