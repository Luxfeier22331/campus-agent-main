from __future__ import annotations

import argparse
import json
import math
import subprocess
import time
from collections.abc import Callable, Sequence
from dataclasses import asdict, dataclass
from datetime import UTC, datetime
from pathlib import Path

import httpx

from campus_evals.agentic_retrieval_plan_eval import (
    AgenticRetrievalPlanObservation,
    evaluate_agentic_retrieval_plan_cases,
    load_agentic_retrieval_plan_cases,
)
from campus_evals.app_api_chat_runtime_client import AppApiEvalClientSettings
from campus_evals.app_api_chat_runtime_client import AppApiEvalClient
from campus_evals.authz_privacy_eval import (
    AuthzPrivacyObservation,
    evaluate_authz_privacy_cases,
    load_authz_privacy_cases,
)
from campus_evals.document_quality_eval import (
    DocumentQualityObservation,
    evaluate_document_quality_cases,
    load_document_quality_cases,
)
from campus_evals.eval_operations_governance import (
    EvalOperationsObservation,
    evaluate_eval_operations_governance,
    load_eval_operations_profile_policy,
)
from campus_evals.models import reject_forbidden_workflow_trace_keys
from campus_evals.public_chat_product_path_eval import (
    PublicChatProductPathCaseSet,
    PublicChatProductPathObservation,
    build_public_chat_product_path_report,
    load_public_chat_product_path_cases,
)
from campus_evals.tool_family_denominator import (
    ToolObservation,
    evaluate_tool_family_denominator,
    load_tool_family_denominator,
)

DEFAULT_SCHEMA_VERSION = "eval_profile_gate.v1"
DEFAULT_REPORT_NAME = "profile-report.json"
DEFAULT_POLICY_ARTIFACT = "eval_operations_profile_policy.v1"


@dataclass(frozen=True, slots=True)
class EvalProfileGateReport:
    profile_id: str
    output_path: Path
    passed: bool


@dataclass(frozen=True, slots=True)
class EvalRuntimeMetrics:
    started_at: str
    finished_at: str
    runtime_seconds: int
    retry_count: int
    provider_calls: int
    collector_version: str
    runtime_profile: str
    metrics_missing: bool = False


def run_public_chat_product_path_profile_gate(
    *,
    output_dir: Path,
    cases_path: Path | None = None,
    observations_path: Path | None = None,
    collect_runtime: bool = False,
    git_head_resolver: Callable[[], str | None] | None = None,
) -> EvalProfileGateReport:
    case_set = load_public_chat_product_path_cases(cases_path)
    runtime_metrics = None
    if collect_runtime:
        observations, runtime_metrics = _collect_with_runtime_metrics(
            profile_id="public_chat_product_path",
            case_count=len(case_set.cases),
            collector=lambda: collect_public_chat_product_path_runtime_observations(case_set),
        )
    else:
        observations = _load_public_chat_observations(observations_path)
    report = build_public_chat_product_path_report(case_set.cases, observations)
    return _write_profile_report(
        output_dir=output_dir,
        profile_id="public_chat_product_path",
        case_family=case_set.case_family,
        report_passed=report.passed,
        total=report.total,
        passed_count=report.passed_count,
        failed_count=report.failed_count,
        results=_attach_public_chat_request_correlations(report.results, observations),
        version_summary=_version_summary(
            case_set_version=case_set.case_family,
            git_head_resolver=git_head_resolver,
        ),
        runtime_metrics=runtime_metrics,
    )


