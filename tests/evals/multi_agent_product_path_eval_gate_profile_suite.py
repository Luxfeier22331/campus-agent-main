from __future__ import annotations

import json
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from types import SimpleNamespace
from unittest.mock import patch

import campus_evals.multi_agent_live_smoke_gate as multi_agent_live_smoke_gate
import campus_evals.multi_agent_runtime_contract_gate as multi_agent_runtime_contract_gate

from scripts.eval_gate import run_eval_acceptance


class MultiAgentProductPathEvalGateProfileTest(unittest.TestCase):
    def test_eval_gate_accept_supports_multi_agent_runtime_contract_profile(self) -> None:
        with TemporaryDirectory() as temp_dir:
            output_dir = Path(temp_dir) / "multi-agent-runtime-contract-gate"
            with patch.object(
                multi_agent_runtime_contract_gate,
                "main",
                return_value=0,
            ) as runner:
                summary = run_eval_acceptance(
                    profile="multi-agent-runtime-contract",
                    output_dir=output_dir,
                    reruns=1,
                )

        self.assertEqual(summary["profile"], "multi-agent-runtime-contract")
        self.assertEqual(summary["exit_code"], 0)
        runner.assert_called_once_with(
            [
                "accept",
                "--output-dir",
                str(output_dir),
                "--reruns",
                "1",
            ]
        )

    def test_eval_gate_accept_supports_multi_agent_live_smoke_profile(self) -> None:
        with TemporaryDirectory() as temp_dir:
            output_dir = Path(temp_dir) / "multi-agent-live-smoke"
            with patch.object(
                multi_agent_live_smoke_gate,
                "main",
                return_value=0,
            ) as runner:
                summary = run_eval_acceptance(
                    profile="multi-agent-live-smoke",
                    output_dir=output_dir,
                    reruns=1,
                )

        self.assertEqual(summary["profile"], "multi-agent-live-smoke")
        self.assertEqual(summary["exit_code"], 0)
        runner.assert_called_once_with(
            [
                "accept",
                "--output-dir",
                str(output_dir),
                "--reruns",
                "1",
            ]
        )

    def test_multi_agent_live_smoke_gate_runs_positive_and_closed_profiles(self) -> None:
        observed_profiles: list[str] = []

        def fake_smoke(plan, *, timeout_seconds: float) -> dict[str, object]:
            observed_profiles.append(plan.profile)
            return {
                "schema_version": "supervisor_runtime_process_smoke.v1",
                "profile": plan.profile,
                "passed": True,
                "probes": {"answer_status": plan.expected_status},
                "answer": {"workflow_trace_summary": _current_workflow_trace_summary(plan.profile)},
            }

        with TemporaryDirectory() as temp_dir:
            output_dir = Path(temp_dir) / "multi-agent-live-smoke"
            with patch.object(multi_agent_live_smoke_gate, "run_process_smoke", fake_smoke):
                payload = multi_agent_live_smoke_gate.run_multi_agent_live_smoke_gate(
                    output_dir=output_dir,
                    timeout_seconds=1,
                )

            artifact = json.loads(
                (output_dir / multi_agent_live_smoke_gate.DEFAULT_REPORT_NAME).read_text(
                    encoding="utf-8"
                )
            )

        self.assertEqual(
            observed_profiles,
            list(multi_agent_live_smoke_gate.DEFAULT_GOVERNED_WORKFLOW_PROCESS_SMOKE_PROFILES),
        )
        self.assertTrue(payload["passed"])
        self.assertEqual(artifact["summary"]["total_profiles"], len(observed_profiles))
        self.assertIn("rag_delegate", artifact["workflow_trace_replay"]["evaluated_profiles"])

    def test_multi_agent_live_smoke_default_profiles_cover_governed_workflow_lane(self) -> None:
        self.assertEqual(
            set(multi_agent_live_smoke_gate.DEFAULT_GOVERNED_WORKFLOW_PROCESS_SMOKE_PROFILES),
            {
                "closed_gate",
                "terminal_fail_close",
                "rag_delegate",
                "multi_step_notice_knowledge_followthrough",
                "multi_step_transport_notice_knowledge_pilot",
            },
        )
        self.assertEqual(
            set(multi_agent_live_smoke_gate.DEFAULT_SINGLE_SURFACE_SDK_PROCESS_SMOKE_PROFILES),
            {
                "transport_schedule_sdk_opened",
                "transport_schedule_sdk_opened_stream",
                "service_status_sdk_opened",
                "service_guide_sdk_opened",
                "contact_directory_sdk_opened",
                "notice_discover_sdk_opened",
                "academic_calendar_sdk_opened",
                "transactional_approval_required",
            },
        )
        self.assertEqual(
            set(multi_agent_live_smoke_gate.DEFAULT_PROCESS_SMOKE_PROFILES),
            set(multi_agent_live_smoke_gate.DEFAULT_GOVERNED_WORKFLOW_PROCESS_SMOKE_PROFILES)
            | set(multi_agent_live_smoke_gate.DEFAULT_SINGLE_SURFACE_SDK_PROCESS_SMOKE_PROFILES),
        )
        self.assertEqual(
            multi_agent_live_smoke_gate.PROFILE_WORKFLOW_TRACE_CASE_IDS[
                "multi_step_notice_knowledge_followthrough"
            ],
            "workflow-notice-knowledge-followthrough-multistep",
        )
        self.assertEqual(
            multi_agent_live_smoke_gate.PROFILE_WORKFLOW_TRACE_CASE_IDS[
                "multi_step_transport_notice_knowledge_pilot"
            ],
            "workflow-transport-notice-knowledge-pilot-multistep",
        )

    def test_multi_agent_live_smoke_assigns_distinct_local_ports_per_profile(self) -> None:
        built_ports: list[tuple[str, int, int, int]] = []

        def fake_build_process_smoke_plan(
            *,
            repo_root,
            output_dir,
            profile: str,
            api_port: int,
            worker_port: int,
            object_store_port: int,
        ):
            built_ports.append((profile, api_port, worker_port, object_store_port))
            return SimpleNamespace(
                profile=profile,
                expected_status=200,
                output_dir=output_dir,
            )

        def fake_smoke(plan, *, timeout_seconds: float) -> dict[str, object]:
            return {
                "schema_version": "supervisor_runtime_process_smoke.v1",
                "profile": plan.profile,
                "passed": True,
                "probes": {"answer_status": plan.expected_status},
                "answer": {
                    "workflow_trace_summary": _current_workflow_trace_summary(plan.profile),
                },
            }

        with TemporaryDirectory() as temp_dir:
            output_dir = Path(temp_dir) / "multi-agent-live-smoke"
            with (
                patch.object(
                    multi_agent_live_smoke_gate,
                    "build_process_smoke_plan",
                    side_effect=fake_build_process_smoke_plan,
                ),
                patch.object(multi_agent_live_smoke_gate, "run_process_smoke", fake_smoke),
            ):
                multi_agent_live_smoke_gate.run_multi_agent_live_smoke_gate(
                    output_dir=output_dir,
                    timeout_seconds=1,
                    profiles=("closed_gate", "rag_delegate", "multi_step_transport_notice_knowledge_pilot"),
                )

        self.assertEqual(len(built_ports), 3)
        self.assertEqual(len({item[1] for item in built_ports}), 3)
        self.assertEqual(len({item[2] for item in built_ports}), 3)
        self.assertEqual(len({item[3] for item in built_ports}), 3)

    def test_multi_agent_live_smoke_workflow_replay_is_blocking(self) -> None:
        def fake_smoke(plan, *, timeout_seconds: float) -> dict[str, object]:
            summary = _current_workflow_trace_summary(plan.profile)
            if plan.profile == "rag_delegate":
                summary = {
                    **summary,
                    "selected_target": "notice-agent",
                }
            return {
                "schema_version": "supervisor_runtime_process_smoke.v1",
                "profile": plan.profile,
                "passed": True,
                "probes": {"answer_status": plan.expected_status},
                "answer": {
                    "workflow_trace_summary": summary,
                },
            }

        with TemporaryDirectory() as temp_dir:
            output_dir = Path(temp_dir) / "multi-agent-live-smoke"
            with patch.object(multi_agent_live_smoke_gate, "run_process_smoke", fake_smoke):
                payload = multi_agent_live_smoke_gate.run_multi_agent_live_smoke_gate(
                    output_dir=output_dir,
                    timeout_seconds=1,
                    profiles=("rag_delegate",),
                )

        replay = payload["workflow_trace_replay"]
        self.assertFalse(payload["passed"])
        self.assertFalse(replay.get("report_only", False))
        self.assertEqual(replay["failed_case_ids"], ["workflow-knowledge-delegate"])

    def test_multi_agent_live_smoke_missing_mapped_trace_fails_gate(self) -> None:
        def fake_smoke(plan, *, timeout_seconds: float) -> dict[str, object]:
            return {
                "schema_version": "supervisor_runtime_process_smoke.v1",
                "profile": plan.profile,
                "passed": True,
                "probes": {"answer_status": plan.expected_status},
                "answer": {},
            }

        with TemporaryDirectory() as temp_dir:
            output_dir = Path(temp_dir) / "multi-agent-live-smoke"
            with patch.object(multi_agent_live_smoke_gate, "run_process_smoke", fake_smoke):
                payload = multi_agent_live_smoke_gate.run_multi_agent_live_smoke_gate(
                    output_dir=output_dir,
                    timeout_seconds=1,
                    profiles=("rag_delegate",),
                )

        replay = payload["workflow_trace_replay"]
        self.assertFalse(payload["passed"])
        self.assertEqual(replay["missing_case_ids"], ["workflow-knowledge-delegate"])

    def test_multi_agent_live_smoke_replay_accepts_current_workflow_trace_shapes(self) -> None:
        def fake_smoke(plan, *, timeout_seconds: float) -> dict[str, object]:
            return {
                "schema_version": "supervisor_runtime_process_smoke.v1",
                "profile": plan.profile,
                "passed": True,
                "probes": {"answer_status": plan.expected_status},
                "answer": {
                    "workflow_trace_summary": _current_workflow_trace_summary(plan.profile),
                },
            }

        with TemporaryDirectory() as temp_dir:
            output_dir = Path(temp_dir) / "multi-agent-live-smoke"
            with patch.object(multi_agent_live_smoke_gate, "run_process_smoke", fake_smoke):
                payload = multi_agent_live_smoke_gate.run_multi_agent_live_smoke_gate(
                    output_dir=output_dir,
                    timeout_seconds=1,
                )

        replay = payload["workflow_trace_replay"]
        self.assertEqual(replay["failed_case_ids"], [])
        self.assertEqual(replay["missing_case_ids"], [])
        self.assertEqual(
            set(replay["evaluated_profiles"]),
            set(multi_agent_live_smoke_gate.DEFAULT_GOVERNED_WORKFLOW_PROCESS_SMOKE_PROFILES)
            & set(multi_agent_live_smoke_gate.PROFILE_WORKFLOW_TRACE_CASE_IDS),
        )

    def test_multi_agent_live_smoke_overwrites_existing_process_smoke_summary(self) -> None:
        call_count = {"value": 0}

        def fake_smoke(plan, *, timeout_seconds: float) -> dict[str, object]:
            call_count["value"] += 1
            summary = _current_workflow_trace_summary(plan.profile)
            if call_count["value"] == 1:
                summary = {
                    **summary,
                    "selected_target": "notice-agent",
                }
            return {
                "schema_version": "supervisor_runtime_process_smoke.v1",
                "profile": plan.profile,
                "passed": True,
                "probes": {"answer_status": plan.expected_status},
                "answer": {
                    "workflow_trace_summary": summary,
                },
            }

        with TemporaryDirectory() as temp_dir:
            output_dir = Path(temp_dir) / "multi-agent-live-smoke"
            with patch.object(multi_agent_live_smoke_gate, "run_process_smoke", fake_smoke):
                first_payload = multi_agent_live_smoke_gate.run_multi_agent_live_smoke_gate(
                    output_dir=output_dir,
                    timeout_seconds=1,
                    profiles=("rag_delegate",),
                )
                second_payload = multi_agent_live_smoke_gate.run_multi_agent_live_smoke_gate(
                    output_dir=output_dir,
                    timeout_seconds=1,
                    profiles=("rag_delegate",),
                )

        self.assertFalse(first_payload["passed"])
        self.assertEqual(
            first_payload["workflow_trace_replay"]["failed_case_ids"],
            ["workflow-knowledge-delegate"],
        )
        self.assertTrue(second_payload["passed"])
        self.assertEqual(second_payload["workflow_trace_replay"]["failed_case_ids"], [])

    def test_eval_gate_rejects_publish_dry_run_for_multi_agent_product_path_profile(
        self,
    ) -> None:
        with (
            TemporaryDirectory() as temp_dir,
            self.assertRaisesRegex(
                ValueError,
                "multi-agent-runtime-contract does not produce live case-results artifacts",
            ),
        ):
            run_eval_acceptance(
                profile="multi-agent-product-path",
                output_dir=Path(temp_dir),
                reruns=1,
                publish_dry_run=True,
                publish_grade_source="eval_release_gate",
                publish_grader_version="grader@2026-04-29",
            )


