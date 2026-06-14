from __future__ import annotations

from datetime import datetime

from campus_contracts import (
    CapabilityResponse,
    ContactDirectoryLookupResult,
    ServiceGuideLookupResult,
    ServiceStatusLookupResult,
    TransportScheduleLookupResult,
)

from campus_services_capability.observability import (
    capability_observability as _capability_observability,
)


def service_guide_response(result: ServiceGuideLookupResult) -> CapabilityResponse:
    if result.outcome == "resolved_current":
        service_name = (
            result.resolved_service.display_name
            if result.resolved_service is not None
            else result.service_query
        )
        guide_text = _service_guide_text(result)
        if not guide_text:
            return CapabilityResponse(
                capability="campus_services",
                status="no_answer",
                answer_text="当前还不能稳定确认这项办理指南。",
                confidence="low",
                result=result,
                capability_observability=_capability_observability("service_guide_lookup", result),
            )
        return CapabilityResponse(
            capability="campus_services",
            status="completed",
            answer_text=f"{service_name}：\n{guide_text}",
            confidence="high",
            result=result,
            capability_observability=_capability_observability("service_guide_lookup", result),
        )
    if result.outcome == "clarification_required":
        follow_up = "请明确你要查询的具体服务。"
        return CapabilityResponse(
            capability="campus_services",
            status="needs_clarification",
            answer_text=follow_up,
            follow_up_question=follow_up,
            confidence="medium",
            result=result,
            capability_observability=_capability_observability("service_guide_lookup", result),
        )
    if result.outcome == "temporarily_unverifiable":
        return CapabilityResponse(
            capability="campus_services",
            status="no_answer",
            answer_text=_field_not_provided_text(result, "办理指南")
            or "当前还不能稳定确认这项办理指南。",
            confidence="low",
            result=result,
            capability_observability=_capability_observability("service_guide_lookup", result),
        )
    return CapabilityResponse(
        capability="campus_services",
        status="no_answer",
        answer_text="当前没有找到对应的办理指南。",
        confidence="low",
        result=result,
        capability_observability=_capability_observability("service_guide_lookup", result),
    )


def service_status_response(result: ServiceStatusLookupResult) -> CapabilityResponse:
    if result.outcome == "resolved_current":
        note = result.status_note.strip()
        note_suffix = f" 提示：{note}" if note else ""
        window_suffix = _service_status_effective_window(
            result.effective_from,
            result.effective_until,
        )
        status_label = _service_status_label(str(result.observed_status))
        return CapabilityResponse(
            capability="campus_services",
            status="completed",
            answer_text=(
                f"{result.resolved_subject}：当前状态：{status_label}。{window_suffix}{note_suffix}"
            ).strip(),
            confidence="high",
            result=result,
            capability_observability=_capability_observability("service_status_lookup", result),
        )
    if result.outcome == "resolved_historical_reference":
        subject = result.resolved_subject or result.subject_query
        return CapabilityResponse(
            capability="campus_services",
            status="completed",
            answer_text=f"当前年份没有命中，找到历史参考：{subject}。",
            confidence="medium",
            result=result,
            capability_observability=_capability_observability("service_status_lookup", result),
        )
    if result.outcome == "clarification_required":
        follow_up = "请明确你要查询的校园服务对象。"
        return CapabilityResponse(
            capability="campus_services",
            status="needs_clarification",
            answer_text=follow_up,
            follow_up_question=follow_up,
            confidence="medium",
            result=result,
            capability_observability=_capability_observability("service_status_lookup", result),
        )
    if result.outcome == "temporarily_unverifiable":
        return CapabilityResponse(
            capability="campus_services",
            status="no_answer",
            answer_text="当前还不能稳定确认这项校园服务的状态。",
            confidence="low",
            result=result,
            capability_observability=_capability_observability("service_status_lookup", result),
        )
    return CapabilityResponse(
        capability="campus_services",
        status="no_answer",
        answer_text="当前没有找到对应的校园服务状态。",
        confidence="low",
        result=result,
        capability_observability=_capability_observability("service_status_lookup", result),
    )


