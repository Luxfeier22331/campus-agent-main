package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/execution"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/temporalruntime"
)

func TestFinalizeExecutionFailureActivityClosesProductRunAndReleasesConversation(t *testing.T) {
	store := execution.NewInMemoryRunProjectionStore()
	now := time.Date(2026, 7, 16, 5, 0, 0, 0, time.UTC)
	createHTTPAPIQueuedDurableRunForTest(t, store, "run-agent-failed", "conv-agent-failed", now, nil)
	server := newWorkerAuthServerForTest()
	attachRunProjectionStoreForHandlerTest(server, store)
	callbackCount := 0
	var productResponse map[string]any
	server.productFinalizationWriter = func(_ context.Context, _ execution.DurableRun, _ time.Time, response map[string]any) error {
		callbackCount++
		productResponse = response
		return nil
	}
	run, err := store.GetRun(context.Background(), "run-agent-failed")
	if err != nil {
		t.Fatalf("load run before agent attempts: %v", err)
	}
	for attempt, marker := range []string{"agent-attempt-1", "agent-attempt-2"} {
		if err := server.projectTemporalStep(context.Background(), temporalStepProjection{
			ActivityAttempt: attempt + 1,
			ActivityID:      marker,
			ActivityType:    temporalruntime.ExecutePrimaryAgentActivityName,
			Attempt:         attempt + 1,
			CompletedAt:     now.Add(time.Duration(attempt+1) * time.Second),
			Payload:         map[string]any{"attempt_marker": marker},
			Run:             run,
			StartedAt:       now,
			Status:          "failed",
			StepID:          "agent.primary",
			StepKind:        "agent",
			TaskQueue:       temporalruntime.ActivityTaskQueueAgent,
			UpdatedAt:       now.Add(time.Duration(attempt+1) * time.Second),
		}); err != nil {
			t.Fatalf("seed agent attempt %d: %v", attempt+1, err)
		}
	}

	output, err := server.FinalizeExecutionFailure(context.Background(), temporalruntime.FinalizeExecutionFailureActivityInput{
		FailureKind: "agent_runtime_failed",
		FailedAt:    now.Add(3 * time.Second),
		RequestID:   "run-agent-failed",
		Stage:       "agent.primary",
	})
	if err != nil {
		t.Fatalf("finalize execution failure: %v", err)
	}
	if output.Status != string(execution.DurableRunStatusFailed) {
		t.Fatalf("finalization output = %#v", output)
	}
	run, err = store.GetRun(context.Background(), "run-agent-failed")
	if err != nil || run.Status != execution.DurableRunStatusFailed {
		t.Fatalf("failed run = %#v err=%v", run, err)
	}
	errorBody, ok := productResponse["error"].(map[string]any)
	if !ok || errorBody["message"] != defaultExecutionFailureMessage {
		t.Fatalf("product error = %#v", productResponse)
	}
	if run.TerminalReason != execution.DurableTerminalReasonExecutionFailed {
		t.Fatalf("terminal reason = %q, want %q", run.TerminalReason, execution.DurableTerminalReasonExecutionFailed)
	}
	encoded, err := json.Marshal(productResponse)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(encoded), "secret provider diagnostic") {
		t.Fatalf("product response leaked raw failure: %s", encoded)
	}

	replay, err := server.FinalizeExecutionFailure(context.Background(), temporalruntime.FinalizeExecutionFailureActivityInput{
		FailureKind: "agent_runtime_failed",
		FailedAt:    now.Add(3 * time.Second),
		RequestID:   "run-agent-failed",
		Stage:       "agent.primary",
	})
	if err != nil || replay.Status != string(execution.DurableRunStatusFailed) {
		t.Fatalf("idempotent finalization = %#v err=%v", replay, err)
	}
	if callbackCount != 1 {
		t.Fatalf("product callback count = %d, want 1", callbackCount)
	}
	attempts, err := store.ListStepAttempts(context.Background(), "run-agent-failed")
	if err != nil {
		t.Fatalf("list agent attempts after finalizer: %v", err)
	}
	if len(attempts) != 2 {
		t.Fatalf("agent attempts = %#v, want two preserved attempts", attempts)
	}
	for _, attempt := range attempts {
		marker := []string{"agent-attempt-1", "agent-attempt-2"}[attempt.Attempt-1]
		if attempt.ActivityType != temporalruntime.ExecutePrimaryAgentActivityName ||
			attempt.SanitizedPayload["attempt_marker"] != marker {
			t.Fatalf("agent attempt %d was overwritten by finalizer: %#v", attempt.Attempt, attempt)
		}
	}

	createHTTPAPIQueuedDurableRunForTest(t, store, "run-after-agent-failure", "conv-agent-failed", now.Add(time.Minute), nil)
}

