from __future__ import annotations

from campus_contracts import (
    ActorContext,
    AuthorizationProjection,
    AuthorizedRetrievalFilter,
    ContextProjection,
    KnowledgeScope,
    ProfileMemoryItem,
    ProfileMemorySummary,
    SessionSlot,
    SessionSummary,
    TraceContext,
    VersionQuery,
)

from campus_supervisor_agent_worker.bridge_parse_utils import (
    parse_optional_string,
    parse_string_tuple,
    require_string,
)


def parse_actor_context(raw_actor: object, *, field_prefix: str) -> ActorContext:
    if raw_actor is None:
        return ActorContext()
    if not isinstance(raw_actor, dict):
        raise ValueError(f"{field_prefix} must be an object")
    _assert_supported_actor_context_fields(raw_actor, field_prefix=field_prefix)
    return ActorContext(
        user_id=parse_optional_string(raw_actor.get("user_id")) or "",
        principal_id=parse_optional_string(raw_actor.get("principal_id")) or "",
        principal_type=parse_optional_string(raw_actor.get("principal_type")) or "",
        roles=parse_string_tuple(raw_actor.get("roles"), field_name=f"{field_prefix}.roles"),
        departments=parse_string_tuple(
            raw_actor.get("departments"),
            field_name=f"{field_prefix}.departments",
        ),
        cohort=parse_optional_string(raw_actor.get("cohort")),
        major=parse_optional_string(raw_actor.get("major")),
        program=parse_optional_string(raw_actor.get("program")),
    )


def parse_bridge_context_projection(raw_context: object) -> ContextProjection:
    if not isinstance(raw_context, dict):
        raise ValueError("context must be an object")

    projected_actor = parse_actor_context(raw_context.get("actor"), field_prefix="context.actor")
    if projected_actor == ActorContext():
        raise ValueError("context.actor is required")

    return ContextProjection(
        actor=projected_actor,
        authorization=_parse_authorization_projection(
            raw_context.get("authorization"),
            actor=projected_actor,
        ),
        profile_memory=_parse_profile_memory_summary(raw_context.get("profile_memory")),
        session=_parse_session_summary(raw_context.get("session")),
    )


def parse_requested_scope(raw_scope: object) -> KnowledgeScope | None:
    if raw_scope is None:
        return None
    if not isinstance(raw_scope, dict):
        raise ValueError("requested_scope must be an object")
    corpus = str(raw_scope.get("corpus", "")).strip()
    collection = str(raw_scope.get("collection", "")).strip()
    if not corpus or not collection:
        raise ValueError("requested_scope requires corpus and collection")
    return KnowledgeScope(corpus=corpus, collection=collection)


def parse_trace_context(raw_trace: object) -> TraceContext:
    if not isinstance(raw_trace, dict):
        raise ValueError("trace must be an object")
    trace_id = require_string(raw_trace.get("trace_id"), field_name="trace.trace_id")
    return TraceContext(trace_id=trace_id)


def parse_version_query(raw_version_query: object) -> VersionQuery:
    if raw_version_query is None:
        return VersionQuery()
    if not isinstance(raw_version_query, dict):
        raise ValueError("version_query must be an object")
    mode = parse_optional_string(raw_version_query.get("mode"))
    as_of = parse_optional_string(raw_version_query.get("as_of"))
    version_id = parse_optional_string(raw_version_query.get("version_id"))
    compare_to_version_id = parse_optional_string(raw_version_query.get("compare_to_version_id"))
    return VersionQuery(
        mode="current" if mode is None else mode,
        as_of="" if as_of is None else as_of,
        version_id="" if version_id is None else version_id,
        compare_to_version_id="" if compare_to_version_id is None else compare_to_version_id,
    )


def _parse_authorization_projection(
    raw_authorization: object,
    *,
    actor: ActorContext,
) -> AuthorizationProjection:
    if raw_authorization is None:
        raise ValueError("context.authorization is required")
    if not isinstance(raw_authorization, dict):
        raise ValueError("context.authorization must be an object")

    entitlement_groups = parse_string_tuple(
        raw_authorization.get("entitlement_groups"),
        field_name="context.authorization.entitlement_groups",
    )
    visibility_scope = parse_optional_string(raw_authorization.get("visibility_scope"))
    retrieval_filter = _parse_authorized_retrieval_filter(
        raw_authorization.get("retrieval_filter"),
    )
    return AuthorizationProjection(
        principal_id=parse_optional_string(raw_authorization.get("principal_id"))
        or actor.principal_id
        or actor.user_id,
        projection_source=parse_optional_string(raw_authorization.get("projection_source")) or "",
        entitlement_snapshot_id=parse_optional_string(
            raw_authorization.get("entitlement_snapshot_id")
        )
        or "",
        entitlement_groups=entitlement_groups,
        visibility_scope=visibility_scope,
        applicability_scope=parse_optional_string(raw_authorization.get("applicability_scope")),
        ownership_scopes=parse_string_tuple(
            raw_authorization.get("ownership_scopes"),
            field_name="context.authorization.ownership_scopes",
        ),
        approval_state=parse_optional_string(raw_authorization.get("approval_state")) or "",
        retrieval_filter=retrieval_filter,
    )


