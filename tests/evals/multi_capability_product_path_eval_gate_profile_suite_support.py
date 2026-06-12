# ruff: noqa: F401
from __future__ import annotations

import json
from pathlib import Path
from tempfile import TemporaryDirectory
from types import SimpleNamespace
from unittest.mock import patch

import campus_evals.multi_capability_live_smoke_gate as multi_capability_live_smoke_gate
import campus_evals.multi_capability_runtime_contract_gate as multi_capability_runtime_contract_gate

from scripts.eval_gate import run_eval_acceptance


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
            "selected_capability": "none",
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
            capability="knowledge",
            tool="retrieval.query",
            branch="delegate",
            mode="single_step",
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
                "target": "notice",
                "payload_kind": "campus_notice_get",
                "allowed_tools": [],
            },
            "handoff_chain": [
                {
                    "target": "notice",
                    "payload_kind": "campus_notice_get",
                },
                {
                    "target": "knowledge",
                    "payload_kind": "rag_request",
                    "selected_tool": "retrieval.query",
                },
            ],
            "selected_capability": "knowledge",
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
                    "source_step_id": "handoff:notice:campus_notice_get",
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
                    "source_step_id": "handoff:knowledge:rag_request",
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
                    "source_step_id": "handoff:knowledge:rag_request",
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
                    "step_id": "handoff:notice:campus_notice_get",
                    "span_kind": "handoff",
                    "parent_step_id": "runtime_policy",
                    "target": "notice",
                    "tool_name": "campus_notice_get",
                    "outcome": "completed",
                    "result_status": "completed",
                },
                {
                    "step_id": "handoff:knowledge:rag_request",
                    "span_kind": "handoff",
                    "parent_step_id": "handoff:notice:campus_notice_get",
                    "target": "knowledge",
                    "tool_name": "retrieval.query",
                    "outcome": "needs_clarification",
                    "result_status": "needs_clarification",
                },
            ],
            "capability_invocations": [
                {
                    "invocation_id": "agent-invocation:notice:campus_notice_get",
                    "workflow_run_ref": "multi_step:notice:campus_notice_get",
                    "step_id": "handoff:notice:campus_notice_get",
                    "capability_id": "notice",
                    "status": "completed",
                },
                {
                    "invocation_id": "agent-invocation:knowledge:rag_request",
                    "parent_invocation_id": "agent-invocation:notice:campus_notice_get",
                    "workflow_run_ref": "multi_step:knowledge:rag_request",
                    "step_id": "handoff:knowledge:rag_request",
                    "capability_id": "knowledge",
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
            "answer_artifact_projection_ids": [
                "projection:notice_context:test",
                "projection:evidence_bundle:test",
                "projection:grounding_verdict:test",
            ],
            "answer_artifact_kinds": [
                "notice_context",
                "evidence_bundle",
                "grounding_verdict",
            ],
            "guardrail_outcomes": {
                "context_preflight": "resolved",
                "policy_gate": "delegate",
                "scope_gate": "in_scope",
            },
            "fail_close_reason": "",
        }
    if profile == "transport_notice_override_multistep":
        return {
            **base,
            "routing_frame": {"routing_next_action": "multi_step"},
            "context_resolution": {"state": "resolved"},
            "direct_vs_delegate_branch": "multi_step",
            "workflow_mode": "multi_step",
            "handoff": {
                "target": "campus_services",
                "payload_kind": "transport_schedule_lookup",
                "allowed_tools": [],
            },
            "handoff_chain": [
                {
                    "target": "campus_services",
                    "payload_kind": "transport_schedule_lookup",
                    "selected_tool": "transport_schedule_lookup",
                },
                {
                    "target": "notice",
                    "payload_kind": "campus_notice_change_set_lookup",
                    "selected_tool": "campus_notice_change_set_lookup",
                },
                {
                    "target": "knowledge",
                    "payload_kind": "rag_request",
                    "selected_tool": "retrieval.query",
                },
            ],
            "selected_capability": "knowledge",
            "selected_tools": [
                "transport_schedule_lookup",
                "campus_notice_change_set_lookup",
                "retrieval.query",
            ],
            "tool_argument_summary": {
                "payload_kind": "campus_notice_change_set_lookup",
                "selected_tool": "retrieval.query",
                "service_date": "2026-05-07",
                "route_labels": ["丰台到海淀通勤车"],
            },
            "context_projections": [
                {
                    "projection_id": "projection:schedule_baseline:test",
                    "source_step_id": "handoff:campus_services:transport_schedule_lookup",
                    "projection_kind": "schedule_baseline",
                    "content_hash": "sha256:schedule",
                    "safety": {
                        "truncated": False,
                        "redacted": False,
                        "max_chars": 1600,
                        "fields_present": ["route_id", "route_label", "service_date"],
                    },
                },
                {
                    "projection_id": "projection:notice_change_set:test",
                    "source_step_id": "handoff:campus_services:campus_notice_change_set_lookup",
                    "projection_kind": "notice_change_set",
                    "content_hash": "sha256:change-set",
                    "safety": {
                        "truncated": False,
                        "redacted": False,
                        "max_chars": 1600,
                        "fields_present": ["change_kind", "facts", "source_refs"],
                    },
                },
                {
                    "projection_id": "projection:evidence_bundle:test",
                    "source_step_id": "handoff:knowledge:rag_request",
                    "projection_kind": "evidence_bundle",
                    "content_hash": "sha256:evidence",
                    "safety": {
                        "truncated": False,
                        "redacted": False,
                        "max_chars": 1600,
                        "fields_present": ["query_text", "source_refs"],
                    },
                },
                {
                    "projection_id": "projection:grounding_verdict:test",
                    "source_step_id": "handoff:knowledge:rag_request",
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
                    "step_id": "handoff:campus_services:transport_schedule_lookup",
                    "span_kind": "handoff",
                    "parent_step_id": "runtime_policy",
                    "target": "campus_services",
                    "tool_name": "transport_schedule_lookup",
                    "outcome": "completed",
                    "result_status": "completed",
                    "started_at": "2026-05-07T12:00:00+08:00",
                    "ended_at": "2026-05-07T12:00:01+08:00",
                },
                {
                    "step_id": "handoff:notice:campus_notice_change_set_lookup",
                    "span_kind": "handoff",
                    "parent_step_id": "handoff:campus_services:transport_schedule_lookup",
                    "target": "notice",
                    "tool_name": "campus_notice_change_set_lookup",
                    "outcome": "completed",
                    "result_status": "completed",
                    "started_at": "2026-05-07T12:00:01+08:00",
                    "ended_at": "2026-05-07T12:00:02+08:00",
                },
                {
                    "step_id": "handoff:knowledge:rag_request",
                    "span_kind": "handoff",
                    "parent_step_id": "handoff:notice:campus_notice_change_set_lookup",
                    "target": "knowledge",
                    "tool_name": "retrieval.query",
                    "outcome": "completed",
                    "result_status": "completed",
                    "started_at": "2026-05-07T12:00:02+08:00",
                    "ended_at": "2026-05-07T12:00:03+08:00",
                },
            ],
            "capability_invocations": [
                {
                    "invocation_id": "agent-invocation:campus_services:transport-schedule",
                    "workflow_run_ref": "multi_step:campus_services:transport_schedule_lookup",
                    "step_id": "handoff:campus_services:transport_schedule_lookup",
                    "capability_id": "campus_services",
                    "status": "completed",
                },
                {
                    "invocation_id": "agent-invocation:notice:notice-change-set",
                    "parent_invocation_id": "agent-invocation:campus_services:transport-schedule",
                    "workflow_run_ref": "multi_step:notice:campus_notice_change_set_lookup",
                    "step_id": "handoff:notice:campus_notice_change_set_lookup",
                    "capability_id": "notice",
                    "status": "completed",
                    "projection_ids": ["projection:schedule_baseline:test"],
                },
                {
                    "invocation_id": "agent-invocation:knowledge:rag_request",
                    "parent_invocation_id": "agent-invocation:notice:notice-change-set",
                    "workflow_run_ref": "multi_step:knowledge:rag_request",
                    "step_id": "handoff:knowledge:rag_request",
                    "capability_id": "knowledge",
                    "status": "completed",
                    "projection_ids": [
                        "projection:schedule_baseline:test",
                        "projection:notice_change_set:test",
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
                        "snapshot_query_mode": "current",
                    },
                    "source_ids": ["smoke:transport-schedule"],
                },
                {
                    "result_projection": "bounded_summary",
                    "raw_result_included": False,
                    "tool_name": "campus_notice_change_set_lookup",
                    "result_status": "completed",
                    "business_outcome": "resolved_current",
                    "argument_summary": {
                        "payload_kind": "campus_notice_change_set_lookup",
                        "selected_tool": "campus_notice_change_set_lookup",
                        "service_date": "2026-05-07",
                        "route_labels": ["丰台到海淀通勤车"],
                    },
                    "source_ids": ["notice:353903"],
                },
                {
                    "result_projection": "bounded_summary",
                    "raw_result_included": False,
                    "tool_name": "retrieval.query",
                    "result_status": "completed",
                    "business_outcome": "resolved_current",
                    "argument_summary": {
                        "payload_kind": "campus_notice_change_set_lookup",
                        "selected_tool": "retrieval.query",
                        "service_date": "2026-05-07",
                        "route_labels": ["丰台到海淀通勤车"],
                    },
                    "source_ids": ["notice:353903", "transport_schedule:commute"],
                },
            ],
            "answer_artifact_projection_ids": [
                "projection:schedule_baseline:test",
                "projection:notice_change_set:test",
                "projection:evidence_bundle:test",
            ],
            "answer_artifact_kinds": [
                "schedule_baseline",
                "notice_change_set",
                "evidence_bundle",
            ],
            "guardrail_outcomes": {
                "context_preflight": "resolved",
                "policy_gate": "delegate",
                "scope_gate": "in_scope",
            },
            "fail_close_reason": "",
        }
    if profile == "selected_notice_knowledge_followthrough_ineligible":
        return {
            **base,
            "routing_frame": {"routing_next_action": "out_of_scope"},
            "context_resolution": {"state": "resolved"},
            "direct_vs_delegate_branch": "fail_close",
            "workflow_mode": "terminal",
            "handoff": {},
            "handoff_chain": [],
            "selected_capability": "none",
            "selected_tools": [],
            "tool_argument_summary": {},
            "context_projections": [],
            "trace_steps": [
                {
                    "step_id": "runtime_policy",
                    "span_kind": "runtime_policy",
                    "parent_step_id": "",
                    "outcome": "out_of_scope",
                    "started_at": "2026-05-07T12:00:00+08:00",
                    "ended_at": "2026-05-07T12:00:00+08:00",
                },
                {
                    "step_id": "finalization",
                    "span_kind": "finalization",
                    "parent_step_id": "runtime_policy",
                    "outcome": "no_answer",
                    "started_at": "2026-05-07T12:00:00+08:00",
                    "ended_at": "2026-05-07T12:00:00+08:00",
                },
            ],
            "capability_invocations": [],
            "tool_call_summaries": [],
            "planning_outcome": "not_preplanned",
            "guardrail_outcomes": {
                "context_preflight": "resolved",
                "policy_gate": "out_of_scope",
                "scope_gate": "in_scope",
            },
            "fail_close_reason": "selected_notice_target_surface_ineligible_for_knowledge_followthrough",
        }
    if profile in {"transport_schedule_sdk_opened", "transport_schedule_sdk_opened_stream"}:
        return _tool_workflow_trace_summary(
            capability="campus_services",
            tool="transport_schedule_lookup",
            branch="delegate",
            mode="single_step",
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
            capability="campus_services",
            tool="service_status_lookup",
            branch="delegate",
            mode="single_step",
            argument_summary={
                "payload_kind": "service_status_lookup",
                "selected_tool": "service_status_lookup",
                "temporal_query_mode": "current",
            },
            guardrail_scope="in_scope",
        )
    if profile == "service_guide_sdk_opened":
        return _tool_workflow_trace_summary(
            capability="campus_services",
            tool="service_guide_lookup",
            branch="delegate",
            mode="single_step",
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
            capability="campus_services",
            tool="contact_directory_lookup",
            branch="delegate",
            mode="single_step",
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
            capability="notice",
            tool="campus_notice_discover",
            branch="delegate",
            mode="single_step",
            argument_summary={
                "payload_kind": "campus_notice_discover",
                "selected_tool": "campus_notice_discover",
                "source_family": "authenticated_notice",
            },
            guardrail_scope="in_scope",
        )
    if profile == "academic_calendar_sdk_opened":
        return _tool_workflow_trace_summary(
            capability="campus_services",
            tool="academic_calendar_lookup",
            branch="delegate",
            mode="single_step",
            argument_summary={
                "payload_kind": "academic_calendar_lookup",
                "selected_tool": "academic_calendar_lookup",
                "query_kind": "named_event_range",
                "event_query": "五一",
            },
            guardrail_scope="in_scope",
        )
    if profile == "transactional_approval_required":
        return {
            **base,
            "routing_frame": {"routing_next_action": "approval_required"},
            "context_resolution": {"state": "not_follow_up"},
            "planning_outcome": "approval_required",
            "direct_vs_delegate_branch": "fail_close",
            "workflow_mode": "terminal",
            "handoff": {},
            "handoff_chain": [],
            "selected_capability": "none",
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
                "scope_gate": "in_scope",
            },
            "fail_close_reason": "approval_required",
        }
    return {}


def _tool_workflow_trace_summary(
    *,
    capability: str,
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
        "handoff": {"target": capability},
        "handoff_chain": [{"target": capability, "selected_tool": tool}]
        if mode == "single_step"
        else [],
        "selected_capability": capability,
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
                "business_outcome": "sdk_completed"
                if mode == "single_step"
                else "resolved_current",
                "argument_summary": argument_summary,
                "source_ids": [f"smoke:{tool}"],
            }
        ],
        "capability_invocations": [
            {
                "invocation_id": f"agent-invocation:{capability}:1",
                "workflow_run_ref": f"single_step:{capability}:{tool}",
                "step_id": f"handoff:{capability}:{tool}",
                "capability_id": capability,
                "status": "completed",
            }
        ]
        if mode == "single_step"
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


__all__ = [name for name in globals() if not name.startswith("__")]
