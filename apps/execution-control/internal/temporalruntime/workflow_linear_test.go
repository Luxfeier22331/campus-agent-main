package temporalruntime

import (
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/memoryruntime"
	"github.com/stretchr/testify/mock"
	"go.temporal.io/sdk/temporal"
	"go.temporal.io/sdk/testsuite"
)

func TestPersonalMemoryCommandWorkflowRetriesCallbackWithoutRepeatingProviderMutation(t *testing.T) {
	var suite testsuite.WorkflowTestSuite
	env := suite.NewTestWorkflowEnvironment()
	registerWorkflowTestActivities(env, &Activities{})
	command := memoryruntime.PersonalMemoryCommandRequest{
		CommandID:         "memcmd-retry-callback",
		CommandKind:       "item_upsert",
		OwnerGeneration:   1,
		OwnerSequence:     1,
		SchemaVersion:     memoryruntime.PersonalMemoryCommandSchemaVersion,
		SubjectID:         "memory-1",
		SupersessionScope: "item:memory-1",
		Item:              &memoryruntime.PersonalMemoryCommandItem{Key: "program", Value: "cs"},
		SourceUpdatedAt:   "2026-07-16T00:00:00Z",
		TenantID:          "tenant-main",
		UserID:            "user-1",
	}
	result := PersonalMemoryCommandActivityOutput{
		CommandID:         command.CommandID,
		ResultFingerprint: "fingerprint-1",
		Status:            "succeeded",
	}
	env.OnActivity(ExecutePersonalMemoryCommandActivityName, mock.Anything, command).
		Return(result, nil).
		Once()
	env.OnActivity(
		FinalizePersonalMemoryCommandReceiptActivityName,
		mock.Anything,
		FinalizePersonalMemoryCommandReceiptActivityInput{Command: command, Result: result},
	).Return(result, nil).Once()
	env.OnActivity(WritePersonalMemoryCommandResultActivityName, mock.Anything, result).
		Return(errors.New("product callback unavailable")).
		Once()
	env.OnActivity(WritePersonalMemoryCommandResultActivityName, mock.Anything, result).
		Return(nil).
		Once()

	env.ExecuteWorkflow(PersonalMemoryCommandWorkflow, PersonalMemoryCommandWorkflowInput{
		Command:    command,
		WorkflowID: "campus-agent.memory.command." + command.CommandID,
	})

	if err := env.GetWorkflowError(); err != nil {
		t.Fatalf("workflow error: %v", err)
	}
	env.AssertActivityNumberOfCalls(t, ExecutePersonalMemoryCommandActivityName, 1)
	env.AssertActivityNumberOfCalls(t, FinalizePersonalMemoryCommandReceiptActivityName, 1)
	env.AssertActivityNumberOfCalls(t, WritePersonalMemoryCommandResultActivityName, 2)
}

func TestToolExecutionWorkflowFinalizesRunAfterMemoryRecallRetriesExhausted(t *testing.T) {
	var suite testsuite.WorkflowTestSuite
	env := suite.NewTestWorkflowEnvironment()
	registerWorkflowTestActivities(env, &Activities{})
	input := ToolExecutionWorkflowInput{
		ConversationID: "conv-memory-failure",
		RequestID:      "req-memory-failure",
		RunID:          "run-memory-failure",
		TraceID:        "trace-memory-failure",
		TurnID:         "turn-memory-failure",
	}
	env.OnActivity(MemoryRecallActivityName, mock.Anything, mock.Anything).
		Return(MemoryRecallActivityOutput{}, errors.New("secret provider diagnostic"))
	env.OnActivity(
		FinalizeExecutionFailureActivityName,
		mock.Anything,
		mock.MatchedBy(func(finalization FinalizeExecutionFailureActivityInput) bool {
			return finalization.RunID == input.RunID &&
				finalization.TraceID == input.TraceID &&
				finalization.Stage == "memory.recall" &&
				finalization.FailureKind == "memory_recall_failed" &&
				len(finalization.FailureHash) == 64 &&
				!finalization.FailedAt.IsZero()
		}),
	).Return(FinalizeExecutionFailureActivityOutput{RunID: input.RunID, Status: "failed"}, nil).Once()

	env.ExecuteWorkflow(ToolExecutionWorkflow, input)

	if env.GetWorkflowError() == nil {
		t.Fatal("workflow error is nil, want exhausted recall failure")
	}
	env.AssertActivityNumberOfCalls(t, MemoryRecallActivityName, 3)
	env.AssertActivityNumberOfCalls(t, FinalizeExecutionFailureActivityName, 1)
	env.AssertActivityNumberOfCalls(t, ExecutePrimaryAgentActivityName, 0)
}

