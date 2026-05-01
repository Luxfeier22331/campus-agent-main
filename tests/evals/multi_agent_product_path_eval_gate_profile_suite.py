from __future__ import annotations

import json
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
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
            list(multi_agent_live_smoke_gate.DEFAULT_PROCESS_SMOKE_PROFILES),
        )
        self.assertTrue(payload["passed"])
        self.assertEqual(artifact["summary"]["total_profiles"], len(observed_profiles))
        self.assertIn("rag_delegate", artifact["workflow_trace_replay"]["evaluated_profiles"])

    def test_multi_agent_live_smoke_default_profiles_cover_opened_tool_families(self) -> None:
        self.assertEqual(
            set(multi_agent_live_smoke_gate.DEFAULT_PROCESS_SMOKE_PROFILES),
            {
                "closed_gate",
                "terminal_fail_close",
                "rag_delegate",
                "multi_step_notice_knowledge_followthrough",
                "structured_direct_opened",
                "structured_direct_opened_stream",
                "service_status_direct_opened",
                "service_guide_direct_opened",
                "contact_directory_direct_opened",
                "notice_discover_direct_opened",
                "notice_get_direct_opened",
                "transactional_approval_required",
            },
        )
        self.assertEqual(
            multi_agent_live_smoke_gate.PROFILE_WORKFLOW_TRACE_CASE_IDS[
                "multi_step_notice_knowledge_followthrough"
            ],
            "workflow-notice-knowledge-followthrough-multistep",
        )

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
            set(multi_agent_live_smoke_gate.PROFILE_WORKFLOW_TRACE_CASE_IDS),
        )

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
                "collection": "student_rules",
                "corpus": "regulations",
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
                }
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
            "tool_call_summaries": [
                {
                    "tool_name": "retrieval.query",
                    "result_status": "needs_clarification",
                    "business_outcome": "needs_clarification",
                    "argument_summary": {
                        "payload_kind": "campus_notice_get",
                        "selected_tool": "retrieval.query",
                        "notice_id": "notice:smoke:001",
                        "source_family": "wechat_public_notice",
                        "collection": "student_rules",
                        "corpus": "regulations",
                    },
                    "source_ids": [],
                }
            ],
            "guardrail_outcomes": {
                "context_preflight": "resolved",
                "policy_gate": "delegate",
                "scope_gate": "in_scope",
            },
            "fail_close_reason": "",
        }
    if profile in {"structured_direct_opened", "structured_direct_opened_stream"}:
        return _tool_workflow_trace_summary(
            target="campus-services-agent",
            tool="transport_schedule_lookup",
            branch="direct",
            mode="direct_runtime",
            argument_summary={
                "payload_kind": "transport_schedule_lookup",
                "selected_tool": "transport_schedule_lookup",
                "snapshot_query_mode": "current",
                "service_time_query": {"date_mode": "tomorrow", "daypart": "morning"},
            },
            guardrail_scope="in_scope",
        )
    if profile == "service_status_direct_opened":
        return _tool_workflow_trace_summary(
            target="campus-services-agent",
            tool="service_status_lookup",
            branch="direct",
            mode="direct_runtime",
            argument_summary={
                "payload_kind": "service_status_lookup",
                "selected_tool": "service_status_lookup",
                "temporal_query_mode": "current",
            },
            guardrail_scope="in_scope",
        )
    if profile == "service_guide_direct_opened":
        return _tool_workflow_trace_summary(
            target="campus-services-agent",
            tool="service_guide_lookup",
            branch="direct",
            mode="direct_runtime",
            argument_summary={
                "payload_kind": "service_guide_lookup",
                "selected_tool": "service_guide_lookup",
                "guide_focus": "required_materials",
                "temporal_query_mode": "current",
                "audience": "unknown",
            },
            guardrail_scope="in_scope",
        )
    if profile == "contact_directory_direct_opened":
        return _tool_workflow_trace_summary(
            target="campus-services-agent",
            tool="contact_directory_lookup",
            branch="direct",
            mode="direct_runtime",
            argument_summary={
                "payload_kind": "contact_directory_lookup",
                "selected_tool": "contact_directory_lookup",
                "contact_focus": "phone",
                "temporal_query_mode": "current",
                "audience": "unknown",
            },
            guardrail_scope="in_scope",
        )
    if profile == "notice_discover_direct_opened":
        return _tool_workflow_trace_summary(
            target="notice-agent",
            tool="campus_notice_discover",
            branch="direct",
            mode="direct_runtime",
            argument_summary={
                "payload_kind": "campus_notice_discover",
                "selected_tool": "campus_notice_discover",
                "temporal_query_mode": "current",
            },
            guardrail_scope="in_scope",
        )
    if profile == "notice_get_direct_opened":
        return {
            **base,
            "direct_vs_delegate_branch": "direct",
            "workflow_mode": "direct_runtime",
            "handoff": {"target": "notice-agent"},
            "handoff_chain": [],
            "selected_target": "notice-agent",
            "selected_tools": [],
            "tool_argument_summary": {
                "payload_kind": "campus_notice_get",
                "source_family": "wechat_public_notice",
            },
            "trace_steps": [
                {
                    "step_id": "runtime_policy",
                    "span_kind": "runtime_policy",
                    "parent_step_id": "",
                    "outcome": "delegate",
                },
                {
                    "step_id": "finalization",
                    "span_kind": "finalization",
                    "parent_step_id": "runtime_policy",
                    "outcome": "completed",
                    "result_status": "completed",
                },
            ],
            "tool_call_summaries": [],
            "guardrail_outcomes": {
                "context_preflight": "not_follow_up",
                "policy_gate": "delegate",
                "scope_gate": "in_scope",
            },
            "fail_close_reason": "",
        }
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
                "tool_name": tool,
                "result_status": "completed",
                "argument_summary": argument_summary,
                "source_ids": [],
            }
        ],
        "guardrail_outcomes": {
            "context_preflight": "not_follow_up",
            "policy_gate": "delegate",
            "scope_gate": guardrail_scope,
        },
        "fail_close_reason": "",
        "runtime_versions": {"workflow_trace_summary": "test"},
        "policy_artifact_versions": {"intent_policy": "test"},
    }
