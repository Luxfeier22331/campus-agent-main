from __future__ import annotations

import argparse
import json
import os
from collections.abc import Sequence
from dataclasses import asdict
from pathlib import Path

from campus_ingestion_core.authenticated_notice_legacy_export import (
    load_authenticated_notice_selection_notice_ids,
)
from campus_ingestion_core.authenticated_notice_source_truth_inventory import (
    build_authenticated_notice_source_truth_inventory_store_from_env,
)
from campus_ingestion_core.internal_notice_pipeline_quality import (
    check_internal_notice_pipeline_quality,
)
from campus_ingestion_core.internal_notice_read_model import (
    build_internal_notice_read_model_store_from_env,
)
from campus_ingestion_core.notice_consumption_projection import (
    build_notice_consumption_projection_store_from_env,
)

from campus_ingestion_worker.env_bootstrap import load_worker_env


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Check end-to-end internal_notice ingest/consumption pipeline quality"
    )
    parser.add_argument("--corpus", default="campus_notices")
    parser.add_argument("--collection", default="internal_notice")
    parser.add_argument("--notice-id", action="append", dest="notice_ids", default=[])
    parser.add_argument("--selection-path")
    parser.add_argument("--allow-full-scope", action="store_true")
    parser.add_argument("--no-require-admission-provenance", action="store_true")
    return parser


def main(argv: Sequence[str] | None = None) -> None:
    load_worker_env()
    parser = build_parser()
    args = parser.parse_args(list(argv) if argv is not None else None)
    notice_ids = _merge_notice_ids(args.notice_ids, args.selection_path)
    if not notice_ids and not args.allow_full_scope:
        parser.error(
            "pass --notice-id or --selection-path, or use --allow-full-scope for an "
            "explicit full-scope quality audit"
        )
    env = dict(os.environ)
    source_truth_inventory_store = build_authenticated_notice_source_truth_inventory_store_from_env(
        env,
        prefer_operator=True,
    )
    projection_store = build_notice_consumption_projection_store_from_env(
        env,
        prefer_operator=True,
    )
    read_model_store = build_internal_notice_read_model_store_from_env(
        env,
        prefer_operator=True,
    )
    report = check_internal_notice_pipeline_quality(
        source_corpus=args.corpus,
        source_collection=args.collection,
        notice_ids=notice_ids,
        env=env,
        source_truth_inventory_store=source_truth_inventory_store,
        projection_store=projection_store,
        read_model_store=read_model_store,
        require_admission_provenance=not args.no_require_admission_provenance,
    )
    print(json.dumps(asdict(report), ensure_ascii=False, indent=2, sort_keys=True))


def _merge_notice_ids(
    explicit_notice_ids: Sequence[str],
    selection_path: str | None,
) -> tuple[str, ...]:
    selected_notice_ids = (
        load_authenticated_notice_selection_notice_ids(Path(selection_path))
        if selection_path
        else ()
    )
    return tuple(
        dict.fromkeys(
            notice_id
            for notice_id in (
                *(str(item).strip() for item in explicit_notice_ids),
                *selected_notice_ids,
            )
            if notice_id
        )
    )


__all__ = [
    "build_parser",
    "check_internal_notice_pipeline_quality",
    "main",
]


if __name__ == "__main__":
    main()
