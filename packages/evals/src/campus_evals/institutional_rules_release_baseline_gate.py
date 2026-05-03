from __future__ import annotations

import argparse
import json
import subprocess
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[4]
DEFAULT_REPORT_NAME = "institutional-rules-release-baseline-gate.json"
DEFAULT_SCHEMA_VERSION = "institutional_rules_release_baseline_gate.v1"
DEFAULT_GATE_ID = "institutional_rules_release_baseline"
DEFAULT_RELEASE_RETRIEVAL_CASES = 45
DEFAULT_GOLDEN_RETRIEVAL_CASES = 89
DEFAULT_ANSWER_CASES = 42
DEFAULT_API_PORT = 27151
DEFAULT_WORKER_PORT = 27152


@dataclass(frozen=True, slots=True)
class CommandResult:
    returncode: int
    stdout: str = ""
    stderr: str = ""


CommandRunner = Callable[[tuple[str, ...]], CommandResult]


def run_institutional_rules_release_baseline_gate(
    *,
    output_dir: Path,
    answer_observations_path: Path,
    command_runner: CommandRunner | None = None,
    timeout_seconds: float = 90.0,
    startup_timeout_seconds: float = 240.0,
    api_port: int = DEFAULT_API_PORT,
    worker_port: int = DEFAULT_WORKER_PORT,
) -> dict[str, object]:
    output_dir.mkdir(parents=True, exist_ok=True)
    command = command_runner or _run_command
    checks = (
        _run_retrieval_check(
            check_id="release_retrieval_live",
            qrels_path=Path("packages/evals/fixtures/institutional_rules_retrieval_qrels.json"),
            output_path=output_dir / "retrieval-live-run.json",
            expected_cases=DEFAULT_RELEASE_RETRIEVAL_CASES,
            top_k=3,
            command_runner=command,
            output_dir=output_dir,
        ),
        _run_retrieval_check(
            check_id="golden_retrieval_live",
            qrels_path=Path(
                "packages/evals/fixtures/institutional_rules_golden_retrieval_qrels.v1.json"
            ),
            output_path=output_dir / "golden-retrieval-live-run.json",
            expected_cases=DEFAULT_GOLDEN_RETRIEVAL_CASES,
            top_k=5,
            command_runner=command,
            output_dir=output_dir,
        ),
        _run_answer_quality_check(
            answer_observations_path=answer_observations_path,
            command_runner=command,
            output_dir=output_dir,
        ),
        _run_command_check(
            check_id="backend_qdrant_no_hit_suite",
            command=(
                "uv",
                "run",
                "--all-packages",
                "python",
                "-m",
                "unittest",
                "tests.retrieval.backend_qdrant_no_hit_suite",
                "-v",
            ),
            command_runner=command,
            output_dir=output_dir,
        ),
        _run_product_path_smoke_check(
            command_runner=command,
            output_dir=output_dir,
            timeout_seconds=timeout_seconds,
            startup_timeout_seconds=startup_timeout_seconds,
            api_port=api_port,
            worker_port=worker_port,
        ),
    )
    passed_checks = sum(1 for check in checks if check["passed"] is True)
    payload: dict[str, object] = {
        "schema_version": DEFAULT_SCHEMA_VERSION,
        "gate_id": DEFAULT_GATE_ID,
        "passed": passed_checks == len(checks),
        "summary": {
            "total_checks": len(checks),
            "passed_checks": passed_checks,
            "failed_checks": len(checks) - passed_checks,
            "scope": "regulations/institutional_rules",
            "released_document_count": DEFAULT_ANSWER_CASES,
            "release_retrieval_cases": DEFAULT_RELEASE_RETRIEVAL_CASES,
            "golden_retrieval_cases": DEFAULT_GOLDEN_RETRIEVAL_CASES,
        },
        "checks": list(checks),
    }
    (output_dir / DEFAULT_REPORT_NAME).write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    return payload


