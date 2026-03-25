from __future__ import annotations

import unittest
from unittest.mock import patch

import httpx

from campus_availability_specialist.allowlist import ALLOWLISTED_TARGETS
from campus_contracts import AvailabilityCheckPayload, SpecialistRequest
from campus_supervisor_core import handle_specialist_request


class AvailabilitySmokeTest(unittest.TestCase):
    def test_availability_smoke_cases_keep_completed_status(self) -> None:
        cases = (
            ("availability-ok", self._ok_transport(), "ok"),
            ("availability-redirect", self._redirect_transport(), "redirected"),
            ("availability-timeout", self._timeout_transport(), "timeout"),
            ("availability-connect-failure", self._connect_failure_transport(), "connect_failure"),
        )

        for case_id, transport, expected_status in cases:
            with self.subTest(case_id=case_id):
                response = self._run_case(transport)

                self.assertEqual(response.target, "availability-specialist")
                self.assertEqual(response.status, "completed")
                self.assertEqual(response.result.observed_status, expected_status)

    def _run_case(self, transport: httpx.BaseTransport) -> object:
        original_client = httpx.Client

        with patch.dict(
            ALLOWLISTED_TARGETS,
            {"official-homepage": "https://campus.example/home"},
            clear=True,
        ):
            with patch(
                "campus_availability_specialist.service.httpx.Client",
                side_effect=lambda *args, **kwargs: original_client(transport=transport),
            ):
                return handle_specialist_request(
                    SpecialistRequest(
                        target="availability-specialist",
                        user_goal="官网现在能打开吗？",
                        payload=AvailabilityCheckPayload(target_id="official-homepage"),
                    )
                )

    def _ok_transport(self) -> httpx.MockTransport:
        def handler(request: httpx.Request) -> httpx.Response:
            return httpx.Response(200, request=request)

        return httpx.MockTransport(handler)

    def _redirect_transport(self) -> httpx.MockTransport:
        def handler(request: httpx.Request) -> httpx.Response:
            if str(request.url) == "https://campus.example/home":
                return httpx.Response(
                    302,
                    headers={"location": "https://campus.example/landing"},
                    request=request,
                )
            return httpx.Response(200, request=request)

        return httpx.MockTransport(handler)

    def _timeout_transport(self) -> httpx.MockTransport:
        def handler(request: httpx.Request) -> httpx.Response:
            raise httpx.ReadTimeout("timed out", request=request)

        return httpx.MockTransport(handler)

    def _connect_failure_transport(self) -> httpx.MockTransport:
        def handler(request: httpx.Request) -> httpx.Response:
            raise httpx.ConnectError("connection refused", request=request)

        return httpx.MockTransport(handler)


if __name__ == "__main__":
    unittest.main()
