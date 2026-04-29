from __future__ import annotations

import argparse
import json
import os
from collections.abc import Sequence
from dataclasses import asdict
from pathlib import Path

from campus_ingestion_core.authenticated_notice_source_truth_inventory import (
    build_authenticated_notice_source_truth_inventory_store_from_env,
)
from campus_ingestion_core.internal_notice_regulation_promotion import (
    InternalNoticeRegulationPromotionRequest,
    build_internal_notice_regulation_promotion_manifest,
)
from campus_ingestion_core.internal_notice_selected_regulation_audit import (
    build_internal_notice_selected_regulation_cohort_audit,
)
from campus_ingestion_core.notice_consumption_projection import (
    build_notice_consumption_projection_store_from_env,
)

from campus_ingestion_worker.env_bootstrap import load_worker_env
from campus_ingestion_worker.internal_notice_selection import (
    build_internal_notice_selection_provenance,
)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Audit selected regulation-like internal notices before target import"
    )
    parser.add_argument("--corpus", default="campus_notices")
    parser.add_argument("--collection", default="internal_notice")
    parser.add_argument("--promotion-routing-path")
    parser.add_argument("--notice-id", action="append", dest="notice_ids", default=[])
    parser.add_argument("--selection-path")
    parser.add_argument("--output-json")
    parser.add_argument(
        "--without-promotion-manifest",
        action="store_true",
        help="Use projection and source-truth inventory only; skip promotion manifest evidence.",
    )
    return parser


def main(argv: Sequence[str] | None = None) -> None:
    load_worker_env()
    env = dict(os.environ)
    args = build_parser().parse_args(list(argv) if argv is not None else None)
    selection = build_internal_notice_selection_provenance(
        explicit_notice_ids=args.notice_ids,
        selection_path=args.selection_path,
        extra_command_args={
            "promotion_routing_path": args.promotion_routing_path or "",
        },
    )
    projection_store = build_notice_consumption_projection_store_from_env(env)
    inventory_store = build_authenticated_notice_source_truth_inventory_store_from_env(env)
    promotion_report = None
    if not args.without_promotion_manifest:
        promotion_report = build_internal_notice_regulation_promotion_manifest(
            request=InternalNoticeRegulationPromotionRequest(
                corpus=args.corpus,
                collection=args.collection,
                promotion_routing_path=(
                    Path(args.promotion_routing_path) if args.promotion_routing_path else None
                ),
                notice_ids=selection.notice_ids,
            ),
            env=env,
        )
    report = build_internal_notice_selected_regulation_cohort_audit(
        projection_store=projection_store,
        source_truth_inventory_store=inventory_store,
        source_corpus=args.corpus,
        source_collection=args.collection,
        notice_ids=selection.notice_ids,
        promotion_report=promotion_report,
    )
    payload = asdict(report)
    if args.output_json:
        Path(args.output_json).write_text(
            json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True),
            encoding="utf-8",
        )
    print(json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True))


__all__ = [
    "build_internal_notice_selected_regulation_cohort_audit",
    "build_parser",
    "main",
]


if __name__ == "__main__":
    main()