func TestToolExecutionWorkflowFreezesFailureTimestampAcrossFinalizerRetries(t *testing.T) {
	var suite testsuite.WorkflowTestSuite
	env := suite.NewTestWorkflowEnvironment()
	registerWorkflowTestActivities(env, &Activities{})
	input := ToolExecutionWorkflowInput{
		ConversationID: "conv-frozen-failure-time",
		RequestID:      "req-frozen-failure-time",
		RunID:          "run-frozen-failure-time",
		TraceID:        "trace-frozen-failure-time",
		TurnID:         "turn-frozen-failure-time",
	}
	env.OnActivity(MemoryRecallActivityName, mock.Anything, mock.Anything).
		Return(MemoryRecallActivityOutput{}, temporal.NewNonRetryableApplicationError("recall failed", "memory_recall_failed", nil)).Once()
	failedAt := make([]time.Time, 0, 2)
	captureFailedAt := func(arguments mock.Arguments) {
		finalization, ok := arguments.Get(1).(FinalizeExecutionFailureActivityInput)
		if !ok {
			t.Fatalf("failure finalizer input = %#v", arguments.Get(1))
		}
		failedAt = append(failedAt, finalization.FailedAt)
	}
	env.OnActivity(FinalizeExecutionFailureActivityName, mock.Anything, mock.Anything).
		Run(captureFailedAt).
		Return(FinalizeExecutionFailureActivityOutput{}, errors.New("temporary finalizer outage")).Once()
	env.OnActivity(FinalizeExecutionFailureActivityName, mock.Anything, mock.Anything).
		Run(captureFailedAt).
		Return(FinalizeExecutionFailureActivityOutput{RunID: input.RunID, Status: "failed"}, nil).Once()

	env.ExecuteWorkflow(ToolExecutionWorkflow, input)

	if env.GetWorkflowError() == nil {
		t.Fatal("workflow error is nil, want original recall failure")
	}
	if len(failedAt) != 2 || failedAt[0].IsZero() || !failedAt[0].Equal(failedAt[1]) {
		t.Fatalf("failure finalizer timestamps = %#v, want one frozen non-zero value", failedAt)
	}
	env.AssertActivityNumberOfCalls(t, FinalizeExecutionFailureActivityName, 2)
}

func TestToolExecutionWorkflowFinalizesRunAfterPrimaryAgentFailure(t *testing.T) {
	var suite testsuite.WorkflowTestSuite
	env := suite.NewTestWorkflowEnvironment()
	registerWorkflowTestActivities(env, &Activities{})
	input := ToolExecutionWorkflowInput{
		ConversationID: "conv-agent-failure",
		RequestID:      "req-agent-failure",
		RunID:          "run-agent-failure",
		TraceID:        "trace-agent-failure",
		TurnID:         "turn-agent-failure",
	}
	env.OnActivity(MemoryRecallActivityName, mock.Anything, mock.Anything).
		Return(MemoryRecallActivityOutput{RunID: input.RunID, Status: "skipped"}, nil).Once()
	env.OnActivity(ExecutePrimaryAgentActivityName, mock.Anything, mock.Anything).
		Return(ExecutePrimaryAgentActivityOutput{}, errors.New("agent transport unavailable"))
	env.OnActivity(
		FinalizeExecutionFailureActivityName,
		mock.Anything,
		mock.MatchedBy(func(finalization FinalizeExecutionFailureActivityInput) bool {
			return finalization.RunID == input.RunID &&
				finalization.TraceID == input.TraceID &&
				finalization.Stage == "agent.primary" &&
				finalization.FailureKind == "agent_runtime_failed" &&
				len(finalization.FailureHash) == 64 &&
				!finalization.FailedAt.IsZero()
		}),
	).Return(FinalizeExecutionFailureActivityOutput{RunID: input.RunID, Status: "failed"}, nil).Once()

	env.ExecuteWorkflow(ToolExecutionWorkflow, input)

	if env.GetWorkflowError() == nil {
		t.Fatal("workflow error is nil, want exhausted primary agent failure")
	}
	env.AssertActivityNumberOfCalls(t, ExecutePrimaryAgentActivityName, 3)
	env.AssertActivityNumberOfCalls(t, FinalizeExecutionFailureActivityName, 1)
	env.AssertActivityNumberOfCalls(t, WriteFinalizationActivityName, 0)
}

