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
						"follow_up_question":"",
						"confidence":"high",
						"result":{
							"outcome":"resolved_current",
							"title":"烟雾测试通知",
							"body_excerpt":"通知短摘要要求结合学生手册相关规定理解。",
							"source_url":"https://example.invalid/notices/smoke",
							"source_refs":["notice:smoke:001"]
						},
						"agent_observability":{"selected_tool":""}
					}`),
				}, nil
			case "rag-agent":
				ragUserGoal = userGoal
				return bridge.ExecuteResponse{
					StatusCode: http.StatusOK,
					Kind:       "agent_response",
					Body: json.RawMessage(`{
						"target":"rag-agent",
						"status":"needs_clarification",
						"answer_text":"请说明你想咨询通知中的哪一项规定。",
						"follow_up_question":"请说明你想咨询通知中的哪一项规定。",
						"confidence":"low",
						"result":{
							"evidence":{
								"corpus":"regulations",
								"collection":"student_rules",
								"query_text":"这条通知依据学生手册哪条规定？",
								"sources":[{"doc_id":"handbook:rule-001","source_title":"学生手册相关条款"}]
							},
							"diagnostics":{
								"grounding_verdict":"",
								"semantic_outcome":""
							}
						},
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
		OpenCapabilities:              []string{"campus_services"},
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
				"session":{"selected_notice_ref":{"notice_id":"notice:smoke:001","source_family":"wechat_public_notice","title":"烟雾测试通知","target_surface":"regulations/student_rules"},"turn_count":2}
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
		!strings.Contains(ragUserGoal, "通知短摘要要求结合学生手册相关规定理解。") {
		t.Fatalf("rag user_goal did not include notice step context: %q", ragUserGoal)
	}
	body := decodeBody(t, response)
	if body["status"] != "needs_clarification" {
		t.Fatalf("status = %v, want needs_clarification", body["status"])
	}
	observability := expectRecord(t, body["observability"], "observability")
	if observability["selected_tool"] != "retrieval.query" {
		t.Fatalf("observability.selected_tool = %v, want retrieval.query", observability["selected_tool"])
	}
	traceSummary := expectRecord(t, body["workflow_trace_summary"], "workflow_trace_summary")
	if traceSummary["workflow_mode"] != "multi_step" {
		t.Fatalf("workflow_mode = %v, want multi_step", traceSummary["workflow_mode"])
	}
	selectedTools, ok := traceSummary["selected_tools"].([]any)
	if !ok || len(selectedTools) != 1 || selectedTools[0] != "retrieval.query" {
		t.Fatalf("selected_tools = %#v, want retrieval.query only", traceSummary["selected_tools"])
	}
	toolCallSummaries, ok := traceSummary["tool_call_summaries"].([]any)
	if !ok || len(toolCallSummaries) != 1 {
		t.Fatalf("tool_call_summaries = %#v, want rag retrieval summary only", traceSummary["tool_call_summaries"])
	}
	toolCallSummary := expectRecord(t, toolCallSummaries[0], "tool_call_summaries[0]")
	if toolCallSummary["tool_name"] != "retrieval.query" ||
		toolCallSummary["result_status"] != "needs_clarification" {
		t.Fatalf("tool_call_summary = %#v, want retrieval.query needs_clarification", toolCallSummary)
	}
	handoffChain, ok := traceSummary["handoff_chain"].([]any)
	if !ok || len(handoffChain) != 2 {
		t.Fatalf("handoff_chain = %#v, want two handoffs", traceSummary["handoff_chain"])
	}
	contextProjections, ok := traceSummary["context_projections"].([]any)
	if !ok || len(contextProjections) != 3 {
		t.Fatalf(
			"context_projections = %#v, want notice + rag projections",
			traceSummary["context_projections"],
		)
	}
	noticeProjection := expectRecord(t, contextProjections[0], "context_projections[0]")
	evidenceProjection := expectRecord(t, contextProjections[1], "context_projections[1]")
	groundingProjection := expectRecord(t, contextProjections[2], "context_projections[2]")
	answerArtifactProjectionIDs, ok := traceSummary["answer_artifact_projection_ids"].([]any)
	if !ok || len(answerArtifactProjectionIDs) != 2 {
		t.Fatalf(
			"answer_artifact_projection_ids = %#v, want notice + evidence projections",
			traceSummary["answer_artifact_projection_ids"],
		)
	}
	answerArtifactKinds, ok := traceSummary["answer_artifact_kinds"].([]any)
	if !ok || len(answerArtifactKinds) != 2 {
		t.Fatalf(
			"answer_artifact_kinds = %#v, want notice_context + evidence_bundle",
			traceSummary["answer_artifact_kinds"],
		)
	}
	if noticeProjection["projection_kind"] != "notice_context" ||
		noticeProjection["source_step_id"] != "handoff:notice-agent:campus_notice_get" ||
		noticeProjection["content_hash"] == "" {
		t.Fatalf(
			"notice context projection = %#v, want canonical notice context summary",
			noticeProjection,
		)
	}
	if evidenceProjection["projection_kind"] != "evidence_bundle" ||
		evidenceProjection["source_step_id"] != "handoff:rag-agent:rag_request" ||
		evidenceProjection["content_hash"] == "" {
		t.Fatalf("evidence projection = %#v, want rag evidence bundle summary", evidenceProjection)
	}
	if groundingProjection["projection_kind"] != "grounding_verdict" ||
		groundingProjection["source_step_id"] != "handoff:rag-agent:rag_request" ||
		groundingProjection["content_hash"] == "" {
		t.Fatalf(
			"grounding projection = %#v, want rag grounding verdict summary",
			groundingProjection,
		)
	}
	for _, projection := range []map[string]any{noticeProjection, evidenceProjection, groundingProjection} {
		if _, hasRawPayload := projection["payload"]; hasRawPayload {
			t.Fatalf("context projection summary leaked payload: %#v", projection)
		}
	}
	if answerArtifactProjectionIDs[0] != noticeProjection["projection_id"] ||
		answerArtifactProjectionIDs[1] != evidenceProjection["projection_id"] {
		t.Fatalf(
			"answer_artifact_projection_ids = %#v, want notice/evidence projection ids",
			answerArtifactProjectionIDs,
		)
	}
	if answerArtifactKinds[0] != "notice_context" || answerArtifactKinds[1] != "evidence_bundle" {
		t.Fatalf(
			"answer_artifact_kinds = %#v, want notice_context/evidence_bundle",
			answerArtifactKinds,
		)
	}
	agentInvocations, ok := traceSummary["agent_invocations"].([]any)
	if !ok || len(agentInvocations) != 2 {
		t.Fatalf("agent_invocations = %#v, want two invocation graph nodes", traceSummary["agent_invocations"])
	}
	firstInvocation := expectRecord(t, agentInvocations[0], "agent_invocations[0]")
	secondInvocation := expectRecord(t, agentInvocations[1], "agent_invocations[1]")
	firstID, _ := firstInvocation["invocation_id"].(string)
	if firstInvocation["agent_id"] != "notice-agent" || firstID == "" {
		t.Fatalf("first agent invocation = %#v, want notice-agent invocation", firstInvocation)
	}
	if secondInvocation["agent_id"] != "rag-agent" ||
		secondInvocation["parent_invocation_id"] != firstID {
		t.Fatalf("second agent invocation = %#v, want rag-agent child of %q", secondInvocation, firstID)
	}
	projectionIDs, ok := secondInvocation["projection_ids"].([]any)
	if !ok || len(projectionIDs) != 1 || projectionIDs[0] != noticeProjection["projection_id"] {
		t.Fatalf(
			"rag projection_ids = %#v, want consumed notice projection",
			secondInvocation["projection_ids"],
		)
	}
	storedRun, err := server.workflowRuns.Get(
		context.Background(),
		"workflow:req-multi-step-notice-knowledge",
	)
	if err != nil {
		t.Fatalf("workflow run missing: %v", err)
	}
	if storedRun.State != execution.WorkflowStateCompleted {
		t.Fatalf("workflow run state = %v, want completed terminal state", storedRun.State)
	}
	if len(storedRun.ContextProjections) != 3 {
		t.Fatalf(
			"stored context projections = %#v, want notice + rag bounded projections",
			storedRun.ContextProjections,
		)
	}
}

