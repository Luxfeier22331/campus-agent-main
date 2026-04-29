from __future__ import annotations

from campus_contracts import (
    ActorContext,
    AuthorizationProjection,
    AuthorizedRetrievalFilter,
)

from campus_supervisor_agent_worker.bridge_parse_utils import (
    parse_optional_string,
    parse_string_tuple,
)


def parse_authorization_projection(
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
    visibility_scope = parse_optional_string(
        raw_authorization.get("visibility_scope"),
        field_name="context.authorization.visibility_scope",
    )
    retrieval_filter = parse_authorized_retrieval_filter(
        raw_authorization.get("retrieval_filter"),
    )
    return AuthorizationProjection(
        principal_id=parse_optional_string(
            raw_authorization.get("principal_id"),
            field_name="context.authorization.principal_id",
        )
        or actor.principal_id
        or actor.user_id,
        projection_source=parse_optional_string(
            raw_authorization.get("projection_source"),
            field_name="context.authorization.projection_source",
        )
        or "",
        entitlement_snapshot_id=parse_optional_string(
            raw_authorization.get("entitlement_snapshot_id"),
            field_name="context.authorization.entitlement_snapshot_id",
        )
        or "",
        entitlement_groups=entitlement_groups,
        visibility_scope=visibility_scope,
        applicability_scope=parse_optional_string(
            raw_authorization.get("applicability_scope"),
            field_name="context.authorization.applicability_scope",
        ),
        ownership_scopes=parse_string_tuple(
            raw_authorization.get("ownership_scopes"),
            field_name="context.authorization.ownership_scopes",
        ),
        approval_state=parse_optional_string(
            raw_authorization.get("approval_state"),
            field_name="context.authorization.approval_state",
        )
        or "",
        retrieval_filter=retrieval_filter,
    )


def parse_authorized_retrieval_filter(raw_filter: object) -> AuthorizedRetrievalFilter:
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
        visibility_level=parse_optional_string(
            raw_filter.get("visibility_level"),
            field_name="context.authorization.retrieval_filter.visibility_level",
        )
        or "public",
        visibility_scope=parse_optional_string(
            raw_filter.get("visibility_scope"),
            field_name="context.authorization.retrieval_filter.visibility_scope",
        ),
        policy_projection_version=parse_optional_string(
            raw_filter.get("policy_projection_version"),
            field_name="context.authorization.retrieval_filter.policy_projection_version",
        )
        or "",
    )


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


__all__ = ["parse_authorization_projection", "parse_authorized_retrieval_filter"]
