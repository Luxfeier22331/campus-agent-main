//go:build retired_pg_lease

package execution

import (
	"context"
	"errors"
	"testing"
	"time"
)

func TestInMemoryDurableRuntimeStoreCreatesRunsWithConversationActiveRunLock(t *testing.T) {
	store := NewInMemoryDurableRuntimeStore()
	ctx := context.Background()
	createdAt := time.Date(2026, 6, 4, 8, 0, 0, 0, time.UTC)
	run := DurableRun{
		RunID:          "run-001",
		ConversationID: "conv-001",
		TurnID:         "turn-001",
		RequestID:      "req-001",
		TraceID:        "trace-001",
		OwnerUserID:    "user-001",
		Surface:        "public-chat-web",
		Lane:           DurableLaneRAG,
		CreatedAt:      createdAt,
		Metadata:       map[string]any{"source": "test"},
	}

	created, err := store.CreateRun(ctx, run)
	if err != nil {
		t.Fatalf("create durable run: %v", err)
	}
	if created.Status != DurableRunStatusCreated {
		t.Fatalf("created status = %q, want created", created.Status)
	}
	created.Metadata["source"] = "mutated"

	stored, err := store.GetRun(ctx, "run-001")
	if err != nil {
		t.Fatalf("get durable run: %v", err)
	}
	if stored.Metadata["source"] != "test" {
		t.Fatalf("stored metadata = %#v, want defensive copy", stored.Metadata)
	}

	_, err = store.CreateRun(ctx, DurableRun{
		RunID:          "run-duplicate-active",
		ConversationID: "conv-001",
		TurnID:         "turn-002",
		RequestID:      "req-002",
		OwnerUserID:    "user-001",
		Surface:        "public-chat-web",
		Lane:           DurableLaneRAG,
		CreatedAt:      createdAt.Add(time.Second),
	})
	if !errors.Is(err, ErrConversationActiveRun) {
		t.Fatalf("duplicate active conversation error = %v, want ErrConversationActiveRun", err)
	}

	if _, err := store.TransitionRun(ctx, "run-001", DurableRunStatusQueued, "", createdAt.Add(2*time.Second)); err != nil {
		t.Fatalf("queue durable run: %v", err)
	}
	if _, err := store.TransitionRun(ctx, "run-001", DurableRunStatusAdmitted, "", createdAt.Add(3*time.Second)); err != nil {
		t.Fatalf("admit durable run: %v", err)
	}
	if _, err := store.TransitionRun(ctx, "run-001", DurableRunStatusRunning, "", createdAt.Add(4*time.Second)); err != nil {
		t.Fatalf("start durable run: %v", err)
	}
	completed, err := store.TransitionRun(
		ctx,
		"run-001",
		DurableRunStatusCompleted,
		DurableTerminalReasonAnswerCompleted,
		createdAt.Add(5*time.Second),
	)
	if err != nil {
		t.Fatalf("complete durable run: %v", err)
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
		Surface:        "public-chat-web",
		Lane:           DurableLaneRAG,
		CreatedAt:      createdAt.Add(6 * time.Second),
	}); err != nil {
		t.Fatalf("create run after terminal active lock release: %v", err)
	}
}

