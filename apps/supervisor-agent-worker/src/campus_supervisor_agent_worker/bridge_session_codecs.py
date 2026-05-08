from __future__ import annotations

from campus_contracts import SelectedNoticeRef, SessionSlot, SessionSummary

from campus_supervisor_agent_worker.bridge_parse_utils import (
    parse_optional_string,
    require_object,
    require_string,
)


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
        selected_notice_ref=parse_selected_notice_ref(raw_session.get("selected_notice_ref")),
        turn_count=raw_turn_count,
    )


def parse_selected_notice_ref(raw_ref: object) -> SelectedNoticeRef | None:
    if raw_ref is None:
        return None
    ref = require_object(raw_ref, field_name="context.session.selected_notice_ref")
    return SelectedNoticeRef(
        notice_id=require_string(
            ref.get("notice_id"),
            field_name="context.session.selected_notice_ref.notice_id",
        ),
        source_family=parse_optional_string(
            ref.get("source_family"),
            field_name="context.session.selected_notice_ref.source_family",
        )
        or "",
        title=parse_optional_string(
            ref.get("title"),
            field_name="context.session.selected_notice_ref.title",
        )
        or "",
        target_surface=parse_optional_string(
            ref.get("target_surface"),
            field_name="context.session.selected_notice_ref.target_surface",
        )
        or "",
    )


__all__ = ["parse_selected_notice_ref", "parse_session_summary"]