if __name__ == "__main__":
    unittest.main()


def _current_workflow_trace_summary(profile: str) -> dict[str, object]:
    base = {
        "routing_frame": {"routing_next_action": "delegate"},
        "context_resolution": {"state": "not_follow_up"},
        "planning_outcome": "preplanned",
        "runtime_versions": {"workflow_trace_summary": "test"},
        "policy_artifact_versions": {"intent_policy": "test"},
    }
    if profile == "terminal_fail_close":
        return {
            **base,
            "planning_outcome": "not_preplanned",
            "direct_vs_delegate_branch": "fail_close",
            "workflow_mode": "terminal",
            "handoff": {},
            "handoff_chain": [],
            "selected_target": "none",
            "selected_tools": [],
            "tool_argument_summary": {},
            "trace_steps": [
                {
                    "step_id": "runtime_policy",
                    "span_kind": "runtime_policy",
                    "parent_step_id": "",
                    "outcome": "out_of_scope",
                },
                {
                    "step_id": "finalization",
                    "span_kind": "finalization",
                    "parent_step_id": "runtime_policy",
                    "outcome": "no_answer",
                },
            ],
            "tool_call_summaries": [],
            "guardrail_outcomes": {
                "context_preflight": "not_follow_up",
                "policy_gate": "out_of_scope",
                "scope_gate": "out_of_scope",
            },
            "fail_close_reason": "product_scope_boundary",
        }
    if profile == "rag_delegate":
        return _tool_workflow_trace_summary(
            target="rag-agent",
            tool="retrieval.query",
            branch="delegate",
            mode="single_handoff",
            argument_summary={
                "collection": "student_rules",
                "corpus": "regulations",
                "payload_kind": "rag_request",
                "selected_tool": "retrieval.query",
            },
            guardrail_scope="in_scope",
        )
    if profile == "multi_step_notice_knowledge_followthrough":
        return {
            **base,
            "routing_frame": {"routing_next_action": "multi_step"},
            "context_resolution": {"state": "resolved"},
            "direct_vs_delegate_branch": "multi_step",
            "workflow_mode": "multi_step",
            "handoff": {
                "target": "notice-agent",
                "payload_kind": "campus_notice_get",
                "allowed_tools": [],
            },
            "handoff_chain": [
                {
                    "target": "notice-agent",
                    "payload_kind": "campus_notice_get",
                },
                {
                    "target": "rag-agent",
                    "payload_kind": "rag_request",
                    "selected_tool": "retrieval.query",
                },
            ],
            "selected_target": "rag-agent",
            "selected_tools": ["retrieval.query"],
            "tool_argument_summary": {
                "payload_kind": "campus_notice_get",
                "selected_tool": "retrieval.query",
                "notice_id": "notice:smoke:001",
                "source_family": "wechat_public_notice",
            },
            "context_projections": [
                {
                    "projection_id": "projection:notice_context:test",
                    "source_step_id": "handoff:notice-agent:campus_notice_get",
                    "projection_kind": "notice_context",
                    "content_hash": "sha256:test",
                    "safety": {
                        "truncated": False,
                        "redacted": False,
                        "max_chars": 1600,
                        "fields_present": ["title", "body_excerpt", "source_url"],
                    },
                },
                {
                    "projection_id": "projection:evidence_bundle:test",
                    "source_step_id": "handoff:rag-agent:rag_request",
                    "projection_kind": "evidence_bundle",
                    "content_hash": "sha256:evidence",
                    "safety": {
                        "truncated": False,
                        "redacted": False,
                        "max_chars": 1600,
                        "fields_present": ["corpus", "collection", "query_text", "source_refs"],
                    },
                },
                {
                    "projection_id": "projection:grounding_verdict:test",
                    "source_step_id": "handoff:rag-agent:rag_request",
                    "projection_kind": "grounding_verdict",
                    "content_hash": "sha256:grounding",
                    "safety": {
                        "truncated": False,
                        "redacted": False,
                        "max_chars": 1600,
                        "fields_present": ["grounding_verdict", "semantic_outcome"],
                    },
                },
            ],
            "trace_steps": [
                {
                    "step_id": "handoff:notice-agent:campus_notice_get",
                    "span_kind": "handoff",
                    "parent_step_id": "runtime_policy",
                    "target": "notice-agent",
                    "tool_name": "campus_notice_get",
                    "outcome": "completed",
                    "result_status": "completed",
                },
                {
                    "step_id": "handoff:rag-agent:rag_request",
                    "span_kind": "handoff",
                    "parent_step_id": "handoff:notice-agent:campus_notice_get",
                    "target": "rag-agent",
                    "tool_name": "retrieval.query",
                    "outcome": "needs_clarification",
                    "result_status": "needs_clarification",
                },
            ],
            "agent_invocations": [
                {
                    "invocation_id": "agent-invocation:notice-agent:campus_notice_get",
                    "workflow_run_ref": "multi_step:notice-agent:campus_notice_get",
                    "step_id": "handoff:notice-agent:campus_notice_get",
                    "agent_id": "notice-agent",
                    "status": "completed",
                },
                {
                    "invocation_id": "agent-invocation:rag-agent:rag_request",
                    "parent_invocation_id": "agent-invocation:notice-agent:campus_notice_get",
                    "workflow_run_ref": "multi_step:rag-agent:rag_request",
                    "step_id": "handoff:rag-agent:rag_request",
                    "agent_id": "rag-agent",
                    "status": "needs_clarification",
                    "projection_ids": ["projection:notice_context:test"],
                },
            ],
            "tool_call_summaries": [
                {
                    "result_projection": "bounded_summary",
                    "raw_result_included": False,
                    "tool_name": "retrieval.query",
                    "result_status": "needs_clarification",
                    "business_outcome": "needs_clarification",
                    "argument_summary": {
                        "payload_kind": "campus_notice_get",
                        "selected_tool": "retrieval.query",
                        "notice_id": "notice:smoke:001",
                        "source_family": "wechat_public_notice",
                    },
                    "source_ids": ["handbook:rule-001"],
                }
            ],
            "guardrail_outcomes": {
                "context_preflight": "resolved",
                "policy_gate": "delegate",
                "scope_gate": "in_scope",
            },
            "fail_close_reason": "",
        }
    if profile == "multi_step_transport_notice_knowledge_pilot":
        return {
            **base,
            "routing_frame": {"routing_next_action": "delegate"},
            "context_resolution": {"state": "not_follow_up"},
            "direct_vs_delegate_branch": "multi_step",
            "workflow_mode": "multi_step",
            "handoff": {
                "target": "campus-services-agent",
                "payload_kind": "transport_schedule_lookup",
                "allowed_tools": ["transport_schedule_lookup"],
            },
            "handoff_chain": [
                {
                    "target": "campus-services-agent",
                    "payload_kind": "transport_schedule_lookup",
                    "selected_tool": "transport_schedule_lookup",
                },
                {
                    "target": "notice-agent",
                    "payload_kind": "campus_notice_get",
                },
                {
                    "target": "rag-agent",
                    "payload_kind": "rag_request",
                    "selected_tool": "retrieval.query",
                },
            ],
            "selected_target": "rag-agent",
            "selected_tools": ["transport_schedule_lookup", "retrieval.query"],
            "tool_argument_summary": {
                "payload_kind": "transport_schedule_lookup",
                "selected_tool": "retrieval.query",
                "intent": "next_departure",
                "notice_id": "notice:transport:355122",
                "source_family": "internal_notice_restricted",
            },
            "context_projections": [
                {
                    "projection_id": "projection:schedule_baseline:test",
                    "source_step_id": (
                        "handoff:campus-services-agent:transport_schedule_lookup"
                    ),
                    "projection_kind": "schedule_baseline",
                    "content_hash": "sha256:schedule",
                    "safety": {
                        "truncated": False,
                        "redacted": False,
                        "max_chars": 1600,
                        "fields_present": [
                            "route_id",
                            "display_name",
                            "service_family",
                            "answer_text",
                        ],
                    },
                },
                {
                    "projection_id": "projection:notice_context:test",
                    "source_step_id": "handoff:notice-agent:campus_notice_get",
                    "projection_kind": "notice_context",
                    "content_hash": "sha256:notice",
                    "safety": {
                        "truncated": False,
                        "redacted": False,
                        "max_chars": 1600,
                        "fields_present": ["title", "body_excerpt", "source_url"],
                    },
                },
                {
                    "projection_id": "projection:evidence_bundle:test",
                    "source_step_id": "handoff:rag-agent:rag_request",
                    "projection_kind": "evidence_bundle",
                    "content_hash": "sha256:evidence",
                    "safety": {
                        "truncated": False,
                        "redacted": False,
                        "max_chars": 1600,
                        "fields_present": ["corpus", "collection", "query_text", "source_refs"],
                    },
                },
                {
                    "projection_id": "projection:grounding_verdict:test",
                    "source_step_id": "handoff:rag-agent:rag_request",
                    "projection_kind": "grounding_verdict",
                    "content_hash": "sha256:grounding",
                    "safety": {
                        "truncated": False,
                        "redacted": False,
                        "max_chars": 1600,
                        "fields_present": ["grounding_verdict", "semantic_outcome"],
                    },
                },
            ],
            "trace_steps": [
                {
                    "step_id": "handoff:campus-services-agent:transport_schedule_lookup",
                    "span_kind": "handoff",
                    "parent_step_id": "runtime_policy",
                    "target": "campus-services-agent",
                    "tool_name": "transport_schedule_lookup",
                    "outcome": "completed",
                    "result_status": "completed",
                },
                {
                    "step_id": "handoff:notice-agent:campus_notice_get",
                    "span_kind": "handoff",
                    "parent_step_id": "handoff:campus-services-agent:transport_schedule_lookup",
                    "target": "notice-agent",
                    "tool_name": "campus_notice_get",
                    "outcome": "completed",
                    "result_status": "completed",
                },
                {
                    "step_id": "handoff:rag-agent:rag_request",
                    "span_kind": "handoff",
                    "parent_step_id": "handoff:notice-agent:campus_notice_get",
                    "target": "rag-agent",
                    "tool_name": "retrieval.query",
                    "outcome": "needs_clarification",
                    "result_status": "needs_clarification",
                },
            ],
            "agent_invocations": [
                {
                    "invocation_id": (
                        "agent-invocation:campus-services-agent:transport_schedule_lookup"
                    ),
                    "workflow_run_ref": (
                        "multi_step:campus-services-agent:transport_schedule_lookup"
                    ),
                    "step_id": "handoff:campus-services-agent:transport_schedule_lookup",
                    "agent_id": "campus-services-agent",
                    "status": "completed",
                },
                {
                    "invocation_id": "agent-invocation:notice-agent:campus_notice_get",
                    "parent_invocation_id": (
                        "agent-invocation:campus-services-agent:transport_schedule_lookup"
                    ),
                    "workflow_run_ref": "multi_step:notice-agent:campus_notice_get",
                    "step_id": "handoff:notice-agent:campus_notice_get",
                    "agent_id": "notice-agent",
                    "status": "completed",
                    "projection_ids": ["projection:schedule_baseline:test"],
                },
                {
                    "invocation_id": "agent-invocation:rag-agent:rag_request",
                    "parent_invocation_id": "agent-invocation:notice-agent:campus_notice_get",
                    "workflow_run_ref": "multi_step:rag-agent:rag_request",
                    "step_id": "handoff:rag-agent:rag_request",
                    "agent_id": "rag-agent",
                    "status": "needs_clarification",
                    "projection_ids": [
                        "projection:schedule_baseline:test",
                        "projection:notice_context:test",
                    ],
                },
            ],
            "tool_call_summaries": [
                {
                    "result_projection": "bounded_summary",
                    "raw_result_included": False,
                    "tool_name": "transport_schedule_lookup",
                    "result_status": "completed",
                    "business_outcome": "resolved_current",
                    "argument_summary": {
                        "payload_kind": "transport_schedule_lookup",
                        "selected_tool": "transport_schedule_lookup",
                        "intent": "next_departure",
                    },
                    "source_ids": ["notice:muc_internal_portal:355122"],
                },
                {
                    "result_projection": "bounded_summary",
                    "raw_result_included": False,
                    "tool_name": "retrieval.query",
                    "result_status": "needs_clarification",
                    "business_outcome": "needs_clarification",
                    "argument_summary": {
                        "payload_kind": "rag_request",
                        "selected_tool": "retrieval.query",
                        "collection": "student_rules",
                        "corpus": "regulations",
                    },
                    "source_ids": ["student-rules:traffic-order-001"],
                },
            ],
            "guardrail_outcomes": {
                "context_preflight": "not_follow_up",
                "policy_gate": "delegate",
                "scope_gate": "in_scope",
            },
            "fail_close_reason": "",
        }
    if profile in {"transport_schedule_sdk_opened", "transport_schedule_sdk_opened_stream"}:
        return _tool_workflow_trace_summary(
            target="campus-services-agent",
            tool="transport_schedule_lookup",
            branch="delegate",
            mode="single_handoff",
            argument_summary={
                "payload_kind": "transport_schedule_lookup",
                "selected_tool": "transport_schedule_lookup",
                "snapshot_query_mode": "current",
                "service_time_query": {"date_mode": "tomorrow", "daypart": "morning"},
            },
            guardrail_scope="in_scope",
        )
    if profile == "service_status_sdk_opened":
        return _tool_workflow_trace_summary(
            target="campus-services-agent",
            tool="service_status_lookup",
            branch="delegate",
            mode="single_handoff",
            argument_summary={
                "payload_kind": "service_status_lookup",
                "selected_tool": "service_status_lookup",
                "temporal_query_mode": "current",
            },
            guardrail_scope="in_scope",
        )
    if profile == "service_guide_sdk_opened":
        return _tool_workflow_trace_summary(
            target="campus-services-agent",
            tool="service_guide_lookup",
            branch="delegate",
            mode="single_handoff",
            argument_summary={
                "payload_kind": "service_guide_lookup",
                "selected_tool": "service_guide_lookup",
                "guide_focus": "required_materials",
                "temporal_query_mode": "current",
                "audience": "unknown",
            },
            guardrail_scope="in_scope",
        )
    if profile == "contact_directory_sdk_opened":
        return _tool_workflow_trace_summary(
            target="campus-services-agent",
            tool="contact_directory_lookup",
            branch="delegate",
            mode="single_handoff",
            argument_summary={
                "payload_kind": "contact_directory_lookup",
                "selected_tool": "contact_directory_lookup",
                "contact_focus": "phone",
                "temporal_query_mode": "current",
                "audience": "unknown",
            },
            guardrail_scope="in_scope",
        )
    if profile == "notice_discover_sdk_opened":
        return _tool_workflow_trace_summary(
            target="notice-agent",
            tool="campus_notice_discover",
            branch="delegate",
            mode="single_handoff",
            argument_summary={
                "payload_kind": "campus_notice_discover",
                "selected_tool": "campus_notice_discover",
                "temporal_query_mode": "current",
            },
            guardrail_scope="in_scope",
        )
    if profile == "academic_calendar_sdk_opened":
        return _tool_workflow_trace_summary(
            target="calendar-agent",
            tool="academic_calendar_lookup",
            branch="delegate",
            mode="single_handoff",
            argument_summary={
                "payload_kind": "academic_calendar_lookup",
                "selected_tool": "academic_calendar_lookup",
                "temporal_query_mode": "current",
            },
            guardrail_scope="in_scope",
        )
    if profile == "transactional_approval_required":
        return {
            **base,
            "planning_outcome": "not_preplanned",
            "direct_vs_delegate_branch": "fail_close",
            "workflow_mode": "terminal",
            "handoff": {},
            "handoff_chain": [],
            "selected_target": "none",
            "selected_tools": [],
            "tool_argument_summary": {},
            "trace_steps": [
                {
                    "step_id": "runtime_policy",
                    "span_kind": "runtime_policy",
                    "parent_step_id": "",
                    "outcome": "approval_required",
                },
                {
                    "step_id": "finalization",
                    "span_kind": "finalization",
                    "parent_step_id": "runtime_policy",
                    "outcome": "approval_required",
                },
            ],
            "tool_call_summaries": [],
            "guardrail_outcomes": {
                "context_preflight": "not_follow_up",
                "policy_gate": "approval_required",
                "scope_gate": "out_of_scope",
            },
            "fail_close_reason": "approval_required",
        }
    return {}


