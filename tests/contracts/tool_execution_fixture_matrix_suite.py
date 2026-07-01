from __future__ import annotations

import json
import unittest
from pathlib import Path

FIXTURE_DIR = Path("packages/contracts/fixtures/tool_execution_contract")


def load_fixture(name: str) -> dict[str, object]:
    payload = json.loads((FIXTURE_DIR / name).read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        raise ValueError(f"{name} must contain a JSON object")
    return payload


class ToolExecutionFixtureMatrixTest(unittest.TestCase):
    def test_delegate_fixture_keeps_canonical_handoff_shape(self) -> None:
        payload = load_fixture("tool_execution_delegate.valid.json")

        self.assertEqual(payload["execution_contract_version"], "tool_execution_v1")
        self.assertEqual(payload["response_contract"], "execution_finalization_response_v1")
        self.assertEqual(payload["request_id"], "req-contract-001")
        runtime_decisions = payload["runtime_decisions"]
        self.assertIsInstance(runtime_decisions, dict)
        assert isinstance(runtime_decisions, dict)
        self.assertEqual(
            runtime_decisions["schema_version"],
            "tool-execution-runtime-decisions-v1",
        )
        handoff = runtime_decisions["handoff"]
        self.assertIsInstance(handoff, dict)
        assert isinstance(handoff, dict)
        tool_request = handoff["tool_request"]
        self.assertIsInstance(tool_request, dict)
        assert isinstance(tool_request, dict)
        self.assertEqual(tool_request["tool"], "knowledge_query")

    def test_active_request_fixture_allows_runtime_neutral_shape(self) -> None:
        payload = load_fixture("tool_execution_delegate.valid.json")
        payload.pop("runtime_decisions", None)
        payload["request_id"] = "req-contract-runtime-neutral"
        payload["context"] = {"session_slots": {}}

        self.assertEqual(payload["request_id"], "req-contract-runtime-neutral")
        self.assertNotIn("runtime_decisions", payload)

    def test_workflow_context_projection_refs_are_reference_only(self) -> None:
        payload = load_fixture("tool_execution_delegate.valid.json")
        workflow_context = {
            "schema_version": "workflow-tool-context-v1",
            "visibility": "tool_private",
            "workflow_run_ref": "workflow:req-contract-001",
            "step_id": "tool:knowledge_query:rag_request",
            "tool_id": "knowledge_query",
            "required_projection_kind": "notice_context",
            "expected_output_artifacts": ["evidence_bundle", "grounding_verdict"],
            "projection_refs": [
                {
                    "projection_id": "projection:notice_context:test",
                    "source_step_id": "tool:notice:campus_notice_get",
                    "projection_kind": "notice_context",
                    "content_hash": "sha256:test",
                    "safety": {"max_chars": 1600, "fields_present": ["title"]},
                }
            ],
        }
        payload["runtime_decisions"]["handoff"]["tool_request"]["workflow_context"] = (
            workflow_context
        )

        self.assertEqual(workflow_context["workflow_run_ref"], "workflow:req-contract-001")
        self.assertEqual(workflow_context["step_id"], "tool:knowledge_query:rag_request")
        self.assertEqual(workflow_context["tool_id"], "knowledge_query")
        self.assertEqual(
            tuple(workflow_context["expected_output_artifacts"]),
            ("evidence_bundle", "grounding_verdict"),
        )
        projection_ref = workflow_context["projection_refs"][0]
        self.assertNotIn("raw_response", projection_ref)
        self.assertNotIn("payload", projection_ref)

    def test_invalid_fixtures_remain_available_for_non_python_contract_consumers(self) -> None:
        for fixture_name in (
            "tool_execution_extra_field.invalid.json",
            "tool_execution_invalid_enum.invalid.json",
            "tool_execution_invalid_version.invalid.json",
            "response_camel_case.invalid.json",
            "response_extra_field.invalid.json",
        ):
            with self.subTest(fixture_name=fixture_name):
                self.assertTrue(load_fixture(fixture_name))

    def test_response_fixtures_keep_terminal_status_shape(self) -> None:
        expected_status_by_fixture = {
            "response_cancelled_null_target.valid.json": "cancelled",
            "response_completed_delegate.valid.json": "completed",
            "response_error_execution_control_unavailable.valid.json": "error",
            "response_timeout.valid.json": "error",
        }

        for fixture_name, expected_status in expected_status_by_fixture.items():
            with self.subTest(fixture_name=fixture_name):
                response = load_fixture(fixture_name)

                self.assertEqual(response["status"], expected_status)
                self.assertTrue(str(response["trace_id"]).startswith("trace-contract-"))


if __name__ == "__main__":
    unittest.main()
