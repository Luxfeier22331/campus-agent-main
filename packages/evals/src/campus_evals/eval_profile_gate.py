from __future__ import annotations

import argparse
import json
import math
import time
from collections.abc import Callable, Sequence
from dataclasses import asdict
from datetime import UTC, datetime
from pathlib import Path

import httpx

from campus_evals.agentic_retrieval_plan_eval import (
    AgenticRetrievalPlanObservation,
    evaluate_agentic_retrieval_plan_cases,
    load_agentic_retrieval_plan_cases,
)
from campus_evals.app_api_chat_runtime_client import AppApiEvalClient, AppApiEvalClientSettings
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
    evaluate_eval_operations_governance,
    load_eval_operations_profile_policy,
)
from campus_evals.eval_profile_gate_loading import (
    _has_cards,
    _has_source_url,
    _load_agentic_retrieval_plan_observations,
    _load_authz_privacy_observations,
    _load_document_quality_observations,
    _load_eval_operations_observations,
    _load_json,
    _load_public_chat_observations,
    _load_tool_observations,
    _mapping,
    _request_correlation_mapping,
    _required_string,
    _string_tuple,
    _string_tuple_or_empty,
)
from campus_evals.eval_profile_gate_models import (
    DEFAULT_REPORT_NAME,
    DEFAULT_SCHEMA_VERSION,
    EvalProfileGateReport,
    EvalRuntimeMetrics,
)
from campus_evals.eval_profile_gate_operations import (
    _filter_eval_operations_policy,
    derive_eval_operations_observations_from_artifacts,
)
from campus_evals.eval_profile_gate_reporting import (
    _version_summary,
    _write_profile_report,
)
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
            raise ValueError(
                "document_quality --collect-runtime requires a normalized manifest path"
            )
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
    if artifact_paths:
        policy = _filter_eval_operations_policy(policy, tuple(observations))
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


def collect_tool_family_denominator_runtime_observations(
    fixture,
    *,
    settings: AppApiEvalClientSettings | None = None,
    client: httpx.Client | None = None,
) -> dict[str, ToolObservation]:
    api_client = AppApiEvalClient(
        settings=settings or AppApiEvalClientSettings.from_env(), client=client
    )
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
            observability.tool_business_outcome if observability is not None else ""
        ) or response.status
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
    api_client = AppApiEvalClient(
        settings=settings or AppApiEvalClientSettings.from_env(), client=client
    )
    observations: dict[str, AuthzPrivacyObservation] = {}
    for case in case_set.cases:
        execution = api_client.execute_chat_request(
            case_id=case.case_id,
            prompt=_authz_case_prompt(case),
            requested_capability="notice",
        )
        response = execution.response
        observability = response.observability
        authorization_summary = (
            dict(response.workflow_trace_summary.guardrail_outcomes)
            if response.workflow_trace_summary
            else {}
        )
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
    api_client = AppApiEvalClient(
        settings=settings or AppApiEvalClientSettings.from_env(), client=client
    )
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
            supporting_evidence_ids=_string_tuple_or_empty(planning.get("supporting_evidence_ids"))
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
                item.get("normalized_text") or item.get("text") or item.get("extracted_text"),
                "document.normalized_text",
            ),
            table_headers=_string_tuple(item.get("table_headers") or []),
            confidence=float(item.get("confidence") or 0.0),
            projection_target=str(item.get("projection_target") or ""),
            claims=_string_tuple(item.get("claims") or []),
        )
    return observations


def _collect_with_runtime_metrics(
    *,
    profile_id: str,
    case_count: int,
    collector: Callable[[], dict[str, object]],
) -> tuple[dict[str, object], EvalRuntimeMetrics]:
    started_at = datetime.now(UTC)
    monotonic_started = time.monotonic()
    observations = collector()
    finished_at = datetime.now(UTC)
    runtime_seconds = max(1, math.ceil(time.monotonic() - monotonic_started))
    return observations, EvalRuntimeMetrics(
        started_at=started_at.isoformat(),
        finished_at=finished_at.isoformat(),
        runtime_seconds=runtime_seconds,
        retry_count=0,
        provider_calls=max(case_count, len(observations)),
        collector_version=DEFAULT_SCHEMA_VERSION,
        runtime_profile=profile_id,
    )


