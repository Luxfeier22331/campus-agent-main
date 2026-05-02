from __future__ import annotations

import argparse
import json
from collections.abc import Sequence
from dataclasses import asdict
from pathlib import Path

from campus_ingestion_core import (
    audit_official_web_projection_chunking,
    replay_official_web_source_truth_local,
    validate_official_web_projection_output,
)
from campus_ingestion_core.official_web_release_task_store import (
    build_official_web_release_task_store_from_env,
)

from campus_ingestion_worker import official_web_handoff_consumer_runtime as _runtime
from campus_ingestion_worker.env_bootstrap import load_worker_env
from campus_ingestion_worker.official_web_handoff_consumer_models import (
    OFFICIAL_WEB_HANDOFF_CONSUME_REPORT_SCHEMA_VERSION,
    OfficialWebHandoffConsumeBatchReport,
    OfficialWebHandoffConsumeError,
    OfficialWebHandoffConsumeResult,
    OfficialWebHandoffConsumerSettings,
    OfficialWebSourceObjectStore,
)

_persist_projection_output = _runtime.persist_projection_output


def _sync_runtime_compat_symbols() -> None:
    _runtime.replay_official_web_source_truth_local = replay_official_web_source_truth_local
    _runtime.validate_official_web_projection_output = validate_official_web_projection_output
    _runtime.audit_official_web_projection_chunking = audit_official_web_projection_chunking
    _runtime.persist_projection_output = _persist_projection_output


def consume_official_web_handoffs(*args, **kwargs) -> OfficialWebHandoffConsumeBatchReport:
    _sync_runtime_compat_symbols()
    return _runtime.consume_official_web_handoffs(*args, **kwargs)


def consume_handoff_record(*args, **kwargs) -> OfficialWebHandoffConsumeResult:
    _sync_runtime_compat_symbols()
    return _runtime.consume_handoff_record(*args, **kwargs)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Consume official_web handoff inbox records and replay source-truth projection.",
    )
    parser.add_argument("--event-id")
    parser.add_argument("--limit", type=int, default=20)
    parser.add_argument("--force", action="store_true")
    parser.add_argument("--promote", action="store_true", default=None)
    parser.add_argument("--declarations-path")
    parser.add_argument("--consumer-review-manifest-path")
    parser.add_argument("--admit-release-tasks", action="store_true")
    return parser


def main(argv: Sequence[str] | None = None) -> None:
    load_worker_env()
    args = build_parser().parse_args(list(argv) if argv is not None else None)
    report = consume_official_web_handoffs(
        event_id=args.event_id,
        limit=args.limit,
        force=args.force,
        promote_import=args.promote,
        declarations_path=Path(args.declarations_path).resolve()
        if args.declarations_path
        else None,
        consumer_review_manifest_path=Path(args.consumer_review_manifest_path).resolve()
        if args.consumer_review_manifest_path
        else None,
        release_task_store=build_official_web_release_task_store_from_env()
        if args.admit_release_tasks
        else None,
    )
    print(json.dumps(asdict(report), ensure_ascii=False, indent=2))
    if report.counts["failed"] > 0:
        raise SystemExit(1)


__all__ = [
    "OFFICIAL_WEB_HANDOFF_CONSUME_REPORT_SCHEMA_VERSION",
    "OfficialWebHandoffConsumeBatchReport",
    "OfficialWebHandoffConsumeError",
    "OfficialWebHandoffConsumeResult",
    "OfficialWebHandoffConsumerSettings",
    "OfficialWebSourceObjectStore",
    "_persist_projection_output",
    "audit_official_web_projection_chunking",
    "build_parser",
    "consume_handoff_record",
    "consume_official_web_handoffs",
    "main",
    "replay_official_web_source_truth_local",
    "validate_official_web_projection_output",
]


if __name__ == "__main__":
    main()
