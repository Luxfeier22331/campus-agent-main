package httpapi

import (
	"testing"

	"github.com/MUC-WIKI/campus-agent/apps/supervisor-api/internal/execution"
)

func TestFinalizeAgentBridgeResponseBuildsSupervisorEnvelope(t *testing.T) {
	response, err := finalizeAgentBridgeResponse(
		map[string]any{
			"target":      "rag-agent",
			"status":      "completed",
			"answer_text": "图书馆开放到 22:00。",
			"confidence":  "high",
			"result": map[string]any{
				"evidence": map[string]any{
					"sources": []any{
						map[string]any{"doc_id": "handbook:test-001"},
					},
				},
				"diagnostics": map[string]any{
					"retrieved_sources": []any{
						map[string]any{"doc_id": "handbook:test-001"},
					},
				},
			},
		},
		"trace-finalizer-1",
		supervisorFinalizerContext{},
	)
	if err != nil {
		t.Fatalf("finalize returned error: %v", err)
	}
	if response["selected_target"] != "rag-agent" {
		t.Fatalf("selected_target = %v, want rag-agent", response["selected_target"])
	}
	if response["status"] != "completed" {
		t.Fatalf("status = %v, want completed", response["status"])
	}
	if response["trace_id"] != "trace-finalizer-1" {
		t.Fatalf("trace_id = %v, want trace-finalizer-1", response["trace_id"])
	}
	observability, ok := response["observability"].(map[string]any)
	if !ok {
		t.Fatalf("observability = %#v, want object", response["observability"])
	}
	if observability["retrieval_attempted"] != true {
		t.Fatalf("retrieval_attempted = %v, want true", observability["retrieval_attempted"])
	}
	if observability["citation_count"] != 1 {
		t.Fatalf("citation_count = %v, want 1", observability["citation_count"])
	}
	if observability["semantic_outcome"] != "grounded_answer" {
		t.Fatalf("semantic_outcome = %v, want grounded_answer", observability["semantic_outcome"])
	}
	traceSummary, ok := response["workflow_trace_summary"].(map[string]any)
	if !ok {
		t.Fatalf("workflow_trace_summary = %#v, want object", response["workflow_trace_summary"])
	}
	if traceSummary["selected_target"] != "rag-agent" {
		t.Fatalf("trace selected_target = %v, want rag-agent", traceSummary["selected_target"])
	}
}

func TestFinalizeAgentBridgeResponseProjectsWorkflowTraceSummary(t *testing.T) {
	response, err := finalizeAgentBridgeResponse(
		map[string]any{
			"target":      "campus-services-agent",
			"status":      "completed",
			"answer_text": "当前班车正常运行。",
			"confidence":  "high",
			"result": map[string]any{
				"outcome":             "resolved_current",
				"related_notice_refs": []any{"notice:muc_internal_portal:353903"},
			},
			"agent_observability": map[string]any{
				"selected_tool":    "transport_schedule_lookup",
				"tool_attempted":   true,
				"tool_outcome":     "resolved_current",
				"source_ref_count": float64(1),
				"access_decision":  "allowed",
				"safe_details": map[string]any{
					"payload_kind": "transport_schedule_lookup",
				},
			},
		},
		"trace-finalizer-workflow",
		supervisorFinalizerContext{
			RuntimeDecisions: execution.RuntimeDecisionSummary{
				ScopeGateDecision:     "allow",
				PolicyGateDecision:    "allow",
				ContextPreflightState: "not_follow_up",
				RoutingNextAction:     "delegate",
				PlanningOutcome:       "preplanned",
				SelectedTarget:        "campus-services-agent",
				SelectedTool:          "transport_schedule_lookup",
			},
			Handoff: &execution.RuntimeHandoff{
				Target:       "campus-services-agent",
				PayloadKind:  "transport_schedule_lookup",
				Payload:      map[string]any{"intent": "next_departure"},
				AllowedTools: []string{"transport_schedule_lookup"},
			},
			Branch:       "delegate",
			SelectedTool: "transport_schedule_lookup",
		},
	)
	if err != nil {
		t.Fatalf("finalize returned error: %v", err)
	}
	traceSummary, ok := response["workflow_trace_summary"].(map[string]any)
	if !ok {
		t.Fatalf("workflow_trace_summary = %#v, want object", response["workflow_trace_summary"])
	}
	if traceSummary["direct_vs_delegate_branch"] != "delegate" {
		t.Fatalf(
			"direct_vs_delegate_branch = %v, want delegate",
			traceSummary["direct_vs_delegate_branch"],
		)
	}
	if traceSummary["planning_outcome"] != "preplanned" {
		t.Fatalf("planning_outcome = %v, want preplanned", traceSummary["planning_outcome"])
	}
	selectedTools, ok := traceSummary["selected_tools"].([]string)
	if !ok || len(selectedTools) != 1 || selectedTools[0] != "transport_schedule_lookup" {
		t.Fatalf("selected_tools = %#v, want transport_schedule_lookup", traceSummary["selected_tools"])
	}
	toolSummary, ok := traceSummary["tool_argument_summary"].(map[string]any)
	if !ok {
		t.Fatalf("tool_argument_summary = %#v, want object", traceSummary["tool_argument_summary"])
	}
	if toolSummary["selected_tool"] != "transport_schedule_lookup" {
		t.Fatalf("tool selected_tool = %v, want transport_schedule_lookup", toolSummary["selected_tool"])
	}
	if toolSummary["intent"] != "next_departure" {
		t.Fatalf("tool intent = %v, want next_departure", toolSummary["intent"])
	}
	if toolSummary["source_ref_count"] != float64(1) {
		t.Fatalf("source_ref_count = %v, want 1", toolSummary["source_ref_count"])
	}
}

