from __future__ import annotations

from dataclasses import asdict
import json
import os
from pathlib import Path

from campus_ingestion_core import (
    StudentHandbookChunkingValidationReport,
    build_student_handbook_chunking_validation_report,
    export_student_handbook_chunk_samples,
    scan_student_handbook_chunking,
    validate_student_handbook_chunking,
)
from campus_ingestion_worker.env_bootstrap import load_worker_env


def main() -> None:
    load_worker_env()
    mode = (os.environ.get("HANDBOOK_CHUNK_VALIDATION_MODE") or "full").strip().lower() or "full"
    sample_dir = (os.environ.get("HANDBOOK_CHUNK_SAMPLE_DIR") or "").strip()
    sample_seed = int((os.environ.get("HANDBOOK_CHUNK_SAMPLE_SEED") or "20260325").strip())
    scan_result = scan_student_handbook_chunking(
        mode="samples" if mode == "samples" else "full",
        sample_seed=sample_seed,
    )
    if sample_dir:
        report = (
            build_student_handbook_chunking_validation_report(scan_result=scan_result)
            if scan_result.mode == "full"
            else None
        )
        export_student_handbook_chunk_samples(
            output_dir=Path(sample_dir),
            report=report,
            scan_result=scan_result,
            sample_seed=sample_seed,
        )
    if scan_result.mode == "samples":
        print(
            json.dumps(
                {
                    "mode": "samples",
                    "scanned_document_count": len(scan_result.documents),
                    "sample_dir": sample_dir or None,
                },
                ensure_ascii=False,
                indent=2,
            )
        )
        return
    report = build_student_handbook_chunking_validation_report(scan_result=scan_result)
    print(json.dumps(asdict(report), ensure_ascii=False, indent=2))


__all__ = ["StudentHandbookChunkingValidationReport", "validate_student_handbook_chunking", "main"]


if __name__ == "__main__":
    main()
