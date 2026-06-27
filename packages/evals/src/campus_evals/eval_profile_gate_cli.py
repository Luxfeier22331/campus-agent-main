from __future__ import annotations

import argparse
import json
from collections.abc import Sequence
from pathlib import Path

from campus_evals.eval_profile_gate import (
    run_agentic_retrieval_plan_profile_gate,
    run_authz_privacy_profile_gate,
    run_document_quality_profile_gate,
    run_eval_operations_governance_profile_gate,
    run_online_answer_path_profile_gate,
    run_tool_denominator_profile_gate,
)
from campus_evals.eval_profile_gate_loading import _load_json
from campus_evals.eval_profile_gate_models import EvalProfileGateReport


def online_answer_path_main(argv: Sequence[str] | None = None) -> int:
    return _profile_main("online_answer_path", argv)


def tool_denominator_main(argv: Sequence[str] | None = None) -> int:
    return _profile_main("tool_denominator", argv)


def document_quality_main(argv: Sequence[str] | None = None) -> int:
    return _profile_main("document_quality", argv)


def authz_privacy_main(argv: Sequence[str] | None = None) -> int:
    return _profile_main("authz_privacy", argv)


def agentic_retrieval_plan_main(argv: Sequence[str] | None = None) -> int:
    return _profile_main("agentic_retrieval_plan", argv)


def eval_operations_governance_main(argv: Sequence[str] | None = None) -> int:
    return _profile_main("eval_operations_governance", argv)


def _profile_main(profile_id: str, argv: Sequence[str] | None = None) -> int:
    args = _build_parser(profile_id).parse_args(list(argv) if argv is not None else None)
    if args.command != "accept":
        raise ValueError(f"unsupported command: {args.command}")
    if args.reruns != 1:
        raise ValueError(f"{profile_id} gate is deterministic and requires reruns=1")

    report = _run_profile_from_args(profile_id, args)
    if args.json:
        print(json.dumps(_load_json(report.output_path), ensure_ascii=False, indent=2))
    elif args.verbose:
        print(
            f"{profile_id} gate: {'PASS' if report.passed else 'FAIL'} "
            f"artifact={report.output_path}"
        )
    return 0 if report.passed else 1


def _run_profile_from_args(
    profile_id: str,
    args: argparse.Namespace,
) -> EvalProfileGateReport:
    output_dir = Path(args.output_dir)
    cases_path = Path(args.cases_path) if args.cases_path else None
    observations_path = Path(args.observations_path) if args.observations_path else None
    artifact_paths = tuple(Path(item) for item in args.artifact_path)
    manifest_path = artifact_paths[0] if artifact_paths else None
    if profile_id == "online_answer_path":
        return run_online_answer_path_profile_gate(
            output_dir=output_dir,
            cases_path=cases_path,
            observations_path=observations_path,
            collect_runtime=bool(args.collect_runtime),
        )
    if profile_id == "tool_denominator":
        return run_tool_denominator_profile_gate(
            output_dir=output_dir,
            cases_path=cases_path,
            observations_path=observations_path,
            collect_runtime=bool(args.collect_runtime),
        )
    if profile_id == "document_quality":
        return run_document_quality_profile_gate(
            output_dir=output_dir,
            cases_path=cases_path,
            observations_path=observations_path,
            collect_runtime=bool(args.collect_runtime),
            manifest_path=manifest_path,
        )
    if profile_id == "authz_privacy":
        return run_authz_privacy_profile_gate(
            output_dir=output_dir,
            cases_path=cases_path,
            observations_path=observations_path,
            collect_runtime=bool(args.collect_runtime),
        )
    if profile_id == "agentic_retrieval_plan":
        return run_agentic_retrieval_plan_profile_gate(
            output_dir=output_dir,
            cases_path=cases_path,
            observations_path=observations_path,
            collect_runtime=bool(args.collect_runtime),
        )
    if profile_id == "eval_operations_governance":
        return run_eval_operations_governance_profile_gate(
            output_dir=output_dir,
            observations_path=observations_path,
            artifact_paths=artifact_paths,
        )
    raise ValueError(f"unsupported profile: {profile_id}")


def _build_parser(profile_id: str) -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=f"Run {profile_id} eval profile gate.")
    subparsers = parser.add_subparsers(dest="command", required=True)
    accept_parser = subparsers.add_parser("accept", help=f"Run {profile_id} profile gate.")
    accept_parser.add_argument("--output-dir", required=True)
    accept_parser.add_argument("--reruns", type=int, default=1)
    accept_parser.add_argument("--cases-path")
    accept_parser.add_argument("--observations-path")
    accept_parser.add_argument("--collect-runtime", action="store_true")
    accept_parser.add_argument("--artifact-path", action="append", default=[])
    accept_parser.add_argument("--verbose", action="store_true")
    accept_parser.add_argument("--log-jsonl")
    accept_parser.add_argument("--json", action="store_true")
    return parser


__all__ = [
    "agentic_retrieval_plan_main",
    "authz_privacy_main",
    "document_quality_main",
    "eval_operations_governance_main",
    "online_answer_path_main",
    "tool_denominator_main",
]