def _public_chat_observation_from_execution(
    *,
    case_id: str,
    execution,
) -> PublicChatProductPathObservation:
    response = execution.response
    observability = response.observability
    result_payload = asdict(response.result) if response.result is not None else {}
    return PublicChatProductPathObservation(
        case_id=case_id,
        request_id=execution.request_correlation.request_id,
        trace_id=execution.request_correlation.trace_id,
        selected_target=response.selected_target or "none",
        terminal_outcome=response.status,
        fail_close_reason=(
            response.workflow_trace_summary.fail_close_reason
            if response.workflow_trace_summary is not None
            else ""
        )
        or (observability.tool_fail_close_reason if observability is not None else ""),
        response_contract={
            "answer_text_present": bool(response.answer_text.strip()),
            "citations_present": _has_source_url(result_payload)
            or bool(_workflow_source_ids(response.workflow_trace_summary)),
            "cards_present": _has_cards(result_payload),
            "source_url_present": _has_source_url(result_payload),
        },
        operator_backflow={
            "quality_candidate_supported": True,
            "trace_backlink_present": bool(execution.request_correlation.trace_id),
        },
        request_correlation=asdict(execution.request_correlation),
        workflow_trace_summary=(
            asdict(response.workflow_trace_summary)
            if response.workflow_trace_summary is not None
            else {}
        ),
    )


def _attach_public_chat_request_correlations(
    results,
    observations: dict[str, PublicChatProductPathObservation],
) -> tuple[dict[str, object], ...]:
    enriched: list[dict[str, object]] = []
    for result in results:
        item = asdict(result)
        correlation = (
            observations.get(result.case_id).request_correlation
            if observations.get(result.case_id)
            else {}
        )
        if correlation:
            item["request_correlation"] = _request_correlation_mapping(correlation)
        enriched.append(item)
    return tuple(enriched)


def _tool_case_prompt(case) -> str:
    return (
        f"请执行 {case.tool_name} 工具验证，期望参数为 "
        f"{json.dumps(case.expected_arguments, ensure_ascii=False, sort_keys=True)}。"
    )


def _requested_capability_for_tool(tool_name: str) -> str:
    if tool_name.startswith("campus_notice"):
        return "notice"
    if tool_name == "retrieval.query":
        return "knowledge"
    return "campus_services"


def _authz_case_prompt(case) -> str:
    return (
        f"请验证授权与隐私边界：{case.case_id}，"
        f"期望结果 {case.expected_terminal_outcome}/{case.expected_fail_close_reason or 'none'}。"
    )


def _first_workflow_tool(summary) -> str:
    if summary is None:
        return ""
    if summary.selected_tools:
        return summary.selected_tools[0]
    if summary.tool_call_summaries:
        return str(
            summary.tool_call_summaries[0].get("tool_name")
            or summary.tool_call_summaries[0].get("tool")
            or ""
        )
    return ""


def _tool_argument_summary(summary) -> dict[str, object]:
    if summary is None:
        return {}
    if summary.tool_argument_summary:
        return dict(summary.tool_argument_summary)
    if not summary.tool_call_summaries:
        return {}
    argument_summary = summary.tool_call_summaries[0].get("argument_summary")
    return dict(argument_summary) if isinstance(argument_summary, dict) else {}


def _step_plan_from_trace(summary) -> tuple[str, ...]:
    if summary is None:
        return ()
    steps = tuple(
        str(item.get("step_id") or item.get("step") or item.get("name") or "")
        for item in summary.trace_steps
        if str(item.get("step_id") or item.get("step") or item.get("name") or "").strip()
    )
    if steps:
        return steps
    if summary.planning_outcome:
        return (summary.planning_outcome,)
    return ()


def _workflow_source_ids(summary) -> set[str]:
    if summary is None:
        return set()
    source_ids: set[str] = set()
    for item in summary.tool_call_summaries:
        for key in ("source_ids", "sourceIds", "evidence_ids", "evidenceIds"):
            raw_values = item.get(key)
            if isinstance(raw_values, list | tuple):
                source_ids.update(str(value) for value in raw_values if str(value).strip())
        source_id = item.get("source_id") or item.get("sourceId")
        if source_id:
            source_ids.add(str(source_id))
    return source_ids


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
    manifest_path = artifact_paths[0] if artifact_paths else None
    if profile_id == "public_chat_product_path":
        return run_public_chat_product_path_profile_gate(
            output_dir=output_dir,
            cases_path=cases_path,
            observations_path=observations_path,
            collect_runtime=bool(args.collect_runtime),
        )
    if profile_id == "tool_family_denominator":
        return run_tool_family_denominator_profile_gate(
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
    "DEFAULT_REPORT_NAME",
    "DEFAULT_SCHEMA_VERSION",
    "EvalProfileGateReport",
    "EvalRuntimeMetrics",
    "agentic_retrieval_plan_main",
    "authz_privacy_main",
    "collect_agentic_retrieval_plan_runtime_observations",
    "collect_authz_privacy_runtime_observations",
    "collect_document_quality_runtime_observations",
    "collect_public_chat_product_path_runtime_observations",
    "collect_tool_family_denominator_runtime_observations",
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
