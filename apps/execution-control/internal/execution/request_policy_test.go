package execution

import (
	"encoding/json"
	"slices"
	"testing"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/config"
)

func TestParseAnswerRequestProjectsBridgeV5AgentRequestForTransportSchedule(t *testing.T) {
	request, httpErr := ParseAnswerRequest(
		json.RawMessage(`{
			"user_goal":"我明天早上要去丰台上课，最早的班车是几点",
			"request_id":"req-transport-preplan"
		}`),
		map[string]string{
			"authorization": "Bearer secret-token",
		},
		config.Config{
			AuthMode:       "bearer",
			BearerToken:    "secret-token",
			DefaultActorID: "api-bearer-user",
		},
	)

	if httpErr != nil {
		t.Fatalf("unexpected http error: %#v", httpErr)
	}
	payload := decodeExecutionPayload(t, request.Payload)
	if payload["bridge_version"] != "supervisor_bridge_v6" {
		t.Fatalf("bridge_version = %v, want supervisor_bridge_v6", payload["bridge_version"])
	}
	if payload["response_contract"] != "agent_response" {
		t.Fatalf("response_contract = %v, want agent_response", payload["response_contract"])
	}
	if payload["effective_capability"] != "campus_services" {
		t.Fatalf("effective_capability = %v, want campus_services", payload["effective_capability"])
	}
	if payload["lane"] != "campus_services" {
		t.Fatalf("lane = %v, want campus_services", payload["lane"])
	}
	runtimeDecisions := expectExecutionRecord(t, payload["runtime_decisions"], "runtime_decisions")
	if runtimeDecisions["schema_version"] != "supervisor-runtime-decisions-v1" {
		t.Fatalf("runtime_decisions.schema_version = %v, want supervisor-runtime-decisions-v1", runtimeDecisions["schema_version"])
	}
	if runtimeDecisions["effective_capability"] != "campus_services" {
		t.Fatalf("effective_capability = %v", runtimeDecisions["effective_capability"])
	}
	summary := expectExecutionRecord(t, runtimeDecisions["runtime_decision_summary"], "runtime_decision_summary")
	if summary["schema_version"] != "runtime-decision-summary-v1" {
		t.Fatalf("runtime_decision_summary.schema_version = %v, want runtime-decision-summary-v1", summary["schema_version"])
	}
	if summary["planning_outcome"] != "preplanned" {
		t.Fatalf("runtime_decision_summary.planning_outcome = %v, want preplanned", summary["planning_outcome"])
	}
	handoff := expectExecutionRecord(t, runtimeDecisions["handoff"], "handoff")
	if handoff["planning_outcome"] != "preplanned" {
		t.Fatalf("handoff.planning_outcome = %v, want preplanned", handoff["planning_outcome"])
	}
	workflowPlan := expectExecutionRecord(t, runtimeDecisions["workflow_plan"], "workflow_plan")
	if workflowPlan["schema_version"] != "workflow-plan-v1" {
		t.Fatalf("workflow_plan.schema_version = %v, want workflow-plan-v1", workflowPlan["schema_version"])
	}
	if workflowPlan["workflow_mode"] != "single_handoff" {
		t.Fatalf("workflow_plan.workflow_mode = %v, want single_handoff", workflowPlan["workflow_mode"])
	}
	allowedAgents, ok := workflowPlan["allowed_agents"].([]any)
	if !ok || len(allowedAgents) != 1 || allowedAgents[0] != "campus-services-agent" {
		t.Fatalf("workflow_plan.allowed_agents = %#v, want campus-services-agent", workflowPlan["allowed_agents"])
	}
	if workflowPlan["workflow_mode"] == "multi_step" {
		t.Fatalf("transport preplan must not emit multi_step workflow plans: %#v", workflowPlan)
	}
	planSteps, ok := workflowPlan["steps"].([]any)
	if !ok || len(planSteps) != 1 {
		t.Fatalf("workflow_plan.steps = %#v, want one handoff step", workflowPlan["steps"])
	}
	planStep := expectExecutionRecord(t, planSteps[0], "workflow_plan.steps[0]")
	if planStep["step_kind"] != "handoff" || planStep["target"] != "campus-services-agent" {
		t.Fatalf("workflow plan step = %#v, want campus-services handoff", planStep)
	}
	if handoff["target"] != "campus-services-agent" {
		t.Fatalf("handoff.target = %v, want campus-services-agent", handoff["target"])
	}
	allowedTools, ok := handoff["allowed_tools"].([]any)
	if !ok || len(allowedTools) != 1 || allowedTools[0] != "transport_schedule_lookup" {
		t.Fatalf("handoff.allowed_tools = %#v, want transport_schedule_lookup", handoff["allowed_tools"])
	}
	legacyHandoffPayloadKey := "agent" + "_" + "payload"
	if _, ok := handoff[legacyHandoffPayloadKey]; ok {
		t.Fatalf("handoff must not expose legacy payload fragment: %#v", handoff)
	}
	agentRequest := expectExecutionRecord(t, handoff["agent_request"], "handoff.agent_request")
	if agentRequest["target"] != "campus-services-agent" {
		t.Fatalf("agent_request.target = %v, want campus-services-agent", agentRequest["target"])
	}
	if agentRequest["request_id"] != "req-transport-preplan" {
		t.Fatalf("agent_request.request_id = %v, want req-transport-preplan", agentRequest["request_id"])
	}
	payloadRecord := expectExecutionRecord(t, agentRequest["payload"], "handoff.agent_request.payload")
	if payloadRecord["kind"] != "transport_schedule_lookup" {
		t.Fatalf("agent_request.payload.kind = %v, want transport_schedule_lookup", payloadRecord["kind"])
	}
	payloadBody := expectExecutionRecord(t, payloadRecord["payload"], "handoff.agent_request.payload.payload")
	if _, ok := payloadRecord["intent"]; ok {
		t.Fatalf("legacy payload intent should not be present at payload wrapper level: %#v", payloadRecord)
	}
	if payloadBody["intent"] != "first_departure" {
		t.Fatalf("intent = %v, want first_departure", payloadBody["intent"])
	}
	routeSelector := expectExecutionRecord(t, payloadBody["route_selector"], "route_selector")
	if routeSelector["destination_campus"] != "fengtai" {
		t.Fatalf("destination_campus = %v, want fengtai", routeSelector["destination_campus"])
	}
	serviceTimeQuery := expectExecutionRecord(t, payloadBody["service_time_query"], "service_time_query")
	if serviceTimeQuery["date_mode"] != "tomorrow" || serviceTimeQuery["daypart"] != "morning" {
		t.Fatalf("service_time_query = %#v, want tomorrow morning", serviceTimeQuery)
	}
}

