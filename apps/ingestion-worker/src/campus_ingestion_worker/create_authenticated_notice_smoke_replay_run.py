from __future__ import annotations

import argparse
import json
import os
from collections.abc import Mapping, Sequence
from pathlib import Path

from campus_ingestion_core.authenticated_notice_collector_run_ledger import (
    DEFAULT_AUTHENTICATED_NOTICE_COLLECTOR_RUN_LEDGER_TABLE,
)
from campus_ingestion_core.authenticated_notice_smoke_replay_run import (
    authenticated_notice_smoke_replay_run_to_output_files,
    build_authenticated_notice_smoke_replay_run_plan,
    collector_run_ledger_database_url_from_env,
    execute_authenticated_notice_smoke_replay_run_plan,
    fetch_authenticated_notice_collector_run_row,
)

from campus_ingestion_worker.env_bootstrap import load_worker_env

DEFAULT_OUTPUT_DIR = Path(
    "var/ingestion-evidence/authenticated-notice-ingest-queue-e2e-automation/"
    "evidence/smoke-replay-run"
)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Create a synthetic authenticated notice collector run ledger row for smoke replay."
    )
    parser.add_argument("--source-run-id", required=True)
    parser.add_argument("--purpose", required=True)
    parser.add_argument("--synthetic-run-id")
    parser.add_argument("--output-dir", default=str(DEFAULT_OUTPUT_DIR))
    parser.add_argument(
        "--collector-run-ledger-table",
        default=DEFAULT_AUTHENTICATED_NOTICE_COLLECTOR_RUN_LEDGER_TABLE,
    )
    parser.add_argument("--execute", action="store_true")
    return parser


def main(argv: Sequence[str] | None = None) -> None:
    load_worker_env()
    args = build_parser().parse_args(list(argv) if argv is not None else None)
    env = dict(os.environ)
    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    database_url = collector_run_ledger_database_url_from_env(env)
    source_row = fetch_authenticated_notice_collector_run_row(
        database_url=database_url,
        run_id=args.source_run_id,
        table_name=args.collector_run_ledger_table,
    )
    plan = build_authenticated_notice_smoke_replay_run_plan(
        source_row=source_row,
        purpose=args.purpose,
        synthetic_run_id=args.synthetic_run_id,
    )
    payload: Mapping[str, object]
    if args.execute:
        payload = execute_authenticated_notice_smoke_replay_run_plan(
            plan,
            database_url=database_url,
            table_name=args.collector_run_ledger_table,
        )
    else:
        payload = plan
    files = write_authenticated_notice_smoke_replay_run_evidence_files(
        payload=payload,
        output_dir=output_dir,
    )
    print(
        json.dumps(
            {
                "mode": payload["mode"],
                "write_enabled": payload["write_enabled"],
                "source_run_id": payload["source_run_id"],
                "synthetic_run_id": payload["synthetic_run_id"],
                "counts": payload["counts"],
                "files": {name: str(path) for name, path in files.items()},
            },
            ensure_ascii=False,
            indent=2,
            sort_keys=True,
        )
    )


def write_authenticated_notice_smoke_replay_run_evidence_files(
    *,
    payload: Mapping[str, object],
    output_dir: Path,
) -> dict[str, Path]:
    written: dict[str, Path] = {}
    for filename, file_payload in authenticated_notice_smoke_replay_run_to_output_files(
        payload
    ).items():
        path = output_dir / filename
        path.write_text(
            json.dumps(file_payload, ensure_ascii=False, indent=2, sort_keys=True, default=str)
            + "\n",
            encoding="utf-8",
        )
        written[filename] = path
    (output_dir / "synthetic-run-id.txt").write_text(
        str(payload["synthetic_run_id"]) + "\n",
        encoding="utf-8",
    )
    return written


__all__ = [
    "DEFAULT_OUTPUT_DIR",
    "build_parser",
    "main",
    "write_authenticated_notice_smoke_replay_run_evidence_files",
]


if __name__ == "__main__":
    main()