def _run_retrieval_check(
    *,
    check_id: str,
    qrels_path: Path,
    output_path: Path,
    expected_cases: int,
    top_k: int,
    command_runner: CommandRunner,
    output_dir: Path,
) -> dict[str, object]:
    result = _run_command_check(
        check_id=check_id,
        command=(
            "uv",
            "run",
            "--all-packages",
            "python",
            "-m",
            "campus_evals.retrieval_live_benchmark",
            "--qrels",
            str(qrels_path),
            "--output",
            str(output_path),
            "--format",
            "json",
            "--top-k",
            str(top_k),
        ),
        command_runner=command_runner,
        output_dir=output_dir,
    )
    summary = _json_from_output(str(result.get("stdout") or ""))
    metrics_passed = (
        summary.get("total_cases") == expected_cases
        and summary.get("doc_hit_at_1") == 1.0
        and summary.get("doc_recall_at_5") == 1.0
        and summary.get("forbidden_hit_rate") == 0.0
    )
    return {
        **_without_raw_output(result),
        "passed": bool(result["passed"] and metrics_passed),
        "summary": {
            "expected_cases": expected_cases,
            "total_cases": summary.get("total_cases"),
            "doc_hit_at_1": summary.get("doc_hit_at_1"),
            "doc_recall_at_5": summary.get("doc_recall_at_5"),
            "forbidden_hit_rate": summary.get("forbidden_hit_rate"),
            "run_path": str(output_path),
        },
    }


def _run_answer_quality_check(
    *,
    answer_observations_path: Path,
    command_runner: CommandRunner,
    output_dir: Path,
) -> dict[str, object]:
    result = _run_command_check(
        check_id="answer_quality_contract",
        command=(
            "uv",
            "run",
            "--all-packages",
            "python",
            "-m",
            "campus_evals.answer_quality_contract",
            "accept",
            "--cases-path",
            "packages/evals/fixtures/institutional_rules_answer_quality_cases.v1.json",
            "--observations-path",
            str(answer_observations_path),
            "--output-dir",
            str(output_dir / "answer-quality-contract"),
            "--json",
        ),
        command_runner=command_runner,
        output_dir=output_dir,
    )
    payload = _json_from_output(str(result.get("stdout") or ""))
    summary = dict(payload.get("summary") or {})
    contract_passed = (
        payload.get("passed") is True
        and summary.get("total") == DEFAULT_ANSWER_CASES
        and summary.get("passed") == DEFAULT_ANSWER_CASES
        and summary.get("failed") == 0
    )
    return {
        **_without_raw_output(result),
        "passed": bool(result["passed"] and contract_passed),
        "summary": {
            "total": summary.get("total"),
            "passed": summary.get("passed"),
            "failed": summary.get("failed"),
            "profile_report_path": str(
                output_dir / "answer-quality-contract" / "profile-report.json"
            ),
        },
    }


def _run_product_path_smoke_check(
    *,
    command_runner: CommandRunner,
    output_dir: Path,
    timeout_seconds: float,
    startup_timeout_seconds: float,
    api_port: int,
    worker_port: int,
) -> dict[str, object]:
    result = _run_command_check(
        check_id="rag_delegate_institutional_rules_product_path_smoke",
        command=(
            "uv",
            "run",
            "--all-packages",
            "python",
            "-m",
            "scripts.supervisor_runtime_process_smoke",
            "--profile",
            "rag_delegate_institutional_rules",
            "--output-dir",
            str(output_dir / "product-path-smoke"),
            "--api-port",
            str(api_port),
            "--worker-port",
            str(worker_port),
            "--timeout-seconds",
            str(timeout_seconds),
            "--startup-timeout-seconds",
            str(startup_timeout_seconds),
        ),
        command_runner=command_runner,
        output_dir=output_dir,
    )
    payload = _json_from_output(str(result.get("stdout") or ""))
    return {
        **_without_raw_output(result),
        "passed": bool(result["passed"] and payload.get("passed") is True),
        "summary": {
            "profile": payload.get("profile"),
            "passed": payload.get("passed"),
            "summary_path": str(output_dir / "product-path-smoke" / "process-smoke-summary.json"),
        },
    }


