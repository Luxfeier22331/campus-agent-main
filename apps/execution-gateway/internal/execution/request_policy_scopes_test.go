package execution

import (
	"encoding/json"

	"github.com/MUC-WIKI/campus-agent/apps/execution-gateway/internal/config"
	"testing"
)

func TestParseAnswerRequestAcceptsInstitutionalRulesQueryScope(t *testing.T) {
	request, httpErr := ParseAnswerRequest(
		json.RawMessage(`{
			"user_goal":"毕业生就业奖励办法怎么规定？",
			"request_id":"req-institutional-rules-scope",
			"requested_scope":{"corpus":"regulations","collection":"institutional_rules"}
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
	projectedScope := expectExecutionRecord(t, payload["requested_scope"], "requested_scope")
	if projectedScope["collection"] != "institutional_rules" {
		t.Fatalf("requested_scope.collection = %v, want institutional_rules", projectedScope["collection"])
	}
}

func TestParseAnswerRequestRejectsScopedRulesQueryScopeByDefault(t *testing.T) {
	_, httpErr := ParseAnswerRequest(
		json.RawMessage(`{
			"user_goal":"英才计划实施细则怎么规定？",
			"request_id":"req-scoped-rules-scope",
			"requested_scope":{"corpus":"regulations","collection":"scoped_rules"}
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
		t.Fatal("expected scoped_rules requested_scope to be rejected by default")
	}
	if httpErr.Code != "disallowed_knowledge_scope" {
		t.Fatalf("error code = %q, want disallowed_knowledge_scope", httpErr.Code)
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

func TestParseAnswerRequestRejectsNonQueryableScopeForCampusServicesMixedEnvelope(t *testing.T) {
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
		t.Fatal("expected non-queryable requested_scope to fail for campus_services")
	}
	if httpErr.Code != "disallowed_knowledge_scope" {
		t.Fatalf("error code = %q, want disallowed_knowledge_scope", httpErr.Code)
	}
}

func TestParseAnswerRequestRejectsCampusServicesTransportNoticeKnowledgeGrounding(t *testing.T) {
	request, httpErr := ParseAnswerRequest(
		json.RawMessage(`{
			"user_goal":"这条班车通知依据学生手册哪条规定？",
			"request_id":"req-campus-services-transport-notice-pilot",
			"requested_capability":"campus_services",
			"requested_scope":{"corpus":"regulations","collection":"student_rules"},
			"context":{
				"actor":{
					"user_id":"student-1",
					"principal_id":"student-1",
					"principal_type":"student",
					"roles":["student"]
				},
				"authorization":{
					"retrieval_filter":{
						"visibility_level":"public",
						"policy_projection_version":"phase1-authorization-projection-v1"
					}
				},
				"session":{
					"selected_notice_ref":{
						"notice_id":"notice:transport:355122",
						"source_family":"internal_notice_restricted",
						"title":"关于两校区学生通勤班车增加班次的通知",
						"target_surface":"campus_services/service_status_candidate"
					}
				}
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
	if request.RequestedCapability != "campus_services" {
		t.Fatalf("requested capability = %q, want campus_services", request.RequestedCapability)
	}
	if request.WorkflowMode != "" {
		t.Fatalf("workflow mode = %q, want empty terminal workflow mode before finalizer", request.WorkflowMode)
	}
	if len(request.PlannedHandoffs) != 0 {
		t.Fatalf("planned handoff count = %d, want 0", len(request.PlannedHandoffs))
	}
	if request.StructuredHandoff != nil {
		t.Fatalf("structured handoff = %#v, want nil terminal path", request.StructuredHandoff)
	}
	if request.TerminalEnvelope == nil {
		t.Fatal("terminal envelope must be present")
	}
	if request.TerminalEnvelope["status"] != "no_answer" {
		t.Fatalf("terminal status = %v, want no_answer", request.TerminalEnvelope["status"])
	}
	observability := expectExecutionRecord(t, request.TerminalEnvelope["observability"], "terminal_envelope.observability")
	if observability["policy_reason"] != "selected_notice_target_surface_ineligible_for_knowledge_followthrough" {
		t.Fatalf("observability.policy_reason = %v", observability["policy_reason"])
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