def run_tool_family_denominator_profile_gate(
    *,
    output_dir: Path,
    cases_path: Path | None = None,
    observations_path: Path | None = None,
    collect_runtime: bool = False,
    git_head_resolver: Callable[[], str | None] | None = None,
) -> EvalProfileGateReport:
    fixture = load_tool_family_denominator(cases_path)
    runtime_metrics = None
    if collect_runtime:
        observations, runtime_metrics = _collect_with_runtime_metrics(
            profile_id="tool_family_denominator",
            case_count=len(fixture.cases),
            collector=lambda: collect_tool_family_denominator_runtime_observations(fixture),
        )
    else:
        observations = _load_tool_observations(observations_path)
    report = evaluate_tool_family_denominator(
        fixture,
        observations,
    )
    return _write_profile_report(
        output_dir=output_dir,
        profile_id="tool_family_denominator",
        case_family="tool_family_denominators.v1",
        report_passed=report.passed,
        total=report.total,
        passed_count=report.passed_count,
        failed_count=report.failed_count,
        results=tuple(asdict(result) for result in report.results),
        version_summary=_version_summary(
            case_set_version="tool_family_denominators.v1",
            git_head_resolver=git_head_resolver,
        ),
        runtime_metrics=runtime_metrics,
    )


def run_document_quality_profile_gate(
    *,
    output_dir: Path,
    cases_path: Path | None = None,
    observations_path: Path | None = None,
    collect_runtime: bool = False,
    manifest_path: Path | None = None,
    git_head_resolver: Callable[[], str | None] | None = None,
) -> EvalProfileGateReport:
    case_set = load_document_quality_cases(cases_path)
    runtime_metrics = None
    if collect_runtime:
        if manifest_path is None:
            raise ValueError("document_quality --collect-runtime requires a normalized manifest path")
        observations, runtime_metrics = _collect_with_runtime_metrics(
            profile_id="document_quality",
            case_count=len(case_set.cases),
            collector=lambda: collect_document_quality_runtime_observations(
                manifest_path=manifest_path
            ),
        )
    else:
        observations = _load_document_quality_observations(observations_path)
    report = evaluate_document_quality_cases(
        case_set.cases,
        observations,
    )
    return _write_profile_report(
        output_dir=output_dir,
        profile_id="document_quality",
        case_family="document_quality.v1",
        report_passed=report.passed,
        total=report.total,
        passed_count=report.passed_count,
        failed_count=report.failed_count,
        results=tuple(asdict(result) for result in report.results),
        version_summary=_version_summary(
            case_set_version="document_quality.v1",
            git_head_resolver=git_head_resolver,
        ),
        runtime_metrics=runtime_metrics,
    )


def run_authz_privacy_profile_gate(
    *,
    output_dir: Path,
    cases_path: Path | None = None,
    observations_path: Path | None = None,
    collect_runtime: bool = False,
    git_head_resolver: Callable[[], str | None] | None = None,
) -> EvalProfileGateReport:
    case_set = load_authz_privacy_cases(cases_path)
    runtime_metrics = None
    if collect_runtime:
        observations, runtime_metrics = _collect_with_runtime_metrics(
            profile_id="authz_privacy",
            case_count=len(case_set.cases),
            collector=lambda: collect_authz_privacy_runtime_observations(case_set),
        )
    else:
        observations = _load_authz_privacy_observations(observations_path)
    report = evaluate_authz_privacy_cases(
        case_set.cases,
        observations,
    )
    return _write_profile_report(
        output_dir=output_dir,
        profile_id="authz_privacy",
        case_family="authz_privacy.v1",
        report_passed=report.passed,
        total=report.total,
        passed_count=report.passed_count,
        failed_count=report.failed_count,
        results=tuple(asdict(result) for result in report.results),
        version_summary=_version_summary(
            case_set_version="authz_privacy.v1",
            git_head_resolver=git_head_resolver,
        ),
        runtime_metrics=runtime_metrics,
    )


