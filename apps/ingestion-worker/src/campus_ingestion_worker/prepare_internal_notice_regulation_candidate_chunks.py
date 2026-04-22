from __future__ import annotations

import argparse
import json
from dataclasses import asdict
from pathlib import Path
from typing import Sequence

from campus_ingestion_core.internal_notice_regulation_candidate_chunk_prep import (
    load_internal_notice_regulation_candidate_documents,
    prepare_internal_notice_regulation_candidate_chunks,
)

from campus_ingestion_worker.env_bootstrap import load_worker_env


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description=(
            "Prepare local-only regulations/institutional_rules chunk artifacts "
            "from internal_notice promotion candidate exports"
        )
    )
    parser.add_argument("--candidate-documents-jsonl", required=True)
    parser.add_argument("--output-dir", required=True)
    parser.add_argument("--candidate-id", action="append", dest="candidate_ids", default=[])
    return parser


def main(argv: Sequence[str] | None = None) -> None:
    load_worker_env()
    args = build_parser().parse_args(list(argv) if argv is not None else None)
    documents = load_internal_notice_regulation_candidate_documents(
        Path(args.candidate_documents_jsonl)
    )
    if args.candidate_ids:
        selected_ids = {
            candidate_id.strip() for candidate_id in args.candidate_ids if candidate_id.strip()
        }
        documents = tuple(
            document for document in documents if document.candidate_id in selected_ids
        )
    report = prepare_internal_notice_regulation_candidate_chunks(
        documents=documents,
        output_dir=Path(args.output_dir),
    )
    print(json.dumps(asdict(report), ensure_ascii=False, indent=2))


__all__ = [
    "build_parser",
    "load_internal_notice_regulation_candidate_documents",
    "main",
    "prepare_internal_notice_regulation_candidate_chunks",
]


if __name__ == "__main__":
    main()
