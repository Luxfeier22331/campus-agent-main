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

	output, err := server.AppendConversationMemory(
		context.Background(),
		temporalruntime.AppendConversationMemoryActivityInput{
			RequestID: "run-memory-append-disabled",
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

func TestAppendConversationMemoryActivitySkipsWhenPersonalMemoryIsNotConfigured(t *testing.T) {
	tests := []struct {
		name      string
		runID     string
		configure func(*Server)
	}{
		{
			name:      "executor missing",
			runID:     "executor-missing",
			configure: func(_ *Server) {},
		},
		{
			name:  "configuration error",
			runID: "configuration-error",
			configure: func(server *Server) {
				server.personalMemoryErr = errors.New("hindsight configuration is unavailable")
			},
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			store := execution.NewInMemoryRunProjectionStore()
			now := time.Date(2026, 6, 15, 12, 2, 0, 0, time.UTC)
			runID := "run-memory-append-not-configured-" + test.runID
			createMemoryAppendRunForTest(t, store, runID, "我之后主要关注保研材料", ptrBool(true), now)
			server := NewServer(config.Config{TemporalWorkerIdentity: "test:memory-append"})
			test.configure(server)
			attachRunProjectionStoreForHandlerTest(server, store)

			output, err := server.AppendConversationMemory(
				context.Background(),
				temporalruntime.AppendConversationMemoryActivityInput{RequestID: runID},
			)
			if err != nil {
				t.Fatalf("append conversation memory: %v", err)
			}
			if output.Status != "skipped" || output.SkippedCount != 1 || output.AppendedMessageCount != 0 {
				t.Fatalf("append output = %#v, want skipped without appended messages", output)
			}
			if len(output.SkipReasons) != 1 || output.SkipReasons[0] != "personal_memory_not_configured" {
				t.Fatalf("skip reasons = %#v", output.SkipReasons)
			}

			results, err := store.ListStepResults(context.Background(), runID)
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
				t.Fatal("memory.append skipped projection missing")
			}
			if payload["status"] != "skipped" || payload["skip_reasons"] == nil {
				t.Fatalf("payload = %#v, want skipped projection", payload)
			}
			if _, ok := payload["failure_kind"]; ok {
				t.Fatalf("skipped projection contains failure_kind: %#v", payload)
			}
		})
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

	output, err := server.AppendConversationMemory(
		context.Background(),
		temporalruntime.AppendConversationMemoryActivityInput{
			RequestID: "run-memory-append-enabled",
		},
	)
	if err != nil {
		t.Fatalf("append conversation memory: %v", err)
	}
	if output.Status != "completed" || output.AppendedMessageCount != 1 {
		t.Fatalf("append output = %#v, want completed user-message append", output)
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
	if executor.seenAppend.UserMessageID != "msg-run-memory-append-enabled" {
		t.Fatalf("user message id = %q", executor.seenAppend.UserMessageID)
	}
	if executor.seenAppend.UserMessageCreatedAt != now.Format(time.RFC3339Nano) {
		t.Fatalf("user_message_created_at = %q, want current user message created_at", executor.seenAppend.UserMessageCreatedAt)
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

	output, err := server.AppendConversationMemory(
		context.Background(),
		temporalruntime.AppendConversationMemoryActivityInput{
			RequestID: "run-memory-append-tenant",
		},
	)
	if err != nil {
		t.Fatalf("append conversation memory: %v", err)
	}
	if output.Status != "completed" {
		t.Fatalf("append output = %#v, want completed", output)
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

	output, err := server.AppendConversationMemory(
		context.Background(),
		temporalruntime.AppendConversationMemoryActivityInput{
			RequestID: "run-memory-append-failed",
		},
	)
	if err == nil {
		t.Fatal("append conversation memory must return a retryable Temporal error")
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
	failure, _ := payload["failure"].(map[string]any)
	if payload["status"] != "failed" || failure["code"] != "hindsight_append_failed" {
		t.Fatalf("payload = %#v, want failed hindsight append projection", payload)
	}
	if payload["user_message"] != nil || payload["assistant_message"] != nil {
		t.Fatalf("failure projection leaked conversation text: %#v", payload)
	}
}

func TestAppendConversationMemoryActivityRejectsUnknownRequest(t *testing.T) {
	store := execution.NewInMemoryRunProjectionStore()
	now := time.Date(2026, 6, 15, 12, 6, 0, 0, time.UTC)
	createMemoryAppendRunForTest(t, store, "run-memory-append-trace-mismatch", "我之后主要关注保研材料", ptrBool(true), now)
	server := NewServer(config.Config{TemporalWorkerIdentity: "test:memory-append"})
	attachRunProjectionStoreForHandlerTest(server, store)

	_, err := server.AppendConversationMemory(
		context.Background(),
		temporalruntime.AppendConversationMemoryActivityInput{
			RequestID: "request-memory-append-unknown",
		},
	)
	if err == nil {
		t.Fatal("expected unknown request error, got nil")
	}
}

func TestPostFinalizationMemoryAppendRejectsNonCompletedTerminalRuns(t *testing.T) {
	tests := []struct {
		status execution.DurableRunStatus
		reason execution.DurableTerminalReason
	}{
		{status: execution.DurableRunStatusCanceled, reason: execution.DurableTerminalReasonUserCanceled},
		{status: execution.DurableRunStatusFailed, reason: execution.DurableTerminalReasonProviderUnavailable},
		{status: execution.DurableRunStatusExpired, reason: execution.DurableTerminalReasonRunTimeout},
	}
	for _, test := range tests {
		t.Run(string(test.status), func(t *testing.T) {
			store := execution.NewInMemoryRunProjectionStore()
			now := time.Date(2026, 7, 23, 12, 0, 0, 0, time.UTC)
			runID := "run-memory-terminal-" + string(test.status)
			if _, err := store.CreateRun(context.Background(), execution.DurableRun{
				RequestID: runID, ConversationID: "conv-" + runID,
				OwnerUserID: "user-executor", Surface: "campus-web", TaskQueue: "campus-agent.workflow.v3",
				Status: test.status, TerminalReason: test.reason, CreatedAt: now, UpdatedAt: now, CompletedAt: now,
				Metadata: v3ExecutionMetadataForHTTPTest(runID),
			}); err != nil {
				t.Fatal(err)
			}
			executor := &fakePersonalMemoryExecutor{}
			server := NewServer(config.Config{TemporalWorkerIdentity: "test:memory-terminal"})
			server.personalMemoryExecutor = executor
			server.personalMemoryErr = nil
			attachRunProjectionStoreForHandlerTest(server, store)
			if _, err := server.AppendConversationMemory(context.Background(), temporalruntime.AppendConversationMemoryActivityInput{
				RequestID: runID,
			}); err == nil {
				t.Fatalf("append accepted %s run", test.status)
			}
			if executor.appendCount != 0 {
				t.Fatalf("terminal %s invoked memory append", test.status)
			}
		})
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

	_, err := server.AppendConversationMemory(
		context.Background(),
		temporalruntime.AppendConversationMemoryActivityInput{
			RequestID: "run-memory-append-projection",
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

func TestAppendConversationMemoryActivityProjectsCompletedResultWithoutProviderRefs(t *testing.T) {
	store := execution.NewInMemoryRunProjectionStore()
	now := time.Date(2026, 6, 15, 12, 11, 0, 0, time.UTC)
	createMemoryAppendRunForTest(t, store, "run-memory-append-operation", "我之后主要关注保研材料", ptrBool(true), now)
	server := NewServer(config.Config{TemporalWorkerIdentity: "test:memory-append"})
	server.personalMemoryExecutor = &fakePersonalMemoryExecutor{}
	server.personalMemoryErr = nil
	attachRunProjectionStoreForHandlerTest(server, store)

	output, err := server.AppendConversationMemory(
		context.Background(),
		temporalruntime.AppendConversationMemoryActivityInput{
			RequestID: "run-memory-append-operation",
		},
	)
	if err != nil {
		t.Fatalf("append conversation memory: %v", err)
	}
	if output.Status != "completed" || output.SchemaVersion != "memory_conversation_append_result_v3" {
		t.Fatalf("output = %#v", output)
	}

	results, err := store.ListStepResults(context.Background(), "run-memory-append-operation")
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
	if _, ok := payload["operation_id"]; ok {
		t.Fatalf("payload exposes provider operation id: %#v", payload)
	}
	if payload["status"] != "completed" || payload["schema_version"] != "memory_conversation_append_result_v3" {
		t.Fatalf("payload = %#v", payload)
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
			"user_message_id": "msg-" + runID,
			"current_user_message": map[string]any{
				"created_at": now.Format(time.RFC3339),
			},
		},
	}
	if memoryEnabled != nil {
		contextProjection["memory"] = map[string]any{"append_enabled": *memoryEnabled, "recall_enabled": *memoryEnabled, "owner_generation": 1, "owner_sequence": 0}
	}
	wire := executionPayloadWireForHTTPTest(
		runID,
		"conv-"+runID,
		userGoal,
		contextProjection,
	)
	wire.TenantID = "tenant-main"
	_, err := store.CreateRun(context.Background(), execution.DurableRun{
		RequestID:      runID,
		ConversationID: "conv-" + runID,
		OwnerUserID:    "user-executor",
		Surface:        "campus-web",
		TaskQueue:      "campus-agent.workflow",
		Status:         execution.DurableRunStatusRunning,
		CreatedAt:      now,
		StartedAt:      now,
		UpdatedAt:      now,
		Metadata:       v3ExecutionMetadataForHTTPTest(runID),
	})
	if err != nil {
		t.Fatalf("create memory append run: %v", err)
	}
	registerTestExecutionInput(t, store, execution.DurableRun{RequestID: runID}, wire)
	if _, err := store.UpsertStepResult(context.Background(), execution.StepResultProjection{
		ResultID:             runID + ":finalization.write",
		RequestID:            runID,
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
	if _, err := store.CompleteRunProjection(context.Background(), execution.DurableRunCompleteRequest{
		RequestID:        runID,
		TerminalReason:   execution.DurableTerminalReasonAnswerCompleted,
		FinalResponseRef: temporalProjectionRef(runID, "finalization/write"),
		Now:              now,
	}); err != nil {
		t.Fatalf("complete memory append run: %v", err)
	}
}

func ptrBool(value bool) *bool {
	return &value
}
