package execution

import (
	"encoding/json"
	"testing"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/config"
)

func TestParseAnswerRequestProjectsCampusServicesIntentWithoutPreplanning(t *testing.T) {
	request, httpErr := ParseAnswerRequest(
		json.RawMessage(`{
			"user_goal":"我明天早上要去丰台上课，最早的班车是几点",
			"request_id":"req-transport-preplan",
			"requested_tool":"transport_schedule_lookup"
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
	if payload["execution_contract_version"] != "tool_execution_v1" {
		t.Fatalf(
			"execution_contract_version = %v, want tool_execution_v1",
			payload["execution_contract_version"],
		)
	}
	if payload["response_contract"] != "execution_finalization_response_v2" {
		t.Fatalf(
			"response_contract = %v, want execution_finalization_response_v2",
			payload["response_contract"],
		)
	}
	if payload["effective_tool"] != "transport_schedule_lookup" {
		t.Fatalf("effective_tool = %v, want transport_schedule_lookup", payload["effective_tool"])
	}
	if payload["task_queue"] != "campus-agent.workflow" {
		t.Fatalf("task_queue = %v, want campus-agent.workflow", payload["task_queue"])
	}
	runtimeDecisions := expectExecutionRecord(t, payload["runtime_decisions"], "runtime_decisions")
	if runtimeDecisions["schema_version"] != "tool-execution-runtime-decisions-v1" {
		t.Fatalf("runtime_decisions.schema_version = %v, want tool-execution-runtime-decisions-v1", runtimeDecisions["schema_version"])
	}
	if runtimeDecisions["effective_tool"] != "transport_schedule_lookup" {
		t.Fatalf("effective_tool = %v", runtimeDecisions["effective_tool"])
	}
	summary := expectExecutionRecord(t, runtimeDecisions["runtime_decision_summary"], "runtime_decision_summary")
	if summary["schema_version"] != "runtime-decision-summary-v1" {
		t.Fatalf("runtime_decision_summary.schema_version = %v, want runtime-decision-summary-v1", summary["schema_version"])
	}
	if summary["planning_outcome"] != "not_preplanned" ||
		summary["terminal_outcome"] != "" ||
		summary["fail_close_reason"] != "" ||
		summary["selected_tool"] != "" {
		t.Fatalf("runtime_decision_summary = %#v", summary)
	}
	if _, ok := runtimeDecisions["handoff"]; ok {
		t.Fatalf("runtime_decisions.handoff = %#v, want absent before agent tool selection", runtimeDecisions["handoff"])
	}
	if _, ok := runtimeDecisions["workflow_plan"]; ok {
		t.Fatalf("runtime_decisions.workflow_plan = %#v, want absent before agent tool selection", runtimeDecisions["workflow_plan"])
	}
	if request.ToolHandoff != nil ||
		request.WorkflowMode != "" ||
		len(request.PlannedHandoffs) != 0 {
		t.Fatalf(
			"request handoff/workflow/planned = %#v/%q/%#v, want no preplanned tool handoff",
			request.ToolHandoff,
			request.WorkflowMode,
			request.PlannedHandoffs,
		)
	}
}

func TestParseAnswerRequestProjectsKnowledgeScopeWithoutPreplanning(t *testing.T) {
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
	if summary["planning_outcome"] != "not_preplanned" {
		t.Fatalf("runtime_decision_summary.planning_outcome = %v, want not_preplanned", summary["planning_outcome"])
	}
	if request.RuntimeDecisions.PlanningOutcome != "not_preplanned" {
		t.Fatalf(
			"request planning outcome = %q, want not_preplanned",
			request.RuntimeDecisions.PlanningOutcome,
		)
	}
	if _, ok := runtimeDecisions["handoff"]; ok {
		t.Fatalf("runtime_decisions.handoff = %#v, want absent before agent tool selection", runtimeDecisions["handoff"])
	}
	if _, ok := runtimeDecisions["workflow_plan"]; ok {
		t.Fatalf("runtime_decisions.workflow_plan = %#v, want absent before agent tool selection", runtimeDecisions["workflow_plan"])
	}
	if request.ToolHandoff != nil ||
		request.WorkflowMode != "" ||
		len(request.PlannedHandoffs) != 0 {
		t.Fatalf(
			"request handoff/workflow/planned = %#v/%q/%#v, want no preplanned knowledge handoff",
			request.ToolHandoff,
			request.WorkflowMode,
			request.PlannedHandoffs,
		)
	}
	scope := expectExecutionRecord(t, payload["requested_scope"], "requested_scope")
	if scope["corpus"] != "regulations" || scope["collection"] != "student_rules" {
		t.Fatalf("scope = %#v, want regulations/student_rules", scope)
	}
	versionQuery := expectExecutionRecord(t, payload["version_query"], "version_query")
	if versionQuery["mode"] != "compare" ||
		versionQuery["version_id"] != "v1:student-handbook" ||
		versionQuery["compare_to_version_id"] != "v2:student-handbook" {
		t.Fatalf("version_query = %#v, want compare query", versionQuery)
	}
}

func TestParseAnswerRequestKeepsSelectedNoticeContextWithoutPreplanning(t *testing.T) {
	request, httpErr := ParseAnswerRequest(
		json.RawMessage(`{
			"user_goal":"这条通知依据学生手册哪条规定？",
			"request_id":"req-selected-notice-followthrough",
			"requested_tool":"knowledge_query",
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
	if request.WorkflowMode != "" ||
		request.ToolHandoff != nil ||
		len(request.PlannedHandoffs) != 0 {
		t.Fatalf(
			"request handoff/workflow/planned = %#v/%q/%#v, want no preplanned selected notice workflow",
			request.ToolHandoff,
			request.WorkflowMode,
			request.PlannedHandoffs,
		)
	}

	payload := decodeExecutionPayload(t, request.Payload)
	runtimeDecisions := expectExecutionRecord(t, payload["runtime_decisions"], "runtime_decisions")
	summary := expectExecutionRecord(t, runtimeDecisions["runtime_decision_summary"], "runtime_decision_summary")
	if summary["planning_outcome"] != "not_preplanned" ||
		summary["selected_tool"] != "" {
		t.Fatalf("runtime_decision_summary = %#v", summary)
	}
	if _, ok := runtimeDecisions["workflow_plan"]; ok {
		t.Fatalf("runtime_decisions.workflow_plan = %#v, want absent before agent tool selection", runtimeDecisions["workflow_plan"])
	}
}

func TestParseAnswerRequestKeepsTransportNoticeOverrideContextWithoutPreplanning(t *testing.T) {
	request, httpErr := ParseAnswerRequest(
		json.RawMessage(`{
			"user_goal":"今天丰台到海淀通勤车乘车点有没有调整",
			"request_id":"req-transport-notice-override",
			"requested_tool":"transport_schedule_lookup",
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
	if request.WorkflowMode != "" ||
		request.ToolHandoff != nil ||
		len(request.PlannedHandoffs) != 0 {
		t.Fatalf(
			"request handoff/workflow/planned = %#v/%q/%#v, want no preplanned transport notice workflow",
			request.ToolHandoff,
			request.WorkflowMode,
			request.PlannedHandoffs,
		)
	}
	payload := decodeExecutionPayload(t, request.Payload)
	runtimeDecisions := expectExecutionRecord(t, payload["runtime_decisions"], "runtime_decisions")
	summary := expectExecutionRecord(t, runtimeDecisions["runtime_decision_summary"], "runtime_decision_summary")
	if summary["planning_outcome"] != "not_preplanned" ||
		summary["selected_tool"] != "" {
		t.Fatalf("runtime_decision_summary = %#v", summary)
	}
	if _, ok := runtimeDecisions["workflow_plan"]; ok {
		t.Fatalf("runtime_decisions.workflow_plan = %#v, want absent before agent tool selection", runtimeDecisions["workflow_plan"])
	}
}