func TestParseAnswerRequestPreplansKnowledgeHandoff(t *testing.T) {
	request, httpErr := ParseAnswerRequest(
		json.RawMessage(`{
			"user_goal":"学生手册请假制度怎么规定？",
			"request_id":"req-knowledge-preplan",
			"requested_scope":{"corpus":"regulations","collection":"student_rules"},
			"version_query":{"mode":"compare","version_id":"v1:student-handbook","compare_to_version_id":"v2:student-handbook"}
		}`),
		map[string]string{
			"authorization": "Bearer secret-token",
		},
		config.Config{
			AuthMode:       "bearer",
			BearerToken:    "secret-token",
			DefaultActorID: "api-bearer-user",
		},
	)

	if httpErr != nil {
		t.Fatalf("unexpected http error: %#v", httpErr)
	}
	payload := decodeExecutionPayload(t, request.Payload)
	runtimeDecisions := expectExecutionRecord(t, payload["runtime_decisions"], "runtime_decisions")
	summary := expectExecutionRecord(t, runtimeDecisions["runtime_decision_summary"], "runtime_decision_summary")
	if summary["planning_outcome"] != "preplanned" {
		t.Fatalf("runtime_decision_summary.planning_outcome = %v, want preplanned", summary["planning_outcome"])
	}
	handoff := expectExecutionRecord(t, runtimeDecisions["handoff"], "handoff")
	workflowPlan := expectExecutionRecord(t, runtimeDecisions["workflow_plan"], "workflow_plan")
	if request.RuntimeDecisions.PlanningOutcome != "preplanned" {
		t.Fatalf(
			"request planning outcome = %q, want preplanned",
			request.RuntimeDecisions.PlanningOutcome,
		)
	}
	if handoff["target"] != "rag-agent" {
		t.Fatalf("handoff.target = %v, want rag-agent", handoff["target"])
	}
	if request.StructuredHandoff == nil {
		t.Fatal("structured handoff must be present")
	}
	if !slices.Equal(
		request.StructuredHandoff.ExpectedArtifacts,
		[]string{"evidence_bundle", "grounding_verdict"},
	) {
		t.Fatalf(
			"structured handoff expected artifacts = %#v, want evidence_bundle + grounding_verdict",
			request.StructuredHandoff.ExpectedArtifacts,
		)
	}
	allowedAgents, ok := workflowPlan["allowed_agents"].([]any)
	if !ok || len(allowedAgents) != 1 || allowedAgents[0] != "rag-agent" {
		t.Fatalf("workflow_plan.allowed_agents = %#v, want rag-agent", workflowPlan["allowed_agents"])
	}
	allowedTools, ok := handoff["allowed_tools"].([]any)
	if !ok || len(allowedTools) != 0 {
		t.Fatalf("handoff.allowed_tools = %#v, want empty array", handoff["allowed_tools"])
	}
	if len(request.PlannedHandoffs) != 1 {
		t.Fatalf("planned handoffs = %#v, want one rag handoff", request.PlannedHandoffs)
	}
	if !slices.Equal(
		request.PlannedHandoffs[0].ExpectedArtifacts,
		[]string{"evidence_bundle", "grounding_verdict"},
	) {
		t.Fatalf(
			"planned handoff expected artifacts = %#v, want evidence_bundle + grounding_verdict",
			request.PlannedHandoffs[0].ExpectedArtifacts,
		)
	}
	legacyHandoffPayloadKey := "agent" + "_" + "payload"
	if _, ok := handoff[legacyHandoffPayloadKey]; ok {
		t.Fatalf("handoff must not expose legacy payload fragment: %#v", handoff)
	}
	agentRequest := expectExecutionRecord(t, handoff["agent_request"], "handoff.agent_request")
	if agentRequest["target"] != "rag-agent" {
		t.Fatalf("agent_request.target = %v, want rag-agent", agentRequest["target"])
	}
	agentPayload := expectExecutionRecord(t, agentRequest["payload"], "agent_request.payload")
	if agentPayload["kind"] != "rag_request" {
		t.Fatalf("agent_request.payload.kind = %v, want rag_request", agentPayload["kind"])
	}
	agentPayloadRecord := expectExecutionRecord(t, agentPayload["payload"], "agent_request.payload.payload")
	scope := expectExecutionRecord(t, agentPayloadRecord["scope"], "agent_request.payload.payload.scope")
	if scope["corpus"] != "regulations" || scope["collection"] != "student_rules" {
		t.Fatalf("scope = %#v, want regulations/student_rules", scope)
	}
	versionQuery := expectExecutionRecord(t, agentPayloadRecord["version_query"], "agent_request.payload.payload.version_query")
	if versionQuery["mode"] != "compare" ||
		versionQuery["version_id"] != "v1:student-handbook" ||
		versionQuery["compare_to_version_id"] != "v2:student-handbook" {
		t.Fatalf("version_query = %#v, want compare query", versionQuery)
	}
}

