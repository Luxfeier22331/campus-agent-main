package execution

import "testing"

func TestWorkflowRunProjectsSingleStepTrace(t *testing.T) {
	run := WorkflowRun{
		Mode:   WorkflowModeSingleStep,
		Branch: "delegate",
		State:  WorkflowStateCompleted,
		HandoffChain: []HandoffStep{
			{
				ToolTarget:   "knowledge_query",
				PayloadKind:  "rag_request",
				AllowedTools: []string{"knowledge_query"},
				SelectedTool: "knowledge_query",
			},
		},
		Steps: []WorkflowStep{
			{
				StepID:       "runtime_policy",
				SpanKind:     "runtime_policy",
				Outcome:      "delegate",
				ParentStepID: "",
			},
			{
				StepID:       "tool_call",
				SpanKind:     "tool_call",
				ParentStepID: "handoff",
				ToolTarget:   "knowledge_query",
				ToolName:     "knowledge_query",
				Outcome:      "completed",
				ResultStatus: "completed",
				RetryCount:   0,
			},
			{
				StepID:            "finalization",
				SpanKind:          "finalization",
				ParentStepID:      "tool_call",
				Outcome:           "completed",
				ResultStatus:      "completed",
				AttemptCount:      2,
				RuntimeRetryCount: 1,
			},
		},
		ToolInvocations: []ToolInvocation{
			{
				InvocationID:   "tool-invocation:knowledge_query:1",
				WorkflowRunRef: "run-001",
				StepID:         "tool:knowledge_query:rag_request",
				ToolTarget:     "knowledge_query",
				Status:         "completed",
				AllowedTools:   []string{"knowledge_query"},
				UsedTools:      []string{"knowledge_query"},
			},
		},
	}

	handoffChain := run.HandoffChainMaps()
	if len(handoffChain) != 1 {
		t.Fatalf("handoff chain length = %d, want 1", len(handoffChain))
	}
	if handoffChain[0]["tool"] != "knowledge_query" ||
		handoffChain[0]["selected_tool"] != "knowledge_query" {
		t.Fatalf("handoff chain = %#v, want selected rag handoff", handoffChain)
	}
	steps := run.StepMaps()
	if len(steps) != 3 {
		t.Fatalf("step count = %d, want 3", len(steps))
	}
	if steps[1]["retry_count"] != 0 {
		t.Fatalf("tool retry_count = %#v, want explicit zero", steps[1])
	}
	if steps[2]["attempt_count"] != 2 || steps[2]["runtime_retry_count"] != 1 {
		t.Fatalf("finalization step = %#v, want execution run state", steps[2])
	}
	agentInvocations := run.ToolInvocationMaps()
	if len(agentInvocations) != 1 {
		t.Fatalf("agent invocations = %#v, want one projected invocation", agentInvocations)
	}
	if agentInvocations[0]["tool_id"] != "knowledge_query" {
		t.Fatalf("agent invocation = %#v, want knowledge_query", agentInvocations[0])
	}
}

func TestHandoffStepProjectsNilAllowedToolsAsEmptyArray(t *testing.T) {
	item := HandoffStep{
		ToolTarget:  "knowledge_query",
		PayloadKind: "rag_request",
	}.Map()

	allowedTools, ok := item["allowed_tools"].([]string)
	if !ok {
		t.Fatalf("allowed_tools = %#v, want string array", item["allowed_tools"])
	}
	if allowedTools == nil {
		t.Fatal("allowed_tools is nil, want empty array projection")
	}
	if len(allowedTools) != 0 {
		t.Fatalf("allowed_tools = %#v, want empty array", allowedTools)
	}
}

func TestWorkflowRunProjectsMultiStepHandoffChain(t *testing.T) {
	run := WorkflowRun{
		Mode:   WorkflowModeMultiStep,
		Branch: "delegate",
		State:  WorkflowStateRunning,
		HandoffChain: []HandoffStep{
			{
				ToolTarget:   "knowledge_query",
				PayloadKind:  "rag_request",
				AllowedTools: []string{"knowledge_query"},
				SelectedTool: "knowledge_query",
			},
			{
				ToolTarget:   "campus_notice_get",
				PayloadKind:  "campus_notice_get",
				AllowedTools: []string{},
				SelectedTool: "",
			},
		},
	}

	handoffChain := run.HandoffChainMaps()

	if len(handoffChain) != 2 {
		t.Fatalf("handoff chain length = %d, want 2", len(handoffChain))
	}
	if handoffChain[0]["tool"] != "knowledge_query" ||
		handoffChain[1]["tool"] != "campus_notice_get" {
		t.Fatalf("handoff chain = %#v, want ordered multi-step chain", handoffChain)
	}
}
