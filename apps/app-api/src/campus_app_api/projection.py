from __future__ import annotations

from dataclasses import dataclass, field

from campus_contracts import (
    DEFAULT_POLICY_PROJECTION_VERSION,
    ActorContext,
    AuthorizationProjection,
    AuthorizedRetrievalFilter,
    ContextProjection,
    MemorySourceType,
    MemoryVisibility,
    ProfileMemoryItem,
    ProfileMemorySummary,
    SessionSlot,
    SessionSummary,
)


@dataclass(frozen=True, slots=True)
class VerifiedIdentityInput:
    user_id: str
    principal_id: str = ""
    principal_type: str = ""
    roles: tuple[str, ...] = field(default_factory=tuple)
    departments: tuple[str, ...] = field(default_factory=tuple)
    cohort: str | None = None
    major: str | None = None
    program: str | None = None


@dataclass(frozen=True, slots=True)
class ProfileMemoryRecord:
    item_id: str
    key: str
    value: str
    source_type: MemorySourceType = "user_declared"
    confidence: str = "low"
    visibility: MemoryVisibility = "user_visible"
    last_verified_at: str = ""


@dataclass(frozen=True, slots=True)
class SessionSlotRecord:
    name: str
    value: str
    confirmed: bool = True


@dataclass(frozen=True, slots=True)
class AuthorizedRetrievalFilterInput:
    entitlement_groups: tuple[str, ...] = field(default_factory=tuple)
    visibility_level: str = "public"
    visibility_scope: str | None = None
    policy_projection_version: str = DEFAULT_POLICY_PROJECTION_VERSION

    def __post_init__(self) -> None:
        visibility_level = self.visibility_level.strip() or "public"
        policy_projection_version = (
            self.policy_projection_version.strip() or DEFAULT_POLICY_PROJECTION_VERSION
        )

        if visibility_level != self.visibility_level:
            object.__setattr__(self, "visibility_level", visibility_level)
        if policy_projection_version != self.policy_projection_version:
            object.__setattr__(self, "policy_projection_version", policy_projection_version)


@dataclass(frozen=True, slots=True)
class AuthorizationInput:
    principal_id: str = ""
    projection_source: str = ""
    entitlement_snapshot_id: str = ""
    entitlement_groups: tuple[str, ...] = field(default_factory=tuple)
    visibility_scope: str | None = None
    applicability_scope: str | None = None
    ownership_scopes: tuple[str, ...] = field(default_factory=tuple)
    approval_state: str = ""
    retrieval_filter: AuthorizedRetrievalFilterInput | None = None


def build_context_projection(
    *,
    identity: VerifiedIdentityInput,
    authorization: AuthorizationInput | None = None,
    profile_records: tuple[ProfileMemoryRecord, ...] = (),
    session_slots: tuple[SessionSlotRecord, ...] = (),
    turn_count: int = 0,
) -> ContextProjection:
    profile_items = tuple(
        ProfileMemoryItem(
            item_id=record.item_id,
            key=record.key,
            value=record.value,
            source_type=record.source_type,
            confidence=record.confidence,
            visibility=record.visibility,
            last_verified_at=record.last_verified_at,
        )
        for record in profile_records
        if record.value.strip()
    )
    confirmed_slots = tuple(
        SessionSlot(name=slot.name, value=slot.value, confirmed=True)
        for slot in session_slots
        if slot.confirmed and slot.value.strip()
    )
    return ContextProjection(
        actor=ActorContext(
            user_id=identity.user_id,
            principal_id=identity.principal_id,
            principal_type=identity.principal_type,
            roles=identity.roles,
            departments=identity.departments,
            cohort=identity.cohort,
            major=identity.major,
            program=identity.program,
        ),
        authorization=_build_authorization_projection(identity, authorization),
        profile_memory=ProfileMemorySummary(items=profile_items),
        session=SessionSummary(
            confirmed_slots=confirmed_slots,
            turn_count=turn_count,
        ),
    )


def _build_authorization_projection(
    identity: VerifiedIdentityInput,
    authorization: AuthorizationInput | None,
) -> AuthorizationProjection:
    if authorization is None:
        principal_id = identity.principal_id or identity.user_id
        return AuthorizationProjection(
            principal_id=principal_id,
            projection_source=_default_projection_source(identity.principal_type),
            entitlement_groups=(),
            visibility_scope=None,
            retrieval_filter=AuthorizedRetrievalFilter(
                entitlement_groups=(),
                visibility_scope=None,
            ),
        )

    retrieval_filter = authorization.retrieval_filter or AuthorizedRetrievalFilterInput(
        entitlement_groups=authorization.entitlement_groups,
        visibility_scope=authorization.visibility_scope,
    )
    principal_id = authorization.principal_id or identity.principal_id or identity.user_id
    return AuthorizationProjection(
        principal_id=principal_id,
        projection_source=authorization.projection_source
        or _default_projection_source(identity.principal_type),
        entitlement_snapshot_id=authorization.entitlement_snapshot_id,
        entitlement_groups=authorization.entitlement_groups,
        visibility_scope=authorization.visibility_scope,
        applicability_scope=authorization.applicability_scope,
        ownership_scopes=authorization.ownership_scopes,
        approval_state=authorization.approval_state,
        retrieval_filter=AuthorizedRetrievalFilter(
            entitlement_groups=retrieval_filter.entitlement_groups,
            visibility_level=retrieval_filter.visibility_level,
            visibility_scope=retrieval_filter.visibility_scope,
            policy_projection_version=retrieval_filter.policy_projection_version,
        ),
    )


def _default_projection_source(principal_type: str) -> str:
    normalized = principal_type.strip()
    if normalized in {"campus_member", "student", "staff", "faculty"}:
        return "campus_identity"
    if normalized == "operator":
        return "operator_headers"
    if normalized == "service":
        return "service_auth"
    return ""
