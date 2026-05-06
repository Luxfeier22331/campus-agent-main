from __future__ import annotations

from tests.contracts.contract_models_test_support import *


class ContractModelsWorkflowProjectionRefsSuite(unittest.TestCase):
    def test_agent_request_serializes_workflow_context_projection_refs(self) -> None:
        request = AgentRequest(
            target="rag-agent",
            user_goal="这条通知依据学生手册哪条规定？",
            payload=RagRequestPayload(
                scope=KnowledgeScope(corpus="regulations", collection="student_rules")
            ),
            workflow_context=WorkflowAgentContext(
                target="rag-agent",
                workflow_run_ref="workflow:req-test",
                step_id="handoff:rag-agent:rag_request",
                agent_id="rag-agent",
                required_projection_kind="notice_context",
                projection_refs=(_valid_projection_ref(),),
            ),
        )

        payload = asdict(request)

        self.assertEqual(
            payload["workflow_context"]["projection_refs"][0]["projection_id"],
            "projection:notice_context:test",
        )
        self.assertNotIn("payload", payload["workflow_context"]["projection_refs"][0])

    def test_workflow_agent_context_requires_required_projection_ref(self) -> None:
        with self.assertRaisesRegex(ValueError, "required projection"):
            WorkflowAgentContext(
                target="rag-agent",
                workflow_run_ref="workflow:req-test",
                step_id="handoff:rag-agent:rag_request",
                agent_id="rag-agent",
                required_projection_kind="notice_context",
                projection_refs=(),
            )

    def test_workflow_agent_context_rejects_raw_projection_ref_keys(self) -> None:
        invalid_ref = {
            **_valid_projection_ref(projection_id="p1"),
            "raw_response": "secret",
        }
        with self.assertRaisesRegex(ValueError, "forbidden raw workflow trace key"):
            WorkflowAgentContext(
                target="rag-agent",
                workflow_run_ref="workflow:req-test",
                step_id="handoff:rag-agent:rag_request",
                agent_id="rag-agent",
                projection_refs=(invalid_ref,),
            )

    def test_workflow_agent_context_requires_bounded_projection_ref_metadata(self) -> None:
        for field_name in (
            "projection_id",
            "source_step_id",
            "projection_kind",
            "content_hash",
            "safety",
        ):
            with (
                self.subTest(field_name=field_name),
                self.assertRaisesRegex(ValueError, f"projection_refs\\[0\\].{field_name}"),
            ):
                WorkflowAgentContext(
                    target="rag-agent",
                    workflow_run_ref="workflow:req-test",
                    step_id="handoff:rag-agent:rag_request",
                    agent_id="rag-agent",
                    projection_refs=(
                        {
                            key: value
                            for key, value in _valid_projection_ref().items()
                            if key != field_name
                        },
                    ),
                )


def _valid_projection_ref(
    *,
    projection_id: str = "projection:notice_context:test",
) -> dict[str, object]:
    return {
        "projection_id": projection_id,
        "source_step_id": "handoff:notice-agent:campus_notice_get",
        "projection_kind": "notice_context",
        "content_hash": "sha256:test",
        "safety": {"max_chars": 1600, "fields_present": ["title"]},
    }


if __name__ == "__main__":
    unittest.main()
