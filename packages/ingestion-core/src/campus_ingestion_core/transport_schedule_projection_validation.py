from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import UTC, date, datetime, timedelta, timezone
from typing import Any

TRANSPORT_SCHEDULE_PROJECTION_SCHEMA_VERSION = "campus_services_projection_bundle.v1"
TRANSPORT_SCHEDULE_VALIDATION_REPORT_SCHEMA_VERSION = (
    "transport_schedule_projection_validation_report.v1"
)

_SHANGHAI_TZ = timezone(timedelta(hours=8))
_TIME_RE = re.compile(r"(?<!\d)([01]?\d|2[0-3])[:：]([0-5]\d)(?!\d)")


@dataclass(frozen=True, slots=True)
class TransportScheduleProjectionValidationReport:
    schema_version: str
    valid: bool
    issues: list[dict[str, Any]]
    counts: dict[str, int]


def validate_transport_schedule_projection_bundle(
    bundle: dict[str, Any],
) -> TransportScheduleProjectionValidationReport:
    issues: list[dict[str, Any]] = []
    if bundle.get("schema_version") != TRANSPORT_SCHEDULE_PROJECTION_SCHEMA_VERSION:
        issues.append(_issue("schema_version", "unsupported transport schedule projection schema"))

    snapshots = _list_of_dicts(bundle.get("transport_schedule_snapshots"))
    routes = _list_of_dicts(bundle.get("transport_routes"))
    departures = _list_of_dicts(bundle.get("scheduled_departures"))
    exceptions = _list_of_dicts(bundle.get("transport_service_exceptions"))
    operational_notices = _list_of_dicts(bundle.get("transport_operational_notices"))
    rejected_sources = _list_of_dicts(bundle.get("transport_rejected_sources"))

    current_count = sum(1 for row in snapshots if bool(row.get("is_current")))
    if current_count > 1:
        issues.append(
            _issue("transport_schedule_snapshots", "multiple current transport schedule snapshots")
        )
    if snapshots and current_count == 0:
        issues.append(
            _issue(
                "transport_schedule_snapshots", "current transport schedule snapshot is required"
            )
        )

    snapshot_ids = _unique_required(
        snapshots,
        "snapshot_id",
        "transport_schedule_snapshots",
        issues,
    )
    source_refs: set[str] = set()
    for index, snapshot in enumerate(snapshots):
        path = f"transport_schedule_snapshots[{index}]"
        _validate_required_rfc3339(snapshot, "published_at", path, issues)
        _validate_optional_rfc3339(snapshot, "effective_from", path, issues)
        _validate_optional_rfc3339(snapshot, "effective_until", path, issues)
        source_ref = _required_text(snapshot.get("source_ref"))
        if source_ref is None:
            issues.append(_issue(f"{path}.source_ref", "source_ref is required"))
        else:
            source_refs.add(source_ref)
        schedule_scope = _required_text(snapshot.get("schedule_scope"))
        service_date_ranges = _list_of_dicts(snapshot.get("service_date_ranges"))
        if (
            schedule_scope in {"temporary_period", "temporary_period_revision"}
            and not service_date_ranges
        ):
            issues.append(
                _issue(
                    f"{path}.service_date_ranges",
                    "bounded transport schedule overlay requires service_date_ranges",
                )
            )
        for range_index, service_date_range in enumerate(service_date_ranges):
            range_path = f"{path}.service_date_ranges[{range_index}]"
            _validate_date(
                service_date_range.get("start_date"),
                f"{range_path}.start_date",
                issues,
            )
            _validate_date(
                service_date_range.get("end_date"),
                f"{range_path}.end_date",
                issues,
            )

    route_ids = _unique_required(routes, "route_id", "transport_routes", issues)
    stop_ids: set[str] = set()
    for route_index, route in enumerate(routes):
        route_path = f"transport_routes[{route_index}]"
        for field in (
            "display_name",
            "service_family",
            "origin_campus",
            "destination_campus",
        ):
            if _required_text(route.get(field)) is None:
                issues.append(_issue(f"{route_path}.{field}", f"{field} is required"))
        for stop_index, stop in enumerate(_list_of_dicts(route.get("stops"))):
            stop_path = f"{route_path}.stops[{stop_index}]"
            stop_id = _required_text(stop.get("stop_id"))
            if stop_id is None:
                issues.append(_issue(f"{stop_path}.stop_id", "stop_id is required"))
                continue
            stop_ids.add(stop_id)
            if _required_text(stop.get("display_name")) is None:
                issues.append(_issue(f"{stop_path}.display_name", "display_name is required"))

    for index, departure in enumerate(departures):
        path = f"scheduled_departures[{index}]"
        _validate_reference(departure, "snapshot_id", snapshot_ids, path, issues)
        _validate_reference(departure, "route_id", route_ids, path, issues)
        _validate_reference(departure, "origin_stop_id", stop_ids, path, issues)
        _validate_reference(departure, "destination_stop_id", stop_ids, path, issues)
        _validate_time(departure.get("departure_time"), f"{path}.departure_time", issues)
        if _required_text(departure.get("arrival_time")) is not None:
            _validate_time(departure.get("arrival_time"), f"{path}.arrival_time", issues)
        service_dates = departure.get("service_dates")
        if not isinstance(service_dates, list) or not service_dates:
            issues.append(
                _issue(f"{path}.service_dates", "service_dates must be a non-empty array")
            )
        else:
            for service_date in service_dates:
                _validate_date(service_date, f"{path}.service_dates[]", issues)
        for source_ref in _string_list(departure.get("related_notice_refs")):
            if source_ref not in source_refs:
                issues.append(
                    _issue(f"{path}.related_notice_refs", f"unknown source_ref: {source_ref}")
                )

    for index, exception in enumerate(exceptions):
        path = f"transport_service_exceptions[{index}]"
        _validate_reference(exception, "snapshot_id", snapshot_ids, path, issues)
        _validate_reference(exception, "route_id", route_ids, path, issues)
        _validate_date(exception.get("service_date"), f"{path}.service_date", issues)
        if _required_text(exception.get("service_status")) not in {
            "temporarily_suspended",
            "limited_service",
            "not_running",
        }:
            issues.append(_issue(f"{path}.service_status", "unsupported service_status"))
        related_notice_refs = _string_list(exception.get("related_notice_refs"))
        if not related_notice_refs:
            issues.append(_issue(f"{path}.related_notice_refs", "related_notice_refs is required"))

    return TransportScheduleProjectionValidationReport(
        schema_version=TRANSPORT_SCHEDULE_VALIDATION_REPORT_SCHEMA_VERSION,
        valid=not issues,
        issues=issues,
        counts={
            "snapshots": len(snapshots),
            "routes": len(routes),
            "scheduled_departures": len(departures),
            "service_exceptions": len(exceptions),
            "operational_notices": len(operational_notices),
            "rejected_sources": len(rejected_sources),
        },
    )