func TestInMemoryDurableRuntimeStoreRejectsInvalidRunStateTransitions(t *testing.T) {
	store := NewInMemoryDurableRuntimeStore()
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
		Surface:        "public-chat-web",
		Lane:           DurableLaneRAG,
		CreatedAt:      now,
	})
	if err != nil {
		t.Fatalf("create durable run: %v", err)
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

func TestInMemoryDurableRuntimeStoreAppendsRunEventsWithMonotonicSequence(t *testing.T) {
	store := NewInMemoryDurableRuntimeStore()
	ctx := context.Background()
	now := time.Date(2026, 6, 4, 8, 10, 0, 0, time.UTC)
	createDurableRunForTest(t, store, "run-events", "conv-events", now)

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

func TestInMemoryDurableRuntimeStoreManagesExecutionLeaseOwnership(t *testing.T) {
	store := NewInMemoryDurableRuntimeStore()
	ctx := context.Background()
	now := time.Date(2026, 6, 4, 8, 15, 0, 0, time.UTC)
	createDurableRunForTest(t, store, "run-lease", "conv-lease", now)

	if _, err := store.AcquireExecutionLease(ctx, ExecutionLeaseRequest{
		LeaseID:   "lease-too-early",
		RunID:     "run-lease",
		StepID:    "primary",
		Lane:      DurableLaneRAG,
		WorkerID:  "worker-001",
		Attempt:   1,
		Now:       now.Add(time.Second),
		ExpiresAt: now.Add(31 * time.Second),
	}); !errors.Is(err, ErrInvalidRunTransition) {
		t.Fatalf("lease before admitted error = %v, want ErrInvalidRunTransition", err)
	}

	if _, err := store.TransitionRun(ctx, "run-lease", DurableRunStatusQueued, "", now.Add(2*time.Second)); err != nil {
		t.Fatalf("queue run: %v", err)
	}
	if _, err := store.TransitionRun(ctx, "run-lease", DurableRunStatusAdmitted, "", now.Add(3*time.Second)); err != nil {
		t.Fatalf("admit run: %v", err)
	}
	prepareDurableLeaseDependenciesForTest(t, store, DurableLaneRAG, "worker-001", now.Add(3500*time.Millisecond))
	lease, err := store.AcquireExecutionLease(ctx, ExecutionLeaseRequest{
		LeaseID:   "lease-001",
		RunID:     "run-lease",
		StepID:    "primary",
		Lane:      DurableLaneRAG,
		WorkerID:  "worker-001",
		Attempt:   1,
		Now:       now.Add(4 * time.Second),
		ExpiresAt: now.Add(34 * time.Second),
	})
	if err != nil {
		t.Fatalf("acquire lease: %v", err)
	}
	if lease.Status != ExecutionLeaseStatusLeased {
		t.Fatalf("lease status = %q, want leased", lease.Status)
	}

	if _, err := store.AcquireExecutionLease(ctx, ExecutionLeaseRequest{
		LeaseID:   "lease-duplicate",
		RunID:     "run-lease",
		StepID:    "primary",
		Lane:      DurableLaneRAG,
		WorkerID:  "worker-002",
		Attempt:   2,
		Now:       now.Add(5 * time.Second),
		ExpiresAt: now.Add(35 * time.Second),
	}); !errors.Is(err, ErrExecutionLeaseConflict) {
		t.Fatalf("duplicate active lease error = %v, want ErrExecutionLeaseConflict", err)
	}
	if _, err := store.HeartbeatExecutionLease(
		ctx,
		"lease-001",
		"worker-002",
		now.Add(6*time.Second),
		now.Add(36*time.Second),
	); !errors.Is(err, ErrExecutionLeaseDrift) {
		t.Fatalf("wrong owner heartbeat error = %v, want ErrExecutionLeaseDrift", err)
	}
	heartbeat, err := store.HeartbeatExecutionLease(
		ctx,
		"lease-001",
		"worker-001",
		now.Add(7*time.Second),
		now.Add(37*time.Second),
	)
	if err != nil {
		t.Fatalf("heartbeat lease: %v", err)
	}
	if !heartbeat.ExpiresAt.Equal(now.Add(37 * time.Second)) {
		t.Fatalf("heartbeat expires_at = %s, want extended expiry", heartbeat.ExpiresAt)
	}
	currentLease, err := store.GetExecutionLease(ctx, "lease-001")
	if err != nil {
		t.Fatalf("get active lease: %v", err)
	}
	if currentLease.LeaseID != "lease-001" || currentLease.Status != ExecutionLeaseStatusLeased {
		t.Fatalf("current lease = %#v, want active lease-001", currentLease)
	}
	if _, err := store.ReleaseExecutionLease(
		ctx,
		"lease-001",
		"worker-002",
		"completed",
		now.Add(8*time.Second),
	); !errors.Is(err, ErrExecutionLeaseDrift) {
		t.Fatalf("wrong owner release error = %v, want ErrExecutionLeaseDrift", err)
	}
	released, err := store.ReleaseExecutionLease(
		ctx,
		"lease-001",
		"worker-001",
		"completed",
		now.Add(9*time.Second),
	)
	if err != nil {
		t.Fatalf("release lease: %v", err)
	}
	if released.Status != ExecutionLeaseStatusReleased {
		t.Fatalf("released status = %q, want released", released.Status)
	}
	if released.ReleaseReason != "completed" {
		t.Fatalf("release reason = %q, want completed", released.ReleaseReason)
	}
	currentLease, err = store.GetExecutionLease(ctx, "lease-001")
	if err != nil {
		t.Fatalf("get released lease: %v", err)
	}
	if currentLease.Status != ExecutionLeaseStatusReleased {
		t.Fatalf("current lease status = %q, want released", currentLease.Status)
	}
	if _, err := store.HeartbeatExecutionLease(
		ctx,
		"lease-001",
		"worker-001",
		now.Add(10*time.Second),
		now.Add(40*time.Second),
	); !errors.Is(err, ErrInvalidExecutionLease) {
		t.Fatalf("heartbeat released lease error = %v, want ErrInvalidExecutionLease", err)
	}
}

func TestInMemoryDurableRuntimeStoreRequiresEnabledLaneBudgetAndWorkerHeartbeatForLease(t *testing.T) {
	store := NewInMemoryDurableRuntimeStore()
	ctx := context.Background()
	now := time.Date(2026, 6, 4, 8, 20, 0, 0, time.UTC)
	createDurableRunForTest(t, store, "run-budget", "conv-budget", now)
	if _, err := store.TransitionRun(ctx, "run-budget", DurableRunStatusQueued, "", now.Add(time.Second)); err != nil {
		t.Fatalf("queue run: %v", err)
	}
	if _, err := store.TransitionRun(ctx, "run-budget", DurableRunStatusAdmitted, "", now.Add(2*time.Second)); err != nil {
		t.Fatalf("admit run: %v", err)
	}

	_, err := store.AcquireExecutionLease(ctx, ExecutionLeaseRequest{
		LeaseID:   "lease-without-budget",
		RunID:     "run-budget",
		StepID:    "primary",
		Lane:      DurableLaneRAG,
		WorkerID:  "worker-budget",
		Attempt:   1,
		Now:       now.Add(3 * time.Second),
		ExpiresAt: now.Add(33 * time.Second),
	})
	if !errors.Is(err, ErrLaneBudgetNotFound) {
		t.Fatalf("missing lane budget error = %v, want ErrLaneBudgetNotFound", err)
	}
	if err := store.UpsertLaneBudget(ctx, LaneBudget{
		Lane:                   DurableLaneRAG,
		MaxActiveLeases:        1,
		MaxQueuedRuns:          4,
		QueueTimeout:           30 * time.Second,
		RunTimeout:             2 * time.Minute,
		LeaseTimeout:           30 * time.Second,
		WorkerHeartbeatTimeout: 15 * time.Second,
		Enabled:                false,
		UpdatedAt:              now.Add(4 * time.Second),
	}); err != nil {
		t.Fatalf("upsert disabled lane budget: %v", err)
	}
	_, err = store.AcquireExecutionLease(ctx, ExecutionLeaseRequest{
		LeaseID:   "lease-disabled-budget",
		RunID:     "run-budget",
		StepID:    "primary",
		Lane:      DurableLaneRAG,
		WorkerID:  "worker-budget",
		Attempt:   1,
		Now:       now.Add(5 * time.Second),
		ExpiresAt: now.Add(35 * time.Second),
	})
	if !errors.Is(err, ErrLaneBudgetDisabled) {
		t.Fatalf("disabled lane budget error = %v, want ErrLaneBudgetDisabled", err)
	}
	if err := store.UpsertLaneBudget(ctx, LaneBudget{
		Lane:                   DurableLaneRAG,
		MaxActiveLeases:        1,
		MaxQueuedRuns:          4,
		QueueTimeout:           30 * time.Second,
		RunTimeout:             2 * time.Minute,
		LeaseTimeout:           30 * time.Second,
		WorkerHeartbeatTimeout: 15 * time.Second,
		Enabled:                true,
		UpdatedAt:              now.Add(6 * time.Second),
	}); err != nil {
		t.Fatalf("upsert enabled lane budget: %v", err)
	}
	_, err = store.AcquireExecutionLease(ctx, ExecutionLeaseRequest{
		LeaseID:   "lease-without-worker",
		RunID:     "run-budget",
		StepID:    "primary",
		Lane:      DurableLaneRAG,
		WorkerID:  "worker-budget",
		Attempt:   1,
		Now:       now.Add(7 * time.Second),
		ExpiresAt: now.Add(37 * time.Second),
	})
	if !errors.Is(err, ErrWorkerHeartbeatNotFound) {
		t.Fatalf("missing worker heartbeat error = %v, want ErrWorkerHeartbeatNotFound", err)
	}
	if err := store.UpsertWorkerHeartbeat(ctx, WorkerHeartbeat{
		WorkerID:       "worker-budget",
		WorkerKind:     "supervisor-agent-worker",
		Lanes:          []DurableLane{DurableLaneNotice},
		RuntimeVersion: "test",
		Status:         WorkerHeartbeatStatusReady,
		HeartbeatAt:    now.Add(8 * time.Second),
		StartedAt:      now,
	}); err != nil {
		t.Fatalf("upsert worker heartbeat: %v", err)
	}
	_, err = store.AcquireExecutionLease(ctx, ExecutionLeaseRequest{
		LeaseID:   "lease-worker-wrong-lane",
		RunID:     "run-budget",
		StepID:    "primary",
		Lane:      DurableLaneRAG,
		WorkerID:  "worker-budget",
		Attempt:   1,
		Now:       now.Add(9 * time.Second),
		ExpiresAt: now.Add(39 * time.Second),
	})
	if !errors.Is(err, ErrWorkerHeartbeatInvalid) {
		t.Fatalf("worker wrong lane error = %v, want ErrWorkerHeartbeatInvalid", err)
	}
	if err := store.UpsertWorkerHeartbeat(ctx, WorkerHeartbeat{
		WorkerID:       "worker-budget",
		WorkerKind:     "supervisor-agent-worker",
		Lanes:          []DurableLane{DurableLaneRAG},
		RuntimeVersion: "test",
		Status:         WorkerHeartbeatStatusReady,
		HeartbeatAt:    now.Add(10 * time.Second),
		StartedAt:      now,
	}); err != nil {
		t.Fatalf("upsert rag worker heartbeat: %v", err)
	}
	lease, err := store.AcquireExecutionLease(ctx, ExecutionLeaseRequest{
		LeaseID:   "lease-budget",
		RunID:     "run-budget",
		StepID:    "primary",
		Lane:      DurableLaneRAG,
		WorkerID:  "worker-budget",
		Attempt:   1,
		Now:       now.Add(11 * time.Second),
		ExpiresAt: now.Add(41 * time.Second),
	})
	if err != nil {
		t.Fatalf("acquire lease after lane budget and worker heartbeat: %v", err)
	}
	if lease.WorkerID != "worker-budget" {
		t.Fatalf("lease worker_id = %q, want worker-budget", lease.WorkerID)
	}
}

func TestInMemoryDurableRuntimeStoreExpiresLeasesAndReleasesActiveSlot(t *testing.T) {
	store := NewInMemoryDurableRuntimeStore()
	ctx := context.Background()
	now := time.Date(2026, 6, 4, 8, 25, 0, 0, time.UTC)
	createDurableRunForTest(t, store, "run-expire", "conv-expire", now)
	if _, err := store.TransitionRun(ctx, "run-expire", DurableRunStatusQueued, "", now.Add(time.Second)); err != nil {
		t.Fatalf("queue run: %v", err)
	}
	if _, err := store.TransitionRun(ctx, "run-expire", DurableRunStatusAdmitted, "", now.Add(2*time.Second)); err != nil {
		t.Fatalf("admit run: %v", err)
	}
	if err := store.UpsertLaneBudget(ctx, LaneBudget{
		Lane:                   DurableLaneRAG,
		MaxActiveLeases:        1,
		MaxQueuedRuns:          4,
		QueueTimeout:           30 * time.Second,
		RunTimeout:             2 * time.Minute,
		LeaseTimeout:           10 * time.Second,
		WorkerHeartbeatTimeout: 15 * time.Second,
		Enabled:                true,
		UpdatedAt:              now.Add(3 * time.Second),
	}); err != nil {
		t.Fatalf("upsert lane budget: %v", err)
	}
	if err := store.UpsertWorkerHeartbeat(ctx, WorkerHeartbeat{
		WorkerID:       "worker-expire",
		WorkerKind:     "supervisor-agent-worker",
		Lanes:          []DurableLane{DurableLaneRAG},
		RuntimeVersion: "test",
		Status:         WorkerHeartbeatStatusReady,
		HeartbeatAt:    now.Add(4 * time.Second),
		StartedAt:      now,
	}); err != nil {
		t.Fatalf("upsert worker heartbeat: %v", err)
	}
	if _, err := store.AcquireExecutionLease(ctx, ExecutionLeaseRequest{
		LeaseID:   "lease-expire",
		RunID:     "run-expire",
		StepID:    "primary",
		Lane:      DurableLaneRAG,
		WorkerID:  "worker-expire",
		Attempt:   1,
		Now:       now.Add(5 * time.Second),
		ExpiresAt: now.Add(15 * time.Second),
	}); err != nil {
		t.Fatalf("acquire expiring lease: %v", err)
	}
	if _, err := store.ExpireExecutionLeases(ctx, now.Add(14*time.Second), "lease_expired"); err != nil {
		t.Fatalf("expire leases before deadline: %v", err)
	}
	if _, err := store.AcquireExecutionLease(ctx, ExecutionLeaseRequest{
		LeaseID:   "lease-before-expiry-slot",
		RunID:     "run-expire",
		StepID:    "primary",
		Lane:      DurableLaneRAG,
		WorkerID:  "worker-expire",
		Attempt:   2,
		Now:       now.Add(14 * time.Second),
		ExpiresAt: now.Add(24 * time.Second),
	}); !errors.Is(err, ErrExecutionLeaseConflict) {
		t.Fatalf("lease before expiry slot error = %v, want ErrExecutionLeaseConflict", err)
	}

	expired, err := store.ExpireExecutionLeases(ctx, now.Add(16*time.Second), "lease_expired")
	if err != nil {
		t.Fatalf("expire leases after deadline: %v", err)
	}
	if got := len(expired); got != 1 {
		t.Fatalf("expired lease count = %d, want 1", got)
	}
	if expired[0].Status != ExecutionLeaseStatusExpired {
		t.Fatalf("expired lease status = %q, want expired", expired[0].Status)
	}
	if expired[0].ReleaseReason != "lease_expired" {
		t.Fatalf("expired release reason = %q, want lease_expired", expired[0].ReleaseReason)
	}
	if _, err := store.AcquireExecutionLease(ctx, ExecutionLeaseRequest{
		LeaseID:   "lease-after-expiry",
		RunID:     "run-expire",
		StepID:    "primary",
		Lane:      DurableLaneRAG,
		WorkerID:  "worker-expire",
		Attempt:   2,
		Now:       now.Add(17 * time.Second),
		ExpiresAt: now.Add(27 * time.Second),
	}); err != nil {
		t.Fatalf("acquire lease after expiry released active slot: %v", err)
	}
}

func createDurableRunForTest(
	t *testing.T,
	store *InMemoryDurableRuntimeStore,
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
		Surface:        "public-chat-web",
		Lane:           DurableLaneRAG,
		CreatedAt:      now,
	}); err != nil {
		t.Fatalf("create durable run %s: %v", runID, err)
	}
}

