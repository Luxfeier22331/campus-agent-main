from __future__ import annotations

from dataclasses import asdict, dataclass, field
from typing import Callable, Mapping
from uuid import uuid4

from campus_contracts import (
    ActorContext,
    AuthorizedRetrievalFilter,
    AuthorizationProjection,
    ContextProjection,
    ErrorInfo,
    KnowledgeScope,
    ProfileMemoryItem,
    ProfileMemorySummary,
    SessionSlot,
    SessionSummary,
    SupervisorResponse,
    SupervisorRequest,
    TraceContext,
)
from campus_supervisor_core import (
    SupervisorError,
    build_audit_record,
    build_error_audit_record,
    handle_request,
)

from campus_supervisor_api.audit import AuditSinkError, build_jsonl_audit_sink
from campus_supervisor_api.auth import ApiAuthError, map_actor_context
from campus_supervisor_api.settings import ApiSettings


@dataclass(frozen=True, slots=True)
class HttpResponse:
    status_code: int
    json_body: dict[str, object]
    headers: dict[str, str] = field(default_factory=dict)


@dataclass(frozen=True, slots=True)
class HttpRoute:
    method: str
    path: str
    handler: Callable[[Mapping[str, str], dict[str, object] | None], HttpResponse]


SupervisorHandler = Callable[[SupervisorRequest], SupervisorResponse]


def build_routes(
    settings: ApiSettings,
    *,
    supervisor_handler: SupervisorHandler = handle_request,
) -> tuple[HttpRoute, ...]:
    return (
        HttpRoute(
            "POST",
            "/api/v1/answer",
            lambda headers, body: handle_answer(headers, body, settings, supervisor_handler),
        ),
        HttpRoute("GET", "/healthz", lambda headers, body: healthz(settings)),
        HttpRoute("GET", "/readyz", lambda headers, body: readyz(settings)),
    )


def handle_answer(
    headers: Mapping[str, str],
    body: dict[str, object] | None,
    settings: ApiSettings,
    supervisor_handler: SupervisorHandler,
) -> HttpResponse:
    audit_sink = build_jsonl_audit_sink(settings.audit_log_path)
    try:
        authenticated_actor = map_actor_context(headers, settings)
    except ApiAuthError as exc:
        return error_response(exc.status_code, ErrorInfo(code=exc.code, message=exc.message))

    payload = body or {}
    user_goal = str(payload.get("user_goal", ""))
    trace_id = str(headers.get("x-trace-id") or uuid4())
    try:
        body_actor = _parse_request_actor_projection(
            payload.get("actor"),
            auth_mode=settings.auth_mode,
        )
        body_context = _parse_context_projection(
            payload.get("context"),
            auth_mode=settings.auth_mode,
        )
        actor, context = _resolve_request_identity_projection(
            authenticated_actor=authenticated_actor,
            body_actor=body_actor,
            body_context=body_context,
            auth_mode=settings.auth_mode,
        )
        request = SupervisorRequest(
            user_goal=user_goal,
            conversation_id=str(payload.get("conversation_id", "")),
            request_id=str(payload.get("request_id", "")),
            trace=TraceContext(trace_id=trace_id),
            actor=actor,
            context=context,
            requested_capability=_parse_requested_capability(payload.get("requested_capability")),
            requested_scope=_parse_requested_scope(payload.get("requested_scope")),
            availability_target_id=_parse_optional_string(payload.get("availability_target_id")),
            follow_redirects=_parse_follow_redirects(payload.get("follow_redirects")),
        )
    except ValueError as exc:
        return error_response(400, ErrorInfo(code="invalid_request", message=str(exc)))
    try:
        response = supervisor_handler(request)
    except SupervisorError as exc:
        try:
            audit_sink(build_error_audit_record(request, error_code=exc.error_code))
        except AuditSinkError as audit_exc:
            return error_response(
                500,
                ErrorInfo(code="audit_write_failed", message=str(audit_exc), retryable=False),
            )
        return error_response(exc.http_status_code, exc.to_error_info())
    try:
        audit_sink(build_audit_record(request, response))
    except AuditSinkError as exc:
        return error_response(
            500,
            ErrorInfo(code="audit_write_failed", message=str(exc), retryable=False),
        )
    response_payload = asdict(response)
    response_payload["trace_id"] = trace_id
    return HttpResponse(status_code=200, json_body=response_payload)


def healthz(settings: ApiSettings) -> HttpResponse:
    return HttpResponse(status_code=200, json_body={"status": "ok", "app_name": settings.app_name})


def readyz(settings: ApiSettings) -> HttpResponse:
    return HttpResponse(
        status_code=200,
        json_body={
            "status": "ready",
            "runtime_provider": settings.runtime_provider,
            "supervisor_model": settings.agno_supervisor_model,
            "specialist_model": settings.agno_specialist_model,
        },
    )


def error_response(status_code: int, error: ErrorInfo) -> HttpResponse:
    return HttpResponse(status_code=status_code, json_body={"error": asdict(error)})


