package execution

import (
	"encoding/json"
	"testing"

	"github.com/MUC-WIKI/campus-agent/apps/supervisor-api/internal/config"
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

func TestParseAnswerRequestProjectsBridgeV2RuntimeDecisionsForTransportSchedule(t *testing.T) {
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
	if payload["bridge_version"] != "supervisor_bridge_v2" {
		t.Fatalf("bridge_version = %v, want supervisor_bridge_v2", payload["bridge_version"])
	}
	if payload["effective_capability"] != "campus_services" {
		t.Fatalf("effective_capability = %v, want campus_services", payload["effective_capability"])
	}
	if payload["lane"] != "campus_services" {
		t.Fatalf("lane = %v, want campus_services", payload["lane"])
	}
	runtimeDecisions := expectExecutionRecord(t, payload["runtime_decisions"], "runtime_decisions")
	if runtimeDecisions["effective_capability"] != "campus_services" {
		t.Fatalf("effective_capability = %v", runtimeDecisions["effective_capability"])
	}
	if runtimeDecisions["planning_outcome"] != "preplanned" {
		t.Fatalf("planning_outcome = %v, want preplanned", runtimeDecisions["planning_outcome"])
	}
	if runtimeDecisions["preplanned_target"] != "campus-services-agent" {
		t.Fatalf("preplanned_target = %v, want campus-services-agent", runtimeDecisions["preplanned_target"])
	}
	allowedTools, ok := runtimeDecisions["allowed_tools"].([]any)
	if !ok || len(allowedTools) != 1 || allowedTools[0] != "transport_schedule_lookup" {
		t.Fatalf("allowed_tools = %#v, want transport_schedule_lookup", runtimeDecisions["allowed_tools"])
	}
	specialistPayload := expectExecutionRecord(t, runtimeDecisions["specialist_payload"], "specialist_payload")
	if specialistPayload["kind"] != "transport_schedule_lookup" {
		t.Fatalf("specialist_payload.kind = %v, want transport_schedule_lookup", specialistPayload["kind"])
	}
	specialistPayloadRecord := expectExecutionRecord(t, specialistPayload["payload"], "specialist_payload.payload")
	if specialistPayloadRecord["intent"] != "first_departure" {
		t.Fatalf("specialist_payload.payload.intent = %v, want first_departure", specialistPayloadRecord["intent"])
	}
	preplanned := expectExecutionRecord(t, runtimeDecisions["preplanned_handoff"], "preplanned_handoff")
	if preplanned["target"] != "campus-services-agent" {
		t.Fatalf("target = %v, want campus-services-agent", preplanned["target"])
	}
	if preplanned["payload_kind"] != "transport_schedule_lookup" {
		t.Fatalf("payload_kind = %v, want transport_schedule_lookup", preplanned["payload_kind"])
	}
	payloadRecord := expectExecutionRecord(t, preplanned["payload"], "preplanned_handoff.payload")
	if payloadRecord["intent"] != "first_departure" {
		t.Fatalf("intent = %v, want first_departure", payloadRecord["intent"])
	}
	routeSelector := expectExecutionRecord(t, payloadRecord["route_selector"], "route_selector")
	if routeSelector["destination_campus"] != "fengtai" {
		t.Fatalf("destination_campus = %v, want fengtai", routeSelector["destination_campus"])
	}
	serviceTimeQuery := expectExecutionRecord(t, payloadRecord["service_time_query"], "service_time_query")
	if serviceTimeQuery["date_mode"] != "tomorrow" || serviceTimeQuery["daypart"] != "morning" {
		t.Fatalf("service_time_query = %#v, want tomorrow morning", serviceTimeQuery)
	}
}

func TestParseAnswerRequestDoesNotPreplanTransactionalStructuredRequests(t *testing.T) {
	request, httpErr := ParseAnswerRequest(
		json.RawMessage(`{
			"user_goal":"帮我提交采购公告",
			"request_id":"req-transactional-notice"
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
	if _, ok := runtimeDecisions["preplanned_handoff"]; ok {
		t.Fatalf("transactional structured request must not be preplanned: %#v", runtimeDecisions)
	}
}

func TestPreplannedHandoffGoldenCases(t *testing.T) {
	tests := []struct {
		name           string
		capability     string
		userGoal       string
		context        contextProjection
		wantTarget     string
		wantKind       string
		wantTool       string
		wantPayloadKey string
		wantPayloadVal any
	}{
		{
			name:           "transport first departure",
			capability:     "campus_services",
			userGoal:       "明天早上去丰台最早的班车是几点",
			wantTarget:     "campus-services-agent",
			wantKind:       "transport_schedule_lookup",
			wantTool:       "transport_schedule_lookup",
			wantPayloadKey: "intent",
			wantPayloadVal: "first_departure",
		},
		{
			name:           "transport snapshot metadata",
			capability:     "campus_services",
			userGoal:       "最近的校车时刻表是什么",
			wantTarget:     "campus-services-agent",
			wantKind:       "transport_schedule_lookup",
			wantTool:       "transport_schedule_lookup",
			wantPayloadKey: "intent",
			wantPayloadVal: "schedule_snapshot_metadata",
		},
		{
			name:           "transport timetable",
			capability:     "campus_services",
			userGoal:       "校车时刻表",
			wantTarget:     "campus-services-agent",
			wantKind:       "transport_schedule_lookup",
			wantTool:       "transport_schedule_lookup",
			wantPayloadKey: "intent",
			wantPayloadVal: "timetable",
		},
		{
			name:           "transport last departure",
			capability:     "campus_services",
			userGoal:       "回海淀最后一班校车几点",
			wantTarget:     "campus-services-agent",
			wantKind:       "transport_schedule_lookup",
			wantTool:       "transport_schedule_lookup",
			wantPayloadKey: "intent",
			wantPayloadVal: "last_departure",
		},
		{
			name:           "transport departure list",
			capability:     "campus_services",
			userGoal:       "下午去丰台校车还有哪些班次",
			wantTarget:     "campus-services-agent",
			wantKind:       "transport_schedule_lookup",
			wantTool:       "transport_schedule_lookup",
			wantPayloadKey: "intent",
			wantPayloadVal: "departure_list",
		},
		{
			name:           "transport service window",
			capability:     "campus_services",
			userGoal:       "校车今天还跑不跑",
			wantTarget:     "campus-services-agent",
			wantKind:       "transport_schedule_lookup",
			wantTool:       "transport_schedule_lookup",
			wantPayloadKey: "intent",
			wantPayloadVal: "service_window",
		},
		{
			name:           "service status campus scope",
			capability:     "campus_services",
			userGoal:       "丰台图书馆今天开门吗",
			wantTarget:     "campus-services-agent",
			wantKind:       "service_status_lookup",
			wantTool:       "service_status_lookup",
			wantPayloadKey: "campus_scope",
			wantPayloadVal: "fengtai",
		},
		{
			name:           "notice discover",
			capability:     "notice",
			userGoal:       "找一下2026年春假通知",
			wantTarget:     "notice-agent",
			wantKind:       "campus_notice_discover",
			wantTool:       "campus_notice_discover",
			wantPayloadKey: "query_text",
			wantPayloadVal: "找一下2026年春假通知",
		},
		{
			name:       "notice get selected ref",
			capability: "notice",
			userGoal:   "这条通知详情",
			context: contextProjection{
				SelectedNoticeRef: selectedNoticeRef{
					NoticeID:     "notice:2026-spring-break",
					SourceFamily: "internal_notice_restricted",
				},
			},
			wantTarget:     "notice-agent",
			wantKind:       "campus_notice_get",
			wantTool:       "campus_notice_get",
			wantPayloadKey: "notice_id",
			wantPayloadVal: "notice:2026-spring-break",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			handoff := planPreplannedHandoff(tt.capability, tt.userGoal, versionQuery{}, tt.context)
			if handoff == nil {
				t.Fatal("expected preplanned handoff")
			}
			if handoff.Target != tt.wantTarget || handoff.PayloadKind != tt.wantKind {
				t.Fatalf("handoff = %#v", handoff)
			}
			if len(handoff.AllowedTools) != 1 || handoff.AllowedTools[0] != tt.wantTool {
				t.Fatalf("allowed tools = %#v, want %q", handoff.AllowedTools, tt.wantTool)
			}
			if handoff.Payload[tt.wantPayloadKey] != tt.wantPayloadVal {
				t.Fatalf(
					"payload[%s] = %#v, want %#v",
					tt.wantPayloadKey,
					handoff.Payload[tt.wantPayloadKey],
					tt.wantPayloadVal,
				)
			}
		})
	}
}

func TestParseAnswerRequestKeepsVersionedStructuredQueriesOnKnowledgeLane(t *testing.T) {
	request, httpErr := ParseAnswerRequest(
		json.RawMessage(`{
			"user_goal":"比较新旧春假通知差异",
			"request_id":"req-versioned-structured-query",
			"version_query":{"mode":"compare","version_id":"notice:2025","compare_to_version_id":"notice:2026"}
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
	if request.RequestedCapability != "knowledge" {
		t.Fatalf("requested capability = %q, want knowledge", request.RequestedCapability)
	}
	if request.Lane != "rag" {
		t.Fatalf("lane = %q, want rag", request.Lane)
	}
	payload := decodeExecutionPayload(t, request.Payload)
	if payload["requested_capability"] != "knowledge" {
		t.Fatalf("projected requested_capability = %v, want knowledge", payload["requested_capability"])
	}
}

func TestParseAnswerRequestRejectsKnowledgeScopeForForwardCapabilities(t *testing.T) {
	_, httpErr := ParseAnswerRequest(
		json.RawMessage(`{
			"user_goal":"校车时刻表",
			"request_id":"req-scope-on-campus-services",
			"requested_capability":"campus_services",
			"requested_scope":{"corpus":"campus_services","collection":"service_catalog"}
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
		t.Fatal("expected requested_scope to fail for campus_services")
	}
	if httpErr.Code != "invalid_request" {
		t.Fatalf("error code = %q, want invalid_request", httpErr.Code)
	}
}

func TestParseAnswerRequestRejectsVersionQueryForForwardCapabilities(t *testing.T) {
	_, httpErr := ParseAnswerRequest(
		json.RawMessage(`{
			"user_goal":"找一下历史通知",
			"request_id":"req-version-on-notice",
			"requested_capability":"notice",
			"version_query":{"mode":"historical","version_id":"v1:notice"}
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
		t.Fatal("expected version_query to fail for notice")
	}
	if httpErr.Code != "invalid_request" {
		t.Fatalf("error code = %q, want invalid_request", httpErr.Code)
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
