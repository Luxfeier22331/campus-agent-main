from __future__ import annotations

import argparse
import json
from collections.abc import Sequence
from pathlib import Path

from campus_ingestion_core.campusrag_ingestion_support import S3ObjectStoreWriter
from campus_ingestion_core.collected_notice_regulation_materialization_preview import (
    CollectedNoticeRegulationMaterializationPreview,
    build_collected_notice_regulation_materialization_preview_from_paths,
    preview_to_output_files,
)
from campus_ingestion_core.settings import ObjectStoreSettings

from campus_ingestion_worker.env_bootstrap import load_worker_env

DEFAULT_PHASE_06_R1_INPUT_DIR = Path(
    "var/ingestion-evidence/collected-notice-consumption-replay-closeout/"
    "evidence/phase-06-r1-regulation-candidate-audit-and-admission"
)
DEFAULT_OUTPUT_DIR = Path(
    "var/ingestion-evidence/collected-notice-consumption-replay-closeout/"
    "evidence/phase-06-r3-regulation-normalization-quality-gate"
)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description=(
            "Preview Phase 6R.3 regulation target materialization normalization without writes."
        )
    )
    parser.add_argument(
        "--admission-manifest-path",
        default=str(DEFAULT_PHASE_06_R1_INPUT_DIR / "regulation-consumer-admission-manifest.json"),
    )
    parser.add_argument("--output-dir", default=str(DEFAULT_OUTPUT_DIR))
    return parser


def main(argv: Sequence[str] | None = None) -> None:
    load_worker_env()
    args = build_parser().parse_args(list(argv) if argv is not None else None)
    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    preview = build_collected_notice_regulation_materialization_preview_from_paths(
        admission_manifest_path=Path(args.admission_manifest_path),
        object_store=build_runtime_object_store(),
    )
    files = write_preview_evidence_files(preview=preview, output_dir=output_dir)
    counts = preview.consistency_report["counts"]
    print(
        json.dumps(
            {
                "mode": "dry_run",
                "write_enabled": False,
                "current_promotion_enabled": False,
                "target": "regulation",
                "output_dir": str(output_dir),
                "files": {name: str(path) for name, path in files.items()},
                "downstream_admitted": counts.get("downstream_admitted", 0),
                "institutional_rules_document_count": counts.get(
                    "institutional_rules_document_count", 0
                ),
                "scoped_rules_document_count": counts.get("scoped_rules_document_count", 0),
                "skipped_not_admitted": counts.get("skipped_not_admitted", 0),
                "consistency_verdict": preview.consistency_report.get("verdict"),
                "normalization_quality_verdict": preview.normalization_quality_report.get(
                    "verdict"
                ),
            },
            ensure_ascii=False,
            indent=2,
            sort_keys=True,
        )
    )


def write_preview_evidence_files(
    *,
    preview: CollectedNoticeRegulationMaterializationPreview,
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


__all__ = [
    "CollectedNoticeRegulationMaterializationPreview",
    "build_collected_notice_regulation_materialization_preview_from_paths",
    "build_parser",
    "build_runtime_object_store",
    "main",
    "preview_to_output_files",
    "write_preview_evidence_files",
]


if __name__ == "__main__":
    main()
