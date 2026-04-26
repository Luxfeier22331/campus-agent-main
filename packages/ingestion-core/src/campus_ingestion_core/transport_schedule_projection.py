from __future__ import annotations

import json
import re
from dataclasses import asdict, dataclass
from datetime import UTC, date, datetime, time, timedelta, timezone
from pathlib import Path
from typing import Any, Protocol

from campus_ingestion_core.object_store import build_index_release_artifact_key
from campus_ingestion_core.transport_schedule_projection_routes import (
    TRANSPORT_ROUTES,
    exception_comment,
    route_by_id,
    route_has_alias,
    route_payload,
    route_segments,
)

TRANSPORT_SCHEDULE_PROJECTION_SCHEMA_VERSION = "campus_services_projection_bundle.v1"
TRANSPORT_SCHEDULE_VALIDATION_REPORT_SCHEMA_VERSION = (
    "transport_schedule_projection_validation_report.v1"
)
TRANSPORT_SCHEDULE_RELEASE_MANIFEST_SCHEMA_VERSION = (
    "transport_schedule_projection_release_manifest.v1"
)
TRANSPORT_SCHEDULE_CORPUS = "campus_services"
TRANSPORT_SCHEDULE_COLLECTION = "transport_schedule"
TRANSPORT_SCHEDULE_PROJECTION_FILENAME = "campus-services-projection.json"
TRANSPORT_SCHEDULE_VALIDATION_FILENAME = "validation-summary.json"
TRANSPORT_SCHEDULE_RELEASE_MANIFEST_FILENAME = "release-manifest.json"
DEFAULT_TRANSPORT_SCHEDULE_HORIZON_DAYS = 90

_SHANGHAI_TZ = timezone(timedelta(hours=8))
_TIME_RE = re.compile(r"(?<!\d)([01]?\d|2[0-3])[:：]([0-5]\d)(?!\d)")
_DATE_RE = re.compile(r"(?<!\d)(20\d{2})[年\-/\.](\d{1,2})[月\-/\.](\d{1,2})日?(?!\d)")
_EFFECTIVE_DATE_RE = re.compile(
    r"(?:自|从)?(20\d{2})[年\-/\.](\d{1,2})[月\-/\.](\d{1,2})日?(?:起|开始|执行|生效)"
)
_SCHEDULE_KEYWORDS = ("校车", "班车", "通勤车", "接驳车", "时刻表", "发车")
_EXCEPTION_KEYWORDS = ("停运", "暂停", "临时调整", "调整")


class TransportScheduleProjectionObjectStore(Protocol):
    def put_bytes(
        self,
        *,
        bucket: str,
        key: str,
        data: bytes,
        content_type: str,
    ) -> None: ...


@dataclass(frozen=True, slots=True)
class TransportScheduleProjectionBuildResult:
    bundle: dict[str, Any]
    validation_report: TransportScheduleProjectionValidationReport
    manual_review_sources: list[dict[str, Any]]


@dataclass(frozen=True, slots=True)
class TransportScheduleProjectionValidationReport:
    schema_version: str
    valid: bool
    issues: list[dict[str, Any]]
    counts: dict[str, int]


@dataclass(frozen=True, slots=True)
class TransportScheduleProjectionReleaseReport:
    schema_version: str
    release_id: str
    generated_at: str
    projection_path: str
    current_projection_path: str
    release_object_key: str
    current_object_key: str
    validation_summary_path: str
    release_manifest_path: str


@dataclass(frozen=True, slots=True)
class _ScheduleSource:
    source_ref: str
    published_at: str
    effective_from: str
    snapshot_id: str
    route_departures: dict[str, dict[str, Any]]


