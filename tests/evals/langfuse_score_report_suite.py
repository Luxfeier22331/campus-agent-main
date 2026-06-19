from __future__ import annotations

import base64
import io
import json
import unittest
from contextlib import redirect_stdout
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

import httpx
from campus_evals.langfuse_adapter import LangfuseAdapterSettings, create_langfuse_adapter

from scripts.eval_gate import main as eval_gate_main

REPO_ROOT = Path(__file__).resolve().parents[2]
VALID_SCORE_REPORT_FIXTURE = (
    REPO_ROOT / "packages/evals/fixtures/ops/langfuse_score_report.valid.v1.json"
)
MALFORMED_SCORE_REPORT_FIXTURE = (
    REPO_ROOT / "packages/evals/fixtures/ops/langfuse_score_report.denominator-drift.v1.json"
)


class LangfuseScoreReportSuite(unittest.TestCase):
    def test_score_report_golden_and_malformed_fixtures_are_validated(self) -> None:
        from campus_evals.langfuse_score_report import (
            load_langfuse_score_report,
            validate_langfuse_score_report,
        )

        self.assertEqual(
            validate_langfuse_score_report(load_langfuse_score_report(VALID_SCORE_REPORT_FIXTURE))[
                "score_count"
            ],
            1,
        )
        with self.assertRaisesRegex(ValueError, "source_result_denominator"):
            validate_langfuse_score_report(
                load_langfuse_score_report(MALFORMED_SCORE_REPORT_FIXTURE)
            )

    def test_validator_accepts_complete_score_report(self) -> None:
        from campus_evals.langfuse_score_report import validate_langfuse_score_report

        summary = validate_langfuse_score_report(_score_report_payload())

        self.assertEqual(
            summary,
            {
                "schema_version": "langfuse_score_report.v1",
                "eval_kind": "profile",
                "eval_run_id": "eval-run-001",
                "profile_id": "online-answer-path",
                "source_result_denominator": 1,
                "expected_publish_denominator": 1,
                "score_count": 1,
                "omitted": 0,
            },
        )

    def test_validator_rejects_denominator_drift(self) -> None:
        from campus_evals.langfuse_score_report import validate_langfuse_score_report

        payload = _score_report_payload()
        payload["source_result_denominator"] = 2

        with self.assertRaisesRegex(ValueError, "source_result_denominator"):
            validate_langfuse_score_report(payload)

    def test_validator_rejects_unknown_score_name(self) -> None:
        from campus_evals.langfuse_score_report import validate_langfuse_score_report

        payload = _score_report_payload()
        payload["score_items"][0]["name"] = "unknown.score"

        with self.assertRaisesRegex(ValueError, "unknown Langfuse score name"):
            validate_langfuse_score_report(payload)

    def test_validator_rejects_boolean_json_values(self) -> None:
        from campus_evals.langfuse_score_report import validate_langfuse_score_report

        payload = _score_report_payload()
        payload["score_items"][0]["value"] = True

        with self.assertRaisesRegex(ValueError, "BOOLEAN score value must be 0 or 1"):
            validate_langfuse_score_report(payload)

    def test_publisher_posts_score_report_items_with_stable_ids(self) -> None:
        from campus_evals.langfuse_score_report import publish_langfuse_score_report

        requests: list[httpx.Request] = []

        def handler(request: httpx.Request) -> httpx.Response:
            requests.append(request)
            return httpx.Response(200, json={"id": "score-001"})

        summary = publish_langfuse_score_report(
            score_report_payload=_score_report_payload(),
            score_report_path=Path("/tmp/langfuse-score-report.json"),
            settings=LangfuseAdapterSettings(
                base_url="http://langfuse.internal:3000",
                public_key="pk-lf-test",
                secret_key="sk-lf-test",
            ),
            client=httpx.Client(transport=httpx.MockTransport(handler)),
        )

        self.assertEqual(summary["published"], 1)
        self.assertEqual(summary["failed"], 0)
        self.assertEqual(summary["omitted"], 0)
        self.assertEqual(summary["expected_publish_denominator"], 1)
        self.assertEqual(summary["source_result_denominator"], 1)
        self.assertEqual(summary["score_report_path"], "/tmp/langfuse-score-report.json")
        self.assertEqual(len(requests), 1)

        request = requests[0]
        self.assertEqual(str(request.url), "http://langfuse.internal:3000/api/public/scores")
        expected_auth = base64.b64encode(b"pk-lf-test:sk-lf-test").decode("ascii")
        self.assertEqual(request.headers["authorization"], f"Basic {expected_auth}")

        payload = json.loads(request.content.decode("utf-8"))
        self.assertEqual(payload["id"], "lfscore:eval-run-001:case-001:profile")
        self.assertEqual(payload["traceId"], "langfuse-trace-001")
        self.assertEqual(payload["name"], "online-answer-path.profile")
        self.assertEqual(payload["value"], 1)
        self.assertEqual(payload["dataType"], "BOOLEAN")
        self.assertEqual(payload["source"], "API")
        self.assertNotIn("environment", payload)
        self.assertEqual(payload["metadata"]["case_id"], "case-001")

    def test_publisher_validate_only_posts_nothing(self) -> None:
        from campus_evals.langfuse_score_report import publish_langfuse_score_report

        requests: list[httpx.Request] = []

        summary = publish_langfuse_score_report(
            score_report_payload=_score_report_payload(),
            score_report_path=Path("/tmp/langfuse-score-report.json"),
            settings=LangfuseAdapterSettings(
                base_url="http://langfuse.internal:3000",
                public_key="pk-lf-test",
                secret_key="sk-lf-test",
            ),
            validate_only=True,
            client=httpx.Client(
                transport=httpx.MockTransport(
                    lambda request: requests.append(request) or httpx.Response(200)
                )
            ),
        )

        self.assertEqual(requests, [])
        self.assertEqual(summary["published"], 0)
        self.assertEqual(summary["failed"], 0)
        self.assertEqual(summary["omitted"], 0)
        self.assertTrue(summary["validate_only"])

    def test_profile_adapter_converts_uncorrelated_results_to_omitted_items(self) -> None:
        from campus_evals.langfuse_score_report import build_score_report_from_profile_report

        payload = _profile_report_payload(
            {
                "case_id": "case-001",
                "passed": True,
                "request_correlation": {
                    "request_id": "req-001",
                    "trace_id": "trace-product-001",
                },
            },
            {"case_id": "case-uncorrelated", "passed": False},
        )

        report = build_score_report_from_profile_report(
            profile_report_payload=payload,
            profile_report_path=Path("/tmp/profile-report.json"),
            environment="staging",
        )

        self.assertEqual(report["source_result_denominator"], 2)
        self.assertEqual(report["expected_publish_denominator"], 1)
        self.assertEqual(len(report["score_items"]), 1)
        self.assertEqual(len(report["omitted_items"]), 1)
        self.assertEqual(report["omitted_items"][0]["reason"], "missing_request_correlation")

    def test_adapter_profile_publish_uses_score_report_denominators(self) -> None:
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
                        requests.append(request) or httpx.Response(200, json={"id": "score-001"})
                    )
                )
            ),
        )

        result = adapter.publish_profile_report(
            _profile_report_payload(
                {
                    "case_id": "case-001",
                    "passed": True,
                    "request_correlation": {
                        "request_id": "req-001",
                        "trace_id": "trace-product-001",
                    },
                },
                {"case_id": "case-uncorrelated", "passed": False},
            )
        )

        self.assertEqual(result["source_result_denominator"], 2)
        self.assertEqual(result["expected_publish_denominator"], 1)
        self.assertEqual(result["published"], 1)
        self.assertEqual(result["failed"], 0)
        self.assertEqual(result["omitted"], 1)
        self.assertEqual(len(requests), 1)

    def test_eval_gate_publishes_score_report_from_env(self) -> None:
        with TemporaryDirectory() as tmpdir:
            score_report_path = Path(tmpdir) / "langfuse-score-report.json"
            score_report_path.write_text(
                json.dumps(_score_report_payload()),
                encoding="utf-8",
            )

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
                patch(
                    "scripts.eval_gate.publish_langfuse_score_report_artifact",
                    return_value={
                        "published": 0,
                        "failed": 0,
                        "omitted": 0,
                        "validate_only": True,
                    },
                ) as publish,
            ):
                buffer = io.StringIO()
                with redirect_stdout(buffer):
                    exit_code = eval_gate_main(
                        [
                            "publish-langfuse-score-report",
                            "--score-report",
                            str(score_report_path),
                            "--validate-only",
                            "--json",
                        ]
                    )

        self.assertEqual(exit_code, 0)
        publish.assert_called_once()
        self.assertEqual(publish.call_args.kwargs["score_report_path"], score_report_path)
        self.assertTrue(publish.call_args.kwargs["validate_only"])
        self.assertFalse(publish.call_args.kwargs["dry_run"])
        self.assertEqual(json.loads(buffer.getvalue())["validate_only"], True)


