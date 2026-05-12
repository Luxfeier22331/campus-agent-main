from __future__ import annotations

import hashlib
import re
from dataclasses import asdict, dataclass
from datetime import date, datetime, time, timedelta, timezone
from html.parser import HTMLParser
from typing import Any

from campus_ingestion_core.transport_schedule_projection import (
    TRANSPORT_SCHEDULE_PROJECTION_SCHEMA_VERSION,
    validate_transport_schedule_projection_bundle,
)
from campus_ingestion_core.transport_schedule_projection_routes import (
    TRANSPORT_ROUTES,
    route_by_id,
    route_payload,
)

OFFICIAL_TRANSPORT_BASELINE_SCHEMA_VERSION = "official_transport_baseline_preview.v1"

_SHANGHAI_TZ = timezone(timedelta(hours=8))
_TIME_RE = re.compile(r"(?<!\d)([01]?\d|2[0-3])[:：]([0-5]\d)(?!\d)")
_YEARLESS_EFFECTIVE_RE = re.compile(r"(\d{1,2})月(\d{1,2})日(?:起|开始|执行|生效)")
_FULL_EFFECTIVE_RE = re.compile(
    r"(20\d{2})[年\-/\.](\d{1,2})[月\-/\.](\d{1,2})日?(?:起|开始|执行|生效)"
)


@dataclass(frozen=True, slots=True)
class OfficialTransportBaselineRow:
    row_id: str
    service_date_policy: str
    route_direction: str
    route_id: str
    sequence: int
    departure_time: str
    rider_type: str
    note: str
    effective_from: str
    source_kind: str = "official_baseline"


def build_official_transport_baseline_preview(
    *,
    ocr_plain_text: str,
    baseline_reference_date: str,
    generated_at: str,
    source_ref: str,
    provider: str,
    model: str,
    provider_batch_id: str = "",
    service_horizon_days: int = 90,
) -> dict[str, Any]:
    effective_from = _resolve_effective_from(
        text=ocr_plain_text,
        baseline_reference_date=baseline_reference_date,
    )
    rows = _parse_baseline_rows(
        ocr_plain_text=ocr_plain_text,
        effective_from=effective_from,
    )
    projection_bundle = _build_projection_bundle(
        rows=rows,
        source_ref=source_ref,
        generated_at=generated_at,
        effective_from=effective_from,
        service_horizon_days=service_horizon_days,
    )
    validation = validate_transport_schedule_projection_bundle(projection_bundle)
    consistency = _consistency_report(rows=rows, validation_issues=validation.issues)
    normalized_text = ocr_plain_text.strip()
    return {
        "schema_version": OFFICIAL_TRANSPORT_BASELINE_SCHEMA_VERSION,
        "mode": "dry_run",
        "write_enabled": False,
        "current_promotion_enabled": False,
        "generated_at": generated_at,
        "baseline": {
            "source_kind": "official_baseline",
            "reference_date": baseline_reference_date,
            "effective_from": effective_from,
            "source_ref": source_ref,
            "source_truth_status": "local_probe_not_mirrored",
        },
        "ocr": {
            "provider": provider,
            "model": model,
            "provider_batch_id": provider_batch_id,
            "plain_text_length": len(normalized_text),
            "plain_text_sha256": hashlib.sha256(normalized_text.encode("utf-8")).hexdigest(),
        },
        "counts": {
            "canonical_row_count": len(rows),
            "route_count": len({row.route_id for row in rows}),
            "scheduled_departure_count": len(projection_bundle["scheduled_departures"]),
            "validation_issue_count": len(validation.issues),
        },
        "canonical_rows": [asdict(row) for row in rows],
        "projection_bundle": projection_bundle,
        "projection_validation": asdict(validation),
        "consistency": consistency,
    }


def _parse_baseline_rows(
    *,
    ocr_plain_text: str,
    effective_from: str,
) -> tuple[OfficialTransportBaselineRow, ...]:
    tables = _TableParser.parse_tables(ocr_plain_text)
    if not tables:
        return ()
    table = max(tables, key=len)
    rows: list[OfficialTransportBaselineRow] = []
    data_rows = table[1:] if table and _looks_like_header(table[0]) else table
    for raw_row in data_rows:
        cells = [cell.strip() for cell in raw_row]
        if len(cells) < 6:
            continue
        service_policy = _service_date_policy(cells[0])
        route_id = _route_id(cells[1])
        departure_time = _departure_time(cells[3])
        if not service_policy or not route_id or not departure_time:
            continue
        row_index = len(rows) + 1
        rows.append(
            OfficialTransportBaselineRow(
                row_id=f"official-baseline-row-{row_index:03d}",
                service_date_policy=service_policy,
                route_direction=_route_direction(route_id),
                route_id=route_id,
                sequence=_int_or_position(cells[2], default_value=row_index),
                departure_time=departure_time,
                rider_type=_rider_type(cells[4]),
                note=cells[5],
                effective_from=effective_from,
            )
        )
    return tuple(rows)


