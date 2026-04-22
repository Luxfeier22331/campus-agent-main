from __future__ import annotations

import json
import unittest

import httpx
from campus_evals.operator_observability import (
    OperatorObservabilityClient,
    OperatorObservabilityClientError,
    OperatorObservabilityClientSettings,
    OperatorQualityGrade,
    OperatorTraceBacklink,
)


class OperatorObservabilityClientTest(unittest.TestCase):
    def test_client_posts_quality_grades_with_internal_auth_header(self) -> None:
        captured: dict[str, object] = {}

        def handler(request: httpx.Request) -> httpx.Response:
            captured["url"] = str(request.url)
            captured["header"] = request.headers.get("x-app-internal-auth")
            captured["body"] = json.loads(request.content.decode("utf-8"))
            return httpx.Response(200, request=request, json={"accepted": 1})

        settings = OperatorObservabilityClientSettings(
            app_api_base_url="https://app-api.internal",
            internal_shared_secret="trusted-secret",
        )
        transport = httpx.MockTransport(handler)
        client = httpx.Client(base_url="https://app-api.internal", transport=transport)

        try:
            publisher = OperatorObservabilityClient(settings=settings, client=client)
            accepted = publisher.ingest_quality_grades(
                (
                    OperatorQualityGrade(
                        request_id="req_01",
                        trace_id="trace_01",
                        grade_source="openai_trace_grader",
                        grade_domain="grounding",
                        verdict="pass",
                        score=0.913,
                        grader_version="grader@2026-04-03",
                        sampled_at="2026-04-03T00:10:00.000Z",
                        rationale_summary="grounded to cited handbook passages",
                    ),
                )
            )
        finally:
            client.close()

        self.assertEqual(accepted, 1)
        self.assertEqual(
            captured["url"], "https://app-api.internal/api/internal/operator/quality/grades"
        )
        self.assertEqual(captured["header"], "trusted-secret")
        self.assertEqual(
            captured["body"],
            {
                "grades": [
                    {
                        "requestId": "req_01",
                        "traceId": "trace_01",
                        "gradeSource": "openai_trace_grader",
                        "gradeDomain": "grounding",
                        "verdict": "pass",
                        "score": 0.913,
                        "graderVersion": "grader@2026-04-03",
                        "sampledAt": "2026-04-03T00:10:00.000Z",
                        "rationaleSummary": "grounded to cited handbook passages",
                    }
                ]
            },
        )

    def test_client_posts_trace_backlinks_with_internal_auth_header(self) -> None:
        captured: dict[str, object] = {}

        def handler(request: httpx.Request) -> httpx.Response:
            captured["url"] = str(request.url)
            captured["header"] = request.headers.get("x-app-internal-auth")
            captured["body"] = json.loads(request.content.decode("utf-8"))
            return httpx.Response(200, request=request, json={"accepted": 1})

        settings = OperatorObservabilityClientSettings(
            app_api_base_url="https://app-api.internal",
            internal_shared_secret="trusted-secret",
        )
        transport = httpx.MockTransport(handler)
        client = httpx.Client(base_url="https://app-api.internal", transport=transport)

        try:
            publisher = OperatorObservabilityClient(settings=settings, client=client)
            accepted = publisher.ingest_trace_backlinks(
                (
                    OperatorTraceBacklink(
                        request_id="req_01",
                        trace_id="trace_01",
                        trace_link="https://sentry.example/traces/trace_01",
                        issue_link="https://sentry.example/issues/42",
                        issue_fingerprint="citation-missing",
                    ),
                )
            )
        finally:
            client.close()

        self.assertEqual(accepted, 1)
        self.assertEqual(
            captured["url"], "https://app-api.internal/api/internal/operator/trace-backlinks"
        )
        self.assertEqual(captured["header"], "trusted-secret")
        self.assertEqual(
            captured["body"],
            {
                "backlinks": [
                    {
                        "requestId": "req_01",
                        "traceId": "trace_01",
                        "traceLink": "https://sentry.example/traces/trace_01",
                        "issueLink": "https://sentry.example/issues/42",
                        "issueFingerprint": "citation-missing",
                    }
                ]
            },
        )

    def test_client_raises_structured_error_for_non_success_response(self) -> None:
        def handler(request: httpx.Request) -> httpx.Response:
            return httpx.Response(
                404,
                request=request,
                json={
                    "error": {
                        "code": "request_not_found",
                        "message": "Request observability seed not found.",
                        "retryable": False,
                        "details": {"requestId": "req_missing"},
                    }
                },
            )

        settings = OperatorObservabilityClientSettings(
            app_api_base_url="https://app-api.internal",
            internal_shared_secret="trusted-secret",
        )
        transport = httpx.MockTransport(handler)
        client = httpx.Client(base_url="https://app-api.internal", transport=transport)

        try:
            publisher = OperatorObservabilityClient(settings=settings, client=client)
            with self.assertRaisesRegex(
                OperatorObservabilityClientError, "request_not_found"
            ) as raised:
                publisher.ingest_quality_grades(
                    (
                        OperatorQualityGrade(
                            request_id="req_missing",
                            trace_id="trace_missing",
                            grade_source="openai_trace_grader",
                            grade_domain="grounding",
                            verdict="pass",
                            score=0.913,
                            grader_version="grader@2026-04-03",
                            sampled_at="2026-04-03T00:10:00.000Z",
                            rationale_summary="grounded to cited handbook passages",
                        ),
                    )
                )
        finally:
            client.close()

        self.assertEqual(raised.exception.status_code, 404)
