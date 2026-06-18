from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from campus_contracts import (
    ContextProjection,
    KnowledgeScope,
    ProfileMemoryItem,
    ProfileMemorySummary,
    RequestedCapability,
    SelectedNoticeRef,
    SessionSlot,
    SessionSummary,
    VersionQuery,
)

from campus_evals.fixture_registry import fixture_path
from campus_evals.intent_models import IntentCase

DEFAULT_INTENT_SYNTHETIC_CASES_PATH = fixture_path("ops.intent_synthetic_cases")

_ACCEPTED_REGRESSION = "accepted_regression"
_EXPLORATORY_CANDIDATE = "exploratory_candidate"
_REVIEW_STATUSES = {_ACCEPTED_REGRESSION, _EXPLORATORY_CANDIDATE}
_LABEL_SOURCE = "human_policy_matrix"


def load_intent_synthetic_regression_cases(
    path: str | Path | None = None,
) -> tuple[IntentCase, ...]:
    return _load_intent_synthetic_cases(path, review_status=_ACCEPTED_REGRESSION)


def load_intent_synthetic_exploratory_cases(
    path: str | Path | None = None,
) -> tuple[IntentCase, ...]:
    return _load_intent_synthetic_cases(path, review_status=_EXPLORATORY_CANDIDATE)


def _load_intent_synthetic_cases(
    path: str | Path | None,
    *,
    review_status: str,
) -> tuple[IntentCase, ...]:
    payload = _load_payload(path)
    cases = _expanded_cases(payload)
    seen_case_ids: set[str] = set()
    loaded_cases: list[IntentCase] = []
    for raw_item in cases:
        item = _mapping(raw_item, "cases[]")
        case_id = _required_string(item.get("case_id"), "case_id")
        if case_id in seen_case_ids:
            raise ValueError(f"duplicate synthetic case_id: {case_id}")
        seen_case_ids.add(case_id)

        item_review_status = _required_string(item.get("review_status"), "review_status")
        if item_review_status not in _REVIEW_STATUSES:
            raise ValueError("review_status must be accepted_regression or exploratory_candidate")
        label_source = _required_string(item.get("label_source"), "label_source")
        if label_source != _LABEL_SOURCE:
            raise ValueError("label_source must be human_policy_matrix")
        if item_review_status != review_status:
            continue

        axis = _mapping(item.get("axis"), "axis")
        loaded_cases.append(
            _intent_case_from_payload(
                case_id=case_id,
                payload=_mapping(item.get("intent_case"), "intent_case"),
                review_status=item_review_status,
                synthetic_set_version=str(payload["synthetic_set_version"]),
                generator_version=str(payload["generator_version"]),
                axis=axis,
            )
        )
    return tuple(loaded_cases)


def _load_payload(path: str | Path | None) -> dict[str, Any]:
    resolved_path = Path(path) if path is not None else DEFAULT_INTENT_SYNTHETIC_CASES_PATH
    payload = json.loads(resolved_path.read_text(encoding="utf-8"))
    if int(payload.get("schema_version") or 0) != 1:
        raise ValueError("intent synthetic cases schema_version must be 1")
    for field in ("synthetic_set_version", "generator_version"):
        _required_string(payload.get(field), field)
    raw_cases = payload.get("cases")
    if not isinstance(raw_cases, list):
        raise ValueError("intent synthetic cases must be a list")
    raw_case_matrices = payload.get("case_matrices") or []
    if not isinstance(raw_case_matrices, list):
        raise ValueError("intent synthetic case_matrices must be a list")
    return {
        "case_matrices": raw_case_matrices,
        "cases": raw_cases,
        "generator_version": payload["generator_version"],
        "synthetic_set_version": payload["synthetic_set_version"],
    }


