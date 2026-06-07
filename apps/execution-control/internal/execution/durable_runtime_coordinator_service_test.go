//go:build retired_pg_lease

package execution

import (
	"context"
	"errors"
	"testing"
	"time"
)

func TestDurableLeaseCoordinatorAcquiresNextLeaseThroughStore(t *testing.T) {
	store := NewInMemoryDurableRuntimeStore()
	coordinator := NewDurableLeaseCoordinator(store)
	ctx := context.Background()
	now := time.Date(2026, 6, 4, 10, 30, 0, 0, time.UTC)
	prepareDurableLeaseDependenciesForTest(t, store, DurableLaneRAG, "worker-coordinator", now)
	createQueuedDurableRunForTest(t, store, "run-coordinator", "conv-coordinator", now.Add(time.Second))

	lease, err := coordinator.AcquireNextLease(ctx, NextExecutionLeaseRequest{
		LeaseID:   "lease-coordinator",
		StepID:    "primary",
		Lane:      DurableLaneRAG,
		WorkerID:  "worker-coordinator",
		Now:       now.Add(2 * time.Second),
		ExpiresAt: now.Add(32 * time.Second),
	})
	if err != nil {
		t.Fatalf("coordinator acquire next lease: %v", err)
	}
	if lease.RunID != "run-coordinator" {
		t.Fatalf("coordinator lease run_id = %q, want run-coordinator", lease.RunID)
	}
}

func TestDurableLeaseCoordinatorFailsClosedWithoutStore(t *testing.T) {
	coordinator := NewDurableLeaseCoordinator(nil)
	_, err := coordinator.AcquireNextLease(context.Background(), NextExecutionLeaseRequest{
		LeaseID:   "lease-no-store",
		StepID:    "primary",
		Lane:      DurableLaneRAG,
		WorkerID:  "worker",
		Now:       time.Date(2026, 6, 4, 10, 35, 0, 0, time.UTC),
		ExpiresAt: time.Date(2026, 6, 4, 10, 35, 30, 0, time.UTC),
	})
	if !errors.Is(err, ErrDurableRuntimeStoreNotConfigured) {
		t.Fatalf("coordinator without store error = %v, want ErrDurableRuntimeStoreNotConfigured", err)
	}
}

func TestDurableLeaseCoordinatorRecoversExpiredLeasesAsTerminalRuns(t *testing.T) {
	store := NewInMemoryDurableRuntimeStore()
	coordinator := NewDurableLeaseCoordinator(store)
	ctx := context.Background()
	now := time.Date(2026, 6, 4, 11, 0, 0, 0, time.UTC)
	prepareDurableLeaseDependenciesForTest(t, store, DurableLaneRAG, "worker-recovery", now)
	createQueuedDurableRunForTest(t, store, "run-recovery", "conv-recovery", now.Add(time.Second))
	lease, err := coordinator.AcquireNextLease(ctx, NextExecutionLeaseRequest{
		LeaseID:   "lease-recovery",
		StepID:    "primary",
		Lane:      DurableLaneRAG,
		WorkerID:  "worker-recovery",
		Now:       now.Add(2 * time.Second),
		ExpiresAt: now.Add(12 * time.Second),
	})
	if err != nil {
		t.Fatalf("acquire recovery lease: %v", err)
	}

	recovered, err := coordinator.RecoverExpiredLeases(ctx, ExpiredLeaseRecoveryRequest{
		Now:              now.Add(13 * time.Second),
		ReleaseReason:    "lease_expired",
		TerminalReason:   DurableTerminalReasonLeaseExpired,
		MaxRetryAttempts: 1,
	})
	if err != nil {
		t.Fatalf("recover expired leases: %v", err)
	}
	if len(recovered) != 1 {
		t.Fatalf("recovered count = %d, want 1", len(recovered))
	}
	if recovered[0].Lease.LeaseID != lease.LeaseID {
		t.Fatalf("recovered lease_id = %q, want %q", recovered[0].Lease.LeaseID, lease.LeaseID)
	}
	if recovered[0].Run.RunID != lease.RunID {
		t.Fatalf("recovered run_id = %q, want %q", recovered[0].Run.RunID, lease.RunID)
	}
	if recovered[0].Run.Status != DurableRunStatusExpired {
		t.Fatalf("recovered run status = %q, want expired", recovered[0].Run.Status)
	}
	if recovered[0].Run.TerminalReason != DurableTerminalReasonLeaseExpired {
		t.Fatalf(
			"recovered terminal_reason = %q, want lease_expired",
			recovered[0].Run.TerminalReason,
		)
	}
	events, err := store.ListRunEvents(ctx, lease.RunID)
	if err != nil {
		t.Fatalf("list recovery events: %v", err)
	}
	assertDurableEventTypes(t, events, []DurableRunEventType{
		DurableRunEventTypeRunAdmitted,
		DurableRunEventTypeLeaseAcquired,
		DurableRunEventTypeRunStarted,
		DurableRunEventTypeLeaseExpired,
		DurableRunEventTypeRunExpired,
	})
	if events[3].Payload["lease_id"] != lease.LeaseID {
		t.Fatalf("lease.expired payload = %#v, want lease_id", events[3].Payload)
	}
	if events[4].Payload["terminal_reason"] != string(DurableTerminalReasonLeaseExpired) {
		t.Fatalf("run.expired payload = %#v, want terminal_reason", events[4].Payload)
	}
	if _, err := store.CreateRun(ctx, DurableRun{
		RunID:          "run-after-recovery",
		ConversationID: "conv-recovery",
		TurnID:         "turn-after-recovery",
		RequestID:      "request-after-recovery",
		OwnerUserID:    "user-after-recovery",
		Surface:        "public-chat-web",
		Lane:           DurableLaneRAG,
		CreatedAt:      now.Add(14 * time.Second),
	}); err != nil {
		t.Fatalf("create run after recovery should release conversation lock: %v", err)
	}
}

