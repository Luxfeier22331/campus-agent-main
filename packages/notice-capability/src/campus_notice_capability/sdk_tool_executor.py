from __future__ import annotations

import hashlib
import json
from collections.abc import Mapping
from typing import get_args, get_origin, get_type_hints

from campus_contracts import (
    CampusNoticeChangeSetLookupPayload,
    CampusNoticeDiscoverPayload,
    CampusNoticePeriodSummaryPayload,
)

from campus_notice_capability.query_service import (
    NoticeAccessContext,
    NoticeChangeSetLookupQuery,
    NoticeDiscoverQuery,
    NoticePeriodSummaryQuery,
    NoticeQueryService,
)


def execute_notice_sdk_tool(
    execution,
    *,
    agent_request,
    query_service: NoticeQueryService,
) -> dict[str, object]:
    if execution.name == "campus_notice_discover":
        payload = CampusNoticeDiscoverPayload(
            **_normalize_dataclass_arguments(CampusNoticeDiscoverPayload, execution.arguments)
        )
        result = query_service.discover_notice(
            NoticeDiscoverQuery(
                payload=payload,
                access_context=_access_context_from_request(agent_request),
            )
        )
        cards = tuple(result.notice_cards)
        return {
            "status": "completed",
            "outcome": result.outcome,
            "query_text": result.query_text,
            "notice_card_count": len(cards),
            "titles": [card.title for card in cards],
            "source_urls": [card.source_url for card in cards],
            "source_ref_count": len({card.source_url for card in cards if card.source_url.strip()}),
        }
    if execution.name == "campus_notice_period_summary":
        payload = CampusNoticePeriodSummaryPayload(
            **_normalize_dataclass_arguments(
                CampusNoticePeriodSummaryPayload,
                execution.arguments,
            )
        )
        result = query_service.summarize_notice_period(
            NoticePeriodSummaryQuery(
                payload=payload,
                access_context=_access_context_from_request(agent_request),
            )
        )
        groups = tuple(result.groups)
        cards = tuple(result.notice_cards)
        projection: dict[str, object] = {
            "status": "completed",
            "outcome": result.outcome,
            "query_text": result.query_text,
            "date_range": {
                "start_date": result.date_range.start_date,
                "end_date": result.date_range.end_date,
                "timezone": result.date_range.timezone,
            },
            "bounded_summary": result.bounded_summary,
            "source_ref_count": result.source_ref_count,
            "groups": [
                {
                    "group_key": group.group_key,
                    "title": group.title,
                    "notice_count": group.notice_count,
                    "summary": group.summary,
                    "notice_ids": list(group.notice_ids),
                }
                for group in groups[:8]
            ],
            "notice_cards": [
                {
                    "notice_id": card.notice_id,
                    "title": card.title,
                    "source_family": card.source_family,
                    "source_url": card.source_url,
                    "target_surface": card.target_surface,
                    "published_at": card.published_at,
                    "summary": card.summary,
                }
                for card in cards[:10]
            ],
        }
        _attach_output_projection_ref(
            projection,
            agent_request=agent_request,
            projection_kind="notice_period_summary",
            payload=_notice_period_summary_projection_payload(projection),
        )
        return projection
    if execution.name == "campus_notice_change_set_lookup":
        payload = CampusNoticeChangeSetLookupPayload(
            **_normalize_dataclass_arguments(
                CampusNoticeChangeSetLookupPayload,
                execution.arguments,
            )
        )
        result = query_service.lookup_notice_change_set(
            NoticeChangeSetLookupQuery(
                payload=payload,
                access_context=_access_context_from_request(agent_request),
            )
        )
        projection: dict[str, object] = {
            "status": "completed",
            "outcome": result.outcome,
            "query_text": result.query_text,
            "source_ref_count": 0,
        }
        if result.change_set is not None:
            source_refs = list(result.change_set.source_refs)
            facts = list(result.change_set.facts)
            change_set_projection: dict[str, object] = {
                "schema_version": result.change_set.schema_version,
                "change_set_id": result.change_set.change_set_id,
                "target_family": result.change_set.target_family,
                "query_scope": {
                    "campus": result.change_set.query_scope.campus,
                    "service_kind": result.change_set.query_scope.service_kind,
                    "route_labels": list(result.change_set.query_scope.route_labels),
                    "direction_labels": list(result.change_set.query_scope.direction_labels),
                    "stop_labels": list(result.change_set.query_scope.stop_labels),
                    "query_time_anchor": result.change_set.query_scope.query_time_anchor,
                    "service_date": result.change_set.query_scope.service_date,
                },
                "effective_window": {
                    "starts_at": result.change_set.effective_window.starts_at,
                    "ends_at": result.change_set.effective_window.ends_at,
                    "date_set": list(result.change_set.effective_window.date_set),
                    "timezone": result.change_set.effective_window.timezone,
                    "current_at_query_time": (
                        result.change_set.effective_window.current_at_query_time
                    ),
                },
                "change_kind": result.change_set.change_kind,
                "answer_eligible": result.change_set.answer_eligible,
                "admission_state": result.change_set.admission_state,
                "content_hash": result.change_set.content_hash,
                "facts": [
                    {
                        "fact_id": fact.fact_id,
                        "fact_kind": fact.fact_kind,
                        "change_text": fact.change_text,
                        "source_notice_id": fact.source_notice_id,
                        "source_ref_id": fact.source_ref_id,
                        "route_label": fact.route_label,
                        "direction_label": fact.direction_label,
                        "service_window": dict(fact.service_window),
                        "confidence": fact.confidence,
                    }
                    for fact in facts[:12]
                ],
                "source_refs": [
                    {
                        "source_ref_id": ref.source_ref_id,
                        "notice_id": ref.notice_id,
                        "title": ref.title,
                        "source_url": ref.source_url,
                        "published_at": ref.published_at,
                        "excerpt": ref.excerpt,
                    }
                    for ref in source_refs[:6]
                ],
                "conflicts": [
                    {
                        "conflict_id": conflict.conflict_id,
                        "reason": conflict.reason,
                        "source_ref_ids": list(conflict.source_ref_ids),
                        "summary": conflict.summary,
                    }
                    for conflict in result.change_set.conflicts[:6]
                ],
                "safety_summary": {
                    "raw_payload_absent": result.change_set.safety_summary.raw_payload_absent,
                    "payload_key_names": list(result.change_set.safety_summary.payload_key_names),
                    "redacted": result.change_set.safety_summary.redacted,
                    "notes": list(result.change_set.safety_summary.notes),
                },
                "fail_close_reasons": list(result.change_set.fail_close_reasons),
            }
            projection.update(
                {
                    "change_set": change_set_projection,
                    "change_set_id": result.change_set.change_set_id,
                    "target_family": result.change_set.target_family,
                    "change_kind": result.change_set.change_kind,
                    "answer_eligible": result.change_set.answer_eligible,
                    "admission_state": result.change_set.admission_state,
                    "fact_count": len(facts),
                    "source_ref_count": len(source_refs),
                }
            )
            fact_texts = [fact.change_text.strip() for fact in facts if fact.change_text.strip()]
            if fact_texts:
                projection["change_texts"] = fact_texts[:12]
            if source_refs:
                projection["source_refs"] = [
                    {
                        "notice_id": ref.notice_id,
                        "title": ref.title,
                        "source_url": ref.source_url,
                        "published_at": ref.published_at,
                    }
                    for ref in source_refs[:6]
                ]
            _attach_output_projection_ref(
                projection,
                agent_request=agent_request,
                projection_kind="notice_change_set",
                payload=_notice_change_set_projection_payload(projection),
            )
        return projection
    raise ValueError(f"notice cannot execute SDK tool: {execution.name}")


