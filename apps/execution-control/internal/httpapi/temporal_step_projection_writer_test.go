package httpapi

import (
	"context"
	"strings"
	"testing"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/execution"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/temporalruntime"
)

func TestProjectTemporalStepRecordsLateCompletionAfterTerminalStepProjection(t *testing.T) {
	store := execution.NewInMemoryRunProjectionStore()
	server := newServerForTest()
	attachRunProjectionStoreForHandlerTest(server, store)
	now := time.Date(2026, 6, 11, 1, 2, 3, 0, time.UTC)
	createHTTPAPIQueuedDurableRunForTest(
		t,
		store,
		"run-step-terminal-late",
		"conv-step-terminal-late",
		now,
		ragHandoffForDurableWorkerTest("hello"),
	)
	if _, err := store.TransitionRun(
		context.Background(),
		"run-step-terminal-late",
		execution.DurableRunStatusAdmitted,
		"",
		now.Add(time.Second),
	); err != nil {
		t.Fatalf("admit run: %v", err)
	}
	if _, err := store.UpsertRunStep(context.Background(), execution.RunStepProjection{
		StepID:               "synthesis",
		RunID:                "run-step-terminal-late",
		ConversationID:       "conv-step-terminal-late",
		StepKind:             "synthesis",
		Capability:           "knowledge",
		Status:               "failed",
		TaskQueue:            temporalruntime.ActivityTaskQueueKnowledgeSynthesis,
		WorkerID:             "worker-1",
		StartedAt:            now.Add(2 * time.Second),
		CompletedAt:          now.Add(3 * time.Second),
		UpdatedAt:            now.Add(3 * time.Second),
		PayloadSchemaVersion: "run-step-projection-v1",
		SanitizedPayload:     map[string]any{"terminal_reason": "provider_timeout"},
	}); err != nil {
		t.Fatalf("seed terminal step: %v", err)
	}
	run, err := store.GetRun(context.Background(), "run-step-terminal-late")
	if err != nil {
		t.Fatalf("get run: %v", err)
	}

	err = server.projectTemporalStep(context.Background(), temporalStepProjection{
		Attempt:       2,
		Capability:    "knowledge",
		Run:           run,
		Status:        "completed",
		StepID:        "synthesis",
		StepKind:      "synthesis",
		TaskQueue:     temporalruntime.ActivityTaskQueueKnowledgeSynthesis,
		WorkerID:      "worker-1",
		StartedAt:     now.Add(4 * time.Second),
		CompletedAt:   now.Add(5 * time.Second),
		UpdatedAt:     now.Add(5 * time.Second),
		ResultKind:    "provider_execution_summary",
		ProjectionRef: temporalProjectionRef(run.RunID, "synthesis/provider"),
		Payload:       map[string]any{"provider_response": "late"},
	})
	if err == nil || !strings.Contains(err.Error(), "already terminal before synthesis completion projection") {
		t.Fatalf("late completion error = %v", err)
	}

	attempts, err := store.ListStepAttempts(context.Background(), "run-step-terminal-late")
	if err != nil {
		t.Fatalf("list attempts: %v", err)
	}
	if len(attempts) != 1 {
		t.Fatalf("attempt count = %d, want late completion evidence only: %#v", len(attempts), attempts)
	}
	if attempts[0].Status != "blocked" ||
		attempts[0].LateCompletionOutcome != execution.LateCompletionOutcomeIgnoredAfterTerminalProjection ||
		attempts[0].TerminalReason != "late_completion_ignored" {
		t.Fatalf("late attempt = %#v, want ignored terminal step evidence", attempts[0])
	}
	results, err := store.ListStepResults(context.Background(), "run-step-terminal-late")
	if err != nil {
		t.Fatalf("list results: %v", err)
	}
	if len(results) != 0 {
		t.Fatalf("late terminal step completion wrote results: %#v", results)
	}
}
