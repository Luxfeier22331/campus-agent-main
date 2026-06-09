from __future__ import annotations

from campus_contracts import (
    CapabilityRequest,
    CapabilityResponse,
    ErrorInfo,
    PlaceLookupPayload,
    PlaceLookupResult,
)

from campus_navigation_capability.catalog import (
    build_candidate_list,
    resolve_place_candidates,
)


def delegate_to_navigation_capability(request: CapabilityRequest) -> CapabilityResponse:
    if request.capability != "navigation":
        return CapabilityResponse(
            capability="navigation",
            status="error",
            confidence="low",
            error=ErrorInfo(
                code="invalid_capability",
                message="navigation requires capability='navigation'",
            ),
        )
    if not isinstance(request.payload, PlaceLookupPayload):
        return CapabilityResponse(
            capability="navigation",
            status="error",
            confidence="low",
            error=ErrorInfo(
                code="invalid_payload",
                message="navigation requires PlaceLookupPayload",
            ),
        )

    normalized_alias, candidates = resolve_place_candidates(request.payload.query_text)
    if not candidates:
        return CapabilityResponse(
            capability="navigation",
            status="no_answer",
            answer_text="当前 place catalog 里还没有这个地点，请换个更具体的校内地点名称再试一次。",
            confidence="low",
            result=PlaceLookupResult(
                query_text=request.payload.query_text,
                matched_alias=normalized_alias,
            ),
        )

    if len(candidates) > 1:
        candidate_places = build_candidate_list(candidates)
        options = "；".join(_format_candidate_option(candidate) for candidate in candidate_places)
        return CapabilityResponse(
            capability="navigation",
            status="needs_clarification",
            follow_up_question=f"你要找的是：{options}？请说更具体一点。",
            confidence="medium",
            result=PlaceLookupResult(
                query_text=request.payload.query_text,
                matched_alias=normalized_alias,
                candidate_places=candidate_places,
            ),
        )

    matched_entry = candidates[0]
    return CapabilityResponse(
        capability="navigation",
        status="completed",
        answer_text=_format_place_answer(matched_entry),
        confidence="high",
        result=PlaceLookupResult(
            query_text=request.payload.query_text,
            matched_alias=normalized_alias,
            resolved_place=matched_entry.place_ref,
            place_card=matched_entry.place_card,
        ),
    )


def _format_place_answer(entry: object) -> str:
    place_card = entry.place_card
    place_ref = entry.place_ref
    segments = [
        f"{place_ref.display_name}在{place_card.location_description}",
    ]
    if place_card.landmark_hint:
        segments.append(place_card.landmark_hint)
    if place_card.access_note:
        segments.append(f"提示：{place_card.access_note}")
    return " ".join(segment.strip() for segment in segments if segment.strip())


def _format_candidate_option(candidate: object) -> str:
    place = candidate.place
    clarification_hint = candidate.clarification_hint
    if clarification_hint:
        return f"{place.display_name}（{clarification_hint}）"
    return str(place.display_name)