def run_agentic_retrieval_plan_profile_gate(
    *,
    output_dir: Path,
    cases_path: Path | None = None,
    observations_path: Path | None = None,
    collect_runtime: bool = False,
    git_head_resolver: Callable[[], str | None] | None = None,
) -> EvalProfileGateReport:
    case_set = load_agentic_retrieval_plan_cases(cases_path)
    runtime_metrics = None
    if collect_runtime:
        observations, runtime_metrics = _collect_with_runtime_metrics(
            profile_id="agentic_retrieval_plan",
            case_count=len(case_set.cases),
            collector=lambda: collect_agentic_retrieval_plan_runtime_observations(case_set),
        )
    else:
        observations = _load_agentic_retrieval_plan_observations(observations_path)
    report = evaluate_agentic_retrieval_plan_cases(
        case_set.cases,
        observations,
    )
    return _write_profile_report(
        output_dir=output_dir,
        profile_id="agentic_retrieval_plan",
        case_family=case_set.case_family,
        report_passed=report.passed,
        total=report.total,
        passed_count=report.passed_count,
        failed_count=report.failed_count,
        results=tuple(asdict(result) for result in report.results),
        version_summary=_version_summary(
            case_set_version=case_set.case_family,
            git_head_resolver=git_head_resolver,
        ),
        runtime_metrics=runtime_metrics,
    )


def run_eval_operations_governance_profile_gate(
    *,
    output_dir: Path,
    observations_path: Path | None = None,
    artifact_paths: tuple[Path, ...] = (),
    git_head_resolver: Callable[[], str | None] | None = None,
) -> EvalProfileGateReport:
    policy = load_eval_operations_profile_policy()
    observations = (
        derive_eval_operations_observations_from_artifacts(
            artifact_paths,
            gate_mode="release_gate",
        )
        if artifact_paths
        else _load_eval_operations_observations(observations_path)
    )
    report = evaluate_eval_operations_governance(policy, observations)
    return _write_profile_report(
        output_dir=output_dir,
        profile_id="eval_operations_governance",
        case_family=policy.policy_id,
        report_passed=report.passed,
        total=report.total,
        passed_count=report.passed_count,
        failed_count=report.failed_count,
        results=tuple(asdict(result) for result in report.results),
        version_summary=_version_summary(
            case_set_version=policy.policy_id,
            git_head_resolver=git_head_resolver,
        ),
    )


def collect_public_chat_product_path_runtime_observations(
    case_set: PublicChatProductPathCaseSet,
    *,
    settings: AppApiEvalClientSettings | None = None,
    client: httpx.Client | None = None,
) -> dict[str, PublicChatProductPathObservation]:
    resolved_settings = settings or AppApiEvalClientSettings.from_env()
    api_client = AppApiEvalClient(settings=resolved_settings, client=client)
    try:
        observations: dict[str, PublicChatProductPathObservation] = {}
        for case in case_set.cases:
            execution = api_client.execute_chat_request(
                case_id=case.case_id,
                prompt=case.user_goal,
            )
            observations[case.case_id] = _public_chat_observation_from_execution(
                case_id=case.case_id,
                execution=execution,
            )
        return observations
    finally:
        if client is None:
            pass


def collect_tool_family_denominator_runtime_observations(
    fixture,
    *,
    settings: AppApiEvalClientSettings | None = None,
    client: httpx.Client | None = None,
) -> dict[str, ToolObservation]:
    api_client = AppApiEvalClient(settings=settings or AppApiEvalClientSettings.from_env(), client=client)
    observations: dict[str, ToolObservation] = {}
    for case in fixture.cases:
        execution = api_client.execute_chat_request(
            case_id=case.case_id,
            prompt=_tool_case_prompt(case),
            requested_capability=_requested_capability_for_tool(case.tool_name),
        )
        response = execution.response
        observability = response.observability
        selected_tool = (
            (observability.selected_tool if observability is not None else "")
            or _first_workflow_tool(response.workflow_trace_summary)
            or case.tool_name
        )
        result_status = (
            (observability.tool_business_outcome if observability is not None else "")
            or response.status
        )
        observations[case.case_id] = ToolObservation(
            case_id=case.case_id,
            selected_tool=selected_tool,
            result_status=result_status,
            argument_summary=_tool_argument_summary(response.workflow_trace_summary),
        )
    return observations


