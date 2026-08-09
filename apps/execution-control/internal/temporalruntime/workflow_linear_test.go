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
	env.OnActivity(ExecutePrimaryAgentActivityName, mock.Anything, mock.Anything).
		Return(ExecutePrimaryAgentActivityOutput{}, temporal.NewNonRetryableApplicationError("agent failed", "agent_runtime_failed", nil)).Once()
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
		t.Fatal("workflow error is nil, want original agent failure")
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
	env.OnActivity(ExecutePrimaryAgentActivityName, mock.Anything, mock.Anything).
		Return(ExecutePrimaryAgentActivityOutput{}, temporal.NewNonRetryableApplicationError(
			"agent transport unavailable",
			"agent_attempt_uncertain",
			nil,
		))
	env.OnActivity(
		FinalizeExecutionFailureActivityName,
		mock.Anything,
		mock.MatchedBy(func(finalization FinalizeExecutionFailureActivityInput) bool {
			return finalization.RunID == input.RunID &&
				finalization.TraceID == input.TraceID &&
				finalization.Stage == "agent.primary" &&
				finalization.FailureKind == "agent_attempt_uncertain" &&
				len(finalization.FailureHash) == 64 &&
				!finalization.FailedAt.IsZero()
		}),
	).Return(FinalizeExecutionFailureActivityOutput{RunID: input.RunID, Status: "failed"}, nil).Once()

	env.ExecuteWorkflow(ToolExecutionWorkflow, input)

	if env.GetWorkflowError() == nil {
		t.Fatal("workflow error is nil, want exhausted primary agent failure")
	}
	env.AssertActivityNumberOfCalls(t, ExecutePrimaryAgentActivityName, 1)
	env.AssertActivityNumberOfCalls(t, FinalizeExecutionFailureActivityName, 1)
	env.AssertActivityNumberOfCalls(t, WriteFinalizationActivityName, 0)
}

func TestToolExecutionWorkflowFinalizesRunAfterNonRetryableFinalizationFailure(t *testing.T) {
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
	env.OnActivity(ExecutePrimaryAgentActivityName, mock.Anything, mock.Anything).
		Return(ExecutePrimaryAgentActivityOutput{
			AgentResultRef: "projection://runs/" + input.RunID + "/agent/primary/result",
			RunID:          input.RunID,
			Status:         "completed",
		}, nil).Once()
	env.OnActivity(WriteFinalizationActivityName, mock.Anything, mock.Anything).
		Return(WriteFinalizationActivityOutput{}, temporal.NewNonRetryableApplicationError(
			"finalization input invalid",
			"finalization_input_invalid",
			nil,
		)).Once()
	env.OnActivity(
		FinalizeExecutionFailureActivityName,
		mock.Anything,
		mock.MatchedBy(func(finalization FinalizeExecutionFailureActivityInput) bool {
			return finalization.RunID == input.RunID &&
				finalization.TraceID == input.TraceID &&
				finalization.Stage == "finalization.write" &&
				finalization.FailureKind == "finalization_input_invalid" &&
				len(finalization.FailureHash) == 64 &&
				!finalization.FailedAt.IsZero()
		}),
	).Return(FinalizeExecutionFailureActivityOutput{RunID: input.RunID, Status: "failed"}, nil).Once()

	env.ExecuteWorkflow(ToolExecutionWorkflow, input)

	if env.GetWorkflowError() == nil {
		t.Fatal("workflow error is nil, want exhausted finalization failure")
	}
	env.AssertActivityNumberOfCalls(t, WriteFinalizationActivityName, 1)
	env.AssertActivityNumberOfCalls(t, FinalizeExecutionFailureActivityName, 1)
	env.AssertActivityNumberOfCalls(t, AppendConversationMemoryActivityName, 0)
}

