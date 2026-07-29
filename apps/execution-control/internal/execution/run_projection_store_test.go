package execution

import (
	"context"
	"errors"
	"testing"
	"time"
)

func TestInMemoryRunProjectionStoreCreatesRunsWithConversationActiveRunLock(t *testing.T) {
	store := NewInMemoryRunProjectionStore()
	ctx := context.Background()
	createdAt := time.Date(2026, 6, 4, 8, 0, 0, 0, time.UTC)
	run := DurableRun{
		RunID:          "run-001",
		ConversationID: "conv-001",
		TurnID:         "turn-001",
		RequestID:      "req-001",
		TraceID:        "trace-001",
		OwnerUserID:    "user-001",
		Surface:        "campus-web",
		TaskQueue:      "campus-agent.workflow",
		CreatedAt:      createdAt,
		Metadata:       executionMetadataForTest("run-001", ""),
	}

	created, err := store.CreateRun(ctx, run)
	if err != nil {
		t.Fatalf("create run projection: %v", err)
	}
	if created.Status != DurableRunStatusCreated {
		t.Fatalf("created status = %q, want created", created.Status)
	}
	created.Metadata["execution_input_ref"] = "mutated"

	stored, err := store.GetRun(ctx, "run-001")
	if err != nil {
		t.Fatalf("get run projection: %v", err)
	}
	if stored.Metadata["execution_input_ref"] != "app-api://execution-inputs/run-001" {
		t.Fatalf("stored metadata = %#v, want defensive copy", stored.Metadata)
	}

	_, err = store.CreateRun(ctx, DurableRun{
		RunID:          "run-duplicate-active",
		ConversationID: "conv-001",
		TurnID:         "turn-002",
		RequestID:      "req-002",
		OwnerUserID:    "user-001",
		Surface:        "campus-web",
		TaskQueue:      "campus-agent.workflow",
		CreatedAt:      createdAt.Add(time.Second),
		Metadata:       executionMetadataForTest("run-duplicate-active", ""),
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
		Surface:        "campus-web",
		TaskQueue:      "campus-agent.workflow",
		CreatedAt:      createdAt.Add(6 * time.Second),
		Metadata:       executionMetadataForTest("run-after-terminal", ""),
	}); err != nil {
		t.Fatalf("create run after terminal active lock release: %v", err)
	}
}

