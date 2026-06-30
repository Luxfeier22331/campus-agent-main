package execution

import (
	"encoding/json"
	"testing"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/config"
)

func TestParseAnswerRequestProjectsBearerRequestIntoExecutionPayload(t *testing.T) {
	request, httpErr := ParseAnswerRequest(
		json.RawMessage(`{
			"user_goal":"library hours",
			"conversation_id":"conv-001",
			"request_id":"req-001",
			"safety_identifier":"0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
			"requested_scope":{"corpus":"regulations","collection":"student_rules"}
		}`),
		map[string]string{
			"authorization": "Bearer secret-token",
			"x-trace-id":    "trace-001",
		},
		config.Config{
			AuthMode:          "bearer",
			BearerToken:       "secret-token",
			DefaultActorID:    "api-bearer-user",
			DefaultActorRoles: []string{"student"},
		},
	)

	if httpErr != nil {
		t.Fatalf("unexpected http error: %#v", httpErr)
	}
	if request.TraceID != "trace-001" {
		t.Fatalf("trace id = %q, want trace-001", request.TraceID)
	}
	if request.RequestID != "req-001" {
		t.Fatalf("request id = %q, want req-001", request.RequestID)
	}
	if request.TaskQueue != "campus-agent.workflow" {
		t.Fatalf("task_queue = %q, want campus-agent.workflow", request.TaskQueue)
	}

	payload := decodeExecutionPayload(t, request.Payload)
	if payload["conversation_id"] != "conv-001" {
		t.Fatalf("conversation_id = %v, want conv-001", payload["conversation_id"])
	}
	if request.ConversationID != "conv-001" {
		t.Fatalf("request conversation id = %q, want conv-001", request.ConversationID)
	}
	if request.OwnerUserID != "api-bearer-user" {
		t.Fatalf("request owner user id = %q, want api-bearer-user", request.OwnerUserID)
	}
	contextRecord := expectExecutionRecord(t, payload["context"], "context")
	actorRecord := expectExecutionRecord(t, contextRecord["actor"], "context.actor")
	if actorRecord["user_id"] != "api-bearer-user" {
		t.Fatalf("context.actor.user_id = %v, want api-bearer-user", actorRecord["user_id"])
	}
	authorizationRecord := expectExecutionRecord(t, contextRecord["authorization"], "context.authorization")
	retrievalFilter := expectExecutionRecord(
		t,
		authorizationRecord["retrieval_filter"],
		"context.authorization.retrieval_filter",
	)
	if retrievalFilter["visibility_level"] != "public" {
		t.Fatalf("visibility_level = %v, want public", retrievalFilter["visibility_level"])
	}
}

func TestParseAnswerRequestRejectsMissingRequestID(t *testing.T) {
	_, httpErr := ParseAnswerRequest(
		json.RawMessage(`{"user_goal":"library hours"}`),
		map[string]string{
			"authorization": "Bearer secret-token",
		},
		config.Config{
			AuthMode:       "bearer",
			BearerToken:    "secret-token",
			DefaultActorID: "api-bearer-user",
		},
	)

	if httpErr == nil {
		t.Fatal("expected missing request_id to fail")
		return
	}
	if httpErr.Status != 400 || httpErr.Code != "missing_request_id" {
		t.Fatalf("unexpected error = %#v", httpErr)
	}
}

func TestParseAnswerRequestRejectsMissingBearerToken(t *testing.T) {
	_, httpErr := ParseAnswerRequest(
		json.RawMessage(`{"user_goal":"library hours"}`),
		map[string]string{},
		config.Config{
			AuthMode:       "bearer",
			BearerToken:    "secret-token",
			DefaultActorID: "api-bearer-user",
		},
	)

	if httpErr == nil {
		t.Fatal("expected missing bearer token to fail")
		return
	}
	if httpErr.Status != 401 || httpErr.Code != "unauthorized" {
		t.Fatalf("unexpected error = %#v", httpErr)
	}
}

func TestParseAnswerRequestRejectsUnconfiguredBearerAuth(t *testing.T) {
	_, httpErr := ParseAnswerRequest(
		json.RawMessage(`{"user_goal":"library hours","request_id":"req-unconfigured-bearer"}`),
		map[string]string{
			"authorization": "Bearer arbitrary-token",
		},
		config.Config{
			AuthMode:       "bearer",
			DefaultActorID: "api-bearer-user",
		},
	)

	if httpErr == nil {
		t.Fatal("expected unconfigured bearer auth to fail closed")
		return
	}
	if httpErr.Status != 500 || httpErr.Code != "auth_not_configured" {
		t.Fatalf("unexpected error = %#v", httpErr)
	}
}

