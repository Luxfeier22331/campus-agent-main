package execution

import (
	"context"
	"errors"
	"testing"
	"time"
)

func TestInMemoryRunProjectionStoreCreatesRunsWithConversationActiveRunLock(t *testing.T) {
	store := NewInMemoryDurableRuntimeStore()
	ctx := context.Background()
	createdAt := time.Date(2026, 6, 4, 8, 0, 0, 0, time.UTC)
	run := DurableRun{
		RunID:          "run-001",
		ConversationID: "conv-001",
		TurnID:         "turn-001",
		RequestID:      "req-001",
		TraceID:        "trace-001",
		OwnerUserID:    "user-001",
		Surface:        "public-chat-web",
		Lane:           DurableLaneRAG,
		CreatedAt:      createdAt,
		Metadata:       map[string]any{"source": "test"},
	}

	created, err := store.CreateRun(ctx, run)
	if err != nil {
		t.Fatalf("create run projection: %v", err)
	}
	if created.Status != DurableRunStatusCreated {
		t.Fatalf("created status = %q, want created", created.Status)
	}
	created.Metadata["source"] = "mutated"

	stored, err := store.GetRun(ctx, "run-001")
	if err != nil {
		t.Fatalf("get run projection: %v", err)
	}
	if stored.Metadata["source"] != "test" {
		t.Fatalf("stored metadata = %#v, want defensive copy", stored.Metadata)
	}

	_, err = store.CreateRun(ctx, DurableRun{
		RunID:          "run-duplicate-active",
		ConversationID: "conv-001",
		TurnID:         "turn-002",
		RequestID:      "req-002",
		OwnerUserID:    "user-001",
		Surface:        "public-chat-web",
		Lane:           DurableLaneRAG,
		CreatedAt:      createdAt.Add(time.Second),
	})
	if !errors.Is(err, ErrConversationActiveRun) {
		t.Fatalf("duplicate active conversation error = %v, want ErrConversationActiveRun", err)
	}

	if _, err := store.TransitionRun(ctx, "run-001", DurableRunStatusQueued, "", createdAt.Add(2*time.Second)); err != nil {
		t.Fatalf("queue run projection: %v", err)
	}
	if _, err := store.TransitionRun(ctx, "run-001", DurableRunStatusAdmitted, "", createdAt.Add(3*time.Second)); err != nil {
		t.Fatalf("admit run projection: %v", err)
	}
	if _, err := store.TransitionRun(ctx, "run-001", DurableRunStatusRunning, "", createdAt.Add(4*time.Second)); err != nil {
		t.Fatalf("start run projection: %v", err)
	}
	completed, err := store.TransitionRun(
		ctx,
		"run-001",
		DurableRunStatusCompleted,
		DurableTerminalReasonAnswerCompleted,
		createdAt.Add(5*time.Second),
	)
	if err != nil {
		t.Fatalf("complete run projection: %v", err)
	}
	if completed.CompletedAt.IsZero() {
		t.Fatal("completed run should record completed_at")
	}

	if _, err := store.CreateRun(ctx, DurableRun{
		RunID:          "run-after-terminal",
		ConversationID: "conv-001",
		TurnID:         "turn-003",
		RequestID:      "req-003",
		OwnerUserID:    "user-001",
		Surface:        "public-chat-web",
		Lane:           DurableLaneRAG,
		CreatedAt:      createdAt.Add(6 * time.Second),
	}); err != nil {
		t.Fatalf("create run after terminal active lock release: %v", err)
	}
}