class _TableParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.tables: list[list[list[str]]] = []
        self._active_table: list[list[str]] | None = None
        self._active_row: list[str] | None = None
        self._pending_spans: dict[int, dict[str, int | str]] = {}
        self._cell_text: list[str] | None = None
        self._cell_col = 0
        self._cell_rowspan = 1
        self._cell_colspan = 1
        self._col_index = 0

    @classmethod
    def parse_tables(cls, value: str) -> list[list[list[str]]]:
        parser = cls()
        parser.feed(value)
        return parser.tables

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag == "table":
            self._active_table = []
            self._pending_spans = {}
            return
        if tag == "tr" and self._active_table is not None:
            self._active_row = []
            self._col_index = 0
            return
        if tag in {"td", "th"} and self._active_row is not None:
            self._fill_pending_spans_before_cell()
            attrs_map = dict(attrs)
            self._cell_text = []
            self._cell_col = self._col_index
            self._cell_rowspan = _positive_int(attrs_map.get("rowspan"), default=1)
            self._cell_colspan = _positive_int(attrs_map.get("colspan"), default=1)

    def handle_data(self, data: str) -> None:
        if self._cell_text is not None:
            self._cell_text.append(data)

    def handle_endtag(self, tag: str) -> None:
        if tag in {"td", "th"} and self._cell_text is not None and self._active_row is not None:
            value = " ".join("".join(self._cell_text).split())
            for offset in range(self._cell_colspan):
                self._active_row.append(value)
                if self._cell_rowspan > 1:
                    self._pending_spans[self._cell_col + offset] = {
                        "value": value,
                        "remaining": self._cell_rowspan - 1,
                    }
            self._col_index += self._cell_colspan
            self._cell_text = None
            return
        if tag == "tr" and self._active_table is not None and self._active_row is not None:
            self._fill_trailing_spans()
            if self._active_row:
                self._active_table.append(self._active_row)
            self._active_row = None
            return
        if tag == "table" and self._active_table is not None:
            self.tables.append(self._active_table)
            self._active_table = None

    def _fill_pending_spans_before_cell(self) -> None:
        while self._col_index in self._pending_spans and self._active_row is not None:
            self._consume_span(self._col_index)
            self._col_index += 1

    def _fill_trailing_spans(self) -> None:
        if not self._pending_spans:
            return
        max_col = max(self._pending_spans)
        while self._col_index <= max_col and self._active_row is not None:
            if self._col_index in self._pending_spans:
                self._consume_span(self._col_index)
            self._col_index += 1

    def _consume_span(self, column: int) -> None:
        if self._active_row is None:
            return
        span = self._pending_spans[column]
        self._active_row.append(str(span["value"]))
        remaining = int(span["remaining"]) - 1
        if remaining <= 0:
            del self._pending_spans[column]
        else:
            span["remaining"] = remaining


def _build_projection_bundle(
    *,
    rows: tuple[OfficialTransportBaselineRow, ...],
    source_ref: str,
    generated_at: str,
    effective_from: str,
    service_horizon_days: int,
) -> dict[str, Any]:
    snapshot_id = f"snapshot:transport-schedule:official-baseline:{effective_from}"
    effective_datetime = datetime.combine(
        date.fromisoformat(effective_from), time.min, _SHANGHAI_TZ
    )
    snapshot = {
        "snapshot_id": snapshot_id,
        "published_at": _rfc3339(generated_at),
        "effective_from": effective_datetime.isoformat(),
        "effective_until": "",
        "source_ref": source_ref,
        "source_kind": "official_baseline",
        "schedule_scope": "baseline_revision",
        "service_date_ranges": [],
        "is_current": True,
    }
    anchor_date = datetime.fromisoformat(generated_at.replace("Z", "+00:00")).date()
    start_date = max(anchor_date, date.fromisoformat(effective_from))
    departures = []
    for row in rows:
        route = route_by_id(row.route_id)
        departures.append(
            {
                "snapshot_id": snapshot_id,
                "route_id": row.route_id,
                "service_dates": _service_dates(
                    start_date=start_date,
                    days=service_horizon_days,
                    service_date_policy=row.service_date_policy,
                ),
                "departure_time": row.departure_time,
                "arrival_time": "",
                "origin_stop_id": route.origin_stop_id,
                "destination_stop_id": route.destination_stop_id,
                "related_notice_refs": [source_ref],
                "operational_comment": _operational_comment(row),
                "source_kind": "official_baseline",
                "rider_type": row.rider_type,
                "service_date_policy": row.service_date_policy,
            }
        )
    return {
        "schema_version": TRANSPORT_SCHEDULE_PROJECTION_SCHEMA_VERSION,
        "service_status_records": [],
        "transport_schedule_snapshots": [snapshot],
        "transport_routes": [route_payload(route) for route in TRANSPORT_ROUTES],
        "scheduled_departures": departures,
        "transport_service_exceptions": [],
        "transport_operational_notices": [],
        "transport_rejected_sources": [],
    }


