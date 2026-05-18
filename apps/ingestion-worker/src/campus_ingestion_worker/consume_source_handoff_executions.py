from __future__ import annotations

import argparse
import json
from collections.abc import Mapping, Sequence
from datetime import datetime
from typing import Any

from campus_ingestion_core.source_handoff_execution import (
    SourceHandoffProcessor,
    run_next_source_handoff_execution,
)
from campus_ingestion_core.source_handoff_store import (
    InMemorySourceHandoffStore,
    SourceHandoffStore,
)


def consume_source_handoff_executions(
    *,
    store: SourceHandoffStore,
    processors: Mapping[str, SourceHandoffProcessor],
    worker_id: str,
    limit: int = 1,
    lease_seconds: int = 300,
    retry_after_seconds: int = 300,
    now: datetime | None = None,
) -> dict[str, Any]:
    normalized_limit = _positive_int(limit, "limit")
    results = []
    for _ in range(normalized_limit):
        result = run_next_source_handoff_execution(
            store=store,
            processors=processors,
            worker_id=worker_id,
            lease_seconds=lease_seconds,
            retry_after_seconds=retry_after_seconds,
            now=now,
        )
        results.append(result.to_payload())
        if result.status == "idle":
            break
    return {
        "schema_version": "source_handoff_execution_consume.v1",
        "worker_id": worker_id,
        "limit": normalized_limit,
        "processed_count": sum(1 for result in results if result["status"] != "idle"),
        "idle": bool(results and results[-1]["status"] == "idle"),
        "results": results,
    }


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Consume canonical source handoff executions.")
    parser.add_argument("--worker-id", default="source-handoff-worker")
    parser.add_argument("--limit", type=int, default=1)
    parser.add_argument("--lease-seconds", type=int, default=300)
    parser.add_argument("--retry-after-seconds", type=int, default=300)
    parser.add_argument(
        "--empty-in-memory",
        action="store_true",
        help="Use an empty in-memory store for CLI smoke. Production store wiring is external.",
    )
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    if not args.empty_in_memory:
        raise SystemExit(
            "source handoff store runtime wiring is not configured; pass --empty-in-memory "
            "only for CLI smoke"
        )
    result = consume_source_handoff_executions(
        store=InMemorySourceHandoffStore(),
        processors={},
        worker_id=args.worker_id,
        limit=args.limit,
        lease_seconds=args.lease_seconds,
        retry_after_seconds=args.retry_after_seconds,
    )
    print(json.dumps(result, ensure_ascii=False, sort_keys=True))
    return 0


def _positive_int(value: object, label: str) -> int:
    if isinstance(value, bool):
        raise ValueError(f"{label} must be positive")
    try:
        parsed = int(value)  # type: ignore[arg-type]
    except (TypeError, ValueError) as exc:
        raise ValueError(f"{label} must be positive") from exc
    if parsed <= 0:
        raise ValueError(f"{label} must be positive")
    return parsed


if __name__ == "__main__":
    raise SystemExit(main())


__all__ = ["build_parser", "consume_source_handoff_executions", "main"]
