from __future__ import annotations

import argparse
import json
import os
from collections.abc import Sequence

from campus_ingestion_core.collected_notice_ingest_queue_postgres import (
    DEFAULT_NOTICE_INGEST_QUEUE_MANAGEMENT_ENV_KEY,
    DEFAULT_NOTICE_INGEST_QUEUE_OPERATOR_ENV_KEY,
    build_notice_ingest_queue_store_from_env,
)
from campus_ingestion_core.registry import (
    SHARED_POSTGRES_MANAGEMENT_ENV_KEY,
    SHARED_POSTGRES_OPERATOR_ENV_KEY,
)

from campus_ingestion_worker.env_bootstrap import load_worker_env


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Show collected notice ingest queue status")
    parser.add_argument(
        "--json",
        action="store_true",
        help="Emit a machine-readable JSON summary.",
    )
    return parser


def main(argv: Sequence[str] | None = None) -> None:
    load_worker_env()
    args = build_parser().parse_args(list(argv) if argv is not None else None)
    env = dict(os.environ)
    store = build_notice_ingest_queue_store_from_env(
        env,
        prefer_operator=_has_operator_database_url(env),
    )
    payload = {
        "queue": "notice_ingest",
        "write_enabled": False,
        "status_counts": store.list_status_counts(),
    }
    if args.json:
        print(json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True))
        return
    print(_format_text_summary(payload))


def _format_text_summary(payload: dict[str, object]) -> str:
    counts = dict(payload["status_counts"])
    lines = [
        "notice_ingest queue status",
        "write_enabled=false",
    ]
    for status in (
        "queued",
        "leased",
        "succeeded",
        "failed_retryable",
        "failed_terminal",
        "dead_letter",
        "manual_review",
        "blocked",
        "cancelled",
    ):
        lines.append(f"{status}={int(counts.get(status, 0))}")
    return "\n".join(lines)


def _has_operator_database_url(env: dict[str, str]) -> bool:
    return any(
        env.get(key)
        for key in (
            DEFAULT_NOTICE_INGEST_QUEUE_OPERATOR_ENV_KEY,
            DEFAULT_NOTICE_INGEST_QUEUE_MANAGEMENT_ENV_KEY,
            SHARED_POSTGRES_OPERATOR_ENV_KEY,
            SHARED_POSTGRES_MANAGEMENT_ENV_KEY,
        )
    )


__all__ = [
    "build_notice_ingest_queue_store_from_env",
    "build_parser",
    "main",
]


if __name__ == "__main__":
    main()
