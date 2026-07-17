package httpapi

import (
	"context"
	"strings"
	"testing"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/execution"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/temporalruntime"
)

func TestMemoryRecallRequestRejectsMissingFrozenAcceptedMessageTimestamp(t *testing.T) {
	run := execution.DurableRun{
		RunID:          "run-missing-accepted-at",
		ConversationID: "conv-missing-accepted-at",
		OwnerUserID:    "user-1",
		CreatedAt:      time.Now().UTC(),
		Metadata: map[string]any{"execution_payload": map[string]any{
			"tenant_id": "tenant-main",
			"user_goal": "hello",
			"context": map[string]any{
				"conversation": map[string]any{"current_user_message": map[string]any{}},
				"memory":       map[string]any{"owner_generation": 1, "owner_sequence": 0},
			},
		}},
	}
	_, err := memoryRecallRequestForRun(run, "any")
	if err == nil || !strings.Contains(err.Error(), "query_timestamp is required") {
		t.Fatalf("error = %v, want frozen accepted-message timestamp failure", err)
	}
}

func TestMemoryRecallActivityUsesAnyToolForNeutralPrimaryAgentRun(t *testing.T) {
	store := execution.NewInMemoryRunProjectionStore()
	server := newWorkerAuthServerForTest()
	attachRunProjectionStoreForHandlerTest(server, store)
	executor := &fakePersonalMemoryExecutor{}
	server.personalMemoryExecutor = executor
	server.personalMemoryErr = nil

	now := time.Date(2026, 6, 8, 1, 2, 3, 0, time.UTC)
	createHTTPAPIQueuedDurableRunForTest(
		t,
		store,
		"run-memory-neutral",
		"conv-memory-neutral",
		now,
		nil,
	)
	setRunMemoryEnabledForTest(t, store, "run-memory-neutral", true)

	output, err := server.MemoryRecallActivity(
		context.Background(),
		temporalruntime.MemoryRecallActivityInput{
			RequestID: "req-executor-001",
			RunID:     "run-memory-neutral",
			TraceID:   "trace-executor-001",
		},
	)
	if err != nil {
		t.Fatalf("memory recall: %v", err)
	}
	if output.Status != "completed" {
		t.Fatalf("memory recall status = %q, want completed", output.Status)
	}
	if executor.seenRequest.RequestedTool != "any" {
		t.Fatalf(
			"recall requested tool = %q, want any for neutral primary-agent run",
			executor.seenRequest.RequestedTool,
		)
	}
	if executor.seenRequest.QueryTimestamp != now.UTC().Format(time.RFC3339) {
		t.Fatalf("query timestamp = %q, want frozen accepted-message timestamp %q", executor.seenRequest.QueryTimestamp, now.UTC().Format(time.RFC3339))
	}

	steps, err := store.ListRunSteps(context.Background(), "run-memory-neutral")
	if err != nil {
		t.Fatalf("list run steps: %v", err)
	}
	if len(steps) != 1 {
		t.Fatalf("step count = %d, want 1: %#v", len(steps), steps)
	}
	if steps[0].Tool != "any" {
		t.Fatalf("memory step tool = %q, want any", steps[0].Tool)
	}
}

