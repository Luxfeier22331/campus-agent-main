from __future__ import annotations

import re
from datetime import date

from campus_ingestion_core.internal_notice_schedule_body import (
    ScheduleNoticeBody,
    extract_schedule_from_notice_body,
)
from campus_ingestion_core.notice_consumption_projection import NoticeConsumptionProjectionEntry
from campus_ingestion_core.notice_derived_transport_schedule_body_materialization import (
    body_schedule_row_remarks,
    body_schedule_row_text,
    resolve_body_schedule_service_date_ranges,
)
from campus_ingestion_core.notice_derived_transport_schedule_constants import (
    _CHINESE_DATE_RANGE_RE,
    _FULL_DATE_RE,
    _MARKDOWN_HEADING_RE,
    _ORDINAL_RE,
    _SERVICE_STOP_KEYWORDS,
    _YEARLESS_SINGLE_DATE_RE,
)
from campus_ingestion_core.notice_derived_transport_schedule_models import (
    NoticeDerivedTransportScheduleRow,
    NoticeDerivedTransportServiceException,
)
from campus_ingestion_core.notice_derived_transport_schedule_parsing import (
    _clean_cell,
    _extract_table_departure_times,
    _extract_times,
    _is_header_row,
    _resolve_effective_date,
    _resolve_remarks,
    _resolve_rider_type,
    _resolve_route,
    _resolve_schedule_scope,
    _resolve_segment_service_date_ranges,
    _resolve_service_date_ranges,
    _resolve_weekday_scope,
    _route_direction,
    _schedule_scope_precedence,
    _text_segments,
)
from campus_ingestion_core.notice_derived_transport_schedule_support import (
    reservation_open_time_segment,
)
from campus_ingestion_core.transport_schedule_projection import _date_range


def _extract_rows_from_table_matrix(
    *,
    matrix: tuple[tuple[str, ...], ...],
    projection_entry: NoticeConsumptionProjectionEntry,
    source_ref: str,
    source_attachment_document_id: str,
    parent_text: str,
) -> list[NoticeDerivedTransportScheduleRow]:
    filled_rows = _fill_down_context(matrix)
    extracted: list[NoticeDerivedTransportScheduleRow] = []
    parent_service_date_ranges = _resolve_service_date_ranges(
        text=parent_text,
        release_time=projection_entry.source_notice_release_time,
    )
    for row in filled_rows:
        row_text = " ".join(cell for cell in row if cell)
        if not row_text or _is_header_row(row_text):
            continue
        route = _resolve_route(row_text)
        if route is None:
            continue
        service_date_ranges = _resolve_table_row_service_date_ranges(
            row_text=row_text,
            parent_service_date_ranges=parent_service_date_ranges,
            release_time=projection_entry.source_notice_release_time,
        )
        schedule_scope = _resolve_schedule_scope(
            parent_text=parent_text,
            row_text=row_text,
            service_date_ranges=service_date_ranges,
        )
        weekday_scope = _resolve_weekday_scope(row_text, route.default_calendar)
        rider_type = _resolve_rider_type(row_text)
        effective_from = (
            service_date_ranges[0][0]
            if service_date_ranges
            else _resolve_effective_date(
                text=f"{parent_text}\n{row_text}",
                release_time=projection_entry.source_notice_release_time,
            )
        )
        remarks = _resolve_remarks(row)
        for departure_time in _extract_table_departure_times(row, row_text):
            extracted.append(
                NoticeDerivedTransportScheduleRow(
                    source_notice_id=projection_entry.source_notice_id,
                    source_ref=source_ref,
                    source_attachment_document_id=source_attachment_document_id,
                    weekday_scope=weekday_scope,
                    route_direction=_route_direction(route.route_id),
                    route_id=route.route_id,
                    departure_time=departure_time,
                    rider_type=rider_type,
                    remarks=remarks,
                    effective_from=effective_from,
                    schedule_scope=schedule_scope,
                    service_date_ranges=service_date_ranges,
                    precedence=_schedule_scope_precedence(schedule_scope),
                )
            )
    return extracted


def _resolve_table_row_service_date_ranges(
    *,
    row_text: str,
    parent_service_date_ranges: tuple[tuple[str, str], ...],
    release_time: str | None,
) -> tuple[tuple[str, str], ...]:
    row_ranges = _resolve_service_date_ranges(text=row_text, release_time=release_time)
    if row_ranges:
        return row_ranges
    if _looks_like_open_ended_effective_date(row_text):
        return parent_service_date_ranges
    row_single_dates = _resolve_segment_service_date_ranges(
        text=row_text,
        release_time=release_time,
        allow_open_ended_effective_date=True,
    )
    return row_single_dates or parent_service_date_ranges


