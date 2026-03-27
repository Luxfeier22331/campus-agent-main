from __future__ import annotations

import httpx

from campus_contracts import (
    AvailabilityCheckPayload,
    ErrorInfo,
    SpecialistRequest,
    SpecialistResponse,
)

from campus_availability_specialist.allowlist import (
    MissingAllowlistTargetError,
    resolve_allowlisted_target,
)
from campus_availability_specialist.probe import probe_target


def delegate_to_availability_specialist(
    request: SpecialistRequest,
    *,
    client: httpx.Client | None = None,
) -> SpecialistResponse:
    if request.target != "availability-specialist":
        return SpecialistResponse(
            target="availability-specialist",
            status="error",
            confidence="low",
            error=ErrorInfo(
                code="invalid_specialist_target",
                message="availability-specialist requires target='availability-specialist'",
            ),
        )
    if not isinstance(request.payload, AvailabilityCheckPayload):
        return SpecialistResponse(
            target="availability-specialist",
            status="error",
            confidence="low",
            error=ErrorInfo(
                code="invalid_payload",
                message="availability-specialist requires AvailabilityCheckPayload",
            ),
        )

    try:
        url = resolve_allowlisted_target(request.payload.target_id)
    except MissingAllowlistTargetError:
        return SpecialistResponse(
            target="availability-specialist",
            status="error",
            confidence="low",
            error=ErrorInfo(
                code="unsupported_target_id",
                message=f"unsupported availability target: {request.payload.target_id}",
            ),
        )

    owns_client = client is None
    active_client = client or httpx.Client()
    try:
        observation = probe_target(
            request.payload.target_id,
            url,
            client=active_client,
            follow_redirects=request.payload.follow_redirects,
        )
    except Exception as exc:
        return SpecialistResponse(
            target="availability-specialist",
            status="error",
            confidence="low",
            error=ErrorInfo(
                code="availability_probe_failed",
                message=str(exc),
            ),
        )
    finally:
        if owns_client:
            active_client.close()

    return SpecialistResponse(
        target="availability-specialist",
        status="completed",
        answer_text=_format_observation_answer(observation),
        confidence="low",
        result=observation,
    )


def _format_observation_answer(observation: object) -> str:
    if not hasattr(observation, "target_id") or not hasattr(observation, "observed_status"):
        return "Availability observation completed."
    final_url = getattr(observation, "final_url", "")
    final_url_suffix = f" Final URL: {final_url}." if final_url else ""
    return (
        f"{observation.target_id} observed as {observation.observed_status}."
        f"{final_url_suffix}"
    )
