from __future__ import annotations

import json
from dataclasses import asdict
from typing import Protocol
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from campus_contracts import (
    CampusNoticeChangeSetLookupResult,
    CampusNoticeDiscoverResult,
    CampusNoticeGetResult,
    NoticeCard,
    NoticeDisplayPolicy,
)

from campus_notice_capability.query_service import (
    NoticeChangeSetLookupQuery,
    NoticeDiscoverQuery,
    NoticeGetQuery,
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
        )

    def lookup_notice_change_set(
        self,
        query: NoticeChangeSetLookupQuery,
    ) -> CampusNoticeChangeSetLookupResult:
        body = self._post(
            "/internal/query/notices/change-set",
            _query_body(
                payload=asdict(query.payload),
                access_context=asdict(query.access_context),
            ),
        )
        return _change_set_result_from_dict(
            body,
        )

    def get_notice(self, query: NoticeGetQuery) -> CampusNoticeGetResult:
        body = self._post(
            "/internal/query/notices/get",
            _query_body(
                payload=asdict(query.payload),
                access_context=asdict(query.access_context),
            ),
        )
        return _get_result_from_dict(body)

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
) -> CampusNoticeDiscoverResult:
    return CampusNoticeDiscoverResult(
        query_text=_required_string(body, "query_text"),
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
) -> CampusNoticeGetResult:
    return CampusNoticeGetResult(
        notice_id=_required_string(body, "notice_id"),
        outcome=_string(body.get("outcome")),
        title=_string(body.get("title")),
        source_family=_required_string(body, "source_family"),
        source_url=_string(body.get("source_url")),
        canonical_url=_string(body.get("canonical_url")),
        normalized_body=_body_string(body.get("normalized_body")),
        reference_only=_bool(body.get("reference_only"), default=False),
        display_policy=_notice_display_policy(body.get("display_policy")),
        body_excerpt=_string(body.get("body_excerpt")),
        bounded_summary=_string(body.get("bounded_summary")),
        extracted_facts=_string_tuple(body.get("extracted_facts")),
        target_surface=_string(body.get("target_surface")),
        published_at=_string(body.get("published_at")),
        effective_at=_string(body.get("effective_at")),
        attachment_refs=_string_tuple(body.get("attachment_refs")),
        provenance_refs=_string_tuple(body.get("provenance_refs")),
        historical_downgrade_reason=_string(body.get("historical_downgrade_reason")),
        fail_close_reason=_string(body.get("fail_close_reason")),
    )