func TestParseAnswerRequestResolvesSelectedNoticeKnowledgeFollowthroughWorkflowPlan(t *testing.T) {
	request, httpErr := ParseAnswerRequest(
		json.RawMessage(`{
			"user_goal":"这条通知依据学生手册哪条规定？",
			"request_id":"req-selected-notice-followthrough",
			"requested_capability":"knowledge",
			"requested_scope":{"corpus":"regulations","collection":"student_rules"},
			"context":{
				"actor":{"user_id":"student-1","principal_id":"student-1","principal_type":"student","roles":["student"]},
				"authorization":{"retrieval_filter":{"visibility_level":"public","policy_projection_version":"phase1-authorization-projection-v1"}},
				"session":{"selected_notice_ref":{"notice_id":"notice:smoke:001","source_family":"wechat_public_notice","title":"烟雾测试通知","target_surface":"regulations/student_rules"}}
			}
		}`),
		map[string]string{
			"x-worker-origin-auth": "worker-secret",
		},
		config.Config{
			AuthMode:                 "trusted-worker",
			WorkerSharedSecret:       "worker-secret",
			DefaultActorID:           "runtime-bearer-user",
			MultiStepWorkflowEnabled: true,
		},
	)

	if httpErr != nil {
		t.Fatalf("unexpected http error: %#v", httpErr)
	}
	if request.WorkflowMode != WorkflowModeMultiStep {
		t.Fatalf("workflow mode = %q, want multi_step", request.WorkflowMode)
	}
	if request.StructuredHandoff == nil {
		t.Fatal("structured handoff must be present")
	}
	if request.StructuredHandoff.Target != "notice-agent" ||
		request.StructuredHandoff.PayloadKind != "campus_notice_get" {
		t.Fatalf("first structured handoff = %#v", request.StructuredHandoff)
	}
	if len(request.StructuredHandoff.AllowedTools) != 0 {
		t.Fatalf("first structured handoff allowed_tools = %#v, want none", request.StructuredHandoff.AllowedTools)
	}
	if len(request.PlannedHandoffs) != 2 {
		t.Fatalf("planned handoffs = %#v, want notice then rag", request.PlannedHandoffs)
	}
	if request.PlannedHandoffs[0].Target != "notice-agent" ||
		request.PlannedHandoffs[0].PayloadKind != "campus_notice_get" {
		t.Fatalf("planned handoff[0] = %#v", request.PlannedHandoffs[0])
	}
	if request.PlannedHandoffs[1].Target != "rag-agent" ||
		request.PlannedHandoffs[1].PayloadKind != "rag_request" ||
		len(request.PlannedHandoffs[1].AllowedTools) != 0 {
		t.Fatalf("planned handoff[1] = %#v", request.PlannedHandoffs[1])
	}
	if request.PlannedHandoffs[1].RequiredProjectionKind != "notice_context" {
		t.Fatalf(
			"planned handoff[1].required_projection_kind = %q, want notice_context",
			request.PlannedHandoffs[1].RequiredProjectionKind,
		)
	}

	payload := decodeExecutionPayload(t, request.Payload)
	runtimeDecisions := expectExecutionRecord(t, payload["runtime_decisions"], "runtime_decisions")
	summary := expectExecutionRecord(t, runtimeDecisions["runtime_decision_summary"], "runtime_decision_summary")
	if summary["planning_outcome"] != "preplanned" {
		t.Fatalf("planning_outcome = %v, want preplanned", summary["planning_outcome"])
	}
	if summary["selected_target"] != "notice-agent" {
		t.Fatalf("selected_target = %v, want notice-agent", summary["selected_target"])
	}
	if summary["selected_tool"] != "" {
		t.Fatalf("selected_tool = %v, want empty for internal notice handoff", summary["selected_tool"])
	}
	workflowPlan := expectExecutionRecord(t, runtimeDecisions["workflow_plan"], "workflow_plan")
	if workflowPlan["workflow_mode"] != "multi_step" {
		t.Fatalf("workflow_plan.workflow_mode = %v, want multi_step", workflowPlan["workflow_mode"])
	}
	steps, ok := workflowPlan["steps"].([]any)
	if !ok || len(steps) != 2 {
		t.Fatalf("workflow_plan.steps = %#v, want two handoff steps", workflowPlan["steps"])
	}
	firstStep := expectExecutionRecord(t, steps[0], "workflow_plan.steps[0]")
	secondStep := expectExecutionRecord(t, steps[1], "workflow_plan.steps[1]")
	if firstStep["step_id"] != "handoff:notice-agent:campus_notice_get" ||
		secondStep["step_id"] != "handoff:rag-agent:rag_request" {
		t.Fatalf("workflow_plan.steps = %#v", workflowPlan["steps"])
	}
	edges, ok := workflowPlan["edges"].([]any)
	if !ok || len(edges) != 1 {
		t.Fatalf("workflow_plan.edges = %#v, want one dependency edge", workflowPlan["edges"])
	}
	edge := expectExecutionRecord(t, edges[0], "workflow_plan.edges[0]")
	if edge["required_projection_kind"] != "notice_context" {
		t.Fatalf("workflow edge = %#v, want notice_context dependency", edge)
	}
}

