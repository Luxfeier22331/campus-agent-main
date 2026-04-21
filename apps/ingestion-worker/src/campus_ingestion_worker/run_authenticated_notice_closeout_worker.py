from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor
from typing import Sequence

from campus_ingestion_core.authenticated_notice_closeout import (
    AuthenticatedNoticeCloseoutService,
)

from campus_ingestion_worker.env_bootstrap import load_worker_env


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Run authenticated notice closeout worker(s)")
    parser.add_argument("--run-id", required=True)
    parser.add_argument("--worker-id")
    parser.add_argument("--parallel-workers", type=int, default=1)
    parser.add_argument("--worker-id-prefix")
    return parser


def _run_single_worker_subprocess(*, run_id: str, worker_id: str) -> None:
    completed = subprocess.run(
        [
            sys.executable,
            "-m",
            "campus_ingestion_worker.run_authenticated_notice_closeout_worker",
            "--run-id",
            run_id,
            "--worker-id",
            worker_id,
        ],
        check=False,
        capture_output=True,
        text=True,
        env=dict(os.environ),
    )
    if completed.returncode == 0:
        return
    stderr = completed.stderr.strip()
    stdout = completed.stdout.strip()
    detail = stderr or stdout or f"worker subprocess exited with code {completed.returncode}"
    raise RuntimeError(detail)


def _run_parallel_worker_subprocesses(
    *,
    run_id: str,
    worker_ids: tuple[str, ...],
) -> None:
    failures: list[tuple[str, Exception]] = []
    with ThreadPoolExecutor(
        max_workers=len(worker_ids),
        thread_name_prefix="closeout-worker-subprocess",
    ) as executor:
        future_by_worker = {
            executor.submit(
                _run_single_worker_subprocess,
                run_id=run_id,
                worker_id=worker_id,
            ): worker_id
            for worker_id in worker_ids
        }
        for future, worker_id in future_by_worker.items():
            try:
                future.result()
            except Exception as exc:
                failures.append((worker_id, exc))
    if failures:
        worker_id, exc = failures[0]
        raise RuntimeError(f"closeout worker failed: {worker_id}: {exc}") from exc


def main(argv: Sequence[str] | None = None) -> None:
    load_worker_env()
    parser = build_parser()
    args = parser.parse_args(list(argv) if argv is not None else None)
    if args.parallel_workers <= 0:
        parser.error("--parallel-workers must be positive")
    if args.parallel_workers == 1:
        if not args.worker_id:
            parser.error("--worker-id is required when --parallel-workers=1")
        service = AuthenticatedNoticeCloseoutService.from_env()
        summary = service.run_worker(
            run_id=args.run_id,
            worker_id=args.worker_id,
        )
    else:
        worker_id_prefix = (args.worker_id_prefix or args.worker_id or "").strip()
        if not worker_id_prefix:
            parser.error("--worker-id-prefix is required when --parallel-workers is greater than 1")
        worker_ids = tuple(
            f"{worker_id_prefix}-{index + 1:02d}" for index in range(args.parallel_workers)
        )
        _run_parallel_worker_subprocesses(
            run_id=args.run_id,
            worker_ids=worker_ids,
        )
        service = AuthenticatedNoticeCloseoutService.from_env()
        summary = service.show_run(args.run_id)
    print(json.dumps(summary, ensure_ascii=False, indent=2))


__all__ = [
    "_run_parallel_worker_subprocesses",
    "_run_single_worker_subprocess",
    "build_parser",
    "main",
]


if __name__ == "__main__":
    main()
