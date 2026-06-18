from __future__ import annotations

import base64
import json
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

import httpx
from campus_evals.langfuse_adapter import (
    LangfuseAdapterDisabled,
    LangfuseAdapterRequestError,
    LangfuseAdapterSettings,
    create_langfuse_adapter,
    verify_langfuse_online_trace_evidence,
)

from scripts.eval_gate import main as eval_gate_main


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

        self.assertEqual(result, {"published": 1, "skipped": 0})
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
        self.assertEqual(payload["traceId"], "trace_001")
        self.assertEqual(payload["name"], "online-answer-path.profile")
        self.assertEqual(payload["value"], 1)
        self.assertEqual(payload["dataType"], "BOOLEAN")
        self.assertEqual(payload["source"], "API")
        self.assertEqual(payload["environment"], "staging")
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

    def test_adapter_skips_uncorrelated_profile_results(self) -> None:
        requests: list[httpx.Request] = []
        adapter = create_langfuse_adapter(
            LangfuseAdapterSettings(
                base_url="http://langfuse.internal:3000",
                public_key="pk-lf-test",
                secret_key="sk-lf-test",
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

        self.assertEqual(result, {"published": 0, "skipped": 1})
        self.assertEqual(requests, [])

    def test_adapter_fails_closed_on_langfuse_request_failure(self) -> None:
        adapter = create_langfuse_adapter(
            LangfuseAdapterSettings(
                base_url="http://langfuse.internal:3000",
                public_key="pk-lf-test",
                secret_key="sk-lf-test",
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
                        {"id": "obs-001", "name": "retrieval.runtime_observation"},
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

    def test_eval_gate_publishes_profile_report_to_langfuse_from_env(self) -> None:
        with TemporaryDirectory() as tmpdir:
            profile_report_path = Path(tmpdir) / "profile-report.json"
            profile_report_path.write_text(
                json.dumps(
                    _profile_report_payload(
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
                ),
                encoding="utf-8",
            )

            with (
                patch.dict(
                    "os.environ",
                    {
                        "LANGFUSE_BASE_URL": "http://langfuse.internal:3000",
                        "LANGFUSE_PUBLIC_KEY": "pk-lf-test",
                        "LANGFUSE_SECRET_KEY": "sk-lf-test",
                        "LANGFUSE_ENVIRONMENT": "staging",
                    },
                    clear=False,
                ),
                patch("scripts.eval_gate.publish_langfuse_profile_report_artifact") as publish,
                patch("builtins.print") as print_mock,
            ):
                publish.return_value = {"published": 1, "skipped": 0}

                exit_code = eval_gate_main(
                    [
                        "publish-langfuse-profile",
                        "--profile-report",
                        str(profile_report_path),
                        "--json",
                    ]
                )

        self.assertEqual(exit_code, 0)
        publish.assert_called_once()
        self.assertEqual(publish.call_args.kwargs["profile_report_path"], profile_report_path)
        settings = publish.call_args.kwargs["settings"]
        self.assertEqual(settings.base_url, "http://langfuse.internal:3000")
        self.assertEqual(settings.public_key, "pk-lf-test")
        self.assertEqual(settings.secret_key, "sk-lf-test")
        self.assertEqual(settings.environment, "staging")
        self.assertEqual(json.loads(print_mock.call_args.args[0]), {"published": 1, "skipped": 0})

    def test_eval_gate_verifies_langfuse_trace_evidence_from_env(self) -> None:
        with (
            patch.dict(
                "os.environ",
                {
                    "LANGFUSE_BASE_URL": "http://langfuse.internal:3000",
                    "LANGFUSE_PUBLIC_KEY": "pk-lf-test",
                    "LANGFUSE_SECRET_KEY": "sk-lf-test",
                },
                clear=False,
            ),
            patch("scripts.eval_gate.verify_langfuse_online_trace_evidence_artifact") as verify,
            patch("builtins.print") as print_mock,
        ):
            verify.return_value = {
                "trace_id": "trace-online-001",
                "observation_count": 2,
            }

            exit_code = eval_gate_main(
                [
                    "verify-langfuse-trace",
                    "--trace-id",
                    "trace-online-001",
                    "--session-id",
                    "conv-online-001",
                    "--user-id",
                    "user-online-001",
                    "--release",
                    "release-2026-06-18",
                    "--tag",
                    "surface:execution-control",
                    "--tag",
                    "capability:knowledge",
                    "--json",
                ]
            )

        self.assertEqual(exit_code, 0)
        verify.assert_called_once()
        call = verify.call_args.kwargs
        self.assertEqual(call["trace_id"], "trace-online-001")
        self.assertEqual(call["expected_session_id"], "conv-online-001")
        self.assertEqual(call["expected_user_id"], "user-online-001")
        self.assertEqual(call["expected_release"], "release-2026-06-18")
        self.assertEqual(
            call["expected_tags"], ("surface:execution-control", "capability:knowledge")
        )
        settings = call["settings"]
        self.assertEqual(settings.base_url, "http://langfuse.internal:3000")
        self.assertEqual(settings.public_key, "pk-lf-test")
        self.assertEqual(settings.secret_key, "sk-lf-test")
        self.assertEqual(
            json.loads(print_mock.call_args.args[0]),
            {"trace_id": "trace-online-001", "observation_count": 2},
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