func TestToolExecutionWorkflowFinalizesRunAfterFinalizationFailure(t *testing.T) {
	var suite testsuite.WorkflowTestSuite
	env := suite.NewTestWorkflowEnvironment()
	registerWorkflowTestActivities(env, &Activities{})
	input := ToolExecutionWorkflowInput{
		ConversationID: "conv-finalization-failure",
		RequestID:      "req-finalization-failure",
		RunID:          "run-finalization-failure",
		TraceID:        "trace-finalization-failure",
		TurnID:         "turn-finalization-failure",
	}
	env.OnActivity(MemoryRecallActivityName, mock.Anything, mock.Anything).
		Return(MemoryRecallActivityOutput{RunID: input.RunID, Status: "skipped"}, nil).Once()
	env.OnActivity(ExecutePrimaryAgentActivityName, mock.Anything, mock.Anything).
		Return(ExecutePrimaryAgentActivityOutput{
			AgentResultRef: "projection://runs/" + input.RunID + "/agent/primary/result",
			RunID:          input.RunID,
			Status:         "completed",
		}, nil).Once()
	env.OnActivity(WriteFinalizationActivityName, mock.Anything, mock.Anything).
		Return(WriteFinalizationActivityOutput{}, errors.New("finalization storage unavailable"))
	env.OnActivity(
		FinalizeExecutionFailureActivityName,
		mock.Anything,
		mock.MatchedBy(func(finalization FinalizeExecutionFailureActivityInput) bool {
			return finalization.RunID == input.RunID &&
				finalization.TraceID == input.TraceID &&
				finalization.Stage == "finalization.write" &&
				finalization.FailureKind == "finalization_failed" &&
				len(finalization.FailureHash) == 64 &&
				!finalization.FailedAt.IsZero()
		}),
	).Return(FinalizeExecutionFailureActivityOutput{RunID: input.RunID, Status: "failed"}, nil).Once()

	env.ExecuteWorkflow(ToolExecutionWorkflow, input)

	if env.GetWorkflowError() == nil {
		t.Fatal("workflow error is nil, want exhausted finalization failure")
	}
	env.AssertActivityNumberOfCalls(t, WriteFinalizationActivityName, 3)
	env.AssertActivityNumberOfCalls(t, FinalizeExecutionFailureActivityName, 1)
	env.AssertActivityNumberOfCalls(t, AppendConversationMemoryActivityName, 0)
}

func TestToolExecutionWorkflowReturnsFailureFinalizerErrorBeforeStageError(t *testing.T) {
	var suite testsuite.WorkflowTestSuite
	env := suite.NewTestWorkflowEnvironment()
	registerWorkflowTestActivities(env, &Activities{})
	input := ToolExecutionWorkflowInput{
		ConversationID: "conv-finalizer-failure",
		RequestID:      "req-finalizer-failure",
		RunID:          "run-finalizer-failure",
		TraceID:        "trace-finalizer-failure",
		TurnID:         "turn-finalizer-failure",
	}
	env.OnActivity(MemoryRecallActivityName, mock.Anything, mock.Anything).
		Return(MemoryRecallActivityOutput{}, temporal.NewNonRetryableApplicationError("recall failed", "memory_recall_failed", nil)).Once()
	env.OnActivity(FinalizeExecutionFailureActivityName, mock.Anything, mock.Anything).
		Return(FinalizeExecutionFailureActivityOutput{}, temporal.NewNonRetryableApplicationError("failure finalizer rejected", "execution_failure_finalizer_invalid", nil)).Once()

	env.ExecuteWorkflow(ToolExecutionWorkflow, input)

	err := env.GetWorkflowError()
	if err == nil || !strings.Contains(err.Error(), "failure finalizer rejected") {
		t.Fatalf("workflow error = %v, want failure finalizer error", err)
	}
	if strings.Contains(err.Error(), "recall failed") {
		t.Fatalf("workflow error = %v, finalizer error must take precedence", err)
	}
}

func TestWorkflowFailureHashUsesBoundedApplicationErrorDetail(t *testing.T) {
	expected := strings.Repeat("a", 64)
	err := temporal.NewApplicationError("bounded failure", "provider_unavailable", expected)
	if actual := workflowFailureHash(err); actual != expected {
		t.Fatalf("workflow failure hash = %q, want sanitized detail %q", actual, expected)
	}
}

