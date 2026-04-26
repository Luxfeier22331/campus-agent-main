from __future__ import annotations

from campus_contracts import SessionSlot, SessionSummary

from campus_supervisor_agent_worker.bridge_parse_utils import require_string


def parse_session_summary(raw_session: object) -> SessionSummary:
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


__all__ = ["parse_session_summary"]
