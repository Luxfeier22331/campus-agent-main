from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

import httpx
from campus_evals.eval_operations_governance import (
    evaluate_eval_operations_governance,
    load_eval_operations_profile_policy,
)
from campus_evals.eval_profile_gate import (
    collect_document_quality_runtime_observations,
    derive_eval_operations_observations_from_artifacts,
    run_online_answer_path_profile_gate,
)
from campus_evals.online_answer_path_eval import load_online_answer_path_cases


class EvalProfileGateSuite(unittest.TestCase):
    def test_online_answer_profile_gate_writes_unified_artifact(self) -> None:
        case_set = load_online_answer_path_cases()
        observations = {
            case.case_id: {
                "case_id": case.case_id,
                "request_id": f"request-{case.case_id}",
                "trace_id": f"trace-{case.case_id}",
                "selected_capability": case.expected.selected_capability,
                "terminal_outcome": case.expected.terminal_outcome,
                "fail_close_reason": case.expected.fail_close_reason,
                "response_contract": case.expected.response_contract,
                "operator_backflow": case.expected.operator_backflow,
            }
            for case in case_set.cases
        }

        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            observations_path = root / "observations.json"
            observations_path.write_text(
                json.dumps({"observations": list(observations.values())}),
                encoding="utf-8",
            )
            report = run_online_answer_path_profile_gate(
                output_dir=root / "out",
                observations_path=observations_path,
                git_head_resolver=lambda: "abc123",
            )

            payload = json.loads(report.output_path.read_text(encoding="utf-8"))

        self.assertTrue(report.passed)
        self.assertEqual(payload["schema_version"], "eval_profile_gate.v1")
        self.assertEqual(payload["profile_id"], "online_answer_path")
        self.assertEqual(payload["case_family"], "online_answer_path.v1")
        self.assertEqual(payload["version_summary"]["git_head"], "abc123")
        self.assertEqual(
            payload["version_summary"]["case_set_version"], "online_answer_path.v1"
        )
        self.assertIn("sanitized_results", payload)

    def test_eval_operations_observation_is_derived_from_profile_artifact(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            artifact_path = Path(tmpdir) / "profile-report.json"
            artifact_path.write_text(
                json.dumps(
                    {
                        "schema_version": "eval_profile_gate.v1",
                        "profile_id": "online_answer_path",
                        "summary": {
                            "total": 2,
                            "failed": 1,
                            "runtime_seconds": 7,
                            "retry_count": 0,
                            "provider_calls": 0,
                            "started_at": "2026-05-01T00:00:00+00:00",
                            "finished_at": "2026-05-01T00:00:07+00:00",
                            "collector_version": "eval_profile_gate.v1",
                            "runtime_profile": "online_answer_path",
                        },
                        "sanitized_results": [
                            {"case_id": "case-a", "passed": True},
                            {
                                "case_id": "case-b",
                                "passed": False,
                                "failure_class": "missing_observation",
                            },
                        ],
                        "version_summary": {
                            "case_set_version": "online_answer_path.v1",
                            "policy_artifact": "eval_operations_profile_policy.v1",
                            "runtime_version": "eval_profile_gate.v1",
                        },
                    }
                ),
                encoding="utf-8",
            )

            observations = derive_eval_operations_observations_from_artifacts(
                [artifact_path],
                gate_mode="release_gate",
            )

        observation = observations["online_answer_path"]
        self.assertEqual(observation.cases_run, 2)
        self.assertEqual(observation.failed_cases, ("case-b",))
        self.assertEqual(observation.case_dispositions["case-b"], "missing_observation")
        self.assertEqual(observation.version_summary["runtime_version"], "eval_profile_gate.v1")
        self.assertFalse(observation.metrics_missing)

    def test_legacy_profile_artifact_runtime_metrics_are_missing_without_full_summary(
        self,
    ) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            artifact_path = Path(tmpdir) / "profile-report.json"
            artifact_path.write_text(
                json.dumps(
                    {
                        "schema_version": "eval_profile_gate.v1",
                        "profile_id": "online_answer_path",
                        "summary": {
                            "total": 1,
                            "failed": 0,
                            "runtime_seconds": 7,
                            "retry_count": 0,
                            "provider_calls": 0,
                        },
                        "sanitized_results": [{"case_id": "case-a", "passed": True}],
                        "version_summary": {
                            "case_set_version": "online_answer_path.v1",
                            "policy_artifact": "eval_operations_profile_policy.v1",
                            "runtime_version": "eval_profile_gate.v1",
                        },
                    }
                ),
                encoding="utf-8",
            )

            observations = derive_eval_operations_observations_from_artifacts(
                [artifact_path],
                gate_mode="release_gate",
            )

        self.assertTrue(observations["online_answer_path"].metrics_missing)

    def test_profile_report_preserves_safe_request_correlation_for_runtime_backflow(self) -> None:
        case_set = load_online_answer_path_cases()
        case = case_set.cases[0]

        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            observations_path = root / "observations.json"
            observations_path.write_text(
                json.dumps(
                    {
                        "observations": [
                            {
                                "case_id": case.case_id,
                                "request_id": "req_public_01",
                                "trace_id": "trace_public_01",
                                "selected_capability": case.expected.selected_capability,
                                "terminal_outcome": case.expected.terminal_outcome,
                                "fail_close_reason": case.expected.fail_close_reason,
                                "response_contract": case.expected.response_contract,
                                "operator_backflow": case.expected.operator_backflow,
                                "request_correlation": {
                                    "case_id": case.case_id,
                                    "request_id": "req_public_01",
                                    "trace_id": "trace_public_01",
                                    "sampled_at": "2026-04-29T00:00:00+00:00",
                                    "trace_link": "https://traces.example/trace_public_01",
                                },
                            }
                        ]
                    }
                ),
                encoding="utf-8",
            )

            report = run_online_answer_path_profile_gate(
                output_dir=root / "out",
                cases_path=_single_online_answer_case_path(root, case),
                observations_path=observations_path,
                git_head_resolver=lambda: "abc123",
            )
            payload = json.loads(report.output_path.read_text(encoding="utf-8"))

        self.assertTrue(report.passed)
        self.assertEqual(
            payload["sanitized_results"][0]["request_correlation"],
            {
                "case_id": case.case_id,
                "request_id": "req_public_01",
                "trace_id": "trace_public_01",
                "sampled_at": "2026-04-29T00:00:00+00:00",
                "trace_link": "https://traces.example/trace_public_01",
                "issue_link": None,
                "issue_fingerprint": None,
            },
        )

    def test_online_answer_profile_replays_workflow_trace_summary_consistency(self) -> None:
        case_set = load_online_answer_path_cases()
        case = next(
            item
            for item in case_set.cases
            if item.expected.selected_capability == "campus_services"
            and item.expected.terminal_outcome == "completed"
        )

        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            observations_path = root / "observations.json"
            observations_path.write_text(
                json.dumps(
                    {
                        "observations": [
                            {
                                "case_id": case.case_id,
                                "request_id": "req_public_trace_replay",
                                "trace_id": "trace_public_trace_replay",
                                "selected_capability": case.expected.selected_capability,
                                "terminal_outcome": case.expected.terminal_outcome,
                                "fail_close_reason": case.expected.fail_close_reason,
                                "response_contract": case.expected.response_contract,
                                "operator_backflow": case.expected.operator_backflow,
                                "workflow_trace_summary": {
                                    "direct_vs_delegate_branch": "delegate",
                                    "selected_capability": "notice",
                                    "selected_tools": ["campus_notice_discover"],
                                    "fail_close_reason": "",
                                },
                            }
                        ]
                    }
                ),
                encoding="utf-8",
            )

            report = run_online_answer_path_profile_gate(
                output_dir=root / "out",
                cases_path=_single_online_answer_case_path(root, case),
                observations_path=observations_path,
                git_head_resolver=lambda: "abc123",
            )
            payload = json.loads(report.output_path.read_text(encoding="utf-8"))

        self.assertFalse(report.passed)
        self.assertIn(
            "workflow_trace_summary.selected_capability expected",
            payload["sanitized_results"][0]["reason"],
        )

    def test_runtime_metrics_missing_from_profile_artifact_fails_operations_governance(
        self,
    ) -> None:
        policy = load_eval_operations_profile_policy(
            payload={
                "schema_version": 1,
                "policy_id": "eval_operations_profile_policy.v1",
                "profiles": [
                    {
                        "profile_id": "online_answer_path",
                        "budget": {
                            "max_cases_per_run": 20,
                            "max_provider_calls_per_run": 20,
                        },
                        "runtime_timeout_seconds": 300,
                        "max_retries": 0,
                        "pacing_seconds": 0.0,
                        "breaker": {"failure_threshold": 1, "cooldown_seconds": 60},
                        "retention": {
                            "artifact_days": 30,
                            "promoted_artifact_days": 180,
                        },
                        "allowed_gate_modes": ["release_gate"],
                        "failure_dispositions": ["failed"],
                        "quarantine": {
                            "allowed": False,
                            "max_days": 1,
                            "readmission_rule": "not allowed",
                        },
                        "required_version_fields": [
                            "case_set_version",
                            "policy_artifact",
                            "runtime_version",
                        ],
                    }
                ],
            }
        )

        with tempfile.TemporaryDirectory() as tmpdir:
            artifact_path = Path(tmpdir) / "profile-report.json"
            artifact_path.write_text(
                json.dumps(
                    {
                        "schema_version": "eval_profile_gate.v1",
                        "profile_id": "online_answer_path",
                        "summary": {
                            "total": 1,
                            "passed": 1,
                            "failed": 0,
                            "metrics_missing": True,
                        },
                        "sanitized_results": [{"case_id": "case-a", "passed": True}],
                        "version_summary": {
                            "case_set_version": "online_answer_path.v1",
                            "policy_artifact": "eval_operations_profile_policy.v1",
                            "runtime_version": "eval_profile_gate.v1",
                        },
                    }
                ),
                encoding="utf-8",
            )

            observations = derive_eval_operations_observations_from_artifacts(
                [artifact_path],
                gate_mode="release_gate",
            )

        self.assertTrue(observations["online_answer_path"].metrics_missing)
        report = evaluate_eval_operations_governance(policy, observations)
        self.assertFalse(report.passed)
        self.assertIn("runtime_metrics_missing", report.results[0].failure_classes)

    def test_document_quality_runtime_collector_reads_normalized_manifest_not_raw_ocr(
        self,
    ) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            manifest_path = Path(tmpdir) / "normalized-document-manifest.json"
            manifest_path.write_text(
                json.dumps(
                    {
                        "schema_version": 1,
                        "documents": [
                            {
                                "case_id": "document-quality-transport-table-ocr",
                                "normalized_text": "海淀校区 丰台校区 发车时间",
                                "raw_ocr_text": "RAW SHOULD NOT BE USED",
                                "table_headers": ["方向", "发车时间", "乘车点"],
                                "confidence": 0.93,
                                "projection_target": "transport_schedule_candidate",
                                "claims": ["班车时刻表候选"],
                            }
                        ],
                    }
                ),
                encoding="utf-8",
            )

            observations = collect_document_quality_runtime_observations(
                manifest_path=manifest_path
            )

        observation = observations["document-quality-transport-table-ocr"]
        self.assertIn("海淀校区", observation.extracted_text)
        self.assertNotIn("RAW SHOULD NOT BE USED", observation.extracted_text)
        self.assertEqual(observation.table_headers, ("方向", "发车时间", "乘车点"))
        self.assertEqual(observation.projection_target, "transport_schedule_candidate")


class AppApiEvalClientGenericRequestSuite(unittest.TestCase):
    def test_execute_chat_request_reuses_headers_decode_and_request_correlation(self) -> None:
        from campus_evals.app_api_chat_runtime_client import (
            AppApiEvalClient,
            AppApiEvalClientSettings,
        )

        seen: dict[str, object] = {}

        def handler(request: httpx.Request) -> httpx.Response:
            seen["path"] = request.url.path
            seen["body"] = json.loads(request.content.decode("utf-8"))
            seen["auth"] = request.headers.get("x-app-internal-auth")
            seen["email"] = request.headers.get("x-eval-user-email")
            return httpx.Response(
                200,
                json={
                    "answer": {
                        "conversation": {
                            "id": "conversation-1",
                            "updatedAt": "2026-04-29T00:00:00+00:00",
                        },
                        "result": {
                            "requestId": "req_runtime_01",
                            "traceId": "trace_runtime_01",
                            "kind": "answer",
                            "text": "ok",
                        },
                    },
                    "supervisor": {
                        "status": "completed",
                        "selectedCapability": "campus_services",
                        "answerText": "ok",
                        "traceId": "trace_runtime_01",
                        "observability": {
                            "selectedTool": "service_status_lookup",
                            "toolBusinessOutcome": "completed",
                        },
                        "workflow_trace_summary": {
                            "planning_outcome": "direct_structured_tool",
                            "direct_vs_delegate_branch": "direct",
                            "selected_capability": "campus_services",
                            "selected_tools": ["service_status_lookup"],
                            "tool_call_summaries": [
                                {
                                    "tool_name": "service_status_lookup",
                                    "result_status": "completed",
                                }
                            ],
                        },
                    },
                },
            )

        http_client = httpx.Client(
            base_url="https://app-api.example",
            transport=httpx.MockTransport(handler),
        )
        client = AppApiEvalClient(
            settings=AppApiEvalClientSettings(
                app_api_base_url="https://app-api.example",
                internal_shared_secret="shared-secret",
                eval_user_email="eval@example.edu",
                trace_link_template="https://traces.example/{trace_id}",
            ),
            client=http_client,
        )

        execution = client.execute_chat_request(
            case_id="runtime-case-1",
            prompt="校园卡丢了怎么办",
            requested_capability="campus_services",
            requested_scope={"corpus": "campus_services", "collection": "service_status"},
        )

        self.assertEqual(seen["path"], "/api/internal/evals/chat/requests")
        self.assertEqual(seen["auth"], "shared-secret")
        self.assertEqual(seen["email"], "eval@example.edu")
        self.assertEqual(
            seen["body"],
            {
                "prompt": "校园卡丢了怎么办",
                "requestedCapability": "campus_services",
                "requestedScope": {
                    "corpus": "campus_services",
                    "collection": "service_status",
                },
            },
        )
        self.assertEqual(execution.request_correlation.request_id, "req_runtime_01")
        self.assertEqual(execution.request_correlation.trace_id, "trace_runtime_01")
        self.assertEqual(
            execution.request_correlation.trace_link,
            "https://traces.example/trace_runtime_01",
        )
        self.assertEqual(execution.response.observability.selected_tool, "service_status_lookup")
        self.assertEqual(
            execution.response.workflow_trace_summary.tool_call_summaries,
            ({"tool_name": "service_status_lookup", "result_status": "completed"},),
        )


def _single_online_answer_case_path(root: Path, case) -> Path:
    path = root / "single-online-answer-case.json"
    path.write_text(
        json.dumps(
            {
                "schema_version": 1,
                "case_family": "online_answer_path.v1",
                "cases": [
                    {
                        "case_id": case.case_id,
                        "user_goal": case.user_goal,
                        "split": case.split,
                        "expected": {
                            "selected_capability": case.expected.selected_capability,
                            "terminal_outcome": case.expected.terminal_outcome,
                            "fail_close_reason": case.expected.fail_close_reason,
                            "response_contract": case.expected.response_contract,
                            "operator_backflow": case.expected.operator_backflow,
                        },
                    }
                ],
            }
        ),
        encoding="utf-8",
    )
    return path


if __name__ == "__main__":
    unittest.main()