func TestFinalizeAgentBridgeResponseProjectsActualToolCallsAndVersions(t *testing.T) {
	response, err := finalizeAgentBridgeResponse(
		map[string]any{
			"target":      "campus-services-agent",
			"status":      "completed",
			"answer_text": "校园卡服务当前正常。",
			"confidence":  "high",
			"result": map[string]any{
				"outcome":             "resolved_current",
				"related_notice_refs": []any{"notice:muc_internal_portal:353903"},
			},
			"agent_observability": map[string]any{
				"selected_tool":    "service_status_lookup",
				"tool_attempted":   true,
				"tool_outcome":     "resolved_current",
				"source_ref_count": float64(1),
				"access_decision":  "allowed",
				"safe_details": map[string]any{
					"agent_plan": map[string]any{
						"schema_version":        "agent-local-plan-v1",
						"planner":               "deterministic_payload_router",
						"selected_tool":         "service_status_lookup",
						"payload_kind":          "service_status_lookup",
						"tool_selection_reason": "typed_payload_allowed_tool",
					},
					"result_guardrail": map[string]any{
						"schema_version":   "agent-result-guardrail-v1",
						"outcome":          "source_backed",
						"source_ref_count": float64(1),
						"access_decision":  "allowed",
					},
				},
			},
		},
		"trace-finalizer-tool-calls",
		supervisorFinalizerContext{
			RuntimeDecisions: execution.RuntimeDecisionSummary{
				ScopeGateDecision:     "allow",
				PolicyGateDecision:    "allow",
				ContextPreflightState: "not_follow_up",
				RoutingNextAction:     "delegate",
				PlanningOutcome:       "preplanned",
				SelectedTarget:        "campus-services-agent",
				SelectedTool:          "service_status_lookup",
				RuntimeVersions: map[string]any{
					"supervisor_api_runtime": "go-runtime-control-plane-v1",
				},
				PolicyArtifactVersions: map[string]any{
					"intent_classifier": "go-runtime-policy-v2",
				},
			},
			Handoff: &execution.RuntimeHandoff{
				Target:       "campus-services-agent",
				PayloadKind:  "service_status_lookup",
				Payload:      map[string]any{"campus_scope": "haidian", "subject_query": "校园卡服务"},
				AllowedTools: []string{"transport_schedule_lookup", "service_status_lookup"},
			},
			Branch:       "delegate",
			SelectedTool: "service_status_lookup",
		},
	)
	if err != nil {
		t.Fatalf("finalize returned error: %v", err)
	}
	traceSummary := response["workflow_trace_summary"].(map[string]any)
	selectedTools, ok := traceSummary["selected_tools"].([]string)
	if !ok || len(selectedTools) != 1 || selectedTools[0] != "service_status_lookup" {
		t.Fatalf("selected_tools = %#v, want actual service_status_lookup only", traceSummary["selected_tools"])
	}
	toolCalls, ok := traceSummary["tool_call_summaries"].([]map[string]any)
	if !ok || len(toolCalls) != 1 {
		t.Fatalf("tool_call_summaries = %#v, want one tool call", traceSummary["tool_call_summaries"])
	}
	toolCall := toolCalls[0]
	if toolCall["tool_name"] != "service_status_lookup" {
		t.Fatalf("tool_name = %v, want service_status_lookup", toolCall["tool_name"])
	}
	if toolCall["result_status"] != "completed" {
		t.Fatalf("result_status = %v, want completed", toolCall["result_status"])
	}
	if toolCall["business_outcome"] != "resolved_current" {
		t.Fatalf("business_outcome = %v, want resolved_current", toolCall["business_outcome"])
	}
	sourceIDs, ok := toolCall["source_ids"].([]string)
	if !ok || len(sourceIDs) != 1 || sourceIDs[0] != "notice:muc_internal_portal:353903" {
		t.Fatalf("source_ids = %#v, want notice source ref", toolCall["source_ids"])
	}
	argumentSummary, ok := toolCall["argument_summary"].(map[string]any)
	if !ok || argumentSummary["campus_scope"] != "haidian" {
		t.Fatalf("argument_summary = %#v, want safe handoff args", toolCall["argument_summary"])
	}
	traceSteps, ok := traceSummary["trace_steps"].([]map[string]any)
	if !ok || len(traceSteps) < 4 {
		t.Fatalf("trace_steps = %#v, want runtime/handoff/tool/finalization steps", traceSummary["trace_steps"])
	}
	if traceSteps[0]["span_kind"] != "runtime_policy" || traceSteps[0]["parent_step_id"] != "" {
		t.Fatalf("runtime_policy step = %#v, want root runtime_policy span", traceSteps[0])
	}
	if traceSteps[2]["span_kind"] != "tool_call" ||
		traceSteps[2]["parent_step_id"] != "handoff" ||
		traceSteps[2]["result_status"] != "completed" ||
		traceSteps[2]["retry_count"] != 0 {
		t.Fatalf("tool_call step = %#v, want timeline tool span", traceSteps[2])
	}
	if traceSteps[3]["span_kind"] != "finalization" || traceSteps[3]["parent_step_id"] != "tool_call" {
		t.Fatalf("finalization step = %#v, want finalization child of tool_call", traceSteps[3])
	}
	safeDetails, ok := toolCall["safe_details"].(map[string]any)
	if !ok {
		t.Fatalf("tool safe_details = %#v, want object", toolCall["safe_details"])
	}
	agentPlan, ok := safeDetails["agent_plan"].(map[string]any)
	if !ok || agentPlan["schema_version"] != "agent-local-plan-v1" {
		t.Fatalf("agent_plan = %#v, want versioned agent plan", safeDetails["agent_plan"])
	}
	resultGuardrail, ok := safeDetails["result_guardrail"].(map[string]any)
	if !ok || resultGuardrail["outcome"] != "source_backed" {
		t.Fatalf("result_guardrail = %#v, want source-backed result guardrail", safeDetails["result_guardrail"])
	}
	runtimeVersions, ok := traceSummary["runtime_versions"].(map[string]any)
	if !ok || runtimeVersions["supervisor_api_runtime"] != "go-runtime-control-plane-v1" {
		t.Fatalf("runtime_versions = %#v, want supervisor_api_runtime", traceSummary["runtime_versions"])
	}
	policyVersions, ok := traceSummary["policy_artifact_versions"].(map[string]any)
	if !ok || policyVersions["intent_classifier"] != "go-runtime-policy-v2" {
		t.Fatalf("policy_artifact_versions = %#v, want intent_classifier", traceSummary["policy_artifact_versions"])
	}
}

