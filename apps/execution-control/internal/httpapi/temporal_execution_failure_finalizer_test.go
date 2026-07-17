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
	createHTTPAPIQueuedDurableRunForTest(t, store, "run-recall-failed", "conv-recall-failed", now, nil)
	server := newWorkerAuthServerForTest()
	attachRunProjectionStoreForHandlerTest(server, store)
	callbackCount := 0
	var productResponse map[string]any
	server.productFinalizationWriter = func(_ context.Context, _ execution.DurableRun, _ time.Time, response map[string]any) error {
		callbackCount++
		productResponse = response
		return nil
	}
	run, err := store.GetRun(context.Background(), "run-recall-failed")
	if err != nil {
		t.Fatalf("load run before recall attempts: %v", err)
	}
	for attempt, marker := range []string{"recall-attempt-1", "recall-attempt-2"} {
		if err := server.projectTemporalStep(context.Background(), temporalStepProjection{
			ActivityAttempt: attempt + 1,
			ActivityID:      marker,
			ActivityType:    temporalruntime.MemoryRecallActivityName,
			Attempt:         attempt + 1,
			CompletedAt:     now.Add(time.Duration(attempt+1) * time.Second),
			Payload:         map[string]any{"attempt_marker": marker},
			Run:             run,
			StartedAt:       now,
			Status:          "failed",
			StepID:          "memory.recall",
			StepKind:        "memory",
			TaskQueue:       temporalruntime.ActivityTaskQueueCore,
			UpdatedAt:       now.Add(time.Duration(attempt+1) * time.Second),
		}); err != nil {
			t.Fatalf("seed recall attempt %d: %v", attempt+1, err)
		}
	}

	output, err := server.FinalizeExecutionFailureActivity(context.Background(), temporalruntime.FinalizeExecutionFailureActivityInput{
		FailureHash: strings.Repeat("a", 64),
		FailureKind: "memory_recall_failed",
		FailedAt:    now.Add(3 * time.Second),
		RunID:       "run-recall-failed",
		Stage:       "memory.recall",
		TraceID:     "trace-executor-001",
	})
	if err != nil {
		t.Fatalf("finalize execution failure: %v", err)
	}
	if output.Status != string(execution.DurableRunStatusFailed) {
		t.Fatalf("finalization output = %#v", output)
	}
	run, err = store.GetRun(context.Background(), "run-recall-failed")
	if err != nil || run.Status != execution.DurableRunStatusFailed {
		t.Fatalf("failed run = %#v err=%v", run, err)
	}
	errorBody, ok := productResponse["error"].(map[string]any)
	if !ok || errorBody["message"] != "Personal memory could not be loaded for this request." {
		t.Fatalf("product error = %#v", productResponse)
	}
	encoded, err := json.Marshal(productResponse)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(encoded), "secret provider diagnostic") {
		t.Fatalf("product response leaked raw failure: %s", encoded)
	}

	replay, err := server.FinalizeExecutionFailureActivity(context.Background(), temporalruntime.FinalizeExecutionFailureActivityInput{
		FailureHash: strings.Repeat("a", 64),
		FailureKind: "memory_recall_failed",
		FailedAt:    now.Add(3 * time.Second),
		RunID:       "run-recall-failed",
		Stage:       "memory.recall",
		TraceID:     "trace-executor-001",
	})
	if err != nil || replay.Status != string(execution.DurableRunStatusFailed) {
		t.Fatalf("idempotent finalization = %#v err=%v", replay, err)
	}
	if callbackCount != 1 {
		t.Fatalf("product callback count = %d, want 1", callbackCount)
	}
	_, conflictErr := server.FinalizeExecutionFailureActivity(
		context.Background(),
		temporalruntime.FinalizeExecutionFailureActivityInput{
			FailureHash: strings.Repeat("b", 64),
			FailureKind: "memory_recall_failed",
			FailedAt:    now.Add(3 * time.Second),
			RunID:       "run-recall-failed",
			Stage:       "memory.recall",
			TraceID:     "trace-executor-001",
		},
	)
	assertTemporalFailureSanitized(t, conflictErr, "execution_failure_terminal_conflict", true)
	attempts, err := store.ListStepAttempts(context.Background(), "run-recall-failed")
	if err != nil {
		t.Fatalf("list recall attempts after finalizer: %v", err)
	}
	if len(attempts) != 2 {
		t.Fatalf("recall attempts = %#v, want two preserved attempts", attempts)
	}
	for _, attempt := range attempts {
		marker := []string{"recall-attempt-1", "recall-attempt-2"}[attempt.Attempt-1]
		if attempt.ActivityType != temporalruntime.MemoryRecallActivityName ||
			attempt.SanitizedPayload["attempt_marker"] != marker {
			t.Fatalf("recall attempt %d was overwritten by finalizer: %#v", attempt.Attempt, attempt)
		}
	}

	createHTTPAPIQueuedDurableRunForTest(t, store, "run-after-recall-failure", "conv-recall-failed", now.Add(time.Minute), nil)
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

			output, err := server.FinalizeExecutionFailureActivity(
				context.Background(),
				temporalruntime.FinalizeExecutionFailureActivityInput{
					FailureHash: strings.Repeat("c", 64),
					FailureKind: test.failureKind,
					FailedAt:    now.Add(time.Second),
					RunID:       runID,
					Stage:       test.stage,
					TraceID:     "trace-executor-001",
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

	_, err := server.FinalizeExecutionFailureActivity(
		context.Background(),
		temporalruntime.FinalizeExecutionFailureActivityInput{
			FailureHash: strings.Repeat("d", 64),
			FailureKind: "agent_runtime_failed",
			FailedAt:    now.Add(time.Second),
			RunID:       "run-callback-pending",
			Stage:       "agent.primary",
			TraceID:     "trace-executor-001",
		},
	)
	assertTemporalFailureSanitized(t, err, "execution_failure_finalizer_failed", false)
	run, readErr := store.GetRun(context.Background(), "run-callback-pending")
	if readErr != nil || run.Status != execution.DurableRunStatusQueued {
		t.Fatalf("run after callback failure = %#v err=%v", run, readErr)
	}
	events, readErr := store.ListRunEvents(context.Background(), run.RunID)
	if readErr != nil {
		t.Fatalf("list events: %v", readErr)
	}
	for _, event := range events {
		if event.EventType == execution.DurableRunEventTypeRunFailed {
			t.Fatalf("run.failed published before product callback succeeded: %#v", events)
		}
	}
}