def collect_authz_privacy_runtime_observations(
    case_set,
    *,
    settings: AppApiEvalClientSettings | None = None,
    client: httpx.Client | None = None,
) -> dict[str, AuthzPrivacyObservation]:
    api_client = AppApiEvalClient(settings=settings or AppApiEvalClientSettings.from_env(), client=client)
    observations: dict[str, AuthzPrivacyObservation] = {}
    for case in case_set.cases:
        execution = api_client.execute_chat_request(
            case_id=case.case_id,
            prompt=_authz_case_prompt(case),
            requested_capability="notice",
        )
        response = execution.response
        observability = response.observability
        authorization_summary = dict(response.workflow_trace_summary.guardrail_outcomes) if response.workflow_trace_summary else {}
        if observability is not None:
            if observability.acl_decision:
                authorization_summary["acl_decision"] = observability.acl_decision
            if observability.acl_anomaly_code:
                authorization_summary["acl_anomaly_code"] = observability.acl_anomaly_code
        observations[case.case_id] = AuthzPrivacyObservation(
            case_id=case.case_id,
            terminal_outcome=response.status,
            fail_close_reason=(
                response.workflow_trace_summary.fail_close_reason
                if response.workflow_trace_summary is not None
                else ""
            )
            or (observability.tool_fail_close_reason if observability is not None else ""),
            authorization_summary=authorization_summary,
            artifact_payload={"request_correlation": asdict(execution.request_correlation)},
        )
    return observations


def collect_agentic_retrieval_plan_runtime_observations(
    case_set,
    *,
    settings: AppApiEvalClientSettings | None = None,
    client: httpx.Client | None = None,
) -> dict[str, AgenticRetrievalPlanObservation]:
    api_client = AppApiEvalClient(settings=settings or AppApiEvalClientSettings.from_env(), client=client)
    observations: dict[str, AgenticRetrievalPlanObservation] = {}
    for case in case_set.cases:
        execution = api_client.execute_chat_request(
            case_id=case.case_id,
            prompt=case.user_goal,
            requested_capability="knowledge",
        )
        summary = execution.response.workflow_trace_summary
        routing_frame = summary.routing_frame if summary is not None else {}
        planning = summary.context_resolution if summary is not None else {}
        observations[case.case_id] = AgenticRetrievalPlanObservation(
            case_id=case.case_id,
            decomposition=_string_tuple_or_empty(routing_frame.get("decomposition")),
            step_plan=_step_plan_from_trace(summary),
            freshness_branch=str(routing_frame.get("freshness_branch") or ""),
            live_branch_outcome=str(routing_frame.get("live_branch_outcome") or "not_required"),
            fail_close_reason=(summary.fail_close_reason if summary is not None else ""),
            supporting_evidence_ids=_string_tuple_or_empty(
                planning.get("supporting_evidence_ids")
            )
            or tuple(sorted(_workflow_source_ids(summary))),
            final_answer_status=execution.response.status,
        )
    return observations


def collect_document_quality_runtime_observations(
    *,
    manifest_path: Path,
) -> dict[str, DocumentQualityObservation]:
    payload = _load_json(manifest_path)
    raw_documents = payload.get("documents")
    if not isinstance(raw_documents, list):
        raise ValueError("normalized document manifest documents must be a list")
    observations: dict[str, DocumentQualityObservation] = {}
    for raw_item in raw_documents:
        item = _mapping(raw_item, "document")
        case_id = _required_string(item.get("case_id"), "document.case_id")
        observations[case_id] = DocumentQualityObservation(
            case_id=case_id,
            extracted_text=_required_string(
                item.get("normalized_text")
                or item.get("text")
                or item.get("extracted_text"),
                "document.normalized_text",
            ),
            table_headers=_string_tuple(item.get("table_headers") or []),
            confidence=float(item.get("confidence") or 0.0),
            projection_target=str(item.get("projection_target") or ""),
            claims=_string_tuple(item.get("claims") or []),
        )
    return observations


