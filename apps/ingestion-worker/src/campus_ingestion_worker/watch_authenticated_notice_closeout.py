from __future__ import annotations

import argparse
import json
import time
from typing import Sequence

from campus_ingestion_core.authenticated_notice_closeout import AuthenticatedNoticeCloseoutService

from campus_ingestion_worker.env_bootstrap import load_worker_env


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Watch authenticated notice closeout progress")
    parser.add_argument("--run-id", required=True)
    parser.add_argument("--interval", type=float, default=2.0)
    parser.add_argument("--iterations", type=int, default=5)
    return parser


def main(argv: Sequence[str] | None = None) -> None:
    load_worker_env()
    args = build_parser().parse_args(list(argv) if argv is not None else None)
    service = AuthenticatedNoticeCloseoutService.from_env()
    for iteration in range(max(0, args.iterations)):
        payload = service.show_run(args.run_id)
        print(json.dumps(payload, ensure_ascii=False))
        if iteration + 1 < args.iterations:
            time.sleep(args.interval)


__all__ = ["build_parser", "main"]


if __name__ == "__main__":
    main()
