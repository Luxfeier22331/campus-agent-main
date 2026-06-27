from __future__ import annotations

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
    _load_online_answer_observations,
    _load_tool_observations,
    _mapping,
    _request_correlation_mapping,
    _required_string,
    _semantic_outcome_from_status,
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
from campus_evals.online_answer_path_eval import (
    OnlineAnswerPathCaseSet,
    OnlineAnswerPathObservation,
    build_online_answer_path_report,
    filter_online_answer_path_cases,
    load_online_answer_path_cases,
)
from campus_evals.tool_denominator import (
    ToolObservation,
    evaluate_tool_denominator,
    load_tool_denominator,
)


def run_online_answer_path_profile_gate(
    *,
    output_dir: Path,
    cases_path: Path | None = None,
    observations_path: Path | None = None,
    collect_runtime: bool = False,
    git_head_resolver: Callable[[], str | None] | None = None,
) -> EvalProfileGateReport:
    case_set = load_online_answer_path_cases(cases_path)
    if cases_path is None and case_set.case_family == "online_answer_main_path.v1":
        case_set = filter_online_answer_path_cases(case_set)
        if not case_set.cases:
            raise ValueError("online-answer-path release profile has no executable cases")
    runtime_metrics = None
    if collect_runtime:
        observations, runtime_metrics = _collect_with_runtime_metrics(
            profile_id="online_answer_path",
            case_count=len(case_set.cases),
            collector=lambda: collect_online_answer_path_runtime_observations(case_set),
        )
    else:
        observations = _load_online_answer_observations(observations_path)
    report = build_online_answer_path_report(case_set.cases, observations)
    return _write_profile_report(
        output_dir=output_dir,
        profile_id="online-answer-path",
        case_family=case_set.case_family,
        report_passed=report.passed,
        total=report.total,
        passed_count=report.passed_count,
        failed_count=report.failed_count,
        results=_attach_online_answer_request_correlations(report.results, observations),
        version_summary=_version_summary(
            case_set_version=case_set.case_family,
            git_head_resolver=git_head_resolver,
        ),
        runtime_metrics=runtime_metrics,
    )


