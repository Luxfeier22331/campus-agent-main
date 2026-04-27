from __future__ import annotations

import argparse
import json
from collections import Counter
from collections.abc import Sequence
from dataclasses import asdict
from pathlib import Path
from typing import Any

from campus_ingestion_core.authenticated_notice_closeout_models import utc_now
from campus_ingestion_core.internal_notice_consumer_admission_gate import (
    CONSUMER_ADMISSION_GATE_OPERATION_PROJECTION_REBUILD,
    ConsumerAdmissionGateRequest,
    check_internal_notice_consumer_admission_gate,
)
from campus_ingestion_core.internal_notice_consumer_admission_manifest import (
    load_internal_notice_consumer_admission_manifest,
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
    NOTICE_CONSUMPTION_STATUS_NO_ADOPTION,
    NOTICE_CONSUMPTION_STATUS_PENDING_MULTIMODAL_PROCESSING,
    NOTICE_CONSUMPTION_STATUS_READY_FOR_TARGET,
    is_notice_query_retained_consumption_status,
)

from campus_ingestion_worker.env_bootstrap import load_worker_env
from campus_ingestion_worker.internal_notice_selection import (
    InternalNoticeSelectionProvenance,
    build_internal_notice_selection_provenance,
)


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
    parser.add_argument("--consumer-admission-manifest-path")
    return parser


def main(argv: Sequence[str] | None = None) -> None:
    load_worker_env()
    parser = build_parser()
    args = parser.parse_args(list(argv) if argv is not None else None)
    document_ids = tuple(str(item).strip() for item in args.document_ids if str(item).strip())
    selection = build_internal_notice_selection_provenance(
        explicit_notice_ids=args.notice_ids,
        selection_path=args.selection_path,
        extra_command_args={
            "document_ids": list(document_ids),
            "promotion_routing_path": args.promotion_routing_path or "",
        },
    )
    selection_source = _projection_selection_source(selection, document_ids)
    command_args = dict(selection.command_args)
    command_args["selection_source"] = selection_source
    if not selection.notice_ids and not document_ids:
        parser.error(
            "refusing implicit full-scope rebuild; pass --notice-id or --document-id "
            "or --selection-path for notices selected by the consumer layer"
        )
    if not args.consumer_admission_manifest_path:
        parser.error(
            "consumer admission manifest is required before internal notice projection rebuild"
        )
    manifest = load_internal_notice_consumer_admission_manifest(
        Path(args.consumer_admission_manifest_path)
    )
    gate_report = check_internal_notice_consumer_admission_gate(
        manifest=manifest,
        request=ConsumerAdmissionGateRequest(
            operation=CONSUMER_ADMISSION_GATE_OPERATION_PROJECTION_REBUILD,
            source_corpus=args.corpus,
            source_collection=args.collection,
            selected_notice_ids=selection.notice_ids,
            scope_write_mode="upsert_selected",
        ),
    )
    if not gate_report.allowed:
        parser.error(
            "consumer admission manifest gate blocked projection rebuild: "
            + ", ".join(gate_report.reason_codes)
        )
    command_args["consumer_admission_manifest_path"] = args.consumer_admission_manifest_path
    request = InternalNoticeRegulationPromotionRequest(
        corpus=args.corpus,
        collection=args.collection,
        promotion_routing_path=(
            Path(args.promotion_routing_path) if args.promotion_routing_path else None
        ),
        notice_ids=selection.notice_ids,
        document_ids=document_ids,
    )
    admission_store = build_internal_notice_consumption_admission_store_from_env()
    admission_created_at = utc_now()
    batch_id = record_internal_notice_consumption_admission(
        source_corpus=args.corpus,
        source_collection=args.collection,
        command="projection_rebuild",
        notice_ids=selection.notice_ids,
        status="started",
        created_at=admission_created_at,
        selection_source=selection_source,
        selection_path=selection.selection_path,
        selection_sha256=selection.selection_sha256,
        command_args=command_args,
        store=admission_store,
    )
    try:
        entries = rebuild_internal_notice_consumption_projection(
            request=request,
            admission_batch_id=batch_id,
            admission_command="projection_rebuild",
            admission_created_at=admission_created_at,
        )
    except Exception as exc:
        record_internal_notice_consumption_admission(
            source_corpus=args.corpus,
            source_collection=args.collection,
            command="projection_rebuild",
            notice_ids=selection.notice_ids,
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
    report = _build_report(entries)
    report["batch_id"] = record_internal_notice_consumption_admission(
        source_corpus=args.corpus,
        source_collection=args.collection,
        command="projection_rebuild",
        notice_ids=selection.notice_ids,
        status="completed",
        batch_id=batch_id,
        created_at=admission_created_at,
        result_counts={
            "projection_entry_count": int(report["projection_entry_count"]),
            "notice_count": int(report["notice_count"]),
        },
        selection_source=selection_source,
        selection_path=selection.selection_path,
        selection_sha256=selection.selection_sha256,
        command_args=command_args,
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


def _projection_selection_source(
    selection: InternalNoticeSelectionProvenance,
    document_ids: Sequence[str],
) -> str:
    parts = [selection.selection_source] if selection.selection_source else []
    if document_ids:
        parts.append("explicit_document_ids")
    return "+".join(parts)


__all__ = [
    "InternalNoticeRegulationPromotionRequest",
    "build_parser",
    "main",
    "rebuild_internal_notice_consumption_projection",
]


if __name__ == "__main__":
    main()