func TestPersonalMemoryCommandWorkflowWaitsAtOwnerReceiptGate(t *testing.T) {
	var suite testsuite.WorkflowTestSuite
	env := suite.NewTestWorkflowEnvironment()
	registerWorkflowTestActivities(env, &Activities{})
	command := memoryruntime.PersonalMemoryCommandRequest{
		CommandID:         "cmd-owner-gated",
		CommandKind:       "owner_transition",
		LifecycleState:    "paused",
		OwnerGeneration:   1,
		OwnerSequence:     2,
		SchemaVersion:     memoryruntime.PersonalMemoryCommandSchemaVersion,
		SourceUpdatedAt:   "2026-07-16T00:00:00Z",
		SupersessionScope: "owner:lifecycle",
		TenantID:          "tenant-main",
		UserID:            "user-1",
	}
	result := PersonalMemoryCommandActivityOutput{CommandID: command.CommandID, ResultFingerprint: "fingerprint", Status: "succeeded"}
	env.OnActivity(ExecutePersonalMemoryCommandActivityName, mock.Anything, command).
		Return(PersonalMemoryCommandActivityOutput{}, temporal.NewApplicationError("waiting", "memory_command_owner_blocked")).
		Once()
	env.OnActivity(ExecutePersonalMemoryCommandActivityName, mock.Anything, command).
		Return(result, nil).
		Once()
	env.OnActivity(FinalizePersonalMemoryCommandReceiptActivityName, mock.Anything, FinalizePersonalMemoryCommandReceiptActivityInput{Command: command, Result: result}).
		Return(result, nil).
		Once()
	env.OnActivity(WritePersonalMemoryCommandResultActivityName, mock.Anything, result).
		Return(nil).
		Once()

	env.ExecuteWorkflow(PersonalMemoryCommandWorkflow, PersonalMemoryCommandWorkflowInput{Command: command})

	if err := env.GetWorkflowError(); err != nil {
		t.Fatalf("workflow error: %v", err)
	}
	env.AssertActivityNumberOfCalls(t, ExecutePersonalMemoryCommandActivityName, 2)
}

func TestPersonalMemoryEraseWaitsForBothLangfuseVerificationCheckpoints(t *testing.T) {
	var suite testsuite.WorkflowTestSuite
	env := suite.NewTestWorkflowEnvironment()
	registerWorkflowTestActivities(env, &Activities{})
	command := memoryruntime.PersonalMemoryCommandRequest{
		CommandID:         "cmd-owner-erase",
		CommandKind:       "owner_erase",
		OwnerGeneration:   2,
		OwnerSequence:     3,
		SchemaVersion:     memoryruntime.PersonalMemoryCommandSchemaVersion,
		SourceUpdatedAt:   "2026-07-16T00:00:00Z",
		SupersessionScope: "owner:erase:2",
		TenantID:          "tenant-main",
		UserID:            "user-1",
	}
	result := PersonalMemoryCommandActivityOutput{
		CommandID:         command.CommandID,
		ResultFingerprint: "fingerprint",
		Status:            "succeeded",
	}
	maintenanceInput := PersonalMemoryTraceMaintenanceActivityInput{Command: command}
	env.OnActivity(ExecutePersonalMemoryCommandActivityName, mock.Anything, command).
		Return(result, nil).Once()
	env.OnActivity(PurgePersonalMemoryTracesActivityName, mock.Anything, maintenanceInput).
		Return(PersonalMemoryTraceMaintenanceActivityOutput{}, nil).Times(3)
	env.OnActivity(VerifyPersonalMemoryTracesActivityName, mock.Anything, maintenanceInput).
		Return(PersonalMemoryTraceMaintenanceActivityOutput{RemainingTraceCount: 0}, nil).Times(2)
	env.OnActivity(
		FinalizePersonalMemoryCommandReceiptActivityName,
		mock.Anything,
		FinalizePersonalMemoryCommandReceiptActivityInput{Command: command, Result: result},
	).Return(result, nil).Once()
	env.OnActivity(WritePersonalMemoryCommandResultActivityName, mock.Anything, result).
		Return(nil).Once()

	env.ExecuteWorkflow(PersonalMemoryCommandWorkflow, PersonalMemoryCommandWorkflowInput{Command: command})

	if err := env.GetWorkflowError(); err != nil {
		t.Fatalf("workflow error: %v", err)
	}
	env.AssertActivityNumberOfCalls(t, PurgePersonalMemoryTracesActivityName, 3)
	env.AssertActivityNumberOfCalls(t, VerifyPersonalMemoryTracesActivityName, 2)
	env.AssertActivityNumberOfCalls(t, FinalizePersonalMemoryCommandReceiptActivityName, 1)
}

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
				input.AgentResultRef == agentResultRef &&
				!input.FinalizedAt.IsZero()
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
