from __future__ import annotations

import argparse
from datetime import datetime
from pathlib import Path
from typing import Callable

from campus_contracts import EvidenceBundle, RagRequestPayload, RagResultPayload, SpecialistRequest, SpecialistResponse
from campus_evals.handbook_benchmark import repair_handbook_formal_benchmark, run_handbook_formal_benchmark
from campus_evals.judge_adapters import build_default_handbook_supplemental_adapters_from_env
from campus_evals.models import ExecutionResult, GoldenCase, ObservedTrace
from campus_evals.scenarios import handbook_release_gate_cases
from campus_rag_specialist import delegate_to_rag_agent
from campus_retrieval_core import retrieve_sources


RUN_PREFIX = "student-handbook-formal-benchmark"
REPAIR_PREFIX = "student-handbook-formal-benchmark-repair"

Retriever = Callable[..., EvidenceBundle]
Delegate = Callable[..., SpecialistResponse]


def build_default_output_dir(*, prefix: str, timestamp: str | None = None) -> Path:
    resolved_timestamp = timestamp or datetime.now().strftime("%Y%m%dT%H%M%S")
    return Path(".tmp/evals") / f"{prefix}-{resolved_timestamp}"


def build_handbook_live_executor(
    *,
    retriever: Retriever = retrieve_sources,
    delegate: Delegate = delegate_to_rag_agent,
) -> Callable[[GoldenCase], ExecutionResult]:
    def _execute(case: GoldenCase) -> ExecutionResult:
        retrieved_evidence: EvidenceBundle | None = None
        retrieval_called = False

        def _traced_retriever(*args, **kwargs) -> EvidenceBundle:
            nonlocal retrieved_evidence, retrieval_called
            retrieval_called = True
            retrieved_evidence = retriever(*args, **kwargs)
            return retrieved_evidence

        request = SpecialistRequest(
            target="rag-specialist",
            user_goal=case.user_goal,
            payload=RagRequestPayload(scope=case.scope),
            actor=case.actor,
        )
        response = delegate(request, retriever=_traced_retriever)
        supporting_sources = ()
        if isinstance(response.result, RagResultPayload):
            supporting_sources = tuple(response.result.evidence.sources)
        observed_trace = ObservedTrace(
            selected_scope=case.scope,
            retrieval_called=retrieval_called,
            clarification_emitted=response.status == "needs_clarification",
            error_path=response.status == "error",
            retrieved_sources=() if retrieved_evidence is None else tuple(retrieved_evidence.sources),
            supporting_sources=supporting_sources,
        )
        return ExecutionResult(response=response, observed_trace=observed_trace)

    return _execute


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Run or repair student_handbook formal benchmark against the live chain.")
    subparsers = parser.add_subparsers(dest="command", required=True)

    run_parser = subparsers.add_parser("run", help="Run a fresh handbook formal benchmark.")
    run_parser.add_argument("--reruns", type=int, default=3, help="Number of reruns for the formal benchmark.")
    run_parser.add_argument("--output-dir", help="Optional output directory. Defaults to timestamped .tmp/evals path.")

    repair_parser = subparsers.add_parser("repair", help="Repair transient infra failures from an existing benchmark dir.")
    repair_parser.add_argument("--benchmark-dir", required=True, help="Path to an existing benchmark artifact directory.")
    repair_parser.add_argument("--output-dir", help="Optional output directory. Defaults to timestamped .tmp/evals path.")

    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    cases = handbook_release_gate_cases()
    supplemental_adapters = build_default_handbook_supplemental_adapters_from_env()
    executor = build_handbook_live_executor()

    if args.command == "run":
        output_dir = Path(args.output_dir) if args.output_dir else build_default_output_dir(prefix=RUN_PREFIX)
        run_handbook_formal_benchmark(
            cases=cases,
            executor=executor,
            supplemental_adapters=supplemental_adapters,
            output_dir=output_dir,
            reruns=args.reruns,
        )
        print(output_dir)
        return 0

    output_dir = Path(args.output_dir) if args.output_dir else build_default_output_dir(prefix=REPAIR_PREFIX)
    repair_handbook_formal_benchmark(
        cases=cases,
        executor=executor,
        supplemental_adapters=supplemental_adapters,
        benchmark_dir=Path(args.benchmark_dir),
        output_dir=output_dir,
    )
    print(output_dir)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
