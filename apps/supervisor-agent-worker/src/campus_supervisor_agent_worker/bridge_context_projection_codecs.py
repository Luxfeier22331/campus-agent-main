from __future__ import annotations

from campus_contracts import ActorContext, ContextProjection

from campus_supervisor_agent_worker.bridge_actor_codecs import parse_actor_context
from campus_supervisor_agent_worker.bridge_authorization_codecs import (
    parse_authorization_projection,
)
from campus_supervisor_agent_worker.bridge_memory_codecs import parse_profile_memory_summary
from campus_supervisor_agent_worker.bridge_session_codecs import parse_session_summary


def parse_bridge_context_projection(raw_context: object) -> ContextProjection:
    if not isinstance(raw_context, dict):
        raise ValueError("context must be an object")

    projected_actor = parse_actor_context(raw_context.get("actor"), field_prefix="context.actor")
    if projected_actor == ActorContext():
        raise ValueError("context.actor is required")

    return ContextProjection(
        actor=projected_actor,
        authorization=parse_authorization_projection(
            raw_context.get("authorization"),
            actor=projected_actor,
        ),
        profile_memory=parse_profile_memory_summary(raw_context.get("profile_memory")),
        session=parse_session_summary(raw_context.get("session")),
    )


__all__ = ["parse_bridge_context_projection"]
