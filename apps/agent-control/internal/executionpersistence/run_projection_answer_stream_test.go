package executionpersistence

import (
	"context"
	"errors"
	"github.com/MUC-WIKI/campus-agent/apps/agent-control/internal/execution"
	"runtime"
	"testing"
	"time"
)

func TestInMemoryRunProjectionStoreStartsAnswerStreamAtomically(t *testing.T) {
	store := NewInMemoryRunProjectionStore()
	now := time.Date(2026, 7, 25, 8, 0, 0, 0, time.UTC)
	run := createRunningRunForAnswerStreamTest(t, store, "run-answer-stream", now)
	request := answerStreamStartRequestForTest(run, now.Add(4*time.Second))

	streaming, err := store.StartRunAnswerStream(t.Context(), request)
	if err != nil {
		t.Fatalf("start answer stream: %v", err)
	}
	if streaming.Status != execution.DurableRunStatusStreaming ||
		!streaming.StreamingStartedAt.Equal(request.Now) {
		t.Fatalf("streaming run = %#v", streaming)
	}
	events, err := store.ListRunEvents(t.Context(), run.RequestID)
	if err != nil {
		t.Fatalf("list answer stream events: %v", err)
	}
	if len(events) != 2 || events[0].Sequence != 1 || events[1].Sequence != 2 ||
		events[0].EventType != execution.DurableRunEventTypeRunAnswerStarted ||
		events[1].EventType != execution.DurableRunEventTypeRunAnswerDelta {
		t.Fatalf("answer stream events = %#v", events)
	}
}

func TestInMemoryRunProjectionStoreRejectsInvalidFirstDeltaWithoutMutation(t *testing.T) {
	store := NewInMemoryRunProjectionStore()
	now := time.Date(2026, 7, 25, 8, 10, 0, 0, time.UTC)
	run := createRunningRunForAnswerStreamTest(t, store, "run-invalid-first-delta", now)
	request := answerStreamStartRequestForTest(run, now.Add(4*time.Second))
	request.FirstDeltaEvent.PayloadSchemaVersion = ""

	if _, err := store.StartRunAnswerStream(t.Context(), request); !errors.Is(err, execution.ErrInvalidRunEvent) {
		t.Fatalf("start answer stream error = %v, want execution.ErrInvalidRunEvent", err)
	}
	loaded, err := store.GetRun(t.Context(), run.RequestID)
	if err != nil {
		t.Fatalf("get unchanged run: %v", err)
	}
	if loaded.Status != execution.DurableRunStatusRunning || !loaded.StreamingStartedAt.IsZero() {
		t.Fatalf("run changed after rejected first delta: %#v", loaded)
	}
	events, err := store.ListRunEvents(t.Context(), run.RequestID)
	if err != nil {
		t.Fatalf("list unchanged events: %v", err)
	}
	if len(events) != 0 {
		t.Fatalf("events changed after rejected first delta: %#v", events)
	}
}

