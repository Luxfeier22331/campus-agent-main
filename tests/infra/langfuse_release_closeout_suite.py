from __future__ import annotations

import json
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

from campus_evals.langfuse_adapter import derive_langfuse_trace_id

from scripts.check_langfuse_release_evidence import validate_langfuse_release_evidence_file
from scripts.run_langfuse_release_evidence_closeout import (
    CommandResult,
    run_langfuse_release_evidence_closeout,
)

REPO_ROOT = Path(__file__).resolve().parents[2]
PACKAGE_JSON = REPO_ROOT / "package.json"
RUNBOOK = REPO_ROOT / "docs/runbooks/runtime-otel-collector-pipeline.md"


class LangfuseReleaseCloseoutSuite(unittest.TestCase):
    def test_closeout_runs_verifier_and_publisher_and_writes_validated_artifact(self) -> None:
        commands: list[tuple[str, ...]] = []

        def runner(command: tuple[str, ...]) -> CommandResult:
            commands.append(command)
            if "verify-langfuse-trace" in command:
                return CommandResult(0, json.dumps(_verify_output()), "")
            if "publish-langfuse-score-report" in command:
                return CommandResult(0, json.dumps(_publish_output()), "")
            raise AssertionError(f"unexpected command: {command}")

        with TemporaryDirectory() as tmpdir:
            output_dir = Path(tmpdir)
            profile_report = output_dir / "profile-report.json"
            _write_profile_report(profile_report)

            result = run_langfuse_release_evidence_closeout(
                output_dir=output_dir,
                profile_report_path=profile_report,
                environment="staging",
                release="execution-control@2026-06-18",
                product_trace_id="trace-product-001",
                request_id="req-online-001",
                run_id="run-online-001",
                workflow_id="campus-agent.chat.run-online-001",
                session_id="conv-online-001",
                user_id="user-online-001",
                required_tags=("surface:execution-control", "capability:knowledge", "env:staging"),
                command_runner=runner,
            )

            artifact_path = output_dir / "langfuse-release-evidence.json"
            check = validate_langfuse_release_evidence_file(artifact_path)

        self.assertTrue(result.passed)
        self.assertEqual(result.artifact_path, artifact_path)
        self.assertTrue(check.passed)
        self.assertEqual(len(commands), 2)
        self.assertIn("verify-langfuse-trace", commands[0])
        self.assertIn("--json", commands[0])
        self.assertIn("--request-id", commands[0])
        self.assertIn("publish-langfuse-score-report", commands[1])
        self.assertIn("--score-report", commands[1])
        self.assertIn("--json", commands[1])

    def test_closeout_fails_closed_when_verifier_fails(self) -> None:
        commands: list[tuple[str, ...]] = []

        def runner(command: tuple[str, ...]) -> CommandResult:
            commands.append(command)
            return CommandResult(1, "", "trace missing")

        with TemporaryDirectory() as tmpdir:
            output_dir = Path(tmpdir)
            profile_report = output_dir / "profile-report.json"
            _write_profile_report(profile_report)

            result = run_langfuse_release_evidence_closeout(
                output_dir=output_dir,
                profile_report_path=profile_report,
                environment="staging",
                release="execution-control@2026-06-18",
                product_trace_id="trace-product-001",
                request_id="req-online-001",
                run_id="run-online-001",
                workflow_id="campus-agent.chat.run-online-001",
                session_id="conv-online-001",
                user_id="user-online-001",
                required_tags=("surface:execution-control", "capability:knowledge", "env:staging"),
                command_runner=runner,
            )

            artifact_exists = (output_dir / "langfuse-release-evidence.json").exists()

        self.assertFalse(result.passed)
        self.assertIn("verify-langfuse-trace failed", result.errors)
        self.assertEqual(len(commands), 1)
        self.assertFalse(artifact_exists)

    def test_closeout_fails_closed_when_required_tags_omit_environment_before_commands(
        self,
    ) -> None:
        with TemporaryDirectory() as tmpdir:
            output_dir = Path(tmpdir)
            profile_report = output_dir / "profile-report.json"
            _write_profile_report(profile_report)

            result = run_langfuse_release_evidence_closeout(
                output_dir=output_dir,
                profile_report_path=profile_report,
                environment="staging",
                release="execution-control@2026-06-18",
                product_trace_id="trace-product-001",
                request_id="req-online-001",
                run_id="run-online-001",
                workflow_id="campus-agent.chat.run-online-001",
                session_id="conv-online-001",
                user_id="user-online-001",
                required_tags=("surface:execution-control", "capability:knowledge"),
                command_runner=lambda _command: self.fail("closeout must fail before commands"),
            )

        self.assertFalse(result.passed)
        self.assertIn("required_tags must include env:staging", result.errors)

    def test_closeout_fails_closed_when_required_tags_omit_surface_before_commands(
        self,
    ) -> None:
        with TemporaryDirectory() as tmpdir:
            output_dir = Path(tmpdir)
            profile_report = output_dir / "profile-report.json"
            _write_profile_report(profile_report)

            result = run_langfuse_release_evidence_closeout(
                output_dir=output_dir,
                profile_report_path=profile_report,
                environment="staging",
                release="execution-control@2026-06-18",
                product_trace_id="trace-product-001",
                request_id="req-online-001",
                run_id="run-online-001",
                workflow_id="campus-agent.chat.run-online-001",
                session_id="conv-online-001",
                user_id="user-online-001",
                required_tags=("capability:knowledge", "env:staging"),
                command_runner=lambda _command: self.fail("closeout must fail before commands"),
            )

        self.assertFalse(result.passed)
        self.assertIn("required_tags must include a surface tag", result.errors)

    def test_closeout_fails_closed_when_release_is_missing_before_commands(self) -> None:
        with TemporaryDirectory() as tmpdir:
            output_dir = Path(tmpdir)
            profile_report = output_dir / "profile-report.json"
            _write_profile_report(profile_report)

            result = run_langfuse_release_evidence_closeout(
                output_dir=output_dir,
                profile_report_path=profile_report,
                environment="staging",
                release="",
                product_trace_id="trace-product-001",
                request_id="req-online-001",
                run_id="run-online-001",
                workflow_id="campus-agent.chat.run-online-001",
                session_id="conv-online-001",
                user_id="user-online-001",
                required_tags=("surface:execution-control", "capability:knowledge", "env:staging"),
                command_runner=lambda _command: self.fail("closeout must fail before commands"),
            )

        self.assertFalse(result.passed)
        self.assertIn("release is required", result.errors)

    def test_closeout_fails_closed_when_profile_report_is_missing_before_commands(self) -> None:
        with TemporaryDirectory() as tmpdir:
            output_dir = Path(tmpdir)

            result = run_langfuse_release_evidence_closeout(
                output_dir=output_dir,
                profile_report_path=output_dir / "missing-profile-report.json",
                environment="staging",
                release="execution-control@2026-06-18",
                product_trace_id="trace-product-001",
                request_id="req-online-001",
                run_id="run-online-001",
                workflow_id="campus-agent.chat.run-online-001",
                session_id="conv-online-001",
                user_id="user-online-001",
                required_tags=("surface:execution-control", "capability:knowledge", "env:staging"),
                command_runner=lambda _command: self.fail("closeout must fail before commands"),
            )

        self.assertFalse(result.passed)
        self.assertIn("profile report artifact must exist", result.errors)

    def test_closeout_fails_closed_when_profile_report_is_not_online_answer_path(
        self,
    ) -> None:
        with TemporaryDirectory() as tmpdir:
            output_dir = Path(tmpdir)
            profile_report = output_dir / "profile-report.json"
            payload = _profile_report_payload()
            payload["profile_id"] = "tool-routing-product-path"
            profile_report.write_text(json.dumps(payload), encoding="utf-8")

            result = run_langfuse_release_evidence_closeout(
                output_dir=output_dir,
                profile_report_path=profile_report,
                environment="staging",
                release="execution-control@2026-06-18",
                product_trace_id="trace-product-001",
                request_id="req-online-001",
                run_id="run-online-001",
                workflow_id="campus-agent.chat.run-online-001",
                session_id="conv-online-001",
                user_id="user-online-001",
                required_tags=("surface:execution-control", "capability:knowledge", "env:staging"),
                command_runner=lambda _command: self.fail("closeout must fail before commands"),
            )

        self.assertFalse(result.passed)
        self.assertIn("profile report profile_id must be online-answer-path", result.errors)

    def test_closeout_fails_closed_when_profile_report_has_uncorrelated_result(
        self,
    ) -> None:
        with TemporaryDirectory() as tmpdir:
            output_dir = Path(tmpdir)
            profile_report = output_dir / "profile-report.json"
            payload = _profile_report_payload()
            payload["sanitized_results"][0].pop("request_correlation")
            profile_report.write_text(json.dumps(payload), encoding="utf-8")

            result = run_langfuse_release_evidence_closeout(
                output_dir=output_dir,
                profile_report_path=profile_report,
                environment="staging",
                release="execution-control@2026-06-18",
                product_trace_id="trace-product-001",
                request_id="req-online-001",
                run_id="run-online-001",
                workflow_id="campus-agent.chat.run-online-001",
                session_id="conv-online-001",
                user_id="user-online-001",
                required_tags=("surface:execution-control", "capability:knowledge", "env:staging"),
                command_runner=lambda _command: self.fail("closeout must fail before commands"),
            )

        self.assertFalse(result.passed)
        self.assertIn(
            "profile report sanitized_results must all include request_correlation",
            result.errors,
        )

    def test_closeout_fails_closed_when_profile_report_does_not_target_closeout_trace(
        self,
    ) -> None:
        with TemporaryDirectory() as tmpdir:
            output_dir = Path(tmpdir)
            profile_report = output_dir / "profile-report.json"
            payload = _profile_report_payload()
            payload["sanitized_results"][0]["request_correlation"]["trace_id"] = "trace-other-001"
            profile_report.write_text(json.dumps(payload), encoding="utf-8")

            result = run_langfuse_release_evidence_closeout(
                output_dir=output_dir,
                profile_report_path=profile_report,
                environment="staging",
                release="execution-control@2026-06-18",
                product_trace_id="trace-product-001",
                request_id="req-online-001",
                run_id="run-online-001",
                workflow_id="campus-agent.chat.run-online-001",
                session_id="conv-online-001",
                user_id="user-online-001",
                required_tags=("surface:execution-control", "capability:knowledge", "env:staging"),
                command_runner=lambda _command: self.fail("closeout must fail before commands"),
            )

        self.assertFalse(result.passed)
        self.assertIn(
            "profile report must include a sanitized_result for the closeout product_trace_id",
            result.errors,
        )

    def test_closeout_fails_closed_when_publish_count_does_not_match_profile_report(
        self,
    ) -> None:
        commands: list[tuple[str, ...]] = []

        def runner(command: tuple[str, ...]) -> CommandResult:
            commands.append(command)
            if "verify-langfuse-trace" in command:
                return CommandResult(0, json.dumps(_verify_output()), "")
            if "publish-langfuse-score-report" in command:
                output = _publish_output()
                output["source_result_denominator"] = 2
                output["expected_publish_denominator"] = 2
                output["published"] = 1
                return CommandResult(0, json.dumps(output), "")
            raise AssertionError(f"unexpected command: {command}")

        with TemporaryDirectory() as tmpdir:
            output_dir = Path(tmpdir)
            profile_report = output_dir / "profile-report.json"
            payload = _profile_report_payload()
            payload["sanitized_results"].append(
                {
                    "case_id": "case-online-002",
                    "passed": True,
                    "request_correlation": {
                        "trace_id": "trace-product-002",
                        "request_id": "req-online-002",
                    },
                }
            )
            profile_report.write_text(json.dumps(payload), encoding="utf-8")

            result = run_langfuse_release_evidence_closeout(
                output_dir=output_dir,
                profile_report_path=profile_report,
                environment="staging",
                release="execution-control@2026-06-18",
                product_trace_id="trace-product-001",
                request_id="req-online-001",
                run_id="run-online-001",
                workflow_id="campus-agent.chat.run-online-001",
                session_id="conv-online-001",
                user_id="user-online-001",
                required_tags=("surface:execution-control", "capability:knowledge", "env:staging"),
                command_runner=runner,
            )

            artifact_exists = (output_dir / "langfuse-release-evidence.json").exists()

        self.assertFalse(result.passed)
        self.assertIn(
            "publish-langfuse-score-report published count must match expected denominator",
            result.errors,
        )
        self.assertEqual(len(commands), 2)
        self.assertFalse(artifact_exists)

    def test_closeout_fails_closed_when_verifier_output_is_not_json(self) -> None:
        commands: list[tuple[str, ...]] = []

        def runner(command: tuple[str, ...]) -> CommandResult:
            commands.append(command)
            return CommandResult(0, "not-json", "")

        with TemporaryDirectory() as tmpdir:
            output_dir = Path(tmpdir)
            profile_report = output_dir / "profile-report.json"
            _write_profile_report(profile_report)

            result = run_langfuse_release_evidence_closeout(
                output_dir=output_dir,
                profile_report_path=profile_report,
                environment="staging",
                release="execution-control@2026-06-18",
                product_trace_id="trace-product-001",
                request_id="req-online-001",
                run_id="run-online-001",
                workflow_id="campus-agent.chat.run-online-001",
                session_id="conv-online-001",
                user_id="user-online-001",
                required_tags=("surface:execution-control", "capability:knowledge", "env:staging"),
                command_runner=runner,
            )

        self.assertFalse(result.passed)
        self.assertIn("verify-langfuse-trace output is not valid JSON", result.errors[0])
        self.assertEqual(len(commands), 1)

    def test_closeout_derives_identity_from_durable_chat_artifact(self) -> None:
        commands: list[tuple[str, ...]] = []

        def runner(command: tuple[str, ...]) -> CommandResult:
            commands.append(command)
            if "verify-langfuse-trace" in command:
                return CommandResult(0, json.dumps(_verify_output()), "")
            if "publish-langfuse-score-report" in command:
                return CommandResult(0, json.dumps(_publish_output()), "")
            raise AssertionError(f"unexpected command: {command}")

        with TemporaryDirectory() as tmpdir:
            output_dir = Path(tmpdir)
            profile_report = output_dir / "profile-report.json"
            chat_artifact = output_dir / "chat-durable-reconnect.json"
            _write_profile_report(profile_report)
            chat_artifact.write_text(json.dumps(_chat_artifact()), encoding="utf-8")

            result = run_langfuse_release_evidence_closeout(
                output_dir=output_dir,
                profile_report_path=profile_report,
                environment="staging",
                release="execution-control@2026-06-18",
                product_trace_id=None,
                request_id=None,
                run_id=None,
                workflow_id=None,
                session_id=None,
                user_id=None,
                durable_chat_artifact_path=chat_artifact,
                required_tags=("surface:execution-control", "capability:knowledge", "env:staging"),
                command_runner=runner,
            )

            check = validate_langfuse_release_evidence_file(
                output_dir / "langfuse-release-evidence.json"
            )

        self.assertTrue(result.passed)
        self.assertTrue(check.passed)
        verify_command = commands[0]
        self.assertEqual(
            verify_command[verify_command.index("--product-trace-id") + 1], "trace-product-001"
        )
        self.assertEqual(verify_command[verify_command.index("--request-id") + 1], "req-online-001")
        self.assertEqual(verify_command[verify_command.index("--run-id") + 1], "run-online-001")
        self.assertEqual(
            verify_command[verify_command.index("--workflow-id") + 1],
            "campus-agent.chat.run-online-001",
        )

    def test_closeout_fails_closed_when_explicit_identity_does_not_match_artifact(self) -> None:
        with TemporaryDirectory() as tmpdir:
            output_dir = Path(tmpdir)
            profile_report = output_dir / "profile-report.json"
            chat_artifact = output_dir / "chat-durable-reconnect.json"
            _write_profile_report(profile_report)
            chat_artifact.write_text(json.dumps(_chat_artifact()), encoding="utf-8")

            result = run_langfuse_release_evidence_closeout(
                output_dir=output_dir,
                profile_report_path=profile_report,
                environment="staging",
                release="execution-control@2026-06-18",
                product_trace_id="trace-different",
                request_id=None,
                run_id=None,
                workflow_id=None,
                session_id=None,
                user_id=None,
                durable_chat_artifact_path=chat_artifact,
                required_tags=("surface:execution-control", "capability:knowledge", "env:staging"),
                command_runner=lambda _command: self.fail("closeout must fail before commands"),
            )

        self.assertFalse(result.passed)
        self.assertIn(
            "product_trace_id does not match durable chat artifact langfuseCloseout value",
            result.errors,
        )

    def test_closeout_fails_closed_when_durable_chat_artifact_did_not_pass(self) -> None:
        with TemporaryDirectory() as tmpdir:
            output_dir = Path(tmpdir)
            profile_report = output_dir / "profile-report.json"
            chat_artifact = output_dir / "chat-durable-reconnect.json"
            _write_profile_report(profile_report)
            failed_artifact = _chat_artifact()
            failed_artifact["passed"] = False
            chat_artifact.write_text(json.dumps(failed_artifact), encoding="utf-8")

            result = run_langfuse_release_evidence_closeout(
                output_dir=output_dir,
                profile_report_path=profile_report,
                environment="staging",
                release="execution-control@2026-06-18",
                product_trace_id=None,
                request_id=None,
                run_id=None,
                workflow_id=None,
                session_id=None,
                user_id=None,
                durable_chat_artifact_path=chat_artifact,
                required_tags=("surface:execution-control", "capability:knowledge", "env:staging"),
                command_runner=lambda _command: self.fail("closeout must fail before commands"),
            )

        self.assertFalse(result.passed)
        self.assertIn("durable chat artifact passed must be true", result.errors)

    def test_closeout_runner_is_in_ci_and_runbook(self) -> None:
        scripts = json.loads(PACKAGE_JSON.read_text(encoding="utf-8"))["scripts"]
        runbook = RUNBOOK.read_text(encoding="utf-8")

        self.assertIn("tests.infra.langfuse_release_closeout_suite", scripts["ci:langfuse"])
        self.assertIn("scripts.run_langfuse_release_evidence_closeout", runbook)
        self.assertIn("--durable-chat-artifact", runbook)