func TestParseAnswerRequestRejectsUnsupportedActorFieldsInTrustedWorkerContext(t *testing.T) {
	_, httpErr := ParseAnswerRequest(
		json.RawMessage(`{
			"user_goal":"test",
			"context":{
				"actor":{
					"user_id":"student@example.edu",
					"groups":["students"]
				},
				"authorization":{
					"retrieval_filter":{
						"entitlement_groups":[],
						"visibility_level":"public",
						"policy_projection_version":"phase1-authorization-projection-v1"
					}
				}
			}
		}`),
		map[string]string{
			"x-worker-origin-auth": "worker-secret",
		},
		config.Config{
			AuthMode:           "trusted-worker",
			WorkerSharedSecret: "worker-secret",
		},
	)

	if httpErr == nil {
		t.Fatal("expected unsupported actor fields to fail")
		return
	}
	if httpErr.Code != "invalid_request" {
		t.Fatalf("error code = %q, want invalid_request", httpErr.Code)
	}
	if httpErr.Message == "" || httpErr.Message == "invalid_request" {
		t.Fatalf("unexpected message = %q", httpErr.Message)
	}
}

func TestParseAnswerRequestRejectsTrustedWorkerRequestsWithoutContext(t *testing.T) {
	_, httpErr := ParseAnswerRequest(
		json.RawMessage(`{"user_goal":"test"}`),
		map[string]string{
			"x-worker-origin-auth": "worker-secret",
		},
		config.Config{
			AuthMode:           "trusted-worker",
			WorkerSharedSecret: "worker-secret",
		},
	)

	if httpErr == nil {
		t.Fatal("expected trusted-worker request without context to fail")
		return
	}
	if httpErr.Code != "invalid_request" {
		t.Fatalf("error code = %q, want invalid_request", httpErr.Code)
	}
}

func TestParseAnswerRequestProjectsTrustedWorkerContext(t *testing.T) {
	request, httpErr := ParseAnswerRequest(
		json.RawMessage(`{
			"user_goal":"保研政策怎么准备？",
			"request_id":"req-trusted-worker-001",
			"requested_scope":{"corpus":"regulations","collection":"student_rules"},
			"context":{
				"actor":{
					"user_id":"student@example.edu",
					"principal_id":"principal-001",
					"principal_type":"student",
					"roles":["student"]
				},
				"authorization":{
					"principal_id":"principal-001",
					"entitlement_groups":["students","library"],
					"visibility_scope":"north",
					"retrieval_filter":{
						"entitlement_groups":["students","library"],
						"visibility_level":"public",
						"visibility_scope":"north",
						"policy_projection_version":"phase1-authorization-projection-v1"
					}
				},
				"memory":{"enabled":false},
				"session":{
					"confirmed_slots":[
						{"name":"policy_topic","value":"推免资格","confirmed":true}
					],
					"turn_count":2
				}
			}
		}`),
		map[string]string{
			"x-worker-origin-auth": "worker-secret",
			"x-trace-id":           "trace-worker-1",
		},
		config.Config{
			AuthMode:           "trusted-worker",
			WorkerSharedSecret: "worker-secret",
		},
	)

	if httpErr != nil {
		t.Fatalf("unexpected http error: %#v", httpErr)
	}

	payload := decodeExecutionPayload(t, request.Payload)
	if payload["user_goal"] != "保研政策怎么准备？" {
		t.Fatalf("user_goal = %v", payload["user_goal"])
	}
	if payload["requested_scope"] == nil {
		t.Fatal("expected requested_scope to be projected")
	}
	contextRecord := expectExecutionRecord(t, payload["context"], "context")
	if _, ok := contextRecord["profile_memory"]; ok {
		t.Fatal("context.profile_memory must not be projected; memory recall is Temporal-owned")
	}
	memory := expectExecutionRecord(t, contextRecord["memory"], "context.memory")
	if memory["enabled"] != false {
		t.Fatalf("context.memory.enabled = %v, want false", memory["enabled"])
	}
	session := expectExecutionRecord(t, contextRecord["session"], "context.session")
	if session["turn_count"] != float64(2) {
		t.Fatalf("turn_count = %v, want 2", session["turn_count"])
	}
}

