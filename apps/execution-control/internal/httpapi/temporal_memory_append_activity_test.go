package httpapi

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/config"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/execution"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/temporalruntime"
)

func TestAppendConversationMemoryActivityRequiresMemoryEnabledGate(t *testing.T) {
	store := execution.NewInMemoryRunProjectionStore()
	now := time.Date(2026, 6, 15, 12, 0, 0, 0, time.UTC)
	createMemoryAppendRunForTest(t, store, "run-memory-append-disabled", "我之后主要关注保研材料", nil, now)
	server := NewServer(config.Config{TemporalWorkerIdentity: "test:memory-append"})
	attachRunProjectionStoreForHandlerTest(server, store)

	output, err := server.AppendConversationMemoryActivity(
		context.Background(),
		temporalruntime.AppendConversationMemoryActivityInput{
			RequestID: "req-memory-append-disabled",
			RunID:     "run-memory-append-disabled",
			TraceID:   memoryAppendTraceID("run-memory-append-disabled"),
		},
	)
	if err != nil {
		t.Fatalf("append conversation memory: %v", err)
	}
	if output.Status != "skipped" || output.AppendedMessageCount != 0 {
		t.Fatalf("append output = %#v, want skipped with zero messages", output)
	}
	if len(output.SkipReasons) != 1 || output.SkipReasons[0] != "memory_enabled_unknown" {
		t.Fatalf("skip reasons = %#v", output.SkipReasons)
	}
}

func TestAppendConversationMemoryActivityAcceptsCompletedTurnForAsyncPersonalMemory(t *testing.T) {
	store := execution.NewInMemoryRunProjectionStore()
	now := time.Date(2026, 6, 15, 12, 5, 0, 0, time.UTC)
	createMemoryAppendRunForTest(t, store, "run-memory-append-enabled", "我之后主要关注保研材料", ptrBool(true), now)
	executor := &fakePersonalMemoryExecutor{}
	server := NewServer(config.Config{TemporalWorkerIdentity: "test:memory-append"})
	server.personalMemoryExecutor = executor
	server.personalMemoryErr = nil
	attachRunProjectionStoreForHandlerTest(server, store)

	output, err := server.AppendConversationMemoryActivity(
		context.Background(),
		temporalruntime.AppendConversationMemoryActivityInput{
			RequestID: "req-memory-append-enabled",
			RunID:     "run-memory-append-enabled",
			TraceID:   memoryAppendTraceID("run-memory-append-enabled"),
		},
	)
	if err != nil {
		t.Fatalf("append conversation memory: %v", err)
	}
	if output.Status != "accepted" || output.AppendedMessageCount != 1 {
		t.Fatalf("append output = %#v, want accepted append of user-only graph content", output)
	}
	if executor.seenAppend.UserID != "user-executor" {
		t.Fatalf("user id = %q, want user-executor", executor.seenAppend.UserID)
	}
	if executor.seenAppend.TenantID != "tenant-main" {
		t.Fatalf("tenant id = %q, want tenant-main", executor.seenAppend.TenantID)
	}
	if executor.seenAppend.ThreadID != "conv-run-memory-append-enabled" {
		t.Fatalf("thread id = %q", executor.seenAppend.ThreadID)
	}
	if executor.seenAppend.UserMessage != "我之后主要关注保研材料" {
		t.Fatalf("user message = %q", executor.seenAppend.UserMessage)
	}
	if executor.seenAppend.AssistantMessage != "好的，我会在后续回答中结合保研材料准备这个目标。" {
		t.Fatalf("assistant message = %q", executor.seenAppend.AssistantMessage)
	}
	if !executor.seenAppend.IgnoreAssistantForGraph {
		t.Fatal("assistant message must be ignored for graph ingestion while still stored in thread")
	}
}

