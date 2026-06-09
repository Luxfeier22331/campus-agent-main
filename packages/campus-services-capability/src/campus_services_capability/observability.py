from __future__ import annotations

from dataclasses import asdict

from campus_contracts import CapabilityObservability, CapabilityResponse, ErrorInfo

from campus_services_capability.tool_guardrails import (
    failure_class_for_outcome,
    result_guardrail_outcome,
)


def capability_observability(tool_name: str, result) -> CapabilityObservability:
    outcome = str(getattr(result, "outcome", "") or "")
    failure_class = failure_class_for_outcome(outcome)
    source_ref_count = source_ref_count_from_result(result)
    return CapabilityObservability(
        selected_tool=tool_name,
        tool_attempted=True,
        tool_outcome=outcome,
        failure_class=failure_class,
        fail_close_reason=str(getattr(result, "fail_close_reason", "") or ""),
        clarification_reason=str(getattr(result, "clarification_reason", "") or ""),
        result_outcome=outcome,
        source_ref_count=source_ref_count,
        access_decision="allowed",
        safe_details=agent_safe_details(
            tool_name=tool_name,
            result=result,
            result_type=result.__class__.__name__,
            outcome=outcome,
            source_ref_count=source_ref_count,
            access_decision="allowed",
            failure_class=failure_class,
            field_status=getattr(result, "field_status", {}) or {},
        ),
    )


def tool_not_allowed(tool_name: str) -> CapabilityResponse:
    return error_response(
        tool_name=tool_name,
        code="disallowed_tool",
        message=f"campus_services cannot execute tool: {tool_name}",
        tool_attempted=False,
        failure_class="tool_policy",
        access_decision="not_evaluated",
    )


def query_service_failed(tool_name: str, message: str) -> CapabilityResponse:
    return error_response(
        tool_name=tool_name,
        code="internal_query_service_failed",
        message=message or "internal query service failed",
        tool_attempted=True,
        failure_class="query_service_failed",
        access_decision="allowed",
    )


def error_response(
    *,
    tool_name: str,
    code: str,
    message: str,
    tool_attempted: bool,
    failure_class: str,
    access_decision: str,
) -> CapabilityResponse:
    return CapabilityResponse(
        capability="campus_services",
        status="error",
        confidence="low",
        error=ErrorInfo(code=code, message=message),
        capability_observability=CapabilityObservability(
            selected_tool=tool_name,
            tool_attempted=tool_attempted,
            tool_outcome=code,
            failure_class=failure_class,
            result_outcome=code,
            source_ref_count=0,
            access_decision=access_decision,
            safe_details=agent_safe_details(
                tool_name=tool_name,
                result={},
                result_type="ErrorInfo",
                outcome=code,
                source_ref_count=0,
                access_decision=access_decision,
                failure_class=failure_class,
                field_status={},
            ),
        ),
    )


def agent_safe_details(
    *,
    tool_name: str,
    result,
    result_type: str,
    outcome: str,
    source_ref_count: int,
    access_decision: str,
    failure_class: str,
    field_status: dict[str, str],
) -> dict[str, object]:
    guide_focus = str(getattr(result, "guide_focus", "") or "").strip()
    resolved_service = getattr(result, "resolved_service", None)
    source_refs_used = tuple(
        dict.fromkeys(
            str(source_ref).strip()
            for source_ref in (getattr(result, "source_refs", ()) or ())
            if str(source_ref).strip()
        )
    )
    result_guardrail: dict[str, object] = {
        "schema_version": "agent-result-guardrail-v1",
        "outcome": result_guardrail_outcome(outcome, source_ref_count),
        "source_ref_count": source_ref_count,
        "access_decision": access_decision,
        "focus_guardrail": "full_guide" if guide_focus == "full_guide" else "narrow_focus",
    }
    if failure_class:
        result_guardrail["failure_class"] = failure_class
    details = {
        "result_type": result_type,
        "agent_execution_projection": {
            "schema_version": "agent-execution-projection-v1",
            "projection_owner": "campus_services",
            "selected_tool": tool_name,
            "payload_kind": tool_name,
            "tool_selection_reason": "typed_payload_allowed_tool",
        },
        "result_guardrail": result_guardrail,
    }
    if guide_focus:
        details["guide_focus"] = guide_focus
    if resolved_service is not None:
        resolved_service_id = str(getattr(resolved_service, "service_id", "") or "").strip()
        resolved_service_display_name = str(
            getattr(resolved_service, "display_name", "") or ""
        ).strip()
        if resolved_service_id:
            details["resolved_service_id"] = resolved_service_id
        if resolved_service_display_name:
            details["resolved_service_display_name"] = resolved_service_display_name
    if source_refs_used:
        details["source_refs_used"] = list(source_refs_used)
    if field_status:
        details["field_status"] = dict(field_status)
    selected_section_ids = tuple(getattr(result, "selected_section_ids", ()) or ())
    omitted_section_ids = tuple(getattr(result, "omitted_section_ids", ()) or ())
    omitted_section_reasons = getattr(result, "omitted_section_reasons", {}) or {}
    if selected_section_ids:
        details["selected_section_ids"] = list(selected_section_ids)
    if omitted_section_ids:
        details["omitted_section_ids"] = list(omitted_section_ids)
    if omitted_section_reasons:
        details["omitted_section_reasons"] = dict(omitted_section_reasons)
    return details


def source_ref_count_from_result(result) -> int:
    refs: set[str] = set()

    def collect(value) -> None:
        if isinstance(value, str):
            return
        if isinstance(value, dict):
            for key, item in value.items():
                normalized_key = str(key)
                if normalized_key in {"source_ref"} and isinstance(item, str) and item.strip():
                    refs.add(item.strip())
                    continue
                if normalized_key.endswith(("source_refs", "notice_refs")):
                    if isinstance(item, (list, tuple)):
                        refs.update(str(ref).strip() for ref in item if str(ref).strip())
                    continue
                collect(item)
            return
        if isinstance(value, (list, tuple)):
            for item in value:
                collect(item)

    collect(asdict(result))
    return len(refs)
