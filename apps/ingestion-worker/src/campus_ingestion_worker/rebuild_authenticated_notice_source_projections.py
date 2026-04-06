from __future__ import annotations

import argparse
from dataclasses import asdict, is_dataclass
import json
from pathlib import Path
from typing import Any, Sequence

from campus_ingestion_core.authenticated_notice_source_projections import (
    AuthenticatedNoticeSourceProjectionRequest,
    rebuild_authenticated_notice_source_projections,
)

from campus_ingestion_worker.env_bootstrap import load_worker_env


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Rebuild authenticated notice source-truth projections")
    parser.add_argument("--corpus", default="campus_notices")
    parser.add_argument("--collection", default="internal_notice")
    parser.add_argument("--source-projections-path")
    parser.add_argument("--default-visibility-scope")
    return parser


def main(argv: Sequence[str] | None = None) -> None:
    load_worker_env()
    args = build_parser().parse_args(list(argv) if argv is not None else None)
    request = AuthenticatedNoticeSourceProjectionRequest(
        corpus=args.corpus,
        collection=args.collection,
        source_projections_path=(Path(args.source_projections_path) if args.source_projections_path else None),
        default_visibility_scope=args.default_visibility_scope,
    )
    result = rebuild_authenticated_notice_source_projections(request=request)
    payload = asdict(result) if is_dataclass(result) else _normalize_payload(result)
    print(json.dumps(payload, ensure_ascii=False, indent=2))


def _normalize_payload(result: Any) -> Any:
    if isinstance(result, dict):
        return result
    raise TypeError("worker result must be a dataclass or dict")


__all__ = [
    "AuthenticatedNoticeSourceProjectionRequest",
    "build_parser",
    "main",
    "rebuild_authenticated_notice_source_projections",
]


if __name__ == "__main__":
    main()
