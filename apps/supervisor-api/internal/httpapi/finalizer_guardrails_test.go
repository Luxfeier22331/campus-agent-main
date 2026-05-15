package httpapi

import (
	"github.com/MUC-WIKI/campus-agent/apps/supervisor-api/internal/execution"
	"testing"
)

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
	if clarificationTrace["workflow_mode"] != "terminal" {
		t.Fatalf("clarification workflow_mode = %v, want terminal", clarificationTrace["workflow_mode"])
	}
	if clarificationTrace["selected_target"] != "none" {
		t.Fatalf("clarification selected_target = %v, want none", clarificationTrace["selected_target"])
	}
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
	if failCloseTrace["workflow_mode"] != "terminal" {
		t.Fatalf("fail-close workflow_mode = %v, want terminal", failCloseTrace["workflow_mode"])
	}
	if failCloseTrace["selected_target"] != "none" {
		t.Fatalf("fail-close selected_target = %v, want none", failCloseTrace["selected_target"])
	}
	if failCloseTrace["direct_vs_delegate_branch"] != "fail_close" {
		t.Fatalf("fail-close branch = %v, want fail_close", failCloseTrace["direct_vs_delegate_branch"])
	}
}

func TestFinalizeAgentBridgeResponseProjectsSafeRagToolArguments(t *testing.T) {
	response, err := finalizeAgentBridgeResponse(
		map[string]any{
			"target":             "rag-agent",
			"status":             "completed",
			"answer_text":        "图书馆开放到 22:00。",
			"follow_up_question": "",
			"confidence":         "high",
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
	handoff := traceSummary["handoff"].(map[string]any)
	allowedTools, ok := handoff["allowed_tools"].([]string)
	if !ok {
		t.Fatalf("handoff allowed_tools = %#v, want string array", handoff["allowed_tools"])
	}
	if allowedTools == nil {
		t.Fatal("handoff allowed_tools is nil, want empty array projection")
	}
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

func TestWorkflowHandoffSummaryProjectsNilAllowedToolsAsEmptyArray(t *testing.T) {
	summary := workflowHandoffSummary(&execution.RuntimeHandoff{
		Target:      "rag-agent",
		PayloadKind: "rag_request",
	}, "rag-agent", "retrieval.query")

	allowedTools, ok := summary["allowed_tools"].([]string)
	if !ok {
		t.Fatalf("allowed_tools = %#v, want string array", summary["allowed_tools"])
	}
	if allowedTools == nil {
		t.Fatal("allowed_tools is nil, want empty array projection")
	}
	if len(allowedTools) != 0 {
		t.Fatalf("allowed_tools = %#v, want empty array", allowedTools)
	}
}

func TestFinalizeAgentBridgeResponseRejectsRawAgentObservabilityKeys(t *testing.T) {
	_, err := finalizeAgentBridgeResponse(
		map[string]any{
			"target":             "campus-services-agent",
			"status":             "completed",
			"answer_text":        "unexpected",
			"follow_up_question": "",
			"confidence":         "high",
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

func TestFinalizeAgentBridgeResponseRejectsRawRagSdkResultDiagnostics(t *testing.T) {
	_, err := finalizeAgentBridgeResponse(
		map[string]any{
			"target":             "rag-agent",
			"status":             "completed",
			"answer_text":        "本科生可申请国家奖学金。",
			"follow_up_question": "",
			"confidence":         "medium",
			"result": map[string]any{
				"diagnostics": map[string]any{
					"prompt_runtime_state": "rag_sdk_completed",
					"rag_sdk_trace_projection": map[string]any{
						"schema_version": "rag-sdk-trace-projection-v1",
						"rawPrompt":      "forbidden",
					},
				},
			},
			"agent_observability": map[string]any{
				"selected_tool":  "retrieval.query",
				"tool_attempted": true,
				"tool_outcome":   "rag_sdk_completed",
				"safe_details": map[string]any{
					"rag_sdk_trace_projection": map[string]any{
						"schema_version": "rag-sdk-trace-projection-v1",
						"rollout_mode":   "candidate",
						"runtime":        "openai_agents_sdk",
					},
				},
			},
		},
		"trace-finalizer-rag-sdk-result-raw",
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

	if err == nil {
		t.Fatal("expected raw RAG SDK result diagnostics to be rejected")
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

func TestFinalizeAgentBridgeResponseDoesNotInferSelectedToolFromStructuredResult(t *testing.T) {
	response, err := finalizeAgentBridgeResponse(
		map[string]any{
			"target":             "campus-services-agent",
			"status":             "completed",
			"answer_text":        "当前班车正常运行。",
			"follow_up_question": "",
			"confidence":         "high",
			"result": map[string]any{
				"subject_query": "丰台校区通勤班车在哪里上车",
				"outcome":       "resolved_current",
			},
		},
		"trace-finalizer-no-infer-selected-tool",
		supervisorFinalizerContext{
			Branch: "delegate",
			RuntimeDecisions: execution.RuntimeDecisionSummary{
				SelectedTarget:    "campus-services-agent",
				RoutingNextAction: "delegate",
				PlanningOutcome:   "preplanned",
			},
			Handoff: &execution.RuntimeHandoff{
				Target:       "campus-services-agent",
				PayloadKind:  "service_status_lookup",
				AllowedTools: []string{"service_status_lookup", "service_guide_lookup"},
			},
		},
	)
	if err != nil {
		t.Fatalf("finalize returned error: %v", err)
	}

	observability := response["observability"].(map[string]any)
	if observability["selected_tool"] != "" {
		t.Fatalf("observability selected_tool = %v, want empty", observability["selected_tool"])
	}

	traceSummary := response["workflow_trace_summary"].(map[string]any)
	selectedTools, ok := traceSummary["selected_tools"].([]string)
	if !ok {
		t.Fatalf("selected_tools = %#v, want string array", traceSummary["selected_tools"])
	}
	if len(selectedTools) != 0 {
		t.Fatalf("selected_tools = %#v, want none", selectedTools)
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
			"target":             "rag-agent",
			"status":             "completed",
			"answer_text":        "unexpected",
			"follow_up_question": "",
			"confidence":         true,
		},
		"missing_confidence": {
			"target":             "rag-agent",
			"status":             "completed",
			"answer_text":        "unexpected",
			"follow_up_question": "",
		},
		"non_string_answer_text": {
			"target":             "rag-agent",
			"status":             "completed",
			"answer_text":        123,
			"follow_up_question": "",
			"confidence":         "high",
		},
		"missing_answer_text": {
			"target":             "rag-agent",
			"status":             "completed",
			"follow_up_question": "",
			"confidence":         "high",
		},
		"non_string_follow_up_question": {
			"target":             "rag-agent",
			"status":             "needs_clarification",
			"answer_text":        "",
			"follow_up_question": []any{"which campus"},
			"confidence":         "low",
		},
		"missing_follow_up_question": {
			"target":      "rag-agent",
			"status":      "needs_clarification",
			"answer_text": "",
			"confidence":  "low",
		},
		"non_object_result": {
			"target":             "rag-agent",
			"status":             "completed",
			"answer_text":        "unexpected",
			"follow_up_question": "",
			"confidence":         "high",
			"result":             []any{"not", "object"},
		},
		"non_object_error": {
			"target":             "rag-agent",
			"status":             "error",
			"answer_text":        "",
			"follow_up_question": "",
			"confidence":         "low",
			"error":              "failed",
		},
		"error_missing_retryable": {
			"target":             "rag-agent",
			"status":             "error",
			"answer_text":        "",
			"follow_up_question": "",
			"confidence":         "low",
			"error": map[string]any{
				"code":    "agent_failed",
				"message": "agent failed",
			},
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