func TestFinalizerContextFromExecutionRequestCarriesVersionProvenance(t *testing.T) {
	context := finalizerContextFromExecutionRequest(
		execution.AnswerExecutionRequest{
			RuntimeDecisions: execution.RuntimeDecisionSummary{
				SelectedTool: "retrieval.query",
				RuntimeVersions: map[string]any{
					"bridge_contract": "supervisor_bridge_v6",
				},
				PolicyArtifactVersions: map[string]any{
					"intent_case_set": "intent-case-set-v2",
				},
			},
		},
		"delegate",
	)

	if context.RuntimeVersions["bridge_contract"] != "supervisor_bridge_v6" {
		t.Fatalf("runtime versions = %#v, want bridge contract", context.RuntimeVersions)
	}
	if context.PolicyVersions["intent_case_set"] != "intent-case-set-v2" {
		t.Fatalf("policy versions = %#v, want intent case set", context.PolicyVersions)
	}
}

func TestTerminalSupervisorResponseClassifiesClarificationAndFailCloseBranches(t *testing.T) {
	clarification := terminalSupervisorResponse(
		map[string]any{
			"selected_target": "campus-services-agent",
			"status":          "needs_clarification",
			"result": map[string]any{
				"clarification_reason": "route_direction_required",
			},
		},
		"trace-terminal-clarification",
		supervisorFinalizerContext{
			Branch: "terminal",
			RuntimeDecisions: execution.RuntimeDecisionSummary{
				PlanningOutcome:       "not_preplanned",
				RoutingNextAction:     "clarify",
				ContextPreflightState: "missing_context",
			},
		},
	)
	clarificationTrace := clarification["workflow_trace_summary"].(map[string]any)
	if clarificationTrace["direct_vs_delegate_branch"] != "clarification" {
		t.Fatalf("clarification branch = %v, want clarification", clarificationTrace["direct_vs_delegate_branch"])
	}

	failClose := terminalSupervisorResponse(
		map[string]any{
			"selected_target": "campus-services-agent",
			"status":          "no_answer",
			"result": map[string]any{
				"fail_close_reason": "transactional_action_not_supported",
			},
		},
		"trace-terminal-fail-close",
		supervisorFinalizerContext{
			Branch: "terminal",
			RuntimeDecisions: execution.RuntimeDecisionSummary{
				FailCloseReason:   "transactional_action_not_supported",
				PlanningOutcome:   "not_preplanned",
				RoutingNextAction: "rejected",
			},
		},
	)
	failCloseTrace := failClose["workflow_trace_summary"].(map[string]any)
	if failCloseTrace["direct_vs_delegate_branch"] != "fail_close" {
		t.Fatalf("fail-close branch = %v, want fail_close", failCloseTrace["direct_vs_delegate_branch"])
	}
}

