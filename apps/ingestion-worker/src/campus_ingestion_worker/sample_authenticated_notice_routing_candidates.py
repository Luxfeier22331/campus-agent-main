from __future__ import annotations

import argparse
import json
import os
from collections.abc import Sequence
from dataclasses import asdict
from pathlib import Path

from campus_ingestion_core.authenticated_notice_import import (
    load_authenticated_notice_bundle_payload,
)
from campus_ingestion_core.authenticated_notice_notice_family import (
    load_authenticated_notice_notice_family_config,
    read_authenticated_notice_notice_family_config_path,
)
from campus_ingestion_core.authenticated_notice_routing_sampling import (
    build_authenticated_notice_routing_sample_report_from_bundle_records,
    build_authenticated_notice_routing_sample_report_from_inventory_entries,
)
from campus_ingestion_core.authenticated_notice_source_truth_inventory import (
    build_authenticated_notice_source_truth_inventory_store_from_env,
)

from campus_ingestion_worker.env_bootstrap import load_worker_env


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Sample authenticated notice routing candidates for taxonomy review."
    )
    parser.add_argument("--bundle-path")
    parser.add_argument("--config-path")
    parser.add_argument("--corpus", default="campus_notices")
    parser.add_argument("--collection", default="internal_notice")
    parser.add_argument("--notice-id", action="append", dest="notice_ids", default=[])
    parser.add_argument("--sample-limit-per-group", type=int, default=12)
    parser.add_argument("--boundary-sample-limit", type=int, default=30)
    parser.add_argument("--output-path")
    return parser


def main(argv: Sequence[str] | None = None) -> None:
    load_worker_env()
    args = build_parser().parse_args(list(argv) if argv is not None else None)
    source = dict(os.environ)
    config_path = (
        Path(args.config_path)
        if args.config_path
        else read_authenticated_notice_notice_family_config_path(source)
    )
    config = load_authenticated_notice_notice_family_config(config_path)
    if args.bundle_path:
        bundle_records = load_authenticated_notice_bundle_payload(Path(args.bundle_path))
        report = build_authenticated_notice_routing_sample_report_from_bundle_records(
            bundle_records=bundle_records,
            config=config,
            sample_limit_per_group=args.sample_limit_per_group,
            boundary_sample_limit=args.boundary_sample_limit,
        )
    else:
        inventory_store = build_authenticated_notice_source_truth_inventory_store_from_env(
            source,
            prefer_operator=True,
        )
        inventory_entries = inventory_store.list_by_scope(
            args.corpus,
            args.collection,
            notice_ids=tuple(args.notice_ids or ()),
        )
        report = build_authenticated_notice_routing_sample_report_from_inventory_entries(
            inventory_entries=inventory_entries,
            config=config,
            sample_limit_per_group=args.sample_limit_per_group,
            boundary_sample_limit=args.boundary_sample_limit,
        )
    payload = json.dumps(asdict(report), ensure_ascii=False, indent=2, sort_keys=True)
    if args.output_path:
        Path(args.output_path).write_text(payload, encoding="utf-8")
    print(payload)


__all__ = [
    "build_authenticated_notice_source_truth_inventory_store_from_env",
    "build_parser",
    "main",
]


if __name__ == "__main__":
    main()
