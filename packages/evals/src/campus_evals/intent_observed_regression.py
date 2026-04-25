from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from campus_contracts import (
    ContextProjection,
    KnowledgeScope,
    ProfileMemoryItem,
    ProfileMemorySummary,
    SelectedNoticeRef,
    SessionSlot,
    SessionSummary,
    VersionQuery,
)

from campus_evals.intent_models import IntentCase

DEFAULT_INTENT_OBSERVED_REGRESSION_PATH = (
    Path(__file__).resolve().parents[2] / "fixtures" / "intent_observed_regression.json"
)


def load_intent_observed_regression_cases(path: str | Path | None = None) -> tuple[IntentCase, ...]:
    resolved_path = Path(path) if path is not None else DEFAULT_INTENT_OBSERVED_REGRESSION_PATH
    payload = json.loads(resolved_path.read_text(encoding="utf-8"))
    if int(payload.get("schema_version") or 0) != 1:
        raise ValueError("intent observed regression schema_version must be 1")
    raw_cases = payload.get("cases")
    if not isinstance(raw_cases, list):
        raise ValueError("intent observed regression cases must be a list")

    seen_case_ids: set[str] = set()
    cases: list[IntentCase] = []
    for raw_item in raw_cases:
        if not isinstance(raw_item, dict):
            raise ValueError("intent observed regression case must be an object")
        case_id = _required_string(raw_item.get("case_id"), "case_id")
        if case_id in seen_case_ids:
            raise ValueError(f"duplicate observed regression case_id: {case_id}")
        seen_case_ids.add(case_id)

        review = _mapping(raw_item.get("review"), "review")
        if _required_string(review.get("decision"), "review.decision") != "accepted":
            continue
        if _required_string(raw_item.get("domain"), "domain") != "intent":
            raise ValueError("accepted observed regression domain must be intent")
        if (
            _required_string(review.get("target_suite"), "review.target_suite")
            != "observed_regression"
        ):
            raise ValueError(
                "accepted observed regression target_suite must be observed_regression"
            )
        _validate_source_correlation(_mapping(raw_item.get("source"), "source"))

        cases.append(
            _intent_case_from_payload(
                case_id=case_id,
                payload=_mapping(raw_item.get("intent_case"), "intent_case"),
            )
        )
    return tuple(cases)


def _intent_case_from_payload(*, case_id: str, payload: dict[str, Any]) -> IntentCase:
    tags = _string_tuple(payload.get("tags"))
    if "observed_regression" not in tags:
        tags = (*tags, "observed_regression")
    expected_capability = _required_string(
        payload.get("expected_capability"),
        "intent_case.expected_capability",
    )
    return IntentCase(
        case_id=case_id,
        user_goal=_required_string(payload.get("user_goal"), "intent_case.user_goal"),
        requested_capability=_optional_string(payload.get("requested_capability"))
        or expected_capability
        or None,
        requested_scope=_knowledge_scope_from_payload(payload.get("requested_scope")),
        version_query=_version_query_from_payload(payload.get("version_query")),
        context=_context_from_payload(payload.get("context")),
        expected_capability=expected_capability,
        expected_task_kind=_required_string(
            payload.get("expected_task_kind"),
            "intent_case.expected_task_kind",
        ),
        expected_launch_state=_required_string(
            payload.get("expected_launch_state"),
            "intent_case.expected_launch_state",
        ),
        expected_next_action=_required_string(
            payload.get("expected_next_action"),
            "intent_case.expected_next_action",
        ),
        expected_scope_class=_required_string(
            payload.get("expected_scope_class"),
            "intent_case.expected_scope_class",
        ),
        expected_target=_required_string(
            payload.get("expected_target"), "intent_case.expected_target"
        ),
        expected_policy_reason=_optional_string(payload.get("expected_policy_reason")),
        expected_scope_reason=_optional_string(payload.get("expected_scope_reason")),
        expected_context_resolution_state=_optional_string(
            payload.get("expected_context_resolution_state")
        ),
        expected_context_reference_type=_optional_string(
            payload.get("expected_context_reference_type")
        ),
        expected_missing_slots=_string_tuple(payload.get("expected_missing_slots")),
        expected_allowed_tools=_string_tuple(payload.get("expected_allowed_tools")),
        expected_error_code=_optional_string(payload.get("expected_error_code")),
        critical=bool(payload.get("critical")),
        tags=tags,
    )


def _validate_source_correlation(source: dict[str, Any]) -> None:
    _required_string(source.get("request_id"), "source.request_id")
    _required_string(source.get("trace_id"), "source.trace_id")
    _required_string(source.get("sampled_at"), "source.sampled_at")