func TestAppendConversationMemoryActivityPreservesTenantForScopedHindsightBank(t *testing.T) {
	store := execution.NewInMemoryRunProjectionStore()
	now := time.Date(2026, 6, 15, 12, 7, 0, 0, time.UTC)
	createMemoryAppendRunForTest(t, store, "run-memory-append-tenant", "我之后主要关注保研材料", ptrBool(true), now)
	executor := &fakePersonalMemoryExecutor{}
	server := NewServer(config.Config{TemporalWorkerIdentity: "test:memory-append"})
	server.personalMemoryExecutor = executor
	server.personalMemoryErr = nil
	attachRunProjectionStoreForHandlerTest(server, store)

	output, err := server.AppendConversationMemoryActivity(
		context.Background(),
		temporalruntime.AppendConversationMemoryActivityInput{
			RequestID: "req-memory-append-tenant",
			RunID:     "run-memory-append-tenant",
			TraceID:   memoryAppendTraceID("run-memory-append-tenant"),
		},
	)
	if err != nil {
		t.Fatalf("append conversation memory: %v", err)
	}
	if output.Status != "accepted" {
		t.Fatalf("append output = %#v, want accepted", output)
	}
	if executor.seenAppend.TenantID != "tenant-main" {
		t.Fatalf("tenant id = %q, want tenant-main", executor.seenAppend.TenantID)
	}
	if executor.seenAppend.UserID != "user-executor" {
		t.Fatalf("user id = %q, want raw actor user id", executor.seenAppend.UserID)
	}
}

func TestAppendConversationMemoryActivityProjectsFailureWhenHindsightAppendFails(t *testing.T) {
	store := execution.NewInMemoryRunProjectionStore()
	now := time.Date(2026, 6, 15, 12, 8, 0, 0, time.UTC)
	createMemoryAppendRunForTest(t, store, "run-memory-append-failed", "我之后主要关注保研材料", ptrBool(true), now)
	executor := &fakePersonalMemoryExecutor{appendErr: errors.New("hindsight retain failed")}
	server := NewServer(config.Config{TemporalWorkerIdentity: "test:memory-append"})
	server.personalMemoryExecutor = executor
	server.personalMemoryErr = nil
	attachRunProjectionStoreForHandlerTest(server, store)

	output, err := server.AppendConversationMemoryActivity(
		context.Background(),
		temporalruntime.AppendConversationMemoryActivityInput{
			RequestID: "req-memory-append-failed",
			RunID:     "run-memory-append-failed",
			TraceID:   memoryAppendTraceID("run-memory-append-failed"),
		},
	)
	if err != nil {
		t.Fatalf("append conversation memory should project failure without failing final answer side-effect: %v", err)
	}
	if output.Status != "failed" || output.AppendedMessageCount != 0 {
		t.Fatalf("append output = %#v, want failed status with no appended messages", output)
	}
	if len(output.SkipReasons) != 1 || output.SkipReasons[0] != "hindsight_append_failed" {
		t.Fatalf("failure reasons = %#v", output.SkipReasons)
	}
	results, err := store.ListStepResults(context.Background(), "run-memory-append-failed")
	if err != nil {
		t.Fatalf("list step results: %v", err)
	}
	var payload map[string]any
	for _, result := range results {
		if result.StepID == "memory.append" {
			payload = result.SanitizedPayload
		}
	}
	if payload == nil {
		t.Fatal("memory.append failure projection missing")
	}
	if payload["status"] != "failed" || payload["failure_kind"] != "hindsight_append_failed" {
		t.Fatalf("payload = %#v, want failed hindsight append projection", payload)
	}
	if payload["user_message"] != nil || payload["assistant_message"] != nil {
		t.Fatalf("failure projection leaked conversation text: %#v", payload)
	}
}

func TestAppendConversationMemoryActivityRejectsTraceMismatchForTerminalRun(t *testing.T) {
	store := execution.NewInMemoryRunProjectionStore()
	now := time.Date(2026, 6, 15, 12, 6, 0, 0, time.UTC)
	createMemoryAppendRunForTest(t, store, "run-memory-append-trace-mismatch", "我之后主要关注保研材料", ptrBool(true), now)
	server := NewServer(config.Config{TemporalWorkerIdentity: "test:memory-append"})
	attachRunProjectionStoreForHandlerTest(server, store)

	_, err := server.AppendConversationMemoryActivity(
		context.Background(),
		temporalruntime.AppendConversationMemoryActivityInput{
			RequestID: "req-memory-append-trace-mismatch",
			RunID:     "run-memory-append-trace-mismatch",
			TraceID:   "trace-memory-append-wrong",
		},
	)
	if err == nil {
		t.Fatal("expected trace mismatch error, got nil")
	}
}