def _score_report_payload() -> dict[str, object]:
    return {
        "schema_version": "langfuse_score_report.v1",
        "eval_kind": "profile",
        "eval_run_id": "eval-run-001",
        "profile_id": "online-answer-path",
        "surface_key": "app-api.chat",
        "variant_id": "baseline",
        "environment": "staging",
        "release": "eval_profile_gate.v1",
        "source_git_head": "git-head-001",
        "source_artifact_path": "profile-report.json",
        "source_result_denominator": 1,
        "expected_publish_denominator": 1,
        "score_items": [
            {
                "idempotency_key": "lfscore:eval-run-001:case-001:profile",
                "name": "online-answer-path.profile",
                "data_type": "BOOLEAN",
                "value": 1,
                "case_id": "case-001",
                "trace_id": "langfuse-trace-001",
                "observation_id": None,
                "session_id": None,
                "dataset_run_id": None,
                "dataset_item_id": None,
                "metadata": {
                    "profile_id": "online-answer-path",
                    "case_id": "case-001",
                    "request_id": "req-001",
                    "case_family": "online_answer_path.v1",
                    "schema_version": "eval_profile_gate.v1",
                    "grader_version": "eval_profile_gate.v1",
                    "failure_class": None,
                },
                "comment": "profile result passed",
            }
        ],
        "omitted_items": [],
    }


def _profile_report_payload(*results: dict[str, object]) -> dict[str, object]:
    return {
        "schema_version": "eval_profile_gate.v1",
        "profile_id": "online-answer-path",
        "case_family": "online_answer_path.v1",
        "passed": True,
        "summary": {"total": len(results), "passed": 1, "failed": max(0, len(results) - 1)},
        "version_summary": {
            "case_set_version": "online_answer_path.v1",
            "policy_artifact": "eval_operations_profile_policy.v1",
            "runtime_version": "eval_profile_gate.v1",
            "git_head": "git-head-001",
        },
        "sanitized_results": list(results),
    }


if __name__ == "__main__":
    unittest.main()
