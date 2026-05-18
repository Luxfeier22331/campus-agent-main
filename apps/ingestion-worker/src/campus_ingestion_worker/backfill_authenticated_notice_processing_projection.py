from __future__ import annotations

import argparse
import json
import os
from collections.abc import Mapping, Sequence
from pathlib import Path
from typing import Any

from campus_ingestion_core.authenticated_notice_processing_projection_backfill import (
    backfill_authenticated_notice_processing_projection,
)
from campus_ingestion_core.collected_notice_ingest_queue_store import (
    NoticeIngestQueueRecord,
    notice_ingest_job_from_payload,
)

from campus_ingestion_worker.authenticated_notice_processing_projection_reporting import (
    build_processing_projection_reporter_from_env,
)
from campus_ingestion_worker.env_bootstrap import load_worker_env


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description=(
            "Backfill app-api authenticated notice processing projection from existing "
            "queue records and queue-consumer trace evidence."
        )
    )
    parser.add_argument("--queue-records-path", required=True)
    parser.add_argument("--trace-path", required=True)
    parser.add_argument("--notice-id", action="append", default=[])
    parser.add_argument("--run-id")
    parser.add_argument("--replay-batch-id")
    parser.add_argument("--projected-at")
    parser.add_argument("--output-path")
    return parser


def main(argv: Sequence[str] | None = None) -> None:
    load_worker_env()
    args = build_parser().parse_args(list(argv) if argv is not None else None)
    env = dict(os.environ)
    reporter = build_processing_projection_reporter_from_env(env)
    if reporter is None:
        result = {
            "schema_version": "authenticated_notice_processing_projection_backfill_worker.v1",
            "verdict": "blocked",
            "findings": [
                {
                    "severity": "high",
                    "code": "app_api_projection_callback_missing",
                    "message": (
                        "INGESTION_WORKER_APP_API_BASE_URL and "
                        "INGESTION_WORKER_APP_API_INTERNAL_SHARED_SECRET are required"
                    ),
                }
            ],
            "medium_or_higher_finding_count": 1,
        }
    else:
        result = backfill_authenticated_notice_processing_projection(
            records=_load_records(Path(args.queue_records_path)),
            trace_rows=_load_trace_rows(Path(args.trace_path)),
            reporter=reporter,
            notice_ids=tuple(args.notice_id or ()),
            run_id=args.run_id,
            replay_batch_id=args.replay_batch_id,
            projected_at=args.projected_at,
        )

    if args.output_path:
        output_path = Path(args.output_path)
        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_path.write_text(
            json.dumps(result, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
            encoding="utf-8",
        )
    print(
        json.dumps(
            {
                "verdict": result["verdict"],
                "reported_snapshot_count": result.get("reported_snapshot_count", 0),
                "medium_or_higher_finding_count": result.get(
                    "medium_or_higher_finding_count",
                    0,
                ),
            },
            ensure_ascii=False,
            indent=2,
            sort_keys=True,
        )
    )


def _load_records(path: Path) -> tuple[NoticeIngestQueueRecord, ...]:
    payload = _load_json(path)
    if isinstance(payload, Mapping):
        rows = payload.get("records") or payload.get("queue_records") or ()
    else:
        rows = payload
    if not isinstance(rows, Sequence) or isinstance(rows, str | bytes):
        raise ValueError("queue records payload must be a list")
    return tuple(_record_from_payload(row) for row in rows if isinstance(row, Mapping))


def _record_from_payload(payload: Mapping[str, Any]) -> NoticeIngestQueueRecord:
    job_payload = payload.get("job")
    if not isinstance(job_payload, Mapping):
        raise ValueError("queue record payload must include job")
    return NoticeIngestQueueRecord(
        job=notice_ingest_job_from_payload(job_payload),
        status=str(payload.get("status") or "queued"),
        attempt_count=int(payload.get("attempt_count") or 0),
        max_attempts=int(payload.get("max_attempts") or 3),
        leased_by=_optional_text(payload.get("leased_by")),
        lease_expires_at=_optional_text(payload.get("lease_expires_at")),
        next_retry_after=_optional_text(payload.get("next_retry_after")),
        last_error_code=_optional_text(payload.get("last_error_code")),
        last_error_message=_optional_text(payload.get("last_error_message")),
        created_at=_optional_text(payload.get("created_at")),
        updated_at=_optional_text(payload.get("updated_at")),
    )


def _load_trace_rows(path: Path) -> tuple[Mapping[str, Any], ...]:
    payload = _load_json(path)
    rows = payload.get("trace_rows") if isinstance(payload, Mapping) else payload
    if not isinstance(rows, Sequence) or isinstance(rows, str | bytes):
        raise ValueError("trace payload must be a list or object with trace_rows")
    return tuple(row for row in rows if isinstance(row, Mapping))


def _load_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def _optional_text(value: object) -> str | None:
    text = str(value or "").strip()
    return text or None


if __name__ == "__main__":
    main()