def _change_set_result_from_dict(
    body: dict[str, object],
) -> CampusNoticeChangeSetLookupResult:
    from campus_contracts import (
        NoticeChangeSet,
        NoticeChangeSetConflict,
        NoticeChangeSetEffectiveWindow,
        NoticeChangeSetFact,
        NoticeChangeSetQueryScope,
        NoticeChangeSetSafetySummary,
        NoticeChangeSetSourceRef,
    )

    change_set_dict = _dict(body.get("change_set"))
    change_set = None
    if change_set_dict is not None:
        query_scope_dict = _dict(change_set_dict.get("query_scope")) or {}
        effective_window_dict = _dict(change_set_dict.get("effective_window")) or {}
        safety_summary_dict = _dict(change_set_dict.get("safety_summary")) or {}
        facts = tuple(
            NoticeChangeSetFact(
                fact_id=_string(item.get("fact_id")),
                fact_kind=_string(item.get("fact_kind")),
                change_text=_string(item.get("change_text")),
                source_notice_id=_string(item.get("source_notice_id")),
                source_ref_id=_string(item.get("source_ref_id")),
                route_label=_string(item.get("route_label")),
                direction_label=_string(item.get("direction_label")),
                service_window=_dict(item.get("service_window")) or {},
                confidence=_string(item.get("confidence")) or "deterministic",
            )
            for raw_item in _list(change_set_dict.get("facts"))
            if (item := _dict(raw_item)) is not None
        )
        source_refs = tuple(
            NoticeChangeSetSourceRef(
                source_ref_id=_string(item.get("source_ref_id")),
                notice_id=_string(item.get("notice_id")),
                title=_string(item.get("title")),
                source_url=_string(item.get("source_url")),
                published_at=_string(item.get("published_at")),
                excerpt=_string(item.get("excerpt")),
            )
            for raw_item in _list(change_set_dict.get("source_refs"))
            if (item := _dict(raw_item)) is not None
        )
        conflicts = tuple(
            NoticeChangeSetConflict(
                conflict_id=_string(item.get("conflict_id")),
                reason=_string(item.get("reason")),
                source_ref_ids=_string_tuple(item.get("source_ref_ids")),
                summary=_string(item.get("summary")),
            )
            for raw_item in _list(change_set_dict.get("conflicts"))
            if (item := _dict(raw_item)) is not None
        )
        change_set = NoticeChangeSet(
            change_set_id=_string(change_set_dict.get("change_set_id")),
            target_family=_string(change_set_dict.get("target_family")),
            query_scope=NoticeChangeSetQueryScope(
                campus=_string(query_scope_dict.get("campus")),
                service_kind=_string(query_scope_dict.get("service_kind")) or "transport_schedule",
                route_labels=_string_tuple(query_scope_dict.get("route_labels")),
                direction_labels=_string_tuple(query_scope_dict.get("direction_labels")),
                stop_labels=_string_tuple(query_scope_dict.get("stop_labels")),
                query_time_anchor=_string(query_scope_dict.get("query_time_anchor")),
                service_date=_string(query_scope_dict.get("service_date")),
            ),
            effective_window=NoticeChangeSetEffectiveWindow(
                starts_at=_string(effective_window_dict.get("starts_at")),
                ends_at=_string(effective_window_dict.get("ends_at")),
                date_set=_string_tuple(effective_window_dict.get("date_set")),
                timezone=_string(effective_window_dict.get("timezone")) or "Asia/Shanghai",
                current_at_query_time=_bool(
                    effective_window_dict.get("current_at_query_time"), default=False
                ),
            ),
            change_kind=_string(change_set_dict.get("change_kind")),
            answer_eligible=_bool(change_set_dict.get("answer_eligible"), default=False),
            admission_state=_string(change_set_dict.get("admission_state")),
            content_hash=_string(change_set_dict.get("content_hash")),
            facts=facts,
            source_refs=source_refs,
            conflicts=conflicts,
            safety_summary=NoticeChangeSetSafetySummary(
                raw_payload_absent=_bool(
                    safety_summary_dict.get("raw_payload_absent"), default=True
                ),
                payload_key_names=_string_tuple(safety_summary_dict.get("payload_key_names")),
                redacted=_bool(safety_summary_dict.get("redacted"), default=False),
                notes=_string_tuple(safety_summary_dict.get("notes")),
            ),
            fail_close_reasons=_string_tuple(change_set_dict.get("fail_close_reasons")),
            schema_version=_string(change_set_dict.get("schema_version")),
        )
    return CampusNoticeChangeSetLookupResult(
        query_text=_required_string(body, "query_text"),
        outcome=_string(body.get("outcome")),
        change_set=change_set,
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
        target_surface=_string(item.get("target_surface")),
        summary=_string(item.get("summary")),
        published_at=_string(item.get("published_at")),
        effective_at=_string(item.get("effective_at")),
        is_current=_bool(item.get("is_current"), default=True),
        display_policy=_notice_display_policy(item.get("display_policy")),
    )


def _notice_display_policy(value: object) -> NoticeDisplayPolicy:
    item = _dict(value)
    if item is None:
        return NoticeDisplayPolicy()
    return NoticeDisplayPolicy(
        public_surface=_string(item.get("public_surface")) or "card_only",
        full_body_forbidden=_bool(item.get("full_body_forbidden"), default=True),
        body_access=_string(item.get("body_access")) or "none",
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


def _required_string(body: dict[str, object], field_name: str) -> str:
    value = _string(body.get(field_name))
    if not value:
        raise RuntimeError(f"query service response missing required field: {field_name}")
    return value


def _body_string(value: object) -> str:
    return value if isinstance(value, str) else ""


def _string_tuple(value: object) -> tuple[str, ...]:
    return tuple(_string(item) for item in _list(value) if _string(item))


def _bool(value: object, *, default: bool) -> bool:
    return value if isinstance(value, bool) else default