def _looks_like_open_ended_effective_date(row_text: str) -> bool:
    compact = "".join(str(row_text or "").split())
    return any(marker in compact for marker in ("日起", "日开始", "日执行", "日生效"))


def _extract_rows_from_parent_text(
    *,
    parent_text: str,
    projection_entry: NoticeConsumptionProjectionEntry,
    source_ref: str,
) -> list[NoticeDerivedTransportScheduleRow]:
    rows: list[NoticeDerivedTransportScheduleRow] = []
    for segment in _text_segments(parent_text):
        if reservation_open_time_segment(segment):
            continue
        if _contains_service_stop(segment):
            continue
        if not _extract_times(segment):
            continue
        route = _resolve_route(segment)
        if route is None:
            continue
        service_date_ranges = _resolve_segment_service_date_ranges(
            text=segment,
            release_time=projection_entry.source_notice_release_time,
            allow_open_ended_effective_date=False,
        )
        effective_from = (
            service_date_ranges[0][0]
            if service_date_ranges
            else _resolve_effective_date(
                text=f"{parent_text}\n{segment}",
                release_time=projection_entry.source_notice_release_time,
            )
        )
        schedule_scope = _resolve_schedule_scope(
            parent_text=parent_text,
            row_text=segment,
            service_date_ranges=service_date_ranges,
        )
        for departure_time in _extract_times(segment):
            rows.append(
                NoticeDerivedTransportScheduleRow(
                    source_notice_id=projection_entry.source_notice_id,
                    source_ref=source_ref,
                    source_attachment_document_id=projection_entry.source_notice_document_id,
                    weekday_scope=_resolve_weekday_scope(segment, route.default_calendar),
                    route_direction=_route_direction(route.route_id),
                    route_id=route.route_id,
                    departure_time=departure_time,
                    rider_type=_resolve_rider_type(segment),
                    remarks=_clean_cell(segment),
                    effective_from=effective_from,
                    schedule_scope=schedule_scope,
                    service_date_ranges=service_date_ranges,
                    precedence=_schedule_scope_precedence(schedule_scope),
                )
            )
    return rows


def _extract_rows_from_body_schedule(
    *,
    parent_text: str,
    projection_entry: NoticeConsumptionProjectionEntry,
    source_ref: str,
) -> list[NoticeDerivedTransportScheduleRow]:
    extraction = extract_schedule_from_notice_body(
        ScheduleNoticeBody(
            notice_id=projection_entry.source_notice_id,
            notice_title=str(projection_entry.role_metadata.get("notice_title") or ""),
            release_time=projection_entry.source_notice_release_time,
            organization=str(projection_entry.role_metadata.get("organization_name") or ""),
            context_before=parent_text,
            context_after="",
        )
    )
    if extraction.status != "extracted":
        return []
    service_date_ranges = resolve_body_schedule_service_date_ranges(
        extraction_service_window=extraction.service_window,
        parent_text=parent_text,
        release_time=projection_entry.source_notice_release_time,
    )
    rows: list[NoticeDerivedTransportScheduleRow] = []
    for body_row in extraction.rows:
        row_text = body_schedule_row_text(body_row)
        route = _resolve_route(str(body_row.get("route_text") or row_text))
        if route is None:
            continue
        effective_from = (
            service_date_ranges[0][0]
            if service_date_ranges
            else _resolve_effective_date(
                text=f"{parent_text}\n{row_text}",
                release_time=projection_entry.source_notice_release_time,
            )
        )
        schedule_scope = _resolve_schedule_scope(
            parent_text=parent_text,
            row_text=row_text,
            service_date_ranges=service_date_ranges,
        )
        rows.append(
            NoticeDerivedTransportScheduleRow(
                source_notice_id=projection_entry.source_notice_id,
                source_ref=source_ref,
                source_attachment_document_id=projection_entry.source_notice_document_id,
                weekday_scope=_resolve_weekday_scope(
                    f"{parent_text}\n{row_text}", route.default_calendar
                ),
                route_direction=_route_direction(route.route_id),
                route_id=route.route_id,
                departure_time=str(body_row["departure_time"]),
                rider_type=_resolve_rider_type(f"{parent_text}\n{row_text}"),
                remarks=body_schedule_row_remarks(body_row),
                effective_from=effective_from,
                schedule_scope=schedule_scope,
                service_date_ranges=service_date_ranges,
                precedence=_schedule_scope_precedence(schedule_scope),
            )
        )
    return rows


