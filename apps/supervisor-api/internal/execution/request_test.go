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
	if runtimeDecisions["effective_capability"] != "campus_services" {
		t.Fatalf("effective_capability = %v", runtimeDecisions["effective_capability"])
	}
	summary := expectExecutionRecord(t, runtimeDecisions["runtime_decision_summary"], "runtime_decision_summary")
	if summary["planning_outcome"] != "preplanned" {
		t.Fatalf("runtime_decision_summary.planning_outcome = %v, want preplanned", summary["planning_outcome"])
	}
	handoff := expectExecutionRecord(t, runtimeDecisions["handoff"], "handoff")
	if handoff["planning_outcome"] != "preplanned" {
		t.Fatalf("handoff.planning_outcome = %v, want preplanned", handoff["planning_outcome"])
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
	if request.RuntimeDecisions.PlanningOutcome != "preplanned" {
		t.Fatalf(
			"request planning outcome = %q, want preplanned",
			request.RuntimeDecisions.PlanningOutcome,
		)
	}
	if handoff["target"] != "rag-agent" {
		t.Fatalf("handoff.target = %v, want rag-agent", handoff["target"])
	}
	allowedTools, ok := handoff["allowed_tools"].([]any)
	if !ok || len(allowedTools) != 0 {
		t.Fatalf("handoff.allowed_tools = %#v, want empty array", handoff["allowed_tools"])
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
	if _, ok := runtimeDecisions["handoff"]; ok {
		t.Fatalf("transactional structured request must not be preplanned: %#v", runtimeDecisions)
	}
	policyGate := expectExecutionRecord(t, runtimeDecisions["policy_gate"], "policy_gate")
	if policyGate["decision"] != "approval_required" {
		t.Fatalf("policy_gate.decision = %v, want approval_required", policyGate["decision"])
	}
	routingFrame := expectExecutionRecord(t, runtimeDecisions["routing_frame"], "routing_frame")
	if routingFrame["suggested_next_action"] != "approval_required" {
		t.Fatalf("routing_frame.suggested_next_action = %v, want approval_required", routingFrame["suggested_next_action"])
	}
	if routingFrame["risk_level"] != "high" {
		t.Fatalf("routing_frame.risk_level = %v, want high", routingFrame["risk_level"])
	}
	terminalEnvelope := expectExecutionRecord(t, runtimeDecisions["terminal_envelope"], "terminal_envelope")
	if terminalEnvelope["status"] != "approval_required" {
		t.Fatalf("terminal_envelope.status = %v, want approval_required", terminalEnvelope["status"])
	}
	if terminalEnvelope["answer_text"] == "" {
		t.Fatalf("terminal_envelope.answer_text must be non-empty")
	}
}

func TestParseAnswerRequestClarifiesUnplannableCampusServicesSubtypeBeforeBridge(t *testing.T) {
	request, httpErr := ParseAnswerRequest(
		json.RawMessage(`{
			"user_goal":"校园卡余额怎么查",
			"request_id":"req-campus-services-missing-subtype",
			"requested_capability":"campus_services"
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
	if request.StructuredHandoff != nil {
		t.Fatalf("unplannable subtype must not preplan handoff: %#v", request.StructuredHandoff)
	}
	payload := decodeExecutionPayload(t, request.Payload)
	runtimeDecisions := expectExecutionRecord(t, payload["runtime_decisions"], "runtime_decisions")
	routingFrame := expectExecutionRecord(t, runtimeDecisions["routing_frame"], "routing_frame")
	if routingFrame["suggested_next_action"] != "clarify" {
		t.Fatalf("routing_frame.suggested_next_action = %v, want clarify", routingFrame["suggested_next_action"])
	}
	if routingFrame["scope_reason"] != "structured_subtype_missing" {
		t.Fatalf("routing_frame.scope_reason = %v, want structured_subtype_missing", routingFrame["scope_reason"])
	}
	terminalEnvelope := expectExecutionRecord(t, runtimeDecisions["terminal_envelope"], "terminal_envelope")
	if terminalEnvelope["status"] != "needs_clarification" {
		t.Fatalf("terminal_envelope.status = %v, want needs_clarification", terminalEnvelope["status"])
	}
}

func TestParseAnswerRequestProjectsRuntimePolicyForOutOfScopeKnowledge(t *testing.T) {
	request, httpErr := ParseAnswerRequest(
		json.RawMessage(`{
			"user_goal":"MIT的校长是谁",
			"request_id":"req-out-of-scope-policy"
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
	scopeGate := expectExecutionRecord(t, runtimeDecisions["scope_gate"], "scope_gate")
	if scopeGate["decision"] != "out_of_scope" {
		t.Fatalf("scope_gate.decision = %v, want out_of_scope", scopeGate["decision"])
	}
	if scopeGate["reason"] != "product_scope_boundary" {
		t.Fatalf("scope_gate.reason = %v, want product_scope_boundary", scopeGate["reason"])
	}
	routingFrame := expectExecutionRecord(t, runtimeDecisions["routing_frame"], "routing_frame")
	if routingFrame["suggested_next_action"] != "out_of_scope" {
		t.Fatalf("routing_frame.suggested_next_action = %v, want out_of_scope", routingFrame["suggested_next_action"])
	}
	if routingFrame["policy_reason"] != "product_scope_boundary" {
		t.Fatalf("routing_frame.policy_reason = %v, want product_scope_boundary", routingFrame["policy_reason"])
	}
	terminalEnvelope := expectExecutionRecord(t, runtimeDecisions["terminal_envelope"], "terminal_envelope")
	if terminalEnvelope["status"] != "no_answer" {
		t.Fatalf("terminal_envelope.status = %v, want no_answer", terminalEnvelope["status"])
	}
	if terminalEnvelope["answer_text"] == "" {
		t.Fatalf("terminal_envelope.answer_text must be non-empty")
	}
	observability := expectExecutionRecord(t, terminalEnvelope["observability"], "terminal_envelope.observability")
	if observability["semantic_outcome"] != "out_of_scope" {
		t.Fatalf("semantic_outcome = %v, want out_of_scope", observability["semantic_outcome"])
	}
	if request.RuntimeDecisions.ScopeGateDecision != "out_of_scope" {
		t.Fatalf(
			"request runtime scope gate = %q, want out_of_scope",
			request.RuntimeDecisions.ScopeGateDecision,
		)
	}
	if request.RuntimeDecisions.PolicyGateDecision != "out_of_scope" {
		t.Fatalf(
			"request runtime policy gate = %q, want out_of_scope",
			request.RuntimeDecisions.PolicyGateDecision,
		)
	}
	if request.RuntimeDecisions.ContextPreflightState != "not_follow_up" {
		t.Fatalf(
			"request runtime context state = %q, want not_follow_up",
			request.RuntimeDecisions.ContextPreflightState,
		)
	}
	if request.RuntimeDecisions.RoutingNextAction != "out_of_scope" {
		t.Fatalf(
			"request runtime next action = %q, want out_of_scope",
			request.RuntimeDecisions.RoutingNextAction,
		)
	}
	if request.RuntimeDecisions.PlanningOutcome != "not_preplanned" {
		t.Fatalf(
			"request planning outcome = %q, want not_preplanned",
			request.RuntimeDecisions.PlanningOutcome,
		)
	}
}

func TestParseAnswerRequestProjectsRuntimePolicyForMissingNoticeFollowUpContext(t *testing.T) {
	request, httpErr := ParseAnswerRequest(
		json.RawMessage(`{
			"user_goal":"这条通知详情",
			"request_id":"req-missing-notice-context",
			"requested_capability":"notice"
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
	contextPreflight := expectExecutionRecord(t, runtimeDecisions["context_preflight"], "context_preflight")
	if contextPreflight["state"] != "missing_context" {
		t.Fatalf("context_preflight.state = %v, want missing_context", contextPreflight["state"])
	}
	if contextPreflight["reference_type"] != "selected_notice" {
		t.Fatalf("context_preflight.reference_type = %v, want selected_notice", contextPreflight["reference_type"])
	}
	routingFrame := expectExecutionRecord(t, runtimeDecisions["routing_frame"], "routing_frame")
	if routingFrame["suggested_next_action"] != "clarify" {
		t.Fatalf("routing_frame.suggested_next_action = %v, want clarify", routingFrame["suggested_next_action"])
	}
	missingSlots, ok := routingFrame["missing_slots"].([]any)
	if !ok || len(missingSlots) != 1 || missingSlots[0] != "selected_notice_ref" {
		t.Fatalf("routing_frame.missing_slots = %#v, want selected_notice_ref", routingFrame["missing_slots"])
	}
	terminalEnvelope := expectExecutionRecord(t, runtimeDecisions["terminal_envelope"], "terminal_envelope")
	if terminalEnvelope["status"] != "needs_clarification" {
		t.Fatalf("terminal_envelope.status = %v, want needs_clarification", terminalEnvelope["status"])
	}
	if terminalEnvelope["follow_up_question"] == "" {
		t.Fatalf("terminal_envelope.follow_up_question must be non-empty")
	}
}

func TestParseAnswerRequestRejectsDisabledKnowledgeScopeInGo(t *testing.T) {
	_, httpErr := ParseAnswerRequest(
		json.RawMessage(`{
			"user_goal":"谁负责宿舍报修？",
			"request_id":"req-disabled-scope",
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
		t.Fatal("expected disabled query scope to fail in Go")
	}
	if httpErr.Status != 403 || httpErr.Code != "disallowed_knowledge_scope" {
		t.Fatalf("unexpected error = %#v, want 403 disallowed_knowledge_scope", httpErr)
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

func TestParseAnswerRequestRejectsVersionQueryForPlaceLookup(t *testing.T) {
	_, httpErr := ParseAnswerRequest(
		json.RawMessage(`{
			"user_goal":"图书馆在哪里",
			"request_id":"req-version-on-place-lookup",
			"requested_capability":"place_lookup",
			"version_query":{"mode":"historical","version_id":"v1:library-location"}
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
		t.Fatal("expected version_query to fail for place_lookup")
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