func TestParseAnswerRequestProjectsTrustedWorkerConversationContext(t *testing.T) {
	request, httpErr := ParseAnswerRequest(
		json.RawMessage(`{
			"user_goal":"那大一能不能申请？",
			"conversation_id":"conv_transfer_001",
			"request_id":"req-trusted-worker-conversation-context",
			"requested_tool":"knowledge_query",
			"tenant_id":"tenant-main",
			"context":{
				"actor":{
					"user_id":"student@example.edu",
					"principal_id":"principal-001",
					"principal_type":"student",
					"roles":["student"]
				},
				"authorization":{
					"principal_id":"principal-001",
					"entitlement_groups":["students"],
					"retrieval_filter":{
						"entitlement_groups":["students"],
						"visibility_level":"public",
						"policy_projection_version":"phase1-authorization-projection-v1"
					}
				},
				"memory":{"enabled":true},
				"session":{
					"confirmed_slots":[
						{"name":"policy_topic","value":"转专业","confirmed":true}
					],
					"turn_count":3
				},
				"conversation":{
					"schema_version":"conversation_context.v1",
					"conversation_id":"conv_transfer_001",
					"user_message_id":"msg_user_003",
					"parent_message_id":"msg_assistant_002",
					"current_user_message":{"role":"user","content":"那大一能不能申请？","created_at":"2026-06-21T00:00:12Z"},
					"recent_turns":[
						{"role":"user","message_id":"msg_user_001","content":"转专业条件是什么？","created_at":"2026-06-21T00:00:00Z"},
						{"role":"assistant","message_id":"msg_assistant_002","summary":"上一轮回答的是转专业申请条件。","created_at":"2026-06-21T00:00:08Z"}
					],
					"previous_answer_summary":"上一轮围绕转专业申请条件回答。",
					"previous_evidence_refs":[
						{
							"evidence_id":"ev_transfer_rule_01",
							"source_id":"regulations/student_rules/transfer-major/v2026",
							"document_id":"transfer-major-policy",
							"version_id":"rule-transfer-major-2026",
							"snapshot_id":"student-rules-current-2026-06-21",
							"content_hash":"sha256:transfer-major-evidence-example",
							"source_kind":"regulation",
							"collection":"regulations/student_rules",
							"evidence_role":"condition",
							"access_scope":"public_student_rule",
							"title":"本科生转专业管理办法",
							"section_title":"申请条件",
							"snippet":"学生申请转专业应符合学校规定的年级、成绩、名额及学院审核要求。"
						}
					],
					"previous_tool_results":[
						{
							"request_id":"req_previous_services",
							"run_id":"run_previous_services",
							"tool":"transport_schedule_lookup",
							"result_kind":"final_response",
							"projection_ref":"projection://runs/run_previous_services/finalization",
							"content_hash":"sha256:previous-service-result",
							"status":"completed",
							"summary":"上一轮查询了图书馆开放状态。"
						}
					],
					"session_state":{"confirmed_slots":[{"name":"policy_topic","value":"转专业","confirmed":true}],"turn_count":3},
					"visibility":{
						"model_visible":["current_user_message","recent_turns","previous_answer_summary","previous_evidence_refs","previous_tool_results","session_state"],
						"runtime_only":["schema_version","conversation_id","user_message_id","parent_message_id","memory_recall","source_attribution","budget","truncation"]
					},
					"memory_recall":{"gate_field":"context.memory.enabled","owner":"execution-control","runtime":"hindsight"},
					"source_attribution":[{"item":"previous_evidence_refs[0]","source":"runtime step/result projection","model_visible":true}],
					"context_summary":null,
					"budget":{"token_estimate":320,"recent_turn_limit":6},
					"truncation":null
				}
			}
		}`),
		map[string]string{
			"x-worker-origin-auth": "worker-secret",
			"x-trace-id":           "trace-worker-conversation-context",
		},
		config.Config{
			AuthMode:           "trusted-worker",
			WorkerSharedSecret: "worker-secret",
		},
	)

	if httpErr != nil {
		t.Fatalf("unexpected http error: %#v", httpErr)
	}

	payload := decodeExecutionPayload(t, request.Payload)
	contextRecord := expectExecutionRecord(t, payload["context"], "context")
	conversation := expectExecutionRecord(t, contextRecord["conversation"], "context.conversation")
	if conversation["schema_version"] != "conversation_context.v1" {
		t.Fatalf("schema_version = %v", conversation["schema_version"])
	}
	if conversation["conversation_id"] != "conv_transfer_001" {
		t.Fatalf("conversation_id = %v", conversation["conversation_id"])
	}
	evidenceRefs, ok := conversation["previous_evidence_refs"].([]any)
	if !ok || len(evidenceRefs) != 1 {
		t.Fatalf("previous_evidence_refs = %#v, want one ref", conversation["previous_evidence_refs"])
	}
	toolResults, ok := conversation["previous_tool_results"].([]any)
	if !ok || len(toolResults) != 1 {
		t.Fatalf("previous_tool_results = %#v, want one ref", conversation["previous_tool_results"])
	}
	result := expectExecutionRecord(t, toolResults[0], "previous_tool_results[0]")
	if result["projection_ref"] != "projection://runs/run_previous_services/finalization" {
		t.Fatalf("projection_ref = %v", result["projection_ref"])
	}
}