func TestParseAnswerRequestResolvesTransportNoticeOverrideWorkflowPlan(t *testing.T) {
	request, httpErr := ParseAnswerRequest(
		json.RawMessage(`{
			"user_goal":"今天丰台到海淀通勤车乘车点有没有调整",
			"request_id":"req-transport-notice-override",
			"requested_capability":"campus_services",
			"context":{
				"actor":{"user_id":"student-1","principal_id":"student-1","principal_type":"student","roles":["student"]},
				"authorization":{"retrieval_filter":{"visibility_level":"restricted","entitlement_groups":["students"],"policy_projection_version":"phase1-authorization-projection-v1"}},
				"session":{"selected_notice_ref":{"notice_id":"353903","source_family":"internal_notice_restricted","title":"关于通勤班车丰台校区乘车点调整的通知","target_surface":"campus_services/service_status_candidate"}}
			}
		}`),
		map[string]string{
			"x-worker-origin-auth": "worker-secret",
		},
		config.Config{
			AuthMode:                 "trusted-worker",
			WorkerSharedSecret:       "worker-secret",
			DefaultActorID:           "runtime-bearer-user",
			MultiStepWorkflowEnabled: true,
		},
	)

	if httpErr != nil {
		t.Fatalf("unexpected http error: %#v", httpErr)
	}
	if request.WorkflowMode != WorkflowModeMultiStep {
		t.Fatalf("workflow mode = %q, want multi_step", request.WorkflowMode)
	}
	if request.StructuredHandoff == nil {
		t.Fatal("structured handoff must be present")
	}
	if request.StructuredHandoff.Target != "campus-services-agent" ||
		request.StructuredHandoff.PayloadKind != "transport_schedule_lookup" {
		t.Fatalf("first structured handoff = %#v", request.StructuredHandoff)
	}
	if len(request.PlannedHandoffs) != 3 {
		t.Fatalf("planned handoffs = %#v, want schedule then notice then rag", request.PlannedHandoffs)
	}
	if request.PlannedHandoffs[1].RequiredProjectionKind != "schedule_baseline" {
		t.Fatalf(
			"planned handoff[1].required_projection_kind = %q, want schedule_baseline",
			request.PlannedHandoffs[1].RequiredProjectionKind,
		)
	}
	if request.PlannedHandoffs[2].RequiredProjectionKind != "notice_change_set" {
		t.Fatalf(
			"planned handoff[2].required_projection_kind = %q, want notice_change_set",
			request.PlannedHandoffs[2].RequiredProjectionKind,
		)
	}
	payload := decodeExecutionPayload(t, request.Payload)
	runtimeDecisions := expectExecutionRecord(t, payload["runtime_decisions"], "runtime_decisions")
	workflowPlan := expectExecutionRecord(t, runtimeDecisions["workflow_plan"], "workflow_plan")
	if workflowPlan["workflow_mode"] != "multi_step" {
		t.Fatalf("workflow_plan.workflow_mode = %v, want multi_step", workflowPlan["workflow_mode"])
	}
	steps, ok := workflowPlan["steps"].([]any)
	if !ok || len(steps) != 3 {
		t.Fatalf("workflow_plan.steps = %#v, want three handoff steps", workflowPlan["steps"])
	}
	edges, ok := workflowPlan["edges"].([]any)
	if !ok || len(edges) != 2 {
		t.Fatalf("workflow_plan.edges = %#v, want two dependency edges", workflowPlan["edges"])
	}
	firstEdge := expectExecutionRecord(t, edges[0], "workflow_plan.edges[0]")
	secondEdge := expectExecutionRecord(t, edges[1], "workflow_plan.edges[1]")
	if firstEdge["required_projection_kind"] != "schedule_baseline" {
		t.Fatalf("first edge = %#v, want schedule_baseline dependency", firstEdge)
	}
	if secondEdge["required_projection_kind"] != "notice_change_set" {
		t.Fatalf("second edge = %#v, want notice_change_set dependency", secondEdge)
	}
}
