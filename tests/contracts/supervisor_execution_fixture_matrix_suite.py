from __future__ import annotations

import json
import unittest
from pathlib import Path

from campus_supervisor_agent_worker.bridge_v6_parser import parse_bridge_supervisor_envelope
from campus_supervisor_agent_worker.generated.supervisor_execution_contract import (
    BridgeV6RequestWire,
    SupervisorResponseWire,
)

FIXTURE_DIR = Path("tests/fixtures/supervisor_execution_contract")


def load_fixture(name: str) -> dict[str, object]:
    payload = json.loads((FIXTURE_DIR / name).read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        raise ValueError(f"{name} must contain a JSON object")
    return payload


class SupervisorExecutionFixtureMatrixTest(unittest.TestCase):
    def test_python_bridge_accepts_canonical_delegate_fixture(self) -> None:
        payload = load_fixture("bridge_v6_delegate.valid.json")

        wire = BridgeV6RequestWire.model_validate(payload)
        envelope = parse_bridge_supervisor_envelope(payload)

        self.assertEqual(wire.bridge_version, "supervisor_bridge_v6")
        self.assertEqual(wire.runtime_decisions.schema_version, "supervisor-runtime-decisions-v1")
        self.assertEqual(envelope.request.request_id, "req-contract-001")
        self.assertIsNotNone(envelope.agent_request)
        assert envelope.agent_request is not None
        self.assertEqual(envelope.agent_request.target, "rag-agent")

    def test_python_bridge_accepts_agent_workflow_context_projection_refs(self) -> None:
        payload = load_fixture("bridge_v6_delegate.valid.json")
        payload["runtime_decisions"]["workflow_plan"] = {
            "schema_version": "workflow-plan-v1",
            "plan_id": "plan:selected_notice:knowledge_followthrough",
            "workflow_mode": "multi_step",
            "allowed_agents": ["notice-agent", "rag-agent"],
            "steps": [
                {
                    "step_id": "handoff:notice-agent:campus_notice_get",
                    "step_kind": "handoff",
                    "target": "notice-agent",
                    "payload_kind": "campus_notice_get",
                    "allowed_tools": [],
                    "selected_tool": "",
                },
                {
                    "step_id": "handoff:rag-agent:rag_request",
                    "step_kind": "handoff",
                    "target": "rag-agent",
                    "payload_kind": "rag_request",
                    "allowed_tools": [],
                    "selected_tool": "retrieval.query",
                },
            ],
            "edges": [
                {
                    "from_step_id": "handoff:notice-agent:campus_notice_get",
                    "to_step_id": "handoff:rag-agent:rag_request",
                    "condition": "completed",
                    "required_projection_kind": "notice_context",
                }
            ],
            "terminal_policy": {"fail_close_on_invalid_plan": True},
            "resume_policy": {"resume_supported": False},
            "semantic_retry_policy": {"max_replans": 0},
        }
        payload["runtime_decisions"]["handoff"]["agent_request"]["workflow_context"] = {
            "schema_version": "workflow-agent-context-v1",
            "visibility": "agent_private",
            "workflow_run_ref": "workflow:req-contract-001",
            "step_id": "handoff:rag-agent:rag_request",
            "agent_id": "rag-agent",
            "target": "rag-agent",
            "required_projection_kind": "notice_context",
            "expected_output_artifacts": ["evidence_bundle", "grounding_verdict"],
            "projection_refs": [
                {
                    "projection_id": "projection:notice_context:test",
                    "source_step_id": "handoff:notice-agent:campus_notice_get",
                    "projection_kind": "notice_context",
                    "content_hash": "sha256:test",
                    "safety": {"max_chars": 1600, "fields_present": ["title"]},
                }
            ],
        }

        envelope = parse_bridge_supervisor_envelope(payload)

        assert envelope.agent_request is not None
        self.assertEqual(
            envelope.agent_request.workflow_context.workflow_run_ref,
            "workflow:req-contract-001",
        )
        self.assertEqual(
            envelope.agent_request.workflow_context.step_id,
            "handoff:rag-agent:rag_request",
        )
        self.assertEqual(
            envelope.agent_request.workflow_context.agent_id,
            "rag-agent",
        )
        self.assertEqual(
            envelope.agent_request.workflow_context.expected_output_artifacts,
            ("evidence_bundle", "grounding_verdict"),
        )
        self.assertEqual(
            envelope.agent_request.workflow_context.projection_refs[0]["projection_id"],
            "projection:notice_context:test",
        )

    def test_python_bridge_rejects_raw_agent_workflow_context_projection_refs(self) -> None:
        payload = load_fixture("bridge_v6_delegate.valid.json")
        payload["runtime_decisions"]["handoff"]["agent_request"]["workflow_context"] = {
            "schema_version": "workflow-agent-context-v1",
            "visibility": "agent_private",
            "workflow_run_ref": "workflow:req-contract-001",
            "step_id": "handoff:rag-agent:rag_request",
            "agent_id": "rag-agent",
            "target": "rag-agent",
            "projection_refs": [{"projection_id": "p1", "raw_response": "secret"}],
        }

        with self.assertRaisesRegex(ValueError, "forbidden raw workflow trace key"):
            parse_bridge_supervisor_envelope(payload)

    def test_python_bridge_rejects_invalid_bridge_fixtures(self) -> None:
        for fixture_name in (
            "bridge_v6_extra_field.invalid.json",
            "bridge_v6_invalid_enum.invalid.json",
            "bridge_v6_invalid_version.invalid.json",
        ):
            with self.subTest(fixture_name=fixture_name), self.assertRaises(ValueError):
                parse_bridge_supervisor_envelope(load_fixture(fixture_name))

    def test_python_response_model_accepts_terminal_state_fixtures(self) -> None:
        expected_status_by_fixture = {
            "response_cancelled_null_target.valid.json": "cancelled",
            "response_completed_delegate.valid.json": "completed",
            "response_error_bridge_unavailable.valid.json": "error",
            "response_timeout.valid.json": "error",
        }

        for fixture_name, expected_status in expected_status_by_fixture.items():
            with self.subTest(fixture_name=fixture_name):
                response = SupervisorResponseWire.model_validate(load_fixture(fixture_name))

                self.assertEqual(response.status, expected_status)
                self.assertTrue(response.trace_id.startswith("trace-contract-"))

    def test_python_response_model_rejects_non_canonical_response_fixtures(self) -> None:
        for fixture_name in (
            "response_camel_case.invalid.json",
            "response_extra_field.invalid.json",
        ):
            with self.subTest(fixture_name=fixture_name), self.assertRaises(ValueError):
                SupervisorResponseWire.model_validate(load_fixture(fixture_name))


if __name__ == "__main__":
    unittest.main()
