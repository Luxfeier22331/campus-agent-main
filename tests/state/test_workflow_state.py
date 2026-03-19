import unittest

from campus_agent.state import (
    InMemoryWorkflowStateStore,
    ToolExecutionRecord,
    WorkflowActorContext,
    WorkflowState,
    WorkflowTraceContext,
)


class WorkflowStateStoreTest(unittest.TestCase):
    def test_round_trip_preserves_required_and_extension_fields(self) -> None:
        state = WorkflowState(
            conversation_id="conv-001",
            workflow_run_id="wf-001",
            user_query="Where is the library?",
            intent="rag_answer",
            selected_tool="campus_rag_answer",
            tool_results=[
                ToolExecutionRecord(
                    tool_name="campus_rag_answer",
                    tool_call_id="tool-call-001",
                    request={"query": "Where is the library?"},
                    response={"ok": True, "data": {"answer": "North campus."}},
                    status="completed",
                )
            ],
            final_answer="North campus.",
            directory_query=None,
            directory_candidates=[],
            selected_directory_entry=None,
            campus_candidates=[{"id": "north-campus"}],
            selected_campus={"id": "north-campus"},
            poi_candidates=[{"id": "library"}],
            selected_poi={"id": "library"},
            target_coordinate={"lat": 31.0, "lng": 121.0},
            navigation_mode=None,
            pending_confirmation=False,
            trace=WorkflowTraceContext(
                trace_id="trace-001",
                parent_run_id="run-parent-001",
                tool_call_id="tool-call-001",
            ),
            actor_context=WorkflowActorContext(
                user_id="user-123",
                roles=("student",),
                departments=("cs",),
                groups=("library-users",),
                campus_scope="main-campus",
                snapshot={"cohort": "grad"},
            ),
            actor_snapshot={
                "actor_user_id": "user-123",
                "actor_roles": ["student"],
                "actor_departments": ["cs"],
                "actor_groups": ["library-users"],
                "campus_scope": "main-campus",
                "is_authenticated": True,
            },
            status="completed",
            last_completed_step="compose_final_answer",
            resume_token="resume-001",
            error_code=None,
            retry_count=1,
            hitl_context={
                "kind": "directory_selection",
                "candidate_source": "directory_candidates",
                "allowed_actions": ["select_candidate", "cancel"],
                "resume_step": "await_directory_selection",
                "requires_side_effect_confirmation": False,
            },
            extension_state={"workflow_engine": "agno_workflow_first"},
        )

        store = InMemoryWorkflowStateStore()
        store.save(state)
        loaded = store.load("wf-001")

        self.assertEqual(loaded.schema_version, "v1")
        self.assertEqual(loaded.conversation_id, "conv-001")
        self.assertEqual(loaded.trace.trace_id, "trace-001")
        self.assertEqual(loaded.actor_snapshot["actor_user_id"], "user-123")
        self.assertEqual(loaded.actor_snapshot["actor_roles"], ["student"])
        self.assertTrue(loaded.actor_snapshot["is_authenticated"])
        self.assertEqual(loaded.tool_results[0].tool_name, "campus_rag_answer")
        self.assertEqual(loaded.hitl_context["kind"], "directory_selection")
        self.assertEqual(loaded.hitl_context["candidate_source"], "directory_candidates")
        self.assertFalse(loaded.hitl_context["requires_side_effect_confirmation"])

    def test_round_trip_preserves_post_choice_extension_state_and_cleared_hitl(self) -> None:
        state = WorkflowState(
            conversation_id="conv-002",
            workflow_run_id="wf-002",
            user_query="directory: registrar office",
            intent="directory_lookup",
            selected_tool="campus_directory_lookup",
            tool_results=[
                ToolExecutionRecord(
                    tool_name="campus_directory_lookup",
                    tool_call_id="tool-call-002",
                    request={"query": "registrar office"},
                    response={"ok": True, "data": {"entries": []}},
                    status="completed",
                )
            ],
            final_answer="Directory selection canceled.",
            directory_query="registrar office",
            directory_candidates=[
                {"entry_type": "phone", "label": "Registrar Office", "value": "010-12345678"}
            ],
            selected_directory_entry=None,
            campus_candidates=[],
            selected_campus=None,
            poi_candidates=[],
            selected_poi=None,
            target_coordinate=None,
            navigation_mode="walking",
            pending_confirmation=False,
            trace=WorkflowTraceContext(
                trace_id="trace-002",
                parent_run_id="run-parent-002",
                tool_call_id="tool-call-002",
            ),
            actor_context=WorkflowActorContext(
                user_id="user-456",
                roles=("student",),
                campus_scope="main-campus",
            ),
            actor_snapshot={
                "actor_user_id": "user-456",
                "actor_roles": ["student"],
                "actor_departments": [],
                "actor_groups": [],
                "campus_scope": "main-campus",
                "is_authenticated": True,
            },
            status="completed",
            last_completed_step="cancel_directory_selection",
            resume_token="resume-002",
            error_code=None,
            retry_count=0,
            hitl_context={},
            extension_state={
                "workflow_engine": "agno_workflow_first",
                "phase2a_last_user_action": {
                    "kind": "directory_selection",
                    "action": "cancel",
                },
            },
        )

        store = InMemoryWorkflowStateStore()
        store.save(state)
        loaded = store.load("wf-002")

        self.assertFalse(loaded.pending_confirmation)
        self.assertEqual(loaded.hitl_context, {})
        self.assertEqual(loaded.navigation_mode, "walking")
        self.assertEqual(
            loaded.extension_state["phase2a_last_user_action"]["kind"],
            "directory_selection",
        )
        self.assertEqual(
            loaded.extension_state["phase2a_last_user_action"]["action"],
            "cancel",
        )


if __name__ == "__main__":
    unittest.main()
