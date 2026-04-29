from __future__ import annotations

import argparse
import json
from collections.abc import Sequence
from pathlib import Path

from campus_ingestion_core.derived_bucket_hygiene import (
    DerivedBucketHygieneAuditRequest,
    audit_derived_bucket_hygiene,
)

from campus_ingestion_worker.env_bootstrap import load_worker_env


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Audit derived bucket root prefixes and second-level artifact families"
    )
    parser.add_argument("--output-dir", required=True)
    return parser


def main(argv: Sequence[str] | None = None) -> None:
    load_worker_env()
    args = build_parser().parse_args(list(argv) if argv is not None else None)
    payload = audit_derived_bucket_hygiene(
        request=DerivedBucketHygieneAuditRequest(output_dir=Path(args.output_dir))
    )
    print(json.dumps(payload, ensure_ascii=False, indent=2))


__all__ = [
    "DerivedBucketHygieneAuditRequest",
    "audit_derived_bucket_hygiene",
    "build_parser",
    "main",
]


if __name__ == "__main__":
    main()
