from __future__ import annotations

from campus_contracts import ActorContext

from campus_supervisor_agent_worker.bridge_parse_utils import (
    parse_optional_string,
    parse_string_tuple,
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


__all__ = ["parse_actor_context"]
