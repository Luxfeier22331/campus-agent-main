from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Sequence

from campus_ingestion_core.authenticated_notice_closeout import (
    AuthenticatedNoticeCloseoutService,
    AuthenticatedNoticeSourceTruthReplayRequest,
    CloseoutPlanner,
)
from campus_ingestion_worker.env_bootstrap import load_worker_env


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Plan an authenticated notice source-truth replay closeout run"
    )
    parser.add_argument("--run-id", required=True)
    parser.add_argument("--corpus", default="campus_notices")
    parser.add_argument("--collection", default="internal_notice")
    parser.add_argument("--source-projections-path")
    parser.add_argument("--visibility-scope", default="campus")
    parser.add_argument("--shard-size", type=int, default=250)
    parser.add_argument("--batch-size", type=int, default=16)
    parser.add_argument("--max-concurrency", type=int, default=8)
    parser.add_argument("--notice-concurrency", type=int, default=8)
    parser.add_argument("--object-store-concurrency", type=int, default=64)
    parser.add_argument("--lease-seconds", type=int, default=300)
    return parser


def main(argv: Sequence[str] | None = None) -> None:
    load_worker_env()
    args = build_parser().parse_args(list(argv) if argv is not None else None)
    service = AuthenticatedNoticeCloseoutService.from_env(
        planner=CloseoutPlanner(
            shard_size=args.shard_size,
            batch_size=args.batch_size,
        )
    )
    summary = service.plan_source_truth_replay_run(
        request=AuthenticatedNoticeSourceTruthReplayRequest(
            corpus=args.corpus,
            collection=args.collection,
            source_projections_path=(
                Path(args.source_projections_path)
                if args.source_projections_path
                else None
            ),
            default_visibility_scope=args.visibility_scope,
        ),
        run_id=args.run_id,
        max_concurrency=args.max_concurrency,
        notice_concurrency=args.notice_concurrency,
        object_store_concurrency=args.object_store_concurrency,
        lease_seconds=args.lease_seconds,
    )
    print(json.dumps(summary, ensure_ascii=False, indent=2))


__all__ = ["AuthenticatedNoticeSourceTruthReplayRequest", "build_parser", "main"]


if __name__ == "__main__":
    main()
