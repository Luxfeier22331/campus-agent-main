package httpapi

import (
	"context"
	"testing"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/config"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/execution"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/temporalruntime"
)

func TestExtractMemoryCandidatesActivityRequiresMemoryEnabledGate(t *testing.T) {
	store := execution.NewInMemoryRunProjectionStore()
	now := time.Date(2026, 6, 15, 12, 0, 0, 0, time.UTC)
	createMemoryUpdateRunForTest(
		t,
		store,
		"run-memory-update-disabled",
		"我之后主要关注保研材料",
		nil,
		now,
	)
	server := NewServer(config.Config{TemporalWorkerIdentity: "test:memory-update"})
	attachRunProjectionStoreForHandlerTest(server, store)

	output, err := server.ExtractMemoryCandidatesActivity(
		context.Background(),
		temporalruntime.ExtractMemoryCandidatesActivityInput{
			RequestID: "req-memory-update-disabled",
			RunID:     "run-memory-update-disabled",
			TraceID:   memoryUpdateTraceID("run-memory-update-disabled"),
		},
	)
	if err != nil {
		t.Fatalf("extract memory candidates: %v", err)
	}
	if output.Status != "skipped" || output.SkippedCount != 1 {
		t.Fatalf("extract output = %#v, want skipped", output)
	}
	if len(output.SkipReasons) != 1 || output.SkipReasons[0] != "memory_enabled_unknown" {
		t.Fatalf("skip reasons = %#v", output.SkipReasons)
	}
}

func TestExtractMemoryCandidatesActivityExtractsExplicitUserGoal(t *testing.T) {
	store := execution.NewInMemoryRunProjectionStore()
	now := time.Date(2026, 6, 15, 12, 5, 0, 0, time.UTC)
	createMemoryUpdateRunForTest(
		t,
		store,
		"run-memory-update-enabled",
		"我之后主要关注保研材料",
		ptrBool(true),
		now,
	)
	server := NewServer(config.Config{TemporalWorkerIdentity: "test:memory-update"})
	attachRunProjectionStoreForHandlerTest(server, store)

	output, err := server.ExtractMemoryCandidatesActivity(
		context.Background(),
		temporalruntime.ExtractMemoryCandidatesActivityInput{
			RequestID: "req-memory-update-enabled",
			RunID:     "run-memory-update-enabled",
			TraceID:   memoryUpdateTraceID("run-memory-update-enabled"),
		},
	)
	if err != nil {
		t.Fatalf("extract memory candidates: %v", err)
	}
	if output.Status != "completed" || output.CandidateCount != 1 {
		t.Fatalf("extract output = %#v, want one candidate", output)
	}
	candidate := output.Candidates[0]
	if candidate.MemoryType != "goal" ||
		candidate.Capability != "any" ||
		candidate.CompactText != "近期目标: 关注保研材料" ||
		candidate.Confidence < 0.9 {
		t.Fatalf("candidate = %#v", candidate)
	}
}

