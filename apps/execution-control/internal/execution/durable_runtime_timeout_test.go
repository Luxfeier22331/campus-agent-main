//go:build retired_pg_lease

package execution

import (
	"context"
	"testing"
	"time"
)

func TestInMemoryDurableRuntimeStoreExpiresQueuedRunsAfterLaneQueueTimeout(t *testing.T) {
	store := NewInMemoryDurableRuntimeStore()
	ctx := context.Background()
	now := time.Date(2026, 6, 4, 19, 0, 0, 0, time.UTC)
	if err := store.UpsertLaneBudget(ctx, LaneBudget{
		Lane:                   DurableLaneRAG,
		MaxActiveLeases:        1,
		MaxQueuedRuns:          4,
		QueueTimeout:           10 * time.Second,
		RunTimeout:             time.Minute,
		LeaseTimeout:           30 * time.Second,
		WorkerHeartbeatTimeout: 45 * time.Second,
		Enabled:                true,
		UpdatedAt:              now,
	}); err != nil {
		t.Fatalf("upsert lane budget: %v", err)
	}
	createQueuedDurableRunForTest(t, store, "run-queue-timeout", "conv-queue-timeout", now)

	recovered, err := store.RecoverTimedOutRuns(ctx, TimedOutRunRecoveryRequest{
		Now: now.Add(11 * time.Second),
	})
	if err != nil {
		t.Fatalf("recover timed out queued runs: %v", err)
	}
	if got := len(recovered); got != 1 {
		t.Fatalf("recovered count = %d, want 1", got)
	}
	if recovered[0].Run.Status != DurableRunStatusExpired {
		t.Fatalf("run status = %q, want expired", recovered[0].Run.Status)
	}
	if recovered[0].Run.TerminalReason != DurableTerminalReasonQueueTimeout {
		t.Fatalf("terminal reason = %q, want queue_timeout", recovered[0].Run.TerminalReason)
	}
	if _, err := store.CreateRun(ctx, DurableRun{
		RunID:          "run-after-queue-timeout",
		ConversationID: "conv-queue-timeout",
		TurnID:         "turn-after-queue-timeout",
		RequestID:      "request-after-queue-timeout",
		OwnerUserID:    "user-after-queue-timeout",
		Surface:        "public-chat-web",
		Lane:           DurableLaneRAG,
		CreatedAt:      now.Add(12 * time.Second),
	}); err != nil {
		t.Fatalf("create run after queue timeout should release conversation lock: %v", err)
	}
	events, err := store.ListRunEvents(ctx, "run-queue-timeout")
	if err != nil {
		t.Fatalf("list events: %v", err)
	}
	assertDurableEventTypes(t, events, []DurableRunEventType{
		DurableRunEventTypeRunExpired,
	})
	if events[0].Payload["terminal_reason"] != string(DurableTerminalReasonQueueTimeout) {
		t.Fatalf("run.expired payload = %#v, want queue_timeout", events[0].Payload)
	}
}

func TestInMemoryDurableRuntimeStoreExpiresRunningRunsAfterLaneRunTimeout(t *testing.T) {
	store := NewInMemoryDurableRuntimeStore()
	ctx := context.Background()
	now := time.Date(2026, 6, 4, 19, 5, 0, 0, time.UTC)
	if err := store.UpsertLaneBudget(ctx, LaneBudget{
		Lane:                   DurableLaneRAG,
		MaxActiveLeases:        1,
		MaxQueuedRuns:          4,
		QueueTimeout:           30 * time.Second,
		RunTimeout:             10 * time.Second,
		LeaseTimeout:           30 * time.Second,
		WorkerHeartbeatTimeout: 45 * time.Second,
		Enabled:                true,
		UpdatedAt:              now,
	}); err != nil {
		t.Fatalf("upsert lane budget: %v", err)
	}
	if err := store.UpsertWorkerHeartbeat(ctx, WorkerHeartbeat{
		WorkerID:       "worker-run-timeout",
		WorkerKind:     "execution-control",
		Lanes:          []DurableLane{DurableLaneRAG},
		RuntimeVersion: "test",
		Status:         WorkerHeartbeatStatusReady,
		HeartbeatAt:    now,
		StartedAt:      now.Add(-time.Second),
	}); err != nil {
		t.Fatalf("upsert worker heartbeat: %v", err)
	}
	createQueuedDurableRunForTest(t, store, "run-timeout", "conv-run-timeout", now)
	lease, err := store.AcquireNextExecutionLease(ctx, NextExecutionLeaseRequest{
		LeaseID:   "lease-run-timeout",
		StepID:    "handoff:rag-agent:rag_request",
		Lane:      DurableLaneRAG,
		WorkerID:  "worker-run-timeout",
		Now:       now.Add(time.Second),
		ExpiresAt: now.Add(time.Minute),
	})
	if err != nil {
		t.Fatalf("acquire lease: %v", err)
	}

	recovered, err := store.RecoverTimedOutRuns(ctx, TimedOutRunRecoveryRequest{
		Now: now.Add(12 * time.Second),
	})
	if err != nil {
		t.Fatalf("recover timed out running runs: %v", err)
	}
	if got := len(recovered); got != 1 {
		t.Fatalf("recovered count = %d, want 1", got)
	}
	if recovered[0].Run.Status != DurableRunStatusExpired {
		t.Fatalf("run status = %q, want expired", recovered[0].Run.Status)
	}
	if recovered[0].Run.TerminalReason != DurableTerminalReasonRunTimeout {
		t.Fatalf("terminal reason = %q, want run_timeout", recovered[0].Run.TerminalReason)
	}
	if _, err := store.HeartbeatExecutionLease(
		ctx,
		lease.LeaseID,
		lease.WorkerID,
		now.Add(13*time.Second),
		now.Add(time.Minute),
	); err == nil {
		t.Fatal("heartbeat after run timeout returned nil error")
	}
	events, err := store.ListRunEvents(ctx, "run-timeout")
	if err != nil {
		t.Fatalf("list events: %v", err)
	}
	assertDurableEventTypes(t, events, []DurableRunEventType{
		DurableRunEventTypeRunAdmitted,
		DurableRunEventTypeLeaseAcquired,
		DurableRunEventTypeRunStarted,
		DurableRunEventTypeLeaseExpired,
		DurableRunEventTypeRunExpired,
	})
	if events[3].Payload["release_reason"] != string(DurableTerminalReasonRunTimeout) {
		t.Fatalf("lease.expired payload = %#v, want run_timeout", events[3].Payload)
	}
	if events[4].Payload["terminal_reason"] != string(DurableTerminalReasonRunTimeout) {
		t.Fatalf("run.expired payload = %#v, want run_timeout", events[4].Payload)
	}
}
