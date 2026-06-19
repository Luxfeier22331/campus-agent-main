from __future__ import annotations

import unittest

import httpx
from campus_evals.langfuse_adapter import (
    LangfuseAdapterRequestError,
    LangfuseAdapterSettings,
    verify_langfuse_online_trace_evidence,
)


class LangfuseTraceEvidenceContractSuite(unittest.TestCase):
    def test_non_repo_observations_do_not_enter_runtime_contract_denominator(self) -> None:
        evidence = verify_langfuse_online_trace_evidence(
            settings=_settings(),
            trace_id="trace-online-001",
            expected_session_id="conv-online-001",
            expected_user_id="user-online-001",
            expected_release="release-2026-06-18",
            expected_tags=("surface:execution-control", "capability:knowledge"),
            expected_request_id="req-online-001",
            expected_run_id="run-online-001",
            expected_workflow_id="campus-agent.chat.run-online-001",
            client=httpx.Client(
                transport=httpx.MockTransport(
                    lambda _request: httpx.Response(
                        200,
                        json=_trace_payload(
                            _repo_owned_observation(),
                            {
                                "id": "obs-sdk-001",
                                "name": "langfuse.sdk.flush",
                                "metadata": {"library": "langfuse"},
                            },
                        ),
                    )
                )
            ),
        )

        self.assertEqual(evidence["observation_count"], 2)
        self.assertEqual(evidence["repo_owned_observation_count"], 1)
        self.assertEqual(evidence["contract_checked_observation_count"], 1)
        self.assertEqual(evidence["non_repo_observation_count"], 1)

    def test_repo_owned_observation_missing_contract_attributes_fails_closed(self) -> None:
        with self.assertRaisesRegex(
            LangfuseAdapterRequestError,
            "trace evidence observation obs-repo-incomplete missing observation attributes",
        ):
            verify_langfuse_online_trace_evidence(
                settings=_settings(),
                trace_id="trace-online-001",
                expected_session_id="conv-online-001",
                expected_user_id="user-online-001",
                expected_release="release-2026-06-18",
                expected_tags=("surface:execution-control", "capability:knowledge"),
                expected_request_id="req-online-001",
                expected_run_id="run-online-001",
                expected_workflow_id="campus-agent.chat.run-online-001",
                client=httpx.Client(
                    transport=httpx.MockTransport(
                        lambda _request: httpx.Response(
                            200,
                            json=_trace_payload(
                                {
                                    "id": "obs-repo-incomplete",
                                    "name": "retrieval.runtime_observation",
                                    "metadata": {
                                        "step_id": "retrieval.indexed_lookup",
                                        "status": "completed",
                                    },
                                }
                            ),
                        )
                    )
                ),
            )

    def test_trace_must_include_at_least_one_repo_owned_observation(self) -> None:
        with self.assertRaisesRegex(
            LangfuseAdapterRequestError,
            "missing repo-owned workflow or activity observations",
        ):
            verify_langfuse_online_trace_evidence(
                settings=_settings(),
                trace_id="trace-online-001",
                expected_session_id="conv-online-001",
                expected_user_id="user-online-001",
                expected_release="release-2026-06-18",
                expected_tags=("surface:execution-control", "capability:knowledge"),
                expected_request_id="req-online-001",
                expected_run_id="run-online-001",
                expected_workflow_id="campus-agent.chat.run-online-001",
                client=httpx.Client(
                    transport=httpx.MockTransport(
                        lambda _request: httpx.Response(
                            200,
                            json=_trace_payload(
                                {
                                    "id": "obs-sdk-001",
                                    "name": "langfuse.sdk.flush",
                                    "metadata": {"library": "langfuse"},
                                }
                            ),
                        )
                    )
                ),
            )


def _settings() -> LangfuseAdapterSettings:
    return LangfuseAdapterSettings(
        base_url="http://langfuse.internal:3000",
        public_key="pk-lf-test",
        secret_key="sk-lf-test",
    )


def _trace_payload(*observations: dict[str, object]) -> dict[str, object]:
    return {
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
        "observations": list(observations),
    }


def _repo_owned_observation() -> dict[str, object]:
    return {
        "id": "obs-repo-001",
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


if __name__ == "__main__":
    unittest.main()
