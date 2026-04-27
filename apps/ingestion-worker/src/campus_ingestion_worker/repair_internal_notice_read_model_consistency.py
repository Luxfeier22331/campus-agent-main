from __future__ import annotations

import argparse
import json
from collections.abc import Sequence
from dataclasses import asdict
from pathlib import Path

from campus_ingestion_core.authenticated_notice_closeout_models import utc_now
from campus_ingestion_core.internal_notice_consumer_admission_gate import (
    CONSUMER_ADMISSION_GATE_OPERATION_READ_MODEL_REBUILD,
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
from campus_ingestion_core.internal_notice_read_model import (
    repair_internal_notice_read_model_consistency,
)

from campus_ingestion_worker.env_bootstrap import load_worker_env
from campus_ingestion_worker.internal_notice_selection import (
    build_internal_notice_selection_provenance,
)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Repair selected internal_notice projection/read-model consistency"
    )
    parser.add_argument("--corpus", default="campus_notices")
    parser.add_argument("--collection", default="internal_notice")
    parser.add_argument("--notice-id", action="append", dest="notice_ids", default=[])
    parser.add_argument("--selection-path")
    parser.add_argument("--consumer-admission-manifest-path")
    return parser


def main(argv: Sequence[str] | None = None) -> None:
    load_worker_env()
    parser = build_parser()
    args = parser.parse_args(list(argv) if argv is not None else None)
    selection = build_internal_notice_selection_provenance(
        explicit_notice_ids=args.notice_ids,
        selection_path=args.selection_path,
    )
    if not selection.notice_ids:
        parser.error(
            "refusing implicit full-scope read model repair; pass --notice-id "
            "or --selection-path for notices selected by the consumer layer"
        )
    if not args.consumer_admission_manifest_path:
        parser.error(
            "consumer admission manifest is required before internal notice read model repair"
        )
    manifest = load_internal_notice_consumer_admission_manifest(
        Path(args.consumer_admission_manifest_path)
    )
    gate_report = check_internal_notice_consumer_admission_gate(
        manifest=manifest,
        request=ConsumerAdmissionGateRequest(
            operation=CONSUMER_ADMISSION_GATE_OPERATION_READ_MODEL_REBUILD,
            source_corpus=args.corpus,
            source_collection=args.collection,
            selected_notice_ids=selection.notice_ids,
            scope_write_mode="upsert_selected",
        ),
    )
    if not gate_report.allowed:
        parser.error(
            "consumer admission manifest gate blocked read model repair: "
            + ", ".join(gate_report.reason_codes)
        )
    command_args = {
        **selection.command_args,
        "consumer_admission_manifest_path": args.consumer_admission_manifest_path,
    }
    admission_store = build_internal_notice_consumption_admission_store_from_env()
    admission_created_at = utc_now()
    batch_id = record_internal_notice_consumption_admission(
        source_corpus=args.corpus,
        source_collection=args.collection,
        command="read_model_repair",
        notice_ids=selection.notice_ids,
        status="started",
        created_at=admission_created_at,
        selection_source=selection.selection_source,
        selection_path=selection.selection_path,
        selection_sha256=selection.selection_sha256,
        command_args=command_args,
        store=admission_store,
    )
    try:
        report = repair_internal_notice_read_model_consistency(
            source_corpus=args.corpus,
            source_collection=args.collection,
            notice_ids=selection.notice_ids,
        )
    except Exception as exc:
        record_internal_notice_consumption_admission(
            source_corpus=args.corpus,
            source_collection=args.collection,
            command="read_model_repair",
            notice_ids=selection.notice_ids,
            status="failed",
            batch_id=batch_id,
            created_at=admission_created_at,
            error=str(exc),
            selection_source=selection.selection_source,
            selection_path=selection.selection_path,
            selection_sha256=selection.selection_sha256,
            command_args=command_args,
            store=admission_store,
        )
        raise
    payload = asdict(report)
    payload["batch_id"] = record_internal_notice_consumption_admission(
        source_corpus=args.corpus,
        source_collection=args.collection,
        command="read_model_repair",
        notice_ids=selection.notice_ids,
        status="completed",
        batch_id=batch_id,
        created_at=admission_created_at,
        result_counts={"rebuilt_count": report.rebuilt_count},
        selection_source=selection.selection_source,
        selection_path=selection.selection_path,
        selection_sha256=selection.selection_sha256,
        command_args=command_args,
        store=admission_store,
    )
    print(json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True))


__all__ = [
    "build_parser",
    "main",
    "repair_internal_notice_read_model_consistency",
]


if __name__ == "__main__":
    main()
