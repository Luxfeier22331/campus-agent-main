package httpapi

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/MUC-WIKI/campus-agent/apps/supervisor-api/internal/bridge"
	"github.com/MUC-WIKI/campus-agent/apps/supervisor-api/internal/config"
	"github.com/MUC-WIKI/campus-agent/apps/supervisor-api/internal/execution"
)

func TestAnswerExecutesRecordedMultiStepWorkflow(t *testing.T) {
	var seenTargets []string
	ragUserGoal := ""
	bridgeClient := &fakeBridge{
		configured: true,
		executeFn: func(ctx context.Context, request bridge.Request) (bridge.ExecuteResponse, error) {
			projected := decodeJSONRecord(t, request.Payload)
			decisions := expectRecord(t, projected["runtime_decisions"], "runtime_decisions")
			handoff := expectRecord(t, decisions["handoff"], "runtime_decisions.handoff")
			agentRequest := expectRecord(t, handoff["agent_request"], "agent_request")
			target, _ := agentRequest["target"].(string)
			userGoal, _ := agentRequest["user_goal"].(string)
			seenTargets = append(seenTargets, target)
			switch target {
			case "notice-agent":
				return bridge.ExecuteResponse{
					StatusCode: http.StatusOK,
					Kind:       "agent_response",
					Body: json.RawMessage(`{
						"target":"notice-agent",
						"status":"completed",
						"answer_text":"已读取通知。",
						"confidence":"high",
						"result":{
							"outcome":"resolved_current",
							"title":"烟雾测试通知",
							"normalized_body":"通知正文要求结合学生手册相关规定理解。",
							"source_url":"https://example.invalid/notices/smoke",
							"source_refs":["notice:smoke:001"]
						},
						"agent_observability":{"selected_tool":"campus_notice_get"}
					}`),
				}, nil
			case "rag-agent":
				ragUserGoal = userGoal
				return bridge.ExecuteResponse{
					StatusCode: http.StatusOK,
					Kind:       "agent_response",
					Body: json.RawMessage(`{
						"target":"rag-agent",
						"status":"completed",
						"answer_text":"这条通知可按学生手册相关规定理解。",
						"confidence":"high",
						"result":{"evidence":{"sources":[{"doc_id":"handbook:rule-001"}]}},
						"agent_observability":{"selected_tool":"retrieval.query"}
					}`),
				}, nil
			default:
				t.Fatalf("unexpected target: %q", target)
				return bridge.ExecuteResponse{}, nil
			}
		},
	}
	server := NewServer(config.Config{
		AuthMode:                      "trusted-worker",
		WorkerSharedSecret:            "worker-secret",
		DefaultActorID:                "runtime-bearer-user",
		RequestBodyLimitBytes:         1_048_576,
		MaxConcurrentAnswers:          8,
		MultiStepWorkflowEnabled:      true,
		WorkflowRunAutoMigrate:        false,
		PromptStrictStructuredOutputs: true,
	}, bridgeClient)
	server.workflowRuns = execution.NewInMemoryWorkflowRunStore()
	request := newTestRequest(
		http.MethodPost,
		"/api/v1/answer",
		strings.NewReader(`{
			"user_goal":"这条通知依据学生手册哪条规定？",
			"request_id":"req-multi-step-notice-knowledge",
			"requested_capability":"knowledge",
			"requested_scope":{"corpus":"regulations","collection":"student_rules"},
			"context":{
				"actor":{"user_id":"student-1","principal_id":"student-1","principal_type":"student","roles":["student"]},
				"authorization":{"retrieval_filter":{"entitlement_groups":[],"visibility_level":"public","policy_projection_version":"phase1-authorization-projection-v1"}},
				"session":{"selected_notice_ref":{"notice_id":"notice:smoke:001","source_family":"wechat_public_notice","title":"烟雾测试通知"},"turn_count":2}
			}
		}`),
	)
	request.Header.Set("x-worker-origin-auth", "worker-secret")
	response := httptest.NewRecorder()

	server.ServeHTTP(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body: %s", response.Code, response.Body.String())
	}
	if len(seenTargets) != 2 || seenTargets[0] != "notice-agent" || seenTargets[1] != "rag-agent" {
		t.Fatalf(
			"seen targets = %#v, want notice-agent then rag-agent; body: %s",
			seenTargets,
			response.Body.String(),
		)
	}
	if !strings.Contains(ragUserGoal, "已读取的通知上下文") ||
		!strings.Contains(ragUserGoal, "烟雾测试通知") ||
		!strings.Contains(ragUserGoal, "通知正文要求结合学生手册相关规定理解。") {
		t.Fatalf("rag user_goal did not include notice step context: %q", ragUserGoal)
	}
	body := decodeBody(t, response)
	observability := expectRecord(t, body["observability"], "observability")
	if observability["selected_tool"] != "retrieval.query" {
		t.Fatalf("observability.selected_tool = %v, want retrieval.query", observability["selected_tool"])
	}
	traceSummary := expectRecord(t, body["workflow_trace_summary"], "workflow_trace_summary")
	if traceSummary["workflow_mode"] != "multi_step" {
		t.Fatalf("workflow_mode = %v, want multi_step", traceSummary["workflow_mode"])
	}
	handoffChain, ok := traceSummary["handoff_chain"].([]any)
	if !ok || len(handoffChain) != 2 {
		t.Fatalf("handoff_chain = %#v, want two handoffs", traceSummary["handoff_chain"])
	}
	contextProjections, ok := traceSummary["context_projections"].([]any)
	if !ok || len(contextProjections) != 1 {
		t.Fatalf(
			"context_projections = %#v, want one notice context projection",
			traceSummary["context_projections"],
		)
	}
	projection := expectRecord(t, contextProjections[0], "context_projections[0]")
	if projection["projection_kind"] != "notice_context" ||
		projection["source_step_id"] != "handoff:notice-agent:campus_notice_get" ||
		projection["content_hash"] == "" {
		t.Fatalf("context projection = %#v, want canonical notice context summary", projection)
	}
	if _, hasRawPayload := projection["payload"]; hasRawPayload {
		t.Fatalf("context projection summary leaked payload: %#v", projection)
	}
}