def _service_status_label(status: str) -> str:
    labels = {
        "open": "正常开放",
        "closed": "未开放",
        "temporarily_closed": "临时关闭",
        "limited_service": "有限开放",
        "unknown": "状态未确认",
    }
    return labels.get(status.strip(), "状态未确认")


def _service_status_effective_window(effective_from: str, effective_until: str) -> str:
    start = _parse_datetime_label(effective_from)
    if start is None:
        return ""
    if _is_open_ended_effective_until(effective_until):
        return f"有效时间：{start[0]}月{start[1]}日 {start[2]} 起。"
    end = _parse_datetime_label(effective_until)
    if end is None:
        return ""
    if start[:2] == end[:2]:
        return f"有效时间：{start[0]}月{start[1]}日 {start[2]} 至 {end[2]}。"
    return f"有效时间：{start[0]}月{start[1]}日 {start[2]} 至 {end[0]}月{end[1]}日 {end[2]}。"


def _is_open_ended_effective_until(value: str) -> bool:
    normalized = value.strip()
    if len(normalized) < 4:
        return False
    try:
        year = int(normalized[:4])
    except ValueError:
        return False
    return year >= 2099


def _parse_datetime_label(value: str) -> tuple[int, int, str] | None:
    normalized = value.strip()
    if not normalized:
        return None
    try:
        parsed = datetime.fromisoformat(normalized)
    except ValueError:
        return None
    return parsed.month, parsed.day, parsed.strftime("%H:%M")


def transport_schedule_response(result: TransportScheduleLookupResult) -> CapabilityResponse:
    operational_suffix = _transport_operational_suffix(result)
    if result.outcome == "resolved_current":
        route_name = result.resolved_route.display_name if result.resolved_route is not None else ""
        if result.selected_departure is not None:
            return CapabilityResponse(
                capability="campus_services",
                status="completed",
                answer_text=(
                    f"{route_name}下一班发车时间：{result.selected_departure.departure_at}。"
                    f"{operational_suffix}"
                    if route_name
                    else f"下一班发车时间：{result.selected_departure.departure_at}。{operational_suffix}"
                ),
                confidence="high",
                result=result,
                capability_observability=_capability_observability(
                    "transport_schedule_lookup", result
                ),
            )
        if result.schedule_snapshot is not None and result.intent == "schedule_snapshot_metadata":
            return CapabilityResponse(
                capability="campus_services",
                status="completed",
                answer_text=(
                    "当前有效时刻表版本："
                    f"{result.schedule_snapshot.snapshot_id}，发布时间：{result.schedule_snapshot.published_at}。"
                ),
                confidence="high",
                result=result,
                capability_observability=_capability_observability(
                    "transport_schedule_lookup", result
                ),
            )
        if result.departure_options:
            departures = "、".join(departure.departure_at for departure in result.departure_options)
            return CapabilityResponse(
                capability="campus_services",
                status="completed",
                answer_text=(
                    f"{route_name}可选班次：{departures}。{operational_suffix}"
                    if route_name
                    else f"可选班次：{departures}。{operational_suffix}"
                ),
                confidence="high",
                result=result,
                capability_observability=_capability_observability(
                    "transport_schedule_lookup", result
                ),
            )
        if result.service_window is not None:
            return CapabilityResponse(
                capability="campus_services",
                status="completed",
                answer_text=(
                    f"{route_name}运营时间：{result.service_window.first_departure_at}"
                    f" 至 {result.service_window.last_departure_at}。{operational_suffix}"
                    if route_name
                    else (
                        f"运营时间：{result.service_window.first_departure_at}"
                        f" 至 {result.service_window.last_departure_at}。{operational_suffix}"
                    )
                ),
                confidence="high",
                result=result,
                capability_observability=_capability_observability(
                    "transport_schedule_lookup", result
                ),
            )
        if result.timetable_entries:
            entries = "、".join(departure.departure_at for departure in result.timetable_entries)
            return CapabilityResponse(
                capability="campus_services",
                status="completed",
                answer_text=(
                    f"{route_name}时刻表：{entries}。{operational_suffix}"
                    if route_name
                    else f"时刻表：{entries}。{operational_suffix}"
                ),
                confidence="high",
                result=result,
                capability_observability=_capability_observability(
                    "transport_schedule_lookup", result
                ),
            )
        return CapabilityResponse(
            capability="campus_services",
            status="completed",
            answer_text=(
                f"{route_name}当前状态：{_transport_service_status_label(result.service_status)}。"
                f"{operational_suffix}"
                if route_name
                else (
                    f"当前状态：{_transport_service_status_label(result.service_status)}。"
                    f"{operational_suffix}"
                )
            ),
            confidence="high",
            result=result,
            capability_observability=_capability_observability("transport_schedule_lookup", result),
        )
    if result.outcome == "resolved_historical_reference":
        route_name = (
            result.resolved_route.display_name
            if result.resolved_route is not None
            else result.query_text
        )
        return CapabilityResponse(
            capability="campus_services",
            status="completed",
            answer_text=f"当前年份没有命中，找到历史班次参考：{route_name}。",
            confidence="medium",
            result=result,
            capability_observability=_capability_observability("transport_schedule_lookup", result),
        )
    if result.outcome == "clarification_required":
        follow_up = "请明确你要查询的班车类型、方向或线路。"
        return CapabilityResponse(
            capability="campus_services",
            status="needs_clarification",
            answer_text=follow_up,
            follow_up_question=follow_up,
            confidence="medium",
            result=result,
            capability_observability=_capability_observability("transport_schedule_lookup", result),
        )
    if result.outcome == "temporarily_unverifiable":
        return CapabilityResponse(
            capability="campus_services",
            status="no_answer",
            answer_text="当前还不能稳定确认这条班车线路的运行状态。",
            confidence="low",
            result=result,
            capability_observability=_capability_observability("transport_schedule_lookup", result),
        )
    return CapabilityResponse(
        capability="campus_services",
        status="no_answer",
        answer_text="当前没有找到对应的班车线路信息。",
        confidence="low",
        result=result,
        capability_observability=_capability_observability("transport_schedule_lookup", result),
    )