def run_tool_denominator_profile_gate(
    *,
    output_dir: Path,
    cases_path: Path | None = None,
    observations_path: Path | None = None,
    collect_runtime: bool = False,
    git_head_resolver: Callable[[], str | None] | None = None,
) -> EvalProfileGateReport:
    fixture = load_tool_denominator(cases_path)
    runtime_metrics = None
    if collect_runtime:
        observations, runtime_metrics = _collect_with_runtime_metrics(
            profile_id="tool_denominator",
            case_count=len(fixture.cases),
            collector=lambda: collect_tool_denominator_runtime_observations(fixture),
        )
    else:
        observations = _load_tool_observations(observations_path)
    report = evaluate_tool_denominator(
        fixture,
        observations,
    )
    return _write_profile_report(
        output_dir=output_dir,
        profile_id="tool_denominator",
        case_family="tool_denominators.v1",
        report_passed=report.passed,
        total=report.total,
        passed_count=report.passed_count,
        failed_count=report.failed_count,
        results=tuple(asdict(result) for result in report.results),
        version_summary=_version_summary(
            case_set_version="tool_denominators.v1",
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


def collect_online_answer_path_runtime_observations(
    case_set: OnlineAnswerPathCaseSet,
    *,
    settings: AppApiEvalClientSettings | None = None,
    client: httpx.Client | None = None,
) -> dict[str, OnlineAnswerPathObservation]:
    resolved_settings = settings or AppApiEvalClientSettings.from_env()
    api_client = AppApiEvalClient(settings=resolved_settings, client=client)
    observations: dict[str, OnlineAnswerPathObservation] = {}
    readiness = api_client.get_runtime_readiness()
    blocked_reason = _online_answer_preflight_blocked_reason(readiness)
    for case in case_set.cases:
        if _online_answer_case_preflight_blocked(case, blocked_reason):
            observations[case.case_id] = _blocked_online_answer_observation(
                case=case,
                readiness=readiness,
                blocked_reason=blocked_reason,
            )
            continue
        execution = api_client.execute_chat_request(
            case_id=case.case_id,
            prompt=case.user_goal,
        )
        observations[case.case_id] = _online_answer_observation_from_execution(
            case_id=case.case_id,
            execution=execution,
        )
    return observations


def collect_tool_denominator_runtime_observations(
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
            requested_tool=_requested_tool_for_tool(case.tool_name),
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
            requested_tool="campus_notice_discover",
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
            requested_tool="knowledge_query",
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


def _online_answer_observation_from_execution(
    *,
    case_id: str,
    execution,
) -> OnlineAnswerPathObservation:
    response = execution.response
    observability = response.observability
    result_payload = asdict(response.result) if response.result is not None else {}
    return OnlineAnswerPathObservation(
        case_id=case_id,
        request_id=execution.request_correlation.request_id,
        trace_id=execution.request_correlation.trace_id,
        selected_tool=response.selected_tool or "none",
        terminal_status=response.status,
        semantic_outcome=_semantic_outcome_from_status(
            terminal_status=response.status,
            fail_close_reason=(
                response.workflow_trace_summary.fail_close_reason
                if response.workflow_trace_summary is not None
                else ""
            )
            or (observability.tool_fail_close_reason if observability is not None else ""),
            tool_business_outcome=(
                observability.tool_business_outcome if observability is not None else ""
            ),
            explicit_semantic_outcome=(
                observability.semantic_outcome if observability is not None else ""
            ),
        ),
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


def _online_answer_preflight_blocked_reason(
    readiness: dict[str, object],
) -> dict[str, object]:
    preflight = _readiness_preflight(readiness)
    execution_runtime = _mapping_or_empty(preflight.get("executionRuntime"))
    campus_services = _mapping_or_empty(preflight.get("campusServicesProductPath"))
    blockers: dict[str, object] = {}
    if str(execution_runtime.get("status") or "") == "blocked":
        blockers["executionRuntime"] = _mapping_or_empty(execution_runtime.get("blockers"))
    if str(campus_services.get("status") or "") == "blocked":
        blockers["campusServicesProductPath"] = _mapping_or_empty(campus_services.get("blockers"))
    return blockers


def _readiness_preflight(readiness: dict[str, object]) -> dict[str, object]:
    preflight = readiness.get("preflight")
    if isinstance(preflight, dict):
        return dict(preflight)
    error = readiness.get("error")
    if not isinstance(error, dict):
        return {}
    details = error.get("details")
    if not isinstance(details, dict):
        return {}
    nested = details.get("preflight")
    return dict(nested) if isinstance(nested, dict) else {}


def _mapping_or_empty(value: object) -> dict[str, object]:
    return dict(value) if isinstance(value, dict) else {}


def _online_answer_case_preflight_blocked(case, blocked_reason: dict[str, object]) -> bool:
    if not blocked_reason:
        return False
    if "executionRuntime" in blocked_reason:
        return True
    return (
        case.expected.selected_tool == "transport_schedule_lookup"
        and "campusServicesProductPath" in blocked_reason
    )


def _blocked_online_answer_observation(
    *,
    case,
    readiness: dict[str, object],
    blocked_reason: dict[str, object],
) -> OnlineAnswerPathObservation:
    return OnlineAnswerPathObservation(
        case_id=case.case_id,
        request_id="blocked:runtime_preflight",
        trace_id="blocked:runtime_preflight",
        selected_tool=case.expected.selected_tool,
        terminal_status="error",
        semantic_outcome="blocked",
        fail_close_reason="runtime_preflight_blocked",
        response_contract={
            "answer_text_present": False,
            "citations_present": False,
            "cards_present": False,
            "source_url_present": False,
        },
        operator_backflow={
            "quality_candidate_supported": False,
            "trace_backlink_present": False,
            **blocked_reason,
        },
        request_correlation={
            "case_id": case.case_id,
            "request_id": "blocked:runtime_preflight",
            "trace_id": "blocked:runtime_preflight",
            "sampled_at": datetime.now(UTC).isoformat(),
            "issue_link": None,
            "issue_fingerprint": None,
            "trace_link": None,
        },
        workflow_trace_summary={
            "direct_vs_delegate_branch": "blocked",
            "fail_close_reason": "runtime_preflight_blocked",
            "preflight": _readiness_preflight(readiness),
            "selected_tool": case.expected.selected_tool,
        },
    )


def _attach_online_answer_request_correlations(
    results,
    observations: dict[str, OnlineAnswerPathObservation],
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


def _requested_tool_for_tool(tool_name: str) -> str:
    if tool_name.startswith("campus_notice"):
        return "notice"
    if tool_name == "knowledge_query":
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


def online_answer_path_main(argv: Sequence[str] | None = None) -> int:
    from campus_evals.eval_profile_gate_cli import online_answer_path_main as main

    return main(argv)


def tool_denominator_main(argv: Sequence[str] | None = None) -> int:
    from campus_evals.eval_profile_gate_cli import tool_denominator_main as main

    return main(argv)


def document_quality_main(argv: Sequence[str] | None = None) -> int:
    from campus_evals.eval_profile_gate_cli import document_quality_main as main

    return main(argv)


def authz_privacy_main(argv: Sequence[str] | None = None) -> int:
    from campus_evals.eval_profile_gate_cli import authz_privacy_main as main

    return main(argv)


def agentic_retrieval_plan_main(argv: Sequence[str] | None = None) -> int:
    from campus_evals.eval_profile_gate_cli import agentic_retrieval_plan_main as main

    return main(argv)


def eval_operations_governance_main(argv: Sequence[str] | None = None) -> int:
    from campus_evals.eval_profile_gate_cli import eval_operations_governance_main as main

    return main(argv)


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
    "collect_online_answer_path_runtime_observations",
    "collect_tool_denominator_runtime_observations",
    "derive_eval_operations_observations_from_artifacts",
    "document_quality_main",
    "eval_operations_governance_main",
    "online_answer_path_main",
    "run_agentic_retrieval_plan_profile_gate",
    "run_authz_privacy_profile_gate",
    "run_document_quality_profile_gate",
    "run_eval_operations_governance_profile_gate",
    "run_online_answer_path_profile_gate",
    "run_tool_denominator_profile_gate",
    "tool_denominator_main",
]