def _parse_rfc3339(value: str, field_name: str) -> datetime:
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError as exc:
        raise ValueError(f"{field_name} must be RFC3339 datetime") from exc
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=UTC)
    return parsed.astimezone(_SHANGHAI_TZ)


def _list_of_dicts(value: object) -> list[dict[str, Any]]:
    if not isinstance(value, list):
        return []
    return [dict(item) for item in value if isinstance(item, dict)]


def _require_mapping(value: object, field_name: str) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise ValueError(f"{field_name} must be an object")
    return dict(value)


def _require_blocks(value: object) -> list[dict[str, Any]]:
    if not isinstance(value, list):
        raise ValueError("content_blocks must be an array")
    return [dict(item) for item in value if isinstance(item, dict)]


def _unique_required(
    rows: list[dict[str, Any]],
    field: str,
    prefix: str,
    issues: list[dict[str, Any]],
) -> set[str]:
    seen: set[str] = set()
    values: set[str] = set()
    for index, row in enumerate(rows):
        value = _required_text(row.get(field))
        if value is None:
            issues.append(_issue(f"{prefix}[{index}].{field}", f"{field} is required"))
            continue
        if value in seen:
            issues.append(_issue(f"{prefix}[{index}].{field}", f"duplicate {field}: {value}"))
        seen.add(value)
        values.add(value)
    return values


def _validate_reference(
    row: dict[str, Any],
    field: str,
    allowed: set[str],
    path: str,
    issues: list[dict[str, Any]],
) -> None:
    value = _required_text(row.get(field))
    if value is None:
        issues.append(_issue(f"{path}.{field}", f"{field} is required"))
    elif value not in allowed:
        issues.append(_issue(f"{path}.{field}", f"unknown {field}: {value}"))


def _validate_required_rfc3339(
    row: dict[str, Any],
    field: str,
    path: str,
    issues: list[dict[str, Any]],
) -> None:
    value = _required_text(row.get(field))
    if value is None:
        issues.append(_issue(f"{path}.{field}", f"{field} is required"))
        return
    _validate_rfc3339_text(value, f"{path}.{field}", issues)


def _validate_optional_rfc3339(
    row: dict[str, Any],
    field: str,
    path: str,
    issues: list[dict[str, Any]],
) -> None:
    value = _required_text(row.get(field))
    if value is not None:
        _validate_rfc3339_text(value, f"{path}.{field}", issues)


def _validate_rfc3339_text(value: str, path: str, issues: list[dict[str, Any]]) -> None:
    try:
        _parse_rfc3339(value, path)
    except ValueError:
        issues.append(_issue(path, "datetime must be RFC3339"))


def _validate_time(value: object, path: str, issues: list[dict[str, Any]]) -> None:
    normalized = _required_text(value)
    if normalized is None or _TIME_RE.fullmatch(normalized) is None:
        issues.append(_issue(path, "time must be HH:MM"))


def _validate_date(value: object, path: str, issues: list[dict[str, Any]]) -> None:
    normalized = _required_text(value)
    if normalized is None:
        issues.append(_issue(path, "date is required"))
        return
    try:
        date.fromisoformat(normalized)
    except ValueError:
        issues.append(_issue(path, "date must be YYYY-MM-DD"))


def _string_list(value: object) -> list[str]:
    if not isinstance(value, list):
        return []
    return [str(item).strip() for item in value if str(item).strip()]


def _required_text(value: object) -> str | None:
    if not isinstance(value, str):
        return None
    normalized = value.strip()
    return normalized or None


def _path_segment(value: str, field_name: str) -> str:
    normalized = str(value or "").strip()
    if not normalized:
        raise ValueError(f"{field_name} is required")
    if "/" in normalized:
        raise ValueError(f"{field_name} must not contain slash")
    return normalized


def _issue(path: str, message: str) -> dict[str, Any]:
    return {"path": path, "message": message}