def contact_directory_response(result: ContactDirectoryLookupResult) -> CapabilityResponse:
    if result.outcome == "resolved_current":
        contact_name = (
            result.resolved_contact.display_name
            if result.resolved_contact is not None
            else result.query_text
        )
        contact_text = _contact_directory_text(result)
        return CapabilityResponse(
            capability="campus_services",
            status="completed",
            answer_text=f"{contact_name}：\n{contact_text}" if contact_text else contact_name,
            confidence="high",
            result=result,
            capability_observability=_capability_observability("contact_directory_lookup", result),
        )
    if result.outcome == "clarification_required":
        follow_up = "请明确你要查询的部门或联系对象。"
        return CapabilityResponse(
            capability="campus_services",
            status="needs_clarification",
            answer_text=follow_up,
            follow_up_question=follow_up,
            confidence="medium",
            result=result,
            capability_observability=_capability_observability("contact_directory_lookup", result),
        )
    if result.outcome == "temporarily_unverifiable":
        return CapabilityResponse(
            capability="campus_services",
            status="no_answer",
            answer_text=_field_not_provided_text(result, "联系方式")
            or "当前还不能稳定确认这项联系方式。",
            confidence="low",
            result=result,
            capability_observability=_capability_observability("contact_directory_lookup", result),
        )
    return CapabilityResponse(
        capability="campus_services",
        status="no_answer",
        answer_text="当前没有找到对应的联系方式。",
        confidence="low",
        result=result,
        capability_observability=_capability_observability("contact_directory_lookup", result),
    )