func TestAnswerRejectsTransportNoticeKnowledgeGroundingRequest(t *testing.T) {
	var seenTargets []string
	bridgeClient := &fakeBridge{
		configured: true,
		executeFn: func(ctx context.Context, request bridge.Request) (bridge.ExecuteResponse, error) {
			projected := decodeJSONRecord(t, request.Payload)
			t.Fatalf("terminal transport notice grounding request must not call bridge: %#v", projected)
			return bridge.ExecuteResponse{}, nil
		},
	}
	server := NewServer(config.Config{
		AuthMode:                      "trusted-worker",
		WorkerSharedSecret:            "worker-secret",
		DefaultActorID:                "runtime-bearer-user",
		OpenCapabilities:              []string{"campus_services"},
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
			"user_goal":"这条班车通知依据学生手册哪条规定？",
			"request_id":"req-multi-step-transport-notice-knowledge",
			"requested_capability":"campus_services",
			"requested_scope":{"corpus":"regulations","collection":"student_rules"},
			"context":{
				"actor":{"user_id":"student-1","principal_id":"student-1","principal_type":"student","roles":["student"]},
				"authorization":{"retrieval_filter":{"entitlement_groups":[],"visibility_level":"public","policy_projection_version":"phase1-authorization-projection-v1"}},
				"session":{"selected_notice_ref":{"notice_id":"notice:transport:355122","source_family":"internal_notice_restricted","title":"关于两校区学生通勤班车增加班次的通知","target_surface":"campus_services/service_status_candidate"},"turn_count":2}
			}
		}`),
	)
	request.Header.Set("x-worker-origin-auth", "worker-secret")
	response := httptest.NewRecorder()

	server.ServeHTTP(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body: %s", response.Code, response.Body.String())
	}
	if len(seenTargets) != 0 {
		t.Fatalf("seen targets = %#v, want none", seenTargets)
	}
	body := decodeBody(t, response)
	if body["status"] != "no_answer" {
		t.Fatalf("status = %v, want no_answer", body["status"])
	}
	traceSummary := expectRecord(t, body["workflow_trace_summary"], "workflow_trace_summary")
	if traceSummary["workflow_mode"] != "terminal" {
		t.Fatalf("workflow_mode = %v, want terminal", traceSummary["workflow_mode"])
	}
	observability := expectRecord(t, body["observability"], "observability")
	if observability["policy_reason"] != "selected_notice_target_surface_ineligible_for_knowledge_followthrough" {
		t.Fatalf("observability.policy_reason = %v", observability["policy_reason"])
	}
}

func TestAnswerFailsClosedWhenMultiStepArtifactsAreIncomplete(t *testing.T) {
	var seenTargets []string
	bridgeClient := &fakeBridge{
		configured: true,
		executeFn: func(ctx context.Context, request bridge.Request) (bridge.ExecuteResponse, error) {
			projected := decodeJSONRecord(t, request.Payload)
			decisions := expectRecord(t, projected["runtime_decisions"], "runtime_decisions")
			handoff := expectRecord(t, decisions["handoff"], "runtime_decisions.handoff")
			agentRequest := expectRecord(t, handoff["agent_request"], "agent_request")
			target, _ := agentRequest["target"].(string)
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
						"follow_up_question":"",
						"confidence":"high",
						"result":{
							"title":"烟雾测试通知",
							"body_excerpt":"通知短摘要要求结合学生手册相关规定理解。",
							"source_url":"https://example.invalid/notices/smoke"
						},
						"agent_observability":{"selected_tool":""}
					}`),
				}, nil
			case "rag-agent":
				return bridge.ExecuteResponse{
					StatusCode: http.StatusOK,
					Kind:       "agent_response",
					Body: json.RawMessage(`{
						"target":"rag-agent",
						"status":"completed",
						"answer_text":"这是一个没有 artifact 的错误成功响应。",
						"follow_up_question":"",
						"confidence":"medium",
						"result":{
							"outcome":"resolved_current"
						},
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
		OpenCapabilities:              []string{"campus_services"},
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
			"request_id":"req-multi-step-artifact-incomplete",
			"requested_capability":"knowledge",
			"requested_scope":{"corpus":"regulations","collection":"student_rules"},
			"context":{
				"actor":{"user_id":"student-1","principal_id":"student-1","principal_type":"student","roles":["student"]},
				"authorization":{"retrieval_filter":{"entitlement_groups":[],"visibility_level":"public","policy_projection_version":"phase1-authorization-projection-v1"}},
				"session":{"selected_notice_ref":{"notice_id":"notice:smoke:001","source_family":"wechat_public_notice","title":"烟雾测试通知","target_surface":"regulations/student_rules"},"turn_count":2}
			}
		}`),
	)
	request.Header.Set("x-worker-origin-auth", "worker-secret")
	response := httptest.NewRecorder()

	server.ServeHTTP(response, request)

	if response.Code != http.StatusBadGateway {
		t.Fatalf("status = %d, want 502; body: %s", response.Code, response.Body.String())
	}
	if len(seenTargets) != 2 || seenTargets[0] != "notice-agent" || seenTargets[1] != "rag-agent" {
		t.Fatalf("seen targets = %#v, want notice-agent then rag-agent", seenTargets)
	}
	body := decodeBody(t, response)
	errorBody := expectRecord(t, body["error"], "error")
	if errorBody["code"] != "supervisor_multistep_artifact_incomplete" {
		t.Fatalf("error.code = %v, want supervisor_multistep_artifact_incomplete", errorBody["code"])
	}
	storedRun, err := server.workflowRuns.Get(
		context.Background(),
		"workflow:req-multi-step-artifact-incomplete",
	)
	if err != nil {
		t.Fatalf("workflow run missing: %v", err)
	}
	if storedRun.State != execution.WorkflowStateFailed {
		t.Fatalf("workflow run state = %v, want failed", storedRun.State)
	}
}