def _access_context_from_request(agent_request) -> NoticeAccessContext:
    return NoticeAccessContext(
        actor=agent_request.actor,
        authorization=agent_request.context.authorization,
    )


def _attach_output_projection_ref(
    projection: dict[str, object],
    *,
    agent_request,
    projection_kind: str,
    payload: Mapping[str, object],
) -> None:
    if projection_kind not in tuple(agent_request.workflow_context.expected_output_artifacts):
        return
    if not any(_has_projection_value(value) for value in payload.values()):
        return
    projection["output_projection_ref"] = _safe_projection_ref(
        agent_request.workflow_context.step_id,
        projection_kind,
        payload,
    )


def _notice_change_set_projection_payload(projection: Mapping[str, object]) -> dict[str, object]:
    change_set = projection.get("change_set")
    payload: dict[str, object] = {
        "change_set_id": str(projection.get("change_set_id") or "").strip(),
        "target_family": str(projection.get("target_family") or "").strip(),
        "change_kind": str(projection.get("change_kind") or "").strip(),
        "service_date": "",
        "summary": "",
    }
    if isinstance(change_set, Mapping):
        query_scope = change_set.get("query_scope")
        if isinstance(query_scope, Mapping):
            payload["service_date"] = str(query_scope.get("service_date") or "").strip()
            route_labels = [
                str(item).strip()
                for item in query_scope.get("route_labels", [])
                if str(item).strip()
            ]
            if route_labels:
                payload["route_labels"] = route_labels
        facts = change_set.get("facts")
        if isinstance(facts, list):
            fact_summaries = []
            for item in facts:
                if not isinstance(item, Mapping):
                    continue
                summary = str(item.get("change_text") or "").strip()
                if summary:
                    fact_summaries.append(summary)
            if fact_summaries:
                payload["fact_summaries"] = fact_summaries
                payload["summary"] = "；".join(fact_summaries)[:1600]
    source_refs = projection.get("source_refs")
    if isinstance(source_refs, list):
        normalized_refs = []
        for item in source_refs:
            if not isinstance(item, Mapping):
                continue
            source_url = str(item.get("source_url") or "").strip()
            if source_url:
                normalized_refs.append(source_url)
        if normalized_refs:
            payload["source_refs"] = normalized_refs
    return payload


