package lifecycle

import (
	"context"
	"errors"
	"testing"
	"time"
)

func TestRegistryRejectsDuplicateActiveRequestID(t *testing.T) {
	registry := NewRegistry()
	_, _, err := registry.Register(context.Background(), Metadata{RequestID: "req-001"})
	if err != nil {
		t.Fatalf("first register returned error: %v", err)
	}

	_, _, err = registry.Register(context.Background(), Metadata{RequestID: "req-001"})
	if !errors.Is(err, ErrDuplicateExecution) {
		t.Fatalf("duplicate error = %v, want ErrDuplicateExecution", err)
	}
}

func TestRegistryCancelMarksExecutionAndCancelsContext(t *testing.T) {
	registry := NewRegistry()
	_, ctx, err := registry.Register(context.Background(), Metadata{
		RequestID:     "req-cancel",
		TraceID:       "trace-cancel",
		RequestedTool: "knowledge_query",
	})
	if err != nil {
		t.Fatalf("register returned error: %v", err)
	}

	result, err := registry.Cancel("req-cancel", "user_requested")
	if err != nil {
		t.Fatalf("cancel returned error: %v", err)
	}
	if result.Status != string(StateCancelRequested) {
		t.Fatalf("cancel status = %q, want cancel_requested", result.Status)
	}

	select {
	case <-ctx.Done():
		if !errors.Is(context.Cause(ctx), ErrExecutionCanceled) {
			t.Fatalf("context cause = %v, want ErrExecutionCanceled", context.Cause(ctx))
		}
	case <-time.After(time.Second):
		t.Fatal("execution context was not canceled")
	}

	snapshot := registry.Snapshot()
	if snapshot.CancelRequestedCount != 1 {
		t.Fatalf("cancel requested count = %d, want 1", snapshot.CancelRequestedCount)
	}
	if snapshot.States[string(StateCancelRequested)] != 1 {
		t.Fatalf("cancel state count = %#v, want one cancel_requested", snapshot.States)
	}
}

func TestRegistryCompleteRemovesActiveExecution(t *testing.T) {
	registry := NewRegistry()
	_, _, err := registry.Register(context.Background(), Metadata{RequestID: "req-complete"})
	if err != nil {
		t.Fatalf("register returned error: %v", err)
	}

	registry.Complete("req-complete", StateCompleted)
	_, _, err = registry.Register(context.Background(), Metadata{RequestID: "req-timeout"})
	if err != nil {
		t.Fatalf("second register returned error: %v", err)
	}
	registry.Complete("req-timeout", StateTimedOut)

	snapshot := registry.Snapshot()
	if snapshot.ActiveExecutions != 0 {
		t.Fatalf("active executions = %d, want 0", snapshot.ActiveExecutions)
	}
	if snapshot.CompletedRetained != 2 {
		t.Fatalf("completed retained = %d, want 2", snapshot.CompletedRetained)
	}
	if snapshot.CompletedByState[string(StateCompleted)] != 1 {
		t.Fatalf("completed final state counts = %#v, want one completed", snapshot.CompletedByState)
	}
	if snapshot.CompletedByState[string(StateTimedOut)] != 1 {
		t.Fatalf("completed final state counts = %#v, want one timed_out", snapshot.CompletedByState)
	}
}