def derive_eval_operations_observations_from_artifacts(
    artifact_paths: Sequence[Path],
    *,
    gate_mode: str,
) -> dict[str, EvalOperationsObservation]:
    observations: dict[str, EvalOperationsObservation] = {}
    for path in artifact_paths:
        payload = _load_json(path)
        profile_id = _required_string(payload.get("profile_id"), "profile_id")
        summary = _mapping(payload.get("summary") or {}, "summary")
        results = _list_of_mappings(payload.get("sanitized_results") or [], "sanitized_results")
        failed_cases = tuple(
            _required_string(result.get("case_id"), "result.case_id")
            for result in results
            if result.get("passed") is False
        )
        case_dispositions = {
            case_id: _result_disposition(result)
            for case_id, result in (
                (_required_string(item.get("case_id"), "result.case_id"), item)
                for item in results
                if item.get("passed") is False
            )
        }
        observations[profile_id] = EvalOperationsObservation(
            profile_id=profile_id,
            gate_mode=gate_mode,
            cases_run=_non_negative_int(summary.get("total"), "summary.total"),
            runtime_seconds=_non_negative_int(
                summary.get("runtime_seconds") or 0,
                "summary.runtime_seconds",
            ),
            retry_count=_non_negative_int(summary.get("retry_count") or 0, "summary.retry_count"),
            artifact_age_days=_non_negative_int(
                summary.get("artifact_age_days") or 0,
                "summary.artifact_age_days",
            ),
            provider_calls=_non_negative_int(
                summary.get("provider_calls") or 0,
                "summary.provider_calls",
            ),
            metrics_missing=_runtime_metrics_missing(summary),
            failed_cases=failed_cases,
            case_dispositions=case_dispositions,
            version_summary=_mapping(payload.get("version_summary") or {}, "version_summary"),
        )
    return observations


def public_chat_product_path_main(argv: Sequence[str] | None = None) -> int:
    return _profile_main("public_chat_product_path", argv)


def tool_family_denominator_main(argv: Sequence[str] | None = None) -> int:
    return _profile_main("tool_family_denominator", argv)


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


