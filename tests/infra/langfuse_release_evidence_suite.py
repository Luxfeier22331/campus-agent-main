from __future__ import annotations

import json
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

from campus_evals.langfuse_adapter import derive_langfuse_trace_id

from scripts.build_langfuse_release_evidence import (
    build_langfuse_release_evidence_payload,
    write_langfuse_release_evidence_file,
)
from scripts.check_langfuse_release_evidence import (
    validate_langfuse_release_evidence,
    validate_langfuse_release_evidence_file,
)

REPO_ROOT = Path(__file__).resolve().parents[2]
PACKAGE_JSON = REPO_ROOT / "package.json"
RUNBOOK = REPO_ROOT / "docs/runbooks/runtime-otel-collector-pipeline.md"
E2E_TEMPLATE = REPO_ROOT / "docs/runbooks/templates/e2e-qa-release-artifact-template.md"


class LangfuseReleaseEvidenceSuite(unittest.TestCase):
    def test_accepts_complete_real_trace_and_eval_publish_evidence(self) -> None:
        result = validate_langfuse_release_evidence(_valid_evidence())

        self.assertTrue(result.passed)
        self.assertEqual(result.errors, ())

    def test_fails_closed_when_trace_identity_does_not_match_product_evidence(self) -> None:
        payload = _valid_evidence()
        payload["verify_langfuse_trace"]["output"]["trace_identity"]["request_id"] = "req-different"

        result = validate_langfuse_release_evidence(payload)

        self.assertFalse(result.passed)
        self.assertIn(
            "verify_langfuse_trace.output.trace_identity.request_id must match request_id",
            result.errors,
        )

    def test_fails_closed_when_required_tags_do_not_include_environment(self) -> None:
        payload = _valid_evidence()
        payload["required_tags"] = ["surface:execution-control", "capability:knowledge"]

        result = validate_langfuse_release_evidence(payload)

        self.assertFalse(result.passed)
        self.assertIn("required_tags must include env:staging", result.errors)

    def test_fails_closed_when_required_tags_do_not_include_surface_or_capability(
        self,
    ) -> None:
        payload = _valid_evidence()
        payload["required_tags"] = ["env:staging"]

        result = validate_langfuse_release_evidence(payload)

        self.assertFalse(result.passed)
        self.assertIn("required_tags must include a surface tag", result.errors)
        self.assertIn("required_tags must include a capability tag", result.errors)

    def test_fails_closed_when_langfuse_trace_id_is_not_repo_derived(self) -> None:
        payload = _valid_evidence()
        payload["langfuse_trace_id"] = "00000000000000000000000000000000"
        payload["verify_langfuse_trace"]["output"]["trace_id"] = "00000000000000000000000000000000"

        result = validate_langfuse_release_evidence(payload)

        self.assertFalse(result.passed)
        self.assertIn("langfuse_trace_id must be derived from product_trace_id", result.errors)

    def test_fails_closed_when_eval_publish_did_not_publish_scores(self) -> None:
        payload = _valid_evidence()
        payload["publish_langfuse_score_report"]["output"]["published"] = 0

        result = validate_langfuse_release_evidence(payload)

        self.assertFalse(result.passed)
        self.assertIn(
            "publish_langfuse_score_report.output.published must be greater than zero",
            result.errors,
        )

    def test_fails_closed_when_eval_publish_omitted_scores(self) -> None:
        payload = _valid_evidence()
        payload["publish_langfuse_score_report"]["output"]["omitted"] = 1

        result = validate_langfuse_release_evidence(payload)

        self.assertFalse(result.passed)
        self.assertIn("publish_langfuse_score_report.output.omitted must be 0", result.errors)

    def test_fails_closed_when_eval_publish_failed_scores(self) -> None:
        payload = _valid_evidence()
        payload["publish_langfuse_score_report"]["output"]["failed"] = 1

        result = validate_langfuse_release_evidence(payload)

        self.assertFalse(result.passed)
        self.assertIn("publish_langfuse_score_report.output.failed must be 0", result.errors)

    def test_fails_closed_when_expected_publish_count_is_missing(self) -> None:
        payload = _valid_evidence()
        payload["publish_langfuse_score_report"].pop("expected_publish_denominator")

        result = validate_langfuse_release_evidence(payload)

        self.assertFalse(result.passed)
        self.assertIn(
            "publish_langfuse_score_report.expected_publish_denominator must be an integer",
            result.errors,
        )

    def test_fails_closed_when_publish_count_does_not_match_expected_count(self) -> None:
        payload = _valid_evidence()
        payload["publish_langfuse_score_report"]["expected_publish_denominator"] = 2

        result = validate_langfuse_release_evidence(payload)

        self.assertFalse(result.passed)
        self.assertIn(
            "publish_langfuse_score_report.output.published must match expected_publish_denominator",
            result.errors,
        )

    def test_fails_closed_when_trace_verifier_command_is_not_json_mode(self) -> None:
        payload = _valid_evidence()
        payload["verify_langfuse_trace"]["command"] = (
            "uv run --all-packages python -m scripts.eval_gate verify-langfuse-trace"
        )

        result = validate_langfuse_release_evidence(payload)

        self.assertFalse(result.passed)
        self.assertIn("verify_langfuse_trace.command must include --json", result.errors)

    def test_fails_closed_when_trace_verifier_command_omits_closeout_identity_flags(
        self,
    ) -> None:
        payload = _valid_evidence()
        payload["verify_langfuse_trace"]["command"] = (
            "uv run --all-packages python -m scripts.eval_gate verify-langfuse-trace "
            "--product-trace-id trace-product-001 "
            "--session-id conv-online-001 "
            "--user-id user-online-001 "
            "--release execution-control@2026-06-18 "
            "--json"
        )

        result = validate_langfuse_release_evidence(payload)

        self.assertFalse(result.passed)
        self.assertIn("verify_langfuse_trace.command must include --request-id", result.errors)
        self.assertIn("verify_langfuse_trace.command must include --run-id", result.errors)
        self.assertIn("verify_langfuse_trace.command must include --workflow-id", result.errors)

    def test_fails_closed_when_trace_verifier_command_omits_required_tag_value(self) -> None:
        payload = _valid_evidence()
        payload["verify_langfuse_trace"]["command"] = _valid_verify_command().replace(
            " --tag env:staging",
            "",
        )

        result = validate_langfuse_release_evidence(payload)

        self.assertFalse(result.passed)
        self.assertIn(
            "verify_langfuse_trace.command must include required --tag value env:staging",
            result.errors,
        )

    def test_fails_closed_when_trace_verifier_command_tag_is_not_tag_flag_value(self) -> None:
        payload = _valid_evidence()
        payload["verify_langfuse_trace"]["command"] = _valid_verify_command().replace(
            "--tag env:staging",
            "env:staging",
        )

        result = validate_langfuse_release_evidence(payload)

        self.assertFalse(result.passed)
        self.assertIn(
            "verify_langfuse_trace.command must include required --tag value env:staging",
            result.errors,
        )

    def test_fails_closed_when_trace_verifier_command_identity_value_drifts(self) -> None:
        payload = _valid_evidence()
        payload["verify_langfuse_trace"]["command"] = _valid_verify_command().replace(
            "--request-id req-online-001",
            "--request-id req-different",
        )

        result = validate_langfuse_release_evidence(payload)

        self.assertFalse(result.passed)
        self.assertIn(
            "verify_langfuse_trace.command --request-id must match request_id",
            result.errors,
        )

    def test_fails_closed_when_trace_verifier_command_identity_flag_has_no_value(self) -> None:
        payload = _valid_evidence()
        payload["verify_langfuse_trace"]["command"] = (
            _valid_verify_command().replace(
                " --workflow-id campus-agent.chat.run-online-001",
                "",
            )
            + " --workflow-id"
        )

        result = validate_langfuse_release_evidence(payload)

        self.assertFalse(result.passed)
        self.assertIn(
            "verify_langfuse_trace.command --workflow-id must match workflow_id",
            result.errors,
        )

    def test_fails_closed_when_publish_command_is_not_online_answer_json_mode(self) -> None:
        payload = _valid_evidence()
        payload["publish_langfuse_score_report"]["command"] = (
            "uv run --all-packages python -m scripts.eval_gate publish-langfuse-score-report"
        )

        result = validate_langfuse_release_evidence(payload)

        self.assertFalse(result.passed)
        self.assertIn("publish_langfuse_score_report.command must include --json", result.errors)

    def test_fails_closed_without_crashing_on_malformed_numeric_fields(self) -> None:
        payload = _valid_evidence()
        payload["verify_langfuse_trace"]["exit_code"] = "not-a-number"

        result = validate_langfuse_release_evidence(payload)

        self.assertFalse(result.passed)
        self.assertIn("verify_langfuse_trace.exit_code must be an integer", result.errors)

    def test_validates_artifact_file_and_cli_exit_code(self) -> None:
        with TemporaryDirectory() as tmpdir:
            artifact_path = Path(tmpdir) / "langfuse-release-evidence.json"
            artifact_path.write_text(
                json.dumps(_valid_evidence(), ensure_ascii=False),
                encoding="utf-8",
            )

            result = validate_langfuse_release_evidence_file(artifact_path)

        self.assertTrue(result.passed)

    def test_builds_release_evidence_artifact_from_command_outputs(self) -> None:
        payload = build_langfuse_release_evidence_payload(
            environment="staging",
            release="execution-control@2026-06-18",
            product_trace_id="trace-product-001",
            request_id="req-online-001",
            run_id="run-online-001",
            workflow_id="campus-agent.chat.run-online-001",
            session_id="conv-online-001",
            user_id="user-online-001",
            required_tags=("surface:execution-control", "capability:knowledge", "env:staging"),
            verify_exit_code=0,
            verify_output=_valid_evidence()["verify_langfuse_trace"]["output"],
            verify_command=_valid_verify_command(),
            publish_exit_code=0,
            expected_publish_denominator=1,
            publish_output=_valid_evidence()["publish_langfuse_score_report"]["output"],
            publish_command=_valid_publish_command(),
        )

        self.assertEqual(payload, _valid_evidence())
        self.assertTrue(validate_langfuse_release_evidence(payload).passed)

    def test_builder_writes_validated_artifact_file(self) -> None:
        with TemporaryDirectory() as tmpdir:
            artifact_path = Path(tmpdir) / "langfuse-release-evidence.json"

            write_langfuse_release_evidence_file(
                artifact_path,
                _valid_evidence(),
            )

            result = validate_langfuse_release_evidence_file(artifact_path)

        self.assertTrue(result.passed)

    def test_builder_cli_writes_validated_artifact_from_output_files(self) -> None:
        with TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            verify_output = root / "verify-langfuse-trace.json"
            publish_output = root / "publish-langfuse-score-report.json"
            artifact_path = root / "langfuse-release-evidence.json"
            verify_output.write_text(
                json.dumps(_valid_evidence()["verify_langfuse_trace"]["output"]),
                encoding="utf-8",
            )
            publish_output.write_text(
                json.dumps(_valid_evidence()["publish_langfuse_score_report"]["output"]),
                encoding="utf-8",
            )

            from scripts.build_langfuse_release_evidence import main

            with patch("sys.stdout"):
                exit_code = main(
                    [
                        "--output",
                        str(artifact_path),
                        "--environment",
                        "staging",
                        "--release",
                        "execution-control@2026-06-18",
                        "--product-trace-id",
                        "trace-product-001",
                        "--request-id",
                        "req-online-001",
                        "--run-id",
                        "run-online-001",
                        "--workflow-id",
                        "campus-agent.chat.run-online-001",
                        "--session-id",
                        "conv-online-001",
                        "--user-id",
                        "user-online-001",
                        "--tag",
                        "surface:execution-control",
                        "--tag",
                        "capability:knowledge",
                        "--tag",
                        "env:staging",
                        "--verify-output",
                        str(verify_output),
                        "--verify-exit-code",
                        "0",
                        "--verify-command",
                        _valid_verify_command(),
                        "--publish-output",
                        str(publish_output),
                        "--publish-exit-code",
                        "0",
                        "--expected-publish-denominator",
                        "1",
                        "--publish-command",
                        _valid_publish_command(),
                    ]
                )

            result = validate_langfuse_release_evidence_file(artifact_path)

        self.assertEqual(exit_code, 0)
        self.assertTrue(result.passed)

    def test_cli_returns_nonzero_for_missing_evidence(self) -> None:
        with TemporaryDirectory() as tmpdir:
            artifact_path = Path(tmpdir) / "langfuse-release-evidence.json"
            artifact_path.write_text(
                json.dumps({"schema_version": "langfuse_release_evidence.v1"}),
                encoding="utf-8",
            )

            from scripts.check_langfuse_release_evidence import main

            with patch("sys.stderr") as stderr:
                exit_code = main([str(artifact_path)])

        self.assertEqual(exit_code, 1)
        self.assertTrue(stderr.write.called)

    def test_release_evidence_checker_is_in_ci_and_runbook_closeout(self) -> None:
        scripts = json.loads(PACKAGE_JSON.read_text(encoding="utf-8"))["scripts"]
        runbook = RUNBOOK.read_text(encoding="utf-8")
        template = E2E_TEMPLATE.read_text(encoding="utf-8")

        self.assertIn("tests.infra.langfuse_release_evidence_suite", scripts["ci:langfuse"])
        self.assertIn("scripts.build_langfuse_release_evidence", runbook)
        self.assertIn("scripts.check_langfuse_release_evidence", runbook)
        self.assertIn("langfuse-release-evidence.json", runbook)
        self.assertIn("langfuse-release-evidence.json", template)