def _resolve_request_identity_projection(
    *,
    authenticated_actor: ActorContext,
    body_actor: ActorContext | None,
    body_context: ContextProjection | None,
    auth_mode: str,
) -> tuple[ActorContext, ContextProjection]:
    if auth_mode == "trusted-worker":
        if body_context is None:
            raise ValueError("trusted-worker requests must provide context")
        if body_actor is None and body_context.actor == ActorContext():
            raise ValueError("context.actor is required in trusted-worker mode")
        if body_actor is not None and body_context.actor == ActorContext():
            body_context = ContextProjection(
                actor=body_actor,
                authorization=body_context.authorization,
                profile_memory=body_context.profile_memory,
                session=body_context.session,
            )
        if body_actor is not None and body_context.actor != body_actor:
            raise ValueError("actor and context.actor must match")
        actor = body_actor or body_context.actor
        return actor, body_context

    if body_actor is None and body_context is None:
        return authenticated_actor, ContextProjection(
            actor=authenticated_actor,
            authorization=_default_authorization_projection(authenticated_actor),
        )
    if body_context is None:
        assert body_actor is not None
        return body_actor, ContextProjection(
            actor=body_actor,
            authorization=_default_authorization_projection(body_actor),
        )
    if body_actor is None:
        return body_context.actor, body_context
    if body_context.actor == ActorContext():
        authorization = body_context.authorization
        if authorization == AuthorizationProjection():
            authorization = _default_authorization_projection(body_actor)
        body_context = ContextProjection(
            actor=body_actor,
            authorization=authorization,
            profile_memory=body_context.profile_memory,
            session=body_context.session,
        )
    if body_context.actor != body_actor:
        raise ValueError("actor and context.actor must match")
    return body_actor, body_context


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
        source_type = _parse_optional_string(raw_item.get("source_type"))
        confidence = _parse_optional_string(raw_item.get("confidence"))
        visibility = _parse_optional_string(raw_item.get("visibility"))
        last_verified_at = _parse_optional_string(raw_item.get("last_verified_at"))
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
                item_id=_require_string(raw_item.get("item_id"), field_name="context.profile_memory.items[].item_id"),
                key=_require_string(raw_item.get("key"), field_name="context.profile_memory.items[].key"),
                value=_require_string(raw_item.get("value"), field_name="context.profile_memory.items[].value"),
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
                name=_require_string(raw_slot.get("name"), field_name="context.session.confirmed_slots[].name"),
                value=_require_string(raw_slot.get("value"), field_name="context.session.confirmed_slots[].value"),
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


def _parse_string_tuple(raw_value: object, *, field_name: str) -> tuple[str, ...]:
    if raw_value is None:
        return ()
    if not isinstance(raw_value, list):
        raise ValueError(f"{field_name} must be an array")

    values: list[str] = []
    for item in raw_value:
        if not isinstance(item, str):
            raise ValueError(f"{field_name} must only contain strings")
        normalized = item.strip()
        if normalized:
            values.append(normalized)
    return tuple(values)


def _require_string(raw_value: object, *, field_name: str) -> str:
    value = _parse_optional_string(raw_value)
    if value is None:
        raise ValueError(f"{field_name} must be a non-empty string")
    return value


def _parse_requested_scope(raw_scope: object) -> KnowledgeScope | None:
    if raw_scope is None:
        return None
    if not isinstance(raw_scope, dict):
        raise ValueError("requested_scope must be an object")
    corpus = str(raw_scope.get("corpus", "")).strip()
    collection = str(raw_scope.get("collection", "")).strip()
    if not corpus or not collection:
        raise ValueError("requested_scope requires corpus and collection")
    return KnowledgeScope(corpus=corpus, collection=collection)


def _parse_requested_capability(raw_capability: object) -> str | None:
    if raw_capability is None:
        return None
    capability = str(raw_capability).strip()
    return capability or None


def _parse_optional_string(raw_value: object) -> str | None:
    if raw_value is None:
        return None
    value = str(raw_value).strip()
    return value or None


def _parse_follow_redirects(raw_value: object) -> bool:
    if raw_value is None:
        return True
    if isinstance(raw_value, bool):
        return raw_value
    raise ValueError("follow_redirects must be a boolean")


def _parse_request_actor_projection(
    raw_actor: object,
    *,
    auth_mode: str,
) -> ActorContext | None:
    if raw_actor is None:
        return None
    if auth_mode != "trusted-worker":
        raise ValueError("actor projection is only accepted in trusted-worker mode")
    return _parse_actor_context(raw_actor, field_prefix="actor")


