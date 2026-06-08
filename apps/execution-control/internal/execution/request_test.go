package execution

import (
	"encoding/json"
	"testing"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/config"
)

func TestParseAnswerRequestProjectsBearerRequestIntoBridgePayload(t *testing.T) {
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
	if request.Lane != "rag" {
		t.Fatalf("lane = %q, want rag", request.Lane)
	}

	payload := decodeExecutionPayload(t, request.Payload)
	if payload["conversation_id"] != "conv-001" {
		t.Fatalf("conversation_id = %v, want conv-001", payload["conversation_id"])
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
				"profile_memory":{
					"items":[
						{
							"item_id":"memory-001",
							"key":"recent_goal",
							"value":"咨询保研"
						}
					]
				},
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
	profileMemory := expectExecutionRecord(t, contextRecord["profile_memory"], "context.profile_memory")
	items, ok := profileMemory["items"].([]any)
	if !ok || len(items) != 1 {
		t.Fatalf("profile_memory.items = %#v, want length 1", profileMemory["items"])
	}
	session := expectExecutionRecord(t, contextRecord["session"], "context.session")
	if session["turn_count"] != float64(2) {
		t.Fatalf("turn_count = %v, want 2", session["turn_count"])
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
	}
	if httpErr.Code != "invalid_request" {
		t.Fatalf("error code = %q, want invalid_request", httpErr.Code)
	}
}

func TestParseAnswerRequestMapsForwardCapabilitiesToExecutionLanes(t *testing.T) {
	tests := []struct {
		name       string
		capability string
		wantLane   string
	}{
		{name: "campus services", capability: "campus_services", wantLane: "campus_services"},
		{name: "notice", capability: "notice", wantLane: "notice"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			request, httpErr := ParseAnswerRequest(
				json.RawMessage(`{
					"user_goal":"校车时刻表",
					"request_id":"req-forward-capability",
					"requested_capability":"`+tt.capability+`"
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
			if request.Lane != tt.wantLane {
				t.Fatalf("lane = %q, want %q", request.Lane, tt.wantLane)
			}
			payload := decodeExecutionPayload(t, request.Payload)
			if payload["requested_capability"] != tt.capability {
				t.Fatalf("requested_capability = %v, want %q", payload["requested_capability"], tt.capability)
			}
		})
	}
}

func TestParseAnswerRequestRejectsRetiredAcademicCalendarCapability(t *testing.T) {
	_, httpErr := ParseAnswerRequest(
		json.RawMessage(`{
			"user_goal":"今天第几教学周",
			"request_id":"req-retired-academic-calendar",
			"requested_capability":"academic_calendar"
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
		t.Fatal("expected retired academic_calendar capability to fail closed")
	}
	if httpErr.Code != "invalid_request" {
		t.Fatalf("error code = %q, want invalid_request", httpErr.Code)
	}
}

func TestParseAnswerRequestInfersEffectiveCapabilityForUnscopedCurrentRequests(t *testing.T) {
	tests := []struct {
		name           string
		userGoal       string
		wantCapability string
		wantLane       string
	}{
		{
			name:           "place lookup",
			userGoal:       "图书馆在哪里",
			wantCapability: "place_lookup",
			wantLane:       "navigation",
		},
		{
			name:           "transport schedule",
			userGoal:       "我明天早上要去丰台上课，最早的班车是几点",
			wantCapability: "campus_services",
			wantLane:       "campus_services",
		},
		{
			name:           "public medical service guide",
			userGoal:       "公费医疗报销需要什么材料",
			wantCapability: "campus_services",
			wantLane:       "campus_services",
		},
		{
			name:           "public medical contact service guide",
			userGoal:       "公费医疗报销联系电话是多少",
			wantCapability: "campus_services",
			wantLane:       "campus_services",
		},
		{
			name:           "academic calendar teaching week",
			userGoal:       "今天第几教学周",
			wantCapability: "campus_services",
			wantLane:       "campus_services",
		},
		{
			name:           "notice discovery",
			userGoal:       "找一下春假通知",
			wantCapability: "notice",
			wantLane:       "notice",
		},
		{
			name:           "non spatial where action",
			userGoal:       "奖学金在哪里申请",
			wantCapability: "knowledge",
			wantLane:       "rag",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			rawBody, err := json.Marshal(map[string]string{
				"user_goal":  tt.userGoal,
				"request_id": "req-infer-capability",
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
			if request.RequestedCapability != tt.wantCapability {
				t.Fatalf("requested capability = %q, want %q", request.RequestedCapability, tt.wantCapability)
			}
			if request.Lane != tt.wantLane {
				t.Fatalf("lane = %q, want %q", request.Lane, tt.wantLane)
			}
			payload := decodeExecutionPayload(t, request.Payload)
			if payload["requested_capability"] != tt.wantCapability {
				t.Fatalf("projected requested_capability = %v, want %q", payload["requested_capability"], tt.wantCapability)
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