func TestParseAnswerRequestRejectsConversationContextIdentityMismatch(t *testing.T) {
	_, httpErr := ParseAnswerRequest(
		json.RawMessage(`{
			"user_goal":"那大一能不能申请？",
			"conversation_id":"conv_outer",
			"request_id":"req-trusted-worker-conversation-mismatch",
			"context":{
				"actor":{"user_id":"student@example.edu","principal_id":"principal-001"},
				"authorization":{"principal_id":"principal-001"},
				"session":{"confirmed_slots":[],"turn_count":1},
				"conversation":{
					"schema_version":"conversation_context.v1",
					"conversation_id":"conv_inner",
					"user_message_id":"msg_user_003",
					"current_user_message":{"role":"user","content":"那大一能不能申请？","created_at":"2026-06-21T00:00:12Z"},
					"recent_turns":[],
					"previous_evidence_refs":[],
					"previous_tool_results":[],
					"session_state":{"confirmed_slots":[],"turn_count":1},
					"visibility":{"model_visible":["current_user_message"],"runtime_only":["budget"]},
					"memory_recall":{"gate_field":"context.memory.enabled","owner":"execution-control","runtime":"hindsight"},
					"source_attribution":[],
					"context_summary":null,
					"budget":{"token_estimate":8,"recent_turn_limit":6},
					"truncation":null
				}
			}
		}`),
		map[string]string{
			"x-worker-origin-auth": "worker-secret",
		},
		config.Config{
			AuthMode:           "trusted-worker",
			WorkerSharedSecret: "worker-secret",
		},
	)

	if httpErr == nil {
		t.Fatal("expected conversation identity mismatch to fail")
		return
	}
	if httpErr.Code != "invalid_request" {
		t.Fatalf("error code = %q, want invalid_request", httpErr.Code)
	}
}

func TestParseAnswerRequestRejectsLegacyProfileMemoryContext(t *testing.T) {
	_, httpErr := ParseAnswerRequest(
		json.RawMessage(`{
			"user_goal":"保研政策怎么准备？",
			"request_id":"req-trusted-worker-legacy-memory",
			"context":{
				"actor":{"user_id":"student@example.edu","principal_id":"principal-001"},
				"authorization":{"principal_id":"principal-001"},
				"profile_memory":{"items":[]},
				"session":{"confirmed_slots":[],"turn_count":1}
			}
		}`),
		map[string]string{
			"x-worker-origin-auth": "worker-secret",
		},
		config.Config{
			AuthMode:           "trusted-worker",
			WorkerSharedSecret: "worker-secret",
		},
	)

	if httpErr == nil {
		t.Fatal("expected legacy context.profile_memory to be rejected")
		return
	}
	if httpErr.Code != "invalid_request" {
		t.Fatalf("error code = %q, want invalid_request", httpErr.Code)
	}
}

func TestParseAnswerRequestRejectsInvalidSafetyIdentifier(t *testing.T) {
	_, httpErr := ParseAnswerRequest(
		json.RawMessage(`{"user_goal":"library hours","request_id":"req-invalid-safety","safety_identifier":"not-sha"}`),
		map[string]string{
			"authorization": "Bearer secret-token",
		},
		config.Config{
			AuthMode:       "bearer",
			BearerToken:    "secret-token",
			DefaultActorID: "api-bearer-user",
		},
	)

	if httpErr == nil {
		t.Fatal("expected invalid safety identifier to fail")
		return
	}
	if httpErr.Code != "invalid_request" {
		t.Fatalf("error code = %q, want invalid_request", httpErr.Code)
	}
}

