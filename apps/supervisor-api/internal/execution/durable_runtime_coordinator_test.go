package execution

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"
)

func TestInMemoryDurableRuntimeStoreAcquiresNextQueuedRunAsLease(t *testing.T) {
	store := NewInMemoryDurableRuntimeStore()
	ctx := context.Background()
	now := time.Date(2026, 6, 4, 10, 0, 0, 0, time.UTC)
	prepareDurableLeaseDependenciesForTest(t, store, DurableLaneRAG, "worker-next", now)
	createQueuedDurableRunForTest(t, store, "run-next-001", "conv-next-001", now.Add(time.Second))
	createQueuedDurableRunForTest(t, store, "run-next-002", "conv-next-002", now.Add(2*time.Second))

	lease, err := store.AcquireNextExecutionLease(ctx, NextExecutionLeaseRequest{
		LeaseID:   "lease-next-001",
		StepID:    "primary",
		Lane:      DurableLaneRAG,
		WorkerID:  "worker-next",
		Now:       now.Add(3 * time.Second),
		ExpiresAt: now.Add(33 * time.Second),
	})
	if err != nil {
		t.Fatalf("acquire next execution lease: %v", err)
	}
	if lease.RunID != "run-next-001" {
		t.Fatalf("leased run_id = %q, want oldest queued run-next-001", lease.RunID)
	}
	run, err := store.GetRun(ctx, "run-next-001")
	if err != nil {
		t.Fatalf("get leased run: %v", err)
	}
	if run.Status != DurableRunStatusRunning {
		t.Fatalf("leased run status = %q, want running", run.Status)
	}
	events, err := store.ListRunEvents(ctx, "run-next-001")
	if err != nil {
		t.Fatalf("list leased run events: %v", err)
	}
	assertDurableEventTypes(
		t,
		events,
		[]DurableRunEventType{
			DurableRunEventTypeRunAdmitted,
			DurableRunEventTypeLeaseAcquired,
			DurableRunEventTypeRunStarted,
		},
	)

	secondLease, err := store.AcquireNextExecutionLease(ctx, NextExecutionLeaseRequest{
		LeaseID:   "lease-next-002",
		StepID:    "primary",
		Lane:      DurableLaneRAG,
		WorkerID:  "worker-next",
		Now:       now.Add(4 * time.Second),
		ExpiresAt: now.Add(34 * time.Second),
	})
	if err != nil {
		t.Fatalf("acquire second next execution lease: %v", err)
	}
	if secondLease.RunID != "run-next-002" {
		t.Fatalf("second leased run_id = %q, want run-next-002", secondLease.RunID)
	}
}

func TestInMemoryDurableRuntimeStoreAcquireNextFailsClosedWithoutQueuedRun(t *testing.T) {
	store := NewInMemoryDurableRuntimeStore()
	ctx := context.Background()
	now := time.Date(2026, 6, 4, 10, 5, 0, 0, time.UTC)
	prepareDurableLeaseDependenciesForTest(t, store, DurableLaneRAG, "worker-empty", now)

	_, err := store.AcquireNextExecutionLease(ctx, NextExecutionLeaseRequest{
		LeaseID:   "lease-empty",
		StepID:    "primary",
		Lane:      DurableLaneRAG,
		WorkerID:  "worker-empty",
		Now:       now.Add(time.Second),
		ExpiresAt: now.Add(31 * time.Second),
	})
	if !errors.Is(err, ErrNoQueuedDurableRun) {
		t.Fatalf("empty queue acquire error = %v, want ErrNoQueuedDurableRun", err)
	}
}

func TestInMemoryDurableRuntimeStoreAcquireNextHonorsLaneBudget(t *testing.T) {
	store := NewInMemoryDurableRuntimeStore()
	ctx := context.Background()
	now := time.Date(2026, 6, 4, 10, 10, 0, 0, time.UTC)
	if err := store.UpsertLaneBudget(ctx, LaneBudget{
		Lane:                   DurableLaneRAG,
		MaxActiveLeases:        1,
		MaxQueuedRuns:          8,
		QueueTimeout:           30 * time.Second,
		RunTimeout:             2 * time.Minute,
		LeaseTimeout:           30 * time.Second,
		WorkerHeartbeatTimeout: 15 * time.Second,
		Enabled:                true,
		UpdatedAt:              now,
	}); err != nil {
		t.Fatalf("upsert lane budget: %v", err)
	}
	if err := store.UpsertWorkerHeartbeat(ctx, WorkerHeartbeat{
		WorkerID:       "worker-budget-next",
		WorkerKind:     "supervisor-agent-worker",
		Lanes:          []DurableLane{DurableLaneRAG},
		RuntimeVersion: "test",
		Status:         WorkerHeartbeatStatusReady,
		HeartbeatAt:    now,
		StartedAt:      now.Add(-time.Second),
	}); err != nil {
		t.Fatalf("upsert worker heartbeat: %v", err)
	}
	createQueuedDurableRunForTest(t, store, "run-budget-next-001", "conv-budget-next-001", now.Add(time.Second))
	createQueuedDurableRunForTest(t, store, "run-budget-next-002", "conv-budget-next-002", now.Add(2*time.Second))
	if _, err := store.AcquireNextExecutionLease(ctx, NextExecutionLeaseRequest{
		LeaseID:   "lease-budget-next-001",
		StepID:    "primary",
		Lane:      DurableLaneRAG,
		WorkerID:  "worker-budget-next",
		Now:       now.Add(3 * time.Second),
		ExpiresAt: now.Add(33 * time.Second),
	}); err != nil {
		t.Fatalf("acquire first next lease: %v", err)
	}
	if _, err := store.AcquireNextExecutionLease(ctx, NextExecutionLeaseRequest{
		LeaseID:   "lease-budget-next-002",
		StepID:    "primary",
		Lane:      DurableLaneRAG,
		WorkerID:  "worker-budget-next",
		Now:       now.Add(4 * time.Second),
		ExpiresAt: now.Add(34 * time.Second),
	}); !errors.Is(err, ErrLaneBudgetExceeded) {
		t.Fatalf("second next lease error = %v, want ErrLaneBudgetExceeded", err)
	}
}

