from __future__ import annotations

import argparse
from dataclasses import asdict
import json
from typing import Sequence

from campus_ingestion_core.curriculum_program_semester_facts_projection import (
    CurriculumProgramSemesterFactsMaterializationReport,
    materialize_curriculum_program_semester_facts_from_canonical_scope,
)
from campus_ingestion_worker.env_bootstrap import load_worker_env


def build_parser() -> argparse.ArgumentParser:
    return argparse.ArgumentParser(
        description=(
            "Materialize curriculum program_semester_facts from canonical "
            "curriculum_plan document-units"
        )
    )


def main(argv: Sequence[str] | None = None) -> None:
    load_worker_env()
    build_parser().parse_args(list(argv) if argv is not None else None)
    report = materialize_curriculum_program_semester_facts_from_canonical_scope()
    print(json.dumps(asdict(report), ensure_ascii=False, indent=2))


__all__ = [
    "CurriculumProgramSemesterFactsMaterializationReport",
    "build_parser",
    "main",
    "materialize_curriculum_program_semester_facts_from_canonical_scope",
]


if __name__ == "__main__":
    main()