func TestAppendConversationMemoryActivityProjectionDoesNotStoreConversationText(t *testing.T) {
	store := execution.NewInMemoryRunProjectionStore()
	now := time.Date(2026, 6, 15, 12, 10, 0, 0, time.UTC)
	createMemoryAppendRunForTest(t, store, "run-memory-append-projection", "我之后主要关注保研材料", ptrBool(true), now)
	server := NewServer(config.Config{TemporalWorkerIdentity: "test:memory-append"})
	server.personalMemoryExecutor = &fakePersonalMemoryExecutor{}
	server.personalMemoryErr = nil
	attachRunProjectionStoreForHandlerTest(server, store)

	_, err := server.AppendConversationMemoryActivity(
		context.Background(),
		temporalruntime.AppendConversationMemoryActivityInput{
			RequestID: "req-memory-append-projection",
			RunID:     "run-memory-append-projection",
			TraceID:   memoryAppendTraceID("run-memory-append-projection"),
		},
	)
	if err != nil {
		t.Fatalf("append conversation memory: %v", err)
	}
	results, err := store.ListStepResults(context.Background(), "run-memory-append-projection")
	if err != nil {
		t.Fatalf("list step results: %v", err)
	}
	var payload map[string]any
	for _, result := range results {
		if result.StepID == "memory.append" {
			payload = result.SanitizedPayload
		}
	}
	if payload == nil {
		t.Fatal("memory.append projection missing")
	}
	if payload["user_message"] != nil || payload["assistant_message"] != nil {
		t.Fatalf("memory append projection leaked conversation text: %#v", payload)
	}
	if payload["appended_message_count"] != float64(1) && payload["appended_message_count"] != 1 {
		t.Fatalf("payload = %#v, want appended count", payload)
	}
}

func createMemoryAppendRunForTest(
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
		"conversation": map[string]any{
			"current_user_message": map[string]any{
				"created_at": now.Format(time.RFC3339),
			},
		},
	}
	if memoryEnabled != nil {
		contextProjection["memory"] = map[string]any{"enabled": *memoryEnabled}
	}
	_, err := store.CreateRun(context.Background(), execution.DurableRun{
		RunID:            runID,
		ConversationID:   "conv-" + runID,
		TurnID:           "turn-" + runID,
		RequestID:        "req-" + runID,
		TraceID:          "trace-" + runID,
		OwnerUserID:      "user-executor",
		Surface:          "campus-web",
		TaskQueue:        "campus-agent.workflow",
		Status:           execution.DurableRunStatusCompleted,
		TerminalReason:   execution.DurableTerminalReasonAnswerCompleted,
		CreatedAt:        now,
		UpdatedAt:        now,
		CompletedAt:      now,
		FinalResponseRef: temporalProjectionRef(runID, "finalization/write"),
		Metadata: map[string]any{
			"execution_payload": map[string]any{
				"context":    contextProjection,
				"request_id": "req-" + runID,
				"tenant_id":  "tenant-main",
				"trace":      map[string]any{"trace_id": "trace-" + runID},
				"user_goal":  userGoal,
			},
		},
	})
	if err != nil {
		t.Fatalf("create memory append run: %v", err)
	}
	if _, err := store.UpsertStepResult(context.Background(), execution.StepResultProjection{
		ResultID:             runID + ":finalization.write",
		RunID:                runID,
		StepID:               "finalization.write",
		ResultKind:           "final_answer_projection",
		ProjectionRef:        temporalProjectionRef(runID, "finalization/write"),
		PayloadSchemaVersion: "run-step-result-v1",
		SanitizedPayload: map[string]any{
			"finalized_response": map[string]any{
				"answer_text": "好的，我会在后续回答中结合保研材料准备这个目标。",
			},
		},
		Status:    "completed",
		CreatedAt: now,
	}); err != nil {
		t.Fatalf("put finalization result: %v", err)
	}
}

func ptrBool(value bool) *bool {
	return &value
}

func memoryAppendTraceID(runID string) string {
	return "trace-" + runID
}