def _service_guide_text(result: ServiceGuideLookupResult) -> str:
    focus = str(getattr(result, "guide_focus", "") or "").strip()
    parts: list[str] = []
    if focus == "entry":
        entry_line = _service_guide_entry_line(result)
        if entry_line:
            parts.append(entry_line)
    elif focus == "procedure":
        parts.extend(_service_guide_procedure_parts(result))
    elif focus == "required_materials":
        materials_line = _service_guide_materials_line(result)
        if materials_line:
            parts.append(materials_line)
        else:
            parts.extend(_service_guide_sections_for_type(result, "required_materials"))
    elif focus == "contact":
        contact_line = _service_guide_contacts_line(result)
        if contact_line:
            parts.append(contact_line)
    elif focus == "office_hours":
        hours_line = _service_guide_hours_line(result)
        if hours_line:
            parts.append(hours_line)
    else:
        parts.extend(_all_service_guide_sections(result))
        parts.extend(_service_guide_procedure_parts(result))
        materials_line = _service_guide_materials_line(result)
        if materials_line:
            parts.append(materials_line)
        entry_line = _service_guide_entry_line(result)
        if entry_line:
            parts.append(entry_line)
        hours_line = _service_guide_hours_line(result)
        if hours_line:
            parts.append(hours_line)
        contact_line = _service_guide_contacts_line(result)
        if contact_line:
            parts.append(contact_line)
        if result.eligibility_notes:
            parts.append("适用范围：" + "、".join(result.eligibility_notes))
    if parts:
        display_source_refs = _display_source_refs(result.source_refs)
        if display_source_refs:
            parts.append("来源：" + "、".join(display_source_refs))
    return "\n".join(part for part in dict.fromkeys(parts) if part)


def _all_service_guide_sections(result: ServiceGuideLookupResult) -> list[str]:
    return [
        (
            f"{section.title}：{section.content}"
            if section.title and section.title != section.content
            else section.content
        )
        for section in result.guide_sections
        if section.content
    ]


def _service_guide_procedure_parts(result: ServiceGuideLookupResult) -> list[str]:
    parts: list[str] = []
    selected_groups = getattr(result, "procedure_groups", ()) or ()
    for group in selected_groups:
        step_lines = [step.content for step in getattr(group, "steps", ()) if step.content]
        if not step_lines:
            continue
        parts.append(f"{group.title}：" + "\n".join(step_lines))
    return parts


def _service_guide_sections_for_type(
    result: ServiceGuideLookupResult,
    section_type: str,
) -> list[str]:
    return [
        (
            f"{section.title}：{section.content}"
            if section.title and section.title != section.content
            else section.content
        )
        for section in result.guide_sections
        if section.content
        and str(getattr(section, "section_type", "") or "").strip() == section_type
    ]


def _service_guide_entry_sections(result: ServiceGuideLookupResult) -> list[str]:
    return _service_guide_sections_for_type(result, "entry")


def _service_guide_materials_line(result: ServiceGuideLookupResult) -> str:
    if not result.required_materials:
        return ""
    return "所需材料：" + "、".join(
        _service_guide_material_text(material) for material in result.required_materials
    )


def _service_guide_entry_line(result: ServiceGuideLookupResult) -> str:
    if not result.entry_refs:
        return ""
    return "入口：" + "、".join(_service_guide_entry_text(entry) for entry in result.entry_refs)


def _service_guide_hours_line(result: ServiceGuideLookupResult) -> str:
    if not result.office_hours:
        return ""
    values = [
        _service_guide_hours_text(hours)
        for hours in result.office_hours
        if _service_guide_hours_text(hours)
    ]
    if not values:
        return ""
    return "办理时间：" + "、".join(values)


def _service_guide_contacts_line(result: ServiceGuideLookupResult) -> str:
    if not result.contact_refs:
        return ""
    return "联系方式：" + "、".join(
        _service_guide_contact_text(contact) for contact in result.contact_refs
    )


def _display_source_refs(source_refs: tuple[str, ...]) -> tuple[str, ...]:
    return tuple(
        dict.fromkeys(
            source_ref
            for source_ref in source_refs
            if source_ref.startswith(("http://", "https://"))
        )
    )


def _service_guide_material_text(material) -> str:
    parts = [material.name]
    if not material.required:
        parts.append("可选")
    if material.note:
        parts.append(material.note)
    return " ".join(parts).strip() or material.name


def _service_guide_entry_text(entry) -> str:
    parts = [entry.label]
    if entry.location_ref and entry.location_ref != entry.label:
        parts.append(entry.location_ref)
    if entry.url:
        parts.append(entry.url)
    return " ".join(parts).strip() or entry.label


