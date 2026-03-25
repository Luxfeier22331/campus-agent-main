from __future__ import annotations

from dataclasses import asdict
import json
import os
from pathlib import Path

from campus_ingestion_core import (
    StudentHandbookChunkingValidationReport,
    export_student_handbook_chunk_samples,
    validate_student_handbook_chunking,
)
from campus_ingestion_worker.env_bootstrap import load_worker_env


def main() -> None:
    load_worker_env()
    report = validate_student_handbook_chunking()
    sample_dir = (os.environ.get("HANDBOOK_CHUNK_SAMPLE_DIR") or "").strip()
    if sample_dir:
        sample_seed = int((os.environ.get("HANDBOOK_CHUNK_SAMPLE_SEED") or "20260325").strip())
        export_student_handbook_chunk_samples(
            output_dir=Path(sample_dir),
            report=report,
            sample_seed=sample_seed,
        )
    print(json.dumps(asdict(report), ensure_ascii=False, indent=2))


__all__ = ["StudentHandbookChunkingValidationReport", "validate_student_handbook_chunking", "main"]


if __name__ == "__main__":
    main()
