from __future__ import annotations

from tests.contracts.contract_models_test_support import *


class ContractModelsWorkflowExecutionContextSuite(unittest.TestCase):
    def test_workflow_agent_context_requires_step_execution_metadata(self) -> None:
        with self.assertRaisesRegex(ValueError, "workflow_run_ref"):
            WorkflowToolContext(
                tool="knowledge_query",
                projection_refs=(_valid_projection_ref(),),
            )

    def test_workflow_agent_context_requires_non_empty_expected_output_artifacts(self) -> None:
        with self.assertRaisesRegex(ValueError, "expected_output_artifacts"):
            WorkflowToolContext(
                tool="knowledge_query",
                workflow_run_ref="workflow:req-001",
                step_id="tool:knowledge_query:rag_request",
                tool_id="knowledge_query",
                expected_output_artifacts=("",),
            )

    def test_workflow_agent_context_serializes_step_execution_metadata(self) -> None:
        context = WorkflowToolContext(
            tool="knowledge_query",
            workflow_run_ref="workflow:req-001",
            step_id="tool:knowledge_query:rag_request",
            tool_id="knowledge_query",
            required_projection_kind="notice_context",
            expected_output_artifacts=("evidence_bundle", "grounding_verdict"),
            projection_refs=(_valid_projection_ref(),),
        )

        payload = asdict(context)

        self.assertEqual(payload["workflow_run_ref"], "workflow:req-001")
        self.assertEqual(payload["step_id"], "tool:knowledge_query:rag_request")
        self.assertEqual(payload["tool_id"], "knowledge_query")
        self.assertEqual(
            payload["expected_output_artifacts"],
            ("evidence_bundle", "grounding_verdict"),
        )


def _valid_projection_ref() -> dict[str, object]:
    return {
        "projection_id": "projection:notice_context:test",
        "source_step_id": "handoff:notice:campus_notice_get",
        "projection_kind": "notice_context",
        "content_hash": "sha256:test",
        "safety": {
            "truncated": False,
            "redacted": False,
            "max_chars": 1600,
            "fields_present": ["title"],
        },
    }


if __name__ == "__main__":
    unittest.main()
