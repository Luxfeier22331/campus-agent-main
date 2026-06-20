from __future__ import annotations

import base64
import json
import unittest
from pathlib import Path

import httpx
from campus_evals.langfuse_adapter import (
    LangfuseAdapterDisabled,
    LangfuseAdapterRequestError,
    LangfuseAdapterSettings,
    create_langfuse_adapter,
    derive_langfuse_trace_id,
    verify_langfuse_online_trace_evidence,
)

TRACE_ID_VECTOR_FIXTURE = (
    Path(__file__).resolve().parents[1] / "fixtures/langfuse_trace_id_vectors.json"
)


class LangfuseAdapterSuite(unittest.TestCase):
    def test_adapter_is_explicitly_disabled_without_configuration(self) -> None:
        adapter = create_langfuse_adapter(LangfuseAdapterSettings())

        with self.assertRaisesRegex(LangfuseAdapterDisabled, "Langfuse adapter is disabled"):
            adapter.publish_scores([])

    def test_adapter_rejects_partial_credentials(self) -> None:
        with self.assertRaisesRegex(ValueError, "public and secret keys"):
            create_langfuse_adapter(
                LangfuseAdapterSettings(
                    base_url="http://langfuse.internal:3000",
                    public_key="pk-lf-test",
                )
            )

    def test_adapter_posts_sanitized_profile_scores_with_basic_auth(self) -> None:
        requests: list[httpx.Request] = []

        def handler(request: httpx.Request) -> httpx.Response:
            requests.append(request)
            return httpx.Response(200, json={"id": f"score-{len(requests)}"})

        adapter = create_langfuse_adapter(
            LangfuseAdapterSettings(
                base_url="http://langfuse.internal:3000",
                public_key="pk-lf-test",
                secret_key="sk-lf-test",
                environment="staging",
            ),
            client=httpx.Client(transport=httpx.MockTransport(handler)),
        )

        result = adapter.publish_profile_report(
            _profile_report_payload(
                {
                    "case_id": "case-001",
                    "passed": True,
                    "reason": "grounded answer",
                    "request_correlation": {
                        "request_id": "req_001",
                        "trace_id": "trace_001",
                        "sampled_at": "2026-06-18T10:00:00+00:00",
                    },
                    "input": "raw user prompt must not leak",
                    "answer": "raw model answer must not leak",
                    "source_snippets": ["raw evidence must not leak"],
                }
            )
        )

        self.assertEqual(result["source_result_denominator"], 1)
        self.assertEqual(result["expected_publish_denominator"], 1)
        self.assertEqual(result["published"], 1)
        self.assertEqual(result["failed"], 0)
        self.assertEqual(result["omitted"], 0)
        self.assertEqual(len(requests), 1)
        request = requests[0]
        self.assertEqual(str(request.url), "http://langfuse.internal:3000/api/public/scores")
        expected_auth = base64.b64encode(b"pk-lf-test:sk-lf-test").decode("ascii")
        self.assertEqual(request.headers["authorization"], f"Basic {expected_auth}")

        body = httpx.Request("POST", "http://x", content=request.content).read().decode()
        self.assertNotIn("raw user prompt", body)
        self.assertNotIn("raw model answer", body)
        self.assertNotIn("raw evidence", body)

        payload = dict(__import__("json").loads(body))
        self.assertEqual(payload["traceId"], derive_langfuse_trace_id("trace_001"))
        self.assertNotEqual(payload["traceId"], "trace_001")
        self.assertEqual(payload["name"], "online-answer-path.profile")
        self.assertEqual(payload["value"], 1)
        self.assertEqual(payload["dataType"], "BOOLEAN")
        self.assertEqual(payload["source"], "API")
        self.assertNotIn("environment", payload)
        self.assertEqual(
            payload["metadata"],
            {
                "profile_id": "online-answer-path",
                "case_id": "case-001",
                "request_id": "req_001",
                "case_family": "online_answer_path.v1",
                "schema_version": "eval_profile_gate.v1",
                "grader_version": "eval_profile_gate.v1",
                "failure_class": None,
            },
        )

    def test_trace_id_derivation_matches_app_api_shared_vectors(self) -> None:
        payload = json.loads(TRACE_ID_VECTOR_FIXTURE.read_text(encoding="utf-8"))

        for vector in payload["vectors"]:
            self.assertEqual(
                derive_langfuse_trace_id(vector["product_trace_id"]),
                vector["langfuse_trace_id"],
            )

    def test_adapter_skips_uncorrelated_profile_results(self) -> None:
        requests: list[httpx.Request] = []
        adapter = create_langfuse_adapter(
            LangfuseAdapterSettings(
                base_url="http://langfuse.internal:3000",
                public_key="pk-lf-test",
                secret_key="sk-lf-test",
                environment="staging",
            ),
            client=httpx.Client(
                transport=httpx.MockTransport(
                    lambda request: (
                        requests.append(request) or httpx.Response(200, json={"id": "x"})
                    )
                )
            ),
        )

        result = adapter.publish_profile_report(
            _profile_report_payload({"case_id": "case-uncorrelated", "passed": False})
        )

        self.assertEqual(result["source_result_denominator"], 1)
        self.assertEqual(result["expected_publish_denominator"], 0)
        self.assertEqual(result["published"], 0)
        self.assertEqual(result["failed"], 0)
        self.assertEqual(result["omitted"], 1)
        self.assertEqual(requests, [])

    def test_adapter_fails_closed_when_profile_report_has_no_sanitized_results(self) -> None:
        adapter = create_langfuse_adapter(
            LangfuseAdapterSettings(
                base_url="http://langfuse.internal:3000",
                public_key="pk-lf-test",
                secret_key="sk-lf-test",
                environment="staging",
            ),
            client=httpx.Client(
                transport=httpx.MockTransport(
                    lambda request: httpx.Response(200, json={"id": "unexpected"})
                )
            ),
        )
        payload = _profile_report_payload(
            {
                "case_id": "case-001",
                "passed": True,
                "request_correlation": {
                    "request_id": "req_001",
                    "trace_id": "trace_001",
                    "sampled_at": "2026-06-18T10:00:00+00:00",
                },
            }
        )
        payload.pop("sanitized_results")

        with self.assertRaisesRegex(ValueError, "sanitized_results must be a non-empty list"):
            adapter.publish_profile_report(payload)

    def test_adapter_fails_closed_on_langfuse_request_failure(self) -> None:
        adapter = create_langfuse_adapter(
            LangfuseAdapterSettings(
                base_url="http://langfuse.internal:3000",
                public_key="pk-lf-test",
                secret_key="sk-lf-test",
                environment="staging",
            ),
            client=httpx.Client(
                transport=httpx.MockTransport(
                    lambda request: httpx.Response(401, json={"message": "invalid key"})
                )
            ),
        )

        with self.assertRaisesRegex(
            LangfuseAdapterRequestError,
            "Langfuse score publish failed",
        ):
            adapter.publish_profile_report(
                _profile_report_payload(
                    {
                        "case_id": "case-001",
                        "passed": False,
                        "request_correlation": {
                            "request_id": "req_001",
                            "trace_id": "trace_001",
                            "sampled_at": "2026-06-18T10:00:00+00:00",
                        },
                    }
                )
            )

    def test_online_trace_evidence_verifier_reads_trace_core_and_observations(self) -> None:
        requests: list[httpx.Request] = []

        def handler(request: httpx.Request) -> httpx.Response:
            requests.append(request)
            return httpx.Response(
                200,
                json={
                    "id": "trace-online-001",
                    "name": "online-answer",
                    "sessionId": "conv-online-001",
                    "userId": "user-online-001",
                    "release": "release-2026-06-18",
                    "tags": ["surface:execution-control", "capability:knowledge", "env:staging"],
                    "observations": [
                        {
                            "id": "obs-001",
                            "name": "retrieval.runtime_observation",
                            "metadata": {
                                "attributes": {
                                    "activity_attempt": 1,
                                    "activity_type": "RAGLookupActivity",
                                    "duration_ms": 42,
                                    "fail_close_reason": "",
                                    "projection_ref": "projection://runs/run-001/steps/retrieval",
                                    "request_id": "req-online-001",
                                    "run_id": "run-online-001",
                                    "schedule_to_start_ms": 3,
                                    "selected_capability": "knowledge",
                                    "selected_tool": "rag.indexed_lookup",
                                    "status": "completed",
                                    "step_id": "retrieval.indexed_lookup",
                                    "step_kind": "retrieval",
                                    "task_queue": "campus.execution.activity.knowledge",
                                    "trace_id": "trace-online-001",
                                    "workflow_id": "campus-agent.chat.run-online-001",
                                },
                            },
                        },
                    ],
                },
            )

        evidence = verify_langfuse_online_trace_evidence(
            settings=LangfuseAdapterSettings(
                base_url="http://langfuse.internal:3000",
                public_key="pk-lf-test",
                secret_key="sk-lf-test",
            ),
            trace_id="trace-online-001",
            expected_session_id="conv-online-001",
            expected_user_id="user-online-001",
            expected_release="release-2026-06-18",
            expected_tags=("surface:execution-control", "capability:knowledge"),
            client=httpx.Client(transport=httpx.MockTransport(handler)),
        )

        self.assertEqual(evidence["trace_id"], "trace-online-001")
        self.assertEqual(evidence["observation_count"], 1)
        self.assertEqual(
            evidence["trace_identity"],
            {
                "request_id": "req-online-001",
                "run_id": "run-online-001",
                "workflow_id": "campus-agent.chat.run-online-001",
                "trace_id": "trace-online-001",
            },
        )
        request = requests[0]
        self.assertEqual(
            str(request.url),
            "http://langfuse.internal:3000/api/public/traces/trace-online-001?fields=core%2Cobservations",
        )
        expected_auth = base64.b64encode(b"pk-lf-test:sk-lf-test").decode("ascii")
        self.assertEqual(request.headers["authorization"], f"Basic {expected_auth}")

    def test_online_trace_evidence_verifier_fails_closed_on_missing_observations(self) -> None:
        verifier_client = httpx.Client(
            transport=httpx.MockTransport(
                lambda request: httpx.Response(
                    200,
                    json={
                        "id": "trace-online-001",
                        "name": "online-answer",
                        "sessionId": "conv-online-001",
                        "userId": "user-online-001",
                        "release": "release-2026-06-18",
                        "tags": ["surface:execution-control", "capability:knowledge"],
                        "observations": [],
                    },
                )
            )
        )

        with self.assertRaisesRegex(LangfuseAdapterRequestError, "missing observations"):
            verify_langfuse_online_trace_evidence(
                settings=LangfuseAdapterSettings(
                    base_url="http://langfuse.internal:3000",
                    public_key="pk-lf-test",
                    secret_key="sk-lf-test",
                ),
                trace_id="trace-online-001",
                expected_session_id="conv-online-001",
                expected_user_id="user-online-001",
                expected_release="release-2026-06-18",
                expected_tags=("surface:execution-control", "capability:knowledge"),
                client=verifier_client,
            )

    def test_online_trace_evidence_verifier_fails_closed_on_missing_observation_attributes(
        self,
    ) -> None:
        verifier_client = httpx.Client(
            transport=httpx.MockTransport(
                lambda request: httpx.Response(
                    200,
                    json={
                        "id": "trace-online-001",
                        "name": "online-answer",
                        "sessionId": "conv-online-001",
                        "userId": "user-online-001",
                        "release": "release-2026-06-18",
                        "tags": ["surface:execution-control", "capability:knowledge"],
                        "metadata": {
                            "request_id": "req-online-001",
                            "run_id": "run-online-001",
                            "workflow_id": "campus-agent.chat.run-online-001",
                            "trace_id": "trace-online-001",
                        },
                        "observations": [
                            {
                                "id": "obs-001",
                                "name": "retrieval.runtime_observation",
                                "metadata": {"step_id": "retrieval.indexed_lookup"},
                            }
                        ],
                    },
                )
            )
        )

        with self.assertRaisesRegex(
            LangfuseAdapterRequestError,
            "missing observation attributes",
        ):
            verify_langfuse_online_trace_evidence(
                settings=LangfuseAdapterSettings(
                    base_url="http://langfuse.internal:3000",
                    public_key="pk-lf-test",
                    secret_key="sk-lf-test",
                ),
                trace_id="trace-online-001",
                expected_session_id="conv-online-001",
                expected_user_id="user-online-001",
                expected_release="release-2026-06-18",
                expected_tags=("surface:execution-control", "capability:knowledge"),
                client=verifier_client,
            )

    def test_online_trace_evidence_verifier_requires_every_observation_to_match_contract(
        self,
    ) -> None:
        verifier_client = httpx.Client(
            transport=httpx.MockTransport(
                lambda request: httpx.Response(
                    200,
                    json={
                        "id": "trace-online-001",
                        "name": "online-answer",
                        "sessionId": "conv-online-001",
                        "userId": "user-online-001",
                        "release": "release-2026-06-18",
                        "tags": ["surface:execution-control", "capability:knowledge"],
                        "metadata": {
                            "request_id": "req-online-001",
                            "run_id": "run-online-001",
                            "workflow_id": "campus-agent.chat.run-online-001",
                            "trace_id": "trace-online-001",
                        },
                        "observations": [
                            {
                                "id": "obs-complete",
                                "name": "retrieval.runtime_observation",
                                "metadata": {
                                    "activity_attempt": 1,
                                    "activity_type": "RAGLookupActivity",
                                    "duration_ms": 42,
                                    "fail_close_reason": "",
                                    "projection_ref": "projection://runs/run-001/steps/retrieval",
                                    "schedule_to_start_ms": 3,
                                    "selected_capability": "knowledge",
                                    "selected_tool": "rag.indexed_lookup",
                                    "status": "completed",
                                    "step_id": "retrieval.indexed_lookup",
                                    "step_kind": "retrieval",
                                    "task_queue": "campus.execution.activity.knowledge",
                                },
                            },
                            {
                                "id": "obs-incomplete",
                                "name": "finalization.write",
                                "metadata": {
                                    "activity_attempt": 1,
                                    "activity_type": "WriteFinalizationActivity",
                                    "duration_ms": 25,
                                    "status": "completed",
                                },
                            },
                        ],
                    },
                )
            )
        )

        with self.assertRaisesRegex(
            LangfuseAdapterRequestError,
            "trace evidence observation obs-incomplete missing observation attributes",
        ):
            verify_langfuse_online_trace_evidence(
                settings=LangfuseAdapterSettings(
                    base_url="http://langfuse.internal:3000",
                    public_key="pk-lf-test",
                    secret_key="sk-lf-test",
                ),
                trace_id="trace-online-001",
                expected_session_id="conv-online-001",
                expected_user_id="user-online-001",
                expected_release="release-2026-06-18",
                expected_tags=("surface:execution-control", "capability:knowledge"),
                client=verifier_client,
            )

    def test_online_trace_evidence_verifier_fails_closed_on_missing_trace_identity(
        self,
    ) -> None:
        verifier_client = httpx.Client(
            transport=httpx.MockTransport(
                lambda request: httpx.Response(
                    200,
                    json={
                        "id": "trace-online-001",
                        "name": "online-answer",
                        "sessionId": "conv-online-001",
                        "userId": "user-online-001",
                        "release": "release-2026-06-18",
                        "tags": ["surface:execution-control", "capability:knowledge"],
                        "observations": [
                            {
                                "id": "obs-001",
                                "name": "retrieval.runtime_observation",
                                "metadata": {
                                    "activity_attempt": 1,
                                    "activity_type": "RAGLookupActivity",
                                    "duration_ms": 42,
                                    "fail_close_reason": "",
                                    "projection_ref": "projection://runs/run-001/steps/retrieval",
                                    "schedule_to_start_ms": 3,
                                    "selected_capability": "knowledge",
                                    "selected_tool": "rag.indexed_lookup",
                                    "status": "completed",
                                    "step_id": "retrieval.indexed_lookup",
                                    "step_kind": "retrieval",
                                    "task_queue": "campus.execution.activity.knowledge",
                                },
                            }
                        ],
                    },
                )
            )
        )

        with self.assertRaisesRegex(
            LangfuseAdapterRequestError,
            "missing trace identity attributes",
        ):
            verify_langfuse_online_trace_evidence(
                settings=LangfuseAdapterSettings(
                    base_url="http://langfuse.internal:3000",
                    public_key="pk-lf-test",
                    secret_key="sk-lf-test",
                ),
                trace_id="trace-online-001",
                expected_session_id="conv-online-001",
                expected_user_id="user-online-001",
                expected_release="release-2026-06-18",
                expected_tags=("surface:execution-control", "capability:knowledge"),
                client=verifier_client,
            )

    def test_online_trace_evidence_verifier_fails_closed_on_blank_trace_identity(
        self,
    ) -> None:
        verifier_client = httpx.Client(
            transport=httpx.MockTransport(
                lambda request: httpx.Response(
                    200,
                    json={
                        "id": "trace-online-001",
                        "name": "online-answer",
                        "sessionId": "conv-online-001",
                        "userId": "user-online-001",
                        "release": "release-2026-06-18",
                        "tags": ["surface:execution-control", "capability:knowledge"],
                        "metadata": {
                            "request_id": " ",
                            "run_id": "",
                            "workflow_id": " ",
                            "trace_id": "",
                        },
                        "observations": [
                            {
                                "id": "obs-001",
                                "name": "retrieval.runtime_observation",
                                "metadata": {
                                    "activity_attempt": 1,
                                    "activity_type": "RAGLookupActivity",
                                    "duration_ms": 42,
                                    "fail_close_reason": "",
                                    "projection_ref": "projection://runs/run-001/steps/retrieval",
                                    "schedule_to_start_ms": 3,
                                    "selected_capability": "knowledge",
                                    "selected_tool": "rag.indexed_lookup",
                                    "status": "completed",
                                    "step_id": "retrieval.indexed_lookup",
                                    "step_kind": "retrieval",
                                    "task_queue": "campus.execution.activity.knowledge",
                                },
                            }
                        ],
                    },
                )
            )
        )

        with self.assertRaisesRegex(
            LangfuseAdapterRequestError,
            "missing trace identity attributes",
        ):
            verify_langfuse_online_trace_evidence(
                settings=LangfuseAdapterSettings(
                    base_url="http://langfuse.internal:3000",
                    public_key="pk-lf-test",
                    secret_key="sk-lf-test",
                ),
                trace_id="trace-online-001",
                expected_session_id="conv-online-001",
                expected_user_id="user-online-001",
                expected_release="release-2026-06-18",
                expected_tags=("surface:execution-control", "capability:knowledge"),
                client=verifier_client,
            )

    def test_online_trace_evidence_verifier_fails_closed_on_trace_identity_mismatch(
        self,
    ) -> None:
        verifier_client = httpx.Client(
            transport=httpx.MockTransport(
                lambda request: httpx.Response(
                    200,
                    json={
                        "id": "trace-online-001",
                        "name": "online-answer",
                        "sessionId": "conv-online-001",
                        "userId": "user-online-001",
                        "release": "release-2026-06-18",
                        "tags": ["surface:execution-control", "capability:knowledge"],
                        "metadata": {
                            "request_id": "req-online-actual",
                            "run_id": "run-online-001",
                            "workflow_id": "campus-agent.chat.run-online-001",
                            "trace_id": "trace-online-001",
                        },
                        "observations": [
                            {
                                "id": "obs-001",
                                "name": "retrieval.runtime_observation",
                                "metadata": {
                                    "activity_attempt": 1,
                                    "activity_type": "RAGLookupActivity",
                                    "duration_ms": 42,
                                    "fail_close_reason": "",
                                    "projection_ref": "projection://runs/run-001/steps/retrieval",
                                    "schedule_to_start_ms": 3,
                                    "selected_capability": "knowledge",
                                    "selected_tool": "rag.indexed_lookup",
                                    "status": "completed",
                                    "step_id": "retrieval.indexed_lookup",
                                    "step_kind": "retrieval",
                                    "task_queue": "campus.execution.activity.knowledge",
                                },
                            }
                        ],
                    },
                )
            )
        )

        with self.assertRaisesRegex(
            LangfuseAdapterRequestError,
            "trace evidence attribute request_id = req-online-actual, want req-online-expected",
        ):
            verify_langfuse_online_trace_evidence(
                settings=LangfuseAdapterSettings(
                    base_url="http://langfuse.internal:3000",
                    public_key="pk-lf-test",
                    secret_key="sk-lf-test",
                ),
                trace_id="trace-online-001",
                expected_session_id="conv-online-001",
                expected_user_id="user-online-001",
                expected_release="release-2026-06-18",
                expected_tags=("surface:execution-control", "capability:knowledge"),
                expected_request_id="req-online-expected",
                expected_run_id="run-online-001",
                expected_workflow_id="campus-agent.chat.run-online-001",
                client=verifier_client,
            )

    def test_online_trace_evidence_verifier_fails_closed_on_conflicting_trace_identity(
        self,
    ) -> None:
        verifier_client = httpx.Client(
            transport=httpx.MockTransport(
                lambda request: httpx.Response(
                    200,
                    json={
                        "id": "trace-online-001",
                        "name": "online-answer",
                        "sessionId": "conv-online-001",
                        "userId": "user-online-001",
                        "release": "release-2026-06-18",
                        "tags": ["surface:execution-control", "capability:knowledge"],
                        "metadata": {
                            "request_id": "req-online-001",
                            "run_id": "run-online-001",
                            "workflow_id": "campus-agent.chat.run-online-001",
                            "trace_id": "trace-online-001",
                        },
                        "observations": [
                            {
                                "id": "obs-001",
                                "name": "retrieval.runtime_observation",
                                "metadata": {
                                    "activity_attempt": 1,
                                    "activity_type": "RAGLookupActivity",
                                    "duration_ms": 42,
                                    "fail_close_reason": "",
                                    "projection_ref": "projection://runs/run-001/steps/retrieval",
                                    "request_id": "req-online-different",
                                    "run_id": "run-online-001",
                                    "schedule_to_start_ms": 3,
                                    "selected_capability": "knowledge",
                                    "selected_tool": "rag.indexed_lookup",
                                    "status": "completed",
                                    "step_id": "retrieval.indexed_lookup",
                                    "step_kind": "retrieval",
                                    "task_queue": "campus.execution.activity.knowledge",
                                    "trace_id": "trace-online-001",
                                    "workflow_id": "campus-agent.chat.run-online-001",
                                },
                            }
                        ],
                    },
                )
            )
        )

        with self.assertRaisesRegex(
            LangfuseAdapterRequestError,
            "trace evidence has conflicting trace identity attribute request_id",
        ):
            verify_langfuse_online_trace_evidence(
                settings=LangfuseAdapterSettings(
                    base_url="http://langfuse.internal:3000",
                    public_key="pk-lf-test",
                    secret_key="sk-lf-test",
                ),
                trace_id="trace-online-001",
                expected_session_id="conv-online-001",
                expected_user_id="user-online-001",
                expected_release="release-2026-06-18",
                expected_tags=("surface:execution-control", "capability:knowledge"),
                client=verifier_client,
            )

    def test_online_trace_evidence_verifier_fails_closed_on_forbidden_runtime_payloads(
        self,
    ) -> None:
        verifier_client = httpx.Client(
            transport=httpx.MockTransport(
                lambda request: httpx.Response(
                    200,
                    json={
                        "id": "trace-online-001",
                        "name": "online-answer",
                        "sessionId": "conv-online-001",
                        "userId": "user-online-001",
                        "release": "release-2026-06-18",
                        "tags": ["surface:execution-control", "capability:knowledge"],
                        "metadata": {
                            "request_id": "req-online-001",
                            "run_id": "run-online-001",
                            "workflow_id": "campus-agent.chat.run-online-001",
                            "trace_id": "trace-online-001",
                        },
                        "observations": [
                            {
                                "id": "obs-001",
                                "name": "retrieval.runtime_observation",
                                "metadata": {
                                    "activity_attempt": 1,
                                    "activity_type": "RAGLookupActivity",
                                    "authorization": "Bearer must-not-leak",
                                    "duration_ms": 42,
                                    "fail_close_reason": "",
                                    "projection_ref": "projection://runs/run-001/steps/retrieval",
                                    "raw_prompt": "用户原始问题不应进入 Langfuse",
                                    "schedule_to_start_ms": 3,
                                    "selected_capability": "knowledge",
                                    "selected_tool": "rag.indexed_lookup",
                                    "status": "completed",
                                    "step_id": "retrieval.indexed_lookup",
                                    "step_kind": "retrieval",
                                    "task_queue": "campus.execution.activity.knowledge",
                                },
                            }
                        ],
                    },
                )
            )
        )

        with self.assertRaisesRegex(
            LangfuseAdapterRequestError,
            "trace evidence includes forbidden Langfuse payload fields: authorization, raw_prompt",
        ):
            verify_langfuse_online_trace_evidence(
                settings=LangfuseAdapterSettings(
                    base_url="http://langfuse.internal:3000",
                    public_key="pk-lf-test",
                    secret_key="sk-lf-test",
                ),
                trace_id="trace-online-001",
                expected_session_id="conv-online-001",
                expected_user_id="user-online-001",
                expected_release="release-2026-06-18",
                expected_tags=("surface:execution-control", "capability:knowledge"),
                expected_request_id="req-online-001",
                expected_run_id="run-online-001",
                expected_workflow_id="campus-agent.chat.run-online-001",
                client=verifier_client,
            )


def _profile_report_payload(result: dict[str, object]) -> dict[str, object]:
    return {
        "schema_version": "eval_profile_gate.v1",
        "profile_id": "online-answer-path",
        "case_family": "online_answer_path.v1",
        "passed": bool(result.get("passed")),
        "summary": {"total": 1, "passed": int(bool(result.get("passed"))), "failed": 0},
        "version_summary": {
            "runtime_version": "eval_profile_gate.v1",
            "git_head": "abc123",
        },
        "sanitized_results": [result],
    }


if __name__ == "__main__":
    unittest.main()
