package execution

import "testing"

func TestWorkflowRunProjectsSingleStepTrace(t *testing.T) {
	run := WorkflowRun{
		Mode:   WorkflowModeSingleStep,
		Branch: "delegate",
		State:  WorkflowStateCompleted,
		HandoffChain: []HandoffStep{
			{
				Capability:   "knowledge",
				PayloadKind:  "rag_request",
				AllowedTools: []string{"retrieval.query"},
				SelectedTool: "retrieval.query",
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
				Capability:   "knowledge",
				ToolName:     "retrieval.query",
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
		CapabilityInvocations: []CapabilityInvocation{
			{
				InvocationID:   "capability-invocation:knowledge:1",
				WorkflowRunRef: "run-001",
				StepID:         "capability:knowledge:rag_request",
				CapabilityID:   "knowledge",
				Status:         "completed",
				AllowedTools:   []string{"retrieval.query"},
				UsedTools:      []string{"retrieval.query"},
			},
		},
	}

	handoffChain := run.HandoffChainMaps()
	if len(handoffChain) != 1 {
		t.Fatalf("handoff chain length = %d, want 1", len(handoffChain))
	}
	if handoffChain[0]["capability"] != "knowledge" ||
		handoffChain[0]["selected_tool"] != "retrieval.query" {
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
		t.Fatalf("finalization step = %#v, want runtime run state", steps[2])
	}
	agentInvocations := run.CapabilityInvocationMaps()
	if len(agentInvocations) != 1 {
		t.Fatalf("agent invocations = %#v, want one projected invocation", agentInvocations)
	}
	if agentInvocations[0]["capability_id"] != "knowledge" {
		t.Fatalf("agent invocation = %#v, want knowledge", agentInvocations[0])
	}
}

func TestHandoffStepProjectsNilAllowedToolsAsEmptyArray(t *testing.T) {
	item := HandoffStep{
		Capability:  "knowledge",
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
				Capability:   "knowledge",
				PayloadKind:  "rag_request",
				AllowedTools: []string{"retrieval.query"},
				SelectedTool: "retrieval.query",
			},
			{
				Capability:   "notice",
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
	if handoffChain[0]["capability"] != "knowledge" ||
		handoffChain[1]["capability"] != "notice" {
		t.Fatalf("handoff chain = %#v, want ordered multi-step chain", handoffChain)
	}
}
