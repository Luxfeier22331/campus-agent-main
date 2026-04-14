from __future__ import annotations

import argparse
from dataclasses import asdict
import json
from typing import Sequence

from campus_ingestion_core.curriculum_program_semester_facts_projection import (
    CurriculumProgramSemesterFactsMaterializationReport,
)
from campus_ingestion_core.local_rebuild import rematerialize_curriculum_program_semester_facts_from_local_rebuild
from campus_ingestion_worker.env_bootstrap import load_worker_env


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description=(
            "Rematerialize curriculum program_semester_facts for the specified "
            "canonical curriculum source documents"
        )
    )
    parser.add_argument(
        "--source-document-id",
        dest="source_document_ids",
        action="append",
        required=True,
        help="Canonical curriculum source document id to rematerialize; repeat for multiple documents.",
    )
    return parser


def main(argv: Sequence[str] | None = None) -> None:
    load_worker_env()
    args = build_parser().parse_args(list(argv) if argv is not None else None)
    report = rematerialize_curriculum_program_semester_facts_from_local_rebuild(
        source_document_ids=tuple(args.source_document_ids),
    )
    print(json.dumps(asdict(report), ensure_ascii=False, indent=2))


__all__ = [
    "CurriculumProgramSemesterFactsMaterializationReport",
    "build_parser",
    "main",
    "rematerialize_curriculum_program_semester_facts_from_local_rebuild",
]


if __name__ == "__main__":
    main()