def _parse_context_projection(
    raw_context: object,
    *,
    auth_mode: str,
) -> ContextProjection | None:
    if raw_context is None:
        return None
    if auth_mode != "trusted-worker":
        raise ValueError("context projection is only accepted in trusted-worker mode")
    if not isinstance(raw_context, dict):
        raise ValueError("context must be an object")

    projected_actor = _parse_actor_context(raw_context.get("actor"), field_prefix="context.actor")
    authorization = _parse_authorization_projection(
        raw_context.get("authorization"),
        actor=projected_actor,
        require_explicit_filter=True,
    )
    return ContextProjection(
        actor=projected_actor,
        authorization=authorization,
        profile_memory=_parse_profile_memory_summary(raw_context.get("profile_memory")),
        session=_parse_session_summary(raw_context.get("session")),
    )


def _parse_actor_context(raw_actor: object, *, field_prefix: str) -> ActorContext:
    if raw_actor is None:
        return ActorContext()
    if not isinstance(raw_actor, dict):
        raise ValueError(f"{field_prefix} must be an object")
    return ActorContext(
        user_id=_parse_optional_string(raw_actor.get("user_id")) or "",
        principal_id=_parse_optional_string(raw_actor.get("principal_id")) or "",
        principal_type=_parse_optional_string(raw_actor.get("principal_type")) or "",
        roles=_parse_string_tuple(raw_actor.get("roles"), field_name=f"{field_prefix}.roles"),
        departments=_parse_string_tuple(
            raw_actor.get("departments"),
            field_name=f"{field_prefix}.departments",
        ),
        groups=_parse_string_tuple(raw_actor.get("groups"), field_name=f"{field_prefix}.groups"),
        campus_scope=_parse_optional_string(raw_actor.get("campus_scope")),
        cohort=_parse_optional_string(raw_actor.get("cohort")),
        major=_parse_optional_string(raw_actor.get("major")),
        program=_parse_optional_string(raw_actor.get("program")),
    )


def _parse_authorization_projection(
    raw_authorization: object,
    *,
    actor: ActorContext,
    require_explicit_filter: bool = False,
) -> AuthorizationProjection:
    if raw_authorization is None:
        if require_explicit_filter:
            raise ValueError("context.authorization is required")
        return _default_authorization_projection(actor)
    if not isinstance(raw_authorization, dict):
        raise ValueError("context.authorization must be an object")

    entitlement_groups = _parse_string_tuple(
        raw_authorization.get("entitlement_groups"),
        field_name="context.authorization.entitlement_groups",
    )
    visibility_scope = _parse_optional_string(raw_authorization.get("visibility_scope"))
    retrieval_filter = _parse_authorized_retrieval_filter(
        raw_authorization.get("retrieval_filter"),
        require_explicit=require_explicit_filter,
    )
    return AuthorizationProjection(
        principal_id=_parse_optional_string(raw_authorization.get("principal_id")) or actor.principal_id or actor.user_id,
        projection_source=_parse_optional_string(raw_authorization.get("projection_source")) or "",
        entitlement_snapshot_id=_parse_optional_string(raw_authorization.get("entitlement_snapshot_id")) or "",
        entitlement_groups=entitlement_groups,
        visibility_scope=visibility_scope,
        applicability_scope=_parse_optional_string(raw_authorization.get("applicability_scope")),
        ownership_scopes=_parse_string_tuple(
            raw_authorization.get("ownership_scopes"),
            field_name="context.authorization.ownership_scopes",
        ),
        approval_state=_parse_optional_string(raw_authorization.get("approval_state")) or "",
        retrieval_filter=retrieval_filter,
    )


def _parse_authorized_retrieval_filter(
    raw_filter: object,
    *,
    require_explicit: bool = False,
) -> AuthorizedRetrievalFilter:
    if raw_filter is None:
        if require_explicit:
            raise ValueError("context.authorization.retrieval_filter is required")
        return AuthorizedRetrievalFilter()
    if not isinstance(raw_filter, dict):
        raise ValueError("context.authorization.retrieval_filter must be an object")

    return AuthorizedRetrievalFilter(
        entitlement_groups=_parse_string_tuple(
            raw_filter.get("entitlement_groups"),
            field_name="context.authorization.retrieval_filter.entitlement_groups",
        ),
        visibility_level=_parse_optional_string(raw_filter.get("visibility_level")) or "public",
        acl_groups=_parse_string_tuple(
            raw_filter.get("acl_groups"),
            field_name="context.authorization.retrieval_filter.acl_groups",
        ),
        visibility_scope=_parse_optional_string(raw_filter.get("visibility_scope")),
        campus_scope=_parse_optional_string(raw_filter.get("campus_scope")),
        policy_projection_version=_parse_optional_string(raw_filter.get("policy_projection_version")) or "",
    )


def _default_authorization_projection(actor: ActorContext) -> AuthorizationProjection:
    principal_id = actor.principal_id or actor.user_id
    return AuthorizationProjection(
        principal_id=principal_id,
        entitlement_groups=(),
        visibility_scope=None,
        retrieval_filter=AuthorizedRetrievalFilter(
            entitlement_groups=(),
            acl_groups=(),
            visibility_scope=None,
            campus_scope=None,
        ),
    )
