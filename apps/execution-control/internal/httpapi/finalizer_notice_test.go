package httpapi

import (
	"testing"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/execution"
)

func TestFinalizeAgentBridgeResponseDoesNotInferNoticeGetAsSelectedTool(t *testing.T) {
	response, err := finalizeAgentBridgeResponse(
		map[string]any{
			"target":             "notice-agent",
			"status":             "completed",
			"answer_text":        "已找到官方通知链接，请以原文为准。",
			"follow_up_question": "",
			"confidence":         "high",
			"result": map[string]any{
				"notice_id":    "notice:muc-spring-break-2026",
				"title":        "2026年春假安排通知",
				"source_url":   "https://www.muc.edu.cn/info/2026-spring-break.htm",
				"body_excerpt": "春假安排以官方链接为准。",
			},
		},
		"trace-finalizer-notice-get-internal",
		supervisorFinalizerContext{
			RuntimeDecisions: execution.RuntimeDecisionSummary{
				ScopeGateDecision:     "allow",
				PolicyGateDecision:    "allow",
				ContextPreflightState: "resolved",
				RoutingNextAction:     "delegate",
				PlanningOutcome:       "preplanned",
				SelectedTarget:        "notice-agent",
			},
			Handoff: &execution.RuntimeHandoff{
				Target:       "notice-agent",
				PayloadKind:  "campus_notice_get",
				Payload:      map[string]any{"notice_id": "notice:muc-spring-break-2026"},
				AllowedTools: []string{},
			},
			Branch: "delegate",
		},
	)
	if err != nil {
		t.Fatalf("finalize returned error: %v", err)
	}
	traceSummary, ok := response["workflow_trace_summary"].(map[string]any)
	if !ok {
		t.Fatalf("workflow_trace_summary = %#v, want object", response["workflow_trace_summary"])
	}
	selectedTools, ok := traceSummary["selected_tools"].([]string)
	if !ok || len(selectedTools) != 0 {
		t.Fatalf("selected_tools = %#v, want no agent-facing selected tool", selectedTools)
	}
	toolSummary, ok := traceSummary["tool_argument_summary"].(map[string]any)
	if !ok {
		t.Fatalf("tool_argument_summary = %#v, want object", traceSummary["tool_argument_summary"])
	}
	if _, exists := toolSummary["selected_tool"]; exists {
		t.Fatalf("tool_argument_summary.selected_tool = %v, want absent", toolSummary["selected_tool"])
	}
	if toolSummary["payload_kind"] != "campus_notice_get" {
		t.Fatalf("payload_kind = %v, want internal campus_notice_get", toolSummary["payload_kind"])
	}
	toolCalls, ok := traceSummary["tool_call_summaries"].([]map[string]any)
	if !ok || len(toolCalls) != 0 {
		t.Fatalf("tool_call_summaries = %#v, want none for internal notice resolve", toolCalls)
	}
	supervisorObservability, ok := response["observability"].(map[string]any)
	if !ok {
		t.Fatalf("observability = %#v, want object", response["observability"])
	}
	if supervisorObservability["selected_tool"] != "" {
		t.Fatalf(
			"supervisor_observability.selected_tool = %v, want empty",
			supervisorObservability["selected_tool"],
		)
	}
}

