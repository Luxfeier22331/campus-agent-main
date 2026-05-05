from __future__ import annotations

import json
from dataclasses import asdict
from typing import Protocol
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from campus_contracts import AcademicCalendarLookupResult

from campus_calendar_agent.query_service import AcademicCalendarQuery


class QueryHTTPTransport(Protocol):
    def __call__(
        self,
        url: str,
        *,
        headers: dict[str, str],
        json_body: dict[str, object],
        timeout_seconds: float,
    ) -> tuple[int, dict[str, object]]: ...


class CalendarHTTPQueryService:
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

    def lookup_academic_calendar(
        self,
        query: AcademicCalendarQuery,
    ) -> AcademicCalendarLookupResult:
        body = self._post(
            "/internal/query/calendar/academic-calendar",
            _query_body(
                payload=asdict(query.payload),
                access_context=asdict(query.access_context),
            ),
        )
        return _result_from_dict(body, fallback_query_text=query.payload.query_text)

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


def _query_body(
    *,
    payload: dict[str, object],
    access_context: dict[str, object],
) -> dict[str, object]:
    return {
        "payload": payload,
        "access_context": access_context,
    }


def _decode_json_object(raw: bytes) -> dict[str, object]:
    try:
        value = json.loads(raw.decode("utf-8"))
    except json.JSONDecodeError as exc:
        raise RuntimeError("query service returned invalid JSON") from exc
    if not isinstance(value, dict):
        raise RuntimeError("query service response must be a JSON object")
    return value


def _result_from_dict(
    body: dict[str, object],
    *,
    fallback_query_text: str,
) -> AcademicCalendarLookupResult:
    return AcademicCalendarLookupResult(
        query_text=_string(body.get("query_text")) or fallback_query_text,
        outcome=_string(body.get("outcome")),
        requested_date=_string(body.get("requested_date")),
        resolved_date=_string(body.get("resolved_date")),
        academic_year_label=_string(body.get("academic_year_label")),
        term_label=_string(body.get("term_label")),
        week_index=_int_or_none(body.get("week_index")),
        day_kind=_string(body.get("day_kind")),
        class_day_pattern=_string(body.get("class_day_pattern")),
        is_makeup_class=_bool_or_none(body.get("is_makeup_class")),
        holiday_name=_string(body.get("holiday_name")),
        source_refs=_string_tuple(body.get("source_refs")),
        queried_time_anchor=_string(body.get("queried_time_anchor")),
        effective_from=_string(body.get("effective_from")),
        effective_until=_string(body.get("effective_until")),
        fail_close_reason=_string(body.get("fail_close_reason")),
    )


def _string(value: object) -> str:
    if isinstance(value, str):
        return value
    return ""


def _int_or_none(value: object) -> int | None:
    if isinstance(value, int):
        return value
    if isinstance(value, float) and value.is_integer():
        return int(value)
    return None


def _bool_or_none(value: object) -> bool | None:
    if isinstance(value, bool):
        return value
    return None


def _string_tuple(value: object) -> tuple[str, ...]:
    if not isinstance(value, list):
        return ()
    return tuple(item for item in (_string(entry).strip() for entry in value) if item)