func TestFinalizeExecutionFailureActivityOwnsAllPreAnswerFailureStages(t *testing.T) {
	tests := []struct {
		failureKind string
		stage       string
	}{
		{failureKind: "agent_runtime_failed", stage: "agent.primary"},
		{failureKind: "finalization_failed", stage: "finalization.write"},
	}
	for index, test := range tests {
		t.Run(test.stage, func(t *testing.T) {
			store := execution.NewInMemoryRunProjectionStore()
			now := time.Date(2026, 7, 16, 6, index, 0, 0, time.UTC)
			runID := "run-stage-" + strings.ReplaceAll(test.stage, ".", "-")
			conversationID := "conv-stage-" + strings.ReplaceAll(test.stage, ".", "-")
			createHTTPAPIQueuedDurableRunForTest(t, store, runID, conversationID, now, nil)
			server := newWorkerAuthServerForTest()
			attachRunProjectionStoreForHandlerTest(server, store)
			callbackCount := 0
			server.productFinalizationWriter = func(
				_ context.Context,
				_ execution.DurableRun,
				_ time.Time,
				_ map[string]any,
			) error {
				callbackCount++
				return nil
			}

			output, err := server.FinalizeExecutionFailure(
				context.Background(),
				temporalruntime.FinalizeExecutionFailureActivityInput{
					FailureKind: test.failureKind,
					FailedAt:    now.Add(time.Second),
					RequestID:   runID,
					Stage:       test.stage,
				},
			)
			if err != nil || output.Status != string(execution.DurableRunStatusFailed) {
				t.Fatalf("finalize stage %s output=%#v err=%v", test.stage, output, err)
			}
			if callbackCount != 1 {
				t.Fatalf("callback count = %d, want 1", callbackCount)
			}
			events, err := store.ListRunEvents(context.Background(), runID)
			if err != nil {
				t.Fatalf("list events: %v", err)
			}
			terminalEvents := 0
			for _, event := range events {
				if event.EventType == execution.DurableRunEventTypeRunFailed {
					terminalEvents++
				}
			}
			if terminalEvents != 1 {
				t.Fatalf("terminal events = %#v, want exactly one run.failed", events)
			}
		})
	}
}

func TestFinalizeExecutionFailureActivityMapsRuntimeUnauthorizedToInvariantFailure(t *testing.T) {
	store := execution.NewInMemoryRunProjectionStore()
	now := time.Date(2026, 7, 16, 6, 30, 0, 0, time.UTC)
	createHTTPAPIQueuedDurableRunForTest(t, store, "run-runtime-unauthorized", "conv-runtime-unauthorized", now, nil)
	server := newWorkerAuthServerForTest()
	attachRunProjectionStoreForHandlerTest(server, store)
	server.productFinalizationWriter = func(
		context.Context,
		execution.DurableRun,
		time.Time,
		map[string]any,
	) error {
		return nil
	}

	_, err := server.FinalizeExecutionFailure(
		context.Background(),
		temporalruntime.FinalizeExecutionFailureActivityInput{
			FailureKind: "agent_runtime_unauthorized",
			FailedAt:    now.Add(time.Second),
			RequestID:   "run-runtime-unauthorized",
			Stage:       "agent.primary",
		},
	)
	if err != nil {
		t.Fatalf("finalize runtime authorization failure: %v", err)
	}
	run, err := store.GetRun(context.Background(), "run-runtime-unauthorized")
	if err != nil {
		t.Fatalf("get finalized run: %v", err)
	}
	if run.Status != execution.DurableRunStatusFailed ||
		run.TerminalReason != execution.DurableTerminalReasonRuntimeInvariant ||
		run.FailCloseReason != "agent_runtime_unauthorized" {
		t.Fatalf("runtime authorization terminal state = %#v", run)
	}
}

