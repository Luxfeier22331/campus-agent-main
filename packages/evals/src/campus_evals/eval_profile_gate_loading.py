from __future__ import annotations

import json
from pathlib import Path

import httpx

from campus_evals.agentic_retrieval_plan_eval import AgenticRetrievalPlanObservation
from campus_evals.authz_privacy_eval import AuthzPrivacyObservation
from campus_evals.document_quality_eval import DocumentQualityObservation
from campus_evals.eval_operations_governance import EvalOperationsObservation
from campus_evals.online_answer_path_eval import OnlineAnswerPathObservation
from campus_evals.tool_family_denominator import ToolObservation


def _request_correlation_mapping(value: object) -> dict[str, object]:
    value = _mapping(value or {}, "request_correlation")
    return {
        "case_id": _required_string(value.get("case_id"), "request_correlation.case_id"),
        "request_id": _required_string(value.get("request_id"), "request_correlation.request_id"),
        "trace_id": _required_string(value.get("trace_id"), "request_correlation.trace_id"),
        "sampled_at": _required_string(value.get("sampled_at"), "request_correlation.sampled_at"),
        "trace_link": _optional_string_value(value.get("trace_link")),
        "issue_link": _optional_string_value(value.get("issue_link")),
        "issue_fingerprint": _optional_string_value(value.get("issue_fingerprint")),
    }


def _load_online_answer_observations(
    path: Path | None,
) -> dict[str, OnlineAnswerPathObservation]:
    return {
        item["case_id"]: OnlineAnswerPathObservation(
            case_id=_required_string(item.get("case_id"), "case_id"),
            request_id=_required_string(item.get("request_id"), "request_id"),
            trace_id=_required_string(item.get("trace_id"), "trace_id"),
            selected_capability=_required_string(
                item.get("selected_capability"), "selected_capability"
            ),
            terminal_status=_required_string(item.get("terminal_status"), "terminal_status"),
            semantic_outcome=_required_string(
                item.get("semantic_outcome"),
                "semantic_outcome",
            ),
            fail_close_reason=str(item.get("fail_close_reason") or ""),
            response_contract=_mapping(item.get("response_contract") or {}, "response_contract"),
            operator_backflow=_mapping(item.get("operator_backflow") or {}, "operator_backflow"),
            request_correlation=(
                _request_correlation_mapping(item.get("request_correlation"))
                if item.get("request_correlation")
                else {}
            ),
            workflow_trace_summary=_mapping(
                item.get("workflow_trace_summary") or {},
                "workflow_trace_summary",
            ),
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
            metrics_missing=bool(item.get("metrics_missing") or False),
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


def _online_answer_observation_from_response(
    *,
    case_id: str,
    response: httpx.Response,
) -> OnlineAnswerPathObservation:
    payload = response.json()
    answer = _mapping(payload.get("answer") or {}, "answer")
    result = _mapping(answer.get("result") or {}, "answer.result")
    supervisor = payload.get("supervisor") if isinstance(payload.get("supervisor"), dict) else {}
    request_id = str(result.get("requestId") or response.headers.get("x-request-id") or "")
    trace_id = str(result.get("traceId") or response.headers.get("x-trace-id") or "")
    selected_capability = str(
        supervisor.get("selectedCapability")
        or supervisor.get("selected_capability")
        or result.get("selectedCapability")
        or result.get("selected_capability")
        or "none"
    )
    terminal_status = str(supervisor.get("status") or result.get("status") or "")
    fail_close_reason = str(
        supervisor.get("failCloseReason")
        or supervisor.get("fail_close_reason")
        or result.get("failCloseReason")
        or result.get("fail_close_reason")
        or ""
    )
    return OnlineAnswerPathObservation(
        case_id=case_id,
        request_id=request_id,
        trace_id=trace_id,
        selected_capability=selected_capability,
        terminal_status=terminal_status,
        semantic_outcome=_semantic_outcome_from_status(
            terminal_status=terminal_status,
            fail_close_reason=fail_close_reason,
            tool_business_outcome="",
            explicit_semantic_outcome="",
        ),
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


def _semantic_outcome_from_status(
    *,
    terminal_status: str,
    fail_close_reason: str,
    tool_business_outcome: str,
    explicit_semantic_outcome: str,
) -> str:
    explicit = str(explicit_semantic_outcome or "").strip()
    if explicit:
        return explicit
    tool_outcome = str(tool_business_outcome or "").strip()
    if tool_outcome == "not_found":
        return "no_hit"
    if tool_outcome == "clarification_required":
        return "clarification"
    if tool_outcome:
        return "answered"
    if str(fail_close_reason or "").strip():
        return "fail_close"
    if terminal_status == "needs_clarification":
        return "clarification"
    if terminal_status == "no_answer":
        return "no_hit"
    if terminal_status in {"error", "rejected", "approval_required"}:
        return "fail_close"
    if terminal_status == "completed":
        return "answered"
    return terminal_status


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


def _has_cards(value: object) -> bool:
    if isinstance(value, dict):
        if value.get("cards"):
            return True
        return any(_has_cards(item) for item in value.values())
    if isinstance(value, list | tuple):
        return any(_has_cards(item) for item in value)
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


def _optional_string_value(value: object) -> str | None:
    normalized = str(value or "").strip()
    return normalized or None


def _string_tuple_or_empty(value: object) -> tuple[str, ...]:
    if not isinstance(value, list | tuple):
        return ()
    return tuple(str(item) for item in value if str(item).strip())


def _runtime_metrics_missing(summary: dict[str, object]) -> bool:
    if bool(summary.get("metrics_missing")):
        return True
    if "total_checks" in summary:
        return False
    required_string_fields = (
        "started_at",
        "finished_at",
        "collector_version",
        "runtime_profile",
    )
    required_numeric_fields = (
        "runtime_seconds",
        "retry_count",
        "provider_calls",
    )
    if any(not str(summary.get(field_name) or "").strip() for field_name in required_string_fields):
        return True
    for field_name in required_numeric_fields:
        if field_name not in summary:
            return True
        try:
            _non_negative_int(summary[field_name], field_name)
        except Exception:
            return True
    return False


__all__ = [
    "_has_cards",
    "_has_source_url",
    "_load_agentic_retrieval_plan_observations",
    "_load_authz_privacy_observations",
    "_load_document_quality_observations",
    "_load_eval_operations_observations",
    "_load_json",
    "_load_online_answer_observations",
    "_load_tool_observations",
    "_mapping",
    "_optional_string_value",
    "_required_string",
    "_result_disposition",
    "_runtime_metrics_missing",
    "_string_tuple",
    "_string_tuple_or_empty",
]
