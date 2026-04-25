from __future__ import annotations

from campus_contracts import (
    ErrorInfo,
    ServiceGuideLookupPayload,
    ServiceGuideLookupResult,
    ServiceStatusLookupPayload,
    ServiceStatusLookupResult,
    SpecialistRequest,
    SpecialistResponse,
    TransportScheduleLookupPayload,
    TransportScheduleLookupResult,
)

from campus_services_agent.query_service import (
    CampusServicesAccessContext,
    CampusServicesQueryService,
    ServiceGuideQuery,
    ServiceStatusQuery,
    TransportScheduleQuery,
)


def dispatch_tool_request(
    request: SpecialistRequest,
    *,
    query_service: CampusServicesQueryService,
) -> SpecialistResponse:
    if isinstance(request.payload, ServiceStatusLookupPayload):
        return _handle_service_status_lookup(request, query_service=query_service)
    if isinstance(request.payload, ServiceGuideLookupPayload):
        return _handle_service_guide_lookup(request, query_service=query_service)
    if isinstance(request.payload, TransportScheduleLookupPayload):
        return _handle_transport_schedule_lookup(request, query_service=query_service)
    return SpecialistResponse(
        target="campus-services-agent",
        status="error",
        confidence="low",
        error=ErrorInfo(
            code="invalid_payload",
            message=(
                "campus-services-agent requires service status, service guide, "
                "or transport schedule payload"
            ),
        ),
    )


def _handle_service_status_lookup(
    request: SpecialistRequest,
    *,
    query_service: CampusServicesQueryService,
) -> SpecialistResponse:
    tool_name = "service_status_lookup"
    if tool_name not in request.allowed_tools:
        return _tool_not_allowed(tool_name)
    try:
        result = query_service.lookup_service_status(
            ServiceStatusQuery(
                payload=request.payload,
                access_context=_access_context_from_request(request),
            )
        )
    except Exception as exc:
        return _query_service_failed(str(exc))
    return _service_status_response(result)


def _handle_service_guide_lookup(
    request: SpecialistRequest,
    *,
    query_service: CampusServicesQueryService,
) -> SpecialistResponse:
    tool_name = "service_guide_lookup"
    if tool_name not in request.allowed_tools:
        return _tool_not_allowed(tool_name)
    try:
        result = query_service.lookup_service_guide(
            ServiceGuideQuery(
                payload=request.payload,
                access_context=_access_context_from_request(request),
            )
        )
    except Exception as exc:
        return _query_service_failed(str(exc))
    return _service_guide_response(result)


def _handle_transport_schedule_lookup(
    request: SpecialistRequest,
    *,
    query_service: CampusServicesQueryService,
) -> SpecialistResponse:
    tool_name = "transport_schedule_lookup"
    if tool_name not in request.allowed_tools:
        return _tool_not_allowed(tool_name)
    try:
        result = query_service.lookup_transport_schedule(
            TransportScheduleQuery(
                payload=request.payload,
                access_context=_access_context_from_request(request),
            )
        )
    except Exception as exc:
        return _query_service_failed(str(exc))
    return _transport_schedule_response(result)


def _service_guide_response(result: ServiceGuideLookupResult) -> SpecialistResponse:
    if result.outcome == "resolved_current":
        service_name = (
            result.resolved_service.display_name
            if result.resolved_service is not None
            else result.service_query
        )
        guide_text = _service_guide_text(result)
        return SpecialistResponse(
            target="campus-services-agent",
            status="completed",
            answer_text=f"{service_name}：\n{guide_text}" if guide_text else service_name,
            confidence="high",
            result=result,
        )
    if result.outcome == "clarification_required":
        follow_up = "请明确你要查询的具体服务。"
        return SpecialistResponse(
            target="campus-services-agent",
            status="needs_clarification",
            answer_text=follow_up,
            follow_up_question=follow_up,
            confidence="medium",
            result=result,
        )
    if result.outcome == "temporarily_unverifiable":
        return SpecialistResponse(
            target="campus-services-agent",
            status="no_answer",
            answer_text="当前还不能稳定确认这项办理指南。",
            confidence="low",
            result=result,
        )
    return SpecialistResponse(
        target="campus-services-agent",
        status="no_answer",
        answer_text="当前没有找到对应的办理指南。",
        confidence="low",
        result=result,
    )


def _service_status_response(result: ServiceStatusLookupResult) -> SpecialistResponse:
    if result.outcome == "resolved_current":
        return SpecialistResponse(
            target="campus-services-agent",
            status="completed",
            answer_text=f"{result.resolved_subject}当前状态：{result.observed_status}。",
            confidence="high",
            result=result,
        )
    if result.outcome == "resolved_historical_reference":
        subject = result.resolved_subject or result.subject_query
        return SpecialistResponse(
            target="campus-services-agent",
            status="completed",
            answer_text=f"当前年份没有命中，找到历史参考：{subject}。",
            confidence="medium",
            result=result,
        )
    if result.outcome == "clarification_required":
        follow_up = "请明确你要查询的校园服务对象。"
        return SpecialistResponse(
            target="campus-services-agent",
            status="needs_clarification",
            answer_text=follow_up,
            follow_up_question=follow_up,
            confidence="medium",
            result=result,
        )
    if result.outcome == "temporarily_unverifiable":
        return SpecialistResponse(
            target="campus-services-agent",
            status="no_answer",
            answer_text="当前还不能稳定确认这项校园服务的状态。",
            confidence="low",
            result=result,
        )
    return SpecialistResponse(
        target="campus-services-agent",
        status="no_answer",
        answer_text="当前没有找到对应的校园服务状态。",
        confidence="low",
        result=result,
    )