def _service_guide_hours_text(hours) -> str:
    parts = []
    if hours.label:
        parts.append(hours.label)
    if hours.day_pattern:
        parts.append(hours.day_pattern)
    if hours.time_range:
        parts.append(hours.time_range)
    elif hours.effective_note:
        parts.append(hours.effective_note)
    return " ".join(parts).strip()


def _contact_directory_text(result: ContactDirectoryLookupResult) -> str:
    parts: list[str] = []
    if result.contact_points:
        parts.append(
            "联系方式："
            + "、".join(_contact_directory_point_text(point) for point in result.contact_points)
        )
    if result.location_refs:
        parts.append(
            "办公地点："
            + "、".join(
                _contact_directory_location_text(location) for location in result.location_refs
            )
        )
    if result.office_hours:
        parts.append(
            "办公时间："
            + "、".join(
                hours_text
                for hours in result.office_hours
                if (hours_text := _contact_directory_hours_text(hours))
            )
        )
    return "\n".join(part for part in dict.fromkeys(parts) if part)


def _contact_directory_point_text(point) -> str:
    parts = []
    if point.label:
        parts.append(point.label)
    if point.value:
        parts.append(point.value)
    return " ".join(parts).strip() or point.value


def _contact_directory_location_text(location) -> str:
    parts = []
    if location.label:
        parts.append(location.label)
    if location.address_text:
        parts.append(location.address_text)
    elif location.location_ref and location.location_ref != location.label:
        parts.append(location.location_ref)
    return " ".join(parts).strip() or location.location_ref


def _contact_directory_hours_text(hours) -> str:
    parts = []
    if hours.label:
        parts.append(hours.label)
    if hours.time_range:
        parts.append(hours.time_range)
    elif hours.effective_note:
        parts.append(hours.effective_note)
    return " ".join(parts).strip()


def _field_not_provided_text(result, label: str) -> str:
    if str(getattr(result, "fail_close_reason", "") or "") != "field_not_provided_by_source":
        return ""
    field_status = getattr(result, "field_status", {}) or {}
    missing_fields = tuple(
        str(field_name)
        for field_name, status in field_status.items()
        if str(status) == "source_not_provided"
    )
    if not missing_fields:
        return f"当前来源未提供{label}。"
    if missing_fields == ("service_entry",):
        return "当前来源未提供该服务的入口链接。"
    if missing_fields == ("office_hours",):
        return "当前来源未提供办公时间。"
    if missing_fields == ("phone",):
        return "当前来源未提供联系电话。"
    if missing_fields == ("email",):
        return "当前来源未提供联系邮箱。"
    if missing_fields == ("location",):
        return "当前来源未提供办理地点。"
    if any(
        field in {"required_materials", "service_material", "materials"} for field in missing_fields
    ):
        return "当前来源未提供所需材料。"
    if any(field in {"contact", "phone", "email", "location"} for field in missing_fields):
        return "当前来源未提供联系方式。"
    return f"当前来源未提供{label}。"


def _transport_operational_suffix(result: TransportScheduleLookupResult) -> str:
    comments = tuple(
        dict.fromkeys(
            notice.operational_comment.strip()
            for notice in result.operational_notices
            if notice.operational_comment.strip()
        )
    )
    if not comments:
        return ""
    return "运营提示：" + "；".join(comments) + "。"


def _transport_service_status_label(status: str) -> str:
    labels = {
        "running": "正常运行",
        "not_running": "未运行",
        "temporarily_suspended": "临时停运",
        "limited_service": "有限运行",
        "unknown": "状态未确认",
    }
    return labels.get(status.strip(), "状态未确认")


def _service_guide_contact_text(contact) -> str:
    parts = [contact.label]
    if contact.department and contact.department != contact.label:
        parts.append(contact.department)
    if contact.phone:
        parts.append(contact.phone)
    if contact.email:
        parts.append(contact.email)
    return " ".join(parts)


__all__ = [
    "contact_directory_response",
    "service_guide_response",
    "service_status_response",
    "transport_schedule_response",
]
