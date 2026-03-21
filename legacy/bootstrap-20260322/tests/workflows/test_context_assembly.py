import unittest

from campus_agent.adapters import CampusRagAdapter, MockCampusRagRuntime
from campus_agent.config import CampusAgentSettings
from campus_agent.state import InMemoryWorkflowStateStore, WorkflowActorContext, WorkflowTraceContext
from campus_agent.workflows import CampusWorkflow


class WorkflowContextAssemblyTest(unittest.TestCase):
    def test_run_injects_request_context_and_persists_context_refs(self) -> None:
        runtime = MockCampusRagRuntime()
        workflow = CampusWorkflow(
            settings=CampusAgentSettings(),
            state_store=InMemoryWorkflowStateStore(),
            rag_adapter=CampusRagAdapter(runtime=runtime),
        )

        state = workflow.run(
            conversation_id="conv-ctx-001",
            workflow_run_id="wf-ctx-001",
            user_query="毕业要求有哪些？",
            trace=WorkflowTraceContext(
                trace_id="trace-ctx-001",
                parent_run_id="run-parent-ctx-001",
                tool_call_id="tool-call-ctx-001",
            ),
            actor_context=WorkflowActorContext(
                user_id="user-ctx-001",
                roles=("student",),
                departments=("cs",),
                campus_scope="main-campus",
                snapshot={
                    "profile": {
                        "primary_affiliation": "undergraduate_student",
                        "org_units": ["计算机学院"],
                        "academic_stage": "senior",
                        "source": "sis",
                        "confidence": "authoritative",
                    },
                    "preferences": {
                        "language": "zh-CN",
                        "response_style": "concise",
                    },
                    "selected_memories": [
                        {
                            "memory_id": "memory-1",
                            "memory_kind": "profile_fact",
                            "summary": "用户是计算机学院本科生。",
                            "fact_type": "major",
                            "value": "计算机科学与技术",
                            "source": "sis",
                            "confidence": "authoritative",
                        }
                    ],
                    "conversation_summary": "用户上一轮在问毕业要求。",
                },
            ),
        )

        runtime_request = runtime.requests[-1]
        request_context = runtime_request["json"]["request_context"]

        self.assertEqual(
            request_context["audience_profile"]["primary_affiliation"],
            "undergraduate_student",
        )
        self.assertEqual(
            request_context["presentation_preferences"]["response_style"],
            "concise",
        )
        self.assertEqual(request_context["memory_facts"][0]["fact_type"], "major")
        self.assertNotIn("memory_id", request_context["memory_facts"][0])
        self.assertEqual(
            state.extension_state["context_refs"]["selected_memory_ids"],
            ["memory-1"],
        )
        self.assertEqual(
            state.extension_state["context_refs"]["selected_memory_fact_types"],
            ["major"],
        )
        self.assertEqual(
            state.extension_state["context_refs"]["selected_memory_count"],
            1,
        )
        self.assertEqual(
            state.extension_state["context_refs"]["profile_source"],
            "sis",
        )


if __name__ == "__main__":
    unittest.main()