func TestInMemoryRunProjectionStoreWaitForRunEventsWakesAndHonorsDeadline(t *testing.T) {
	store := NewInMemoryRunProjectionStore()
	now := time.Date(2026, 7, 25, 8, 20, 0, 0, time.UTC)
	createRunProjectionForTest(t, store, "run-event-wait", "conv-event-wait", now)

	type waitResult struct {
		events []execution.DurableRunEvent
		err    error
	}
	resultCh := make(chan waitResult, 1)
	go func() {
		events, err := store.WaitForRunEventsAfter(context.Background(), "run-event-wait", 0)
		resultCh <- waitResult{events: events, err: err}
	}()
	waitForInMemoryRunEventWaiter(t, store, "run-event-wait")

	appended, err := store.AppendRunEvent(t.Context(), execution.DurableRunEvent{
		EventID:              "run-event-wait:created",
		RequestID:            "run-event-wait",
		ConversationID:       "conv-event-wait",
		EventType:            execution.DurableRunEventTypeRunCreated,
		OccurredAt:           now,
		Visibility:           execution.DurableRunEventVisibilityInternal,
		PayloadSchemaVersion: "run-event-v1",
		Payload:              map[string]any{"status": "created"},
	})
	if err != nil {
		t.Fatalf("append event: %v", err)
	}
	select {
	case result := <-resultCh:
		if result.err != nil || len(result.events) != 1 || result.events[0].EventID != appended.EventID {
			t.Fatalf("wait result = %#v, err=%v", result.events, result.err)
		}
	case <-time.After(time.Second):
		t.Fatal("waiter was not woken by the appended event")
	}

	deadlineCtx, cancel := context.WithTimeout(t.Context(), 20*time.Millisecond)
	defer cancel()
	_, err = store.WaitForRunEventsAfter(deadlineCtx, "run-event-wait", appended.Sequence)
	if !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("deadline wait error = %v, want context deadline exceeded", err)
	}
	store.mu.RLock()
	remainingWaiters := len(store.runEventWaiters["run-event-wait"])
	store.mu.RUnlock()
	if remainingWaiters != 0 {
		t.Fatalf("deadline left %d registered waiters", remainingWaiters)
	}
}

func createRunningRunForAnswerStreamTest(
	t *testing.T,
	store *InMemoryRunProjectionStore,
	requestID string,
	now time.Time,
) execution.DurableRun {
	t.Helper()
	createRunProjectionForTest(t, store, requestID, "conv-"+requestID, now)
	for index, status := range []execution.DurableRunStatus{
		execution.DurableRunStatusQueued,
		execution.DurableRunStatusAdmitted,
		execution.DurableRunStatusRunning,
	} {
		updated, err := store.TransitionRun(
			t.Context(),
			requestID,
			status,
			"",
			now.Add(time.Duration(index+1)*time.Second),
		)
		if err != nil {
			t.Fatalf("transition run to %s: %v", status, err)
		}
		if status == execution.DurableRunStatusRunning {
			return updated
		}
	}
	t.Fatal("running transition was not reached")
	return execution.DurableRun{}
}

func answerStreamStartRequestForTest(run execution.DurableRun, now time.Time) execution.RunAnswerStreamStartRequest {
	return execution.RunAnswerStreamStartRequest{
		RequestID: run.RequestID,
		Now:       now,
		AnswerStartedEvent: execution.DurableRunEvent{
			EventID:              run.RequestID + ":answer-started",
			RequestID:            run.RequestID,
			ConversationID:       run.ConversationID,
			EventType:            execution.DurableRunEventTypeRunAnswerStarted,
			OccurredAt:           now,
			Visibility:           execution.DurableRunEventVisibilityBrowser,
			PayloadSchemaVersion: "run-answer-event-v2",
			Payload:              map[string]any{"status": "streaming"},
		},
		FirstDeltaEvent: execution.DurableRunEvent{
			EventID:              run.RequestID + ":answer-delta:1",
			RequestID:            run.RequestID,
			ConversationID:       run.ConversationID,
			EventType:            execution.DurableRunEventTypeRunAnswerDelta,
			OccurredAt:           now,
			Visibility:           execution.DurableRunEventVisibilityBrowser,
			PayloadSchemaVersion: "run-answer-event-v2",
			Payload:              map[string]any{"chunk_index": 1, "delta": "first"},
		},
	}
}

func waitForInMemoryRunEventWaiter(
	t *testing.T,
	store *InMemoryRunProjectionStore,
	requestID string,
) {
	t.Helper()
	deadline := time.Now().Add(time.Second)
	for {
		store.mu.RLock()
		registered := len(store.runEventWaiters[requestID]) > 0
		store.mu.RUnlock()
		if registered {
			return
		}
		if time.Now().After(deadline) {
			t.Fatal("run event waiter was not registered")
		}
		runtime.Gosched()
	}
}
