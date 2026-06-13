package httpapi

import (
	"context"
	"testing"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/execution"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/temporalruntime"
)

func TestMemoryRecallActivityUsesAnyCapabilityForNeutralPrimaryAgentRun(t *testing.T) {
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
	if executor.seenRequest.RequestedCapability != "any" {
		t.Fatalf(
			"recall requested capability = %q, want any for neutral primary-agent run",
			executor.seenRequest.RequestedCapability,
		)
	}

	steps, err := store.ListRunSteps(context.Background(), "run-memory-neutral")
	if err != nil {
		t.Fatalf("list run steps: %v", err)
	}
	if len(steps) != 1 {
		t.Fatalf("step count = %d, want 1: %#v", len(steps), steps)
	}
	if steps[0].Capability != "any" {
		t.Fatalf("memory step capability = %q, want any", steps[0].Capability)
	}
}
