package execution

import (
	"context"
	"testing"
	"time"
)

func TestInMemoryDurableRuntimeStoreRequeuesExpiredLeaseUntilRetryLimit(t *testing.T) {
	store := NewInMemoryDurableRuntimeStore()
	ctx := context.Background()
	now := time.Date(2026, 6, 4, 18, 0, 0, 0, time.UTC)
	prepareDurableLeaseDependenciesForTest(t, store, DurableLaneRAG, "worker-retry", now)
	createQueuedDurableRunForTest(t, store, "run-retry", "conv-retry", now.Add(time.Second))

	firstLease, err := store.AcquireNextExecutionLease(ctx, NextExecutionLeaseRequest{
		LeaseID:   "lease-retry-001",
		StepID:    "handoff:rag-agent:rag_request",
		Lane:      DurableLaneRAG,
		WorkerID:  "worker-retry",
		Now:       now.Add(2 * time.Second),
		ExpiresAt: now.Add(4 * time.Second),
	})
	if err != nil {
		t.Fatalf("acquire first lease: %v", err)
	}
	if firstLease.Attempt != 1 {
		t.Fatalf("first lease attempt = %d, want 1", firstLease.Attempt)
	}

	recovered, err := store.RecoverExpiredExecutionLeases(ctx, ExpiredLeaseRecoveryRequest{
		Now:              now.Add(5 * time.Second),
		ReleaseReason:    string(DurableTerminalReasonLeaseExpired),
		TerminalReason:   DurableTerminalReasonLeaseExpired,
		MaxRetryAttempts: 2,
	})
	if err != nil {
		t.Fatalf("recover first expired lease: %v", err)
	}
	if got := len(recovered); got != 1 {
		t.Fatalf("recovered count = %d, want 1", got)
	}
	if recovered[0].Run.Status != DurableRunStatusQueued {
		t.Fatalf("first recovery run status = %q, want queued", recovered[0].Run.Status)
	}
	if recovered[0].Run.TerminalReason != "" {
		t.Fatalf("first recovery terminal reason = %q, want empty", recovered[0].Run.TerminalReason)
	}

	secondLease, err := store.AcquireNextExecutionLease(ctx, NextExecutionLeaseRequest{
		LeaseID:   "lease-retry-002",
		StepID:    "handoff:rag-agent:rag_request",
		Lane:      DurableLaneRAG,
		WorkerID:  "worker-retry",
		Now:       now.Add(6 * time.Second),
		ExpiresAt: now.Add(8 * time.Second),
	})
	if err != nil {
		t.Fatalf("acquire second lease after retry queue: %v", err)
	}
	if secondLease.RunID != "run-retry" {
		t.Fatalf("second lease run_id = %q, want run-retry", secondLease.RunID)
	}
	if secondLease.Attempt != 2 {
		t.Fatalf("second lease attempt = %d, want 2", secondLease.Attempt)
	}

	recovered, err = store.RecoverExpiredExecutionLeases(ctx, ExpiredLeaseRecoveryRequest{
		Now:              now.Add(9 * time.Second),
		ReleaseReason:    string(DurableTerminalReasonLeaseExpired),
		TerminalReason:   DurableTerminalReasonLeaseExpired,
		MaxRetryAttempts: 2,
	})
	if err != nil {
		t.Fatalf("recover second expired lease: %v", err)
	}
	if got := len(recovered); got != 1 {
		t.Fatalf("second recovered count = %d, want 1", got)
	}
	if recovered[0].Run.Status != DurableRunStatusExpired {
		t.Fatalf("second recovery run status = %q, want expired", recovered[0].Run.Status)
	}
	if recovered[0].Run.TerminalReason != DurableTerminalReasonLeaseExpired {
		t.Fatalf(
			"second recovery terminal reason = %q, want lease_expired",
			recovered[0].Run.TerminalReason,
		)
	}

	events, err := store.ListRunEvents(ctx, "run-retry")
	if err != nil {
		t.Fatalf("list run events: %v", err)
	}
	assertDurableEventTypes(t, events, []DurableRunEventType{
		DurableRunEventTypeRunAdmitted,
		DurableRunEventTypeLeaseAcquired,
		DurableRunEventTypeRunStarted,
		DurableRunEventTypeLeaseExpired,
		DurableRunEventTypeRunQueued,
		DurableRunEventTypeRunAdmitted,
		DurableRunEventTypeLeaseAcquired,
		DurableRunEventTypeRunStarted,
		DurableRunEventTypeLeaseExpired,
		DurableRunEventTypeRunExpired,
	})
}

func TestInMemoryDurableRuntimeStoreRequiresPositiveRetryLimitForExpiredRecovery(t *testing.T) {
	store := NewInMemoryDurableRuntimeStore()

	_, err := store.RecoverExpiredExecutionLeases(context.Background(), ExpiredLeaseRecoveryRequest{
		Now:            time.Date(2026, 6, 4, 18, 5, 0, 0, time.UTC),
		ReleaseReason:  string(DurableTerminalReasonLeaseExpired),
		TerminalReason: DurableTerminalReasonLeaseExpired,
	})
	if err == nil {
		t.Fatal("recover expired leases without max retry attempts returned nil error")
	}
}
