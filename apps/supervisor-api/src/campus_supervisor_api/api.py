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
        projected_context = _parse_context_projection(
            payload.get("context"),
            authenticated_actor=authenticated_actor,
            auth_mode=settings.auth_mode,
        )
        request_actor = projected_context.actor if projected_context is not None else authenticated_actor
        request = SupervisorRequest(
            user_goal=user_goal,
            conversation_id=str(payload.get("conversation_id", "")),
            request_id=str(payload.get("request_id", "")),
            trace=TraceContext(trace_id=trace_id),
            actor=request_actor,
            context=projected_context or ContextProjection(),
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


def _parse_context_projection(
    raw_context: object,
    *,
    authenticated_actor: ActorContext,
    auth_mode: str,
) -> ContextProjection | None:
    if raw_context is None:
        return None
    if auth_mode != "trusted-worker":
        raise ValueError("context projection is only accepted in trusted-worker mode")
    if not isinstance(raw_context, dict):
        raise ValueError("context must be an object")

    merged_actor = _merge_projected_actor(
        _parse_actor_context(raw_context.get("actor")),
        authenticated_actor,
    )
    authorization = _parse_authorization_projection(
        raw_context.get("authorization"),
        actor=merged_actor,
    )
    return ContextProjection(
        actor=merged_actor,
        authorization=authorization,
        profile_memory=_parse_profile_memory_summary(raw_context.get("profile_memory")),
        session=_parse_session_summary(raw_context.get("session")),
    )


def _merge_projected_actor(
    projected_actor: ActorContext,
    authenticated_actor: ActorContext,
) -> ActorContext:
    if (
        projected_actor.user_id
        and authenticated_actor.user_id
        and projected_actor.user_id != authenticated_actor.user_id
    ):
        raise ValueError("context.actor.user_id must match authenticated actor.user_id")
    return ActorContext(
        user_id=projected_actor.user_id or authenticated_actor.user_id,
        principal_id=projected_actor.principal_id,
        roles=projected_actor.roles or authenticated_actor.roles,
        departments=projected_actor.departments,
        groups=projected_actor.groups or authenticated_actor.groups,
        campus_scope=projected_actor.campus_scope or authenticated_actor.campus_scope,
        cohort=projected_actor.cohort,
        major=projected_actor.major,
        program=projected_actor.program,
    )


def _parse_actor_context(raw_actor: object) -> ActorContext:
    if raw_actor is None:
        return ActorContext()
    if not isinstance(raw_actor, dict):
        raise ValueError("context.actor must be an object")
    return ActorContext(
        user_id=_parse_text(raw_actor.get("user_id")),
        principal_id=_parse_text(raw_actor.get("principal_id")),
        roles=_parse_string_tuple(raw_actor.get("roles"), field_name="context.actor.roles"),
        departments=_parse_string_tuple(
            raw_actor.get("departments"),
            field_name="context.actor.departments",
        ),
        groups=_parse_string_tuple(raw_actor.get("groups"), field_name="context.actor.groups"),
        campus_scope=_parse_nullable_text(raw_actor.get("campus_scope")),
        cohort=_parse_nullable_text(raw_actor.get("cohort")),
        major=_parse_nullable_text(raw_actor.get("major")),
        program=_parse_nullable_text(raw_actor.get("program")),
    )


def _parse_authorization_projection(
    raw_authorization: object,
    *,
    actor: ActorContext,
) -> AuthorizationProjection:
    if raw_authorization is None:
        return _default_authorization_projection(actor)
    if not isinstance(raw_authorization, dict):
        raise ValueError("context.authorization must be an object")

    entitlement_groups = _parse_string_tuple(
        raw_authorization.get("entitlement_groups"),
        field_name="context.authorization.entitlement_groups",
    )
    visibility_scope = _parse_nullable_text(raw_authorization.get("visibility_scope"))
    retrieval_filter = _parse_authorized_retrieval_filter(
        raw_authorization.get("retrieval_filter"),
        fallback_entitlement_groups=entitlement_groups,
        fallback_visibility_scope=visibility_scope,
        fallback_campus_scope=actor.campus_scope,
    )
    return AuthorizationProjection(
        principal_id=_parse_text(raw_authorization.get("principal_id")) or actor.principal_id or actor.user_id,
        entitlement_snapshot_id=_parse_text(raw_authorization.get("entitlement_snapshot_id")),
        entitlement_groups=entitlement_groups,
        visibility_scope=visibility_scope,
        applicability_scope=_parse_nullable_text(raw_authorization.get("applicability_scope")),
        ownership_scopes=_parse_string_tuple(
            raw_authorization.get("ownership_scopes"),
            field_name="context.authorization.ownership_scopes",
        ),
        approval_state=_parse_text(raw_authorization.get("approval_state")),
        retrieval_filter=retrieval_filter,
    )


def _parse_authorized_retrieval_filter(
    raw_filter: object,
    *,
    fallback_entitlement_groups: tuple[str, ...],
    fallback_visibility_scope: str | None,
    fallback_campus_scope: str | None,
) -> AuthorizedRetrievalFilter:
    if raw_filter is None:
        return AuthorizedRetrievalFilter(
            entitlement_groups=fallback_entitlement_groups,
            visibility_scope=fallback_visibility_scope,
            campus_scope=fallback_campus_scope,
        )
    if not isinstance(raw_filter, dict):
        raise ValueError("context.authorization.retrieval_filter must be an object")
    entitlement_groups = raw_filter.get("entitlement_groups")
    acl_groups = raw_filter.get("acl_groups")
    visibility_level = raw_filter.get("visibility_level")
    visibility_scope = raw_filter.get("visibility_scope")
    campus_scope = raw_filter.get("campus_scope")
    policy_projection_version = raw_filter.get("policy_projection_version")
    return AuthorizedRetrievalFilter(
        entitlement_groups=(
            _parse_string_tuple(
                entitlement_groups,
                field_name="context.authorization.retrieval_filter.entitlement_groups",
            )
            if entitlement_groups is not None
            else (
                _parse_string_tuple(
                    acl_groups,
                    field_name="context.authorization.retrieval_filter.acl_groups",
                )
                if acl_groups is not None
                else fallback_entitlement_groups
            )
        ),
        visibility_level=(
            _parse_text(visibility_level) or "public"
            if visibility_level is not None
            else "public"
        ),
        acl_groups=(
            _parse_string_tuple(
                acl_groups,
                field_name="context.authorization.retrieval_filter.acl_groups",
            )
            if acl_groups is not None
            else fallback_entitlement_groups
        ),
        visibility_scope=(
            _parse_nullable_text(visibility_scope)
            if visibility_scope is not None
            else fallback_visibility_scope
        ),
        campus_scope=(
            _parse_nullable_text(campus_scope)
            if campus_scope is not None
            else fallback_campus_scope
        ),
        policy_projection_version=_parse_text(policy_projection_version),
    )


def _default_authorization_projection(actor: ActorContext) -> AuthorizationProjection:
    principal_id = actor.principal_id or actor.user_id
    return AuthorizationProjection(
        principal_id=principal_id,
        entitlement_groups=actor.groups,
        visibility_scope=actor.campus_scope,
        retrieval_filter=AuthorizedRetrievalFilter(
            entitlement_groups=actor.groups,
            visibility_scope=actor.campus_scope,
        ),
    )


def _parse_profile_memory_summary(raw_profile_memory: object) -> ProfileMemorySummary:
    if raw_profile_memory is None:
        return ProfileMemorySummary()
    if not isinstance(raw_profile_memory, dict):
        raise ValueError("context.profile_memory must be an object")
    raw_items = raw_profile_memory.get("items", ())
    if not isinstance(raw_items, list):
        raise ValueError("context.profile_memory.items must be a list")
    return ProfileMemorySummary(
        items=tuple(_parse_profile_memory_item(raw_item) for raw_item in raw_items),
    )


def _parse_profile_memory_item(raw_item: object) -> ProfileMemoryItem:
    if not isinstance(raw_item, dict):
        raise ValueError("context.profile_memory.items entries must be objects")
    return ProfileMemoryItem(
        item_id=_parse_text(raw_item.get("item_id")),
        key=_parse_text(raw_item.get("key")),
        value=_parse_text(raw_item.get("value")),
        source_type=_parse_text(raw_item.get("source_type")) or "user_declared",
        confidence=_parse_text(raw_item.get("confidence")) or "low",
        visibility=_parse_text(raw_item.get("visibility")) or "user_visible",
        last_verified_at=_parse_text(raw_item.get("last_verified_at")),
    )


def _parse_session_summary(raw_session: object) -> SessionSummary:
    if raw_session is None:
        return SessionSummary()
    if not isinstance(raw_session, dict):
        raise ValueError("context.session must be an object")
    raw_slots = raw_session.get("confirmed_slots", ())
    if not isinstance(raw_slots, list):
        raise ValueError("context.session.confirmed_slots must be a list")
    turn_count = raw_session.get("turn_count", 0)
    if not isinstance(turn_count, int):
        raise ValueError("context.session.turn_count must be an integer")
    return SessionSummary(
        confirmed_slots=tuple(_parse_session_slot(raw_slot) for raw_slot in raw_slots),
        turn_count=turn_count,
    )


def _parse_session_slot(raw_slot: object) -> SessionSlot:
    if not isinstance(raw_slot, dict):
        raise ValueError("context.session.confirmed_slots entries must be objects")
    confirmed = raw_slot.get("confirmed", True)
    if not isinstance(confirmed, bool):
        raise ValueError("context.session.confirmed_slots[].confirmed must be a boolean")
    return SessionSlot(
        name=_parse_text(raw_slot.get("name")),
        value=_parse_text(raw_slot.get("value")),
        confirmed=confirmed,
    )


def _parse_string_tuple(raw_value: object, *, field_name: str) -> tuple[str, ...]:
    if raw_value is None:
        return ()
    if not isinstance(raw_value, list):
        raise ValueError(f"{field_name} must be a list")
    return tuple(str(item).strip() for item in raw_value if str(item).strip())


def _parse_text(raw_value: object) -> str:
    if raw_value is None:
        return ""
    return str(raw_value).strip()


def _parse_nullable_text(raw_value: object) -> str | None:
    value = _parse_text(raw_value)
    return value or None
