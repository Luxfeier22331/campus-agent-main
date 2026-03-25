from __future__ import annotations

import httpx

from campus_contracts import AvailabilityObservation


def probe_target(
    target_id: str,
    url: str,
    *,
    client: httpx.Client,
    follow_redirects: bool,
) -> AvailabilityObservation:
    try:
        response = client.get(
            url,
            follow_redirects=follow_redirects,
            timeout=httpx.Timeout(5.0, connect=2.0),
        )
    except httpx.TimeoutException:
        return AvailabilityObservation(
            target_id=target_id,
            observed_status="timeout",
            final_url=url,
            failure_classification="timeout",
        )
    except httpx.ConnectError:
        return AvailabilityObservation(
            target_id=target_id,
            observed_status="connect_failure",
            final_url=url,
            failure_classification="connect_failure",
        )
    except httpx.TooManyRedirects:
        return AvailabilityObservation(
            target_id=target_id,
            observed_status="redirect_loop",
            final_url=url,
            failure_classification="redirect_loop",
        )

    redirect_chain = tuple(str(item.url) for item in response.history)
    final_url = str(response.url)
    if 300 <= response.status_code < 400 or redirect_chain:
        return AvailabilityObservation(
            target_id=target_id,
            observed_status="redirected",
            http_status=response.status_code,
            final_url=final_url,
            redirect_chain=redirect_chain,
        )
    if response.status_code >= 400:
        return AvailabilityObservation(
            target_id=target_id,
            observed_status="http_error",
            http_status=response.status_code,
            final_url=final_url,
            redirect_chain=redirect_chain,
            failure_classification="http_error",
        )
    return AvailabilityObservation(
        target_id=target_id,
        observed_status="ok",
        http_status=response.status_code,
        final_url=final_url,
        redirect_chain=redirect_chain,
    )
