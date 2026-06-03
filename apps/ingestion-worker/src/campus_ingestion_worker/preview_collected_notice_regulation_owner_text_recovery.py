from __future__ import annotations

import argparse
import json
from collections.abc import Sequence
from pathlib import Path

from campus_ingestion_core.collected_notice_regulation_owner_text_recovery import (
    build_collected_notice_regulation_owner_text_recovery_preview_from_paths,
    preview_to_output_files,
)
from campus_ingestion_core.collected_notice_regulation_owner_text_recovery_constants import (
    DEFAULT_REGULATION_OWNER_TEXT_RECOVERY_BATCH_LIMIT,
)
from campus_ingestion_core.collected_notice_regulation_owner_text_recovery_models import (
    CollectedNoticeRegulationOwnerTextRecoveryPreview,
)

from campus_ingestion_worker.env_bootstrap import load_worker_env

DEFAULT_PHASE_05_INPUT_DIR = Path(
    "var/ingestion-evidence/collected-notice-consumption-replay-closeout/"
    "evidence/phase-05-multimodal-ocr-consumption-readiness"
)
DEFAULT_PHASE_06_R1_INPUT_DIR = Path(
    "var/ingestion-evidence/collected-notice-consumption-replay-closeout/"
    "evidence/phase-06-r1-regulation-candidate-audit-and-admission"
)
DEFAULT_OUTPUT_DIR = Path(
    "var/ingestion-evidence/collected-notice-consumption-replay-closeout/"
    "evidence/phase-06-r1a-regulation-owner-text-recovery-mini-batch"
)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description=(
            "Preview Phase 6R.1a regulation owner-text recovery mini-batch without "
            "provider, object-store, or database writes."
        )
    )
    parser.add_argument(
        "--regulation-admission-manifest-path",
        default=str(DEFAULT_PHASE_06_R1_INPUT_DIR / "regulation-consumer-admission-manifest.json"),
    )
    parser.add_argument(
        "--multimodal-candidate-inventory-path",
        default=str(DEFAULT_PHASE_05_INPUT_DIR / "multimodal-candidate-inventory.json"),
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=DEFAULT_REGULATION_OWNER_TEXT_RECOVERY_BATCH_LIMIT,
    )
    parser.add_argument("--output-dir", default=str(DEFAULT_OUTPUT_DIR))
    return parser


def main(argv: Sequence[str] | None = None) -> None:
    load_worker_env()
    args = build_parser().parse_args(list(argv) if argv is not None else None)
    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    preview = build_collected_notice_regulation_owner_text_recovery_preview_from_paths(
        regulation_admission_manifest_path=Path(args.regulation_admission_manifest_path),
        multimodal_candidate_inventory_path=Path(args.multimodal_candidate_inventory_path),
        limit=args.limit,
    )
    files = write_preview_evidence_files(preview=preview, output_dir=output_dir)
    counts = preview.batch_manifest.get("counts", {})
    print(
        json.dumps(
            {
                "mode": "dry_run",
                "write_enabled": False,
                "provider_calls_enabled": False,
                "object_store_writes_enabled": False,
                "db_writes_enabled": False,
                "target": "regulation_owner_text_recovery",
                "limit": args.limit,
                "output_dir": str(output_dir),
                "files": {name: str(path) for name, path in files.items()},
                "in_scope_needs_multimodal_count": counts.get("in_scope_needs_multimodal_count", 0),
                "eligible_attempt_count": counts.get("eligible_attempt_count", 0),
                "selected_attempt_count": counts.get("selected_attempt_count", 0),
                "batch_limit_deferred_count": counts.get("batch_limit_deferred_count", 0),
                "gap_count": counts.get("gap_count", 0),
            },
            ensure_ascii=False,
            indent=2,
            sort_keys=True,
        )
    )


def write_preview_evidence_files(
    *,
    preview: CollectedNoticeRegulationOwnerTextRecoveryPreview,
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


__all__ = [
    "CollectedNoticeRegulationOwnerTextRecoveryPreview",
    "build_collected_notice_regulation_owner_text_recovery_preview_from_paths",
    "build_parser",
    "main",
    "preview_to_output_files",
    "write_preview_evidence_files",
]


if __name__ == "__main__":
    main()
