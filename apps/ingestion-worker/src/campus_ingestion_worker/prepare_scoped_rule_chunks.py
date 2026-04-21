from __future__ import annotations

import argparse
import json
from dataclasses import asdict
from pathlib import Path
from typing import Sequence

from campus_ingestion_core.in_memory_registries import InMemoryDocumentRegistry
from campus_ingestion_core.internal_notice_scoped_rule_chunk_prep import (
    prepare_scoped_rule_chunks,
)

from campus_ingestion_worker.env_bootstrap import load_worker_env


class LocalFilesystemObjectStore:
    def __init__(self, root: Path) -> None:
        self.root = Path(root)

    def get_bytes(self, *, bucket: str, key: str) -> bytes:
        return (self.root / bucket / key).read_bytes()


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description=(
            "Prepare local-only regulations/scoped_rules chunk artifacts "
            "from materialized scoped-rule registry records"
        )
    )
    parser.add_argument("--documents-json", required=True)
    parser.add_argument("--object-store-root", required=True)
    parser.add_argument("--output-dir", required=True)
    parser.add_argument("--document-id", action="append", dest="document_ids", default=[])
    parser.add_argument("--bucket-derived", default="campus-rag-derived")
    return parser


def main(argv: Sequence[str] | None = None) -> None:
    load_worker_env()
    args = build_parser().parse_args(list(argv) if argv is not None else None)
    registry = InMemoryDocumentRegistry.from_json_file(Path(args.documents_json))
    records = registry.list_by_scope("regulations", "scoped_rules")
    if args.document_ids:
        selected_ids = {
            document_id.strip() for document_id in args.document_ids if document_id.strip()
        }
        records = tuple(record for record in records if record.document_id in selected_ids)
    report = prepare_scoped_rule_chunks(
        records=records,
        object_store=LocalFilesystemObjectStore(Path(args.object_store_root)),
        output_dir=Path(args.output_dir),
        bucket_derived=str(args.bucket_derived),
    )
    print(json.dumps(asdict(report), ensure_ascii=False, indent=2))


__all__ = [
    "LocalFilesystemObjectStore",
    "build_parser",
    "main",
    "prepare_scoped_rule_chunks",
]


if __name__ == "__main__":
    main()
