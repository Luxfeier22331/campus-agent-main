from __future__ import annotations

from campus_contracts import ProfileMemoryItem, ProfileMemorySummary

from campus_supervisor_agent_worker.bridge_parse_utils import (
    parse_optional_string,
    require_string,
)


def parse_profile_memory_summary(raw_memory: object) -> ProfileMemorySummary:
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
        source_type = parse_optional_string(
            raw_item.get("source_type"),
            field_name="context.profile_memory.items[].source_type",
        )
        confidence = parse_optional_string(
            raw_item.get("confidence"),
            field_name="context.profile_memory.items[].confidence",
        )
        visibility = parse_optional_string(
            raw_item.get("visibility"),
            field_name="context.profile_memory.items[].visibility",
        )
        last_verified_at = parse_optional_string(
            raw_item.get("last_verified_at"),
            field_name="context.profile_memory.items[].last_verified_at",
        )
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


__all__ = ["parse_profile_memory_summary"]
