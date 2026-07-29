package execution

import (
	"context"
	"errors"
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
	if streaming.Status != DurableRunStatusStreaming ||
		!streaming.StreamingStartedAt.Equal(request.Now) {
		t.Fatalf("streaming run = %#v", streaming)
	}
	events, err := store.ListRunEvents(t.Context(), run.RunID)
	if err != nil {
		t.Fatalf("list answer stream events: %v", err)
	}
	if len(events) != 2 || events[0].Sequence != 1 || events[1].Sequence != 2 ||
		events[0].EventType != DurableRunEventTypeRunAnswerStarted ||
		events[1].EventType != DurableRunEventTypeRunAnswerDelta {
		t.Fatalf("answer stream events = %#v", events)
	}
}

func TestInMemoryRunProjectionStoreRejectsInvalidFirstDeltaWithoutMutation(t *testing.T) {
	store := NewInMemoryRunProjectionStore()
	now := time.Date(2026, 7, 25, 8, 10, 0, 0, time.UTC)
	run := createRunningRunForAnswerStreamTest(t, store, "run-invalid-first-delta", now)
	request := answerStreamStartRequestForTest(run, now.Add(4*time.Second))
	request.FirstDeltaEvent.PayloadSchemaVersion = ""

	if _, err := store.StartRunAnswerStream(t.Context(), request); !errors.Is(err, ErrInvalidRunEvent) {
		t.Fatalf("start answer stream error = %v, want ErrInvalidRunEvent", err)
	}
	loaded, err := store.GetRun(t.Context(), run.RunID)
	if err != nil {
		t.Fatalf("get unchanged run: %v", err)
	}
	if loaded.Status != DurableRunStatusRunning || !loaded.StreamingStartedAt.IsZero() {
		t.Fatalf("run changed after rejected first delta: %#v", loaded)
	}
	events, err := store.ListRunEvents(t.Context(), run.RunID)
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
		events []DurableRunEvent
		err    error
	}
	resultCh := make(chan waitResult, 1)
	go func() {
		events, err := store.WaitForRunEventsAfter(context.Background(), "run-event-wait", 0)
		resultCh <- waitResult{events: events, err: err}
	}()
	waitForInMemoryRunEventWaiter(t, store, "run-event-wait")

	appended, err := store.AppendRunEvent(t.Context(), DurableRunEvent{
		EventID:              "run-event-wait:created",
		RunID:                "run-event-wait",
		ConversationID:       "conv-event-wait",
		EventType:            DurableRunEventTypeRunCreated,
		OccurredAt:           now,
		Visibility:           DurableRunEventVisibilityInternal,
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
	runID string,
	now time.Time,
) DurableRun {
	t.Helper()
	createRunProjectionForTest(t, store, runID, "conv-"+runID, now)
	for index, status := range []DurableRunStatus{
		DurableRunStatusQueued,
		DurableRunStatusAdmitted,
		DurableRunStatusRunning,
	} {
		updated, err := store.TransitionRun(
			t.Context(),
			runID,
			status,
			"",
			now.Add(time.Duration(index+1)*time.Second),
		)
		if err != nil {
			t.Fatalf("transition run to %s: %v", status, err)
		}
		if status == DurableRunStatusRunning {
			return updated
		}
	}
	t.Fatal("running transition was not reached")
	return DurableRun{}
}

func answerStreamStartRequestForTest(run DurableRun, now time.Time) RunAnswerStreamStartRequest {
	return RunAnswerStreamStartRequest{
		RunID: run.RunID,
		Now:   now,
		AnswerStartedEvent: DurableRunEvent{
			EventID:              run.RunID + ":answer-started",
			RunID:                run.RunID,
			ConversationID:       run.ConversationID,
			EventType:            DurableRunEventTypeRunAnswerStarted,
			OccurredAt:           now,
			Visibility:           DurableRunEventVisibilityBrowser,
			PayloadSchemaVersion: "run-answer-event-v2",
			Payload:              map[string]any{"status": "streaming"},
		},
		FirstDeltaEvent: DurableRunEvent{
			EventID:              run.RunID + ":answer-delta:1",
			RunID:                run.RunID,
			ConversationID:       run.ConversationID,
			EventType:            DurableRunEventTypeRunAnswerDelta,
			OccurredAt:           now,
			Visibility:           DurableRunEventVisibilityBrowser,
			PayloadSchemaVersion: "run-answer-event-v2",
			Payload:              map[string]any{"chunk_index": 1, "delta": "first"},
		},
	}
}

func waitForInMemoryRunEventWaiter(
	t *testing.T,
	store *InMemoryRunProjectionStore,
	runID string,
) {
	t.Helper()
	deadline := time.Now().Add(time.Second)
	for {
		store.mu.RLock()
		registered := len(store.runEventWaiters[runID]) > 0
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