def build_transport_schedule_projection_bundle(
    *,
    source_truth_parents: tuple[dict[str, Any], ...] | list[dict[str, Any]],
    generated_at: str,
    service_horizon_days: int = DEFAULT_TRANSPORT_SCHEDULE_HORIZON_DAYS,
) -> TransportScheduleProjectionBuildResult:
    anchor = _parse_rfc3339(generated_at, "generated_at")
    if service_horizon_days <= 0:
        raise ValueError("service_horizon_days must be positive")

    manual_review_sources: list[dict[str, Any]] = []
    schedule_sources: list[_ScheduleSource] = []
    exception_candidates: list[dict[str, Any]] = []
    for parent in source_truth_parents:
        manifest = _require_mapping(parent.get("notice_manifest"), "notice_manifest")
        blocks = _require_blocks(parent.get("content_blocks"))
        source_ref = _source_ref(manifest)
        text = _source_text(manifest=manifest, blocks=blocks)
        if not _contains_any(text, _SCHEDULE_KEYWORDS + _EXCEPTION_KEYWORDS):
            continue
        if _contains_any(text, _EXCEPTION_KEYWORDS):
            exceptions = _extract_exception_candidates(
                source_ref=source_ref,
                text=text,
            )
            if exceptions:
                exception_candidates.extend(exceptions)
                continue
        parsed = _extract_schedule_source(
            manifest=manifest,
            text=text,
            source_ref=source_ref,
        )
        if parsed is None:
            manual_review_sources.append(
                {
                    "source_ref": source_ref,
                    "reason": "unsupported_transport_schedule_notice_shape",
                }
            )
            continue
        schedule_sources.append(parsed)

    schedule_sources = sorted(schedule_sources, key=lambda item: item.published_at)
    current_snapshot_id = schedule_sources[-1].snapshot_id if schedule_sources else ""
    snapshots = [
        {
            "snapshot_id": source.snapshot_id,
            "published_at": source.published_at,
            "effective_from": source.effective_from,
            "effective_until": "",
            "source_ref": source.source_ref,
            "is_current": source.snapshot_id == current_snapshot_id,
        }
        for source in schedule_sources
    ]
    scheduled_departures = _build_departures(
        schedule_sources=schedule_sources,
        anchor=anchor,
        service_horizon_days=service_horizon_days,
    )
    exceptions = _build_exceptions(
        exception_candidates=exception_candidates,
        current_snapshot_id=current_snapshot_id,
    )
    bundle = {
        "schema_version": TRANSPORT_SCHEDULE_PROJECTION_SCHEMA_VERSION,
        "service_status_records": [],
        "transport_schedule_snapshots": snapshots,
        "transport_routes": [route_payload(route) for route in TRANSPORT_ROUTES],
        "scheduled_departures": scheduled_departures,
        "transport_service_exceptions": exceptions,
    }
    validation_report = validate_transport_schedule_projection_bundle(bundle)
    return TransportScheduleProjectionBuildResult(
        bundle=bundle,
        validation_report=validation_report,
        manual_review_sources=manual_review_sources,
    )


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
        },
    )


def write_transport_schedule_projection_release(
    *,
    bundle: dict[str, Any],
    output_dir: Path,
    release_id: str,
    generated_at: str,
    object_store: TransportScheduleProjectionObjectStore | None = None,
    bucket: str | None = None,
) -> TransportScheduleProjectionReleaseReport:
    normalized_release_id = _path_segment(release_id, "release_id")
    output_root = Path(output_dir)
    release_dir = output_root / normalized_release_id
    current_dir = output_root / "current"
    release_dir.mkdir(parents=True, exist_ok=True)
    current_dir.mkdir(parents=True, exist_ok=True)

    bundle_bytes = _json_bytes(bundle)
    validation_report = validate_transport_schedule_projection_bundle(bundle)
    validation_payload = asdict(validation_report)
    release_object_key = build_index_release_artifact_key(
        corpus=TRANSPORT_SCHEDULE_CORPUS,
        collection=TRANSPORT_SCHEDULE_COLLECTION,
        release_id=normalized_release_id,
        filename=TRANSPORT_SCHEDULE_PROJECTION_FILENAME,
    )
    current_object_key = build_index_release_artifact_key(
        corpus=TRANSPORT_SCHEDULE_CORPUS,
        collection=TRANSPORT_SCHEDULE_COLLECTION,
        release_id="current",
        filename=TRANSPORT_SCHEDULE_PROJECTION_FILENAME,
    )
    release_manifest = {
        "schema_version": TRANSPORT_SCHEDULE_RELEASE_MANIFEST_SCHEMA_VERSION,
        "release_id": normalized_release_id,
        "generated_at": generated_at,
        "corpus": TRANSPORT_SCHEDULE_CORPUS,
        "collection": TRANSPORT_SCHEDULE_COLLECTION,
        "projection_object_key": release_object_key,
        "current_projection_object_key": current_object_key,
        "validation_valid": validation_report.valid,
        "counts": dict(validation_report.counts),
    }

    projection_path = release_dir / TRANSPORT_SCHEDULE_PROJECTION_FILENAME
    current_projection_path = current_dir / TRANSPORT_SCHEDULE_PROJECTION_FILENAME
    validation_path = release_dir / TRANSPORT_SCHEDULE_VALIDATION_FILENAME
    manifest_path = release_dir / TRANSPORT_SCHEDULE_RELEASE_MANIFEST_FILENAME
    projection_path.write_bytes(bundle_bytes)
    current_projection_path.write_bytes(bundle_bytes)
    validation_path.write_bytes(_json_bytes(validation_payload))
    manifest_path.write_bytes(_json_bytes(release_manifest))

    if object_store is not None:
        if not bucket:
            raise ValueError("bucket is required when object_store is provided")
        for key, data in (
            (release_object_key, bundle_bytes),
            (current_object_key, bundle_bytes),
            (
                build_index_release_artifact_key(
                    corpus=TRANSPORT_SCHEDULE_CORPUS,
                    collection=TRANSPORT_SCHEDULE_COLLECTION,
                    release_id=normalized_release_id,
                    filename=TRANSPORT_SCHEDULE_VALIDATION_FILENAME,
                ),
                _json_bytes(validation_payload),
            ),
            (
                build_index_release_artifact_key(
                    corpus=TRANSPORT_SCHEDULE_CORPUS,
                    collection=TRANSPORT_SCHEDULE_COLLECTION,
                    release_id=normalized_release_id,
                    filename=TRANSPORT_SCHEDULE_RELEASE_MANIFEST_FILENAME,
                ),
                _json_bytes(release_manifest),
            ),
        ):
            object_store.put_bytes(
                bucket=bucket,
                key=key,
                data=data,
                content_type="application/json",
            )

    return TransportScheduleProjectionReleaseReport(
        schema_version=TRANSPORT_SCHEDULE_RELEASE_MANIFEST_SCHEMA_VERSION,
        release_id=normalized_release_id,
        generated_at=generated_at,
        projection_path=str(projection_path),
        current_projection_path=str(current_projection_path),
        release_object_key=release_object_key,
        current_object_key=current_object_key,
        validation_summary_path=str(validation_path),
        release_manifest_path=str(manifest_path),
    )


