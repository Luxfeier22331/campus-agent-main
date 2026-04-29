from __future__ import annotations

import argparse
import json
from collections.abc import Sequence
from pathlib import Path

from scripts.supervisor_runtime_process_smoke import (
    build_process_smoke_plan,
    run_process_smoke,
)

REPO_ROOT = Path(__file__).resolve().parents[4]
DEFAULT_REPORT_NAME = "multi-agent-live-smoke-gate.json"
DEFAULT_SCHEMA_VERSION = "multi_agent_live_smoke_gate.v1"


def run_multi_agent_live_smoke_gate(
    *,
    output_dir: Path,
    timeout_seconds: float = 45.0,
) -> dict[str, object]:
    output_dir.mkdir(parents=True, exist_ok=True)
    process_output_dir = output_dir / "process-smoke"
    plan = build_process_smoke_plan(
        repo_root=REPO_ROOT,
        output_dir=process_output_dir,
        profile="closed_gate",
    )
    smoke_summary = run_process_smoke(plan, timeout_seconds=timeout_seconds)
    payload = {
        "schema_version": DEFAULT_SCHEMA_VERSION,
        "gate_id": "multi_agent_live_smoke",
        "passed": smoke_summary.get("passed") is True,
        "scope": {
            "runtime": "direct_local_processes",
            "starts_docker": False,
            "starts_wrangler": False,
            "probes": [
                "supervisor-agent-worker /internal/bridge/healthz",
                "supervisor-api /healthz",
                "supervisor-api /readyz",
                "supervisor-api /metrics",
                "supervisor-api /api/v1/answer closed structured gate",
            ],
        },
        "process_smoke": smoke_summary,
    }
    (output_dir / DEFAULT_REPORT_NAME).write_text(
        json.dumps(payload, ensure_ascii=False, indent=2, default=str) + "\n",
        encoding="utf-8",
    )
    return payload


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Run multi-agent direct-process live smoke gate.")
    subparsers = parser.add_subparsers(dest="command", required=True)
    accept_parser = subparsers.add_parser(
        "accept",
        help="Run direct local process multi-agent smoke.",
    )
    accept_parser.add_argument("--output-dir", required=True)
    accept_parser.add_argument(
        "--reruns",
        type=int,
        default=1,
        help="Accepted for shared eval_gate profile compatibility; must be 1.",
    )
    accept_parser.add_argument("--timeout-seconds", type=float, default=45.0)
    accept_parser.add_argument("--verbose", action="store_true")
    accept_parser.add_argument("--log-jsonl")
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    args = build_parser().parse_args(list(argv) if argv is not None else None)
    if args.command != "accept":
        raise ValueError(f"unsupported command: {args.command}")
    if args.reruns != 1:
        raise ValueError("multi-agent live-smoke gate requires reruns=1")
    payload = run_multi_agent_live_smoke_gate(
        output_dir=Path(args.output_dir),
        timeout_seconds=float(args.timeout_seconds),
    )
    if args.verbose:
        print(
            "multi-agent live-smoke gate: "
            f"{'PASS' if payload['passed'] else 'FAIL'} "
            f"artifact={Path(args.output_dir) / DEFAULT_REPORT_NAME}"
        )
    return 0 if payload["passed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