func TestToolExecutionWorkflowRetriesFinalizationProjectionWithoutFailureFinalizer(t *testing.T) {
	var suite testsuite.WorkflowTestSuite
	env := suite.NewTestWorkflowEnvironment()
	registerWorkflowTestActivities(env, &Activities{})
	input := ToolExecutionWorkflowInput{
		ConversationID: "conv-finalization-repair",
		RequestID:      "req-finalization-repair",
		RunID:          "run-finalization-repair",
		TraceID:        "trace-finalization-repair",
		TurnID:         "turn-finalization-repair",
	}
	completedAt := time.Date(2026, 7, 23, 8, 0, 0, 0, time.UTC)
	env.OnActivity(ExecutePrimaryAgentActivityName, mock.Anything, mock.Anything).
		Return(ExecutePrimaryAgentActivityOutput{
			AgentResultRef: "projection://runs/" + input.RunID + "/agent/primary/result",
			RunID:          input.RunID,
			Status:         "completed",
		}, nil).Once()
	env.OnActivity(WriteFinalizationActivityName, mock.Anything, mock.Anything).
		Return(WriteFinalizationActivityOutput{}, errors.New("internal finalization projection unavailable")).Once()
	env.OnActivity(WriteFinalizationActivityName, mock.Anything, mock.Anything).
		Return(WriteFinalizationActivityOutput{
			CompletedAt:   completedAt,
			ProjectionRef: "projection://runs/" + input.RunID + "/finalization/write",
			RunID:         input.RunID,
			Status:        "completed",
		}, nil).Once()
	env.OnActivity(AppendConversationMemoryActivityName, mock.Anything, mock.Anything).
		Return(AppendConversationMemoryActivityOutput{RunID: input.RunID, Status: "completed"}, nil).Once()
	env.ExecuteWorkflow(ToolExecutionWorkflow, input)

	if err := env.GetWorkflowError(); err != nil {
		t.Fatalf("workflow error after finalization repair: %v", err)
	}
	env.AssertActivityNumberOfCalls(t, WriteFinalizationActivityName, 2)
	env.AssertActivityNumberOfCalls(t, FinalizeExecutionFailureActivityName, 0)
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
	env.OnActivity(ExecutePrimaryAgentActivityName, mock.Anything, mock.Anything).
		Return(ExecutePrimaryAgentActivityOutput{}, temporal.NewNonRetryableApplicationError("agent failed", "agent_runtime_failed", nil)).Once()
	env.OnActivity(FinalizeExecutionFailureActivityName, mock.Anything, mock.Anything).
		Return(FinalizeExecutionFailureActivityOutput{}, temporal.NewNonRetryableApplicationError("failure finalizer rejected", "execution_failure_finalizer_invalid", nil)).Once()

	env.ExecuteWorkflow(ToolExecutionWorkflow, input)

	err := env.GetWorkflowError()
	if err == nil || !strings.Contains(err.Error(), "failure finalizer rejected") {
		t.Fatalf("workflow error = %v, want failure finalizer error", err)
	}
	if strings.Contains(err.Error(), "agent failed") {
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

func TestPersonalMemoryEraseDrainsExporterThenConverges(t *testing.T) {
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
		Return(PersonalMemoryTraceMaintenanceActivityOutput{}, nil).Once()
	env.OnActivity(VerifyPersonalMemoryTracesActivityName, mock.Anything, maintenanceInput).
		Return(PersonalMemoryTraceMaintenanceActivityOutput{RemainingTraceCount: 0}, nil).Once()
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
	env.AssertActivityNumberOfCalls(t, PurgePersonalMemoryTracesActivityName, 1)
	env.AssertActivityNumberOfCalls(t, VerifyPersonalMemoryTracesActivityName, 1)
	env.AssertActivityNumberOfCalls(t, FinalizePersonalMemoryCommandReceiptActivityName, 1)
}

func TestPersonalMemoryEraseFailsAfterBoundedVerificationRounds(t *testing.T) {
	var suite testsuite.WorkflowTestSuite
	env := suite.NewTestWorkflowEnvironment()
	registerWorkflowTestActivities(env, &Activities{})
	command := memoryruntime.PersonalMemoryCommandRequest{
		CommandID:         "cmd-owner-erase-bounded",
		CommandKind:       "owner_erase",
		OwnerGeneration:   2,
		OwnerSequence:     3,
		SchemaVersion:     memoryruntime.PersonalMemoryCommandSchemaVersion,
		SourceUpdatedAt:   "2026-07-16T00:00:00Z",
		SupersessionScope: "owner:erase:2",
		TenantID:          "tenant-main",
		UserID:            "user-1",
	}
	succeeded := PersonalMemoryCommandActivityOutput{
		CommandID:         command.CommandID,
		ResultFingerprint: "fingerprint",
		Status:            "succeeded",
	}
	failed := PersonalMemoryCommandActivityOutput{
		CommandID: command.CommandID,
		ErrorCode: "personal_memory_trace_erase_failed",
		Status:    "failed",
	}
	maintenanceInput := PersonalMemoryTraceMaintenanceActivityInput{Command: command}
	env.OnActivity(ExecutePersonalMemoryCommandActivityName, mock.Anything, command).
		Return(succeeded, nil).Once()
	env.OnActivity(PurgePersonalMemoryTracesActivityName, mock.Anything, maintenanceInput).
		Return(PersonalMemoryTraceMaintenanceActivityOutput{}, nil).Times(personalMemoryEraseMaxRounds)
	env.OnActivity(VerifyPersonalMemoryTracesActivityName, mock.Anything, maintenanceInput).
		Return(PersonalMemoryTraceMaintenanceActivityOutput{RemainingTraceCount: 1}, nil).
		Times(personalMemoryEraseMaxRounds)
	env.OnActivity(
		FinalizePersonalMemoryCommandReceiptActivityName,
		mock.Anything,
		FinalizePersonalMemoryCommandReceiptActivityInput{Command: command, Result: failed},
	).Return(failed, nil).Once()
	env.OnActivity(WritePersonalMemoryCommandResultActivityName, mock.Anything, failed).
		Return(nil).Once()

	env.ExecuteWorkflow(PersonalMemoryCommandWorkflow, PersonalMemoryCommandWorkflowInput{Command: command})

	if err := env.GetWorkflowError(); err != nil {
		t.Fatalf("workflow error: %v", err)
	}
	var result PersonalMemoryCommandActivityOutput
	if err := env.GetWorkflowResult(&result); err != nil {
		t.Fatal(err)
	}
	if result != failed {
		t.Fatalf("result = %#v, want %#v", result, failed)
	}
	env.AssertActivityNumberOfCalls(t, PurgePersonalMemoryTracesActivityName, personalMemoryEraseMaxRounds)
	env.AssertActivityNumberOfCalls(t, VerifyPersonalMemoryTracesActivityName, personalMemoryEraseMaxRounds)
}

func TestToolExecutionWorkflowCompletesDurableLifecycleInOrder(t *testing.T) {
	var suite testsuite.WorkflowTestSuite
	env := suite.NewTestWorkflowEnvironment()
	registerWorkflowTestActivities(env, &Activities{})
	sequence := make([]string, 0, 3)
	runID := "run-linear-knowledge"
	traceID := "trace-linear-knowledge"
	traceParent := "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01"
	agentResultRef := "projection://runs/" + runID + "/agent/primary/result"
	completedAt := time.Date(2026, 7, 11, 1, 2, 3, 0, time.UTC)

	env.OnActivity(
		PrepareGroundingContextActivityName,
		mock.Anything,
		mock.MatchedBy(func(input PrepareGroundingContextActivityInput) bool {
			return input.RunID == runID && input.TraceID == traceID
		}),
	).
		Run(func(mock.Arguments) { sequence = append(sequence, "grounding") }).
		Return(PrepareGroundingContextActivityOutput{
			GroundingContext: GroundingContext{RunID: runID},
			RunID:            runID,
			Status:           "ready",
		}, nil)

	env.OnActivity(
		ExecutePrimaryAgentActivityName,
		mock.Anything,
		mock.MatchedBy(func(input ExecutePrimaryAgentActivityInput) bool {
			return input.RunID == runID &&
				input.TraceID == traceID &&
				input.TraceParent == traceParent &&
				input.GroundingContext.RunID == runID
		}),
	).
		Run(func(mock.Arguments) { sequence = append(sequence, "agent") }).
		Return(ExecutePrimaryAgentActivityOutput{
			AgentResultRef: agentResultRef,
			RunID:          runID,
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
				input.AgentResult.AgentResultRef == agentResultRef &&
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
		AdmissionSnapshot: AgentAdmissionSnapshot{GroundingPlan: GroundingPlanSnapshot{
			Mode:           "single_scope",
			SelectedScopes: []string{"curriculum"},
		}},
		ConversationID: "conv-linear-knowledge",
		RequestID:      "req-linear-knowledge",
		RunID:          runID,
		TraceID:        traceID,
		TraceParent:    traceParent,
		TurnID:         "turn-linear-knowledge",
	})

	if err := env.GetWorkflowError(); err != nil {
		t.Fatalf("workflow error: %v", err)
	}
	if got, want := sequence, []string{"grounding", "agent", "finalization", "memory_append"}; !equalStrings(got, want) {
		t.Fatalf("activity sequence = %#v, want %#v", got, want)
	}
	env.AssertActivityNumberOfCalls(t, ExecutePrimaryAgentActivityName, 1)
	env.AssertActivityNumberOfCalls(t, PrepareGroundingContextActivityName, 1)
}

func TestToolExecutionWorkflowSkipsGroundingForDirectPlan(t *testing.T) {
	var suite testsuite.WorkflowTestSuite
	env := suite.NewTestWorkflowEnvironment()
	registerWorkflowTestActivities(env, &Activities{})
	runID := "run-linear-direct"
	env.OnActivity(ExecutePrimaryAgentActivityName, mock.Anything, mock.MatchedBy(
		func(input ExecutePrimaryAgentActivityInput) bool {
			return input.GroundingContext.SchemaVersion == ""
		},
	)).Return(ExecutePrimaryAgentActivityOutput{
		AgentResultRef: "projection://runs/" + runID + "/agent/primary/result",
		RunID:          runID,
		Status:         "completed",
	}, nil)
	env.OnActivity(WriteFinalizationActivityName, mock.Anything, mock.Anything).
		Return(WriteFinalizationActivityOutput{RunID: runID, Status: "completed"}, nil)
	env.OnActivity(AppendConversationMemoryActivityName, mock.Anything, mock.Anything).
		Return(AppendConversationMemoryActivityOutput{RunID: runID, Status: "completed"}, nil)

	env.ExecuteWorkflow(ToolExecutionWorkflow, ToolExecutionWorkflowInput{
		AdmissionSnapshot: AgentAdmissionSnapshot{GroundingPlan: GroundingPlanSnapshot{Mode: "none"}},
		RunID:             runID,
	})

	if err := env.GetWorkflowError(); err != nil {
		t.Fatalf("direct workflow error: %v", err)
	}
	env.AssertActivityNumberOfCalls(t, PrepareGroundingContextActivityName, 0)
	env.AssertActivityNumberOfCalls(t, ExecutePrimaryAgentActivityName, 1)
}

func TestToolExecutionWorkflowFinalizesCancellationOnDisconnectedContext(t *testing.T) {
	var suite testsuite.WorkflowTestSuite
	env := suite.NewTestWorkflowEnvironment()
	registerWorkflowTestActivities(env, &Activities{})
	input := ToolExecutionWorkflowInput{
		ConversationID: "conv-canceled-agent",
		RequestID:      "req-canceled-agent",
		RunID:          "run-canceled-agent",
		TraceID:        "trace-canceled-agent",
		TurnID:         "turn-canceled-agent",
	}
	env.OnActivity(ExecutePrimaryAgentActivityName, mock.Anything, mock.Anything).
		After(time.Hour).
		Return(ExecutePrimaryAgentActivityOutput{RunID: input.RunID, Status: "completed"}, nil).Once()
	env.OnActivity(
		FinalizeExecutionCancellationActivityName,
		mock.Anything,
		mock.MatchedBy(func(finalization FinalizeExecutionCancellationActivityInput) bool {
			return finalization.RunID == input.RunID &&
				finalization.TraceID == input.TraceID &&
				finalization.Reason == "user_requested" &&
				!finalization.CanceledAt.IsZero()
		}),
	).Return(FinalizeExecutionCancellationActivityOutput{RunID: input.RunID, Status: "canceled"}, nil).Once()
	env.RegisterDelayedCallback(env.CancelWorkflow, time.Minute)

	env.ExecuteWorkflow(ToolExecutionWorkflow, input)

	if err := env.GetWorkflowError(); !temporal.IsCanceledError(err) {
		t.Fatalf("workflow error = %v, want canceled error", err)
	}
	env.AssertActivityNumberOfCalls(t, FinalizeExecutionCancellationActivityName, 1)
	env.AssertActivityNumberOfCalls(t, FinalizeExecutionFailureActivityName, 0)
	env.AssertActivityNumberOfCalls(t, WriteFinalizationActivityName, 0)
}

func TestToolExecutionWorkflowKeepsCompletedResultWhenCancellationRacesCleanup(t *testing.T) {
	var suite testsuite.WorkflowTestSuite
	env := suite.NewTestWorkflowEnvironment()
	registerWorkflowTestActivities(env, &Activities{})
	input := ToolExecutionWorkflowInput{
		ConversationID: "conv-completed-cancel-race",
		RequestID:      "req-completed-cancel-race",
		RunID:          "run-completed-cancel-race",
		TraceID:        "trace-completed-cancel-race",
		TurnID:         "turn-completed-cancel-race",
	}
	completedAt := time.Date(2026, 7, 23, 1, 2, 3, 0, time.UTC)
	sequence := make([]string, 0, 2)
	env.OnActivity(ExecutePrimaryAgentActivityName, mock.Anything, mock.Anything).
		Return(ExecutePrimaryAgentActivityOutput{
			AgentResultRef: "projection://runs/" + input.RunID + "/agent/primary/result",
			RunID:          input.RunID,
			Status:         "completed",
		}, nil).Once()
	env.OnActivity(WriteFinalizationActivityName, mock.Anything, mock.Anything).
		Run(func(mock.Arguments) { sequence = append(sequence, "finalization") }).
		Return(WriteFinalizationActivityOutput{
			CompletedAt:   completedAt,
			ProjectionRef: "projection://runs/" + input.RunID + "/finalization/write",
			RunID:         input.RunID,
			Status:        "completed",
		}, nil).Once()
	env.OnActivity(AppendConversationMemoryActivityName, mock.Anything, mock.Anything).
		After(time.Hour).
		Run(func(mock.Arguments) { sequence = append(sequence, "memory_append") }).
		Return(AppendConversationMemoryActivityOutput{RunID: input.RunID, Status: "completed"}, nil).Once()
	env.RegisterDelayedCallback(env.CancelWorkflow, time.Minute)

	env.ExecuteWorkflow(ToolExecutionWorkflow, input)

	if err := env.GetWorkflowError(); err != nil {
		t.Fatalf("workflow error: %v", err)
	}
	var result ToolExecutionWorkflowResult
	if err := env.GetWorkflowResult(&result); err != nil {
		t.Fatalf("workflow result: %v", err)
	}
	if result.RunID != input.RunID || result.Status != "completed" || !result.CompletedAt.Equal(completedAt) {
		t.Fatalf("workflow result = %#v, want completed finalization", result)
	}
	if got, want := sequence, []string{"finalization", "memory_append"}; !equalStrings(got, want) {
		t.Fatalf("post-finalization sequence = %#v, want %#v", got, want)
	}
	env.AssertActivityNumberOfCalls(t, AppendConversationMemoryActivityName, 1)
	env.AssertActivityNumberOfCalls(t, FinalizeExecutionCancellationActivityName, 0)
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