def _transport_schedule_response(result: TransportScheduleLookupResult) -> SpecialistResponse:
    if result.outcome == "resolved_current":
        route_name = result.resolved_route.display_name if result.resolved_route is not None else ""
        if result.selected_departure is not None:
            return SpecialistResponse(
                target="campus-services-agent",
                status="completed",
                answer_text=(
                    f"{route_name}下一班发车时间：{result.selected_departure.departure_at}。"
                    if route_name
                    else f"下一班发车时间：{result.selected_departure.departure_at}。"
                ),
                confidence="high",
                result=result,
            )
        if result.schedule_snapshot is not None and result.intent == "schedule_snapshot_metadata":
            return SpecialistResponse(
                target="campus-services-agent",
                status="completed",
                answer_text=(
                    "当前有效时刻表版本："
                    f"{result.schedule_snapshot.snapshot_id}，发布时间：{result.schedule_snapshot.published_at}。"
                ),
                confidence="high",
                result=result,
            )
        if result.departure_options:
            departures = "、".join(departure.departure_at for departure in result.departure_options)
            return SpecialistResponse(
                target="campus-services-agent",
                status="completed",
                answer_text=(
                    f"{route_name}可选班次：{departures}。"
                    if route_name
                    else f"可选班次：{departures}。"
                ),
                confidence="high",
                result=result,
            )
        if result.service_window is not None:
            return SpecialistResponse(
                target="campus-services-agent",
                status="completed",
                answer_text=(
                    f"{route_name}运营时间：{result.service_window.first_departure_at}"
                    f" 至 {result.service_window.last_departure_at}。"
                    if route_name
                    else (
                        f"运营时间：{result.service_window.first_departure_at}"
                        f" 至 {result.service_window.last_departure_at}。"
                    )
                ),
                confidence="high",
                result=result,
            )
        if result.timetable_entries:
            entries = "、".join(departure.departure_at for departure in result.timetable_entries)
            return SpecialistResponse(
                target="campus-services-agent",
                status="completed",
                answer_text=(
                    f"{route_name}时刻表：{entries}。" if route_name else f"时刻表：{entries}。"
                ),
                confidence="high",
                result=result,
            )
        return SpecialistResponse(
            target="campus-services-agent",
            status="completed",
            answer_text=f"{route_name}当前状态：{result.service_status}。"
            if route_name
            else f"当前状态：{result.service_status}。",
            confidence="high",
            result=result,
        )
    if result.outcome == "resolved_historical_reference":
        route_name = (
            result.resolved_route.display_name
            if result.resolved_route is not None
            else result.query_text
        )
        return SpecialistResponse(
            target="campus-services-agent",
            status="completed",
            answer_text=f"当前年份没有命中，找到历史班次参考：{route_name}。",
            confidence="medium",
            result=result,
        )
    if result.outcome == "clarification_required":
        follow_up = "请明确你要查询的班车类型、方向或线路。"
        return SpecialistResponse(
            target="campus-services-agent",
            status="needs_clarification",
            answer_text=follow_up,
            follow_up_question=follow_up,
            confidence="medium",
            result=result,
        )
    if result.outcome == "temporarily_unverifiable":
        return SpecialistResponse(
            target="campus-services-agent",
            status="no_answer",
            answer_text="当前还不能稳定确认这条班车线路的运行状态。",
            confidence="low",
            result=result,
        )
    return SpecialistResponse(
        target="campus-services-agent",
        status="no_answer",
        answer_text="当前没有找到对应的班车线路信息。",
        confidence="low",
        result=result,
    )


def _service_guide_text(result: ServiceGuideLookupResult) -> str:
    if result.guide_sections:
        return "\n".join(section.content for section in result.guide_sections if section.content)
    if result.required_materials:
        return "、".join(material.name for material in result.required_materials)
    if result.entry_refs:
        return "、".join(entry.label for entry in result.entry_refs)
    if result.office_hours:
        return "、".join(hours.time_range or hours.effective_note for hours in result.office_hours)
    if result.contact_refs:
        return "、".join(_service_guide_contact_text(contact) for contact in result.contact_refs)
    if result.eligibility_notes:
        return "、".join(result.eligibility_notes)
    return ""


def _service_guide_contact_text(contact) -> str:
    parts = [contact.label]
    if contact.department and contact.department != contact.label:
        parts.append(contact.department)
    if contact.phone:
        parts.append(contact.phone)
    if contact.email:
        parts.append(contact.email)
    return " ".join(parts)


def _access_context_from_request(request: SpecialistRequest) -> CampusServicesAccessContext:
    return CampusServicesAccessContext(
        actor=request.actor,
        authorization=request.context.authorization,
    )


def _tool_not_allowed(tool_name: str) -> SpecialistResponse:
    return SpecialistResponse(
        target="campus-services-agent",
        status="error",
        confidence="low",
        error=ErrorInfo(
            code="disallowed_tool",
            message=f"campus-services-agent cannot execute tool: {tool_name}",
        ),
    )


def _query_service_failed(message: str) -> SpecialistResponse:
    return SpecialistResponse(
        target="campus-services-agent",
        status="error",
        confidence="low",
        error=ErrorInfo(
            code="internal_query_service_failed",
            message=message or "internal query service failed",
        ),
    )