func TestExtractMemoryCandidatesActivityRejectsTraceMismatchForTerminalRun(t *testing.T) {
	store := execution.NewInMemoryRunProjectionStore()
	now := time.Date(2026, 6, 15, 12, 6, 0, 0, time.UTC)
	createMemoryUpdateRunForTest(
		t,
		store,
		"run-memory-update-trace-mismatch",
		"我之后主要关注保研材料",
		ptrBool(true),
		now,
	)
	server := NewServer(config.Config{TemporalWorkerIdentity: "test:memory-update"})
	attachRunProjectionStoreForHandlerTest(server, store)

	_, err := server.ExtractMemoryCandidatesActivity(
		context.Background(),
		temporalruntime.ExtractMemoryCandidatesActivityInput{
			RequestID: "req-memory-update-trace-mismatch",
			RunID:     "run-memory-update-trace-mismatch",
			TraceID:   "trace-memory-update-wrong",
		},
	)
	if err == nil {
		t.Fatal("expected trace mismatch error, got nil")
	}
	if got := err.Error(); got == "" || got == "run run-memory-update-trace-mismatch is already terminal: completed" {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestUpsertInferredMemoryActivityWritesActiveInferredProjectionWithoutText(t *testing.T) {
	store := execution.NewInMemoryRunProjectionStore()
	now := time.Date(2026, 6, 15, 12, 10, 0, 0, time.UTC)
	createMemoryUpdateRunForTest(
		t,
		store,
		"run-memory-upsert-enabled",
		"我之后主要关注保研材料",
		ptrBool(true),
		now,
	)
	executor := &fakePersonalMemoryExecutor{}
	server := NewServer(config.Config{TemporalWorkerIdentity: "test:memory-update"})
	server.personalMemoryExecutor = executor
	server.personalMemoryErr = nil
	attachRunProjectionStoreForHandlerTest(server, store)

	output, err := server.UpsertInferredMemoryActivity(
		context.Background(),
		temporalruntime.UpsertInferredMemoryActivityInput{
			Candidates: []temporalruntime.MemoryCandidate{{
				Capability:  "any",
				CompactText: "近期目标: 关注保研材料",
				Confidence:  0.95,
				MemoryID:    "inf_goal_materials",
				MemoryType:  "goal",
			}},
			RequestID: "req-memory-upsert-enabled",
			RunID:     "run-memory-upsert-enabled",
			TraceID:   memoryUpdateTraceID("run-memory-upsert-enabled"),
		},
	)
	if err != nil {
		t.Fatalf("upsert inferred memory: %v", err)
	}
	if output.Status != "completed" || output.UpsertedCount != 1 {
		t.Fatalf("upsert output = %#v, want completed", output)
	}
	if executor.seenUpsert.Source != "inferred" ||
		executor.seenUpsert.Status != "active" ||
		executor.seenUpsert.MemoryType != "goal" ||
		executor.seenUpsert.CompactText != "近期目标: 关注保研材料" {
		t.Fatalf("upsert request = %#v", executor.seenUpsert)
	}
	results, err := store.ListStepResults(context.Background(), "run-memory-upsert-enabled")
	if err != nil {
		t.Fatalf("list step results: %v", err)
	}
	if len(results) != 1 {
		t.Fatalf("step results = %#v, want one", results)
	}
	payload := results[0].SanitizedPayload
	if _, exists := payload["compact_text"]; exists {
		t.Fatalf("memory update projection leaked compact_text: %#v", payload)
	}
	if payload["upserted_count"] != 1.0 && payload["upserted_count"] != 1 {
		t.Fatalf("projection payload = %#v", payload)
	}
}

func createMemoryUpdateRunForTest(
	t *testing.T,
	store *execution.InMemoryRunProjectionStore,
	runID string,
	userGoal string,
	memoryEnabled *bool,
	now time.Time,
) {
	t.Helper()
	contextProjection := map[string]any{
		"actor": map[string]any{"user_id": "user-executor"},
	}
	if memoryEnabled != nil {
		contextProjection["memory"] = map[string]any{"enabled": *memoryEnabled}
	}
	_, err := store.CreateRun(context.Background(), execution.DurableRun{
		RunID:          runID,
		ConversationID: "conv-" + runID,
		TurnID:         "turn-" + runID,
		RequestID:      "req-" + runID,
		TraceID:        "trace-" + runID,
		OwnerUserID:    "user-executor",
		Surface:        "public-chat-web",
		Lane:           execution.DurableLaneDefault,
		Status:         execution.DurableRunStatusCompleted,
		TerminalReason: execution.DurableTerminalReasonAnswerCompleted,
		CreatedAt:      now,
		UpdatedAt:      now,
		CompletedAt:    now,
		Metadata: map[string]any{
			"execution_payload": map[string]any{
				"context":    contextProjection,
				"request_id": "req-" + runID,
				"trace":      map[string]any{"trace_id": "trace-" + runID},
				"user_goal":  userGoal,
			},
		},
	})
	if err != nil {
		t.Fatalf("create memory update run: %v", err)
	}
}

func ptrBool(value bool) *bool {
	return &value
}

func memoryUpdateTraceID(runID string) string {
	return "trace-" + runID
}
