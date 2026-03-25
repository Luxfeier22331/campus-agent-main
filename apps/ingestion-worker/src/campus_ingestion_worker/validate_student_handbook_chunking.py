from __future__ import annotations

from dataclasses import asdict
import json

from campus_ingestion_core import (
    StudentHandbookChunkingValidationReport,
    validate_student_handbook_chunking,
)
from campus_ingestion_worker.env_bootstrap import load_worker_env


def main() -> None:
    load_worker_env()
    report = validate_student_handbook_chunking()
    print(json.dumps(asdict(report), ensure_ascii=False, indent=2))


__all__ = ["StudentHandbookChunkingValidationReport", "validate_student_handbook_chunking", "main"]


if __name__ == "__main__":
    main()
