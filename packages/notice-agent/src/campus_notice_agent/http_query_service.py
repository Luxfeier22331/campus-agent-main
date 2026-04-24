from __future__ import annotations

import json
from dataclasses import asdict
from typing import Protocol
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from campus_contracts import (
    CampusNoticeDiscoverResult,
    CampusNoticeGetResult,
    NoticeCard,
)

from campus_notice_agent.query_service import NoticeDiscoverQuery, NoticeGetQuery


class QueryHTTPTransport(Protocol):
    def __call__(
        self,
        url: str,
        *,
        headers: dict[str, str],
        json_body: dict[str, object],
        timeout_seconds: float,
    ) -> tuple[int, dict[str, object]]: ...


class NoticeHTTPQueryService:
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

    def discover_notice(self, query: NoticeDiscoverQuery) -> CampusNoticeDiscoverResult:
        body = self._post(
            "/internal/query/notices/discover",
            _query_body(
                payload=asdict(query.payload),
                access_context=asdict(query.access_context),
            ),
        )
        return _discover_result_from_dict(
            body,
            fallback_query_text=query.payload.query_text,
        )

    def get_notice(self, query: NoticeGetQuery) -> CampusNoticeGetResult:
        body = self._post(
            "/internal/query/notices/get",
            _query_body(
                payload=asdict(query.payload),
                access_context=asdict(query.access_context),
            ),
        )
        return _get_result_from_dict(
            body,
            fallback_notice_id=query.payload.notice_id,
            fallback_source_family=query.payload.source_family,
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


def _discover_result_from_dict(
    body: dict[str, object],
    *,
    fallback_query_text: str,
) -> CampusNoticeDiscoverResult:
    return CampusNoticeDiscoverResult(
        query_text=_string(body.get("query_text")) or fallback_query_text,
        outcome=_string(body.get("outcome")),
        source_families=_string_tuple(body.get("source_families")),
        notice_cards=tuple(
            card for item in _list(body.get("notice_cards")) if (card := _notice_card(item))
        ),
        queried_time_anchor=_string(body.get("queried_time_anchor")),
        historical_downgrade_reason=_string(body.get("historical_downgrade_reason")),
        fail_close_reason=_string(body.get("fail_close_reason")),
    )


def _get_result_from_dict(
    body: dict[str, object],
    *,
    fallback_notice_id: str,
    fallback_source_family: str,
) -> CampusNoticeGetResult:
    return CampusNoticeGetResult(
        notice_id=_string(body.get("notice_id")) or fallback_notice_id,
        outcome=_string(body.get("outcome")),
        title=_string(body.get("title")),
        source_family=_string(body.get("source_family")) or fallback_source_family,
        source_url=_string(body.get("source_url")),
        canonical_url=_string(body.get("canonical_url")),
        normalized_body=_string(body.get("normalized_body")),
        published_at=_string(body.get("published_at")),
        effective_at=_string(body.get("effective_at")),
        attachment_refs=_string_tuple(body.get("attachment_refs")),
        provenance_refs=_string_tuple(body.get("provenance_refs")),
        historical_downgrade_reason=_string(body.get("historical_downgrade_reason")),
        fail_close_reason=_string(body.get("fail_close_reason")),
    )


def _notice_card(value: object) -> NoticeCard | None:
    item = _dict(value)
    if item is None:
        return None
    return NoticeCard(
        notice_id=_string(item.get("notice_id")),
        title=_string(item.get("title")),
        source_family=_string(item.get("source_family")),
        source_url=_string(item.get("source_url")),
        canonical_url=_string(item.get("canonical_url")),
        published_at=_string(item.get("published_at")),
        effective_at=_string(item.get("effective_at")),
        is_current=_bool(item.get("is_current"), default=True),
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


def _bool(value: object, *, default: bool) -> bool:
    return value if isinstance(value, bool) else default
