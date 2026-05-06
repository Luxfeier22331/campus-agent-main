from __future__ import annotations

from tests.contracts.contract_models_test_support import *


class ContractModelsWorkflowExecutionContextSuite(unittest.TestCase):
    def test_workflow_agent_context_requires_step_execution_metadata(self) -> None:
        with self.assertRaisesRegex(ValueError, "workflow_run_ref"):
            WorkflowAgentContext(
                target="rag-agent",
                projection_refs=(_valid_projection_ref(),),
            )

    def test_workflow_agent_context_serializes_step_execution_metadata(self) -> None:
        context = WorkflowAgentContext(
            target="rag-agent",
            workflow_run_ref="workflow:req-001",
            step_id="handoff:rag-agent:rag_request",
            agent_id="rag-agent",
            required_projection_kind="notice_context",
            projection_refs=(_valid_projection_ref(),),
        )

        payload = asdict(context)

        self.assertEqual(payload["workflow_run_ref"], "workflow:req-001")
        self.assertEqual(payload["step_id"], "handoff:rag-agent:rag_request")
        self.assertEqual(payload["agent_id"], "rag-agent")


def _valid_projection_ref() -> dict[str, object]:
    return {
        "projection_id": "projection:notice_context:test",
        "source_step_id": "handoff:notice-agent:campus_notice_get",
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