def _valid_evidence() -> dict[str, object]:
    return {
        "schema_version": "langfuse_release_evidence.v1",
        "environment": "staging",
        "release": "execution-control@2026-06-18",
        "product_trace_id": "trace-product-001",
        "langfuse_trace_id": derive_langfuse_trace_id("trace-product-001"),
        "request_id": "req-online-001",
        "run_id": "run-online-001",
        "workflow_id": "campus-agent.chat.run-online-001",
        "session_id": "conv-online-001",
        "user_id": "user-online-001",
        "required_tags": ["surface:execution-control", "capability:knowledge", "env:staging"],
        "verify_langfuse_trace": {
            "command": _valid_verify_command(),
            "exit_code": 0,
            "output": {
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
            },
        },
        "publish_langfuse_score_report": {
            "command": _valid_publish_command(),
            "exit_code": 0,
            "profile_id": "online-answer-path",
            "score_report_path": "langfuse-score-report.json",
            "expected_publish_denominator": 1,
            "output": {
                "source_result_denominator": 1,
                "expected_publish_denominator": 1,
                "published": 1,
                "failed": 0,
                "omitted": 0,
                "score_report_path": "langfuse-score-report.json",
                "eval_run_id": "eval-run-001",
                "release": "eval_profile_gate.v1",
            },
        },
    }


def _valid_verify_command() -> str:
    return (
        "uv run --all-packages python -m scripts.eval_gate verify-langfuse-trace "
        "--product-trace-id trace-product-001 "
        "--session-id conv-online-001 "
        "--user-id user-online-001 "
        "--release execution-control@2026-06-18 "
        "--request-id req-online-001 "
        "--run-id run-online-001 "
        "--workflow-id campus-agent.chat.run-online-001 "
        "--tag surface:execution-control "
        "--tag capability:knowledge "
        "--tag env:staging "
        "--json"
    )


def _valid_publish_command() -> str:
    return (
        "uv run --all-packages python -m scripts.eval_gate "
        "publish-langfuse-score-report --score-report langfuse-score-report.json --json"
    )
