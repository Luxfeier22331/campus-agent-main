from __future__ import annotations

from dataclasses import asdict
import json

from campus_ingestion_worker.env_bootstrap import load_worker_env
from campus_ingestion_core import (
    StudentHandbookMigrationReport,
    migrate_student_handbook_source_faithful,
)


def main() -> None:
    load_worker_env()
    report = migrate_student_handbook_source_faithful()
    print(json.dumps(asdict(report), ensure_ascii=False, indent=2))


__all__ = [
    "StudentHandbookMigrationReport",
    "migrate_student_handbook_source_faithful",
    "main",
]


if __name__ == "__main__":
    main()