func prepareDurableLeaseDependenciesForTest(
	t *testing.T,
	store *InMemoryDurableRuntimeStore,
	lane DurableLane,
	workerID string,
	now time.Time,
) {
	t.Helper()
	ctx := context.Background()
	if err := store.UpsertLaneBudget(ctx, LaneBudget{
		Lane:                   lane,
		MaxActiveLeases:        8,
		MaxQueuedRuns:          16,
		QueueTimeout:           30 * time.Second,
		RunTimeout:             2 * time.Minute,
		LeaseTimeout:           30 * time.Second,
		WorkerHeartbeatTimeout: 15 * time.Second,
		Enabled:                true,
		UpdatedAt:              now,
	}); err != nil {
		t.Fatalf("upsert lane budget for %s: %v", lane, err)
	}
	if err := store.UpsertWorkerHeartbeat(ctx, WorkerHeartbeat{
		WorkerID:       workerID,
		WorkerKind:     "supervisor-agent-worker",
		Lanes:          []DurableLane{lane},
		RuntimeVersion: "test",
		Status:         WorkerHeartbeatStatusReady,
		HeartbeatAt:    now,
		StartedAt:      now.Add(-time.Second),
	}); err != nil {
		t.Fatalf("upsert worker heartbeat for %s: %v", workerID, err)
	}
}