func TestFinalizeAgentBridgeResponseProjectsSafeRagToolArguments(t *testing.T) {
	response, err := finalizeAgentBridgeResponse(
		map[string]any{
			"target":      "rag-agent",
			"status":      "completed",
			"answer_text": "图书馆开放到 22:00。",
			"confidence":  "high",
			"result": map[string]any{
				"evidence": map[string]any{
					"sources": []any{map[string]any{"doc_id": "handbook:library-hours"}},
				},
			},
		},
		"trace-finalizer-rag-tool-summary",
		supervisorFinalizerContext{
			RuntimeDecisions: execution.RuntimeDecisionSummary{
				ScopeGateDecision:  "allow",
				PolicyGateDecision: "allow",
				RoutingNextAction:  "delegate",
				PlanningOutcome:    "preplanned",
				SelectedTarget:     "rag-agent",
				SelectedTool:       "retrieval.query",
			},
			Handoff: &execution.RuntimeHandoff{
				Target:       "rag-agent",
				PayloadKind:  "rag_request",
				Payload:      map[string]any{"scope": map[string]any{"corpus": "regulations", "collection": "student_rules"}},
				AllowedTools: []string{"retrieval.query"},
			},
			Branch:       "delegate",
			SelectedTool: "retrieval.query",
		},
	)
	if err != nil {
		t.Fatalf("finalize returned error: %v", err)
	}
	traceSummary := response["workflow_trace_summary"].(map[string]any)
	toolSummary, ok := traceSummary["tool_argument_summary"].(map[string]any)
	if !ok {
		t.Fatalf("tool_argument_summary = %#v, want object", traceSummary["tool_argument_summary"])
	}
	if toolSummary["collection"] != "student_rules" {
		t.Fatalf("collection = %v, want student_rules", toolSummary["collection"])
	}
	if toolSummary["corpus"] != "regulations" {
		t.Fatalf("corpus = %v, want regulations", toolSummary["corpus"])
	}
	observability := response["observability"].(map[string]any)
	if observability["selected_tool"] != "retrieval.query" {
		t.Fatalf("observability selected_tool = %v, want retrieval.query", observability["selected_tool"])
	}
}

func TestFinalizeAgentBridgeResponseRejectsRawAgentObservabilityKeys(t *testing.T) {
	_, err := finalizeAgentBridgeResponse(
		map[string]any{
			"target":      "campus-services-agent",
			"status":      "completed",
			"answer_text": "unexpected",
			"confidence":  "high",
			"agent_observability": map[string]any{
				"safe_details": map[string]any{
					"providerRawResponse": "forbidden",
				},
			},
		},
		"trace-finalizer-raw-agent-observability",
		supervisorFinalizerContext{},
	)

	if err == nil {
		t.Fatal("expected raw agent observability to be rejected")
	}
}