func TestInMemoryRunProjectionStoreRejectsInvalidRunStateTransitions(t *testing.T) {
	store := NewInMemoryDurableRuntimeStore()
	ctx := context.Background()
	now := time.Date(2026, 6, 4, 8, 5, 0, 0, time.UTC)

	if _, err := store.CreateRun(ctx, DurableRun{}); !errors.Is(err, ErrInvalidDurableRun) {
		t.Fatalf("empty create error = %v, want ErrInvalidDurableRun", err)
	}
	if _, err := store.GetRun(ctx, "missing"); !errors.Is(err, ErrDurableRunNotFound) {
		t.Fatalf("missing get error = %v, want ErrDurableRunNotFound", err)
	}

	_, err := store.CreateRun(ctx, DurableRun{
		RunID:          "run-invalid-transition",
		ConversationID: "conv-invalid-transition",
		TurnID:         "turn-001",
		RequestID:      "req-001",
		OwnerUserID:    "user-001",
		Surface:        "public-chat-web",
		Lane:           DurableLaneRAG,
		CreatedAt:      now,
	})
	if err != nil {
		t.Fatalf("create run projection: %v", err)
	}
	if _, err := store.TransitionRun(
		ctx,
		"run-invalid-transition",
		DurableRunStatusRunning,
		"",
		now.Add(2*time.Second),
	); !errors.Is(err, ErrInvalidRunTransition) {
		t.Fatalf("created -> running error = %v, want ErrInvalidRunTransition", err)
	}
	if _, err := store.TransitionRun(
		ctx,
		"run-invalid-transition",
		DurableRunStatusQueued,
		"",
		now.Add(3*time.Second),
	); err != nil {
		t.Fatalf("created -> queued: %v", err)
	}
	if _, err := store.TransitionRun(
		ctx,
		"run-invalid-transition",
		DurableRunStatusAdmitted,
		"",
		now.Add(4*time.Second),
	); err != nil {
		t.Fatalf("queued -> admitted: %v", err)
	}
	if _, err := store.TransitionRun(
		ctx,
		"run-invalid-transition",
		DurableRunStatusRunning,
		"",
		now.Add(5*time.Second),
	); err != nil {
		t.Fatalf("admitted -> running: %v", err)
	}
	if _, err := store.TransitionRun(
		ctx,
		"run-invalid-transition",
		DurableRunStatusCompleted,
		"",
		now.Add(6*time.Second),
	); !errors.Is(err, ErrInvalidDurableRun) {
		t.Fatalf("terminal without reason error = %v, want ErrInvalidDurableRun", err)
	}
	if _, err := store.TransitionRun(
		ctx,
		"run-invalid-transition",
		DurableRunStatusCompleted,
		DurableTerminalReasonAnswerCompleted,
		now.Add(7*time.Second),
	); err != nil {
		t.Fatalf("running -> completed: %v", err)
	}
	if _, err := store.TransitionRun(
		ctx,
		"run-invalid-transition",
		DurableRunStatusRunning,
		"",
		now.Add(8*time.Second),
	); !errors.Is(err, ErrInvalidRunTransition) {
		t.Fatalf("terminal -> running error = %v, want ErrInvalidRunTransition", err)
	}
}

