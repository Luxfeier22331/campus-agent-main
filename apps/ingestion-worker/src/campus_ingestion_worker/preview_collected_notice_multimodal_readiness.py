from __future__ import annotations

import argparse
import json
from collections.abc import Sequence
from pathlib import Path

from campus_ingestion_core.collected_notice_multimodal_readiness import (
    CollectedNoticeMultimodalReadinessPreview,
    build_collected_notice_multimodal_readiness_preview_from_paths,
    notice_multimodal_consumption_contract_markdown,
    preview_to_output_files,
)

from campus_ingestion_worker.env_bootstrap import load_worker_env

DEFAULT_PHASE_04_INPUT_DIR = Path(
    "var/ingestion-evidence/collected-notice-consumption-replay-closeout/"
    "evidence/phase-04-dry-run-reimport-and-universal-search-preview"
)
DEFAULT_PHASE_05_OUTPUT_DIR = Path(
    "var/ingestion-evidence/collected-notice-consumption-replay-closeout/"
    "evidence/phase-05-multimodal-ocr-consumption-readiness"
)
DEFAULT_PHASE_05_CONTRACT_PATH = Path(
    "var/ingestion-evidence/collected-notice-consumption-replay-closeout/"
    "phases/phase-05-multimodal-ocr-consumption-readiness/"
    "NOTICE-MULTIMODAL-CONSUMPTION-CONTRACT.md"
)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description=(
            "Preview collected notice multimodal/OCR readiness without provider, "
            "object-store, or database writes"
        )
    )
    parser.add_argument(
        "--invalid-defer-multimodal-report-path",
        default=str(DEFAULT_PHASE_04_INPUT_DIR / "invalid-defer-requires-multimodal-report.json"),
    )
    parser.add_argument(
        "--searchable-notice-preview-path",
        default=str(DEFAULT_PHASE_04_INPUT_DIR / "searchable-notice-preview.json"),
    )
    parser.add_argument("--output-dir", default=str(DEFAULT_PHASE_05_OUTPUT_DIR))
    parser.add_argument("--contract-path", default=str(DEFAULT_PHASE_05_CONTRACT_PATH))
    return parser


def main(argv: Sequence[str] | None = None) -> None:
    load_worker_env()
    args = build_parser().parse_args(list(argv) if argv is not None else None)
    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    contract_path = Path(args.contract_path)
    contract_path.parent.mkdir(parents=True, exist_ok=True)
    preview = build_collected_notice_multimodal_readiness_preview_from_paths(
        invalid_defer_multimodal_report_path=Path(args.invalid_defer_multimodal_report_path),
        searchable_notice_preview_path=Path(args.searchable_notice_preview_path),
    )
    files = write_preview_evidence_files(
        preview=preview,
        output_dir=output_dir,
        contract_path=contract_path,
    )
    print(
        json.dumps(
            {
                "mode": "dry_run",
                "write_enabled": False,
                "db_writes_enabled": False,
                "object_store_writes_enabled": False,
                "provider_calls_enabled": False,
                "output_dir": str(output_dir),
                "contract_path": str(contract_path),
                "files": {name: str(path) for name, path in files.items()},
                "candidate_count": preview.candidate_inventory.get("candidate_count", 0),
                "pending_attempt_count": preview.ocr_batch_manifest.get("pending_attempt_count", 0),
            },
            ensure_ascii=False,
            indent=2,
        )
    )


def write_preview_evidence_files(
    *,
    preview: CollectedNoticeMultimodalReadinessPreview,
    output_dir: Path,
    contract_path: Path,
) -> dict[str, Path]:
    written: dict[str, Path] = {}
    for filename, payload in preview_to_output_files(preview).items():
        path = output_dir / filename
        path.write_text(
            json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
        written[filename] = path
    contract_path.write_text(
        notice_multimodal_consumption_contract_markdown(),
        encoding="utf-8",
    )
    written[contract_path.name] = contract_path
    return written


__all__ = [
    "CollectedNoticeMultimodalReadinessPreview",
    "build_collected_notice_multimodal_readiness_preview_from_paths",
    "build_parser",
    "main",
    "notice_multimodal_consumption_contract_markdown",
    "preview_to_output_files",
    "write_preview_evidence_files",
]


if __name__ == "__main__":
    main()
