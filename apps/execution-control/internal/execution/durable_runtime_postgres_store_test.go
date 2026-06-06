package execution

import (
	"context"
	"errors"
	"os"
	"strings"
	"sync"
	"testing"
	"time"
)

func TestPostgresDurableRuntimeStoreRequiresDatabaseURL(t *testing.T) {
	_, err := NewPostgresDurableRuntimeStore(
		context.Background(),
		PostgresDurableRuntimeStoreOptions{},
	)
	if !errors.Is(err, ErrInvalidDurableRuntimeStore) {
		t.Fatalf("empty durable runtime postgres options error = %v, want ErrInvalidDurableRuntimeStore", err)
	}
}

func TestPostgresDurableRuntimeStoreSchemaIncludesDurableRuntimeTables(t *testing.T) {
	requiredSnippets := []string{
		"create schema if not exists runtime",
		"create table if not exists runtime.agent_runs",
		"create table if not exists runtime.agent_run_events",
		"create table if not exists runtime.execution_leases",
		"create table if not exists runtime.lane_budgets",
		"create table if not exists runtime.worker_heartbeats",
		"create table if not exists runtime.conversation_run_locks",
		"unique index if not exists agent_runs_active_conversation_idx",
		"unique index if not exists agent_run_events_run_sequence_idx",
		"unique index if not exists execution_leases_active_run_step_idx",
	}
	for _, snippet := range requiredSnippets {
		if !strings.Contains(durableRuntimeSchemaSQL, snippet) {
			t.Fatalf("durable runtime schema missing %q", snippet)
		}
	}
}

func TestPostgresDurableRuntimeStoreSatisfiesDurableRuntimeStoreContract(t *testing.T) {
	databaseURL := requirePostgresDurableRuntimeTestDatabaseURL(t)
	ctx := context.Background()
	store, err := NewPostgresDurableRuntimeStore(ctx, PostgresDurableRuntimeStoreOptions{
		DatabaseURL: databaseURL,
		AutoMigrate: true,
	})
	if err != nil {
		t.Fatalf("new postgres durable runtime store: %v", err)
	}
	t.Cleanup(store.Close)
	if err := store.HealthCheck(ctx); err != nil {
		t.Fatalf("postgres durable runtime store healthcheck: %v", err)
	}

	cleanupPostgresDurableRuntimeTestArtifacts(t, ctx, store)
	t.Cleanup(func() {
		cleanupPostgresDurableRuntimeTestArtifacts(t, context.Background(), store)
	})
	exerciseDurableRuntimeStoreContract(
		t,
		ctx,
		store,
		"pg-"+time.Now().UTC().Format("20060102T150405.000000000"),
	)
}

