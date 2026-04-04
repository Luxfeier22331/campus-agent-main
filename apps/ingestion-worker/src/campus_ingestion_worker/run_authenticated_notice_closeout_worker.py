from __future__ import annotations

import argparse
import json
from typing import Sequence

from campus_ingestion_core.authenticated_notice_closeout import (
    AuthenticatedNoticeCloseoutService,
)
from campus_ingestion_worker.env_bootstrap import load_worker_env


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Run one authenticated notice closeout worker"
    )
    parser.add_argument("--run-id", required=True)
    parser.add_argument("--worker-id", required=True)
    return parser


def main(argv: Sequence[str] | None = None) -> None:
    load_worker_env()
    args = build_parser().parse_args(list(argv) if argv is not None else None)
    service = AuthenticatedNoticeCloseoutService.from_env()
    summary = service.run_worker(
        run_id=args.run_id,
        worker_id=args.worker_id,
    )
    print(json.dumps(summary, ensure_ascii=False, indent=2))


__all__ = ["build_parser", "main"]


if __name__ == "__main__":
    main()