def _run_command_check(
    *,
    check_id: str,
    command: tuple[str, ...],
    command_runner: CommandRunner,
    output_dir: Path,
) -> dict[str, object]:
    result = command_runner(command)
    logs_dir = output_dir / "command-logs"
    logs_dir.mkdir(parents=True, exist_ok=True)
    stdout_path = logs_dir / f"{check_id}.stdout.log"
    stderr_path = logs_dir / f"{check_id}.stderr.log"
    stdout_path.write_text(result.stdout, encoding="utf-8")
    stderr_path.write_text(result.stderr, encoding="utf-8")
    return {
        "check_id": check_id,
        "passed": result.returncode == 0,
        "returncode": result.returncode,
        "command": list(command),
        "stdout_path": str(stdout_path),
        "stderr_path": str(stderr_path),
        "stdout": result.stdout,
        "stderr": result.stderr,
    }


def _without_raw_output(check: dict[str, object]) -> dict[str, object]:
    return {key: value for key, value in check.items() if key not in {"stdout", "stderr"}}


def _run_command(command: tuple[str, ...]) -> CommandResult:
    completed = subprocess.run(
        command,
        cwd=REPO_ROOT,
        text=True,
        capture_output=True,
        check=False,
    )
    return CommandResult(
        returncode=completed.returncode,
        stdout=completed.stdout,
        stderr=completed.stderr,
    )


def _json_from_output(output: str) -> dict[str, object]:
    text = output.strip()
    if not text:
        return {}
    start = text.find("{")
    end = text.rfind("}")
    if start < 0 or end < start:
        return {}
    try:
        payload = json.loads(text[start : end + 1])
    except json.JSONDecodeError:
        return {}
    return payload if isinstance(payload, dict) else {}


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Run institutional_rules release baseline gate.")
    subparsers = parser.add_subparsers(dest="command", required=True)
    accept = subparsers.add_parser(
        "accept",
        help="Run institutional_rules retrieval, answer, no-hit and product-path baseline.",
    )
    accept.add_argument("--output-dir", required=True)
    accept.add_argument("--reruns", type=int, default=1)
    accept.add_argument("--observations-path", required=True)
    accept.add_argument("--timeout-seconds", type=float, default=90.0)
    accept.add_argument("--startup-timeout-seconds", type=float, default=240.0)
    accept.add_argument("--api-port", type=int, default=DEFAULT_API_PORT)
    accept.add_argument("--worker-port", type=int, default=DEFAULT_WORKER_PORT)
    accept.add_argument("--cases-path")
    accept.add_argument("--collect-runtime", action="store_true")
    accept.add_argument("--artifact-path", action="append", default=[])
    accept.add_argument("--verbose", action="store_true")
    accept.add_argument("--log-jsonl")
    accept.add_argument("--json", action="store_true")
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    args = build_parser().parse_args(list(argv) if argv is not None else None)
    if args.command != "accept":
        raise ValueError(f"unsupported command: {args.command}")
    if args.reruns != 1:
        raise ValueError("institutional_rules release baseline gate requires reruns=1")
    if args.collect_runtime:
        raise ValueError("institutional_rules release baseline runtime collection is not supported")
    payload = run_institutional_rules_release_baseline_gate(
        output_dir=Path(args.output_dir),
        answer_observations_path=Path(args.observations_path),
        timeout_seconds=float(args.timeout_seconds),
        startup_timeout_seconds=float(args.startup_timeout_seconds),
        api_port=int(args.api_port),
        worker_port=int(args.worker_port),
    )
    if args.json:
        print(json.dumps(payload, ensure_ascii=False, indent=2))
    elif args.verbose:
        print(
            "institutional_rules release baseline gate: "
            f"{'PASS' if payload['passed'] else 'FAIL'} "
            f"artifact={Path(args.output_dir) / DEFAULT_REPORT_NAME}"
        )
    return 0 if payload["passed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
