from __future__ import annotations

from typing import get_args, get_origin, get_type_hints

from campus_contracts import (
    CampusNoticeChangeSetLookupPayload,
    CampusNoticeDiscoverPayload,
)

from campus_notice_agent.query_service import (
    NoticeAccessContext,
    NoticeChangeSetLookupQuery,
    NoticeDiscoverQuery,
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
        return projection
    raise ValueError(f"notice-agent cannot execute SDK tool: {execution.name}")


def _access_context_from_request(agent_request) -> NoticeAccessContext:
    return NoticeAccessContext(
        actor=agent_request.actor,
        authorization=agent_request.context.authorization,
    )


def _normalize_dataclass_arguments(
    payload_class: type[object], arguments: dict[str, object]
) -> dict[str, object]:
    normalized = dict(arguments)
    resolved_types = get_type_hints(payload_class, include_extras=True)
    for field_name, annotation in resolved_types.items():
        value = normalized.get(field_name)
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