func TestFinalizeAgentBridgeResponseUsesRecordedNoticeMultiStepWorkflowRun(t *testing.T) {
	workflowRun := execution.WorkflowRun{
		RunID:  "run-multi-001",
		Mode:   execution.WorkflowModeMultiStep,
		Branch: "multi_step",
		State:  execution.WorkflowStateCompleted,
		HandoffChain: []execution.HandoffStep{
			{
				Target:       "notice-agent",
				PayloadKind:  "campus_notice_get",
				AllowedTools: []string{},
				SelectedTool: "",
			},
			{
				Target:       "rag-agent",
				PayloadKind:  "rag_request",
				AllowedTools: []string{"retrieval.query"},
				SelectedTool: "retrieval.query",
			},
		},
		Steps: []execution.WorkflowStep{
			{
				StepID:       "handoff:notice-agent:campus_notice_get",
				SpanKind:     "handoff",
				Target:       "notice-agent",
				Outcome:      "completed",
				ResultStatus: "completed",
			},
			{
				StepID:       "handoff:rag-agent:rag_request",
				SpanKind:     "handoff",
				Target:       "rag-agent",
				Outcome:      "completed",
				ResultStatus: "completed",
			},
		},
		ToolCallSummaries: []execution.ToolCallSummary{
			{
				ToolCallID:        "run-multi-001:handoff:rag-agent:rag_request",
				WorkflowRunRef:    "run-multi-001",
				StepID:            "handoff:rag-agent:rag_request",
				LifecycleState:    "completed",
				ResultProjection:  "bounded_summary",
				RawResultIncluded: false,
				ToolName:          "retrieval.query",
				Target:            "rag-agent",
				ResultStatus:      "completed",
				ArgumentSummary: map[string]any{
					"payload_kind":  "campus_notice_get",
					"selected_tool": "retrieval.query",
					"notice_id":     "notice:muc-spring-break-2026",
				},
				SourceIDs: []string{"handbook:rule-001"},
			},
		},
	}
	response, err := finalizeAgentBridgeResponse(
		map[string]any{
			"target":             "rag-agent",
			"status":             "completed",
			"answer_text":        "这条通知可按学生手册相关规定理解。",
			"follow_up_question": "",
			"confidence":         "high",
			"result": map[string]any{
				"evidence": map[string]any{
					"sources": []any{map[string]any{"doc_id": "handbook:rule-001"}},
				},
			},
			"agent_observability": map[string]any{
				"selected_tool": "retrieval.query",
			},
		},
		"trace-finalizer-multi-step",
		supervisorFinalizerContext{
			Branch:       "multi_step",
			SelectedTool: "retrieval.query",
			RuntimeDecisions: execution.RuntimeDecisionSummary{
				ScopeGateDecision:     "delegate",
				PolicyGateDecision:    "delegate",
				ContextPreflightState: "resolved",
				RoutingNextAction:     "delegate",
				PlanningOutcome:       "preplanned",
				SelectedTarget:        "rag-agent",
				SelectedTool:          "retrieval.query",
			},
			WorkflowRun: &workflowRun,
		},
	)
	if err != nil {
		t.Fatalf("finalize returned error: %v", err)
	}
	traceSummary := expectRecord(t, response["workflow_trace_summary"], "workflow_trace_summary")
	if traceSummary["workflow_mode"] != "multi_step" {
		t.Fatalf("workflow_mode = %v, want multi_step", traceSummary["workflow_mode"])
	}
	handoffChain, ok := traceSummary["handoff_chain"].([]map[string]any)
	if !ok || len(handoffChain) != 2 {
		t.Fatalf("handoff_chain = %#v, want two handoffs", traceSummary["handoff_chain"])
	}
	if handoffChain[0]["target"] != "notice-agent" || handoffChain[1]["target"] != "rag-agent" {
		t.Fatalf("handoff_chain = %#v, want notice -> rag", handoffChain)
	}
	selectedTools, ok := traceSummary["selected_tools"].([]string)
	if !ok || len(selectedTools) != 1 || selectedTools[0] != "retrieval.query" {
		t.Fatalf("selected_tools = %#v, want retrieval query only", traceSummary["selected_tools"])
	}
	toolCallSummaries, ok := traceSummary["tool_call_summaries"].([]map[string]any)
	if !ok || len(toolCallSummaries) != 1 {
		t.Fatalf("tool_call_summaries = %#v, want one recorded tool summary", traceSummary["tool_call_summaries"])
	}
	if toolCallSummaries[0]["tool_name"] != "retrieval.query" ||
		toolCallSummaries[0]["step_id"] != "handoff:rag-agent:rag_request" {
		t.Fatalf("tool_call_summaries[0] = %#v, want recorded rag tool summary", toolCallSummaries[0])
	}
}