def _service_dates(*, start_date: date, days: int, service_date_policy: str) -> list[str]:
    return [
        candidate.isoformat()
        for offset in range(days)
        for candidate in (start_date + timedelta(days=offset),)
        if _matches_policy(candidate, service_date_policy)
    ]


def _matches_policy(candidate: date, service_date_policy: str) -> bool:
    if service_date_policy == "weekdays":
        return candidate.weekday() < 5
    if service_date_policy == "weekends_and_holidays":
        return candidate.weekday() >= 5
    return True


def _consistency_report(
    *,
    rows: tuple[OfficialTransportBaselineRow, ...],
    validation_issues: list[dict[str, Any]],
) -> dict[str, Any]:
    issues: list[dict[str, Any]] = []
    if not rows:
        issues.append({"field": "canonical_rows", "reason": "empty"})
    if validation_issues:
        issues.append({"field": "projection_bundle", "reason": "validation_failed"})
    if any(not row.departure_time for row in rows):
        issues.append({"field": "departure_time", "reason": "empty"})
    return {
        "schema_version": "official_transport_baseline_consistency.v1",
        "verdict": "passed" if not issues else "blocked",
        "issues": issues,
    }


def _resolve_effective_from(*, text: str, baseline_reference_date: str) -> str:
    full_match = _FULL_EFFECTIVE_RE.search(text)
    if full_match is not None:
        return date(
            int(full_match.group(1)),
            int(full_match.group(2)),
            int(full_match.group(3)),
        ).isoformat()
    year = date.fromisoformat(baseline_reference_date).year
    yearless_match = _YEARLESS_EFFECTIVE_RE.search(text)
    if yearless_match is not None:
        return date(year, int(yearless_match.group(1)), int(yearless_match.group(2))).isoformat()
    return baseline_reference_date


def _looks_like_header(row: list[str]) -> bool:
    compact = "".join(row)
    return "发车时间" in compact and "线路" in compact


def _service_date_policy(value: str) -> str:
    if "周一至周五" in value or "星期一至星期五" in value:
        return "weekdays"
    if "周六" in value or "周日" in value or "节假日" in value:
        return "weekends_and_holidays"
    return ""


def _route_id(value: str) -> str:
    compact = "".join(value.split())
    if "海淀" in compact and "丰台" in compact:
        return (
            "route:haidian-to-fengtai"
            if compact.find("海淀") < compact.find("丰台")
            else "route:fengtai-to-haidian"
        )
    return ""


def _route_direction(route_id: str) -> str:
    return {
        "route:haidian-to-fengtai": "haidian_to_fengtai",
        "route:fengtai-to-haidian": "fengtai_to_haidian",
    }.get(route_id, "")


def _departure_time(value: str) -> str:
    match = _TIME_RE.search(value)
    if match is None:
        return ""
    return f"{int(match.group(1)):02d}:{match.group(2)}"


def _rider_type(value: str) -> str:
    if "教师" in value:
        return "教师"
    if "学生" in value:
        return "学生"
    return value.strip()


def _int_or_position(value: str, *, default_value: int) -> int:
    try:
        return int(re.sub(r"\D+", "", value))
    except ValueError:
        return default_value


def _positive_int(value: str | None, *, default: int) -> int:
    try:
        parsed = int(str(value or ""))
    except ValueError:
        return default
    return max(1, parsed)


def _operational_comment(row: OfficialTransportBaselineRow) -> str:
    parts = [f"乘车人员：{row.rider_type}" if row.rider_type else "", row.note]
    return "；".join(part for part in parts if part)


def _rfc3339(value: str) -> str:
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=_SHANGHAI_TZ)
    return parsed.astimezone(_SHANGHAI_TZ).isoformat()


__all__ = [
    "OFFICIAL_TRANSPORT_BASELINE_SCHEMA_VERSION",
    "OfficialTransportBaselineRow",
    "build_official_transport_baseline_preview",
]