def _verify_output() -> dict[str, object]:
    return {
        "trace_id": derive_langfuse_trace_id("trace-product-001"),
        "session_id": "conv-online-001",
        "user_id": "user-online-001",
        "release": "execution-control@2026-06-18",
        "tags": ["surface:execution-control", "capability:knowledge", "env:staging"],
        "observation_count": 2,
        "repo_owned_observation_count": 1,
        "contract_checked_observation_count": 1,
        "non_repo_observation_count": 1,
        "trace_identity": {
            "request_id": "req-online-001",
            "run_id": "run-online-001",
            "workflow_id": "campus-agent.chat.run-online-001",
            "trace_id": "trace-product-001",
        },
    }


def _publish_output() -> dict[str, object]:
    return {
        "score_report_path": "langfuse-score-report.json",
        "eval_run_id": "online-answer-path:git-head-001:profile-2026-06-18",
        "release": "profile-2026-06-18",
        "source_result_denominator": 1,
        "expected_publish_denominator": 1,
        "published": 1,
        "failed": 0,
        "omitted": 0,
        "dry_run": False,
        "validate_only": False,
    }


def _chat_artifact() -> dict[str, object]:
    return {
        "passed": True,
        "langfuseCloseout": {
            "productTraceId": "trace-product-001",
            "requestId": "req-online-001",
            "runId": "run-online-001",
            "sessionId": "conv-online-001",
            "userId": "user-online-001",
            "workflowId": "campus-agent.chat.run-online-001",
        },
    }


def _write_profile_report(path: Path) -> None:
    path.write_text(json.dumps(_profile_report_payload()), encoding="utf-8")


def _profile_report_payload() -> dict[str, object]:
    return {
        "schema_version": "eval_profile_report.v1",
        "profile_id": "online-answer-path",
        "case_family": "online_answer_path.v1",
        "version_summary": {
            "case_set_version": "online_answer_path.v1",
            "policy_artifact": "eval_operations_profile_policy.v1",
            "runtime_version": "profile-2026-06-18",
            "git_head": "git-head-001",
        },
        "sanitized_results": [
            {
                "case_id": "case-online-001",
                "passed": True,
                "request_correlation": {
                    "trace_id": "trace-product-001",
                    "request_id": "req-online-001",
                },
            }
        ],
    }