def _knowledge_scope_from_payload(value: object) -> KnowledgeScope | None:
    if value is None:
        return None
    item = _mapping(value, "intent_case.requested_scope")
    return KnowledgeScope(
        corpus=_required_string(item.get("corpus"), "intent_case.requested_scope.corpus"),
        collection=_required_string(
            item.get("collection"),
            "intent_case.requested_scope.collection",
        ),
    )


def _version_query_from_payload(value: object) -> VersionQuery:
    if value is None:
        return VersionQuery()
    item = _mapping(value, "intent_case.version_query")
    return VersionQuery(
        mode=_optional_string(item.get("mode")) or "current",
        as_of=_optional_string(item.get("as_of")),
        version_id=_optional_string(item.get("version_id")),
        compare_to_version_id=_optional_string(item.get("compare_to_version_id")),
    )


def _context_from_payload(value: object) -> ContextProjection:
    if value is None:
        return ContextProjection()
    item = _mapping(value, "intent_case.context")
    return ContextProjection(
        profile_memory=_profile_memory_from_payload(item.get("profile_memory")),
        session=_session_from_payload(item.get("session")),
    )


def _profile_memory_from_payload(value: object) -> ProfileMemorySummary:
    if value is None:
        return ProfileMemorySummary()
    item = _mapping(value, "intent_case.context.profile_memory")
    raw_items = item.get("items") or ()
    if not isinstance(raw_items, list | tuple):
        raise ValueError("intent_case.context.profile_memory.items must be a list")
    return ProfileMemorySummary(
        items=tuple(
            ProfileMemoryItem(
                item_id=_required_string(raw_item.get("item_id"), "profile_memory.items.item_id"),
                key=_required_string(raw_item.get("key"), "profile_memory.items.key"),
                value=_required_string(raw_item.get("value"), "profile_memory.items.value"),
                source_type=_optional_string(raw_item.get("source_type")) or "user_declared",
                confidence=_optional_string(raw_item.get("confidence")) or "low",
                visibility=_optional_string(raw_item.get("visibility")) or "user_visible",
                last_verified_at=_optional_string(raw_item.get("last_verified_at")),
            )
            for raw_item in (_mapping(raw_item, "profile_memory.items[]") for raw_item in raw_items)
        )
    )


def _session_from_payload(value: object) -> SessionSummary:
    if value is None:
        return SessionSummary()
    item = _mapping(value, "intent_case.context.session")
    raw_slots = item.get("confirmed_slots") or ()
    if not isinstance(raw_slots, list | tuple):
        raise ValueError("intent_case.context.session.confirmed_slots must be a list")
    selected_notice_ref = _selected_notice_ref_from_payload(item.get("selected_notice_ref"))
    return SessionSummary(
        confirmed_slots=tuple(
            SessionSlot(
                name=_required_string(raw_slot.get("name"), "session.confirmed_slots.name"),
                value=_required_string(raw_slot.get("value"), "session.confirmed_slots.value"),
                confirmed=bool(raw_slot.get("confirmed", True)),
            )
            for raw_slot in (
                _mapping(raw_slot, "session.confirmed_slots[]") for raw_slot in raw_slots
            )
        ),
        selected_notice_ref=selected_notice_ref,
        turn_count=int(item.get("turn_count") or 0),
    )


def _selected_notice_ref_from_payload(value: object) -> SelectedNoticeRef | None:
    if value is None:
        return None
    item = _mapping(value, "intent_case.context.session.selected_notice_ref")
    return SelectedNoticeRef(
        notice_id=_required_string(item.get("notice_id"), "session.selected_notice_ref.notice_id"),
        source_family=_optional_string(item.get("source_family")),
        title=_optional_string(item.get("title")),
    )


def _mapping(value: object, field_name: str) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise ValueError(f"{field_name} must be an object")
    return dict(value)


def _required_string(value: object, field_name: str) -> str:
    normalized = _optional_string(value)
    if not normalized:
        raise ValueError(f"{field_name} is required")
    return normalized


def _optional_string(value: object) -> str:
    if value is None:
        return ""
    return str(value).strip()


def _string_tuple(value: object) -> tuple[str, ...]:
    if value is None:
        return ()
    if not isinstance(value, list | tuple):
        raise ValueError("string list field must be a list")
    return tuple(str(item).strip() for item in value if str(item).strip())


__all__ = [
    "DEFAULT_INTENT_OBSERVED_REGRESSION_PATH",
    "load_intent_observed_regression_cases",
]