func TestTemporalFailureTerminalReasonAndProductRetryability(t *testing.T) {
	tests := []struct {
		name           string
		projection     temporalStepFailureProjection
		failureKind    string
		terminalReason execution.DurableTerminalReason
		retryable      bool
	}{
		{
			name:           "provider failure",
			failureKind:    "provider_connection_failed",
			terminalReason: execution.DurableTerminalReasonProviderUnavailable,
			retryable:      true,
		},
		{
			name: "provider timeout outcome",
			projection: temporalStepFailureProjection{
				TimeoutOutcome: execution.TimeoutOutcomeProviderTimeout,
			},
			failureKind:    "execution_failed",
			terminalReason: execution.DurableTerminalReasonProviderUnavailable,
			retryable:      true,
		},
		{
			name:           "agent runtime timeout code",
			failureKind:    "agent_runtime_timeout",
			terminalReason: execution.DurableTerminalReasonProviderUnavailable,
			retryable:      true,
		},
		{
			name: "activity timeout outcome",
			projection: temporalStepFailureProjection{
				TimeoutOutcome: execution.TimeoutOutcomeActivityTimeout,
			},
			failureKind:    "agent_deadline_exceeded",
			terminalReason: execution.DurableTerminalReasonRunTimeout,
			retryable:      true,
		},
		{
			name:           "agent deadline code",
			failureKind:    "agent_deadline_exceeded",
			terminalReason: execution.DurableTerminalReasonRunTimeout,
			retryable:      true,
		},
		{
			name:           "runtime invariant",
			failureKind:    "agent_runtime_response_invalid",
			terminalReason: execution.DurableTerminalReasonRuntimeInvariant,
			retryable:      false,
		},
		{
			name:           "runtime result contract",
			failureKind:    "agent_runtime_result_invalid",
			terminalReason: execution.DurableTerminalReasonRuntimeInvariant,
			retryable:      false,
		},
		{
			name:           "runtime request contract",
			failureKind:    "invalid_request",
			terminalReason: execution.DurableTerminalReasonRuntimeInvariant,
			retryable:      false,
		},
		{
			name:           "runtime configuration contract",
			failureKind:    "agent_runtime_not_configured",
			terminalReason: execution.DurableTerminalReasonRuntimeInvariant,
			retryable:      false,
		},
		{
			name:           "model target contract",
			failureKind:    "model_target_mismatch",
			terminalReason: execution.DurableTerminalReasonRuntimeInvariant,
			retryable:      false,
		},
		{
			name:           "worker unavailable",
			failureKind:    "worker_unavailable",
			terminalReason: execution.DurableTerminalReasonWorkerUnavailable,
			retryable:      true,
		},
		{
			name:           "tool failure",
			failureKind:    "tool_execution_failed",
			terminalReason: execution.DurableTerminalReasonExecutionFailed,
			retryable:      false,
		},
		{
			name:           "input temporarily unavailable",
			failureKind:    "execution_input_unavailable",
			terminalReason: execution.DurableTerminalReasonExecutionFailed,
			retryable:      true,
		},
		{
			name:           "model config unavailable",
			failureKind:    "model_config_unavailable",
			terminalReason: execution.DurableTerminalReasonExecutionFailed,
			retryable:      true,
		},
		{
			name:           "unknown failure",
			failureKind:    "unexpected_execution_failure",
			terminalReason: execution.DurableTerminalReasonExecutionFailed,
			retryable:      false,
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if got := temporalFailureTerminalReason(test.projection, test.failureKind); got != test.terminalReason {
				t.Fatalf("terminal reason = %q, want %q", got, test.terminalReason)
			}
			if got := temporalRunFailureRetryable(test.projection, test.failureKind); got != test.retryable {
				t.Fatalf("retryable = %t, want %t", got, test.retryable)
			}
		})
	}
}

func TestTemporalFailureProjectionRejectsRetiredMemoryRecallStage(t *testing.T) {
	_, ok := temporalFailureProjectionForStage(temporalruntime.FinalizeExecutionFailureActivityInput{
		RequestID: "run-retired-memory-recall",
		Stage:     "memory.recall",
	})
	if ok {
		t.Fatal("retired memory.recall workflow stage must not be accepted")
	}
}

func TestFinalizeExecutionFailureActivityKeepsRunActiveUntilCallbackSucceeds(t *testing.T) {
	store := execution.NewInMemoryRunProjectionStore()
	now := time.Date(2026, 7, 16, 7, 0, 0, 0, time.UTC)
	createHTTPAPIQueuedDurableRunForTest(t, store, "run-callback-pending", "conv-callback-pending", now, nil)
	server := newWorkerAuthServerForTest()
	attachRunProjectionStoreForHandlerTest(server, store)
	server.productFinalizationWriter = func(
		context.Context,
		execution.DurableRun,
		time.Time,
		map[string]any,
	) error {
		return errors.New(temporalFailureSentinel)
	}

	_, err := server.FinalizeExecutionFailure(
		context.Background(),
		temporalruntime.FinalizeExecutionFailureActivityInput{
			FailureKind: "agent_runtime_failed",
			FailedAt:    now.Add(time.Second),
			RequestID:   "run-callback-pending",
			Stage:       "agent.primary",
		},
	)
	assertTemporalFailureSanitized(t, err, "execution_failure_finalizer_failed", false)
	run, readErr := store.GetRun(context.Background(), "run-callback-pending")
	if readErr != nil || run.Status != execution.DurableRunStatusQueued {
		t.Fatalf("run after callback failure = %#v err=%v", run, readErr)
	}
	events, readErr := store.ListRunEvents(context.Background(), run.RequestID)
	if readErr != nil {
		t.Fatalf("list events: %v", readErr)
	}
	for _, event := range events {
		if event.EventType == execution.DurableRunEventTypeRunFailed {
			t.Fatalf("run.failed published before product callback succeeded: %#v", events)
		}
	}
}
