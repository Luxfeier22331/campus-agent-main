from __future__ import annotations

import argparse
import json
from dataclasses import asdict, is_dataclass
from pathlib import Path
from typing import Any, Sequence

from campus_ingestion_core.authenticated_notice_source_truth_inventory import (
    rebuild_authenticated_notice_source_truth_inventory,
)
from campus_ingestion_core.authenticated_notice_source_truth_replay import (
    AuthenticatedNoticeSourceTruthReplayRequest,
)

from campus_ingestion_worker.env_bootstrap import load_worker_env


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Rebuild authenticated notice source-truth inventory"
    )
    parser.add_argument("--corpus", default="campus_notices")
    parser.add_argument("--collection", default="internal_notice")
    parser.add_argument("--source-projections-path")
    parser.add_argument("--default-visibility-scope", default="campus")
    parser.add_argument("--notice-id", action="append", dest="notice_ids", default=[])
    return parser


def main(argv: Sequence[str] | None = None) -> None:
    load_worker_env()
    args = build_parser().parse_args(list(argv) if argv is not None else None)
    request = AuthenticatedNoticeSourceTruthReplayRequest(
        corpus=args.corpus,
        collection=args.collection,
        source_projections_path=(
            Path(args.source_projections_path) if args.source_projections_path else None
        ),
        default_visibility_scope=args.default_visibility_scope,
        notice_ids=tuple(args.notice_ids),
    )
    result = rebuild_authenticated_notice_source_truth_inventory(request=request)
    payload = asdict(result) if is_dataclass(result) else _normalize_payload(result)
    print(json.dumps(payload, ensure_ascii=False, indent=2))


def _normalize_payload(result: Any) -> Any:
    if isinstance(result, dict):
        return result
    raise TypeError("worker result must be a dataclass or dict")


__all__ = [
    "AuthenticatedNoticeSourceTruthReplayRequest",
    "build_parser",
    "main",
    "rebuild_authenticated_notice_source_truth_inventory",
]


if __name__ == "__main__":
    main()
