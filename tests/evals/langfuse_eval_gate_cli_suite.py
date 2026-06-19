from __future__ import annotations

import json
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

from campus_evals.langfuse_adapter import derive_langfuse_trace_id

from scripts.eval_gate import main as eval_gate_main


class LangfuseEvalGateCliSuite(unittest.TestCase):
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
                    "--request-id",
                    "req-online-001",
                    "--run-id",
                    "run-online-001",
                    "--workflow-id",
                    "campus-agent.chat.run-online-001",
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
        self.assertEqual(call["expected_request_id"], "req-online-001")
        self.assertEqual(call["expected_run_id"], "run-online-001")
        self.assertEqual(call["expected_workflow_id"], "campus-agent.chat.run-online-001")
        settings = call["settings"]
        self.assertEqual(settings.base_url, "http://langfuse.internal:3000")
        self.assertEqual(settings.public_key, "pk-lf-test")
        self.assertEqual(settings.secret_key, "sk-lf-test")
        self.assertEqual(
            json.loads(print_mock.call_args.args[0]),
            {"trace_id": "trace-online-001", "observation_count": 2},
        )

    def test_eval_gate_verifies_langfuse_trace_by_product_trace_id(self) -> None:
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
                "trace_id": derive_langfuse_trace_id("trace_001"),
                "observation_count": 2,
            }

            exit_code = eval_gate_main(
                [
                    "verify-langfuse-trace",
                    "--product-trace-id",
                    "trace_001",
                    "--session-id",
                    "conv-online-001",
                    "--user-id",
                    "user-online-001",
                    "--release",
                    "release-2026-06-18",
                    "--tag",
                    "surface:execution-control",
                    "--json",
                ]
            )

        self.assertEqual(exit_code, 0)
        verify.assert_called_once()
        self.assertEqual(verify.call_args.kwargs["trace_id"], derive_langfuse_trace_id("trace_001"))
        self.assertEqual(
            json.loads(print_mock.call_args.args[0]),
            {"trace_id": derive_langfuse_trace_id("trace_001"), "observation_count": 2},
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