def _run_profile_from_args(profile_id: str, args: argparse.Namespace) -> EvalProfileGateReport:
    output_dir = Path(args.output_dir)
    cases_path = Path(args.cases_path) if args.cases_path else None
    observations_path = Path(args.observations_path) if args.observations_path else None
    artifact_paths = tuple(Path(item) for item in args.artifact_path)
    if profile_id == "public_chat_product_path":
        return run_public_chat_product_path_profile_gate(
            output_dir=output_dir,
            cases_path=cases_path,
            observations_path=observations_path,
            collect_runtime=bool(args.collect_runtime),
        )
    if args.collect_runtime:
        raise ValueError(f"{profile_id} does not support --collect-runtime")
    if profile_id == "tool_family_denominator":
        return run_tool_family_denominator_profile_gate(
            output_dir=output_dir,
            cases_path=cases_path,
            observations_path=observations_path,
        )
    if profile_id == "document_quality":
        return run_document_quality_profile_gate(
            output_dir=output_dir,
            cases_path=cases_path,
            observations_path=observations_path,
        )
    if profile_id == "authz_privacy":
        return run_authz_privacy_profile_gate(
            output_dir=output_dir,
            cases_path=cases_path,
            observations_path=observations_path,
        )
    if profile_id == "agentic_retrieval_plan":
        return run_agentic_retrieval_plan_profile_gate(
            output_dir=output_dir,
            cases_path=cases_path,
            observations_path=observations_path,
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


def _write_profile_report(
    *,
    output_dir: Path,
    profile_id: str,
    case_family: str,
    report_passed: bool,
    total: int,
    passed_count: int,
    failed_count: int,
    results: tuple[dict[str, object], ...],
    version_summary: dict[str, object],
) -> EvalProfileGateReport:
    output_dir.mkdir(parents=True, exist_ok=True)
    output_path = output_dir / DEFAULT_REPORT_NAME
    payload: dict[str, object] = {
        "schema_version": DEFAULT_SCHEMA_VERSION,
        "profile_id": profile_id,
        "case_family": case_family,
        "passed": report_passed,
        "summary": {
            "total": total,
            "passed": passed_count,
            "failed": failed_count,
            "overall_passed": report_passed,
            "runtime_seconds": 0,
            "retry_count": 0,
            "provider_calls": 0,
        },
        "version_summary": version_summary,
        "sanitized_results": list(results),
    }
    reject_forbidden_workflow_trace_keys(payload, "eval_profile_gate_artifact")
    output_path.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    return EvalProfileGateReport(
        profile_id=profile_id,
        output_path=output_path,
        passed=report_passed,
    )


def _version_summary(
    *,
    case_set_version: str,
    git_head_resolver: Callable[[], str | None] | None,
) -> dict[str, object]:
    resolve_git_head = git_head_resolver or _resolve_git_head
    return {
        "case_set_version": case_set_version,
        "policy_artifact": DEFAULT_POLICY_ARTIFACT,
        "runtime_version": DEFAULT_SCHEMA_VERSION,
        "generated_at": datetime.now(UTC).isoformat(),
        "git_head": resolve_git_head(),
    }


def _load_public_chat_observations(
    path: Path | None,
) -> dict[str, PublicChatProductPathObservation]:
    return {
        item["case_id"]: PublicChatProductPathObservation(
            case_id=_required_string(item.get("case_id"), "case_id"),
            request_id=_required_string(item.get("request_id"), "request_id"),
            trace_id=_required_string(item.get("trace_id"), "trace_id"),
            selected_target=_required_string(item.get("selected_target"), "selected_target"),
            terminal_outcome=_required_string(item.get("terminal_outcome"), "terminal_outcome"),
            fail_close_reason=str(item.get("fail_close_reason") or ""),
            response_contract=_mapping(item.get("response_contract") or {}, "response_contract"),
            operator_backflow=_mapping(item.get("operator_backflow") or {}, "operator_backflow"),
            request_correlation=_request_correlation_mapping(item.get("request_correlation")),
        )
        for item in _load_observation_items(path)
    }


def _load_tool_observations(path: Path | None) -> dict[str, ToolObservation]:
    return {
        item["case_id"]: ToolObservation(
            case_id=_required_string(item.get("case_id"), "case_id"),
            selected_tool=_required_string(item.get("selected_tool"), "selected_tool"),
            result_status=_required_string(item.get("result_status"), "result_status"),
            argument_summary=_mapping(item.get("argument_summary") or {}, "argument_summary"),
        )
        for item in _load_observation_items(path)
    }


def _load_document_quality_observations(path: Path | None) -> dict[str, DocumentQualityObservation]:
    return {
        item["case_id"]: DocumentQualityObservation(
            case_id=_required_string(item.get("case_id"), "case_id"),
            extracted_text=str(item.get("extracted_text") or ""),
            table_headers=_string_tuple(item.get("table_headers") or []),
            confidence=float(item.get("confidence") or 0.0),
            projection_target=str(item.get("projection_target") or ""),
            claims=_string_tuple(item.get("claims") or []),
        )
        for item in _load_observation_items(path)
    }


def _load_authz_privacy_observations(path: Path | None) -> dict[str, AuthzPrivacyObservation]:
    return {
        item["case_id"]: AuthzPrivacyObservation(
            case_id=_required_string(item.get("case_id"), "case_id"),
            terminal_outcome=_required_string(item.get("terminal_outcome"), "terminal_outcome"),
            fail_close_reason=str(item.get("fail_close_reason") or ""),
            authorization_summary=_mapping(
                item.get("authorization_summary") or {},
                "authorization_summary",
            ),
            artifact_payload=_mapping(item.get("artifact_payload") or {}, "artifact_payload"),
        )
        for item in _load_observation_items(path)
    }


def _load_agentic_retrieval_plan_observations(
    path: Path | None,
) -> dict[str, AgenticRetrievalPlanObservation]:
    return {
        item["case_id"]: AgenticRetrievalPlanObservation(
            case_id=_required_string(item.get("case_id"), "case_id"),
            decomposition=_string_tuple(item.get("decomposition") or []),
            step_plan=_string_tuple(item.get("step_plan") or []),
            freshness_branch=_required_string(item.get("freshness_branch"), "freshness_branch"),
            live_branch_outcome=_required_string(
                item.get("live_branch_outcome"),
                "live_branch_outcome",
            ),
            fail_close_reason=str(item.get("fail_close_reason") or ""),
            supporting_evidence_ids=_string_tuple(item.get("supporting_evidence_ids") or []),
            final_answer_status=_required_string(
                item.get("final_answer_status"),
                "final_answer_status",
            ),
        )
        for item in _load_observation_items(path)
    }


def _load_eval_operations_observations(path: Path | None) -> dict[str, EvalOperationsObservation]:
    return {
        item["profile_id"]: EvalOperationsObservation(
            profile_id=_required_string(item.get("profile_id"), "profile_id"),
            gate_mode=_required_string(item.get("gate_mode"), "gate_mode"),
            cases_run=_non_negative_int(item.get("cases_run"), "cases_run"),
            runtime_seconds=_non_negative_int(item.get("runtime_seconds"), "runtime_seconds"),
            retry_count=_non_negative_int(item.get("retry_count"), "retry_count"),
            artifact_age_days=_non_negative_int(item.get("artifact_age_days"), "artifact_age_days"),
            provider_calls=_non_negative_int(item.get("provider_calls") or 0, "provider_calls"),
            failed_cases=_string_tuple(item.get("failed_cases") or []),
            skipped_cases=_string_tuple(item.get("skipped_cases") or []),
            quarantined_cases=_string_tuple(item.get("quarantined_cases") or []),
            repaired_cases=_string_tuple(item.get("repaired_cases") or []),
            case_dispositions={
                str(key): str(value)
                for key, value in _mapping(
                    item.get("case_dispositions") or {},
                    "case_dispositions",
                ).items()
            },
            quarantine_readmission_cases=_string_tuple(
                item.get("quarantine_readmission_cases") or []
            ),
            version_summary=_mapping(item.get("version_summary") or {}, "version_summary"),
        )
        for item in _load_observation_items(path)
    }


def _load_observation_items(path: Path | None) -> tuple[dict[str, object], ...]:
    if path is None:
        return ()
    payload = _load_json(path)
    if isinstance(payload.get("observations"), list):
        return _list_of_mappings(payload["observations"], "observations")
    return tuple(
        _mapping(dict(item, case_id=case_id), "observation")
        for case_id, item in payload.items()
        if isinstance(item, dict)
    )


def _public_chat_observation_from_response(
    *,
    case_id: str,
    response: httpx.Response,
) -> PublicChatProductPathObservation:
    payload = response.json()
    answer = _mapping(payload.get("answer") or {}, "answer")
    result = _mapping(answer.get("result") or {}, "answer.result")
    supervisor = payload.get("supervisor") if isinstance(payload.get("supervisor"), dict) else {}
    request_id = str(result.get("requestId") or response.headers.get("x-request-id") or "")
    trace_id = str(result.get("traceId") or response.headers.get("x-trace-id") or "")
    selected_target = str(
        supervisor.get("selectedTarget")
        or supervisor.get("selected_target")
        or result.get("selectedTarget")
        or result.get("selected_target")
        or "none"
    )
    terminal_outcome = str(supervisor.get("status") or result.get("status") or "")
    fail_close_reason = str(
        supervisor.get("failCloseReason")
        or supervisor.get("fail_close_reason")
        or result.get("failCloseReason")
        or result.get("fail_close_reason")
        or ""
    )
    return PublicChatProductPathObservation(
        case_id=case_id,
        request_id=request_id,
        trace_id=trace_id,
        selected_target=selected_target,
        terminal_outcome=terminal_outcome,
        fail_close_reason=fail_close_reason,
        response_contract={
            "answer_text_present": _has_answer_text(result),
            "citations_present": bool(result.get("citations") or result.get("evidence")),
            "cards_present": bool(result.get("cards")),
            "source_url_present": _has_source_url(result),
        },
        operator_backflow={
            "quality_candidate_supported": bool(request_id and trace_id),
            "trace_backlink_present": bool(trace_id),
        },
    )


def _has_answer_text(result: dict[str, object]) -> bool:
    return bool(
        str(
            result.get("answerText")
            or result.get("answer_text")
            or result.get("text")
            or result.get("content")
            or ""
        ).strip()
    )


def _has_source_url(value: object) -> bool:
    if isinstance(value, dict):
        for key, item in value.items():
            if str(key).lower() in {"sourceurl", "source_url", "url", "href"} and str(
                item or ""
            ).startswith(("http://", "https://")):
                return True
            if _has_source_url(item):
                return True
    if isinstance(value, list | tuple):
        return any(_has_source_url(item) for item in value)
    return False


def _result_disposition(result: dict[str, object]) -> str:
    raw_failure_classes = result.get("failure_classes")
    if isinstance(raw_failure_classes, list) and raw_failure_classes:
        return str(raw_failure_classes[0])
    if str(result.get("failure_class") or "").strip():
        return str(result["failure_class"])
    return str(result.get("reason") or "failed")


def _load_json(path: Path) -> dict[str, object]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        raise ValueError(f"{path} must contain a JSON object")
    return payload


def _mapping(value: object, field_name: str) -> dict[str, object]:
    if not isinstance(value, dict):
        raise ValueError(f"{field_name} must be an object")
    return dict(value)


def _list_of_mappings(value: object, field_name: str) -> tuple[dict[str, object], ...]:
    if not isinstance(value, list):
        raise ValueError(f"{field_name} must be a list")
    return tuple(_mapping(item, field_name) for item in value)


def _required_string(value: object, field_name: str) -> str:
    normalized = "" if value is None else str(value).strip()
    if not normalized:
        raise ValueError(f"{field_name} is required")
    return normalized


def _string_tuple(value: object) -> tuple[str, ...]:
    if not isinstance(value, list | tuple):
        raise ValueError("value must be a list")
    return tuple(str(item) for item in value)


def _non_negative_int(value: object, field_name: str) -> int:
    parsed = int(value or 0)
    if parsed < 0:
        raise ValueError(f"{field_name} must be non-negative")
    return parsed


def _resolve_git_head() -> str | None:
    completed = subprocess.run(
        ("git", "rev-parse", "HEAD"),
        cwd=Path(__file__).resolve().parents[4],
        text=True,
        capture_output=True,
        check=False,
    )
    if completed.returncode != 0:
        return None
    return completed.stdout.strip() or None


__all__ = [
    "DEFAULT_REPORT_NAME",
    "DEFAULT_SCHEMA_VERSION",
    "EvalProfileGateReport",
    "agentic_retrieval_plan_main",
    "authz_privacy_main",
    "collect_public_chat_product_path_runtime_observations",
    "derive_eval_operations_observations_from_artifacts",
    "document_quality_main",
    "eval_operations_governance_main",
    "public_chat_product_path_main",
    "run_agentic_retrieval_plan_profile_gate",
    "run_authz_privacy_profile_gate",
    "run_document_quality_profile_gate",
    "run_eval_operations_governance_profile_gate",
    "run_public_chat_product_path_profile_gate",
    "run_tool_family_denominator_profile_gate",
    "tool_family_denominator_main",
]