def _tool_workflow_trace_summary(
    *,
    target: str,
    tool: str,
    branch: str,
    mode: str,
    argument_summary: dict[str, object],
    guardrail_scope: str,
) -> dict[str, object]:
    return {
        "routing_frame": {"routing_next_action": "delegate"},
        "context_resolution": {"state": "not_follow_up"},
        "planning_outcome": "preplanned",
        "direct_vs_delegate_branch": branch,
        "workflow_mode": mode,
        "handoff": {"target": target},
        "handoff_chain": [{"target": target, "selected_tool": tool}]
        if mode == "single_handoff"
        else [],
        "selected_target": target,
        "selected_tools": [tool],
        "tool_argument_summary": argument_summary,
        "trace_steps": [
            {
                "step_id": "runtime_policy",
                "span_kind": "runtime_policy",
                "parent_step_id": "",
                "outcome": "delegate",
            },
            {
                "step_id": "tool_call",
                "span_kind": "tool_call",
                "parent_step_id": "runtime_policy",
                "tool_name": tool,
                "outcome": "completed",
                "result_status": "completed",
                "retry_count": 0,
            },
        ],
        "tool_call_summaries": [
            {
                "result_projection": "bounded_summary",
                "raw_result_included": False,
                "tool_name": tool,
                "result_status": "completed",
                "business_outcome": "sdk_completed" if mode == "single_handoff" else "resolved_current",
                "argument_summary": argument_summary,
                "source_ids": [f"smoke:{tool}"],
            }
        ],
        "agent_invocations": [
            {
                "invocation_id": f"agent-invocation:{target}:1",
                "workflow_run_ref": f"single_handoff:{target}:{tool}",
                "step_id": f"handoff:{target}:{tool}",
                "agent_id": target,
                "status": "completed",
            }
        ]
        if mode == "single_handoff"
        else [],
        "guardrail_outcomes": {
            "context_preflight": "not_follow_up",
            "policy_gate": "delegate",
            "scope_gate": guardrail_scope,
        },
        "fail_close_reason": "",
        "runtime_versions": {"workflow_trace_summary": "test"},
        "policy_artifact_versions": {"intent_policy": "test"},
    }