def _notice_period_summary_projection_payload(
    projection: Mapping[str, object],
) -> dict[str, object]:
    payload: dict[str, object] = {
        "start_date": "",
        "end_date": "",
        "summary": str(projection.get("bounded_summary") or "").strip()[:1600],
        "group_summaries": [],
        "source_refs": [],
    }
    date_range = projection.get("date_range")
    if isinstance(date_range, Mapping):
        payload["start_date"] = str(date_range.get("start_date") or "").strip()
        payload["end_date"] = str(date_range.get("end_date") or "").strip()
    groups = projection.get("groups")
    if isinstance(groups, list):
        group_summaries = []
        for item in groups:
            if not isinstance(item, Mapping):
                continue
            summary = str(item.get("summary") or "").strip()
            if summary:
                group_summaries.append(summary)
        payload["group_summaries"] = group_summaries
    notice_cards = projection.get("notice_cards")
    if isinstance(notice_cards, list):
        source_refs = []
        for item in notice_cards:
            if not isinstance(item, Mapping):
                continue
            source_url = str(item.get("source_url") or "").strip()
            if source_url:
                source_refs.append(source_url)
        payload["source_refs"] = source_refs
    return payload


def _safe_projection_ref(
    source_step_id: str,
    projection_kind: str,
    payload: Mapping[str, object],
) -> dict[str, object]:
    encoded = json.dumps(payload, ensure_ascii=False, separators=(",", ":"), sort_keys=True).encode(
        "utf-8"
    )
    digest = hashlib.sha256(encoded).hexdigest()
    return {
        "projection_id": f"projection:{projection_kind}:{digest[:16]}",
        "source_step_id": source_step_id,
        "projection_kind": projection_kind,
        "content_hash": f"sha256:{digest}",
        "safety": {
            "truncated": False,
            "redacted": False,
            "max_chars": 1600,
            "fields_present": sorted(
                key for key, value in payload.items() if _has_projection_value(value)
            ),
        },
    }


def _has_projection_value(value: object) -> bool:
    if isinstance(value, str):
        return bool(value.strip())
    if isinstance(value, list | tuple | dict):
        return len(value) > 0
    return value is not None


def _normalize_dataclass_arguments(
    payload_class: type[object], arguments: dict[str, object]
) -> dict[str, object]:
    normalized = dict(arguments)
    resolved_types = get_type_hints(payload_class, include_extras=True)
    for field_name, annotation in resolved_types.items():
        value = normalized.get(field_name)
        if isinstance(value, list) and get_origin(annotation) is tuple:
            normalized[field_name] = tuple(value)
            continue
        if not isinstance(value, dict):
            continue
        nested_type = _dataclass_type_for_annotation(annotation)
        if nested_type is None:
            continue
        normalized[field_name] = nested_type(**value)
    return normalized


def _dataclass_type_for_annotation(annotation: object) -> type[object] | None:
    if isinstance(annotation, type):
        return annotation
    origin = get_origin(annotation)
    if origin is None:
        return None
    for candidate in get_args(annotation):
        if isinstance(candidate, type):
            return candidate
    return None


__all__ = ["execute_notice_sdk_tool"]