def _expanded_cases(payload: dict[str, Any]) -> list[dict[str, Any]]:
    cases = [_mapping(item, "cases[]") for item in payload["cases"]]
    for raw_matrix in payload["case_matrices"]:
        matrix = _mapping(raw_matrix, "case_matrices[]")
        matrix_id = _required_string(matrix.get("matrix_id"), "case_matrices[].matrix_id")
        review_status = _required_string(
            matrix.get("review_status"), "case_matrices[].review_status"
        )
        label_source = _required_string(matrix.get("label_source"), "case_matrices[].label_source")
        axis = _mapping(matrix.get("axis"), "case_matrices[].axis")
        base_intent_case = _mapping(matrix.get("intent_case"), "case_matrices[].intent_case")
        raw_variants = matrix.get("variants")
        if not isinstance(raw_variants, list) or not raw_variants:
            raise ValueError(f"case_matrices.{matrix_id}.variants must be a non-empty list")
        for raw_variant in raw_variants:
            variant = _mapping(raw_variant, "case_matrices[].variants[]")
            variant_case_id = _required_string(
                variant.get("case_id"),
                "case_matrices[].variants[].case_id",
            )
            variant_intent_case = {
                **base_intent_case,
                **_mapping(
                    variant.get("intent_case") or {}, "case_matrices[].variants[].intent_case"
                ),
                "user_goal": _required_string(
                    variant.get("user_goal"),
                    "case_matrices[].variants[].user_goal",
                ),
            }
            cases.append(
                {
                    "axis": {
                        **axis,
                        **_mapping(variant.get("axis") or {}, "case_matrices[].variants[].axis"),
                    },
                    "case_id": variant_case_id,
                    "intent_case": variant_intent_case,
                    "label_source": label_source,
                    "matrix_id": matrix_id,
                    "review_status": review_status,
                }
            )
    return cases


def _intent_case_from_payload(
    *,
    case_id: str,
    payload: dict[str, Any],
    review_status: str,
    synthetic_set_version: str,
    generator_version: str,
    axis: dict[str, Any],
) -> IntentCase:
    expected_capability = _required_string(
        payload.get("expected_capability"),
        "intent_case.expected_capability",
    )
    tags = _synthetic_tags(
        _string_tuple(payload.get("tags")),
        review_status=review_status,
        synthetic_set_version=synthetic_set_version,
        generator_version=generator_version,
        axis=axis,
    )
    return IntentCase(
        case_id=case_id,
        user_goal=_required_string(payload.get("user_goal"), "intent_case.user_goal"),
        requested_capability=_requested_capability_from_payload(
            payload.get("requested_capability"),
            expected_capability,
        ),
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
        critical=bool(payload.get("critical", review_status == _ACCEPTED_REGRESSION)),
        tags=tags,
    )


def _requested_capability_from_payload(
    value: object,
    expected_capability: str,
) -> RequestedCapability | None:
    normalized = _optional_string(value)
    if normalized:
        return normalized  # type: ignore[return-value]
    return expected_capability  # type: ignore[return-value]


def _synthetic_tags(
    existing_tags: tuple[str, ...],
    *,
    review_status: str,
    synthetic_set_version: str,
    generator_version: str,
    axis: dict[str, Any],
) -> tuple[str, ...]:
    tags = [
        *existing_tags,
        "synthetic",
        "synthetic_regression"
        if review_status == _ACCEPTED_REGRESSION
        else "synthetic_exploratory",
        review_status,
        f"synthetic_set:{synthetic_set_version}",
        f"generator:{generator_version}",
    ]
    for key, value in sorted(axis.items()):
        normalized_value = _optional_string(value)
        if normalized_value:
            tags.append(f"axis_{key}:{normalized_value}")
            if key == "query_style":
                tags.append(f"query_style:{normalized_value}")
    return tuple(dict.fromkeys(tags))


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
        selected_notice_ref=_selected_notice_ref_from_payload(item.get("selected_notice_ref")),
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
        target_surface=_optional_string(item.get("target_surface")),
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
        raise ValueError("expected string list")
    return tuple(_required_string(item, "string list item") for item in value)


__all__ = [
    "DEFAULT_INTENT_SYNTHETIC_CASES_PATH",
    "load_intent_synthetic_exploratory_cases",
    "load_intent_synthetic_regression_cases",
]
