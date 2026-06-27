from __future__ import annotations

import json
import unittest

import httpx
from campus_evals.operator_observability import (
    OperatorLangfuseEvalBacklink,
    OperatorObservabilityClient,
    OperatorObservabilityClientError,
    OperatorObservabilityClientSettings,
    OperatorQualityGrade,
    OperatorRequestCorrelation,
    OperatorTraceBacklink,
    inject_operator_step_trajectories,
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

    def test_client_posts_langfuse_eval_backlinks_with_internal_auth_header(self) -> None:
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
            accepted = publisher.ingest_langfuse_eval_backlinks(
                (
                    OperatorLangfuseEvalBacklink(
                        request_id="req_01",
                        trace_id="trace_01",
                        eval_run_id="rag-first-stage-release-1",
                        score_name="retrieval.pass",
                        score_value=1,
                        release="release-2026-06-19",
                        environment="staging",
                        langfuse_url="https://langfuse.example/project/traces/trace_01",
                    ),
                )
            )
        finally:
            client.close()

        self.assertEqual(accepted, 1)
        self.assertEqual(
            captured["url"],
            "https://app-api.internal/api/internal/operator/langfuse/eval-backlinks",
        )
        self.assertEqual(captured["header"], "trusted-secret")
        self.assertEqual(
            captured["body"],
            {
                "backlinks": [
                    {
                        "traceId": "trace_01",
                        "requestId": "req_01",
                        "evalRunId": "rag-first-stage-release-1",
                        "scoreName": "retrieval.pass",
                        "scoreValue": 1,
                        "release": "release-2026-06-19",
                        "environment": "staging",
                        "langfuseUrl": "https://langfuse.example/project/traces/trace_01",
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

    def test_client_fetches_request_observability_with_internal_operator_headers(self) -> None:
        captured: dict[str, object] = {}

        def handler(request: httpx.Request) -> httpx.Response:
            captured["url"] = str(request.url)
            captured["secret"] = request.headers.get("x-app-internal-auth")
            captured["operator_email"] = request.headers.get("x-app-operator-email")
            return httpx.Response(
                200,
                request=request,
                json={
                    "request": {"requestId": "req_01"},
                    "runtimeRun": {
                        "run": {
                            "conversationId": "conv_01",
                            "requestId": "req_01",
                            "runId": "run_01",
                            "traceId": "trace_01",
                        },
                        "operatorStepTrajectory": {
                            "schemaVersion": "operator_step_trajectory.v1",
                            "steps": [
                                {
                                    "attemptCount": 1,
                                    "tool": "knowledge_query",
                                    "resultCount": 1,
                                    "status": "completed",
                                    "stepId": "retrieval.indexed_lookup",
                                    "stepKind": "retrieval",
                                    "taskQueue": "campus-agent.activity.knowledge",
                                    "workerId": "worker-1",
                                }
                            ],
                        },
                    },
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
            detail = publisher.fetch_request_observability("req_01")
        finally:
            client.close()

        self.assertEqual(
            captured["url"],
            "https://app-api.internal/api/operator/requests/req_01/observability",
        )
        self.assertEqual(captured["secret"], "trusted-secret")
        self.assertEqual(captured["operator_email"], "execution-control-runtime@internal")
        self.assertEqual(detail["request"]["requestId"], "req_01")

    def test_inject_operator_step_trajectories_fail_closed_when_release_observability_missing(
        self,
    ) -> None:
        class MissingTrajectoryClient:
            def fetch_request_observability(self, request_id: str) -> dict[str, object]:
                self.request_id = request_id
                return {"request": {"requestId": request_id}, "runtimeRun": {"run": {}}}

        report = {
            "schema_version": "ragas-diagnostic-combined-report.v1",
            "report_id": "ragas_diagnostic_combined",
            "summary": {"low_score_threshold": 0.8},
            "cases": [{"case_id": "case-1"}],
        }

        with self.assertRaisesRegex(ValueError, "runtimeRun.operatorStepTrajectory is required"):
            inject_operator_step_trajectories(
                report,
                correlations={
                    "case-1": OperatorRequestCorrelation(
                        case_id="case-1",
                        request_id="req_01",
                        trace_id="trace_01",
                        sampled_at="2026-04-03T00:10:00.000Z",
                    )
                },
                client=MissingTrajectoryClient(),
                release_strict=True,
            )

    def test_inject_operator_step_trajectories_normalizes_app_api_observability(self) -> None:
        class TrajectoryClient:
            def fetch_request_observability(self, request_id: str) -> dict[str, object]:
                return {
                    "request": {"requestId": request_id},
                    "runtimeRun": {
                        "run": {
                            "conversationId": "conv_01",
                            "requestId": request_id,
                            "runId": "run_01",
                            "traceId": "trace_01",
                        },
                        "operatorStepTrajectory": {
                            "schemaVersion": "operator_step_trajectory.v1",
                            "steps": [
                                {
                                    "attemptCount": 1,
                                    "tool": "knowledge_query",
                                    "resultCount": 1,
                                    "status": "completed",
                                    "stepId": "retrieval.indexed_lookup",
                                    "stepKind": "retrieval",
                                    "taskQueue": "campus-agent.activity.knowledge",
                                    "workerId": "worker-1",
                                }
                            ],
                        },
                    },
                }

        report = {
            "schema_version": "ragas-diagnostic-combined-report.v1",
            "report_id": "ragas_diagnostic_combined",
            "summary": {"low_score_threshold": 0.8},
            "cases": [{"case_id": "case-1"}],
        }

        enriched = inject_operator_step_trajectories(
            report,
            correlations={
                "case-1": OperatorRequestCorrelation(
                    case_id="case-1",
                    request_id="req_01",
                    trace_id="trace_01",
                    sampled_at="2026-04-03T00:10:00.000Z",
                )
            },
            client=TrajectoryClient(),
            release_strict=True,
        )

        trajectory = enriched["cases"][0]["operator_step_trajectory"]
        self.assertEqual(trajectory["schemaVersion"], "operator_step_trajectory.v1")
        self.assertEqual(trajectory["requestId"], "req_01")