func TestDurableLeaseCoordinatorRejectsRecoveryWithoutExplicitTerminalPolicy(t *testing.T) {
	coordinator := NewDurableLeaseCoordinator(NewInMemoryDurableRuntimeStore())
	_, err := coordinator.RecoverExpiredLeases(context.Background(), ExpiredLeaseRecoveryRequest{
		Now:           time.Date(2026, 6, 4, 11, 5, 0, 0, time.UTC),
		ReleaseReason: "lease_expired",
	})
	if !errors.Is(err, ErrInvalidExpiredLeaseRecovery) {
		t.Fatalf("missing terminal policy error = %v, want ErrInvalidExpiredLeaseRecovery", err)
	}
}

func TestDurableLeaseCoordinatorCancelsActiveRunAndReleasesLease(t *testing.T) {
	store := NewInMemoryDurableRuntimeStore()
	coordinator := NewDurableLeaseCoordinator(store)
	ctx := context.Background()
	now := time.Date(2026, 6, 4, 11, 10, 0, 0, time.UTC)
	prepareDurableLeaseDependenciesForTest(t, store, DurableLaneRAG, "worker-cancel", now)
	createQueuedDurableRunForTest(t, store, "run-cancel-active", "conv-cancel-active", now.Add(time.Second))
	lease, err := coordinator.AcquireNextLease(ctx, NextExecutionLeaseRequest{
		LeaseID:   "lease-cancel-active",
		StepID:    "primary",
		Lane:      DurableLaneRAG,
		WorkerID:  "worker-cancel",
		Now:       now.Add(2 * time.Second),
		ExpiresAt: now.Add(32 * time.Second),
	})
	if err != nil {
		t.Fatalf("acquire cancel lease: %v", err)
	}

	canceled, err := coordinator.CancelRun(ctx, DurableRunCancelRequest{
		RunID:         lease.RunID,
		Reason:        "user_requested",
		Now:           now.Add(3 * time.Second),
		ReleaseReason: string(DurableTerminalReasonUserCanceled),
	})
	if err != nil {
		t.Fatalf("cancel active run: %v", err)
	}
	if canceled.Run.Status != DurableRunStatusCanceled {
		t.Fatalf("canceled run status = %q, want canceled", canceled.Run.Status)
	}
	if canceled.ReleasedLease == nil {
		t.Fatal("active cancel did not release lease")
	}
	if canceled.ReleasedLease.LeaseID != lease.LeaseID {
		t.Fatalf("released lease_id = %q, want %q", canceled.ReleasedLease.LeaseID, lease.LeaseID)
	}
	events, err := store.ListRunEvents(ctx, lease.RunID)
	if err != nil {
		t.Fatalf("list cancel events: %v", err)
	}
	assertDurableEventTypes(t, events, []DurableRunEventType{
		DurableRunEventTypeRunAdmitted,
		DurableRunEventTypeLeaseAcquired,
		DurableRunEventTypeRunStarted,
		DurableRunEventTypeLeaseReleased,
		DurableRunEventTypeRunCanceled,
	})
	if events[3].Payload["release_reason"] != string(DurableTerminalReasonUserCanceled) {
		t.Fatalf("lease release payload = %#v", events[3].Payload)
	}
	if _, err := store.CreateRun(ctx, DurableRun{
		RunID:          "run-after-active-cancel",
		ConversationID: "conv-cancel-active",
		TurnID:         "turn-after-active-cancel",
		RequestID:      "request-after-active-cancel",
		OwnerUserID:    "user-after-active-cancel",
		Surface:        "public-chat-web",
		Lane:           DurableLaneRAG,
		CreatedAt:      now.Add(4 * time.Second),
	}); err != nil {
		t.Fatalf("create run after active cancel should release conversation lock: %v", err)
	}
}
