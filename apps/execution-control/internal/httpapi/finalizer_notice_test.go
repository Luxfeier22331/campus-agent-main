package httpapi

import (
	"testing"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/execution"
)

func TestFinalizeAgentToolResponseDoesNotInferNoticeGetAsSelectedTool(t *testing.T) {
	response, err := finalizeAgentToolResponse(
		map[string]any{
			"tool":               "campus_notice_get",
			"status":             "completed",
			"answer_text":        "已找到官方通知链接，请以原文为准。",
			"follow_up_question": "",
			"confidence":         "high",
			"result": map[string]any{
				"notice_id":    "notice:muc-spring-break-2026",
				"title":        "2026年春假安排通知",
				"source_url":   "https://www.example.edu/info/2026-spring-break.htm",
				"body_excerpt": "春假安排以官方链接为准。",
			},
		},
		"trace-finalizer-notice-get-internal",
		executionFinalizerContext{
			RuntimeDecisions: execution.RuntimeDecisionSummary{
				ScopeGateDecision:     "allow",
				PolicyGateDecision:    "allow",
				ContextPreflightState: "resolved",
				RoutingNextAction:     "delegate",
				PlanningOutcome:       "preplanned",
				SelectedTool:          "",
			},
			Handoff: &execution.RuntimeHandoff{
				ToolTarget:   "campus_notice_get",
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
		t.Fatalf("selected_tools = %#v, want no tool-facing selected tool", selectedTools)
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
	executionObservability, ok := response["observability"].(map[string]any)
	if !ok {
		t.Fatalf("observability = %#v, want object", response["observability"])
	}
	if executionObservability["selected_tool"] != "" {
		t.Fatalf(
			"execution_observability.selected_tool = %v, want empty",
			executionObservability["selected_tool"],
		)
	}
}

func TestFinalizeAgentToolResponseMarksNoticePeriodSummaryAsAnswerArtifact(t *testing.T) {
	response, err := finalizeAgentToolResponse(
		map[string]any{
			"tool":               "campus_notice_period_summary",
			"status":             "completed",
			"answer_text":        "4 月上旬奖学金通知共有两条，均为申请和答辩安排。",
			"follow_up_question": "",
			"confidence":         "high",
			"result": map[string]any{
				"outcome": "resolved_current",
			},
		},
		"trace-finalizer-notice-period-summary",
		executionFinalizerContext{
			Branch:       "delegate",
			SelectedTool: "campus_notice_period_summary",
			RuntimeDecisions: execution.RuntimeDecisionSummary{
				ScopeGateDecision:     "allow",
				PolicyGateDecision:    "allow",
				ContextPreflightState: "not_follow_up",
				RoutingNextAction:     "delegate",
				PlanningOutcome:       "preplanned",
				SelectedTool:          "campus_notice_period_summary",
			},
			WorkflowRun: &execution.WorkflowRun{
				Mode:   execution.WorkflowModeSingleStep,
				Branch: "delegate",
				State:  execution.WorkflowStateCompleted,
				HandoffChain: []execution.HandoffStep{{
					ToolTarget:   "campus_notice_period_summary",
					PayloadKind:  "campus_notice_period_summary",
					AllowedTools: []string{"campus_notice_period_summary"},
					SelectedTool: "campus_notice_period_summary",
				}},
				ContextProjections: []execution.StepOutputProjection{{
					ProjectionID:   "projection:notice_period_summary:test",
					SourceStepID:   "sdk_tool.execute.campus_notice_period_summary.1",
					ProjectionKind: execution.ProjectionKindNoticePeriodSummary,
					ContentHash:    "sha256:notice-period-summary-test",
					Payload:        map[string]any{"summary": "奖学金通知摘要"},
					Safety: execution.ProjectionSafetySummary{
						FieldsPresent: []string{"summary"},
						MaxChars:      execution.MaxNoticePeriodSummaryProjectionSummaryChars,
					},
				}},
			},
		},
	)
	if err != nil {
		t.Fatalf("finalize returned error: %v", err)
	}
	traceSummary := expectRecord(t, response["workflow_trace_summary"], "workflow_trace_summary")
	artifactKinds, ok := traceSummary["answer_artifact_kinds"].([]string)
	if !ok || len(artifactKinds) != 1 || artifactKinds[0] != "notice_period_summary" {
		t.Fatalf("answer_artifact_kinds = %#v, want notice_period_summary", traceSummary["answer_artifact_kinds"])
	}
	artifactIDs, ok := traceSummary["answer_artifact_projection_ids"].([]string)
	if !ok || len(artifactIDs) != 1 || artifactIDs[0] != "projection:notice_period_summary:test" {
		t.Fatalf(
			"answer_artifact_projection_ids = %#v, want period summary projection id",
			traceSummary["answer_artifact_projection_ids"],
		)
	}
}

func TestFinalizeAgentToolResponseUsesRecordedNoticeMultiStepWorkflowRun(t *testing.T) {
	workflowRun := execution.WorkflowRun{
		RunID:  "run-multi-001",
		Mode:   execution.WorkflowModeMultiStep,
		Branch: "multi_step",
		State:  execution.WorkflowStateCompleted,
		HandoffChain: []execution.HandoffStep{
			{
				ToolTarget:   "campus_notice_get",
				PayloadKind:  "campus_notice_get",
				AllowedTools: []string{},
				SelectedTool: "",
			},
			{
				ToolTarget:   "knowledge_query",
				PayloadKind:  "rag_request",
				AllowedTools: []string{"knowledge_query"},
				SelectedTool: "knowledge_query",
			},
		},
		Steps: []execution.WorkflowStep{
			{
				StepID:       "tool:notice:campus_notice_get",
				SpanKind:     "handoff",
				ToolTarget:   "campus_notice_get",
				Outcome:      "completed",
				ResultStatus: "completed",
			},
			{
				StepID:       "tool:knowledge_query:rag_request",
				SpanKind:     "handoff",
				ToolTarget:   "knowledge_query",
				Outcome:      "completed",
				ResultStatus: "completed",
			},
		},
		ToolCallSummaries: []execution.ToolCallSummary{
			{
				ToolCallID:        "run-multi-001:tool:knowledge_query:rag_request",
				WorkflowRunRef:    "run-multi-001",
				StepID:            "tool:knowledge_query:rag_request",
				LifecycleState:    "completed",
				ResultProjection:  "bounded_summary",
				RawResultIncluded: false,
				ToolName:          "knowledge_query",
				ToolTarget:        "knowledge_query",
				ResultStatus:      "completed",
				ArgumentSummary: map[string]any{
					"payload_kind":  "campus_notice_get",
					"selected_tool": "knowledge_query",
					"notice_id":     "notice:muc-spring-break-2026",
				},
				SourceIDs: []string{"handbook:rule-001"},
			},
		},
	}
	response, err := finalizeAgentToolResponse(
		map[string]any{
			"tool":               "knowledge_query",
			"status":             "completed",
			"answer_text":        "这条通知可按学生手册相关规定理解。",
			"follow_up_question": "",
			"confidence":         "high",
			"result": map[string]any{
				"evidence": map[string]any{
					"sources": []any{map[string]any{"doc_id": "handbook:rule-001"}},
				},
			},
			"tool_observability": map[string]any{
				"selected_tool": "knowledge_query",
			},
		},
		"trace-finalizer-multi-step",
		executionFinalizerContext{
			Branch:       "multi_step",
			SelectedTool: "knowledge_query",
			RuntimeDecisions: execution.RuntimeDecisionSummary{
				ScopeGateDecision:     "delegate",
				PolicyGateDecision:    "delegate",
				ContextPreflightState: "resolved",
				RoutingNextAction:     "delegate",
				PlanningOutcome:       "preplanned",
				SelectedTool:          "knowledge_query",
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
	if handoffChain[0]["tool"] != "campus_notice_get" || handoffChain[1]["tool"] != "knowledge_query" {
		t.Fatalf("handoff_chain = %#v, want notice -> rag", handoffChain)
	}
	selectedTools, ok := traceSummary["selected_tools"].([]string)
	if !ok || len(selectedTools) != 1 || selectedTools[0] != "knowledge_query" {
		t.Fatalf("selected_tools = %#v, want retrieval query only", traceSummary["selected_tools"])
	}
	toolCallSummaries, ok := traceSummary["tool_call_summaries"].([]map[string]any)
	if !ok || len(toolCallSummaries) != 1 {
		t.Fatalf("tool_call_summaries = %#v, want one recorded tool summary", traceSummary["tool_call_summaries"])
	}
	if toolCallSummaries[0]["tool_name"] != "knowledge_query" ||
		toolCallSummaries[0]["step_id"] != "tool:knowledge_query:rag_request" {
		t.Fatalf("tool_call_summaries[0] = %#v, want recorded rag tool summary", toolCallSummaries[0])
	}
}
