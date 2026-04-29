from __future__ import annotations

import argparse
import json
import os
from collections.abc import Mapping, Sequence
from pathlib import Path

from campus_ingestion_core.collected_notice_historical_enqueue import (
    DEFAULT_HISTORICAL_REPLAY_BATCH_ID,
    build_historical_notice_enqueue_plan,
    execute_historical_notice_enqueue_plan,
    historical_enqueue_to_output_files,
)
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

DEFAULT_REIMPORT_PLAN_PATH = Path(
    ".planning/workstreams/collected-notice-consumption-replay-closeout/"
    "evidence/phase-04-dry-run-reimport-and-universal-search-preview/"
    "reimport-plan.dry-run.json"
)
DEFAULT_PHASE_04_7_OUTPUT_DIR = Path(
    ".planning/workstreams/collected-notice-consumption-replay-closeout/"
    "evidence/phase-04-7-historical-captured-inventory-synthetic-enqueue"
)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Create or execute collected notice historical queue enqueue plan"
    )
    parser.add_argument("--reimport-plan-path", default=str(DEFAULT_REIMPORT_PLAN_PATH))
    parser.add_argument("--output-dir", default=str(DEFAULT_PHASE_04_7_OUTPUT_DIR))
    parser.add_argument("--replay-batch-id", default=DEFAULT_HISTORICAL_REPLAY_BATCH_ID)
    parser.add_argument(
        "--execute",
        action="store_true",
        help="Write queue jobs only. Dry-run is the default.",
    )
    return parser


def main(argv: Sequence[str] | None = None) -> None:
    load_worker_env()
    args = build_parser().parse_args(list(argv) if argv is not None else None)
    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    reimport_plan_payload = json.loads(Path(args.reimport_plan_path).read_text(encoding="utf-8"))
    if not isinstance(reimport_plan_payload, Mapping):
        raise ValueError("reimport plan must be a JSON object")
    plan = build_historical_notice_enqueue_plan(
        reimport_plan_payload,
        replay_batch_id=args.replay_batch_id,
    )
    payload: Mapping[str, object]
    if args.execute:
        env = dict(os.environ)
        store = build_notice_ingest_queue_store_from_env(
            env,
            prefer_operator=_has_operator_database_url(env),
        )
        payload = execute_historical_notice_enqueue_plan(plan, queue_store=store)
    else:
        payload = plan
    files = write_historical_enqueue_evidence_files(payload=payload, output_dir=output_dir)
    summary = {
        "mode": payload["mode"],
        "write_enabled": payload["write_enabled"],
        "output_dir": str(output_dir),
        "files": {name: str(path) for name, path in files.items()},
        "counts": payload["counts"],
    }
    print(json.dumps(summary, ensure_ascii=False, indent=2, sort_keys=True))


def write_historical_enqueue_evidence_files(
    *,
    payload: Mapping[str, object],
    output_dir: Path,
) -> dict[str, Path]:
    written: dict[str, Path] = {}
    for filename, file_payload in historical_enqueue_to_output_files(payload).items():
        file_path = output_dir / filename
        file_path.write_text(
            json.dumps(file_payload, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
        written[filename] = file_path
    return written


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
    "DEFAULT_PHASE_04_7_OUTPUT_DIR",
    "DEFAULT_REIMPORT_PLAN_PATH",
    "build_notice_ingest_queue_store_from_env",
    "build_parser",
    "main",
    "write_historical_enqueue_evidence_files",
]


if __name__ == "__main__":
    main()
