from __future__ import annotations

import argparse
import json
from collections.abc import Sequence
from pathlib import Path

from campus_ingestion_core.authenticated_notice_closeout import (
    AuthenticatedNoticeCloseoutService,
    CloseoutPlanner,
)
from campus_ingestion_core.authenticated_notice_import import AuthenticatedNoticeImportRequest

from campus_ingestion_worker.env_bootstrap import load_worker_env


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Plan an authenticated notice async closeout run")
    parser.add_argument("--bundle-path", required=True)
    parser.add_argument("--manifest-path")
    parser.add_argument("--site-id", required=True)
    parser.add_argument("--source-home-url", required=True)
    parser.add_argument("--run-id", required=True)
    parser.add_argument("--corpus", default="campus_notices")
    parser.add_argument("--collection", default="internal_notice")
    parser.add_argument("--visibility-scope", default="campus")
    parser.add_argument(
        "--entitlement-group",
        action="append",
        dest="entitlement_groups",
        default=[],
    )
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
    entitlement_groups = tuple(group.strip() for group in args.entitlement_groups if group.strip())
    service = AuthenticatedNoticeCloseoutService.from_env(
        planner=CloseoutPlanner(
            shard_size=args.shard_size,
            batch_size=args.batch_size,
        )
    )
    summary = service.plan_run(
        request=AuthenticatedNoticeImportRequest(
            bundle_path=Path(args.bundle_path),
            export_manifest_path=(Path(args.manifest_path) if args.manifest_path else None),
            site_id=args.site_id,
            source_home_url=args.source_home_url,
            allow_local_fixture_import=True,
            corpus=args.corpus,
            collection=args.collection,
            default_entitlement_groups=(entitlement_groups or ("campus_members",)),
            visibility_scope=args.visibility_scope,
        ),
        run_id=args.run_id,
        max_concurrency=args.max_concurrency,
        notice_concurrency=args.notice_concurrency,
        object_store_concurrency=args.object_store_concurrency,
        lease_seconds=args.lease_seconds,
    )
    print(json.dumps(summary, ensure_ascii=False, indent=2))


__all__ = ["build_parser", "main"]


if __name__ == "__main__":
    main()
