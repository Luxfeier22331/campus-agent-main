from __future__ import annotations

import argparse
import json
from collections import Counter
from collections.abc import Sequence
from dataclasses import asdict
from typing import Any

from campus_ingestion_core.authenticated_notice_closeout_models import utc_now
from campus_ingestion_core.internal_notice_consumption_admission import (
    build_internal_notice_consumption_admission_store_from_env,
    record_internal_notice_consumption_admission,
)
from campus_ingestion_core.internal_notice_read_model import (
    DEFAULT_INTERNAL_NOTICE_BODY_EXCERPT_MAX_CHARS,
    DEFAULT_INTERNAL_NOTICE_SEARCH_TEXT_MAX_CHARS,
    InternalNoticeReadModelEntry,
    rebuild_internal_notice_read_model,
)
from campus_ingestion_core.notice_consumption_projection import (
    NOTICE_CONSUMPTION_STATUS_READY_FOR_TARGET,
    NOTICE_TARGET_SURFACE_SERVICE_STATUS_CANDIDATE,
    build_notice_consumption_projection_store_from_env,
    normalize_notice_ids,
)

from campus_ingestion_worker.env_bootstrap import load_worker_env
from campus_ingestion_worker.internal_notice_selection import (
    build_internal_notice_selection_provenance,
)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Rebuild internal_notice query read model metadata"
    )
    parser.add_argument("--corpus", default="campus_notices")
    parser.add_argument("--collection", default="internal_notice")
    parser.add_argument("--notice-id", action="append", dest="notice_ids", default=[])
    parser.add_argument("--selection-path")
    parser.add_argument(
        "--all-ready-transport-candidates",
        action="store_true",
        help=(
            "Rebuild notice read-model rows for all ready transport schedule candidates already "
            "present in notice_consumption_projection."
        ),
    )
    return parser


def main(argv: Sequence[str] | None = None) -> None:
    load_worker_env()
    parser = build_parser()
    args = parser.parse_args(list(argv) if argv is not None else None)
    selection = build_internal_notice_selection_provenance(
        explicit_notice_ids=args.notice_ids,
        selection_path=args.selection_path,
        extra_command_args={
            "all_ready_transport_candidates": bool(args.all_ready_transport_candidates),
        },
    )
    notice_ids = selection.notice_ids
    selection_source = selection.selection_source
    command_args = dict(selection.command_args)
    if args.all_ready_transport_candidates:
        projection_store = build_notice_consumption_projection_store_from_env()
        projection_entries = projection_store.list_by_scope(
            args.corpus,
            args.collection,
            notice_ids=(),
        )
        notice_ids = normalize_notice_ids(
            entry.source_notice_id
            for entry in projection_entries
            if _is_ready_transport_candidate(entry)
        )
        selection_source = "all_ready_transport_candidates"
        command_args["notice_ids"] = list(notice_ids)
    if not notice_ids:
        parser.error(
            "refusing implicit full-scope read model rebuild; pass --notice-id "
            "or --selection-path for notices selected by the consumer layer"
        )
    admission_store = build_internal_notice_consumption_admission_store_from_env()
    admission_created_at = utc_now()
    batch_id = record_internal_notice_consumption_admission(
        source_corpus=args.corpus,
        source_collection=args.collection,
        command="read_model_rebuild",
        notice_ids=notice_ids,
        status="started",
        created_at=admission_created_at,
        selection_source=selection_source,
        selection_path=selection.selection_path,
        selection_sha256=selection.selection_sha256,
        command_args=command_args,
        store=admission_store,
    )
    try:
        rows = rebuild_internal_notice_read_model(
            source_corpus=args.corpus,
            source_collection=args.collection,
            notice_ids=notice_ids,
        )
    except Exception as exc:
        record_internal_notice_consumption_admission(
            source_corpus=args.corpus,
            source_collection=args.collection,
            command="read_model_rebuild",
            notice_ids=notice_ids,
            status="failed",
            batch_id=batch_id,
            created_at=admission_created_at,
            error=str(exc),
            selection_source=selection_source,
            selection_path=selection.selection_path,
            selection_sha256=selection.selection_sha256,
            command_args=command_args,
            store=admission_store,
        )
        raise
    report = _build_report(rows)
    report["batch_id"] = record_internal_notice_consumption_admission(
        source_corpus=args.corpus,
        source_collection=args.collection,
        command="read_model_rebuild",
        notice_ids=notice_ids,
        status="completed",
        batch_id=batch_id,
        created_at=admission_created_at,
        result_counts={
            "read_model_entry_count": int(report["read_model_entry_count"]),
            "notice_count": int(report["notice_count"]),
            "queryable_count": int(report["queryable_count"]),
        },
        selection_source=selection_source,
        selection_path=selection.selection_path,
        selection_sha256=selection.selection_sha256,
        command_args=command_args,
        store=admission_store,
    )
    print(json.dumps(report, ensure_ascii=False, indent=2, sort_keys=True))


def _build_report(rows: Sequence[InternalNoticeReadModelEntry]) -> dict[str, Any]:
    target_surface_counts = Counter(row.target_surface for row in rows)
    consumption_status_counts = Counter(row.consumption_status for row in rows)
    primary_role_counts = Counter(row.primary_role for row in rows)
    return {
        "read_model_entry_count": len(rows),
        "notice_count": len({row.source_notice_id for row in rows}),
        "queryable_count": sum(1 for row in rows if row.queryable),
        "body_excerpt_max_chars": DEFAULT_INTERNAL_NOTICE_BODY_EXCERPT_MAX_CHARS,
        "search_text_max_chars": DEFAULT_INTERNAL_NOTICE_SEARCH_TEXT_MAX_CHARS,
        "observed_max_body_excerpt_chars": max(
            (len(row.body_excerpt) for row in rows),
            default=0,
        ),
        "observed_max_search_text_chars": max(
            (len(row.search_text) for row in rows),
            default=0,
        ),
        "total_body_excerpt_chars": sum(len(row.body_excerpt) for row in rows),
        "total_search_text_chars": sum(len(row.search_text) for row in rows),
        "target_surface_counts": dict(sorted(target_surface_counts.items())),
        "consumption_status_counts": dict(sorted(consumption_status_counts.items())),
        "primary_role_counts": dict(sorted(primary_role_counts.items())),
        "entries": [asdict(row) for row in rows],
    }


def _is_ready_transport_candidate(entry: object) -> bool:
    role_metadata = getattr(entry, "role_metadata", {}) or {}
    return (
        getattr(entry, "target_surface", "") == NOTICE_TARGET_SURFACE_SERVICE_STATUS_CANDIDATE
        and getattr(entry, "consumption_status", "") == NOTICE_CONSUMPTION_STATUS_READY_FOR_TARGET
        and str(role_metadata.get("service_status_candidate_kind") or "") == "transport_schedule"
    )


__all__ = [
    "build_parser",
    "main",
    "rebuild_internal_notice_read_model",
]


if __name__ == "__main__":
    main()
