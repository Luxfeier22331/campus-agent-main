from __future__ import annotations

import json
from dataclasses import asdict
from typing import Protocol
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from campus_contracts import (
    ScheduledDeparture,
    ServiceStatusLookupResult,
    TransportRouteCandidate,
    TransportRouteRef,
    TransportScheduleLookupResult,
    TransportScheduleSnapshotRef,
    TransportServiceWindow,
    TransportStopRef,
)

from campus_services_agent.query_service import (
    ServiceStatusQuery,
    TransportScheduleQuery,
)


class QueryHTTPTransport(Protocol):
    def __call__(
        self,
        url: str,
        *,
        headers: dict[str, str],
        json_body: dict[str, object],
        timeout_seconds: float,
    ) -> tuple[int, dict[str, object]]: ...


class CampusServicesHTTPQueryService:
    def __init__(
        self,
        *,
        base_url: str,
        shared_secret: str,
        timeout_seconds: float = 1.0,
        transport: QueryHTTPTransport | None = None,
    ) -> None:
        self.base_url = base_url.rstrip("/")
        self.shared_secret = shared_secret.strip()
        self.timeout_seconds = timeout_seconds
        self._transport = transport or self._default_transport
        if not self.base_url:
            raise ValueError("base_url must not be empty")
        if not self.shared_secret:
            raise ValueError("shared_secret must not be empty")

    def lookup_service_status(self, query: ServiceStatusQuery) -> ServiceStatusLookupResult:
        body = self._post(
            "/internal/query/campus-services/service-status",
            asdict(query.payload),
        )
        return _service_status_result_from_dict(
            body,
            fallback_subject_query=query.payload.subject_query,
        )

    def lookup_transport_schedule(
        self,
        query: TransportScheduleQuery,
    ) -> TransportScheduleLookupResult:
        body = self._post(
            "/internal/query/campus-services/transport-schedule",
            asdict(query.payload),
        )
        return _transport_schedule_result_from_dict(
            body,
            fallback_query_text=query.payload.query_text,
            fallback_intent=str(query.payload.intent),
        )

    def _post(self, path: str, json_body: dict[str, object]) -> dict[str, object]:
        status_code, body = self._transport(
            f"{self.base_url}{path}",
            headers={
                "content-type": "application/json",
                "x-supervisor-query-auth": self.shared_secret,
            },
            json_body=json_body,
            timeout_seconds=self.timeout_seconds,
        )
        if status_code < 200 or status_code >= 300:
            error = body.get("error") if isinstance(body.get("error"), dict) else {}
            message = str(error.get("message") or f"query service returned HTTP {status_code}")
            raise RuntimeError(message)
        return body

    @staticmethod
    def _default_transport(
        url: str,
        *,
        headers: dict[str, str],
        json_body: dict[str, object],
        timeout_seconds: float,
    ) -> tuple[int, dict[str, object]]:
        request = Request(
            url,
            data=json.dumps(json_body, ensure_ascii=False).encode("utf-8"),
            headers=headers,
            method="POST",
        )
        try:
            with urlopen(request, timeout=timeout_seconds) as response:
                return response.status, _decode_json_object(response.read())
        except HTTPError as exc:
            return exc.code, _decode_json_object(exc.read())
        except URLError as exc:
            raise RuntimeError(f"query service request failed: {exc}") from exc


def _decode_json_object(raw: bytes) -> dict[str, object]:
    try:
        value = json.loads(raw.decode("utf-8"))
    except json.JSONDecodeError as exc:
        raise RuntimeError("query service returned invalid JSON") from exc
    if not isinstance(value, dict):
        raise RuntimeError("query service response must be a JSON object")
    return value


def _service_status_result_from_dict(
    body: dict[str, object],
    *,
    fallback_subject_query: str,
) -> ServiceStatusLookupResult:
    return ServiceStatusLookupResult(
        subject_query=_string(body.get("subject_query")) or fallback_subject_query,
        outcome=_string(body.get("outcome")),
        resolved_subject=_string(body.get("resolved_subject")),
        observed_status=_string(body.get("observed_status")),
        queried_time_anchor=_string(body.get("queried_time_anchor")),
        effective_from=_string(body.get("effective_from")),
        effective_until=_string(body.get("effective_until")),
        override_source_refs=_string_tuple(body.get("override_source_refs")),
        related_notice_refs=_string_tuple(body.get("related_notice_refs")),
        historical_downgrade_reason=_string(body.get("historical_downgrade_reason")),
        fail_close_reason=_string(body.get("fail_close_reason")),
    )