func TestInMemoryRunProjectionStoreRejectsInvalidRunStateTransitions(t *testing.T) {
	store := NewInMemoryRunProjectionStore()
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
		Surface:        "campus-web",
		TaskQueue:      "campus-agent.workflow",
		CreatedAt:      now,
		Metadata:       executionMetadataForTest("run-invalid-transition", ""),
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

func TestInMemoryRunProjectionStoreCompletesRunWithFinalResponse(t *testing.T) {
	store := NewInMemoryRunProjectionStore()
	ctx := context.Background()
	now := time.Date(2026, 6, 4, 8, 8, 0, 0, time.UTC)
	createRunProjectionForTest(t, store, "run-complete-selected-tool", "conv-complete-selected-tool", now)
	if _, err := store.TransitionRun(
		ctx,
		"run-complete-selected-tool",
		DurableRunStatusQueued,
		"",
		now.Add(time.Second),
	); err != nil {
		t.Fatalf("queue run projection: %v", err)
	}
	if _, err := store.TransitionRun(
		ctx,
		"run-complete-selected-tool",
		DurableRunStatusAdmitted,
		"",
		now.Add(2*time.Second),
	); err != nil {
		t.Fatalf("admit run projection: %v", err)
	}
	if _, err := store.TransitionRun(
		ctx,
		"run-complete-selected-tool",
		DurableRunStatusRunning,
		"",
		now.Add(3*time.Second),
	); err != nil {
		t.Fatalf("start run projection: %v", err)
	}

	request := DurableRunCompleteRequest{
		FinalResponseRef: "projection://runs/run-complete-selected-tool/finalization/write",
		Now:              now.Add(4 * time.Second),
		RunID:            "run-complete-selected-tool",
		TerminalReason:   DurableTerminalReasonAnswerCompleted,
	}
	if _, err := store.CompleteRunProjection(ctx, request); !errors.Is(err, ErrInvalidDurableRunComplete) {
		t.Fatalf("complete without finalization result error = %v, want ErrInvalidDurableRunComplete", err)
	}
	if _, err := store.UpsertStepResult(ctx, StepResultProjection{
		ResultID:             "run-complete-selected-tool:finalization.write:result-1",
		StepID:               "finalization.write",
		RunID:                request.RunID,
		AttemptID:            "run-complete-selected-tool:finalization.write:attempt-1",
		Status:               "completed",
		ResultKind:           "final_answer_projection",
		ProjectionRef:        "projection://runs/run-complete-selected-tool/finalization/wrong",
		CreatedAt:            now.Add(4 * time.Second),
		PayloadSchemaVersion: "step-result-projection-v1",
		SanitizedPayload:     map[string]any{"agent_result_ref": "projection://runs/run-complete-selected-tool/agent/primary/result"},
	}); err != nil {
		t.Fatalf("store mismatched finalization result: %v", err)
	}
	if _, err := store.CompleteRunProjection(ctx, request); !errors.Is(err, ErrInvalidDurableRunComplete) {
		t.Fatalf("complete with mismatched finalization ref error = %v, want ErrInvalidDurableRunComplete", err)
	}
	if _, err := store.UpsertStepResult(ctx, StepResultProjection{
		ResultID:             "run-complete-selected-tool:finalization.write:result-2",
		StepID:               "finalization.write",
		RunID:                request.RunID,
		AttemptID:            "run-complete-selected-tool:finalization.write:attempt-2",
		Status:               "completed",
		ResultKind:           "final_answer_projection",
		ProjectionRef:        request.FinalResponseRef,
		CreatedAt:            now.Add(5 * time.Second),
		PayloadSchemaVersion: "step-result-projection-v1",
		SanitizedPayload:     map[string]any{"agent_result_ref": "projection://runs/run-complete-selected-tool/agent/primary/result"},
	}); err != nil {
		t.Fatalf("store matching finalization result: %v", err)
	}
	request.Now = now.Add(6 * time.Second)
	completed, err := store.CompleteRunProjection(ctx, request)
	if err != nil {
		t.Fatalf("complete run projection: %v", err)
	}
	if completed.Status != DurableRunStatusCompleted || completed.FinalResponseRef != request.FinalResponseRef {
		t.Fatalf("completed run = %#v", completed)
	}
}

func TestInMemoryRunProjectionStoreFailsRunWithTerminalReason(t *testing.T) {
	store := NewInMemoryRunProjectionStore()
	ctx := context.Background()
	now := time.Date(2026, 6, 4, 8, 9, 0, 0, time.UTC)
	createRunProjectionForTest(t, store, "run-fail-selected-tool", "conv-fail-selected-tool", now)
	if _, err := store.TransitionRun(
		ctx,
		"run-fail-selected-tool",
		DurableRunStatusQueued,
		"",
		now.Add(time.Second),
	); err != nil {
		t.Fatalf("queue run projection: %v", err)
	}
	if _, err := store.FailRunProjection(ctx, DurableRunFailRequest{
		RunID: "run-fail-selected-tool",
		Now:   now.Add(2 * time.Second),
	}); !errors.Is(err, ErrInvalidDurableRun) {
		t.Fatalf("fail without terminal reason error = %v, want ErrInvalidDurableRun", err)
	}

	failedAt := now.Add(3 * time.Second)
	failureRequest := DurableRunFailRequest{
		Now:             now.Add(3 * time.Second),
		RunID:           "run-fail-selected-tool",
		FailCloseReason: "provider_unavailable",
		TerminalReason:  DurableTerminalReasonProviderUnavailable,
		TerminalEvent: failedRunTerminalEventForTest(
			"run-fail-selected-tool",
			"conv-fail-selected-tool",
			failedAt,
			map[string]any{"failure_kind": "provider_unavailable", "status": "failed"},
		),
	}
	failed, err := store.FailRunProjection(ctx, failureRequest)
	if err != nil {
		t.Fatalf("fail run projection: %v", err)
	}
	if failed.Status != DurableRunStatusFailed {
		t.Fatalf("failed status = %q, want failed", failed.Status)
	}
	if failed.TerminalReason != DurableTerminalReasonProviderUnavailable {
		t.Fatalf("terminal reason = %q, want provider_unavailable", failed.TerminalReason)
	}
	if failed.FailCloseReason != "provider_unavailable" {
		t.Fatalf("fail close reason = %q, want provider_unavailable", failed.FailCloseReason)
	}
	if failed.CompletedAt.IsZero() {
		t.Fatal("failed run should record completed_at")
	}
	events, err := store.ListRunEvents(ctx, failed.RunID)
	if err != nil || len(events) != 1 || events[0].EventType != DurableRunEventTypeRunFailed {
		t.Fatalf("failed run events = %#v, error = %v", events, err)
	}
	replayed, err := store.FailRunProjection(ctx, failureRequest)
	if err != nil || replayed.CompletedAt != failed.CompletedAt {
		t.Fatalf("replay failure projection = %#v, error = %v", replayed, err)
	}
	conflictingRequest := failureRequest
	conflictingRequest.TerminalEvent = failedRunTerminalEventForTest(
		failureRequest.RunID,
		"conv-fail-selected-tool",
		failedAt,
		map[string]any{"failure_kind": "retrieval_unavailable", "status": "failed"},
	)
	if _, err := store.FailRunProjection(ctx, conflictingRequest); !errors.Is(err, ErrDurableRunFailureConflict) {
		t.Fatalf("conflicting failure replay error = %v, want ErrDurableRunFailureConflict", err)
	}
	conflictingReason := failureRequest
	conflictingReason.FailCloseReason = "retrieval_unavailable"
	if _, err := store.FailRunProjection(ctx, conflictingReason); !errors.Is(err, ErrDurableRunFailureConflict) {
		t.Fatalf("conflicting fail-close replay error = %v, want ErrDurableRunFailureConflict", err)
	}
	if _, err := store.CreateRun(ctx, DurableRun{
		RunID:          "run-after-failed-terminal",
		ConversationID: "conv-fail-selected-tool",
		TurnID:         "turn-after-failed-terminal",
		RequestID:      "req-after-failed-terminal",
		OwnerUserID:    "user-001",
		Surface:        "campus-web",
		TaskQueue:      "campus-agent.workflow",
		CreatedAt:      now.Add(4 * time.Second),
		Metadata:       executionMetadataForTest("run-after-failed-terminal", ""),
	}); err != nil {
		t.Fatalf("create run after failed terminal active lock release: %v", err)
	}
}

func TestDurableRunFailRequestRequiresCanonicalTerminalEvent(t *testing.T) {
	now := time.Date(2026, 6, 4, 8, 9, 15, 0, time.UTC)
	valid := DurableRunFailRequest{
		RunID:          "run-failure-contract",
		TerminalReason: DurableTerminalReasonProviderUnavailable,
		Now:            now,
		TerminalEvent: failedRunTerminalEventForTest(
			"run-failure-contract",
			"conv-failure-contract",
			now,
			map[string]any{"status": "failed"},
		),
	}
	tests := map[string]func(*DurableRunFailRequest){
		"event id": func(request *DurableRunFailRequest) {
			request.TerminalEvent.EventID = "another-event"
		},
		"event time": func(request *DurableRunFailRequest) {
			request.TerminalEvent.OccurredAt = now.Add(time.Second)
		},
		"event type": func(request *DurableRunFailRequest) {
			request.TerminalEvent.EventType = DurableRunEventTypeActivityFailed
		},
		"event visibility": func(request *DurableRunFailRequest) {
			request.TerminalEvent.Visibility = DurableRunEventVisibilityInternal
		},
		"event sequence": func(request *DurableRunFailRequest) {
			request.TerminalEvent.Sequence = 1
		},
	}
	for name, mutate := range tests {
		t.Run(name, func(t *testing.T) {
			request := valid
			mutate(&request)
			if err := validateDurableRunFailRequest(request); !errors.Is(err, ErrInvalidDurableRun) {
				t.Fatalf("validation error = %v, want ErrInvalidDurableRun", err)
			}
		})
	}
}

func TestInMemoryRunProjectionStoreRollsBackFailureWhenTerminalEventConflicts(t *testing.T) {
	store := NewInMemoryRunProjectionStore()
	ctx := context.Background()
	now := time.Date(2026, 6, 4, 8, 9, 30, 0, time.UTC)
	const runID = "run-fail-event-conflict"
	const conversationID = "conv-fail-event-conflict"
	createRunProjectionForTest(t, store, runID, conversationID, now)
	if _, err := store.TransitionRun(ctx, runID, DurableRunStatusQueued, "", now.Add(time.Second)); err != nil {
		t.Fatalf("queue run projection: %v", err)
	}
	if _, err := store.AppendRunEvent(ctx, DurableRunEvent{
		EventID:              runID + ":run-failed",
		RunID:                runID,
		ConversationID:       conversationID,
		EventType:            DurableRunEventTypeActivityFailed,
		OccurredAt:           now.Add(2 * time.Second),
		Visibility:           DurableRunEventVisibilityInternal,
		PayloadSchemaVersion: "run-event-v1",
		Payload:              map[string]any{"failure_kind": "earlier_failure"},
	}); err != nil {
		t.Fatalf("append conflicting event: %v", err)
	}
	failedAt := now.Add(3 * time.Second)
	_, err := store.FailRunProjection(ctx, DurableRunFailRequest{
		RunID:          runID,
		TerminalReason: DurableTerminalReasonProviderUnavailable,
		Now:            failedAt,
		TerminalEvent: failedRunTerminalEventForTest(
			runID,
			conversationID,
			failedAt,
			map[string]any{"failure_kind": "provider_unavailable"},
		),
	})
	if !errors.Is(err, ErrDurableRunFailureConflict) {
		t.Fatalf("failure event collision error = %v, want ErrDurableRunFailureConflict", err)
	}
	stored, err := store.GetRun(ctx, runID)
	if err != nil || stored.Status != DurableRunStatusQueued {
		t.Fatalf("run after failure rollback = %#v, error = %v", stored, err)
	}
	if _, err := store.CreateRun(ctx, DurableRun{
		RunID:          "run-after-failure-conflict",
		ConversationID: conversationID,
		TurnID:         "turn-after-failure-conflict",
		RequestID:      "request-after-failure-conflict",
		OwnerUserID:    "user-001",
		Surface:        "campus-web",
		TaskQueue:      "campus-agent.workflow",
		CreatedAt:      now.Add(4 * time.Second),
		Metadata:       executionMetadataForTest("run-after-failure-conflict", ""),
	}); !errors.Is(err, ErrConversationActiveRun) {
		t.Fatalf("active lock after failure rollback error = %v, want ErrConversationActiveRun", err)
	}
}

func TestInMemoryExpireRunProjectionCommitsTerminalEventAtomicallyAndReplays(t *testing.T) {
	store := NewInMemoryRunProjectionStore()
	ctx := context.Background()
	now := time.Date(2026, 7, 23, 10, 0, 0, 0, time.UTC)
	createRunProjectionForTest(t, store, "run-expiry-atomic", "conv-expiry-atomic", now)
	expiredAt := now.Add(15 * time.Minute)
	request := DurableRunExpireRequest{RunID: "run-expiry-atomic", Now: expiredAt}
	expired, err := store.ExpireRunProjection(ctx, request)
	if err != nil {
		t.Fatal(err)
	}
	if expired.Status != DurableRunStatusExpired || expired.TerminalReason != DurableTerminalReasonRunTimeout ||
		!expired.Retryable || !expired.CompletedAt.Equal(expiredAt) {
		t.Fatalf("expired run = %#v", expired)
	}
	events, err := store.ListRunEvents(ctx, expired.RunID)
	if err != nil || len(events) != 1 || events[0].EventType != DurableRunEventTypeRunExpired {
		t.Fatalf("expiry events = %#v, err=%v", events, err)
	}
	replayed, err := store.ExpireRunProjection(ctx, request)
	if err != nil || !replayed.CompletedAt.Equal(expired.CompletedAt) {
		t.Fatalf("expiry replay = %#v, err=%v", replayed, err)
	}
	createRunProjectionForTest(t, store, "run-after-expiry", expired.ConversationID, expiredAt.Add(time.Second))
}

func TestInMemoryExpireRunProjectionRollsBackOnTerminalEventCollision(t *testing.T) {
	store := NewInMemoryRunProjectionStore()
	ctx := context.Background()
	now := time.Date(2026, 7, 23, 10, 30, 0, 0, time.UTC)
	const runID = "run-expiry-collision"
	createRunProjectionForTest(t, store, runID, "conv-expiry-collision", now)
	if _, err := store.AppendRunEvent(ctx, DurableRunEvent{
		EventID: runID + ":run-expired", RunID: runID, ConversationID: "conv-expiry-collision",
		EventType: DurableRunEventTypeActivityFailed, OccurredAt: now,
		Visibility: DurableRunEventVisibilityInternal, PayloadSchemaVersion: "run-event-v1",
		Payload: map[string]any{"failure_kind": "earlier"},
	}); err != nil {
		t.Fatal(err)
	}
	if _, err := store.ExpireRunProjection(ctx, DurableRunExpireRequest{
		RunID: runID, Now: now.Add(15 * time.Minute),
	}); !errors.Is(err, ErrDurableRunExpiryConflict) {
		t.Fatalf("expiry collision error = %v", err)
	}
	run, err := store.GetRun(ctx, runID)
	if err != nil || run.Status != DurableRunStatusCreated {
		t.Fatalf("run after expiry collision = %#v, err=%v", run, err)
	}
}

func TestInMemoryRunProjectionStoreAppendsRunEventsWithMonotonicSequence(t *testing.T) {
	store := NewInMemoryRunProjectionStore()
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

func TestInMemoryRunProjectionStoreRejectsBrowserFinalizationResponsePayload(t *testing.T) {
	store := NewInMemoryRunProjectionStore()
	ctx := context.Background()
	now := time.Date(2026, 6, 4, 8, 12, 0, 0, time.UTC)
	createRunProjectionForTest(t, store, "run-finalization-event", "conv-finalization-event", now)

	_, err := store.AppendRunEvent(ctx, DurableRunEvent{
		EventID:              "evt-finalization-browser-leak",
		RunID:                "run-finalization-event",
		ConversationID:       "conv-finalization-event",
		EventType:            DurableRunEventTypeFinalizationCompleted,
		OccurredAt:           now,
		Visibility:           DurableRunEventVisibilityBrowser,
		PayloadSchemaVersion: "run-event-v1",
		Payload: map[string]any{
			"request_id": "req-finalization-event",
			"response":   map[string]any{"answer_text": "must stay internal"},
			"trace_id":   "trace-finalization-event",
		},
	})
	if !errors.Is(err, ErrInvalidRunEvent) {
		t.Fatalf("browser finalization response error = %v, want ErrInvalidRunEvent", err)
	}

	if _, err := store.AppendRunEvent(ctx, DurableRunEvent{
		EventID:              "evt-finalization-browser-safe",
		RunID:                "run-finalization-event",
		ConversationID:       "conv-finalization-event",
		EventType:            DurableRunEventTypeFinalizationCompleted,
		OccurredAt:           now.Add(time.Second),
		Visibility:           DurableRunEventVisibilityBrowser,
		PayloadSchemaVersion: "run-event-v1",
		Payload: map[string]any{
			"request_id": "req-finalization-event",
			"trace_id":   "trace-finalization-event",
		},
	}); err != nil {
		t.Fatalf("append safe browser finalization event: %v", err)
	}
	if _, err := store.AppendRunEvent(ctx, DurableRunEvent{
		EventID:              "evt-finalization-internal",
		RunID:                "run-finalization-event",
		ConversationID:       "conv-finalization-event",
		EventType:            DurableRunEventTypeFinalizationCompleted,
		OccurredAt:           now.Add(2 * time.Second),
		Visibility:           DurableRunEventVisibilityInternal,
		PayloadSchemaVersion: "run-event-v1",
		Payload: map[string]any{
			"request_id": "req-finalization-event",
			"response":   map[string]any{"answer_text": "internal closeout"},
			"trace_id":   "trace-finalization-event",
		},
	}); err != nil {
		t.Fatalf("append internal finalization event: %v", err)
	}
}

func TestInMemoryRunProjectionStoreWritesCancelProjectionEvent(t *testing.T) {
	store := NewInMemoryRunProjectionStore()
	ctx := context.Background()
	now := time.Date(2026, 6, 4, 8, 15, 0, 0, time.UTC)
	createRunProjectionForTest(t, store, "run-cancel", "conv-cancel", now)
	if _, err := store.TransitionRun(ctx, "run-cancel", DurableRunStatusQueued, "", now.Add(time.Second)); err != nil {
		t.Fatalf("queue run projection: %v", err)
	}
	if _, err := store.RequestRunCancellation(ctx, DurableRunCancellationRequest{
		RunID: "run-cancel", Reason: "user_requested", Now: now.Add(2 * time.Second),
	}); err != nil {
		t.Fatalf("request run cancellation: %v", err)
	}

	canceled, err := store.CancelRunProjection(ctx, DurableRunCancelRequest{
		RunID:  "run-cancel",
		Reason: "user_requested",
		Now:    now.Add(3 * time.Second),
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
	if len(events) != 2 {
		t.Fatalf("cancel event count = %d, want 2", len(events))
	}
	if events[0].EventType != DurableRunEventTypeRunCancelRequested ||
		events[0].Visibility != DurableRunEventVisibilityInternal {
		t.Fatalf("cancel request event = %#v", events[0])
	}
	canceledEvent := events[1]
	if canceledEvent.EventType != DurableRunEventTypeRunCanceled ||
		canceledEvent.Visibility != DurableRunEventVisibilityBrowser {
		t.Fatalf("cancel event = %#v, want browser run.canceled", canceledEvent)
	}
	for key := range canceledEvent.Payload {
		switch key {
		case "request_id", "trace_id", "status", "terminal_reason":
		default:
			t.Fatalf("cancel projection payload contains forbidden key %q: %#v", key, canceledEvent.Payload)
		}
	}
}

func TestInMemoryRunProjectionStorePersistsStepTrajectory(t *testing.T) {
	store := NewInMemoryRunProjectionStore()
	ctx := context.Background()
	now := time.Date(2026, 6, 4, 8, 20, 0, 0, time.UTC)
	createRunProjectionForTest(t, store, "run-steps", "conv-steps", now)

	step, err := store.UpsertRunStep(ctx, RunStepProjection{
		StepID:               "agent.primary",
		RunID:                "run-steps",
		ConversationID:       "conv-steps",
		StepKind:             "agent",
		Tool:                 "",
		Status:               "completed",
		TaskQueue:            "campus-agent.activity.agent",
		WorkerID:             "staging:agent:001",
		StartedAt:            now.Add(time.Second),
		CompletedAt:          now.Add(2 * time.Second),
		UpdatedAt:            now.Add(2 * time.Second),
		PayloadSchemaVersion: "run-step-v1",
		SanitizedPayload:     map[string]any{"shape": "agent_loop"},
	})
	if err != nil {
		t.Fatalf("upsert run step: %v", err)
	}
	step.SanitizedPayload["shape"] = "mutated"

	attempt, err := store.UpsertStepAttempt(ctx, StepAttemptProjection{
		AttemptID:             "attempt-agent-1",
		StepID:                "agent.primary",
		RunID:                 "run-steps",
		Attempt:               1,
		Status:                "completed",
		TaskQueue:             "campus-agent.activity.agent",
		WorkerID:              "staging:agent:001",
		WorkflowID:            "campus-agent.chat.run-steps",
		TemporalRunID:         "temporal-run-001",
		ActivityID:            "activity-agent-001",
		ActivityType:          "ExecutePrimaryAgentActivity",
		ActivityAttempt:       1,
		ScheduledAt:           now.Add(900 * time.Millisecond),
		StartedAt:             now.Add(time.Second),
		CompletedAt:           now.Add(2 * time.Second),
		ScheduleToStartMS:     100,
		DurationMS:            1000,
		ProviderRequestRef:    "provider-request-ref",
		ProviderResponseID:    "resp_001",
		ModelProvider:         "openai",
		ModelName:             "gpt-5-mini",
		ModelRequestCount:     3,
		InputTokens:           100,
		OutputTokens:          40,
		CachedInputTokens:     20,
		UsageObserved:         true,
		CancelOutcome:         CancelOutcomeNotRequested,
		TimeoutOutcome:        TimeoutOutcomeNotTimedOut,
		LateCompletionOutcome: LateCompletionOutcomeIgnoredAfterCancel,
		FailCloseReason:       "source_conflict",
		TerminalReason:        "answer_completed",
		UpdatedAt:             now.Add(2 * time.Second),
		PayloadSchemaVersion:  "step-attempt-v1",
		SanitizedPayload:      map[string]any{"provider": "none"},
	})
	if err != nil {
		t.Fatalf("upsert step attempt: %v", err)
	}
	attempt.SanitizedPayload["provider"] = "mutated"

	result, err := store.UpsertStepResult(ctx, StepResultProjection{
		ResultID:             "result-agent-1",
		StepID:               "agent.primary",
		RunID:                "run-steps",
		AttemptID:            "attempt-agent-1",
		Status:               "completed",
		ResultKind:           "agent_final_output",
		ProjectionRef:        "runtime.agent_run_steps/agent.primary",
		CreatedAt:            now.Add(2 * time.Second),
		PayloadSchemaVersion: "step-result-v1",
		SanitizedPayload:     map[string]any{"outcome": "answer"},
	})
	if err != nil {
		t.Fatalf("upsert step result: %v", err)
	}
	result.SanitizedPayload["outcome"] = "mutated"

	steps, err := store.ListRunSteps(ctx, "run-steps")
	if err != nil {
		t.Fatalf("list run steps: %v", err)
	}
	if len(steps) != 1 || steps[0].SanitizedPayload["shape"] != "agent_loop" {
		t.Fatalf("steps = %#v, want defensive persisted agent step", steps)
	}
	attempts, err := store.ListStepAttempts(ctx, "run-steps")
	if err != nil {
		t.Fatalf("list step attempts: %v", err)
	}
	if len(attempts) != 1 || attempts[0].SanitizedPayload["provider"] != "none" {
		t.Fatalf("attempts = %#v, want defensive persisted attempt", attempts)
	}
	if attempts[0].WorkflowID != "campus-agent.chat.run-steps" ||
		attempts[0].ActivityType != "ExecutePrimaryAgentActivity" ||
		attempts[0].ScheduleToStartMS != 100 ||
		attempts[0].DurationMS != 1000 ||
		attempts[0].ProviderResponseID != "resp_001" ||
		attempts[0].ModelRequestCount != 3 ||
		attempts[0].InputTokens != 100 ||
		attempts[0].OutputTokens != 40 ||
		attempts[0].CachedInputTokens != 20 ||
		!attempts[0].UsageObserved ||
		attempts[0].CancelOutcome != CancelOutcomeNotRequested ||
		attempts[0].TimeoutOutcome != TimeoutOutcomeNotTimedOut ||
		attempts[0].LateCompletionOutcome != LateCompletionOutcomeIgnoredAfterCancel ||
		attempts[0].FailCloseReason != "source_conflict" {
		t.Fatalf("attempt evidence fields = %#v, want first-class temporal/provider evidence", attempts[0])
	}
	results, err := store.ListStepResults(ctx, "run-steps")
	if err != nil {
		t.Fatalf("list step results: %v", err)
	}
	if len(results) != 1 || results[0].SanitizedPayload["outcome"] != "answer" {
		t.Fatalf("results = %#v, want defensive persisted result", results)
	}
}

func createRunProjectionForTest(
	t *testing.T,
	store *InMemoryRunProjectionStore,
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
		Surface:        "campus-web",
		TaskQueue:      "campus-agent.workflow",
		CreatedAt:      now,
		Metadata:       executionMetadataForTest(runID, ""),
	}); err != nil {
		t.Fatalf("create run projection %s: %v", runID, err)
	}
}

func failedRunTerminalEventForTest(
	runID string,
	conversationID string,
	now time.Time,
	payload map[string]any,
) DurableRunEvent {
	return DurableRunEvent{
		EventID:              runID + ":run-failed",
		RunID:                runID,
		ConversationID:       conversationID,
		EventType:            DurableRunEventTypeRunFailed,
		OccurredAt:           now,
		Visibility:           DurableRunEventVisibilityBrowser,
		PayloadSchemaVersion: "run-event-v1",
		Payload:              payload,
	}
}