def _extract_exceptions_from_parent_text(
    *,
    parent_text: str,
    projection_entry: NoticeConsumptionProjectionEntry,
    source_ref: str,
) -> list[NoticeDerivedTransportServiceException]:
    exceptions: list[NoticeDerivedTransportServiceException] = []
    for segment in _text_segments(parent_text):
        if _MARKDOWN_HEADING_RE.match(segment):
            continue
        for clause in _service_stop_clauses(segment):
            route = _resolve_route(clause)
            if route is None:
                continue
            service_date_ranges = _resolve_segment_service_date_ranges(
                text=clause,
                release_time=projection_entry.source_notice_release_time,
                allow_open_ended_effective_date=True,
            )
            if not service_date_ranges:
                continue
            for start_date, end_date in service_date_ranges:
                for service_date in _date_range(
                    date.fromisoformat(start_date),
                    (date.fromisoformat(end_date) - date.fromisoformat(start_date)).days + 1,
                ):
                    exceptions.append(
                        NoticeDerivedTransportServiceException(
                            source_notice_id=projection_entry.source_notice_id,
                            source_ref=source_ref,
                            route_id=route.route_id,
                            service_date=service_date.isoformat(),
                            service_status="temporarily_suspended",
                            operational_comment=_clean_cell(clause),
                            effective_from=start_date,
                            schedule_scope="exception_status",
                            service_date_ranges=((start_date, end_date),),
                            precedence=_schedule_scope_precedence("exception_status"),
                        )
                    )
    return exceptions


def _contains_service_stop(segment: str) -> bool:
    return any(keyword in segment for keyword in _SERVICE_STOP_KEYWORDS)


def _service_stop_clauses(segment: str) -> tuple[str, ...]:
    clauses: list[str] = []
    date_context = ""
    for raw_clause in re.split(r"[，,]", segment):
        clause = _clean_cell(raw_clause)
        if not clause:
            continue
        if _clause_contains_date(clause):
            date_context = clause
        if not _contains_service_stop(clause):
            continue
        if "正常运营" in clause or "正常运行" in clause:
            continue
        if not _clause_contains_date(clause) and date_context:
            clause = _clean_cell(f"{date_context} {clause}")
        clauses.append(clause)
    return tuple(clauses)


def _clause_contains_date(clause: str) -> bool:
    return bool(
        _FULL_DATE_RE.search(clause)
        or _YEARLESS_SINGLE_DATE_RE.search(clause)
        or _CHINESE_DATE_RANGE_RE.search(clause)
    )


def _fill_down_context(
    matrix: tuple[tuple[str, ...], ...],
) -> tuple[tuple[str, ...], ...]:
    max_width = max((len(row) for row in matrix), default=0)
    previous = ["" for _index in range(max_width)]
    last_route_context: tuple[str, ...] | None = None
    filled: list[tuple[str, ...]] = []
    for raw_row in matrix:
        row = list(raw_row) + ["" for _index in range(max_width - len(raw_row))]
        next_row: list[str] = []
        for index, cell in enumerate(row):
            normalized = _clean_cell(cell)
            if normalized:
                previous[index] = normalized
                next_row.append(normalized)
            elif index <= 1:
                next_row.append(previous[index])
            else:
                next_row.append("")
        normalized_row = tuple(next_row)
        if (
            last_route_context is not None
            and _extract_times(" ".join(normalized_row))
            and _resolve_route(" ".join(normalized_row)) is None
        ):
            normalized_row = _normalize_left_shifted_continuation_row(
                row=normalized_row,
                context=last_route_context,
                max_width=max_width,
            )
        if _resolve_route(" ".join(normalized_row)) is not None:
            last_route_context = normalized_row
        filled.append(normalized_row)
    return tuple(filled)


def _normalize_left_shifted_continuation_row(
    *,
    row: tuple[str, ...],
    context: tuple[str, ...],
    max_width: int,
) -> tuple[str, ...]:
    cells = [cell for cell in row if cell and not _ORDINAL_RE.fullmatch(cell)]
    time_cell = next((cell for cell in cells if _extract_times(cell)), "")
    rider_cell = next(
        (cell for cell in cells if cell != time_cell and _resolve_rider_type(cell)),
        "",
    )
    remarks = "；".join(
        cell for cell in cells if cell not in {time_cell, rider_cell} and not _extract_times(cell)
    )
    normalized = [
        context[0] if len(context) > 0 else "",
        context[1] if len(context) > 1 else "",
        context[2] if len(context) > 2 else "",
        time_cell,
        rider_cell,
        remarks,
    ]
    return tuple(normalized[:max_width] + ["" for _index in range(max_width - len(normalized))])
