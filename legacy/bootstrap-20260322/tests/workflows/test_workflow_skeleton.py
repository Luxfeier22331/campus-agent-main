import unittest

from tests.conftest import directory_fixture_path, map_fixture_path

from campus_agent.adapters import CampusRagAdapter, MockCampusRagRuntime
from campus_agent.config import CampusAgentSettings
from campus_agent.state import (
    InMemoryWorkflowStateStore,
    WorkflowActorContext,
    WorkflowTraceContext,
)
from campus_agent.tools.directory import FixtureBackedCampusDirectoryLookupTool
from campus_agent.tools.map import FixtureBackedCampusMapResolveTool
from campus_agent.tools.navigation import FixtureBackedCampusNavigationPlanTool
from campus_agent.workflows import CampusWorkflow


class CampusWorkflowTest(unittest.TestCase):
    def test_run_routes_search_query_through_rag_adapter_and_persists_state(self) -> None:
        runtime = MockCampusRagRuntime()
        workflow = CampusWorkflow(
            settings=CampusAgentSettings(),
            state_store=InMemoryWorkflowStateStore(),
            rag_adapter=CampusRagAdapter(runtime=runtime),
        )

        state = workflow.run(
            conversation_id="conv-001",
            workflow_run_id="wf-001",
            user_query="search: library hours",
            trace=WorkflowTraceContext(
                trace_id="trace-001",
                parent_run_id="run-parent-001",
                tool_call_id="tool-call-001",
            ),
            actor_context=WorkflowActorContext(
                user_id="user-123",
                roles=("student",),
                campus_scope="main-campus",
            ),
        )

        persisted = workflow.state_store.load("wf-001")
        runtime_request = runtime.requests[-1]

        self.assertEqual(state.intent, "rag_search")
        self.assertEqual(state.selected_tool, "campus_rag_search")
        self.assertEqual(state.status, "completed")
        self.assertEqual(state.last_completed_step, "compose_final_answer")
        self.assertEqual(persisted.final_answer, state.final_answer)
        self.assertEqual(runtime_request["path"], "/api/search")
        self.assertEqual(runtime_request["json"]["query"], "library hours")
        self.assertEqual(runtime_request["json"]["corpora"], ["student_handbook"])

    def test_default_settings_use_runtime_registry_safe_corpus(self) -> None:
        settings = CampusAgentSettings()

        self.assertEqual(settings.default_corpora, ("student_handbook",))

    def test_directory_no_match_persists_empty_candidates_without_confirmation(self) -> None:
        workflow = self._build_workflow()

        state = workflow.run(
            conversation_id="conv-002",
            workflow_run_id="wf-002",
            user_query="directory: quantum garden office",
            trace=WorkflowTraceContext(
                trace_id="trace-002",
                parent_run_id="run-parent-002",
                tool_call_id="tool-call-002",
            ),
            actor_context=self._actor_context(),
        )

        self.assertEqual(state.selected_tool, "campus_directory_lookup")
        self.assertEqual(state.directory_query, "quantum garden office")
        self.assertEqual(state.directory_candidates, [])
        self.assertIsNone(state.selected_directory_entry)
        self.assertFalse(state.pending_confirmation)
        self.assertEqual(state.hitl_context, {})
        self.assertEqual(state.final_answer, "No directory entries found.")
        self.assertEqual(state.tool_results[0].response["request_id"], "tool-call-002")
        self.assertEqual(state.tool_results[0].response["trace_id"], "trace-002")

    def test_directory_single_match_selects_entry_without_confirmation(self) -> None:
        workflow = self._build_workflow()

        state = workflow.run(
            conversation_id="conv-003",
            workflow_run_id="wf-003",
            user_query="directory: graduate admissions email",
            trace=WorkflowTraceContext(
                trace_id="trace-003",
                parent_run_id="run-parent-003",
                tool_call_id="tool-call-003",
            ),
            actor_context=self._actor_context(),
        )

        self.assertEqual(state.directory_query, "graduate admissions email")
        self.assertEqual(len(state.directory_candidates), 1)
        self.assertEqual(state.selected_directory_entry["entry_type"], "email")
        self.assertEqual(
            state.selected_directory_entry["value"],
            "grad-admissions@example.edu",
        )
        self.assertFalse(state.pending_confirmation)
        self.assertEqual(state.hitl_context, {})

    def test_directory_multi_entry_requires_user_selection_and_persists_hitl(self) -> None:
        workflow = self._build_workflow()

        state = workflow.run(
            conversation_id="conv-004",
            workflow_run_id="wf-004",
            user_query="directory: registrar office",
            trace=WorkflowTraceContext(
                trace_id="trace-004",
                parent_run_id="run-parent-004",
                tool_call_id="tool-call-004",
            ),
            actor_context=self._actor_context(campus_scope="main-campus"),
        )

        self.assertEqual(state.directory_query, "registrar office")
        self.assertEqual(len(state.directory_candidates), 5)
        self.assertIsNone(state.selected_directory_entry)
        self.assertTrue(state.pending_confirmation)
        self.assertEqual(state.hitl_context["kind"], "directory_selection")
        self.assertEqual(state.hitl_context["candidate_source"], "directory_candidates")
        self.assertEqual(
            state.hitl_context["allowed_actions"],
            ["select_candidate", "cancel"],
        )
        self.assertEqual(
            state.hitl_context["resume_step"],
            "await_directory_selection",
        )
        self.assertFalse(state.hitl_context["requires_side_effect_confirmation"])

    def test_resume_returns_paused_directory_state_unchanged(self) -> None:
        workflow = self._build_workflow()

        paused = workflow.run(
            conversation_id="conv-004a",
            workflow_run_id="wf-004a",
            user_query="directory: registrar office",
            trace=WorkflowTraceContext(
                trace_id="trace-004a",
                parent_run_id="run-parent-004a",
                tool_call_id="tool-call-004a",
            ),
            actor_context=self._actor_context(campus_scope="main-campus"),
        )

        resumed = workflow.resume("wf-004a")

        self.assertEqual(resumed.to_dict(), paused.to_dict())
        self.assertEqual(workflow.state_store.load("wf-004a").to_dict(), paused.to_dict())

    def test_directory_apply_select_candidate_sets_selected_entry_without_new_tool_call(self) -> None:
        workflow = self._build_workflow()

        paused = workflow.run(
            conversation_id="conv-004b",
            workflow_run_id="wf-004b",
            user_query="directory: registrar office",
            trace=WorkflowTraceContext(
                trace_id="trace-004b",
                parent_run_id="run-parent-004b",
                tool_call_id="tool-call-004b",
            ),
            actor_context=self._actor_context(campus_scope="main-campus"),
        )

        updated = workflow.apply_user_choice(
            workflow_run_id="wf-004b",
            action="select_candidate",
            candidate_index=0,
            trace=WorkflowTraceContext(
                trace_id="trace-004b-choice",
                parent_run_id="run-parent-004b-choice",
                tool_call_id="tool-call-004b-choice",
            ),
        )

        self.assertEqual(updated.selected_directory_entry, paused.directory_candidates[0])
        self.assertFalse(updated.pending_confirmation)
        self.assertEqual(updated.hitl_context, {})
        self.assertEqual(updated.tool_results, paused.tool_results)
        self.assertEqual(
            updated.final_answer,
            f"{paused.directory_candidates[0]['label']}: {paused.directory_candidates[0]['value']}",
        )

    def test_directory_apply_cancel_clears_pending_state_without_new_tool_call(self) -> None:
        workflow = self._build_workflow()

        paused = workflow.run(
            conversation_id="conv-004c",
            workflow_run_id="wf-004c",
            user_query="directory: registrar office",
            trace=WorkflowTraceContext(
                trace_id="trace-004c",
                parent_run_id="run-parent-004c",
                tool_call_id="tool-call-004c",
            ),
            actor_context=self._actor_context(campus_scope="main-campus"),
        )

        updated = workflow.apply_user_choice(
            workflow_run_id="wf-004c",
            action="cancel",
            candidate_index=None,
            trace=WorkflowTraceContext(
                trace_id="trace-004c-cancel",
                parent_run_id="run-parent-004c-cancel",
                tool_call_id="tool-call-004c-cancel",
            ),
        )

        self.assertIsNone(updated.selected_directory_entry)
        self.assertFalse(updated.pending_confirmation)
        self.assertEqual(updated.hitl_context, {})
        self.assertEqual(updated.tool_results, paused.tool_results)
        self.assertEqual(updated.final_answer, "Directory selection canceled.")

    def test_directory_scope_filter_is_request_only_and_does_not_leak_into_entries(self) -> None:
        workflow = self._build_workflow()

        state = workflow.run(
            conversation_id="conv-005",
            workflow_run_id="wf-005",
            user_query="directory: library help desk",
            trace=WorkflowTraceContext(
                trace_id="trace-005",
                parent_run_id="run-parent-005",
                tool_call_id="tool-call-005",
            ),
            actor_context=self._actor_context(campus_scope="north-campus"),
        )

        self.assertEqual(len(state.directory_candidates), 3)
        for entry in state.directory_candidates:
            self.assertNotIn("campus_scope", entry)
        self.assertEqual(
            state.tool_results[0].request["campus_scope"],
            "north-campus",
        )

    def test_directory_run_persists_d009_actor_snapshot_for_resume(self) -> None:
        workflow = self._build_workflow()

        state = workflow.run(
            conversation_id="conv-006",
            workflow_run_id="wf-006",
            user_query="directory: graduate admissions email",
            trace=WorkflowTraceContext(
                trace_id="trace-006",
                parent_run_id="run-parent-006",
                tool_call_id="tool-call-006",
            ),
            actor_context=self._actor_context(
                user_id="user-999",
                roles=("student", "ta"),
                departments=("math",),
                groups=("helpers",),
                campus_scope="main-campus",
            ),
        )

        persisted = workflow.state_store.load("wf-006")
        self.assertEqual(state.actor_snapshot["actor_user_id"], "user-999")
        self.assertEqual(state.actor_snapshot["actor_roles"], ["student", "ta"])
        self.assertEqual(state.actor_snapshot["actor_departments"], ["math"])
        self.assertEqual(state.actor_snapshot["actor_groups"], ["helpers"])
        self.assertEqual(state.actor_snapshot["campus_scope"], "main-campus")
        self.assertTrue(state.actor_snapshot["is_authenticated"])
        self.assertEqual(persisted.actor_snapshot["actor_user_id"], "user-999")

    def test_directory_response_retains_fixture_ids_only_as_tool_metadata(self) -> None:
        workflow = self._build_workflow()

        state = workflow.run(
            conversation_id="conv-007",
            workflow_run_id="wf-007",
            user_query="directory: graduate admissions email",
            trace=WorkflowTraceContext(
                trace_id="trace-007",
                parent_run_id="run-parent-007",
                tool_call_id="tool-call-007",
            ),
            actor_context=self._actor_context(),
        )

        response = state.tool_results[0].response
        self.assertEqual(response["request_id"], "tool-call-007")
        self.assertEqual(response["trace_id"], "trace-007")
        self.assertEqual(
            response["data"]["tool_request_id"],
            "fixture-directory-graduate-admissions-email",
        )
        self.assertEqual(
            response["data"]["tool_trace_id"],
            "trace-fixture-campus-directory-lookup",
        )

    def test_map_resolved_path_persists_resolution_and_prepares_navigation_confirmation(self) -> None:
        workflow = self._build_workflow()

        state = workflow.run(
            conversation_id="conv-008",
            workflow_run_id="wf-008",
            user_query="map: student center",
            trace=WorkflowTraceContext(
                trace_id="trace-008",
                parent_run_id="run-parent-008",
                tool_call_id="tool-call-008",
            ),
            actor_context=self._actor_context(campus_scope="north-campus"),
        )

        self.assertEqual(state.selected_tool, "campus_navigation_plan")
        self.assertEqual(state.selected_campus["campus_id"], "north-campus")
        self.assertEqual(state.selected_poi["poi_id"], "north-campus-student-center")
        self.assertEqual(state.target_coordinate, {"lat": 39.9125, "lng": 116.4215})
        self.assertEqual(state.navigation_mode, "walking")
        self.assertTrue(state.pending_confirmation)
        self.assertEqual(state.hitl_context["kind"], "navigation_confirmation")
        self.assertEqual(state.hitl_context["candidate_source"], "none")
        self.assertEqual(state.hitl_context["allowed_actions"], ["confirm", "cancel"])
        self.assertEqual(state.hitl_context["resume_step"], "await_navigation_confirmation")
        self.assertTrue(state.hitl_context["requires_side_effect_confirmation"])
        self.assertEqual(state.tool_results[0].tool_name, "campus_map_resolve")
        self.assertEqual(state.tool_results[1].tool_name, "campus_navigation_plan")
        self.assertNotIn(
            "navigation_plan_response",
            state.tool_results[0].response["data"],
        )
        self.assertEqual(state.tool_results[0].response["request_id"], "tool-call-008")
        self.assertEqual(state.tool_results[1].response["trace_id"], "trace-008")

    def test_map_response_contract_stays_free_of_navigation_payload_details(self) -> None:
        workflow = self._build_workflow()

        state = workflow.run(
            conversation_id="conv-008b",
            workflow_run_id="wf-008b",
            user_query="map: student center",
            trace=WorkflowTraceContext(
                trace_id="trace-008b",
                parent_run_id="run-parent-008b",
                tool_call_id="tool-call-008b",
            ),
            actor_context=self._actor_context(campus_scope="north-campus"),
        )

        map_response = state.tool_results[0].response
        navigation_response = state.tool_results[1].response

        self.assertEqual(map_response["data"]["status"], "resolved")
        self.assertNotIn("navigation_plan_response", map_response["data"])
        self.assertEqual(
            navigation_response["data"]["navigation_plan"]["target"]["poi_id"],
            "north-campus-student-center",
        )
        self.assertTrue(navigation_response["data"]["requires_confirmation"])

    def test_map_campus_ambiguous_path_persists_candidates_and_hitl(self) -> None:
        workflow = self._build_workflow()

        state = workflow.run(
            conversation_id="conv-009",
            workflow_run_id="wf-009",
            user_query="map: student center",
            trace=WorkflowTraceContext(
                trace_id="trace-009",
                parent_run_id="run-parent-009",
                tool_call_id="tool-call-009",
            ),
            actor_context=self._actor_context(campus_scope=None),
        )

        self.assertEqual(state.selected_tool, "campus_map_resolve")
        self.assertEqual(len(state.campus_candidates), 2)
        self.assertEqual(state.poi_candidates, [])
        self.assertIsNone(state.selected_campus)
        self.assertIsNone(state.selected_poi)
        self.assertIsNone(state.target_coordinate)
        self.assertTrue(state.pending_confirmation)
        self.assertEqual(state.hitl_context["kind"], "campus_disambiguation")
        self.assertEqual(state.hitl_context["candidate_source"], "campus_candidates")
        self.assertEqual(state.hitl_context["allowed_actions"], ["select_candidate", "cancel"])
        self.assertEqual(state.hitl_context["resume_step"], "await_campus_selection")
        self.assertFalse(state.hitl_context["requires_side_effect_confirmation"])

    def test_campus_apply_select_candidate_recalls_map_with_chosen_campus_scope(self) -> None:
        workflow = self._build_workflow()

        paused = workflow.run(
            conversation_id="conv-009a",
            workflow_run_id="wf-009a",
            user_query="map: student center",
            trace=WorkflowTraceContext(
                trace_id="trace-009a",
                parent_run_id="run-parent-009a",
                tool_call_id="tool-call-009a",
            ),
            actor_context=self._actor_context(campus_scope=None),
        )

        updated = workflow.apply_user_choice(
            workflow_run_id="wf-009a",
            action="select_candidate",
            candidate_index=0,
            trace=WorkflowTraceContext(
                trace_id="trace-009a-choice",
                parent_run_id="run-parent-009a-choice",
                tool_call_id="tool-call-009a-choice",
            ),
        )

        self.assertEqual(len(updated.tool_results), 3)
        self.assertEqual(updated.tool_results[1].tool_name, "campus_map_resolve")
        self.assertEqual(updated.tool_results[1].request["campus_scope"], "north-campus")
        self.assertEqual(updated.tool_results[1].response["request_id"], "tool-call-009a-choice")
        self.assertEqual(updated.tool_results[2].tool_name, "campus_navigation_plan")
        self.assertEqual(updated.selected_tool, "campus_navigation_plan")
        self.assertEqual(updated.selected_campus["campus_id"], "north-campus")
        self.assertEqual(updated.selected_poi["poi_id"], "north-campus-student-center")
        self.assertTrue(updated.pending_confirmation)
        self.assertEqual(updated.hitl_context["kind"], "navigation_confirmation")

    def test_campus_apply_cancel_clears_pending_state_without_new_tool_call(self) -> None:
        workflow = self._build_workflow()

        paused = workflow.run(
            conversation_id="conv-009b",
            workflow_run_id="wf-009b",
            user_query="map: student center",
            trace=WorkflowTraceContext(
                trace_id="trace-009b",
                parent_run_id="run-parent-009b",
                tool_call_id="tool-call-009b",
            ),
            actor_context=self._actor_context(campus_scope=None),
        )

        updated = workflow.apply_user_choice(
            workflow_run_id="wf-009b",
            action="cancel",
            candidate_index=None,
            trace=WorkflowTraceContext(
                trace_id="trace-009b-cancel",
                parent_run_id="run-parent-009b-cancel",
                tool_call_id="tool-call-009b-cancel",
            ),
        )

        self.assertFalse(updated.pending_confirmation)
        self.assertEqual(updated.hitl_context, {})
        self.assertIsNone(updated.selected_campus)
        self.assertEqual(updated.tool_results, paused.tool_results)
        self.assertEqual(updated.final_answer, "Campus selection canceled.")

    def test_map_poi_ambiguous_path_persists_selected_campus_and_hitl(self) -> None:
        workflow = self._build_workflow()

        state = workflow.run(
            conversation_id="conv-010",
            workflow_run_id="wf-010",
            user_query="map: main campus library",
            trace=WorkflowTraceContext(
                trace_id="trace-010",
                parent_run_id="run-parent-010",
                tool_call_id="tool-call-010",
            ),
            actor_context=self._actor_context(campus_scope=None),
        )

        self.assertEqual(state.selected_tool, "campus_map_resolve")
        self.assertEqual(state.selected_campus["campus_id"], "main-campus")
        self.assertEqual(len(state.poi_candidates), 2)
        self.assertIsNone(state.selected_poi)
        self.assertIsNone(state.target_coordinate)
        self.assertTrue(state.pending_confirmation)
        self.assertEqual(state.hitl_context["kind"], "poi_disambiguation")
        self.assertEqual(state.hitl_context["candidate_source"], "poi_candidates")
        self.assertEqual(state.hitl_context["allowed_actions"], ["select_candidate", "cancel"])
        self.assertEqual(state.hitl_context["resume_step"], "await_poi_selection")
        self.assertFalse(state.hitl_context["requires_side_effect_confirmation"])

    def test_poi_apply_select_candidate_calls_navigation_without_recalling_map(self) -> None:
        workflow = self._build_workflow()

        paused = workflow.run(
            conversation_id="conv-010a",
            workflow_run_id="wf-010a",
            user_query="map: main campus library",
            trace=WorkflowTraceContext(
                trace_id="trace-010a",
                parent_run_id="run-parent-010a",
                tool_call_id="tool-call-010a",
            ),
            actor_context=self._actor_context(campus_scope=None),
        )

        updated = workflow.apply_user_choice(
            workflow_run_id="wf-010a",
            action="select_candidate",
            candidate_index=0,
            trace=WorkflowTraceContext(
                trace_id="trace-010a-choice",
                parent_run_id="run-parent-010a-choice",
                tool_call_id="tool-call-010a-choice",
            ),
        )

        chosen = paused.poi_candidates[0]
        self.assertEqual(len(updated.tool_results), 2)
        self.assertEqual(updated.tool_results[1].tool_name, "campus_navigation_plan")
        self.assertEqual(updated.tool_results[1].response["request_id"], "tool-call-010a-choice")
        self.assertEqual(updated.selected_poi, chosen)
        self.assertEqual(updated.target_coordinate, chosen["coordinate"])
        self.assertEqual(updated.selected_tool, "campus_navigation_plan")
        self.assertEqual(updated.hitl_context["kind"], "navigation_confirmation")
        self.assertTrue(updated.pending_confirmation)

    def test_poi_apply_cancel_clears_pending_state_without_new_tool_call(self) -> None:
        workflow = self._build_workflow()

        paused = workflow.run(
            conversation_id="conv-010b",
            workflow_run_id="wf-010b",
            user_query="map: main campus library",
            trace=WorkflowTraceContext(
                trace_id="trace-010b",
                parent_run_id="run-parent-010b",
                tool_call_id="tool-call-010b",
            ),
            actor_context=self._actor_context(campus_scope=None),
        )

        updated = workflow.apply_user_choice(
            workflow_run_id="wf-010b",
            action="cancel",
            candidate_index=None,
            trace=WorkflowTraceContext(
                trace_id="trace-010b-cancel",
                parent_run_id="run-parent-010b-cancel",
                tool_call_id="tool-call-010b-cancel",
            ),
        )

        self.assertEqual(updated.selected_campus, paused.selected_campus)
        self.assertIsNone(updated.selected_poi)
        self.assertIsNone(updated.target_coordinate)
        self.assertFalse(updated.pending_confirmation)
        self.assertEqual(updated.hitl_context, {})
        self.assertEqual(updated.tool_results, paused.tool_results)
        self.assertEqual(updated.final_answer, "POI selection canceled.")

    def test_map_no_match_clears_resolution_state_without_confirmation(self) -> None:
        workflow = self._build_workflow()

        state = workflow.run(
            conversation_id="conv-011",
            workflow_run_id="wf-011",
            user_query="map: quantum garden",
            trace=WorkflowTraceContext(
                trace_id="trace-011",
                parent_run_id="run-parent-011",
                tool_call_id="tool-call-011",
            ),
            actor_context=self._actor_context(campus_scope=None),
        )

        self.assertEqual(state.selected_tool, "campus_map_resolve")
        self.assertEqual(state.campus_candidates, [])
        self.assertEqual(state.poi_candidates, [])
        self.assertIsNone(state.selected_campus)
        self.assertIsNone(state.selected_poi)
        self.assertIsNone(state.target_coordinate)
        self.assertFalse(state.pending_confirmation)
        self.assertEqual(state.hitl_context, {})
        self.assertEqual(state.final_answer, "No campus or POI matches found.")

    def test_map_scope_filter_resolves_campus_ambiguity_before_navigation(self) -> None:
        workflow = self._build_workflow()

        state = workflow.run(
            conversation_id="conv-012",
            workflow_run_id="wf-012",
            user_query="map: student center",
            trace=WorkflowTraceContext(
                trace_id="trace-012",
                parent_run_id="run-parent-012",
                tool_call_id="tool-call-012",
            ),
            actor_context=self._actor_context(campus_scope="north-campus"),
        )

        self.assertEqual(state.tool_results[0].request["campus_scope"], "north-campus")
        self.assertEqual(state.selected_campus["campus_id"], "north-campus")
        self.assertEqual(state.selected_poi["poi_id"], "north-campus-student-center")

    def test_navigation_response_retains_fixture_ids_only_as_tool_metadata(self) -> None:
        workflow = self._build_workflow()

        state = workflow.run(
            conversation_id="conv-013",
            workflow_run_id="wf-013",
            user_query="map: student center",
            trace=WorkflowTraceContext(
                trace_id="trace-013",
                parent_run_id="run-parent-013",
                tool_call_id="tool-call-013",
            ),
            actor_context=self._actor_context(campus_scope="north-campus"),
        )

        response = state.tool_results[1].response
        self.assertEqual(response["request_id"], "tool-call-013")
        self.assertEqual(response["trace_id"], "trace-013")
        self.assertTrue(response["data"]["requires_confirmation"])
        self.assertEqual(
            response["data"]["tool_trace_id"],
            "trace-fixture-campus-navigation-plan",
        )
        self.assertTrue(
            response["data"]["tool_request_id"].startswith("fixture-navigation-"),
        )

    def test_navigation_apply_confirm_clears_pending_state_without_provider_execution(self) -> None:
        workflow = self._build_workflow()

        paused = workflow.run(
            conversation_id="conv-013a",
            workflow_run_id="wf-013a",
            user_query="map: student center",
            trace=WorkflowTraceContext(
                trace_id="trace-013a",
                parent_run_id="run-parent-013a",
                tool_call_id="tool-call-013a",
            ),
            actor_context=self._actor_context(campus_scope="north-campus"),
        )

        updated = workflow.apply_user_choice(
            workflow_run_id="wf-013a",
            action="confirm",
            candidate_index=None,
            trace=WorkflowTraceContext(
                trace_id="trace-013a-confirm",
                parent_run_id="run-parent-013a-confirm",
                tool_call_id="tool-call-013a-confirm",
            ),
        )

        self.assertFalse(updated.pending_confirmation)
        self.assertEqual(updated.hitl_context, {})
        self.assertEqual(len(updated.tool_results), len(paused.tool_results))
        self.assertEqual(updated.selected_poi, paused.selected_poi)
        self.assertEqual(updated.final_answer, "Navigation confirmed for North Campus Student Center.")

    def test_navigation_apply_cancel_clears_pending_state_without_provider_execution(self) -> None:
        workflow = self._build_workflow()

        paused = workflow.run(
            conversation_id="conv-013b",
            workflow_run_id="wf-013b",
            user_query="map: student center",
            trace=WorkflowTraceContext(
                trace_id="trace-013b",
                parent_run_id="run-parent-013b",
                tool_call_id="tool-call-013b",
            ),
            actor_context=self._actor_context(campus_scope="north-campus"),
        )

        updated = workflow.apply_user_choice(
            workflow_run_id="wf-013b",
            action="cancel",
            candidate_index=None,
            trace=WorkflowTraceContext(
                trace_id="trace-013b-cancel",
                parent_run_id="run-parent-013b-cancel",
                tool_call_id="tool-call-013b-cancel",
            ),
        )

        self.assertFalse(updated.pending_confirmation)
        self.assertEqual(updated.hitl_context, {})
        self.assertEqual(len(updated.tool_results), len(paused.tool_results))
        self.assertEqual(updated.selected_poi, paused.selected_poi)
        self.assertEqual(updated.final_answer, "Navigation canceled.")

    def test_apply_user_choice_rejects_invalid_action_without_state_mutation(self) -> None:
        workflow = self._build_workflow()

        workflow.run(
            conversation_id="conv-014",
            workflow_run_id="wf-014",
            user_query="directory: registrar office",
            trace=WorkflowTraceContext(
                trace_id="trace-014",
                parent_run_id="run-parent-014",
                tool_call_id="tool-call-014",
            ),
            actor_context=self._actor_context(campus_scope="main-campus"),
        )
        before = workflow.state_store.load("wf-014").to_dict()

        with self.assertRaises(ValueError):
            workflow.apply_user_choice(
                workflow_run_id="wf-014",
                action="confirm",
                candidate_index=None,
                trace=WorkflowTraceContext(
                    trace_id="trace-014-invalid",
                    parent_run_id="run-parent-014-invalid",
                    tool_call_id="tool-call-014-invalid",
                ),
            )

        self.assertEqual(workflow.state_store.load("wf-014").to_dict(), before)

    def test_apply_user_choice_rejects_missing_candidate_index_without_state_mutation(self) -> None:
        workflow = self._build_workflow()

        workflow.run(
            conversation_id="conv-015",
            workflow_run_id="wf-015",
            user_query="directory: registrar office",
            trace=WorkflowTraceContext(
                trace_id="trace-015",
                parent_run_id="run-parent-015",
                tool_call_id="tool-call-015",
            ),
            actor_context=self._actor_context(campus_scope="main-campus"),
        )
        before = workflow.state_store.load("wf-015").to_dict()

        with self.assertRaises(ValueError):
            workflow.apply_user_choice(
                workflow_run_id="wf-015",
                action="select_candidate",
                candidate_index=None,
                trace=WorkflowTraceContext(
                    trace_id="trace-015-invalid",
                    parent_run_id="run-parent-015-invalid",
                    tool_call_id="tool-call-015-invalid",
                ),
            )

        self.assertEqual(workflow.state_store.load("wf-015").to_dict(), before)

    def test_apply_user_choice_rejects_out_of_range_candidate_index_without_state_mutation(self) -> None:
        workflow = self._build_workflow()

        workflow.run(
            conversation_id="conv-016",
            workflow_run_id="wf-016",
            user_query="directory: registrar office",
            trace=WorkflowTraceContext(
                trace_id="trace-016",
                parent_run_id="run-parent-016",
                tool_call_id="tool-call-016",
            ),
            actor_context=self._actor_context(campus_scope="main-campus"),
        )
        before = workflow.state_store.load("wf-016").to_dict()

        with self.assertRaises(ValueError):
            workflow.apply_user_choice(
                workflow_run_id="wf-016",
                action="select_candidate",
                candidate_index=99,
                trace=WorkflowTraceContext(
                    trace_id="trace-016-invalid",
                    parent_run_id="run-parent-016-invalid",
                    tool_call_id="tool-call-016-invalid",
                ),
            )

        self.assertEqual(workflow.state_store.load("wf-016").to_dict(), before)

    def test_apply_user_choice_rejects_when_pending_confirmation_is_false(self) -> None:
        workflow = self._build_workflow()

        workflow.run(
            conversation_id="conv-017",
            workflow_run_id="wf-017",
            user_query="directory: graduate admissions email",
            trace=WorkflowTraceContext(
                trace_id="trace-017",
                parent_run_id="run-parent-017",
                tool_call_id="tool-call-017",
            ),
            actor_context=self._actor_context(),
        )
        before = workflow.state_store.load("wf-017").to_dict()

        with self.assertRaises(ValueError):
            workflow.apply_user_choice(
                workflow_run_id="wf-017",
                action="cancel",
                candidate_index=None,
                trace=WorkflowTraceContext(
                    trace_id="trace-017-invalid",
                    parent_run_id="run-parent-017-invalid",
                    tool_call_id="tool-call-017-invalid",
                ),
            )

        self.assertEqual(workflow.state_store.load("wf-017").to_dict(), before)

    def test_apply_user_choice_rejects_repeated_apply_after_first_success(self) -> None:
        workflow = self._build_workflow()

        workflow.run(
            conversation_id="conv-018",
            workflow_run_id="wf-018",
            user_query="directory: registrar office",
            trace=WorkflowTraceContext(
                trace_id="trace-018",
                parent_run_id="run-parent-018",
                tool_call_id="tool-call-018",
            ),
            actor_context=self._actor_context(campus_scope="main-campus"),
        )

        workflow.apply_user_choice(
            workflow_run_id="wf-018",
            action="select_candidate",
            candidate_index=0,
            trace=WorkflowTraceContext(
                trace_id="trace-018-choice",
                parent_run_id="run-parent-018-choice",
                tool_call_id="tool-call-018-choice",
            ),
        )
        after_first = workflow.state_store.load("wf-018").to_dict()

        with self.assertRaises(ValueError):
            workflow.apply_user_choice(
                workflow_run_id="wf-018",
                action="cancel",
                candidate_index=None,
                trace=WorkflowTraceContext(
                    trace_id="trace-018-repeat",
                    parent_run_id="run-parent-018-repeat",
                    tool_call_id="tool-call-018-repeat",
                ),
            )

        self.assertEqual(workflow.state_store.load("wf-018").to_dict(), after_first)

    def test_registry_keeps_directory_and_map_tools_as_unimplemented_boundaries(self) -> None:
        workflow = self._build_workflow()

        registry = workflow.available_tools()

        self.assertTrue(registry["campus_rag_search"].implemented)
        self.assertTrue(registry["campus_rag_answer"].implemented)
        self.assertTrue(registry["campus_directory_lookup"].implemented)
        self.assertTrue(registry["campus_map_resolve"].implemented)
        self.assertTrue(registry["campus_navigation_plan"].implemented)

    def test_navigation_mode_defaults_to_walking_when_not_specified(self) -> None:
        workflow = self._build_workflow()

        state = workflow.run(
            conversation_id="conv-nav-default",
            workflow_run_id="wf-nav-default",
            user_query="map: student center",
            trace=WorkflowTraceContext(
                trace_id="trace-nav-default",
                parent_run_id="run-parent-nav-default",
                tool_call_id="tool-call-nav-default",
            ),
            actor_context=self._actor_context(campus_scope="north-campus"),
        )

        self.assertEqual(state.navigation_mode, "walking")
        nav_request = state.tool_results[1].request
        self.assertEqual(nav_request["navigation_mode"], "walking")

    def test_navigation_mode_accessible_propagates_to_navigation_tool_call(self) -> None:
        workflow = self._build_workflow()

        state = workflow.run(
            conversation_id="conv-nav-accessible",
            workflow_run_id="wf-nav-accessible",
            user_query="map: student center",
            trace=WorkflowTraceContext(
                trace_id="trace-nav-accessible",
                parent_run_id="run-parent-nav-accessible",
                tool_call_id="tool-call-nav-accessible",
            ),
            actor_context=self._actor_context(campus_scope="north-campus"),
            navigation_mode="accessible",
        )

        self.assertEqual(state.navigation_mode, "accessible")
        nav_request = state.tool_results[1].request
        self.assertEqual(nav_request["navigation_mode"], "accessible")
        nav_plan = state.tool_results[1].response["data"]["navigation_plan"]
        self.assertEqual(nav_plan["navigation_mode"], "accessible")

    def test_navigation_mode_preserved_through_campus_disambiguation_to_poi_selection(self) -> None:
        workflow = self._build_workflow()

        paused = workflow.run(
            conversation_id="conv-nav-chain",
            workflow_run_id="wf-nav-chain",
            user_query="map: student center",
            trace=WorkflowTraceContext(
                trace_id="trace-nav-chain",
                parent_run_id="run-parent-nav-chain",
                tool_call_id="tool-call-nav-chain",
            ),
            actor_context=self._actor_context(campus_scope=None),
            navigation_mode="accessible",
        )

        self.assertEqual(paused.navigation_mode, "accessible")

        updated = workflow.apply_user_choice(
            workflow_run_id="wf-nav-chain",
            action="select_candidate",
            candidate_index=0,
            trace=WorkflowTraceContext(
                trace_id="trace-nav-chain-choice",
                parent_run_id="run-parent-nav-chain-choice",
                tool_call_id="tool-call-nav-chain-choice",
            ),
        )

        nav_request = updated.tool_results[2].request
        self.assertEqual(nav_request["navigation_mode"], "accessible")
        nav_plan = updated.tool_results[2].response["data"]["navigation_plan"]
        self.assertEqual(nav_plan["navigation_mode"], "accessible")

    def test_navigation_mode_preserved_through_poi_disambiguation(self) -> None:
        workflow = self._build_workflow()

        paused = workflow.run(
            conversation_id="conv-nav-poi",
            workflow_run_id="wf-nav-poi",
            user_query="map: main campus library",
            trace=WorkflowTraceContext(
                trace_id="trace-nav-poi",
                parent_run_id="run-parent-nav-poi",
                tool_call_id="tool-call-nav-poi",
            ),
            actor_context=self._actor_context(campus_scope=None),
            navigation_mode="accessible",
        )

        self.assertEqual(paused.navigation_mode, "accessible")

        updated = workflow.apply_user_choice(
            workflow_run_id="wf-nav-poi",
            action="select_candidate",
            candidate_index=0,
            trace=WorkflowTraceContext(
                trace_id="trace-nav-poi-choice",
                parent_run_id="run-parent-nav-poi-choice",
                tool_call_id="tool-call-nav-poi-choice",
            ),
        )

        nav_request = updated.tool_results[1].request
        self.assertEqual(nav_request["navigation_mode"], "accessible")
        nav_plan = updated.tool_results[1].response["data"]["navigation_plan"]
        self.assertEqual(nav_plan["navigation_mode"], "accessible")

    def _build_workflow(self) -> CampusWorkflow:
        return CampusWorkflow(
            settings=CampusAgentSettings(),
            state_store=InMemoryWorkflowStateStore(),
            rag_adapter=CampusRagAdapter(runtime=MockCampusRagRuntime()),
            directory_tool=FixtureBackedCampusDirectoryLookupTool(
                fixture_path=directory_fixture_path()
            ),
            map_tool=FixtureBackedCampusMapResolveTool(fixture_path=map_fixture_path()),
            navigation_tool=FixtureBackedCampusNavigationPlanTool(),
        )

    def _actor_context(
        self,
        *,
        user_id: str = "user-123",
        roles: tuple[str, ...] = ("student",),
        departments: tuple[str, ...] = ("cs",),
        groups: tuple[str, ...] = ("library-users",),
        campus_scope: str | None = "main-campus",
    ) -> WorkflowActorContext:
        return WorkflowActorContext(
            user_id=user_id,
            roles=roles,
            departments=departments,
            groups=groups,
            campus_scope=campus_scope,
        )


if __name__ == "__main__":
    unittest.main()
