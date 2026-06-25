package httpapi

import (
	"encoding/json"
	"fmt"
	"testing"

	contractsv1 "github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/contracts"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/execution"
)

func TestFinalizeAgentBridgeResponseBuildsExecutionEnvelope(t *testing.T) {
	response, err := finalizeAgentBridgeResponse(
		map[string]any{
			"capability":         "knowledge",
			"status":             "completed",
			"answer_text":        "图书馆开放到 22:00。",
			"follow_up_question": "",
			"confidence":         "high",
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
		executionFinalizerContext{},
	)
	if err != nil {
		t.Fatalf("finalize returned error: %v", err)
	}
	if response["selected_capability"] != "knowledge" {
		t.Fatalf("selected_capability = %v, want knowledge", response["selected_capability"])
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
	if traceSummary["selected_capability"] != "knowledge" {
		t.Fatalf("trace selected_capability = %v, want knowledge", traceSummary["selected_capability"])
	}
}

func TestTerminalExecutionResponseIncludesCanonicalNullableFields(t *testing.T) {
	response := terminalExecutionResponse(
		map[string]any{
			"selected_capability": nil,
			"status":              "no_answer",
			"answer_text":         "该请求无法进入当前已开放的校园助理执行链路。",
			"follow_up_question":  "",
			"confidence":          "low",
			"observability": map[string]any{
				"fail_closed": true,
			},
		},
		"trace-terminal-canonical",
		executionFinalizerContext{
			Branch: "terminal",
			RuntimeDecisions: execution.RuntimeDecisionSummary{
				ContextPreflightState: "not_follow_up",
				FailCloseReason:       "capability_spec_admission_failed",
				PlanningOutcome:       "invalid_plan",
				PolicyGateDecision:    "delegate",
				RoutingNextAction:     "delegate",
				ScopeGateDecision:     "in_scope",
			},
		},
	)

	if _, exists := response["result"]; !exists {
		t.Fatal("terminal response missing result key")
	}
	if response["result"] != nil {
		t.Fatalf("result = %#v, want nil", response["result"])
	}
	if _, exists := response["error"]; !exists {
		t.Fatal("terminal response missing error key")
	}
	if response["error"] != nil {
		t.Fatalf("error = %#v, want nil", response["error"])
	}

	rawResponse, err := json.Marshal(response)
	if err != nil {
		t.Fatalf("marshal terminal response: %v", err)
	}
	if _, err := contractsv1.DecodeCapabilityExecutionResponseWireJSON(rawResponse); err != nil {
		t.Fatalf("decode terminal execution response wire: %v; body=%s", err, string(rawResponse))
	}
}

func TestFinalizeAgentBridgeResponseRoundTripsThroughCanonicalWorkflowTraceWire(t *testing.T) {
	response, err := finalizeAgentBridgeResponse(
		map[string]any{
			"capability":         "knowledge",
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
		"trace-finalizer-canonical-wire",
		executionFinalizerContext{
			RuntimeDecisions: execution.RuntimeDecisionSummary{
				ScopeGateDecision:     "allow",
				PolicyGateDecision:    "allow",
				ContextPreflightState: "not_follow_up",
				RoutingNextAction:     "delegate",
				PlanningOutcome:       "preplanned",
				SelectedCapability:    "knowledge",
				SelectedTool:          "retrieval.query",
			},
			Handoff: &execution.RuntimeHandoff{
				Capability:   "knowledge",
				PayloadKind:  "rag_request",
				Payload:      map[string]any{"scope": map[string]any{"corpus": "regulations", "collection": "student_rules"}},
				AllowedTools: []string{"retrieval.query"},
			},
			Branch:             "delegate",
			SelectedTool:       "retrieval.query",
			BridgeAttemptCount: 2,
			BridgeRetryCount:   1,
		},
	)
	if err != nil {
		t.Fatalf("finalize returned error: %v", err)
	}
	rawResponse, err := json.Marshal(response)
	if err != nil {
		t.Fatalf("marshal finalized response: %v", err)
	}
	wire, err := contractsv1.DecodeCapabilityExecutionResponseWireJSON(rawResponse)
	if err != nil {
		t.Fatalf("decode canonical execution response wire: %v; body=%s", err, string(rawResponse))
	}
	if wire.WorkflowTraceSummary == nil {
		t.Fatal("workflow trace summary is nil")
	}
	if wire.WorkflowTraceSummary.WorkflowMode != "single_step" {
		t.Fatalf("workflow_mode = %v, want single_step", wire.WorkflowTraceSummary.WorkflowMode)
	}
	if wire.WorkflowTraceSummary.SelectedCapability == nil ||
		*wire.WorkflowTraceSummary.SelectedCapability != "knowledge" {
		t.Fatalf("selected_capability = %#v, want knowledge", wire.WorkflowTraceSummary.SelectedCapability)
	}
	if len(wire.WorkflowTraceSummary.TraceSteps) == 0 {
		t.Fatal("trace steps are empty")
	}
	finalization := wire.WorkflowTraceSummary.TraceSteps[len(wire.WorkflowTraceSummary.TraceSteps)-1]
	if finalization["attempt_count"] != float64(2) ||
		finalization["runtime_retry_count"] != float64(1) {
		t.Fatalf("finalization step = %#v, want attempt/retry counts", finalization)
	}
}

func TestFinalizeAgentBridgeResponseProjectsWorkflowTraceSummary(t *testing.T) {
	response, err := finalizeAgentBridgeResponse(
		map[string]any{
			"capability":         "campus_services",
			"status":             "completed",
			"answer_text":        "当前班车正常运行。",
			"follow_up_question": "",
			"confidence":         "high",
			"result": map[string]any{
				"outcome":             "resolved_current",
				"related_notice_refs": []any{"notice:muc_internal_portal:353903"},
			},
			"capability_observability": map[string]any{
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
		executionFinalizerContext{
			RuntimeDecisions: execution.RuntimeDecisionSummary{
				ScopeGateDecision:     "allow",
				PolicyGateDecision:    "allow",
				ContextPreflightState: "not_follow_up",
				RoutingNextAction:     "delegate",
				PlanningOutcome:       "preplanned",
				SelectedCapability:    "campus_services",
				SelectedTool:          "transport_schedule_lookup",
			},
			Handoff: &execution.RuntimeHandoff{
				Capability:   "campus_services",
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
	if traceSummary["workflow_mode"] != "single_step" {
		t.Fatalf("workflow_mode = %v, want single_step", traceSummary["workflow_mode"])
	}
	handoffChain, ok := traceSummary["handoff_chain"].([]map[string]any)
	if !ok || len(handoffChain) != 1 || handoffChain[0]["capability"] != "campus_services" {
		t.Fatalf(
			"handoff_chain = %#v, want single campus_services handoff",
			traceSummary["handoff_chain"],
		)
	}
	agentInvocations, ok := traceSummary["capability_invocations"].([]map[string]any)
	if !ok || len(agentInvocations) != 1 || agentInvocations[0]["capability_id"] != "campus_services" {
		t.Fatalf("capability_invocations = %#v, want campus_services invocation", traceSummary["capability_invocations"])
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

func TestWorkflowSourceIDsCollectsStringSliceRefs(t *testing.T) {
	sourceIDs := workflowSourceIDs(map[string]any{
		"outcome":     "resolved_current",
		"source_refs": []string{"official_web:campus-card-guide"},
		"nested": map[string]any{
			"related_notice_refs": []string{"notice:muc_internal_portal:353903"},
		},
	})

	if len(sourceIDs) != 2 ||
		sourceIDs[0] != "notice:muc_internal_portal:353903" ||
		sourceIDs[1] != "official_web:campus-card-guide" {
		t.Fatalf("sourceIDs = %#v, want stable sorted string slice source refs", sourceIDs)
	}
}

func TestWorkflowSelectedToolsFromRunDoesNotSynthesizeFallbackTool(t *testing.T) {
	selected := workflowTraceSelectedTools(
		execution.WorkflowRun{
			Mode:         execution.WorkflowModeSingleStep,
			HandoffChain: []execution.HandoffStep{{Capability: "campus_services"}},
		},
		&execution.RuntimeHandoff{Capability: "campus_services"},
		"transport_schedule_lookup",
	)

	if len(selected) != 0 {
		t.Fatalf("selected tools = %#v, want empty when run has no selected tool", selected)
	}
}

func TestWorkflowSummarySourceIDsDoesNotSynthesizeProjectionIDs(t *testing.T) {
	sourceIDs := workflowSummarySourceIDs(
		map[string]any{"outcome": "resolved_current"},
		map[string]any{},
	)

	if len(sourceIDs) != 0 {
		t.Fatalf("sourceIDs = %#v, want empty when result and safe details have no source refs", sourceIDs)
	}
}

func TestWorkflowSummarySourceIDsUsesExplicitSafeDetails(t *testing.T) {
	sourceIDs := workflowSummarySourceIDs(
		map[string]any{"outcome": "resolved_current"},
		map[string]any{
			"safe_details": map[string]any{
				"source_refs_used": []any{"notice:smoke:001"},
			},
		},
	)

	if len(sourceIDs) != 1 || sourceIDs[0] != "notice:smoke:001" {
		t.Fatalf("sourceIDs = %#v, want explicit source_refs_used", sourceIDs)
	}
}

func TestFinalizeAgentBridgeResponseRejectsDelegateBranchWithoutHandoff(t *testing.T) {
	_, err := finalizeAgentBridgeResponse(
		map[string]any{
			"capability":         "campus_services",
			"status":             "completed",
			"answer_text":        "当前班车正常运行。",
			"follow_up_question": "",
			"confidence":         "high",
		},
		"trace-finalizer-missing-handoff",
		executionFinalizerContext{
			Branch: "delegate",
			RuntimeDecisions: execution.RuntimeDecisionSummary{
				PlanningOutcome:    "preplanned",
				RoutingNextAction:  "delegate",
				SelectedCapability: "campus_services",
				SelectedTool:       "transport_schedule_lookup",
			},
		},
	)

	if err == nil {
		t.Fatal("expected delegate branch without handoff to be rejected")
	}
}

func TestFinalizeAgentBridgeResponseRejectsSelectedCapabilityMismatch(t *testing.T) {
	_, err := finalizeAgentBridgeResponse(
		map[string]any{
			"capability":         "notice",
			"status":             "completed",
			"answer_text":        "通知详情。",
			"follow_up_question": "",
			"confidence":         "high",
		},
		"trace-finalizer-target-mismatch",
		executionFinalizerContext{
			Branch: "delegate",
			RuntimeDecisions: execution.RuntimeDecisionSummary{
				PlanningOutcome:    "preplanned",
				RoutingNextAction:  "delegate",
				SelectedCapability: "campus_services",
				SelectedTool:       "transport_schedule_lookup",
			},
			Handoff: &execution.RuntimeHandoff{
				Capability:   "campus_services",
				PayloadKind:  "transport_schedule_lookup",
				Payload:      map[string]any{"query_text": "今天去丰台最早班车"},
				AllowedTools: []string{"transport_schedule_lookup"},
			},
			SelectedTool: "transport_schedule_lookup",
		},
	)

	if err == nil {
		t.Fatal("expected selected capability mismatch to be rejected")
	}
}

func TestFinalizeAgentBridgeResponseProjectsActualToolCallsAndVersions(t *testing.T) {
	response, err := finalizeAgentBridgeResponse(
		map[string]any{
			"capability":         "campus_services",
			"status":             "completed",
			"answer_text":        "海淀到丰台最早班车为 06:50。",
			"follow_up_question": "",
			"confidence":         "high",
			"result": map[string]any{
				"outcome":             "resolved_current",
				"related_notice_refs": []any{"notice:muc_internal_portal:353903"},
			},
			"capability_observability": map[string]any{
				"selected_tool":    "transport_schedule_lookup",
				"tool_attempted":   true,
				"tool_outcome":     "resolved_current",
				"source_ref_count": float64(1),
				"access_decision":  "allowed",
				"safe_details": map[string]any{
					"agent_execution_projection": map[string]any{
						"schema_version":        "agent-execution-projection-v1",
						"projection_owner":      "campus_services",
						"selected_tool":         "transport_schedule_lookup",
						"payload_kind":          "transport_schedule_lookup",
						"tool_selection_reason": "typed_payload_allowed_tool",
					},
					"provider_tool_call_projection": map[string]any{
						"schema_version":        "provider-tool-call-projection-v1",
						"tool_call_id_source":   "repo",
						"model_tool_call_ref":   "call-safe-123",
						"model_response_ref":    "resp-safe-456",
						"tool_output_submitted": true,
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
		executionFinalizerContext{
			RuntimeDecisions: execution.RuntimeDecisionSummary{
				ScopeGateDecision:     "allow",
				PolicyGateDecision:    "allow",
				ContextPreflightState: "not_follow_up",
				RoutingNextAction:     "delegate",
				PlanningOutcome:       "preplanned",
				SelectedCapability:    "campus_services",
				SelectedTool:          "transport_schedule_lookup",
				RuntimeVersions: map[string]any{
					"execution_control_runtime": "go-runtime-control-plane-v1",
				},
				PolicyArtifactVersions: map[string]any{
					"intent_classifier": "go-runtime-policy-v2",
				},
			},
			Handoff: &execution.RuntimeHandoff{
				Capability:  "campus_services",
				PayloadKind: "transport_schedule_lookup",
				Payload: map[string]any{
					"query_text": "今天去丰台最早班车",
					"route_selector": map[string]any{
						"destination_campus": "fengtai",
						"origin_campus":      "haidian",
					},
					"service_time_query": map[string]any{
						"date_mode": "today",
						"daypart":   "morning",
					},
				},
				AllowedTools: []string{"transport_schedule_lookup"},
			},
			Branch:       "delegate",
			SelectedTool: "transport_schedule_lookup",
		},
	)
	if err != nil {
		t.Fatalf("finalize returned error: %v", err)
	}
	traceSummary := response["workflow_trace_summary"].(map[string]any)
	selectedTools, ok := traceSummary["selected_tools"].([]string)
	if !ok || len(selectedTools) != 1 || selectedTools[0] != "transport_schedule_lookup" {
		t.Fatalf("selected_tools = %#v, want actual transport_schedule_lookup only", traceSummary["selected_tools"])
	}
	toolCalls, ok := traceSummary["tool_call_summaries"].([]map[string]any)
	if !ok || len(toolCalls) != 1 {
		t.Fatalf("tool_call_summaries = %#v, want one tool call", traceSummary["tool_call_summaries"])
	}
	toolCall := toolCalls[0]
	if toolCall["tool_name"] != "transport_schedule_lookup" {
		t.Fatalf("tool_name = %v, want transport_schedule_lookup", toolCall["tool_name"])
	}
	if toolCall["schema_version"] != "tool-call-summary-v1" ||
		toolCall["tool_call_id"] != "single_step:campus_services:transport_schedule_lookup:tool_call" ||
		toolCall["workflow_run_ref"] != "single_step:campus_services:transport_schedule_lookup" ||
		toolCall["step_id"] != "tool_call" ||
		toolCall["lifecycle_state"] != "completed" ||
		toolCall["result_projection"] != "bounded_summary" ||
		toolCall["raw_result_included"] != false {
		t.Fatalf("tool call lifecycle projection = %#v, want canonical bounded lifecycle fields", toolCall)
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
	routeSelector, routeSelectorOK := argumentSummary["route_selector"].(map[string]any)
	if !ok || !routeSelectorOK || routeSelector["destination_campus"] != "fengtai" {
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
	executionProjection, ok := safeDetails["agent_execution_projection"].(map[string]any)
	if !ok || executionProjection["schema_version"] != "agent-execution-projection-v1" {
		t.Fatalf(
			"agent_execution_projection = %#v, want versioned execution projection",
			safeDetails["agent_execution_projection"],
		)
	}
	if _, exists := safeDetails["agent_plan"]; exists {
		t.Fatalf("agent_plan = %#v, want absent for deterministic projection", safeDetails["agent_plan"])
	}
	providerProjection, ok := safeDetails["provider_tool_call_projection"].(map[string]any)
	if !ok ||
		providerProjection["tool_call_id_source"] != "repo" ||
		providerProjection["model_tool_call_ref"] != "call-safe-123" ||
		providerProjection["model_response_ref"] != "resp-safe-456" ||
		providerProjection["tool_output_submitted"] != true {
		t.Fatalf(
			"provider_tool_call_projection = %#v, want safe provider call correlation",
			safeDetails["provider_tool_call_projection"],
		)
	}
	topLevelProviderProjection, ok := toolCall["provider_tool_call_projection"].(map[string]any)
	if !ok || topLevelProviderProjection["model_tool_call_ref"] != "call-safe-123" {
		t.Fatalf(
			"tool_call provider_tool_call_projection = %#v, want top-level safe provider correlation",
			toolCall["provider_tool_call_projection"],
		)
	}
	resultGuardrail, ok := safeDetails["result_guardrail"].(map[string]any)
	if !ok || resultGuardrail["outcome"] != "source_backed" {
		t.Fatalf("result_guardrail = %#v, want source-backed result guardrail", safeDetails["result_guardrail"])
	}
	runtimeVersions, ok := traceSummary["runtime_versions"].(map[string]any)
	if !ok || runtimeVersions["execution_control_runtime"] != "go-runtime-control-plane-v1" {
		t.Fatalf("runtime_versions = %#v, want execution_control_runtime", traceSummary["runtime_versions"])
	}
	if fmt.Sprint(runtimeVersions["workflow_trace_summary"]) != "workflow-trace-summary-v4" {
		t.Fatalf("runtime_versions = %#v, want workflow trace summary version", runtimeVersions)
	}
	policyVersions, ok := traceSummary["policy_artifact_versions"].(map[string]any)
	if !ok || policyVersions["intent_classifier"] != "go-runtime-policy-v2" {
		t.Fatalf("policy_artifact_versions = %#v, want intent_classifier", traceSummary["policy_artifact_versions"])
	}
}