func TestInMemoryRunProjectionStoreAppendsRunEventsWithMonotonicSequence(t *testing.T) {
	store := NewInMemoryDurableRuntimeStore()
	ctx := context.Background()
	now := time.Date(2026, 6, 4, 8, 10, 0, 0, time.UTC)
	createRunProjectionForTest(t, store, "run-events", "conv-events", now)

	if _, err := store.AppendRunEvent(ctx, DurableRunEvent{
		EventID:              "evt-missing-run",
		RunID:                "missing-run",
		ConversationID:       "conv-events",
		EventType:            DurableRunEventTypeRunCreated,
		Sequence:             1,
		OccurredAt:           now,
		Visibility:           DurableRunEventVisibilityInternal,
		PayloadSchemaVersion: "run-event-v1",
		Payload:              map[string]any{"status": "created"},
	}); !errors.Is(err, ErrDurableRunNotFound) {
		t.Fatalf("missing run event append error = %v, want ErrDurableRunNotFound", err)
	}

	first, err := store.AppendRunEvent(ctx, DurableRunEvent{
		EventID:              "evt-001",
		RunID:                "run-events",
		ConversationID:       "conv-events",
		EventType:            DurableRunEventTypeRunCreated,
		OccurredAt:           now,
		Visibility:           DurableRunEventVisibilityInternal,
		PayloadSchemaVersion: "run-event-v1",
		Payload:              map[string]any{"status": "created"},
	})
	if err != nil {
		t.Fatalf("append first event: %v", err)
	}
	if first.Sequence != 1 {
		t.Fatalf("first event sequence = %d, want store-assigned 1", first.Sequence)
	}
	first.Payload["status"] = "mutated"

	if _, err := store.AppendRunEvent(ctx, DurableRunEvent{
		EventID:              "evt-duplicate-sequence",
		RunID:                "run-events",
		ConversationID:       "conv-events",
		EventType:            DurableRunEventTypeRunQueued,
		Sequence:             1,
		OccurredAt:           now.Add(time.Second),
		Visibility:           DurableRunEventVisibilityInternal,
		PayloadSchemaVersion: "run-event-v1",
		Payload:              map[string]any{"status": "queued"},
	}); !errors.Is(err, ErrInvalidRunEvent) {
		t.Fatalf("duplicate sequence error = %v, want ErrInvalidRunEvent", err)
	}
	if _, err := store.AppendRunEvent(ctx, DurableRunEvent{
		EventID:              "evt-gap-sequence",
		RunID:                "run-events",
		ConversationID:       "conv-events",
		EventType:            DurableRunEventTypeRunQueued,
		Sequence:             3,
		OccurredAt:           now.Add(2 * time.Second),
		Visibility:           DurableRunEventVisibilityInternal,
		PayloadSchemaVersion: "run-event-v1",
		Payload:              map[string]any{"status": "queued"},
	}); !errors.Is(err, ErrInvalidRunEvent) {
		t.Fatalf("sequence gap error = %v, want ErrInvalidRunEvent", err)
	}

	if _, err := store.AppendRunEvent(ctx, DurableRunEvent{
		EventID:              "evt-002",
		RunID:                "run-events",
		ConversationID:       "conv-events",
		EventType:            DurableRunEventTypeRunQueued,
		OccurredAt:           now.Add(3 * time.Second),
		Visibility:           DurableRunEventVisibilityInternal,
		PayloadSchemaVersion: "run-event-v1",
		Payload:              map[string]any{"status": "queued"},
	}); err != nil {
		t.Fatalf("append second event: %v", err)
	}

	events, err := store.ListRunEvents(ctx, "run-events")
	if err != nil {
		t.Fatalf("list events: %v", err)
	}
	if got := len(events); got != 2 {
		t.Fatalf("event count = %d, want 2", got)
	}
	if events[0].Payload["status"] != "created" {
		t.Fatalf("stored first event payload = %#v, want defensive copy", events[0].Payload)
	}
	afterFirst, err := store.ListRunEventsAfter(ctx, "run-events", 1)
	if err != nil {
		t.Fatalf("list events after first sequence: %v", err)
	}
	if got := len(afterFirst); got != 1 {
		t.Fatalf("events after first count = %d, want 1", got)
	}
	if afterFirst[0].Sequence != 2 || afterFirst[0].EventID != "evt-002" {
		t.Fatalf("events after first = %#v, want only second event", afterFirst)
	}
}

func TestInMemoryRunProjectionStoreWritesCancelProjectionEvent(t *testing.T) {
	store := NewInMemoryDurableRuntimeStore()
	ctx := context.Background()
	now := time.Date(2026, 6, 4, 8, 15, 0, 0, time.UTC)
	createRunProjectionForTest(t, store, "run-cancel", "conv-cancel", now)
	if _, err := store.TransitionRun(ctx, "run-cancel", DurableRunStatusQueued, "", now.Add(time.Second)); err != nil {
		t.Fatalf("queue run projection: %v", err)
	}

	canceled, err := store.CancelRunProjection(ctx, DurableRunCancelRequest{
		RunID:         "run-cancel",
		Reason:        "user_requested",
		ReleaseReason: "temporal_cancel_requested",
		Now:           now.Add(2 * time.Second),
	})
	if err != nil {
		t.Fatalf("cancel run projection: %v", err)
	}
	if canceled.Status != DurableRunStatusCanceled {
		t.Fatalf("canceled status = %q, want canceled", canceled.Status)
	}

	events, err := store.ListRunEvents(ctx, "run-cancel")
	if err != nil {
		t.Fatalf("list run cancel events: %v", err)
	}
	if len(events) != 1 {
		t.Fatalf("cancel event count = %d, want 1", len(events))
	}
	if events[0].EventType != DurableRunEventTypeRunCanceled {
		t.Fatalf("cancel event type = %q, want run.canceled", events[0].EventType)
	}
	if events[0].Payload["projection_only"] != true {
		t.Fatalf("cancel projection payload = %#v, want projection_only marker", events[0].Payload)
	}
}

