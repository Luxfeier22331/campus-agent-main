from __future__ import annotations

import argparse
import json
from collections import Counter
from collections.abc import Sequence
from dataclasses import asdict
from pathlib import Path
from typing import Any

from campus_ingestion_core.authenticated_notice_legacy_export import (
    load_authenticated_notice_selection_notice_ids,
)
from campus_ingestion_core.internal_notice_consumption_admission import (
    build_internal_notice_consumption_admission_store_from_env,
    record_internal_notice_consumption_admission,
)
from campus_ingestion_core.internal_notice_consumption_projection import (
    NoticeConsumptionProjectionEntry,
    rebuild_internal_notice_consumption_projection,
)
from campus_ingestion_core.internal_notice_regulation_promotion import (
    InternalNoticeRegulationPromotionRequest,
)
from campus_ingestion_core.notice_consumption_projection import (
    NOTICE_CONSUMPTION_STATUS_MANUAL_REVIEW_REQUIRED,
    NOTICE_CONSUMPTION_STATUS_NO_ADOPTION,
    NOTICE_CONSUMPTION_STATUS_PENDING_MULTIMODAL_PROCESSING,
    NOTICE_CONSUMPTION_STATUS_READY_FOR_TARGET,
    is_notice_query_retained_consumption_status,
)

from campus_ingestion_worker.env_bootstrap import load_worker_env


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Rebuild internal_notice notice consumption projection metadata"
    )
    parser.add_argument("--corpus", default="campus_notices")
    parser.add_argument("--collection", default="internal_notice")
    parser.add_argument("--promotion-routing-path")
    parser.add_argument("--notice-id", action="append", dest="notice_ids", default=[])
    parser.add_argument("--document-id", action="append", dest="document_ids", default=[])
    parser.add_argument("--selection-path")
    return parser


def main(argv: Sequence[str] | None = None) -> None:
    load_worker_env()
    parser = build_parser()
    args = parser.parse_args(list(argv) if argv is not None else None)
    notice_ids = _merge_notice_ids(args.notice_ids, args.selection_path)
    if not notice_ids and not args.document_ids:
        parser.error(
            "refusing implicit full-scope rebuild; pass --notice-id or --document-id "
            "or --selection-path for notices selected by the consumer layer"
        )
    request = InternalNoticeRegulationPromotionRequest(
        corpus=args.corpus,
        collection=args.collection,
        promotion_routing_path=(
            Path(args.promotion_routing_path) if args.promotion_routing_path else None
        ),
        notice_ids=notice_ids,
        document_ids=tuple(args.document_ids),
    )
    entries = rebuild_internal_notice_consumption_projection(request=request)
    report = _build_report(entries)
    admission_store = build_internal_notice_consumption_admission_store_from_env()
    report["batch_id"] = record_internal_notice_consumption_admission(
        source_corpus=args.corpus,
        source_collection=args.collection,
        command="projection_rebuild",
        notice_ids=notice_ids,
        result_counts={
            "projection_entry_count": int(report["projection_entry_count"]),
            "notice_count": int(report["notice_count"]),
        },
        store=admission_store,
    )
    print(json.dumps(report, ensure_ascii=False, indent=2, sort_keys=True))


def _build_report(entries: Sequence[NoticeConsumptionProjectionEntry]) -> dict[str, Any]:
    primary_role_counts = Counter(entry.primary_role for entry in entries)
    consumption_status_counts = Counter(entry.consumption_status for entry in entries)
    retained_for_notice_query_count = sum(
        1
        for entry in entries
        if is_notice_query_retained_consumption_status(entry.consumption_status)
    )
    return {
        "projection_entry_count": len(entries),
        "notice_count": len({entry.source_notice_id for entry in entries}),
        "ready_for_target_count": consumption_status_counts.get(
            NOTICE_CONSUMPTION_STATUS_READY_FOR_TARGET,
            0,
        ),
        "retained_for_notice_query_count": retained_for_notice_query_count,
        "held_in_notice_runtime_count": retained_for_notice_query_count,
        "manual_review_required_count": consumption_status_counts.get(
            NOTICE_CONSUMPTION_STATUS_MANUAL_REVIEW_REQUIRED,
            0,
        ),
        "pending_multimodal_processing_count": consumption_status_counts.get(
            NOTICE_CONSUMPTION_STATUS_PENDING_MULTIMODAL_PROCESSING,
            0,
        ),
        "no_adoption_count": consumption_status_counts.get(
            NOTICE_CONSUMPTION_STATUS_NO_ADOPTION, 0
        ),
        "primary_role_counts": dict(sorted(primary_role_counts.items())),
        "consumption_status_counts": dict(sorted(consumption_status_counts.items())),
        "entries": [asdict(entry) for entry in entries],
    }


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
    "InternalNoticeRegulationPromotionRequest",
    "build_parser",
    "main",
    "rebuild_internal_notice_consumption_projection",
]


if __name__ == "__main__":
    main()