func TestParseAnswerRequestMapsForwardToolHintsToTaskQueues(t *testing.T) {
	tests := []struct {
		name       string
		toolTarget string
		wantQueue  string
	}{
		{name: "campus services", toolTarget: "transport_schedule_lookup", wantQueue: "campus-agent.workflow"},
		{name: "notice", toolTarget: "campus_notice_discover", wantQueue: "campus-agent.workflow"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			request, httpErr := ParseAnswerRequest(
				json.RawMessage(`{
					"user_goal":"校车时刻表",
					"request_id":"req-forward-tool",
					"requested_tool":"`+tt.toolTarget+`"
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
			if request.TaskQueue != tt.wantQueue {
				t.Fatalf("task_queue = %q, want %q", request.TaskQueue, tt.wantQueue)
			}
			payload := decodeExecutionPayload(t, request.Payload)
			if payload["requested_tool"] != tt.toolTarget {
				t.Fatalf("requested_tool = %v, want %q", payload["requested_tool"], tt.toolTarget)
			}
		})
	}
}

func TestParseAnswerRequestRejectsRetiredAcademicCalendarTool(t *testing.T) {
	_, httpErr := ParseAnswerRequest(
		json.RawMessage(`{
			"user_goal":"今天第几教学周",
			"request_id":"req-retired-academic-calendar",
			"requested_tool":"academic_calendar"
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

	if httpErr == nil {
		t.Fatal("expected retired academic_calendar tool to fail closed")
		return
	}
	if httpErr.Code != "invalid_request" {
		t.Fatalf("error code = %q, want invalid_request", httpErr.Code)
	}
}

func TestParseAnswerRequestRejectsClosedNoticeToolsAsCallerHints(t *testing.T) {
	for _, toolName := range []string{
		"campus_notice_change_set_lookup",
		"campus_notice_period_summary",
	} {
		t.Run(toolName, func(t *testing.T) {
			_, httpErr := ParseAnswerRequest(
				json.RawMessage(`{
					"user_goal":"最近校车通知有哪些变化",
					"request_id":"req-closed-notice-tool",
					"requested_tool":"`+toolName+`"
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

			if httpErr == nil {
				t.Fatal("expected closed notice tool caller hint to fail closed")
				return
			}
			if httpErr.Code != "invalid_request" {
				t.Fatalf("error code = %q, want invalid_request", httpErr.Code)
			}
		})
	}
}

func TestParseAnswerRequestKeepsOrdinaryChatToolNeutralBeforePrimaryAgent(t *testing.T) {
	tests := []struct {
		name     string
		userGoal string
	}{
		{
			name:     "place lookup is not pre-routed",
			userGoal: "图书馆在哪里",
		},
		{
			name:     "transport schedule is not pre-routed",
			userGoal: "我明天早上要去丰台上课，最早的班车是几点",
		},
		{
			name:     "public medical service guide is not pre-routed",
			userGoal: "公费医疗报销需要什么材料",
		},
		{
			name:     "academic calendar is not pre-routed",
			userGoal: "今天第几教学周",
		},
		{
			name:     "notice discovery is not pre-routed",
			userGoal: "找一下春假通知",
		},
		{
			name:     "knowledge-like question is not defaulted",
			userGoal: "奖学金在哪里申请",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			rawBody, err := json.Marshal(map[string]string{
				"user_goal":  tt.userGoal,
				"request_id": "req-infer-tool",
			})
			if err != nil {
				t.Fatalf("marshal body: %v", err)
			}
			request, httpErr := ParseAnswerRequest(
				rawBody,
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
			if request.RequestedTool != "" {
				t.Fatalf("requested tool = %q, want empty before primary agent", request.RequestedTool)
			}
			if request.TaskQueue != "campus-agent.workflow" {
				t.Fatalf("task_queue = %q, want campus-agent.workflow before primary agent", request.TaskQueue)
			}
			payload := decodeExecutionPayload(t, request.Payload)
			if _, ok := payload["requested_tool"]; ok {
				t.Fatalf("ordinary chat must not project requested_tool before primary agent: %#v", payload)
			}
			if payload["effective_tool"] != "" {
				t.Fatalf("effective_tool = %v, want empty before primary agent", payload["effective_tool"])
			}
		})
	}
}

func decodeExecutionPayload(t *testing.T, payload json.RawMessage) map[string]any {
	t.Helper()

	var decoded map[string]any
	if err := json.Unmarshal(payload, &decoded); err != nil {
		t.Fatalf("payload is not valid JSON: %v", err)
	}
	return decoded
}

func expectExecutionRecord(t *testing.T, value any, name string) map[string]any {
	t.Helper()

	record, ok := value.(map[string]any)
	if !ok {
		t.Fatalf("%s missing or wrong type: %#v", name, value)
	}
	return record
}