def _transport_schedule_result_from_dict(
    body: dict[str, object],
    *,
    fallback_query_text: str,
    fallback_intent: str,
) -> TransportScheduleLookupResult:
    return TransportScheduleLookupResult(
        query_text=_string(body.get("query_text")) or fallback_query_text,
        intent=_string(body.get("intent")) or fallback_intent,
        outcome=_string(body.get("outcome")),
        resolved_route=_transport_route_ref(body.get("resolved_route")),
        service_status=_string(body.get("service_status")),
        queried_time_anchor=_string(body.get("queried_time_anchor")),
        requested_service_date=_string(body.get("requested_service_date")),
        selected_departure=_scheduled_departure(body.get("selected_departure")),
        departure_options=tuple(
            departure
            for item in _list(body.get("departure_options"))
            if (departure := _scheduled_departure(item)) is not None
        ),
        service_window=_service_window(body.get("service_window")),
        schedule_snapshot=_schedule_snapshot(body.get("schedule_snapshot")),
        timetable_entries=tuple(
            departure
            for item in _list(body.get("timetable_entries"))
            if (departure := _scheduled_departure(item)) is not None
        ),
        candidate_routes=tuple(
            candidate
            for item in _list(body.get("candidate_routes"))
            if (candidate := _route_candidate(item)) is not None
        ),
        clarification_reason=_string(body.get("clarification_reason")),
        stop_refs=tuple(
            stop for item in _list(body.get("stop_refs")) if (stop := _stop_ref(item)) is not None
        ),
        related_notice_refs=_string_tuple(body.get("related_notice_refs")),
        historical_downgrade_reason=_string(body.get("historical_downgrade_reason")),
        fail_close_reason=_string(body.get("fail_close_reason")),
    )


def _transport_route_ref(value: object) -> TransportRouteRef | None:
    item = _dict(value)
    if item is None:
        return None
    return TransportRouteRef(
        route_id=_string(item.get("route_id")),
        display_name=_string(item.get("display_name")),
        service_family=_string(item.get("service_family")),
    )


def _stop_ref(value: object) -> TransportStopRef | None:
    item = _dict(value)
    if item is None:
        return None
    return TransportStopRef(
        stop_id=_string(item.get("stop_id")),
        display_name=_string(item.get("display_name")),
    )


def _scheduled_departure(value: object) -> ScheduledDeparture | None:
    item = _dict(value)
    if item is None:
        return None
    return ScheduledDeparture(
        departure_at=_string(item.get("departure_at")),
        arrival_at=_string(item.get("arrival_at")),
        origin_stop_ref=_stop_ref(item.get("origin_stop_ref")),
        destination_stop_ref=_stop_ref(item.get("destination_stop_ref")),
    )


def _service_window(value: object) -> TransportServiceWindow | None:
    item = _dict(value)
    if item is None:
        return None
    return TransportServiceWindow(
        first_departure_at=_string(item.get("first_departure_at")),
        last_departure_at=_string(item.get("last_departure_at")),
    )


def _schedule_snapshot(value: object) -> TransportScheduleSnapshotRef | None:
    item = _dict(value)
    if item is None:
        return None
    return TransportScheduleSnapshotRef(
        snapshot_id=_string(item.get("snapshot_id")),
        published_at=_string(item.get("published_at")),
        effective_from=_string(item.get("effective_from")),
        effective_until=_string(item.get("effective_until")),
        source_ref=_string(item.get("source_ref")),
    )


def _route_candidate(value: object) -> TransportRouteCandidate | None:
    item = _dict(value)
    if item is None:
        return None
    route = _transport_route_ref(item.get("route"))
    if route is None:
        return None
    return TransportRouteCandidate(
        route=route,
        clarification_hint=_string(item.get("clarification_hint")),
    )


def _dict(value: object) -> dict[str, object] | None:
    if isinstance(value, dict):
        return value
    return None


def _list(value: object) -> list[object]:
    if isinstance(value, list):
        return value
    return []


def _string(value: object) -> str:
    return value.strip() if isinstance(value, str) else ""


def _string_tuple(value: object) -> tuple[str, ...]:
    return tuple(_string(item) for item in _list(value) if _string(item))