def _extract_schedule_source(
    *,
    manifest: dict[str, Any],
    text: str,
    source_ref: str,
) -> _ScheduleSource | None:
    route_departures: dict[str, dict[str, Any]] = {}
    for route, segment in route_segments(text):
        times = _extract_times(segment)
        if not times:
            continue
        calendar = _calendar_from_text(segment, route.default_calendar)
        route_departures[route.route_id] = {
            "times": times,
            "calendar": calendar,
            "related_notice_refs": [source_ref],
        }
    if not route_departures:
        return None
    published_at = _published_at(manifest)
    effective_date = _effective_date(text)
    if effective_date is None:
        return None
    effective_from = datetime.combine(effective_date, time.min, _SHANGHAI_TZ).isoformat()
    return _ScheduleSource(
        source_ref=source_ref,
        published_at=published_at,
        effective_from=effective_from,
        snapshot_id=_snapshot_id(source_ref=source_ref, published_at=published_at),
        route_departures=route_departures,
    )


def _extract_exception_candidates(*, source_ref: str, text: str) -> list[dict[str, Any]]:
    service_date = _first_date(text)
    if service_date is None:
        return []
    exceptions: list[dict[str, Any]] = []
    for route in TRANSPORT_ROUTES:
        if not route_has_alias(route, text):
            continue
        exceptions.append(
            {
                "route_id": route.route_id,
                "service_date": service_date.isoformat(),
                "service_status": "temporarily_suspended"
                if "停运" in text or "暂停" in text
                else "limited_service",
                "related_notice_refs": [source_ref],
                "operational_comment": exception_comment(text, route)[:200],
            }
        )
    return exceptions


def _build_departures(
    *,
    schedule_sources: list[_ScheduleSource],
    anchor: datetime,
    service_horizon_days: int,
) -> list[dict[str, Any]]:
    departures: list[dict[str, Any]] = []
    anchor_date = anchor.date()
    for schedule_source in schedule_sources:
        effective = _parse_rfc3339(schedule_source.effective_from, "effective_from").date()
        start_date = max(anchor_date, effective)
        for route_id, payload in sorted(schedule_source.route_departures.items()):
            route = route_by_id(route_id)
            service_dates = [
                candidate.isoformat()
                for candidate in _date_range(start_date, service_horizon_days)
                if _calendar_matches(candidate, str(payload["calendar"]))
            ]
            for departure_time in payload["times"]:
                departures.append(
                    {
                        "snapshot_id": schedule_source.snapshot_id,
                        "route_id": route.route_id,
                        "service_dates": service_dates,
                        "departure_time": departure_time,
                        "arrival_time": "",
                        "origin_stop_id": route.origin_stop_id,
                        "destination_stop_id": route.destination_stop_id,
                        "related_notice_refs": list(payload["related_notice_refs"]),
                        "operational_comment": "",
                    }
                )
    return departures