func TestInMemoryDurableRuntimeStoreAcquireNextConcurrentWorkersDoNotDoubleLeaseRun(t *testing.T) {
	store := NewInMemoryDurableRuntimeStore()
	ctx := context.Background()
	now := time.Date(2026, 6, 4, 10, 12, 0, 0, time.UTC)
	if err := store.UpsertLaneBudget(ctx, LaneBudget{
		Lane:                   DurableLaneRAG,
		MaxActiveLeases:        2,
		MaxQueuedRuns:          8,
		QueueTimeout:           30 * time.Second,
		RunTimeout:             2 * time.Minute,
		LeaseTimeout:           30 * time.Second,
		WorkerHeartbeatTimeout: 15 * time.Second,
		Enabled:                true,
		UpdatedAt:              now,
	}); err != nil {
		t.Fatalf("upsert lane budget: %v", err)
	}
	for _, workerID := range []string{"worker-concurrent-1", "worker-concurrent-2"} {
		if err := store.UpsertWorkerHeartbeat(ctx, WorkerHeartbeat{
			WorkerID:       workerID,
			WorkerKind:     "supervisor-agent-worker",
			Lanes:          []DurableLane{DurableLaneRAG},
			RuntimeVersion: "test",
			Status:         WorkerHeartbeatStatusReady,
			HeartbeatAt:    now,
			StartedAt:      now.Add(-time.Second),
		}); err != nil {
			t.Fatalf("upsert worker heartbeat %s: %v", workerID, err)
		}
	}
	createQueuedDurableRunForTest(t, store, "run-concurrent-single", "conv-concurrent-single", now.Add(time.Second))

	type acquireResult struct {
		Lease ExecutionLease
		Err   error
	}
	start := make(chan struct{})
	results := make(chan acquireResult, 2)
	var wg sync.WaitGroup
	for index, workerID := range []string{"worker-concurrent-1", "worker-concurrent-2"} {
		wg.Add(1)
		go func(index int, workerID string) {
			defer wg.Done()
			<-start
			lease, err := store.AcquireNextExecutionLease(ctx, NextExecutionLeaseRequest{
				LeaseID:   "lease-concurrent-" + workerID,
				StepID:    "primary",
				Lane:      DurableLaneRAG,
				WorkerID:  workerID,
				Now:       now.Add(time.Duration(index+2) * time.Second),
				ExpiresAt: now.Add(time.Duration(index+32) * time.Second),
			})
			results <- acquireResult{Lease: lease, Err: err}
		}(index, workerID)
	}
	close(start)
	wg.Wait()
	close(results)

	successes := []ExecutionLease{}
	noQueued := 0
	for result := range results {
		if result.Err == nil {
			successes = append(successes, result.Lease)
			continue
		}
		if errors.Is(result.Err, ErrNoQueuedDurableRun) {
			noQueued++
			continue
		}
		t.Fatalf("unexpected concurrent acquire error: %v", result.Err)
	}
	if len(successes) != 1 || noQueued != 1 {
		t.Fatalf("concurrent acquire successes=%#v noQueued=%d, want exactly one lease and one empty queue", successes, noQueued)
	}
	if successes[0].RunID != "run-concurrent-single" {
		t.Fatalf("leased run_id = %q, want run-concurrent-single", successes[0].RunID)
	}
	events, err := store.ListRunEvents(ctx, "run-concurrent-single")
	if err != nil {
		t.Fatalf("list concurrent run events: %v", err)
	}
	assertDurableEventTypes(t, events, []DurableRunEventType{
		DurableRunEventTypeRunAdmitted,
		DurableRunEventTypeLeaseAcquired,
		DurableRunEventTypeRunStarted,
	})
}

func createQueuedDurableRunForTest(
	t *testing.T,
	store *InMemoryDurableRuntimeStore,
	runID string,
	conversationID string,
	now time.Time,
) {
	t.Helper()
	ctx := context.Background()
	createDurableRunForTest(t, store, runID, conversationID, now)
	if _, err := store.TransitionRun(ctx, runID, DurableRunStatusQueued, "", now.Add(time.Millisecond)); err != nil {
		t.Fatalf("queue durable run %s: %v", runID, err)
	}
}

func assertDurableEventTypes(
	t *testing.T,
	events []DurableRunEvent,
	expected []DurableRunEventType,
) {
	t.Helper()
	if len(events) != len(expected) {
		t.Fatalf("event count = %d, want %d: %#v", len(events), len(expected), events)
	}
	for index, expectedType := range expected {
		if events[index].EventType != expectedType {
			t.Fatalf("event[%d] type = %q, want %q", index, events[index].EventType, expectedType)
		}
		if events[index].Sequence != int64(index+1) {
			t.Fatalf("event[%d] sequence = %d, want %d", index, events[index].Sequence, index+1)
		}
	}
}
