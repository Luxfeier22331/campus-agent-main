package executionpersistence

import (
	"context"
	"errors"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/execution"
	"testing"
	"time"
)

func TestInMemoryRunProjectionStoreCreatesRunsWithConversationActiveRunLock(t *testing.T) {
	store := NewInMemoryRunProjectionStore()
	ctx := context.Background()
	createdAt := time.Date(2026, 6, 4, 8, 0, 0, 0, time.UTC)
	run := execution.DurableRun{
		RequestID:      "run-001",
		ConversationID: "conv-001",
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
	if created.Status != execution.DurableRunStatusCreated {
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

	_, err = store.CreateRun(ctx, execution.DurableRun{
		RequestID:      "run-duplicate-active",
		ConversationID: "conv-001",
		OwnerUserID:    "user-001",
		Surface:        "campus-web",
		TaskQueue:      "campus-agent.workflow",
		CreatedAt:      createdAt.Add(time.Second),
		Metadata:       executionMetadataForTest("run-duplicate-active", ""),
	})
	if !errors.Is(err, execution.ErrConversationActiveRun) {
		t.Fatalf("duplicate active conversation error = %v, want execution.ErrConversationActiveRun", err)
	}

	if _, err := store.TransitionRun(ctx, "run-001", execution.DurableRunStatusQueued, "", createdAt.Add(2*time.Second)); err != nil {
		t.Fatalf("queue run projection: %v", err)
	}
	if _, err := store.TransitionRun(ctx, "run-001", execution.DurableRunStatusAdmitted, "", createdAt.Add(3*time.Second)); err != nil {
		t.Fatalf("admit run projection: %v", err)
	}
	if _, err := store.TransitionRun(ctx, "run-001", execution.DurableRunStatusRunning, "", createdAt.Add(4*time.Second)); err != nil {
		t.Fatalf("start run projection: %v", err)
	}
	completed, err := store.TransitionRun(
		ctx,
		"run-001",
		execution.DurableRunStatusCompleted,
		execution.DurableTerminalReasonAnswerCompleted,
		createdAt.Add(5*time.Second),
	)
	if err != nil {
		t.Fatalf("complete run projection: %v", err)
	}
	if completed.CompletedAt.IsZero() {
		t.Fatal("completed run should record completed_at")
	}

	if _, err := store.CreateRun(ctx, execution.DurableRun{
		RequestID:      "run-after-terminal",
		ConversationID: "conv-001",
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

	if _, err := store.CreateRun(ctx, execution.DurableRun{}); !errors.Is(err, execution.ErrInvalidDurableRun) {
		t.Fatalf("empty create error = %v, want execution.ErrInvalidDurableRun", err)
	}
	if _, err := store.GetRun(ctx, "missing"); !errors.Is(err, execution.ErrDurableRunNotFound) {
		t.Fatalf("missing get error = %v, want execution.ErrDurableRunNotFound", err)
	}

	_, err := store.CreateRun(ctx, execution.DurableRun{
		RequestID:      "run-invalid-transition",
		ConversationID: "conv-invalid-transition",
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
		execution.DurableRunStatusRunning,
		"",
		now.Add(2*time.Second),
	); !errors.Is(err, execution.ErrInvalidRunTransition) {
		t.Fatalf("created -> running error = %v, want execution.ErrInvalidRunTransition", err)
	}
	if _, err := store.TransitionRun(
		ctx,
		"run-invalid-transition",
		execution.DurableRunStatusQueued,
		"",
		now.Add(3*time.Second),
	); err != nil {
		t.Fatalf("created -> queued: %v", err)
	}
	if _, err := store.TransitionRun(
		ctx,
		"run-invalid-transition",
		execution.DurableRunStatusAdmitted,
		"",
		now.Add(4*time.Second),
	); err != nil {
		t.Fatalf("queued -> admitted: %v", err)
	}
	if _, err := store.TransitionRun(
		ctx,
		"run-invalid-transition",
		execution.DurableRunStatusRunning,
		"",
		now.Add(5*time.Second),
	); err != nil {
		t.Fatalf("admitted -> running: %v", err)
	}
	if _, err := store.TransitionRun(
		ctx,
		"run-invalid-transition",
		execution.DurableRunStatusCompleted,
		"",
		now.Add(6*time.Second),
	); !errors.Is(err, execution.ErrInvalidDurableRun) {
		t.Fatalf("terminal without reason error = %v, want execution.ErrInvalidDurableRun", err)
	}
	if _, err := store.TransitionRun(
		ctx,
		"run-invalid-transition",
		execution.DurableRunStatusCompleted,
		execution.DurableTerminalReasonAnswerCompleted,
		now.Add(7*time.Second),
	); err != nil {
		t.Fatalf("running -> completed: %v", err)
	}
	if _, err := store.TransitionRun(
		ctx,
		"run-invalid-transition",
		execution.DurableRunStatusRunning,
		"",
		now.Add(8*time.Second),
	); !errors.Is(err, execution.ErrInvalidRunTransition) {
		t.Fatalf("terminal -> running error = %v, want execution.ErrInvalidRunTransition", err)
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
		execution.DurableRunStatusQueued,
		"",
		now.Add(time.Second),
	); err != nil {
		t.Fatalf("queue run projection: %v", err)
	}
	if _, err := store.TransitionRun(
		ctx,
		"run-complete-selected-tool",
		execution.DurableRunStatusAdmitted,
		"",
		now.Add(2*time.Second),
	); err != nil {
		t.Fatalf("admit run projection: %v", err)
	}
	if _, err := store.TransitionRun(
		ctx,
		"run-complete-selected-tool",
		execution.DurableRunStatusRunning,
		"",
		now.Add(3*time.Second),
	); err != nil {
		t.Fatalf("start run projection: %v", err)
	}

	request := execution.DurableRunCompleteRequest{
		FinalResponseRef: "projection://runs/run-complete-selected-tool/finalization/write",
		Now:              now.Add(4 * time.Second),
		RequestID:        "run-complete-selected-tool",
		TerminalReason:   execution.DurableTerminalReasonAnswerCompleted,
	}
	if _, err := store.CompleteRunProjection(ctx, request); !errors.Is(err, execution.ErrInvalidDurableRunComplete) {
		t.Fatalf("complete without finalization result error = %v, want execution.ErrInvalidDurableRunComplete", err)
	}
	if _, err := store.UpsertStepResult(ctx, execution.StepResultProjection{
		ResultID:             "run-complete-selected-tool:finalization.write:result-1",
		StepID:               "finalization.write",
		RequestID:            request.RequestID,
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
	if _, err := store.CompleteRunProjection(ctx, request); !errors.Is(err, execution.ErrInvalidDurableRunComplete) {
		t.Fatalf("complete with mismatched finalization ref error = %v, want execution.ErrInvalidDurableRunComplete", err)
	}
	if _, err := store.UpsertStepResult(ctx, execution.StepResultProjection{
		ResultID:             "run-complete-selected-tool:finalization.write:result-2",
		StepID:               "finalization.write",
		RequestID:            request.RequestID,
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
	if completed.Status != execution.DurableRunStatusCompleted || completed.FinalResponseRef != request.FinalResponseRef {
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
		execution.DurableRunStatusQueued,
		"",
		now.Add(time.Second),
	); err != nil {
		t.Fatalf("queue run projection: %v", err)
	}
	if _, err := store.FailRunProjection(ctx, execution.DurableRunFailRequest{
		RequestID: "run-fail-selected-tool",
		Now:       now.Add(2 * time.Second),
	}); !errors.Is(err, execution.ErrInvalidDurableRun) {
		t.Fatalf("fail without terminal reason error = %v, want execution.ErrInvalidDurableRun", err)
	}

	failedAt := now.Add(3 * time.Second)
	failureRequest := execution.DurableRunFailRequest{
		Now:             now.Add(3 * time.Second),
		RequestID:       "run-fail-selected-tool",
		FailCloseReason: "provider_unavailable",
		TerminalReason:  execution.DurableTerminalReasonProviderUnavailable,
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
	if failed.Status != execution.DurableRunStatusFailed {
		t.Fatalf("failed status = %q, want failed", failed.Status)
	}
	if failed.TerminalReason != execution.DurableTerminalReasonProviderUnavailable {
		t.Fatalf("terminal reason = %q, want provider_unavailable", failed.TerminalReason)
	}
	if failed.FailCloseReason != "provider_unavailable" {
		t.Fatalf("fail close reason = %q, want provider_unavailable", failed.FailCloseReason)
	}
	if failed.CompletedAt.IsZero() {
		t.Fatal("failed run should record completed_at")
	}
	events, err := store.ListRunEvents(ctx, failed.RequestID)
	if err != nil || len(events) != 1 || events[0].EventType != execution.DurableRunEventTypeRunFailed {
		t.Fatalf("failed run events = %#v, error = %v", events, err)
	}
	replayed, err := store.FailRunProjection(ctx, failureRequest)
	if err != nil || replayed.CompletedAt != failed.CompletedAt {
		t.Fatalf("replay failure projection = %#v, error = %v", replayed, err)
	}
	conflictingRequest := failureRequest
	conflictingRequest.TerminalEvent = failedRunTerminalEventForTest(
		failureRequest.RequestID,
		"conv-fail-selected-tool",
		failedAt,
		map[string]any{"failure_kind": "worker_unavailable", "status": "failed"},
	)
	if _, err := store.FailRunProjection(ctx, conflictingRequest); !errors.Is(err, execution.ErrDurableRunFailureConflict) {
		t.Fatalf("conflicting failure replay error = %v, want execution.ErrDurableRunFailureConflict", err)
	}
	conflictingReason := failureRequest
	conflictingReason.FailCloseReason = "worker_unavailable"
	if _, err := store.FailRunProjection(ctx, conflictingReason); !errors.Is(err, execution.ErrDurableRunFailureConflict) {
		t.Fatalf("conflicting fail-close replay error = %v, want execution.ErrDurableRunFailureConflict", err)
	}
	if _, err := store.CreateRun(ctx, execution.DurableRun{
		RequestID:      "run-after-failed-terminal",
		ConversationID: "conv-fail-selected-tool",
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
	valid := execution.DurableRunFailRequest{
		RequestID:      "run-failure-contract",
		TerminalReason: execution.DurableTerminalReasonProviderUnavailable,
		Now:            now,
		TerminalEvent: failedRunTerminalEventForTest(
			"run-failure-contract",
			"conv-failure-contract",
			now,
			map[string]any{"status": "failed"},
		),
	}
	tests := map[string]func(*execution.DurableRunFailRequest){
		"event id": func(request *execution.DurableRunFailRequest) {
			request.TerminalEvent.EventID = "another-event"
		},
		"event time": func(request *execution.DurableRunFailRequest) {
			request.TerminalEvent.OccurredAt = now.Add(time.Second)
		},
		"event type": func(request *execution.DurableRunFailRequest) {
			request.TerminalEvent.EventType = execution.DurableRunEventTypeActivityFailed
		},
		"event visibility": func(request *execution.DurableRunFailRequest) {
			request.TerminalEvent.Visibility = execution.DurableRunEventVisibilityInternal
		},
		"event sequence": func(request *execution.DurableRunFailRequest) {
			request.TerminalEvent.Sequence = 1
		},
	}
	for name, mutate := range tests {
		t.Run(name, func(t *testing.T) {
			request := valid
			mutate(&request)
			if err := execution.ValidateDurableRunFailRequest(request); !errors.Is(err, execution.ErrInvalidDurableRun) {
				t.Fatalf("validation error = %v, want execution.ErrInvalidDurableRun", err)
			}
		})
	}
}

func TestInMemoryRunProjectionStoreRollsBackFailureWhenTerminalEventConflicts(t *testing.T) {
	store := NewInMemoryRunProjectionStore()
	ctx := context.Background()
	now := time.Date(2026, 6, 4, 8, 9, 30, 0, time.UTC)
	const requestID = "run-fail-event-conflict"
	const conversationID = "conv-fail-event-conflict"
	createRunProjectionForTest(t, store, requestID, conversationID, now)
	if _, err := store.TransitionRun(ctx, requestID, execution.DurableRunStatusQueued, "", now.Add(time.Second)); err != nil {
		t.Fatalf("queue run projection: %v", err)
	}
	if _, err := store.AppendRunEvent(ctx, execution.DurableRunEvent{
		EventID:              requestID + ":run-failed",
		RequestID:            requestID,
		ConversationID:       conversationID,
		EventType:            execution.DurableRunEventTypeActivityFailed,
		OccurredAt:           now.Add(2 * time.Second),
		Visibility:           execution.DurableRunEventVisibilityInternal,
		PayloadSchemaVersion: "run-event-v1",
		Payload:              map[string]any{"failure_kind": "earlier_failure"},
	}); err != nil {
		t.Fatalf("append conflicting event: %v", err)
	}
	failedAt := now.Add(3 * time.Second)
	_, err := store.FailRunProjection(ctx, execution.DurableRunFailRequest{
		RequestID:      requestID,
		TerminalReason: execution.DurableTerminalReasonProviderUnavailable,
		Now:            failedAt,
		TerminalEvent: failedRunTerminalEventForTest(
			requestID,
			conversationID,
			failedAt,
			map[string]any{"failure_kind": "provider_unavailable"},
		),
	})
	if !errors.Is(err, execution.ErrDurableRunFailureConflict) {
		t.Fatalf("failure event collision error = %v, want execution.ErrDurableRunFailureConflict", err)
	}
	stored, err := store.GetRun(ctx, requestID)
	if err != nil || stored.Status != execution.DurableRunStatusQueued {
		t.Fatalf("run after failure rollback = %#v, error = %v", stored, err)
	}
	if _, err := store.CreateRun(ctx, execution.DurableRun{
		RequestID:      "run-after-failure-conflict",
		ConversationID: conversationID,
		OwnerUserID:    "user-001",
		Surface:        "campus-web",
		TaskQueue:      "campus-agent.workflow",
		CreatedAt:      now.Add(4 * time.Second),
		Metadata:       executionMetadataForTest("run-after-failure-conflict", ""),
	}); !errors.Is(err, execution.ErrConversationActiveRun) {
		t.Fatalf("active lock after failure rollback error = %v, want execution.ErrConversationActiveRun", err)
	}
}

func TestInMemoryExpireRunProjectionCommitsTerminalEventAtomicallyAndReplays(t *testing.T) {
	store := NewInMemoryRunProjectionStore()
	ctx := context.Background()
	now := time.Date(2026, 7, 23, 10, 0, 0, 0, time.UTC)
	createRunProjectionForTest(t, store, "run-expiry-atomic", "conv-expiry-atomic", now)
	expiredAt := now.Add(15 * time.Minute)
	request := execution.DurableRunExpireRequest{RequestID: "run-expiry-atomic", Now: expiredAt}
	expired, err := store.ExpireRunProjection(ctx, request)
	if err != nil {
		t.Fatal(err)
	}
	if expired.Status != execution.DurableRunStatusExpired || expired.TerminalReason != execution.DurableTerminalReasonRunTimeout ||
		!expired.Retryable || !expired.CompletedAt.Equal(expiredAt) {
		t.Fatalf("expired run = %#v", expired)
	}
	events, err := store.ListRunEvents(ctx, expired.RequestID)
	if err != nil || len(events) != 1 || events[0].EventType != execution.DurableRunEventTypeRunExpired {
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
	const requestID = "run-expiry-collision"
	createRunProjectionForTest(t, store, requestID, "conv-expiry-collision", now)
	if _, err := store.AppendRunEvent(ctx, execution.DurableRunEvent{
		EventID: requestID + ":run-expired", RequestID: requestID, ConversationID: "conv-expiry-collision",
		EventType: execution.DurableRunEventTypeActivityFailed, OccurredAt: now,
		Visibility: execution.DurableRunEventVisibilityInternal, PayloadSchemaVersion: "run-event-v1",
		Payload: map[string]any{"failure_kind": "earlier"},
	}); err != nil {
		t.Fatal(err)
	}
	if _, err := store.ExpireRunProjection(ctx, execution.DurableRunExpireRequest{
		RequestID: requestID, Now: now.Add(15 * time.Minute),
	}); !errors.Is(err, execution.ErrDurableRunExpiryConflict) {
		t.Fatalf("expiry collision error = %v", err)
	}
	run, err := store.GetRun(ctx, requestID)
	if err != nil || run.Status != execution.DurableRunStatusCreated {
		t.Fatalf("run after expiry collision = %#v, err=%v", run, err)
	}
}

func TestInMemoryRunProjectionStoreAppendsRunEventsWithMonotonicSequence(t *testing.T) {
	store := NewInMemoryRunProjectionStore()
	ctx := context.Background()
	now := time.Date(2026, 6, 4, 8, 10, 0, 0, time.UTC)
	createRunProjectionForTest(t, store, "run-events", "conv-events", now)

	if _, err := store.AppendRunEvent(ctx, execution.DurableRunEvent{
		EventID:              "evt-missing-run",
		RequestID:            "missing-run",
		ConversationID:       "conv-events",
		EventType:            execution.DurableRunEventTypeRunCreated,
		Sequence:             1,
		OccurredAt:           now,
		Visibility:           execution.DurableRunEventVisibilityInternal,
		PayloadSchemaVersion: "run-event-v1",
		Payload:              map[string]any{"status": "created"},
	}); !errors.Is(err, execution.ErrDurableRunNotFound) {
		t.Fatalf("missing run event append error = %v, want execution.ErrDurableRunNotFound", err)
	}

	first, err := store.AppendRunEvent(ctx, execution.DurableRunEvent{
		EventID:              "evt-001",
		RequestID:            "run-events",
		ConversationID:       "conv-events",
		EventType:            execution.DurableRunEventTypeRunCreated,
		OccurredAt:           now,
		Visibility:           execution.DurableRunEventVisibilityInternal,
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

	if _, err := store.AppendRunEvent(ctx, execution.DurableRunEvent{
		EventID:              "evt-duplicate-sequence",
		RequestID:            "run-events",
		ConversationID:       "conv-events",
		EventType:            execution.DurableRunEventTypeRunQueued,
		Sequence:             1,
		OccurredAt:           now.Add(time.Second),
		Visibility:           execution.DurableRunEventVisibilityInternal,
		PayloadSchemaVersion: "run-event-v1",
		Payload:              map[string]any{"status": "queued"},
	}); !errors.Is(err, execution.ErrInvalidRunEvent) {
		t.Fatalf("duplicate sequence error = %v, want execution.ErrInvalidRunEvent", err)
	}
	if _, err := store.AppendRunEvent(ctx, execution.DurableRunEvent{
		EventID:              "evt-gap-sequence",
		RequestID:            "run-events",
		ConversationID:       "conv-events",
		EventType:            execution.DurableRunEventTypeRunQueued,
		Sequence:             3,
		OccurredAt:           now.Add(2 * time.Second),
		Visibility:           execution.DurableRunEventVisibilityInternal,
		PayloadSchemaVersion: "run-event-v1",
		Payload:              map[string]any{"status": "queued"},
	}); !errors.Is(err, execution.ErrInvalidRunEvent) {
		t.Fatalf("sequence gap error = %v, want execution.ErrInvalidRunEvent", err)
	}

	if _, err := store.AppendRunEvent(ctx, execution.DurableRunEvent{
		EventID:              "evt-002",
		RequestID:            "run-events",
		ConversationID:       "conv-events",
		EventType:            execution.DurableRunEventTypeRunQueued,
		OccurredAt:           now.Add(3 * time.Second),
		Visibility:           execution.DurableRunEventVisibilityInternal,
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

	_, err := store.AppendRunEvent(ctx, execution.DurableRunEvent{
		EventID:              "evt-finalization-browser-leak",
		RequestID:            "run-finalization-event",
		ConversationID:       "conv-finalization-event",
		EventType:            execution.DurableRunEventTypeFinalizationCompleted,
		OccurredAt:           now,
		Visibility:           execution.DurableRunEventVisibilityBrowser,
		PayloadSchemaVersion: "run-event-v1",
		Payload: map[string]any{
			"request_id": "req-finalization-event",
			"response":   map[string]any{"answer_text": "must stay internal"},
		},
	})
	if !errors.Is(err, execution.ErrInvalidRunEvent) {
		t.Fatalf("browser finalization response error = %v, want execution.ErrInvalidRunEvent", err)
	}

	if _, err := store.AppendRunEvent(ctx, execution.DurableRunEvent{
		EventID:              "evt-finalization-browser-safe",
		RequestID:            "run-finalization-event",
		ConversationID:       "conv-finalization-event",
		EventType:            execution.DurableRunEventTypeFinalizationCompleted,
		OccurredAt:           now.Add(time.Second),
		Visibility:           execution.DurableRunEventVisibilityBrowser,
		PayloadSchemaVersion: "run-event-v1",
		Payload: map[string]any{
			"request_id": "req-finalization-event",
		},
	}); err != nil {
		t.Fatalf("append safe browser finalization event: %v", err)
	}
	if _, err := store.AppendRunEvent(ctx, execution.DurableRunEvent{
		EventID:              "evt-finalization-internal",
		RequestID:            "run-finalization-event",
		ConversationID:       "conv-finalization-event",
		EventType:            execution.DurableRunEventTypeFinalizationCompleted,
		OccurredAt:           now.Add(2 * time.Second),
		Visibility:           execution.DurableRunEventVisibilityInternal,
		PayloadSchemaVersion: "run-event-v1",
		Payload: map[string]any{
			"request_id": "req-finalization-event",
			"response":   map[string]any{"answer_text": "internal closeout"},
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
	if _, err := store.TransitionRun(ctx, "run-cancel", execution.DurableRunStatusQueued, "", now.Add(time.Second)); err != nil {
		t.Fatalf("queue run projection: %v", err)
	}
	if _, err := store.RequestRunCancellation(ctx, execution.DurableRunCancellationRequest{
		RequestID: "run-cancel", Reason: "user_requested", Now: now.Add(2 * time.Second),
	}); err != nil {
		t.Fatalf("request run cancellation: %v", err)
	}

	canceled, err := store.CancelRunProjection(ctx, execution.DurableRunCancelRequest{
		RequestID: "run-cancel",
		Reason:    "user_requested",
		Now:       now.Add(3 * time.Second),
	})
	if err != nil {
		t.Fatalf("cancel run projection: %v", err)
	}
	if canceled.Status != execution.DurableRunStatusCanceled {
		t.Fatalf("canceled status = %q, want canceled", canceled.Status)
	}

	events, err := store.ListRunEvents(ctx, "run-cancel")
	if err != nil {
		t.Fatalf("list run cancel events: %v", err)
	}
	if len(events) != 2 {
		t.Fatalf("cancel event count = %d, want 2", len(events))
	}
	if events[0].EventType != execution.DurableRunEventTypeRunCancelRequested ||
		events[0].Visibility != execution.DurableRunEventVisibilityInternal {
		t.Fatalf("cancel request event = %#v", events[0])
	}
	canceledEvent := events[1]
	if canceledEvent.EventType != execution.DurableRunEventTypeRunCanceled ||
		canceledEvent.Visibility != execution.DurableRunEventVisibilityBrowser {
		t.Fatalf("cancel event = %#v, want browser run.canceled", canceledEvent)
	}
	for key := range canceledEvent.Payload {
		switch key {
		case "request_id", "status", "terminal_reason":
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

	step, err := store.UpsertRunStep(ctx, execution.RunStepProjection{
		StepID:               "agent.primary",
		RequestID:            "run-steps",
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

	attempt, err := store.UpsertStepAttempt(ctx, execution.StepAttemptProjection{
		AttemptID:             "attempt-agent-1",
		StepID:                "agent.primary",
		RequestID:             "run-steps",
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
		CancelOutcome:         execution.CancelOutcomeNotRequested,
		TimeoutOutcome:        execution.TimeoutOutcomeNotTimedOut,
		LateCompletionOutcome: execution.LateCompletionOutcomeIgnoredAfterCancel,
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

	result, err := store.UpsertStepResult(ctx, execution.StepResultProjection{
		ResultID:             "result-agent-1",
		StepID:               "agent.primary",
		RequestID:            "run-steps",
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
		attempts[0].CancelOutcome != execution.CancelOutcomeNotRequested ||
		attempts[0].TimeoutOutcome != execution.TimeoutOutcomeNotTimedOut ||
		attempts[0].LateCompletionOutcome != execution.LateCompletionOutcomeIgnoredAfterCancel ||
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
	requestID string,
	conversationID string,
	now time.Time,
) {
	t.Helper()
	if _, err := store.CreateRun(context.Background(), execution.DurableRun{
		RequestID:      requestID,
		ConversationID: conversationID,
		OwnerUserID:    "user-001",
		Surface:        "campus-web",
		TaskQueue:      "campus-agent.workflow",
		CreatedAt:      now,
		Metadata:       executionMetadataForTest(requestID, ""),
	}); err != nil {
		t.Fatalf("create run projection %s: %v", requestID, err)
	}
}

func failedRunTerminalEventForTest(
	requestID string,
	conversationID string,
	now time.Time,
	payload map[string]any,
) execution.DurableRunEvent {
	return execution.DurableRunEvent{
		EventID:              requestID + ":run-failed",
		RequestID:            requestID,
		ConversationID:       conversationID,
		EventType:            execution.DurableRunEventTypeRunFailed,
		OccurredAt:           now,
		Visibility:           execution.DurableRunEventVisibilityBrowser,
		PayloadSchemaVersion: "run-event-v1",
		Payload:              payload,
	}
}