func TestMemoryRecallActivitySkipsWhenMemoryEnabledUnknown(t *testing.T) {
	store := execution.NewInMemoryRunProjectionStore()
	server := newWorkerAuthServerForTest()
	attachRunProjectionStoreForHandlerTest(server, store)
	executor := &fakePersonalMemoryExecutor{}
	server.personalMemoryExecutor = executor
	server.personalMemoryErr = nil

	now := time.Date(2026, 6, 8, 1, 2, 3, 0, time.UTC)
	createHTTPAPIQueuedDurableRunForTest(
		t,
		store,
		"run-memory-unknown",
		"conv-memory-unknown",
		now,
		nil,
	)

	output, err := server.MemoryRecallActivity(
		context.Background(),
		temporalruntime.MemoryRecallActivityInput{
			RequestID: "req-memory-unknown",
			RunID:     "run-memory-unknown",
			TraceID:   "trace-executor-001",
		},
	)
	if err != nil {
		t.Fatalf("memory recall: %v", err)
	}
	if output.Status != "skipped" || output.SkippedCount != 1 || output.MemoryRef != "" || output.ContextBlock != "" {
		t.Fatalf("memory recall output = %#v, want skipped with no memory context", output)
	}
	if len(output.SkipReasons) != 1 || output.SkipReasons[0] != "memory_enabled_unknown" {
		t.Fatalf("skip reasons = %#v", output.SkipReasons)
	}
	if executor.recallCount != 0 {
		t.Fatalf("recall count = %d, want 0 when memory.enabled is unknown", executor.recallCount)
	}

	steps, err := store.ListRunSteps(context.Background(), "run-memory-unknown")
	if err != nil {
		t.Fatalf("list run steps: %v", err)
	}
	if len(steps) != 1 || steps[0].StepID != "memory.recall" || steps[0].Status != "skipped" {
		t.Fatalf("steps = %#v, want skipped memory.recall", steps)
	}
}

func TestMemoryRecallActivitySkipsWhenMemoryDisabled(t *testing.T) {
	store := execution.NewInMemoryRunProjectionStore()
	server := newWorkerAuthServerForTest()
	attachRunProjectionStoreForHandlerTest(server, store)
	executor := &fakePersonalMemoryExecutor{}
	server.personalMemoryExecutor = executor
	server.personalMemoryErr = nil

	now := time.Date(2026, 6, 8, 1, 2, 3, 0, time.UTC)
	createHTTPAPIQueuedDurableRunForTest(
		t,
		store,
		"run-memory-disabled",
		"conv-memory-disabled",
		now,
		nil,
	)
	latest, err := store.GetRun(context.Background(), "run-memory-disabled")
	if err != nil {
		t.Fatalf("get run: %v", err)
	}
	payload := latest.Metadata["execution_payload"].(map[string]any)
	contextProjection := payload["context"].(map[string]any)
	contextProjection["memory"] = map[string]any{"recall_enabled": false, "owner_generation": 1, "owner_sequence": 0}
	if err := store.ReplaceRunMetadata(context.Background(), latest.RunID, latest.Metadata); err != nil {
		t.Fatalf("replace metadata: %v", err)
	}

	output, err := server.MemoryRecallActivity(
		context.Background(),
		temporalruntime.MemoryRecallActivityInput{
			RequestID: "req-memory-disabled",
			RunID:     "run-memory-disabled",
			TraceID:   "trace-executor-001",
		},
	)
	if err != nil {
		t.Fatalf("memory recall: %v", err)
	}
	if output.Status != "skipped" || output.SkippedCount != 1 || output.MemoryRef != "" || output.ContextBlock != "" {
		t.Fatalf("memory recall output = %#v, want skipped with no memory context", output)
	}
	if len(output.SkipReasons) != 1 || output.SkipReasons[0] != "memory_disabled" {
		t.Fatalf("skip reasons = %#v", output.SkipReasons)
	}
	if executor.recallCount != 0 {
		t.Fatalf("recall count = %d, want 0 when memory is disabled", executor.recallCount)
	}
}

func setRunMemoryEnabledForTest(
	t *testing.T,
	store *execution.InMemoryRunProjectionStore,
	runID string,
	enabled bool,
) {
	t.Helper()
	latest, err := store.GetRun(context.Background(), runID)
	if err != nil {
		t.Fatalf("get run: %v", err)
	}
	payload := latest.Metadata["execution_payload"].(map[string]any)
	contextProjection := payload["context"].(map[string]any)
	contextProjection["memory"] = map[string]any{"recall_enabled": enabled, "owner_generation": 1, "owner_sequence": 0}
	if err := store.ReplaceRunMetadata(context.Background(), latest.RunID, latest.Metadata); err != nil {
		t.Fatalf("replace metadata: %v", err)
	}
}