def _build_exceptions(
    *,
    exception_candidates: list[dict[str, Any]],
    current_snapshot_id: str,
) -> list[dict[str, Any]]:
    if not current_snapshot_id:
        return []
    exceptions: list[dict[str, Any]] = []
    for candidate in sorted(
        exception_candidates,
        key=lambda item: (
            str(item["service_date"]),
            str(item["route_id"]),
            str(item["related_notice_refs"][0]),
        ),
    ):
        exceptions.append({"snapshot_id": current_snapshot_id, **candidate})
    return exceptions


def _calendar_from_text(value: str, default: str) -> str:
    if any(keyword in value for keyword in ("工作日", "周一至周五", "星期一至星期五")):
        return "weekdays"
    if any(keyword in value for keyword in ("周末", "星期六", "星期日")):
        return "weekends"
    if any(keyword in value for keyword in ("每日", "每天", "周一至周日", "全天")):
        return "daily"
    return default


def _calendar_matches(candidate: date, calendar: str) -> bool:
    if calendar == "weekdays":
        return candidate.weekday() < 5
    if calendar == "weekends":
        return candidate.weekday() >= 5
    return True


def _source_text(*, manifest: dict[str, Any], blocks: list[dict[str, Any]]) -> str:
    parts = [
        str(manifest.get("notice_title_normalized") or manifest.get("notice_title_raw") or ""),
    ]
    for block in blocks:
        text = str(block.get("text_normalized") or block.get("text_raw") or "").strip()
        if text:
            parts.append(text)
    return "\n".join(parts)


def _source_ref(manifest: dict[str, Any]) -> str:
    site_id = _required_text(manifest.get("site_id")) or "unknown_site"
    notice_id = _required_text(manifest.get("notice_id")) or "unknown_notice"
    return f"notice:{site_id}:{notice_id}"


def _published_at(manifest: dict[str, Any]) -> str:
    value = (
        manifest.get("notice_release_time")
        or manifest.get("detail_observed_at")
        or manifest.get("captured_at")
        or manifest.get("list_observed_at")
    )
    return _parse_flexible_datetime(value, field_name="notice_release_time").isoformat()


def _snapshot_id(*, source_ref: str, published_at: str) -> str:
    notice_id = source_ref.split(":")[-1]
    published_date = _parse_rfc3339(published_at, "published_at").date().isoformat()
    return f"snapshot:transport-schedule:{published_date}:{notice_id}"


def _effective_date(value: str) -> date | None:
    match = _EFFECTIVE_DATE_RE.search(value)
    if match is None:
        return None
    return _date_from_match(match)


def _first_date(value: str) -> date | None:
    match = _DATE_RE.search(value)
    if match is None:
        return None
    return _date_from_match(match)


def _date_from_match(match: re.Match[str]) -> date:
    return date(int(match.group(1)), int(match.group(2)), int(match.group(3)))


def _extract_times(value: str) -> list[str]:
    times = [f"{int(match.group(1)):02d}:{match.group(2)}" for match in _TIME_RE.finditer(value)]
    return list(dict.fromkeys(times))


def _date_range(start: date, days: int) -> list[date]:
    return [start + timedelta(days=offset) for offset in range(days)]


def _contains_any(value: str, keywords: tuple[str, ...]) -> bool:
    return any(keyword in value for keyword in keywords)


def _parse_flexible_datetime(value: object, *, field_name: str) -> datetime:
    normalized = str(value or "").strip()
    if not normalized:
        raise ValueError(f"{field_name} is required")
    candidates = [normalized]
    if " " in normalized and "T" not in normalized:
        candidates.append(normalized.replace(" ", "T"))
    for candidate in candidates:
        try:
            parsed = datetime.fromisoformat(candidate)
            if parsed.tzinfo is None:
                parsed = parsed.replace(tzinfo=_SHANGHAI_TZ)
            return parsed.astimezone(_SHANGHAI_TZ)
        except ValueError:
            pass
    for layout in ("%Y-%m-%d %H:%M", "%Y-%m-%d", "%Y/%m/%d %H:%M", "%Y/%m/%d"):
        try:
            parsed = datetime.strptime(normalized, layout)
            return parsed.replace(tzinfo=_SHANGHAI_TZ)
        except ValueError:
            pass
    raise ValueError(f"{field_name} must be an ISO datetime or local date/time")


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


def _json_bytes(payload: dict[str, Any]) -> bytes:
    return (json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True) + "\n").encode(
        "utf-8"
    )