func TestInMemoryRunProjectionStorePersistsStepTrajectory(t *testing.T) {
	store := NewInMemoryDurableRuntimeStore()
	ctx := context.Background()
	now := time.Date(2026, 6, 4, 8, 20, 0, 0, time.UTC)
	createRunProjectionForTest(t, store, "run-steps", "conv-steps", now)

	step, err := store.UpsertRunStep(ctx, RunStepProjection{
		StepID:               "step-planning",
		RunID:                "run-steps",
		ConversationID:       "conv-steps",
		StepKind:             "planning",
		Capability:           "structured",
		Status:               "completed",
		TaskQueue:            "campus-agent.workflow",
		WorkerID:             "staging:workflow:001",
		StartedAt:            now.Add(time.Second),
		CompletedAt:          now.Add(2 * time.Second),
		UpdatedAt:            now.Add(2 * time.Second),
		PayloadSchemaVersion: "run-step-v1",
		SanitizedPayload:     map[string]any{"shape": "single_step"},
	})
	if err != nil {
		t.Fatalf("upsert run step: %v", err)
	}
	step.SanitizedPayload["shape"] = "mutated"

	attempt, err := store.UpsertStepAttempt(ctx, StepAttemptProjection{
		AttemptID:            "attempt-planning-1",
		StepID:               "step-planning",
		RunID:                "run-steps",
		Attempt:              1,
		Status:               "completed",
		TaskQueue:            "campus-agent.workflow",
		WorkerID:             "staging:workflow:001",
		StartedAt:            now.Add(time.Second),
		CompletedAt:          now.Add(2 * time.Second),
		UpdatedAt:            now.Add(2 * time.Second),
		PayloadSchemaVersion: "step-attempt-v1",
		SanitizedPayload:     map[string]any{"provider": "none"},
	})
	if err != nil {
		t.Fatalf("upsert step attempt: %v", err)
	}
	attempt.SanitizedPayload["provider"] = "mutated"

	result, err := store.UpsertStepResult(ctx, StepResultProjection{
		ResultID:             "result-planning-1",
		StepID:               "step-planning",
		RunID:                "run-steps",
		AttemptID:            "attempt-planning-1",
		Status:               "completed",
		ResultKind:           "plan",
		ProjectionRef:        "runtime.agent_run_steps/step-planning",
		CreatedAt:            now.Add(2 * time.Second),
		PayloadSchemaVersion: "step-result-v1",
		SanitizedPayload:     map[string]any{"selected_capability": "rag"},
	})
	if err != nil {
		t.Fatalf("upsert step result: %v", err)
	}
	result.SanitizedPayload["selected_capability"] = "mutated"

	steps, err := store.ListRunSteps(ctx, "run-steps")
	if err != nil {
		t.Fatalf("list run steps: %v", err)
	}
	if len(steps) != 1 || steps[0].SanitizedPayload["shape"] != "single_step" {
		t.Fatalf("steps = %#v, want defensive persisted planning step", steps)
	}
	attempts, err := store.ListStepAttempts(ctx, "run-steps")
	if err != nil {
		t.Fatalf("list step attempts: %v", err)
	}
	if len(attempts) != 1 || attempts[0].SanitizedPayload["provider"] != "none" {
		t.Fatalf("attempts = %#v, want defensive persisted attempt", attempts)
	}
	results, err := store.ListStepResults(ctx, "run-steps")
	if err != nil {
		t.Fatalf("list step results: %v", err)
	}
	if len(results) != 1 || results[0].SanitizedPayload["selected_capability"] != "rag" {
		t.Fatalf("results = %#v, want defensive persisted result", results)
	}
}

func createRunProjectionForTest(
	t *testing.T,
	store *InMemoryDurableRuntimeStore,
	runID string,
	conversationID string,
	now time.Time,
) {
	t.Helper()
	if _, err := store.CreateRun(context.Background(), DurableRun{
		RunID:          runID,
		ConversationID: conversationID,
		TurnID:         runID + "-turn",
		RequestID:      runID + "-request",
		OwnerUserID:    "user-001",
		Surface:        "public-chat-web",
		Lane:           DurableLaneRAG,
		CreatedAt:      now,
	}); err != nil {
		t.Fatalf("create run projection %s: %v", runID, err)
	}
}
