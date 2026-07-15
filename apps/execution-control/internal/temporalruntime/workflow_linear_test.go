package temporalruntime

import (
	"testing"
	"time"

	"github.com/stretchr/testify/mock"
	"go.temporal.io/sdk/testsuite"
)

func TestToolExecutionWorkflowOwnsOnlyTheDurableFourStageShell(t *testing.T) {
	var suite testsuite.WorkflowTestSuite
	env := suite.NewTestWorkflowEnvironment()
	registerWorkflowTestActivities(env, &Activities{})
	sequence := make([]string, 0, 4)
	runID := "run-linear-knowledge"
	traceID := "trace-linear-knowledge"
	agentResultRef := "projection://runs/" + runID + "/agent/primary/result"
	completedAt := time.Date(2026, 7, 11, 1, 2, 3, 0, time.UTC)

	env.OnActivity(MemoryRecallActivityName, mock.Anything, mock.Anything).
		Run(func(mock.Arguments) { sequence = append(sequence, "memory_recall") }).
		Return(MemoryRecallActivityOutput{
			MemoryRef: "projection://runs/" + runID + "/memory/recall",
			RunID:     runID,
			Status:    "completed",
		}, nil)
	env.OnActivity(
		ExecutePrimaryAgentActivityName,
		mock.Anything,
		mock.MatchedBy(func(input ExecutePrimaryAgentActivityInput) bool {
			return input.RunID == runID &&
				input.TraceID == traceID &&
				input.ToolChoice == "knowledge_query"
		}),
	).
		Run(func(mock.Arguments) { sequence = append(sequence, "agent") }).
		Return(ExecutePrimaryAgentActivityOutput{
			AgentResultRef: agentResultRef,
			RunID:          runID,
			SelectedTools:  []string{"knowledge_query"},
			Status:         "completed",
			TerminalEnvelope: map[string]any{
				"answer_text":   "毕业最低学分要求为 160 学分。",
				"evidence_refs": []any{"evidence://sha256/example"},
				"kind":          "answer",
			},
			TerminalReason: "answer_completed",
		}, nil)
	env.OnActivity(
		WriteFinalizationActivityName,
		mock.Anything,
		mock.MatchedBy(func(input WriteFinalizationActivityInput) bool {
			return input.RunID == runID &&
				input.TraceID == traceID &&
				input.AgentResultRef == agentResultRef
		}),
	).
		Run(func(mock.Arguments) { sequence = append(sequence, "finalization") }).
		Return(WriteFinalizationActivityOutput{
			CompletedAt:   completedAt,
			ProjectionRef: "projection://runs/" + runID + "/finalization/write",
			RunID:         runID,
			Status:        "completed",
		}, nil)
	env.OnActivity(AppendConversationMemoryActivityName, mock.Anything, mock.Anything).
		Run(func(mock.Arguments) { sequence = append(sequence, "memory_append") }).
		Return(AppendConversationMemoryActivityOutput{
			PayloadSHA256: "sha256:memory",
			RunID:         runID,
			SchemaVersion: "memory_conversation_append_result_v1",
			Status:        "completed",
		}, nil)

	env.ExecuteWorkflow(ToolExecutionWorkflow, ToolExecutionWorkflowInput{
		ConversationID: "conv-linear-knowledge",
		RequestID:      "req-linear-knowledge",
		RequestedTool:  "knowledge_query",
		RunID:          runID,
		TraceID:        traceID,
		TurnID:         "turn-linear-knowledge",
	})

	if err := env.GetWorkflowError(); err != nil {
		t.Fatalf("workflow error: %v", err)
	}
	if got, want := sequence, []string{"memory_recall", "agent", "finalization", "memory_append"}; !equalStrings(got, want) {
		t.Fatalf("activity sequence = %#v, want %#v", got, want)
	}
	env.AssertActivityNumberOfCalls(t, ExecutePrimaryAgentActivityName, 1)
}

func equalStrings(left []string, right []string) bool {
	if len(left) != len(right) {
		return false
	}
	for index := range left {
		if left[index] != right[index] {
			return false
		}
	}
	return true
}