func TestFinalizeAgentBridgeResponseRejectsUnsupportedTarget(t *testing.T) {
	_, err := finalizeAgentBridgeResponse(
		map[string]any{
			"target":      "unexpected-agent",
			"status":      "completed",
			"answer_text": "unexpected",
			"confidence":  "high",
		},
		"trace-finalizer-invalid-target",
		supervisorFinalizerContext{},
	)

	if err == nil {
		t.Fatal("expected unsupported target to be rejected")
	}
}

func TestFinalizeAgentBridgeResponseRejectsUnsupportedConfidence(t *testing.T) {
	_, err := finalizeAgentBridgeResponse(
		map[string]any{
			"target":      "rag-agent",
			"status":      "completed",
			"answer_text": "unexpected",
			"confidence":  "certain",
		},
		"trace-finalizer-invalid-confidence",
		supervisorFinalizerContext{},
	)

	if err == nil {
		t.Fatal("expected unsupported confidence to be rejected")
	}
}

func TestFinalizeAgentBridgeResponseRejectsMalformedScalarFields(t *testing.T) {
	for name, body := range map[string]map[string]any{
		"non_string_confidence": {
			"target":      "rag-agent",
			"status":      "completed",
			"answer_text": "unexpected",
			"confidence":  true,
		},
		"non_string_answer_text": {
			"target":      "rag-agent",
			"status":      "completed",
			"answer_text": 123,
			"confidence":  "high",
		},
		"non_string_follow_up_question": {
			"target":             "rag-agent",
			"status":             "needs_clarification",
			"answer_text":        "",
			"follow_up_question": []any{"which campus"},
			"confidence":         "low",
		},
		"non_object_result": {
			"target":      "rag-agent",
			"status":      "completed",
			"answer_text": "unexpected",
			"confidence":  "high",
			"result":      []any{"not", "object"},
		},
		"non_object_error": {
			"target":      "rag-agent",
			"status":      "error",
			"answer_text": "",
			"confidence":  "low",
			"error":       "failed",
		},
	} {
		t.Run(name, func(t *testing.T) {
			_, err := finalizeAgentBridgeResponse(
				body,
				"trace-finalizer-malformed",
				supervisorFinalizerContext{},
			)

			if err == nil {
				t.Fatal("expected malformed agent response to be rejected")
			}
		})
	}
}

func TestBuildStructuredSupervisorObservabilitySummarizesServiceStatusTraceRefs(t *testing.T) {
	observability := buildStructuredSupervisorObservability(
		"campus-services-agent",
		"completed",
		map[string]any{
			"subject_query":        "丰台校区通勤班车在哪里上车",
			"outcome":              "resolved_current",
			"related_notice_refs":  []any{"authenticated_notice:355122"},
			"override_source_refs": []any{"notice:muc_internal_portal:353903"},
		},
		"",
	)

	if observability["selected_tool"] != "service_status_lookup" {
		t.Fatalf("selected_tool = %v, want service_status_lookup", observability["selected_tool"])
	}
	if observability["tool_business_outcome"] != "resolved_current" {
		t.Fatalf("tool_business_outcome = %v, want resolved_current", observability["tool_business_outcome"])
	}
	if observability["notice_source_family_summary"] != "internal_notice_restricted" {
		t.Fatalf(
			"notice_source_family_summary = %v, want internal_notice_restricted",
			observability["notice_source_family_summary"],
		)
	}
	if observability["temporal_posture"] != "current" {
		t.Fatalf("temporal_posture = %v, want current", observability["temporal_posture"])
	}
}

func TestBuildStructuredSupervisorObservabilitySummarizesServiceStatusFailClose(t *testing.T) {
	observability := buildStructuredSupervisorObservability(
		"campus-services-agent",
		"no_answer",
		map[string]any{
			"subject_query":       "图书馆今天开门吗",
			"outcome":             "temporarily_unverifiable",
			"fail_close_reason":   "source_conflict",
			"related_notice_refs": []any{"authenticated_notice:355999"},
		},
		"",
	)

	if observability["fail_closed"] != true {
		t.Fatalf("fail_closed = %v, want true", observability["fail_closed"])
	}
	if observability["tool_fail_close_reason"] != "source_conflict" {
		t.Fatalf("tool_fail_close_reason = %v, want source_conflict", observability["tool_fail_close_reason"])
	}
	if observability["semantic_outcome"] != "temporarily_unverifiable" {
		t.Fatalf("semantic_outcome = %v, want temporarily_unverifiable", observability["semantic_outcome"])
	}
	if observability["notice_source_family_summary"] != "internal_notice_restricted" {
		t.Fatalf(
			"notice_source_family_summary = %v, want internal_notice_restricted",
			observability["notice_source_family_summary"],
		)
	}
}
