from __future__ import annotations

from dataclasses import dataclass

from campus_agent.adapters import CanonicalHeaders, CampusRagAdapter
from campus_agent.config import CampusAgentSettings
from campus_agent.state import (
    InMemoryWorkflowStateStore,
    ToolExecutionRecord,
    WorkflowActorContext,
    WorkflowState,
    WorkflowTraceContext,
)
from campus_agent.tools.directory import FixtureBackedCampusDirectoryLookupTool
from campus_agent.tools.map import FixtureBackedCampusMapResolveTool
from campus_agent.tools.navigation import FixtureBackedCampusNavigationPlanTool


JsonDict = dict[str, object]


@dataclass(slots=True, frozen=True)
class ToolRegistration:
    name: str
    implemented: bool
    owner_boundary: str
    notes: str


class CampusWorkflow:
    """Workflow-first bootstrap orchestration with explicit state persistence."""

    def __init__(
        self,
        *,
        settings: CampusAgentSettings | None = None,
        state_store: InMemoryWorkflowStateStore | None = None,
        rag_adapter: CampusRagAdapter,
        directory_tool: FixtureBackedCampusDirectoryLookupTool | None = None,
        map_tool: FixtureBackedCampusMapResolveTool | None = None,
        navigation_tool: FixtureBackedCampusNavigationPlanTool | None = None,
    ) -> None:
        self.settings = settings or CampusAgentSettings()
        self.state_store = state_store or InMemoryWorkflowStateStore()
        self.rag_adapter = rag_adapter
        self.directory_tool = directory_tool
        self.map_tool = map_tool
        self.navigation_tool = navigation_tool

    def available_tools(self) -> dict[str, ToolRegistration]:
        return {
            "campus_rag_search": ToolRegistration(
                name="campus_rag_search",
                implemented=True,
                owner_boundary="adapter",
                notes="Canonical workflow payload wrapped for current campusRag search runtime.",
            ),
            "campus_rag_answer": ToolRegistration(
                name="campus_rag_answer",
                implemented=True,
                owner_boundary="adapter",
                notes="Canonical workflow payload wrapped for current campusRag answer runtime.",
            ),
            "campus_directory_lookup": ToolRegistration(
                name="campus_directory_lookup",
                implemented=self.directory_tool is not None,
                owner_boundary="tool",
                notes="Reviewed Agent 3 directory tool integrated through workflow-side routing.",
            ),
            "campus_map_resolve": ToolRegistration(
                name="campus_map_resolve",
                implemented=self.map_tool is not None,
                owner_boundary="tool",
                notes="Reviewed Agent 4 map tool integrated through workflow-side routing.",
            ),
            "campus_navigation_plan": ToolRegistration(
                name="campus_navigation_plan",
                implemented=self.navigation_tool is not None,
                owner_boundary="tool",
                notes="Reviewed Agent 4 confirmation-safe navigation tool integrated through workflow-side routing.",
            ),
        }

    def run(
        self,
        *,
        conversation_id: str,
        workflow_run_id: str,
        user_query: str,
        trace: WorkflowTraceContext,
        actor_context: WorkflowActorContext,
    ) -> WorkflowState:
        routed = self._route_query(user_query)
        state = WorkflowState(
            conversation_id=conversation_id,
            workflow_run_id=workflow_run_id,
            user_query=user_query,
            intent=routed["intent"],
            selected_tool=routed["tool_name"],
            trace=trace,
            actor_context=actor_context,
            actor_snapshot=actor_context.to_actor_snapshot(),
            status="in_progress",
            last_completed_step="route_query",
            resume_token=workflow_run_id,
            extension_state={
                "workflow_engine": self.settings.workflow_engine,
            },
            hitl_context={},
        )
        self.state_store.save(state)

        headers = CanonicalHeaders(
            trace_id=trace.trace_id,
            parent_run_id=trace.parent_run_id,
            tool_call_id=trace.tool_call_id,
            caller_service=self.settings.app_name,
            actor_user_id=actor_context.user_id,
            actor_roles=actor_context.roles,
            actor_departments=actor_context.departments,
            actor_groups=actor_context.groups,
            campus_scope=actor_context.campus_scope,
            actor_snapshot=actor_context.snapshot,
        )
        payload = self._build_tool_payload(routed, actor_context)
        response = self._invoke_selected_tool(routed["tool_name"], payload, headers, trace)

        state.tool_results.append(
            ToolExecutionRecord(
                tool_name=routed["tool_name"],
                tool_call_id=trace.tool_call_id,
                request=payload,
                response=response,
                status="completed" if response["ok"] else "failed",
            )
        )
        self._apply_tool_response(state, routed, response)
        state.status = "completed" if response["ok"] else "failed"
        state.last_completed_step = self._resolve_last_completed_step(
            routed["tool_name"],
            response,
            state,
        )
        state.final_answer = self._compose_final_answer(routed["tool_name"], response)
        state.error_code = None if response["ok"] else str(response["error"]["code"])
        self.state_store.save(state)
        return state

    def _route_query(self, user_query: str) -> JsonDict:
        trimmed = user_query.strip()
        if trimmed.lower().startswith("map:"):
            return {
                "intent": "map_resolve",
                "tool_name": "campus_map_resolve",
                "clean_query": trimmed.split(":", 1)[1].strip(),
            }
        if trimmed.lower().startswith("directory:"):
            return {
                "intent": "directory_lookup",
                "tool_name": "campus_directory_lookup",
                "clean_query": trimmed.split(":", 1)[1].strip(),
            }
        if trimmed.lower().startswith("search:"):
            return {
                "intent": "rag_search",
                "tool_name": "campus_rag_search",
                "clean_query": trimmed.split(":", 1)[1].strip(),
            }
        return {
            "intent": "rag_answer",
            "tool_name": "campus_rag_answer",
            "clean_query": trimmed,
        }

    def _build_tool_payload(
        self,
        routed: JsonDict,
        actor_context: WorkflowActorContext,
    ) -> JsonDict:
        if routed["tool_name"] == "campus_map_resolve":
            payload = {"query": routed["clean_query"]}
            if actor_context.campus_scope:
                payload["campus_scope"] = actor_context.campus_scope
            return payload
        if routed["tool_name"] == "campus_directory_lookup":
            payload = {"query": routed["clean_query"]}
            if actor_context.campus_scope:
                payload["campus_scope"] = actor_context.campus_scope
            return payload
        return self._build_rag_payload(routed["clean_query"], actor_context)

    def _build_rag_payload(
        self,
        query: str,
        actor_context: WorkflowActorContext,
    ) -> JsonDict:
        filters: JsonDict = {}
        if actor_context.campus_scope:
            filters["campus_scope"] = actor_context.campus_scope
        return {
            "query": query,
            "corpora": list(self.settings.default_corpora),
            "filters": filters,
            "debug": False,
        }

    def _invoke_selected_tool(
        self,
        tool_name: str,
        payload: JsonDict,
        headers: CanonicalHeaders,
        trace: WorkflowTraceContext,
    ) -> JsonDict:
        if tool_name == "campus_rag_search":
            return self.rag_adapter.search(payload=payload, headers=headers)
        if tool_name == "campus_rag_answer":
            return self.rag_adapter.answer(payload=payload, headers=headers)
        if tool_name == "campus_directory_lookup":
            if self.directory_tool is None:
                raise NotImplementedError("Directory tool is not configured")
            raw_response = self.directory_tool.lookup(payload)
            return self._wrap_directory_tool_response(raw_response, trace)
        if tool_name == "campus_map_resolve":
            if self.map_tool is None:
                raise NotImplementedError("Map tool is not configured")
            raw_response = self.map_tool.resolve(payload)
            wrapped_map = self._wrap_tool_response(
                raw_response=raw_response,
                trace=trace,
            )
            map_data = dict(wrapped_map.get("data") or {})
            if map_data.get("status") == "resolved":
                nav_response = self._prepare_navigation(
                    map_response=wrapped_map,
                    trace=trace,
                )
                map_data["navigation_plan_response"] = nav_response
                wrapped_map["data"] = map_data
            return wrapped_map
        raise NotImplementedError(f"Tool not implemented in bootstrap: {tool_name}")

    def _wrap_directory_tool_response(
        self,
        raw_response: JsonDict,
        trace: WorkflowTraceContext,
    ) -> JsonDict:
        return self._wrap_tool_response(raw_response=raw_response, trace=trace)

    def _wrap_tool_response(
        self,
        *,
        raw_response: JsonDict,
        trace: WorkflowTraceContext,
    ) -> JsonDict:
        wrapped = dict(raw_response)
        wrapped["request_id"] = trace.tool_call_id
        wrapped["trace_id"] = trace.trace_id
        data = dict(raw_response.get("data") or {})
        data["integration_request_id"] = trace.tool_call_id
        data["integration_trace_id"] = trace.trace_id
        data["tool_request_id"] = raw_response.get("request_id")
        data["tool_trace_id"] = raw_response.get("trace_id")
        wrapped["data"] = data
        return wrapped

    def _prepare_navigation(
        self,
        *,
        map_response: JsonDict,
        trace: WorkflowTraceContext,
    ) -> JsonDict:
        if self.navigation_tool is None:
            raise NotImplementedError("Navigation tool is not configured")
        data = dict(map_response["data"])
        navigation_request = {
            "selected_campus": dict(data["selected_campus"]),
            "selected_poi": dict(data["selected_poi"]),
            "target_coordinate": dict(data["target_coordinate"]),
            "navigation_mode": "walking",
        }
        raw_navigation = self.navigation_tool.plan(navigation_request)
        return self._wrap_tool_response(raw_response=raw_navigation, trace=trace)

    def _apply_tool_response(
        self,
        state: WorkflowState,
        routed: JsonDict,
        response: JsonDict,
    ) -> None:
        if not response["ok"]:
            state.pending_confirmation = False
            state.hitl_context = {}
            return
        if routed["tool_name"] != "campus_directory_lookup":
            if routed["tool_name"] == "campus_map_resolve":
                self._apply_map_response(state, response)
                return
            state.pending_confirmation = False
            state.hitl_context = {}
            return

        data = dict(response["data"])
        entries = [dict(entry) for entry in list(data.get("entries") or [])]
        state.directory_query = str(routed["clean_query"])
        state.directory_candidates = entries

        if not entries:
            state.selected_directory_entry = None
            state.pending_confirmation = False
            state.hitl_context = {}
            return

        if len(entries) == 1:
            state.selected_directory_entry = dict(entries[0])
            state.pending_confirmation = False
            state.hitl_context = {}
            return

        state.selected_directory_entry = None
        state.pending_confirmation = True
        state.hitl_context = {
            "kind": "directory_selection",
            "candidate_source": "directory_candidates",
            "allowed_actions": ["select_candidate", "cancel"],
            "resume_step": "await_directory_selection",
            "requires_side_effect_confirmation": False,
        }

    def _apply_map_response(
        self,
        state: WorkflowState,
        response: JsonDict,
    ) -> None:
        data = dict(response["data"])
        state.campus_candidates = [
            dict(candidate) for candidate in list(data.get("campus_candidates") or [])
        ]
        state.poi_candidates = [
            dict(candidate) for candidate in list(data.get("poi_candidates") or [])
        ]
        state.selected_campus = (
            dict(data["selected_campus"]) if data.get("selected_campus") else None
        )
        state.selected_poi = dict(data["selected_poi"]) if data.get("selected_poi") else None
        state.target_coordinate = (
            dict(data["target_coordinate"]) if data.get("target_coordinate") else None
        )

        status = str(data.get("status") or "")
        if status == "campus_ambiguous":
            state.pending_confirmation = True
            state.hitl_context = {
                "kind": "campus_disambiguation",
                "candidate_source": "campus_candidates",
                "allowed_actions": ["select_candidate", "cancel"],
                "resume_step": "await_campus_selection",
                "requires_side_effect_confirmation": False,
            }
            return
        if status == "poi_ambiguous":
            state.pending_confirmation = True
            state.hitl_context = {
                "kind": "poi_disambiguation",
                "candidate_source": "poi_candidates",
                "allowed_actions": ["select_candidate", "cancel"],
                "resume_step": "await_poi_selection",
                "requires_side_effect_confirmation": False,
            }
            return
        if status == "resolved":
            nav_response = data.get("navigation_plan_response")
            if isinstance(nav_response, dict):
                state.tool_results.append(
                    ToolExecutionRecord(
                        tool_name="campus_navigation_plan",
                        tool_call_id=state.trace.tool_call_id if state.trace else "",
                        request={
                            "selected_campus": dict(state.selected_campus or {}),
                            "selected_poi": dict(state.selected_poi or {}),
                            "target_coordinate": dict(state.target_coordinate or {}),
                            "navigation_mode": "walking",
                        },
                        response=dict(nav_response),
                        status="completed",
                    )
                )
                state.selected_tool = "campus_navigation_plan"
                nav_data = dict(nav_response.get("data") or {})
                state.navigation_mode = str(
                    dict(nav_data.get("navigation_plan") or {}).get("navigation_mode")
                    or "walking"
                )
                state.pending_confirmation = bool(nav_data.get("requires_confirmation"))
                state.hitl_context = {
                    "kind": "navigation_confirmation",
                    "candidate_source": "none",
                    "allowed_actions": ["confirm", "cancel"],
                    "resume_step": "await_navigation_confirmation",
                    "requires_side_effect_confirmation": True,
                }
                return
        state.navigation_mode = None
        state.pending_confirmation = False
        state.hitl_context = {}

    def _resolve_last_completed_step(
        self,
        tool_name: str,
        response: JsonDict,
        state: WorkflowState,
    ) -> str:
        if not response["ok"]:
            return "tool_error"
        if tool_name == "campus_directory_lookup" and state.pending_confirmation:
            return "await_directory_selection"
        if tool_name == "campus_map_resolve":
            if state.hitl_context.get("kind") == "campus_disambiguation":
                return "await_campus_selection"
            if state.hitl_context.get("kind") == "poi_disambiguation":
                return "await_poi_selection"
            if state.hitl_context.get("kind") == "navigation_confirmation":
                return "await_navigation_confirmation"
        return "compose_final_answer"

    def _compose_final_answer(self, tool_name: str, response: JsonDict) -> str | None:
        if not response["ok"]:
            return None
        data = dict(response["data"])
        if tool_name == "campus_directory_lookup":
            entries = list(data.get("entries") or [])
            if not entries:
                return "No directory entries found."
            if len(entries) == 1:
                first_entry = dict(entries[0])
                return f"{first_entry['label']}: {first_entry['value']}"
            return f"Found {len(entries)} directory entries. User selection required."
        if tool_name == "campus_map_resolve":
            status = str(data.get("status") or "")
            if status == "no_match":
                return "No campus or POI matches found."
            if status == "campus_ambiguous":
                return f"Found {len(stateful_list := list(data.get('campus_candidates') or []))} campus candidates. User selection required."
            if status == "poi_ambiguous":
                return f"Found {len(stateful_list := list(data.get('poi_candidates') or []))} POI candidates. User selection required."
            if status == "resolved":
                selected_poi = dict(data.get("selected_poi") or {})
                return f"Ready to confirm navigation to {selected_poi.get('label', 'selected destination')}."
        if tool_name == "campus_rag_search":
            hits = list(data.get("hits") or [])
            if not hits:
                return "No search hits found."
            first_hit = dict(hits[0])
            return f"{first_hit['title']}: {first_hit['snippet']}"
        return str(data.get("answer") or "")