func TestPostgresDurableRuntimeStoreAcquireNextConcurrentWorkersDoNotDoubleLeaseRun(t *testing.T) {
	databaseURL := requirePostgresDurableRuntimeTestDatabaseURL(t)
	ctx := context.Background()
	store, err := NewPostgresDurableRuntimeStore(ctx, PostgresDurableRuntimeStoreOptions{
		DatabaseURL: databaseURL,
		AutoMigrate: true,
	})
	if err != nil {
		t.Fatalf("new postgres durable runtime store: %v", err)
	}
	t.Cleanup(store.Close)
	if err := store.HealthCheck(ctx); err != nil {
		t.Fatalf("postgres durable runtime store healthcheck: %v", err)
	}

	cleanupPostgresDurableRuntimeTestArtifacts(t, ctx, store)
	t.Cleanup(func() {
		cleanupPostgresDurableRuntimeTestArtifacts(t, context.Background(), store)
	})
	now := time.Date(2026, 6, 4, 10, 12, 0, 0, time.UTC)
	prefix := "pg-concurrent-" + time.Now().UTC().Format("20060102T150405.000000000")
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
	for _, workerID := range []string{prefix + "-worker-1", prefix + "-worker-2"} {
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
	runID := prefix + "-run"
	if _, err := store.CreateRun(ctx, DurableRun{
		RunID:          runID,
		ConversationID: prefix + "-conversation",
		TurnID:         prefix + "-turn",
		RequestID:      prefix + "-request",
		TraceID:        prefix + "-trace",
		OwnerUserID:    prefix + "-user",
		Surface:        "public-chat-web",
		Lane:           DurableLaneRAG,
		CreatedAt:      now.Add(time.Second),
	}); err != nil {
		t.Fatalf("create queued run: %v", err)
	}
	if _, err := store.TransitionRun(ctx, runID, DurableRunStatusQueued, "", now.Add(2*time.Second)); err != nil {
		t.Fatalf("queue run: %v", err)
	}

	type acquireResult struct {
		Lease ExecutionLease
		Err   error
	}
	start := make(chan struct{})
	results := make(chan acquireResult, 2)
	var wg sync.WaitGroup
	for index, workerID := range []string{prefix + "-worker-1", prefix + "-worker-2"} {
		wg.Add(1)
		go func(index int, workerID string) {
			defer wg.Done()
			<-start
			lease, err := store.AcquireNextExecutionLease(ctx, NextExecutionLeaseRequest{
				LeaseID:   prefix + "-lease-" + workerID,
				StepID:    "primary",
				Lane:      DurableLaneRAG,
				WorkerID:  workerID,
				Now:       now.Add(time.Duration(index+3) * time.Second),
				ExpiresAt: now.Add(time.Duration(index+33) * time.Second),
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
	if successes[0].RunID != runID {
		t.Fatalf("leased run_id = %q, want %s", successes[0].RunID, runID)
	}
	events, err := store.ListRunEvents(ctx, runID)
	if err != nil {
		t.Fatalf("list run events: %v", err)
	}
	assertDurableEventTypes(t, events, []DurableRunEventType{
		DurableRunEventTypeRunAdmitted,
		DurableRunEventTypeLeaseAcquired,
		DurableRunEventTypeRunStarted,
	})
}

func requirePostgresDurableRuntimeTestDatabaseURL(t *testing.T) string {
	t.Helper()
	databaseURL := strings.TrimSpace(os.Getenv("EXECUTION_CONTROL_DURABLE_RUNTIME_TEST_DATABASE_URL"))
	if databaseURL == "" {
		t.Skip("EXECUTION_CONTROL_DURABLE_RUNTIME_TEST_DATABASE_URL is not configured")
	}
	return databaseURL
}

func cleanupPostgresDurableRuntimeTestArtifacts(
	t *testing.T,
	ctx context.Context,
	store *PostgresDurableRuntimeStore,
) {
	t.Helper()
	if store == nil || store.pool == nil {
		return
	}
	if _, err := store.pool.Exec(
		ctx,
		`delete from runtime.agent_runs where run_id like 'pg-%'`,
	); err != nil {
		t.Fatalf("cleanup postgres durable runtime test runs: %v", err)
	}
	if _, err := store.pool.Exec(
		ctx,
		`delete from runtime.worker_heartbeats where worker_id like 'pg-%'`,
	); err != nil {
		t.Fatalf("cleanup postgres durable runtime test worker heartbeats: %v", err)
	}
}

func TestInMemoryDurableRuntimeStoreSatisfiesDurableRuntimeStoreContract(t *testing.T) {
	exerciseDurableRuntimeStoreContract(
		t,
		context.Background(),
		NewInMemoryDurableRuntimeStore(),
		"memory",
	)
}

func exerciseDurableRuntimeStoreContract(
	t *testing.T,
	ctx context.Context,
	store DurableRuntimeStore,
	prefix string,
) {
	t.Helper()
	now := time.Date(2026, 6, 4, 9, 0, 0, 0, time.UTC)
	runID := prefix + "-run"
	conversationID := prefix + "-conversation"
	workerID := prefix + "-worker"

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
		WorkerID:       workerID,
		WorkerKind:     "supervisor-agent-worker",
		Lanes:          []DurableLane{DurableLaneRAG},
		RuntimeVersion: "test",
		Status:         WorkerHeartbeatStatusReady,
		HeartbeatAt:    now,
		StartedAt:      now.Add(-time.Second),
		Metadata:       map[string]any{"contract": prefix},
	}); err != nil {
		t.Fatalf("upsert worker heartbeat: %v", err)
	}

	if _, err := store.CreateRun(ctx, DurableRun{
		RunID:           runID,
		ConversationID:  conversationID,
		TurnID:          prefix + "-turn",
		RequestID:       prefix + "-request",
		TraceID:         prefix + "-trace",
		OwnerUserID:     prefix + "-user",
		Surface:         "public-chat-web",
		Lane:            DurableLaneRAG,
		CreatedAt:       now,
		RuntimeVersions: map[string]any{"contract": "v1"},
		Metadata:        map[string]any{"prefix": prefix},
	}); err != nil {
		t.Fatalf("create run: %v", err)
	}
	if _, err := store.CreateRun(ctx, DurableRun{
		RunID:          prefix + "-duplicate-active-run",
		ConversationID: conversationID,
		TurnID:         prefix + "-turn-duplicate",
		RequestID:      prefix + "-request-duplicate",
		OwnerUserID:    prefix + "-user",
		Surface:        "public-chat-web",
		Lane:           DurableLaneRAG,
		CreatedAt:      now.Add(time.Second),
	}); !errors.Is(err, ErrConversationActiveRun) {
		t.Fatalf("active conversation create error = %v, want ErrConversationActiveRun", err)
	}
	if _, err := store.AppendRunEvent(ctx, DurableRunEvent{
		EventID:              prefix + "-event-001",
		RunID:                runID,
		ConversationID:       conversationID,
		EventType:            DurableRunEventTypeRunCreated,
		Sequence:             1,
		OccurredAt:           now,
		Visibility:           DurableRunEventVisibilityInternal,
		PayloadSchemaVersion: "run-event-v1",
		Payload:              map[string]any{"status": string(DurableRunStatusCreated)},
	}); err != nil {
		t.Fatalf("append run event: %v", err)
	}
	if _, err := store.TransitionRun(ctx, runID, DurableRunStatusQueued, "", now.Add(time.Second)); err != nil {
		t.Fatalf("queue run: %v", err)
	}
	if _, err := store.TransitionRun(ctx, runID, DurableRunStatusAdmitted, "", now.Add(2*time.Second)); err != nil {
		t.Fatalf("admit run: %v", err)
	}
	if _, err := store.AcquireExecutionLease(ctx, ExecutionLeaseRequest{
		LeaseID:   prefix + "-lease-001",
		RunID:     runID,
		StepID:    "primary",
		Lane:      DurableLaneRAG,
		WorkerID:  workerID,
		Attempt:   1,
		Now:       now.Add(3 * time.Second),
		ExpiresAt: now.Add(33 * time.Second),
	}); err != nil {
		t.Fatalf("acquire execution lease: %v", err)
	}
	activeLease, err := store.GetExecutionLease(ctx, prefix+"-lease-001")
	if err != nil {
		t.Fatalf("get active execution lease: %v", err)
	}
	if activeLease.Status != ExecutionLeaseStatusLeased || activeLease.WorkerID != workerID {
		t.Fatalf("active execution lease = %#v, want leased owner", activeLease)
	}
	if _, err := store.GetExecutionLease(ctx, prefix+"-missing-lease"); !errors.Is(err, ErrExecutionLeaseNotFound) {
		t.Fatalf("missing execution lease error = %v, want ErrExecutionLeaseNotFound", err)
	}
	if _, err := store.HeartbeatExecutionLease(
		ctx,
		prefix+"-lease-001",
		workerID,
		now.Add(4*time.Second),
		now.Add(34*time.Second),
	); err != nil {
		t.Fatalf("heartbeat execution lease: %v", err)
	}
	if _, err := store.ReleaseExecutionLease(
		ctx,
		prefix+"-lease-001",
		workerID,
		"completed",
		now.Add(5*time.Second),
	); err != nil {
		t.Fatalf("release execution lease: %v", err)
	}
	releasedLease, err := store.GetExecutionLease(ctx, prefix+"-lease-001")
	if err != nil {
		t.Fatalf("get released execution lease: %v", err)
	}
	if releasedLease.Status != ExecutionLeaseStatusReleased {
		t.Fatalf("released execution lease status = %q, want released", releasedLease.Status)
	}
	if _, err := store.TransitionRun(
		ctx,
		runID,
		DurableRunStatusRunning,
		"",
		now.Add(6*time.Second),
	); err != nil {
		t.Fatalf("start run: %v", err)
	}
	if _, err := store.TransitionRun(
		ctx,
		runID,
		DurableRunStatusCompleted,
		DurableTerminalReasonAnswerCompleted,
		now.Add(7*time.Second),
	); err != nil {
		t.Fatalf("complete run: %v", err)
	}
	events, err := store.ListRunEvents(ctx, runID)
	if err != nil {
		t.Fatalf("list run events: %v", err)
	}
	if len(events) != 1 || events[0].Sequence != 1 {
		t.Fatalf("events = %#v, want one sequence-1 event", events)
	}

	coordinatorRunID := prefix + "-coordinator-run"
	if _, err := store.CreateRun(ctx, DurableRun{
		RunID:          coordinatorRunID,
		ConversationID: prefix + "-coordinator-conversation",
		TurnID:         prefix + "-coordinator-turn",
		RequestID:      prefix + "-coordinator-request",
		OwnerUserID:    prefix + "-user",
		Surface:        "public-chat-web",
		Lane:           DurableLaneRAG,
		CreatedAt:      now.Add(8 * time.Second),
	}); err != nil {
		t.Fatalf("create coordinator run: %v", err)
	}
	if _, err := store.TransitionRun(
		ctx,
		coordinatorRunID,
		DurableRunStatusQueued,
		"",
		now.Add(9*time.Second),
	); err != nil {
		t.Fatalf("queue coordinator run: %v", err)
	}
	coordinatorLease, err := store.AcquireNextExecutionLease(ctx, NextExecutionLeaseRequest{
		LeaseID:   prefix + "-coordinator-lease",
		StepID:    "primary",
		Lane:      DurableLaneRAG,
		WorkerID:  workerID,
		Now:       now.Add(10 * time.Second),
		ExpiresAt: now.Add(40 * time.Second),
	})
	if err != nil {
		t.Fatalf("acquire next execution lease: %v", err)
	}
	if coordinatorLease.RunID != coordinatorRunID {
		t.Fatalf("coordinator lease run_id = %q, want %q", coordinatorLease.RunID, coordinatorRunID)
	}
	coordinatorRun, err := store.GetRun(ctx, coordinatorRunID)
	if err != nil {
		t.Fatalf("get coordinator run: %v", err)
	}
	if coordinatorRun.Status != DurableRunStatusRunning {
		t.Fatalf("coordinator run status = %q, want running", coordinatorRun.Status)
	}
	coordinatorEvents, err := store.ListRunEvents(ctx, coordinatorRunID)
	if err != nil {
		t.Fatalf("list coordinator events: %v", err)
	}
	assertDurableEventTypes(t, coordinatorEvents, []DurableRunEventType{
		DurableRunEventTypeRunAdmitted,
		DurableRunEventTypeLeaseAcquired,
		DurableRunEventTypeRunStarted,
	})
	if _, err := store.ReleaseExecutionLease(
		ctx,
		coordinatorLease.LeaseID,
		workerID,
		"completed",
		now.Add(11*time.Second),
	); err != nil {
		t.Fatalf("release coordinator lease: %v", err)
	}
	if _, err := store.TransitionRun(
		ctx,
		coordinatorRunID,
		DurableRunStatusCompleted,
		DurableTerminalReasonAnswerCompleted,
		now.Add(12*time.Second),
	); err != nil {
		t.Fatalf("complete coordinator run: %v", err)
	}

	recoveryRunID := prefix + "-recovery-run"
	if _, err := store.CreateRun(ctx, DurableRun{
		RunID:          recoveryRunID,
		ConversationID: prefix + "-recovery-conversation",
		TurnID:         prefix + "-recovery-turn",
		RequestID:      prefix + "-recovery-request",
		OwnerUserID:    prefix + "-user",
		Surface:        "public-chat-web",
		Lane:           DurableLaneRAG,
		CreatedAt:      now.Add(13 * time.Second),
	}); err != nil {
		t.Fatalf("create recovery run: %v", err)
	}
	if _, err := store.TransitionRun(
		ctx,
		recoveryRunID,
		DurableRunStatusQueued,
		"",
		now.Add(14*time.Second),
	); err != nil {
		t.Fatalf("queue recovery run: %v", err)
	}
	recoveryLease, err := store.AcquireNextExecutionLease(ctx, NextExecutionLeaseRequest{
		LeaseID:   prefix + "-recovery-lease",
		StepID:    "primary",
		Lane:      DurableLaneRAG,
		WorkerID:  workerID,
		Now:       now.Add(15 * time.Second),
		ExpiresAt: now.Add(16 * time.Second),
	})
	if err != nil {
		t.Fatalf("acquire recovery lease: %v", err)
	}
	recovered, err := store.RecoverExpiredExecutionLeases(ctx, ExpiredLeaseRecoveryRequest{
		Now:              now.Add(17 * time.Second),
		ReleaseReason:    "lease_expired",
		TerminalReason:   DurableTerminalReasonLeaseExpired,
		MaxRetryAttempts: 1,
	})
	if err != nil {
		t.Fatalf("recover expired execution leases: %v", err)
	}
	if len(recovered) != 1 || recovered[0].Lease.LeaseID != recoveryLease.LeaseID {
		t.Fatalf("recovered leases = %#v, want one recovery lease", recovered)
	}
	recoveryRun, err := store.GetRun(ctx, recoveryRunID)
	if err != nil {
		t.Fatalf("get recovered run: %v", err)
	}
	if recoveryRun.Status != DurableRunStatusExpired {
		t.Fatalf("recovered run status = %q, want expired", recoveryRun.Status)
	}
	recoveryEvents, err := store.ListRunEvents(ctx, recoveryRunID)
	if err != nil {
		t.Fatalf("list recovery events: %v", err)
	}
	assertDurableEventTypes(t, recoveryEvents, []DurableRunEventType{
		DurableRunEventTypeRunAdmitted,
		DurableRunEventTypeLeaseAcquired,
		DurableRunEventTypeRunStarted,
		DurableRunEventTypeLeaseExpired,
		DurableRunEventTypeRunExpired,
	})
}
