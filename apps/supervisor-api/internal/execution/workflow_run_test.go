package execution

import "testing"

func TestWorkflowRunProjectsSingleHandoffTrace(t *testing.T) {
	run := WorkflowRun{
		Mode:   WorkflowModeSingleHandoff,
		Branch: "delegate",
		State:  WorkflowStateCompleted,
		HandoffChain: []HandoffStep{
			{
				Target:       "rag-agent",
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
				Target:       "rag-agent",
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
	}

	handoffChain := run.HandoffChainMaps()
	if len(handoffChain) != 1 {
		t.Fatalf("handoff chain length = %d, want 1", len(handoffChain))
	}
	if handoffChain[0]["target"] != "rag-agent" ||
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
		t.Fatalf("finalization step = %#v, want bridge run state", steps[2])
	}
}