def _parse_authorized_retrieval_filter(raw_filter: object) -> AuthorizedRetrievalFilter:
    if raw_filter is None:
        raise ValueError("context.authorization.retrieval_filter is required")
    if not isinstance(raw_filter, dict):
        raise ValueError("context.authorization.retrieval_filter must be an object")
    _assert_supported_retrieval_filter_fields(raw_filter)

    return AuthorizedRetrievalFilter(
        entitlement_groups=parse_string_tuple(
            raw_filter.get("entitlement_groups"),
            field_name="context.authorization.retrieval_filter.entitlement_groups",
        ),
        visibility_level=parse_optional_string(raw_filter.get("visibility_level")) or "public",
        visibility_scope=parse_optional_string(raw_filter.get("visibility_scope")),
        policy_projection_version=parse_optional_string(raw_filter.get("policy_projection_version"))
        or "",
    )


def _parse_profile_memory_summary(raw_memory: object) -> ProfileMemorySummary:
    if raw_memory is None:
        return ProfileMemorySummary()
    if not isinstance(raw_memory, dict):
        raise ValueError("context.profile_memory must be an object")

    raw_items = raw_memory.get("items", [])
    if not isinstance(raw_items, list):
        raise ValueError("context.profile_memory.items must be an array")

    items: list[ProfileMemoryItem] = []
    for raw_item in raw_items:
        if not isinstance(raw_item, dict):
            raise ValueError("context.profile_memory.items must only contain objects")
        kwargs: dict[str, str] = {}
        source_type = parse_optional_string(raw_item.get("source_type"))
        confidence = parse_optional_string(raw_item.get("confidence"))
        visibility = parse_optional_string(raw_item.get("visibility"))
        last_verified_at = parse_optional_string(raw_item.get("last_verified_at"))
        if source_type is not None:
            kwargs["source_type"] = source_type
        if confidence is not None:
            kwargs["confidence"] = confidence
        if visibility is not None:
            kwargs["visibility"] = visibility
        if last_verified_at is not None:
            kwargs["last_verified_at"] = last_verified_at
        items.append(
            ProfileMemoryItem(
                item_id=require_string(
                    raw_item.get("item_id"), field_name="context.profile_memory.items[].item_id"
                ),
                key=require_string(
                    raw_item.get("key"), field_name="context.profile_memory.items[].key"
                ),
                value=require_string(
                    raw_item.get("value"), field_name="context.profile_memory.items[].value"
                ),
                **kwargs,
            )
        )

    return ProfileMemorySummary(items=tuple(items))


def _parse_session_summary(raw_session: object) -> SessionSummary:
    if raw_session is None:
        return SessionSummary()
    if not isinstance(raw_session, dict):
        raise ValueError("context.session must be an object")

    raw_slots = raw_session.get("confirmed_slots", [])
    if not isinstance(raw_slots, list):
        raise ValueError("context.session.confirmed_slots must be an array")

    confirmed_slots: list[SessionSlot] = []
    for raw_slot in raw_slots:
        if not isinstance(raw_slot, dict):
            raise ValueError("context.session.confirmed_slots must only contain objects")
        confirmed = raw_slot.get("confirmed", True)
        if not isinstance(confirmed, bool):
            raise ValueError("context.session.confirmed_slots[].confirmed must be a boolean")
        confirmed_slots.append(
            SessionSlot(
                name=require_string(
                    raw_slot.get("name"), field_name="context.session.confirmed_slots[].name"
                ),
                value=require_string(
                    raw_slot.get("value"), field_name="context.session.confirmed_slots[].value"
                ),
                confirmed=confirmed,
            )
        )

    raw_turn_count = raw_session.get("turn_count", 0)
    if not isinstance(raw_turn_count, int) or isinstance(raw_turn_count, bool):
        raise ValueError("context.session.turn_count must be an integer")

    return SessionSummary(
        confirmed_slots=tuple(confirmed_slots),
        turn_count=raw_turn_count,
    )


def _assert_supported_actor_context_fields(
    raw_actor: dict[str, object], *, field_prefix: str
) -> None:
    supported_fields = (
        "user_id",
        "principal_id",
        "principal_type",
        "roles",
        "departments",
        "cohort",
        "major",
        "program",
    )
    unsupported_fields = tuple(
        field_name for field_name in raw_actor if field_name not in supported_fields
    )
    if unsupported_fields:
        joined = ", ".join(f"{field_prefix}.{field_name}" for field_name in unsupported_fields)
        raise ValueError(f"unsupported actor context fields are not allowed: {joined}")


def _assert_supported_retrieval_filter_fields(raw_filter: dict[str, object]) -> None:
    supported_fields = (
        "entitlement_groups",
        "visibility_level",
        "visibility_scope",
        "policy_projection_version",
    )
    unsupported_fields = tuple(
        field_name for field_name in raw_filter if field_name not in supported_fields
    )
    if unsupported_fields:
        joined = ", ".join(
            f"context.authorization.retrieval_filter.{field_name}"
            for field_name in unsupported_fields
        )
        raise ValueError(f"unsupported retrieval filter fields are not allowed: {joined}")
