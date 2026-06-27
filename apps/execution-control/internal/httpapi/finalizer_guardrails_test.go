package httpapi

import (
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/execution"
	"testing"
)

func TestFinalizerContextFromExecutionRequestCarriesVersionProvenance(t *testing.T) {
	context := finalizerContextFromExecutionRequest(
		execution.AnswerExecutionRequest{
			RuntimeDecisions: execution.RuntimeDecisionSummary{
				SelectedTool: "knowledge_query",
				RuntimeVersions: map[string]any{
					"execution_contract": "tool_execution_v1",
				},
				PolicyArtifactVersions: map[string]any{
					"intent_case_set": "intent-case-set-v2",
				},
			},
		},
		"delegate",
	)

	if context.RuntimeVersions["execution_contract"] != "tool_execution_v1" {
		t.Fatalf("runtime versions = %#v, want tool execution contract", context.RuntimeVersions)
	}
	if context.PolicyVersions["intent_case_set"] != "intent-case-set-v2" {
		t.Fatalf("policy versions = %#v, want intent case set", context.PolicyVersions)
	}
}

func TestTerminalExecutionResponseClassifiesClarificationAndFailCloseBranches(t *testing.T) {
	clarification := terminalExecutionResponse(
		map[string]any{
			"selected_tool": "transport_schedule_lookup",
			"status":        "needs_clarification",
			"result": map[string]any{
				"clarification_reason": "route_direction_required",
			},
		},
		"trace-terminal-clarification",
		executionFinalizerContext{
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
	if clarificationTrace["selected_tool"] != "none" {
		t.Fatalf("clarification selected_tool = %v, want none", clarificationTrace["selected_tool"])
	}
	if clarificationTrace["direct_vs_delegate_branch"] != "clarification" {
		t.Fatalf("clarification branch = %v, want clarification", clarificationTrace["direct_vs_delegate_branch"])
	}

	failClose := terminalExecutionResponse(
		map[string]any{
			"selected_tool": "transport_schedule_lookup",
			"status":        "no_answer",
			"result": map[string]any{
				"fail_close_reason": "transactional_action_not_supported",
			},
		},
		"trace-terminal-fail-close",
		executionFinalizerContext{
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
	if failCloseTrace["selected_tool"] != "none" {
		t.Fatalf("fail-close selected_tool = %v, want none", failCloseTrace["selected_tool"])
	}
	if failCloseTrace["direct_vs_delegate_branch"] != "fail_close" {
		t.Fatalf("fail-close branch = %v, want fail_close", failCloseTrace["direct_vs_delegate_branch"])
	}
}

func TestFinalizeAgentToolResponseProjectsSafeRagToolArguments(t *testing.T) {
	response, err := finalizeAgentToolResponse(
		map[string]any{
			"tool":               "knowledge_query",
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
		executionFinalizerContext{
			RuntimeDecisions: execution.RuntimeDecisionSummary{
				ScopeGateDecision:  "allow",
				PolicyGateDecision: "allow",
				RoutingNextAction:  "delegate",
				PlanningOutcome:    "preplanned",
				SelectedTool:       "knowledge_query",
			},
			Handoff: &execution.RuntimeHandoff{
				ToolTarget:   "knowledge_query",
				PayloadKind:  "rag_request",
				Payload:      map[string]any{"scope": map[string]any{"corpus": "regulations", "collection": "student_rules"}},
				AllowedTools: []string{"knowledge_query"},
			},
			Branch:       "delegate",
			SelectedTool: "knowledge_query",
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
	if observability["selected_tool"] != "knowledge_query" {
		t.Fatalf("observability selected_tool = %v, want knowledge_query", observability["selected_tool"])
	}
}

func TestWorkflowHandoffSummaryProjectsNilAllowedToolsAsEmptyArray(t *testing.T) {
	summary := workflowHandoffSummary(&execution.RuntimeHandoff{
		ToolTarget:  "knowledge_query",
		PayloadKind: "rag_request",
	}, "knowledge_query", "knowledge_query")

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

func TestFinalizeAgentToolResponseRejectsRawToolObservabilityKeys(t *testing.T) {
	_, err := finalizeAgentToolResponse(
		map[string]any{
			"tool":               "transport_schedule_lookup",
			"status":             "completed",
			"answer_text":        "unexpected",
			"follow_up_question": "",
			"confidence":         "high",
			"tool_observability": map[string]any{
				"safe_details": map[string]any{
					"providerRawResponse": "forbidden",
				},
			},
		},
		"trace-finalizer-raw-agent-observability",
		executionFinalizerContext{},
	)

	if err == nil {
		t.Fatal("expected raw agent observability to be rejected")
	}
}

func TestFinalizeAgentToolResponseRejectsRawRagSdkResultDiagnostics(t *testing.T) {
	_, err := finalizeAgentToolResponse(
		map[string]any{
			"tool":               "knowledge_query",
			"status":             "completed",
			"answer_text":        "本科生可申请国家奖学金。",
			"follow_up_question": "",
			"confidence":         "medium",
			"result": map[string]any{
				"diagnostics": map[string]any{
					"model_execution_state": "rag_sdk_completed",
					"rag_sdk_trace_projection": map[string]any{
						"schema_version": "rag-sdk-trace-projection-v1",
						"rawPrompt":      "forbidden",
					},
				},
			},
			"tool_observability": map[string]any{
				"selected_tool":  "knowledge_query",
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
		executionFinalizerContext{
			RuntimeDecisions: execution.RuntimeDecisionSummary{
				ScopeGateDecision:  "allow",
				PolicyGateDecision: "allow",
				RoutingNextAction:  "delegate",
				PlanningOutcome:    "preplanned",
				SelectedTool:       "knowledge_query",
			},
			Handoff: &execution.RuntimeHandoff{
				ToolTarget:   "knowledge_query",
				PayloadKind:  "rag_request",
				Payload:      map[string]any{"scope": map[string]any{"corpus": "regulations", "collection": "student_rules"}},
				AllowedTools: []string{"knowledge_query"},
			},
			Branch:       "delegate",
			SelectedTool: "knowledge_query",
		},
	)

	if err == nil {
		t.Fatal("expected raw RAG SDK result diagnostics to be rejected")
	}
}

func TestFinalizeAgentToolResponseRejectsUnsupportedTarget(t *testing.T) {
	_, err := finalizeAgentToolResponse(
		map[string]any{
			"tool":        "unexpected-tool",
			"status":      "completed",
			"answer_text": "unexpected",
			"confidence":  "high",
		},
		"trace-finalizer-invalid-target",
		executionFinalizerContext{},
	)

	if err == nil {
		t.Fatal("expected unsupported target to be rejected")
	}
}

func TestFinalizeAgentToolResponseDoesNotInferSelectedToolFromStructuredResult(t *testing.T) {
	response, err := finalizeAgentToolResponse(
		map[string]any{
			"tool":               "transport_schedule_lookup",
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
		executionFinalizerContext{
			Branch: "delegate",
			RuntimeDecisions: execution.RuntimeDecisionSummary{
				SelectedTool:      "transport_schedule_lookup",
				RoutingNextAction: "delegate",
				PlanningOutcome:   "preplanned",
			},
			Handoff: &execution.RuntimeHandoff{
				ToolTarget:   "transport_schedule_lookup",
				PayloadKind:  "transport_schedule_lookup",
				AllowedTools: []string{"transport_schedule_lookup"},
			},
		},
	)
	if err != nil {
		t.Fatalf("finalize returned error: %v", err)
	}

	observability := response["observability"].(map[string]any)
	if observability["selected_tool"] != "transport_schedule_lookup" {
		t.Fatalf("observability selected_tool = %v, want explicit transport_schedule_lookup", observability["selected_tool"])
	}

	traceSummary := response["workflow_trace_summary"].(map[string]any)
	selectedTools, ok := traceSummary["selected_tools"].([]string)
	if !ok {
		t.Fatalf("selected_tools = %#v, want string array", traceSummary["selected_tools"])
	}
	if len(selectedTools) != 1 || selectedTools[0] != "transport_schedule_lookup" {
		t.Fatalf("selected_tools = %#v, want explicit transport_schedule_lookup", selectedTools)
	}
}

func TestFinalizeAgentToolResponseRejectsUnsupportedConfidence(t *testing.T) {
	_, err := finalizeAgentToolResponse(
		map[string]any{
			"tool":        "knowledge_query",
			"status":      "completed",
			"answer_text": "unexpected",
			"confidence":  "certain",
		},
		"trace-finalizer-invalid-confidence",
		executionFinalizerContext{},
	)

	if err == nil {
		t.Fatal("expected unsupported confidence to be rejected")
	}
}

func TestFinalizeAgentToolResponseRejectsMalformedScalarFields(t *testing.T) {
	for name, body := range map[string]map[string]any{
		"non_string_confidence": {
			"tool":               "knowledge_query",
			"status":             "completed",
			"answer_text":        "unexpected",
			"follow_up_question": "",
			"confidence":         true,
		},
		"missing_confidence": {
			"tool":               "knowledge_query",
			"status":             "completed",
			"answer_text":        "unexpected",
			"follow_up_question": "",
		},
		"non_string_answer_text": {
			"tool":               "knowledge_query",
			"status":             "completed",
			"answer_text":        123,
			"follow_up_question": "",
			"confidence":         "high",
		},
		"missing_answer_text": {
			"tool":               "knowledge_query",
			"status":             "completed",
			"follow_up_question": "",
			"confidence":         "high",
		},
		"non_string_follow_up_question": {
			"tool":               "knowledge_query",
			"status":             "needs_clarification",
			"answer_text":        "",
			"follow_up_question": []any{"which campus"},
			"confidence":         "low",
		},
		"missing_follow_up_question": {
			"tool":        "knowledge_query",
			"status":      "needs_clarification",
			"answer_text": "",
			"confidence":  "low",
		},
		"non_object_result": {
			"tool":               "knowledge_query",
			"status":             "completed",
			"answer_text":        "unexpected",
			"follow_up_question": "",
			"confidence":         "high",
			"result":             []any{"not", "object"},
		},
		"non_object_error": {
			"tool":               "knowledge_query",
			"status":             "error",
			"answer_text":        "",
			"follow_up_question": "",
			"confidence":         "low",
			"error":              "failed",
		},
		"error_missing_retryable": {
			"tool":               "knowledge_query",
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
			_, err := finalizeAgentToolResponse(
				body,
				"trace-finalizer-malformed",
				executionFinalizerContext{},
			)

			if err == nil {
				t.Fatal("expected malformed agent response to be rejected")
			}
		})
	}
}