func TestAnswerSurfacesMultiStepBridgeStepErrorBeforeArtifactCompleteness(t *testing.T) {
	bridgeClient := &fakeBridge{
		configured: true,
		executeFn: func(ctx context.Context, request bridge.Request) (bridge.ExecuteResponse, error) {
			projected := decodeJSONRecord(t, request.Payload)
			decisions := expectRecord(t, projected["runtime_decisions"], "runtime_decisions")
			handoff := expectRecord(t, decisions["handoff"], "runtime_decisions.handoff")
			agentRequest := expectRecord(t, handoff["agent_request"], "agent_request")
			target, _ := agentRequest["target"].(string)
			if target != "campus-services-agent" {
				t.Fatalf("unexpected target: %q", target)
			}
			return bridge.ExecuteResponse{
				StatusCode: http.StatusOK,
				Kind:       "agent_response",
				Body: json.RawMessage(`{
					"target":"campus-services-agent",
					"status":"error",
					"answer_text":"结构化查询运行失败。",
					"follow_up_question":"",
					"confidence":"low",
					"result":{
						"outcome":"agents_sdk_runtime_failed"
					},
					"error":{
						"code":"agents_sdk_runtime_failed",
						"message":"Agents SDK runner did not produce required output artifacts: schedule_baseline",
						"retryable":false
					},
					"agent_observability":{
						"selected_tool":"transport_schedule_lookup",
						"failure_class":"sdk_artifact_incomplete",
						"fail_close_reason":"sdk_artifact_incomplete"
					}
				}`),
			}, nil
		},
	}
	server := NewServer(config.Config{
		AuthMode:                      "trusted-worker",
		WorkerSharedSecret:            "worker-secret",
		DefaultActorID:                "runtime-bearer-user",
		OpenCapabilities:              []string{"campus_services"},
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
			"user_goal":"2026-05-07 今天丰台到海淀通勤车乘车点有没有调整",
			"request_id":"req-multi-step-bridge-error",
			"requested_capability":"campus_services",
			"context":{
				"actor":{"user_id":"student-1","principal_id":"student-1","principal_type":"student","roles":["student"]},
				"authorization":{"retrieval_filter":{"entitlement_groups":[],"visibility_level":"public","policy_projection_version":"phase1-authorization-projection-v1"}},
				"session":{"selected_notice_ref":{"notice_id":"353903","source_family":"internal_notice_restricted","title":"关于通勤班车丰台校区乘车点调整的通知","target_surface":"campus_services/service_status_candidate"},"turn_count":2}
			}
		}`),
	)
	request.Header.Set("x-worker-origin-auth", "worker-secret")
	response := httptest.NewRecorder()

	server.ServeHTTP(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, want bridge response status 200; body: %s", response.Code, response.Body.String())
	}
	body := decodeBody(t, response)
	if body["status"] != "error" {
		t.Fatalf("status = %v, want bridge step error", body["status"])
	}
	errorBody := expectRecord(t, body["error"], "error")
	if errorBody["code"] != "agents_sdk_runtime_failed" {
		t.Fatalf("error.code = %v, want agents_sdk_runtime_failed", errorBody["code"])
	}
	if strings.Contains(response.Body.String(), "supervisor_multistep_artifact_incomplete") {
		t.Fatalf("bridge step error was masked by supervisor artifact error: %s", response.Body.String())
	}
	storedRun, err := server.workflowRuns.Get(
		context.Background(),
		"workflow:req-multi-step-bridge-error",
	)
	if err != nil {
		t.Fatalf("workflow run missing: %v", err)
	}
	if storedRun.State != execution.WorkflowStateFailed {
		t.Fatalf("workflow run state = %v, want failed", storedRun.State)
	}
}

func TestTransportScheduleProjectionSummaryUsesStructuredResultNotAgentAnswerText(t *testing.T) {
	response := bridge.ExecuteResponse{
		StatusCode: http.StatusOK,
		Kind:       "agent_response",
		Body: json.RawMessage(`{
			"target":"campus-services-agent",
			"status":"completed",
			"answer_text":"[transport_schedule_temporal_lookup] Mock Agents SDK completed transport_schedule_lookup for campus-services-agent: {\"raw\":\"must not enter projection summary\"}",
			"follow_up_question":"",
			"confidence":"medium",
			"result":{
				"outcome":"resolved_current",
				"query_text":"2026-05-07 今天丰台到海淀通勤车乘车点有没有调整",
				"intent":"service_window",
				"service_status":"running",
				"requested_service_date":"2026-05-07",
				"queried_time_anchor":"2026-05-07T08:00:00+08:00",
				"source_ref_count":2,
				"related_notice_refs":["notice:353903"],
				"resolved_route":{
					"route_id":"route:fengtai-to-haidian",
					"display_name":"丰台到海淀通勤车",
					"service_family":"intercampus_commute"
				}
			},
			"agent_observability":{"selected_tool":"transport_schedule_lookup"}
		}`),
	}

	projections := workflowProjectionsFromBridgeResponse(
		execution.RuntimeHandoff{
			Target:      "campus-services-agent",
			PayloadKind: "transport_schedule_lookup",
		},
		"handoff:campus-services-agent:transport_schedule_lookup",
		response,
	)

	if len(projections) != 1 {
		t.Fatalf("projections = %#v, want one schedule baseline projection", projections)
	}
	summary := projections[0].ScheduleSummary()
	if strings.Contains(summary, "Mock Agents SDK completed") ||
		strings.Contains(summary, "must not enter projection summary") {
		t.Fatalf("schedule baseline summary leaked agent answer text: %q", summary)
	}
	for _, want := range []string{"丰台到海淀通勤车", "运行状态 running", "服务日期 2026-05-07"} {
		if !strings.Contains(summary, want) {
			t.Fatalf("schedule baseline summary = %q, want %q", summary, want)
		}
	}
}

func TestValidateWorkflowStepArtifactsRequiresExpectedProjectionKinds(t *testing.T) {
	handoff := execution.RuntimeHandoff{
		Target:            "rag-agent",
		PayloadKind:       "rag_request",
		ExpectedArtifacts: []string{"evidence_bundle", "grounding_verdict"},
	}
	projection, ok := execution.NewEvidenceBundleProjection(
		"handoff:rag-agent:rag_request",
		"regulations",
		"student_rules",
		"这条通知依据学生手册哪条规定？",
		[]string{"handbook:rule-001"},
	)
	if !ok {
		t.Fatal("expected evidence bundle projection")
	}

	err := validateWorkflowStepArtifacts(handoff, []execution.StepOutputProjection{projection})
	if err == nil || !strings.Contains(err.Error(), "grounding_verdict") {
		t.Fatalf("validateWorkflowStepArtifacts error = %v, want missing grounding_verdict", err)
	}
}
