from __future__ import annotations

import unittest
from unittest.mock import patch

import httpx

from campus_availability_specialist.allowlist import ALLOWLISTED_TARGETS
from campus_availability_specialist.service import delegate_to_availability_specialist
from campus_contracts import AvailabilityCheckPayload, KnowledgeScope, RagRequestPayload, SpecialistRequest


def _mock_client(handler: httpx.MockTransport) -> httpx.Client:
    return httpx.Client(transport=handler)


class AvailabilitySpecialistTest(unittest.TestCase):
    def test_success_response_maps_to_completed_observation(self) -> None:
        def handler(request: httpx.Request) -> httpx.Response:
            self.assertEqual(str(request.url), "https://campus.example/home")
            return httpx.Response(200, request=request)

        with patch.dict(
            ALLOWLISTED_TARGETS,
            {"official-homepage": "https://campus.example/home"},
            clear=True,
        ):
            with _mock_client(httpx.MockTransport(handler)) as client:
                response = delegate_to_availability_specialist(
                    SpecialistRequest(
                        target="availability-specialist",
                        user_goal="Check homepage",
                        payload=AvailabilityCheckPayload(target_id="official-homepage"),
                    ),
                    client=client,
                )

        self.assertEqual(response.target, "availability-specialist")
        self.assertEqual(response.status, "completed")
        self.assertEqual(response.result.observed_status, "ok")
        self.assertEqual(response.result.http_status, 200)
        self.assertEqual(response.result.final_url, "https://campus.example/home")

    def test_redirect_response_maps_to_completed_observation(self) -> None:
        calls: list[str] = []

        def handler(request: httpx.Request) -> httpx.Response:
            calls.append(str(request.url))
            if str(request.url) == "https://campus.example/home":
                return httpx.Response(
                    302,
                    headers={"location": "https://campus.example/landing"},
                    request=request,
                )
            return httpx.Response(200, request=request)

        with patch.dict(
            ALLOWLISTED_TARGETS,
            {"official-homepage": "https://campus.example/home"},
            clear=True,
        ):
            with _mock_client(httpx.MockTransport(handler)) as client:
                response = delegate_to_availability_specialist(
                    SpecialistRequest(
                        target="availability-specialist",
                        user_goal="Check homepage",
                        payload=AvailabilityCheckPayload(
                            target_id="official-homepage",
                            follow_redirects=True,
                        ),
                    ),
                    client=client,
                )

        self.assertEqual(calls, ["https://campus.example/home", "https://campus.example/landing"])
        self.assertEqual(response.status, "completed")
        self.assertEqual(response.result.observed_status, "redirected")
        self.assertEqual(response.result.final_url, "https://campus.example/landing")
        self.assertEqual(response.result.redirect_chain, ("https://campus.example/home",))

    def test_timeout_maps_to_completed_observation(self) -> None:
        def handler(request: httpx.Request) -> httpx.Response:
            raise httpx.ReadTimeout("timed out", request=request)

        with patch.dict(
            ALLOWLISTED_TARGETS,
            {"official-homepage": "https://campus.example/home"},
            clear=True,
        ):
            with _mock_client(httpx.MockTransport(handler)) as client:
                response = delegate_to_availability_specialist(
                    SpecialistRequest(
                        target="availability-specialist",
                        user_goal="Check homepage",
                        payload=AvailabilityCheckPayload(target_id="official-homepage"),
                    ),
                    client=client,
                )

        self.assertEqual(response.status, "completed")
        self.assertEqual(response.result.observed_status, "timeout")
        self.assertEqual(response.result.failure_classification, "timeout")

    def test_connect_failure_maps_to_completed_observation(self) -> None:
        def handler(request: httpx.Request) -> httpx.Response:
            raise httpx.ConnectError("connection refused", request=request)

        with patch.dict(
            ALLOWLISTED_TARGETS,
            {"official-homepage": "https://campus.example/home"},
            clear=True,
        ):
            with _mock_client(httpx.MockTransport(handler)) as client:
                response = delegate_to_availability_specialist(
                    SpecialistRequest(
                        target="availability-specialist",
                        user_goal="Check homepage",
                        payload=AvailabilityCheckPayload(target_id="official-homepage"),
                    ),
                    client=client,
                )

        self.assertEqual(response.status, "completed")
        self.assertEqual(response.result.observed_status, "connect_failure")
        self.assertEqual(response.result.failure_classification, "connect_failure")

    def test_missing_allowlist_maps_to_error_response(self) -> None:
        response = delegate_to_availability_specialist(
            SpecialistRequest(
                target="availability-specialist",
                user_goal="Check homepage",
                payload=AvailabilityCheckPayload(target_id="unknown-target"),
            ),
            client=httpx.Client(transport=httpx.MockTransport(lambda request: httpx.Response(200))),
        )

        self.assertEqual(response.status, "error")
        self.assertEqual(response.error.code, "unsupported_target_id")

    def test_invalid_target_maps_to_error_response(self) -> None:
        response = delegate_to_availability_specialist(
            SpecialistRequest(
                target="rag-specialist",
                user_goal="Check homepage",
                payload=RagRequestPayload(
                    scope=KnowledgeScope(corpus="regulations", collection="student_handbook")
                ),
            ),
            client=httpx.Client(transport=httpx.MockTransport(lambda request: httpx.Response(200))),
        )

        self.assertEqual(response.target, "availability-specialist")
        self.assertEqual(response.status, "error")
        self.assertEqual(response.error.code, "invalid_specialist_target")


if __name__ == "__main__":
    unittest.main()
