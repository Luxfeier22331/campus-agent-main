from __future__ import annotations

import argparse
import json
from collections.abc import Sequence
from pathlib import Path

from campus_ingestion_core import audit_regulation_rag_release_manifests
from campus_ingestion_core.local_rebuild_support import S3ObjectStoreAdmin
from campus_ingestion_core.settings import ObjectStoreSettings

from campus_ingestion_worker.env_bootstrap import load_worker_env


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Audit regulation RAG release/admission manifest field completeness for a published release."
    )
    parser.add_argument("--corpus", required=True)
    parser.add_argument("--collection", required=True)
    parser.add_argument("--release-id", required=True)
    parser.add_argument("--output-path")
    return parser


def main(argv: Sequence[str] | None = None) -> None:
    load_worker_env()
    args = build_parser().parse_args(list(argv) if argv is not None else None)
    settings = ObjectStoreSettings.from_env()
    object_store = S3ObjectStoreAdmin(settings)
    report = audit_regulation_rag_release_manifests(
        reader=object_store,
        bucket=settings.bucket_derived,
        corpus=args.corpus,
        collection=args.collection,
        release_id=args.release_id,
    )
    if args.output_path:
        _write_json(Path(args.output_path), report)
    print(json.dumps(report, ensure_ascii=False, indent=2))


def _write_json(path: Path, payload: dict[str, object]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


__all__ = ["audit_regulation_rag_release_manifests", "build_parser", "main"]


if __name__ == "__main__":
    main()
