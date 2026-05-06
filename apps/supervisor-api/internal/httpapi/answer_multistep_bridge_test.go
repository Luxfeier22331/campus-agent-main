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

func TestAnswerExecutesTransportNoticeKnowledgePilotWorkflow(t *testing.T) {
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
			case "campus-services-agent":
				return bridge.ExecuteResponse{
					StatusCode: http.StatusOK,
					Kind:       "agent_response",
					Body: json.RawMessage(`{
						"target":"campus-services-agent",
						"status":"completed",
						"answer_text":"两校区学生通勤班车当前正常运行，最近一班 06:50 发车。",
						"confidence":"high",
						"result":{
							"query_text":"这条班车通知依据学生手册哪条规定？",
							"intent":"next_departure",
							"outcome":"resolved_current",
							"resolved_route":{
								"route_id":"route:intercampus:student",
								"display_name":"两校区学生通勤班车",
								"service_family":"intercampus_commute"
							},
							"selected_departure":{"departure_at":"2026-03-18T06:50:00+08:00"},
							"related_notice_refs":["notice:muc_internal_portal:355122"]
						},
						"agent_observability":{"selected_tool":"transport_schedule_lookup"}
					}`),
				}, nil
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
							"title":"关于两校区学生通勤班车增加班次的通知",
							"body_excerpt":"自 3 月 18 日起增加若干学生通勤班车班次。",
							"source_url":"https://example.invalid/notices/355122",
							"source_refs":["notice:muc_internal_portal:355122"]
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
						"answer_text":"请说明你想确认班车通知对应的哪一项学生规则。",
						"follow_up_question":"请说明你想确认班车通知对应的哪一项学生规则。",
						"confidence":"low",
						"result":{
							"evidence":{
								"corpus":"regulations",
								"collection":"student_rules",
								"query_text":"这条班车通知依据学生手册哪条规定？",
								"sources":[{"doc_id":"student-rules:traffic-order-001","source_title":"学生交通秩序规则"}]
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
			"user_goal":"这条班车通知依据学生手册哪条规定？",
			"request_id":"req-multi-step-transport-notice-knowledge",
			"requested_capability":"campus_services",
			"requested_scope":{"corpus":"regulations","collection":"student_rules"},
			"context":{
				"actor":{"user_id":"student-1","principal_id":"student-1","principal_type":"student","roles":["student"]},
				"authorization":{"retrieval_filter":{"entitlement_groups":[],"visibility_level":"public","policy_projection_version":"phase1-authorization-projection-v1"}},
				"session":{"selected_notice_ref":{"notice_id":"notice:transport:355122","source_family":"internal_notice_restricted","title":"关于两校区学生通勤班车增加班次的通知"},"turn_count":2}
			}
		}`),
	)
	request.Header.Set("x-worker-origin-auth", "worker-secret")
	response := httptest.NewRecorder()

	server.ServeHTTP(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body: %s", response.Code, response.Body.String())
	}
	if len(seenTargets) != 3 ||
		seenTargets[0] != "campus-services-agent" ||
		seenTargets[1] != "notice-agent" ||
		seenTargets[2] != "rag-agent" {
		t.Fatalf(
			"seen targets = %#v, want campus-services-agent -> notice-agent -> rag-agent; body: %s",
			seenTargets,
			response.Body.String(),
		)
	}
	if !strings.Contains(ragUserGoal, "已读取的班车基线") ||
		!strings.Contains(ragUserGoal, "两校区学生通勤班车") ||
		!strings.Contains(ragUserGoal, "已读取的通知上下文") {
		t.Fatalf("rag user_goal did not include projected context: %q", ragUserGoal)
		}
		body := decodeBody(t, response)
		if body["status"] != "needs_clarification" {
			t.Fatalf("status = %v, want needs_clarification", body["status"])
		}
		traceSummary := expectRecord(t, body["workflow_trace_summary"], "workflow_trace_summary")
		if traceSummary["workflow_mode"] != "multi_step" {
			t.Fatalf("workflow_mode = %v, want multi_step", traceSummary["workflow_mode"])
	}
	selectedTools, ok := traceSummary["selected_tools"].([]any)
	if !ok ||
		len(selectedTools) != 2 ||
		selectedTools[0] != "transport_schedule_lookup" ||
		selectedTools[1] != "retrieval.query" {
		t.Fatalf(
			"selected_tools = %#v, want transport_schedule_lookup then retrieval.query",
			traceSummary["selected_tools"],
		)
	}
	toolCallSummaries, ok := traceSummary["tool_call_summaries"].([]any)
	if !ok || len(toolCallSummaries) != 2 {
		t.Fatalf(
			"tool_call_summaries = %#v, want transport + rag bounded summaries",
			traceSummary["tool_call_summaries"],
		)
	}
	transportToolCall := expectRecord(t, toolCallSummaries[0], "tool_call_summaries[0]")
	if transportToolCall["tool_name"] != "transport_schedule_lookup" ||
		transportToolCall["result_status"] != "completed" {
		t.Fatalf(
			"tool_call_summaries[0] = %#v, want completed transport_schedule_lookup",
			transportToolCall,
		)
	}
	ragToolCall := expectRecord(t, toolCallSummaries[1], "tool_call_summaries[1]")
	if ragToolCall["tool_name"] != "retrieval.query" ||
		ragToolCall["result_status"] != "needs_clarification" {
		t.Fatalf(
			"tool_call_summaries[1] = %#v, want needs_clarification retrieval.query",
			ragToolCall,
		)
	}
	handoffChain, ok := traceSummary["handoff_chain"].([]any)
	if !ok || len(handoffChain) != 3 {
		t.Fatalf("handoff_chain = %#v, want three handoffs", traceSummary["handoff_chain"])
	}
	contextProjections, ok := traceSummary["context_projections"].([]any)
	if !ok || len(contextProjections) != 4 {
		t.Fatalf(
			"context_projections = %#v, want schedule + notice + rag projections",
			traceSummary["context_projections"],
		)
	}
	firstProjection := expectRecord(t, contextProjections[0], "context_projections[0]")
	secondProjection := expectRecord(t, contextProjections[1], "context_projections[1]")
	thirdProjection := expectRecord(t, contextProjections[2], "context_projections[2]")
	fourthProjection := expectRecord(t, contextProjections[3], "context_projections[3]")
	if firstProjection["projection_kind"] != "schedule_baseline" ||
		secondProjection["projection_kind"] != "notice_context" {
		t.Fatalf("context projections = %#v, %#v, want schedule_baseline then notice_context", firstProjection, secondProjection)
	}
	if thirdProjection["projection_kind"] != "evidence_bundle" ||
		fourthProjection["projection_kind"] != "grounding_verdict" {
		t.Fatalf(
			"context projections = %#v, %#v, want rag evidence_bundle then grounding_verdict",
			thirdProjection,
			fourthProjection,
		)
	}
	agentInvocations, ok := traceSummary["agent_invocations"].([]any)
	if !ok || len(agentInvocations) != 3 {
		t.Fatalf("agent_invocations = %#v, want three invocation graph nodes", traceSummary["agent_invocations"])
	}
	ragInvocation := expectRecord(t, agentInvocations[2], "agent_invocations[2]")
	projectionIDs, ok := ragInvocation["projection_ids"].([]any)
		if !ok ||
			len(projectionIDs) != 2 ||
			projectionIDs[0] != firstProjection["projection_id"] ||
			projectionIDs[1] != secondProjection["projection_id"] {
			t.Fatalf(
				"rag projection_ids = %#v, want consumed schedule + notice projection ids",
				ragInvocation["projection_ids"],
			)
		}
		storedRun, err := server.workflowRuns.Get(
			context.Background(),
			"workflow:req-multi-step-transport-notice-knowledge",
		)
		if err != nil {
			t.Fatalf("workflow run missing: %v", err)
		}
		if storedRun.State != execution.WorkflowStateCompleted {
			t.Fatalf("workflow run state = %v, want completed terminal state", storedRun.State)
		}
		if len(storedRun.ContextProjections) != 4 {
			t.Fatalf(
				"stored context projections = %#v, want schedule + notice + rag bounded projections",
				storedRun.ContextProjections,
			)
		}
	}
