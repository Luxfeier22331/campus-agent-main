from __future__ import annotations

from campus_contracts import CapabilityResponse


def bounded_notice_get_projection(response: CapabilityResponse) -> dict[str, object]:
    result = response.result
    projection: dict[str, object] = {
        "status": response.status,
        "confidence": response.confidence,
    }
    if result is not None:
        for field_name in (
            "notice_id",
            "outcome",
            "title",
            "source_family",
            "source_url",
            "canonical_url",
            "reference_only",
            "target_surface",
            "published_at",
            "effective_at",
            "fail_close_reason",
        ):
            value = getattr(result, field_name, None)
            if value not in (None, "", (), []):
                projection[field_name] = value
    if response.capability_observability is not None:
        projection["source_ref_count"] = response.capability_observability.source_ref_count or 0
        projection["tool_outcome"] = response.capability_observability.tool_outcome
    return projection


__all__ = ["bounded_notice_get_projection"]
