package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/bridge"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/config"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/execution"
)

func TestDurableWorkerLoopRunOnceRegistersHeartbeatAndProcessesRun(t *testing.T) {
	ctx := context.Background()
	store := execution.NewInMemoryDurableRuntimeStore()
	now := time.Date(2026, 6, 4, 16, 0, 0, 0, time.UTC)
	if err := store.UpsertLaneBudget(ctx, execution.LaneBudget{
		Lane:                   execution.DurableLaneRAG,
		MaxActiveLeases:        1,
		MaxQueuedRuns:          4,
		QueueTimeout:           30 * time.Second,
		RunTimeout:             60 * time.Second,
		LeaseTimeout:           20 * time.Second,
		WorkerHeartbeatTimeout: 45 * time.Second,
		Enabled:                true,
		UpdatedAt:              now,
	}); err != nil {
		t.Fatalf("upsert lane budget: %v", err)
	}
	createHTTPAPIQueuedDurableRunForTest(t, store, "run-loop-001", "conv-loop-001", now, nil)

	bridgeClient := &fakeBridge{
		configured: true,
		executeDurableFn: func(_ context.Context, request bridge.DurableExecutionRequest) (bridge.ExecuteResponse, error) {
			if request.RunID != "run-loop-001" {
				t.Fatalf("durable request run_id = %q, want run-loop-001", request.RunID)
			}
			if request.LeaseID != "lease-loop-001" {
				t.Fatalf("durable request lease_id = %q, want lease-loop-001", request.LeaseID)
			}
			if request.WorkerID != "worker-loop-001" {
				t.Fatalf("durable request worker_id = %q, want worker-loop-001", request.WorkerID)
			}
			var payload map[string]any
			if err := json.Unmarshal(request.Execution.Payload, &payload); err != nil {
				t.Fatalf("decode execution payload: %v", err)
			}
			return bridge.ExecuteResponse{
				StatusCode: 200,
				Kind:       "durable_agent_response",
				Body:       durableAgentResponseBodyForTest("ok"),
			}, nil
		},
	}
	loop := newDurableWorkerLoop(durableWorkerLoopOptions{
		Store:                  store,
		Coordinator:            execution.NewDurableLeaseCoordinator(store),
		Bridge:                 bridgeClient,
		WorkerID:               "worker-loop-001",
		WorkerKind:             "execution-control",
		Lane:                   execution.DurableLaneRAG,
		StepID:                 "handoff:rag-agent:rag_request",
		LeaseTTL:               20 * time.Second,
		LeaseHeartbeatInterval: 5 * time.Second,
		Now: func() time.Time {
			return now.Add(2 * time.Second)
		},
		GenerateLeaseID: func() string {
			return "lease-loop-001"
		},
	})

	result, err := loop.RunOnce(ctx)
	if err != nil {
		t.Fatalf("run worker loop once: %v", err)
	}
	if result.Outcome != durableWorkerLoopOutcomeProcessed {
		t.Fatalf("loop outcome = %q, want processed", result.Outcome)
	}
	if result.RunID != "run-loop-001" || result.LeaseID != "lease-loop-001" {
		t.Fatalf("loop result = %#v", result)
	}
	run, err := store.GetRun(ctx, "run-loop-001")
	if err != nil {
		t.Fatalf("get run: %v", err)
	}
	if run.Status != execution.DurableRunStatusCompleted {
		t.Fatalf("run status = %q, want completed", run.Status)
	}
}

func TestDurableWorkerLoopRunOnceReturnsIdleWhenNoQueuedRun(t *testing.T) {
	ctx := context.Background()
	store := execution.NewInMemoryDurableRuntimeStore()
	now := time.Date(2026, 6, 4, 16, 5, 0, 0, time.UTC)
	if err := store.UpsertLaneBudget(ctx, execution.LaneBudget{
		Lane:                   execution.DurableLaneRAG,
		MaxActiveLeases:        1,
		MaxQueuedRuns:          4,
		QueueTimeout:           30 * time.Second,
		RunTimeout:             60 * time.Second,
		LeaseTimeout:           20 * time.Second,
		WorkerHeartbeatTimeout: 45 * time.Second,
		Enabled:                true,
		UpdatedAt:              now,
	}); err != nil {
		t.Fatalf("upsert lane budget: %v", err)
	}
	loop := newDurableWorkerLoop(durableWorkerLoopOptions{
		Store:       store,
		Coordinator: execution.NewDurableLeaseCoordinator(store),
		Bridge: &fakeBridge{
			configured: true,
			executeDurableFn: func(context.Context, bridge.DurableExecutionRequest) (bridge.ExecuteResponse, error) {
				t.Fatal("bridge must not be called when there is no queued run")
				return bridge.ExecuteResponse{}, nil
			},
		},
		WorkerID:               "worker-loop-idle",
		WorkerKind:             "execution-control",
		Lane:                   execution.DurableLaneRAG,
		StepID:                 "handoff:rag-agent:rag_request",
		LeaseTTL:               20 * time.Second,
		LeaseHeartbeatInterval: 5 * time.Second,
		Now: func() time.Time {
			return now
		},
		GenerateLeaseID: func() string {
			return "lease-loop-idle"
		},
	})

	result, err := loop.RunOnce(ctx)
	if err != nil {
		t.Fatalf("run worker loop idle: %v", err)
	}
	if result.Outcome != durableWorkerLoopOutcomeIdle {
		t.Fatalf("loop outcome = %q, want idle", result.Outcome)
	}
	if result.RunID != "" || result.LeaseID != "" {
		t.Fatalf("idle result = %#v", result)
	}
}

func TestDurableWorkerLoopRunOnceDoesNotOwnExpiredLeaseRecovery(t *testing.T) {
	ctx := context.Background()
	store := execution.NewInMemoryDurableRuntimeStore()
	now := time.Date(2026, 6, 4, 16, 7, 0, 0, time.UTC)
	if err := store.UpsertLaneBudget(ctx, execution.LaneBudget{
		Lane:                   execution.DurableLaneRAG,
		MaxActiveLeases:        1,
		MaxQueuedRuns:          4,
		QueueTimeout:           30 * time.Second,
		RunTimeout:             60 * time.Second,
		LeaseTimeout:           20 * time.Second,
		WorkerHeartbeatTimeout: 45 * time.Second,
		Enabled:                true,
		UpdatedAt:              now,
	}); err != nil {
		t.Fatalf("upsert lane budget: %v", err)
	}
	if err := store.UpsertWorkerHeartbeat(ctx, execution.WorkerHeartbeat{
		WorkerID:       "worker-loop-recovery",
		WorkerKind:     "execution-control",
		Lanes:          []execution.DurableLane{execution.DurableLaneRAG},
		RuntimeVersion: "test",
		Status:         execution.WorkerHeartbeatStatusReady,
		HeartbeatAt:    now,
		StartedAt:      now.Add(-time.Second),
	}); err != nil {
		t.Fatalf("upsert worker heartbeat: %v", err)
	}
	createHTTPAPIQueuedDurableRunForTest(t, store, "run-loop-expired", "conv-loop-expired", now, nil)
	coordinator := execution.NewDurableLeaseCoordinator(store)
	if _, err := coordinator.AcquireNextLease(ctx, execution.NextExecutionLeaseRequest{
		LeaseID:   "lease-loop-expired",
		StepID:    "handoff:rag-agent:rag_request",
		Lane:      execution.DurableLaneRAG,
		WorkerID:  "worker-loop-recovery",
		Now:       now.Add(time.Second),
		ExpiresAt: now.Add(2 * time.Second),
	}); err != nil {
		t.Fatalf("acquire expired lease fixture: %v", err)
	}
	createHTTPAPIQueuedDurableRunForTest(t, store, "run-loop-next", "conv-loop-next", now.Add(3*time.Second), nil)
	loop := newDurableWorkerLoop(durableWorkerLoopOptions{
		Store:       store,
		Coordinator: coordinator,
		Bridge: &fakeBridge{
			configured: true,
			executeDurableFn: func(_ context.Context, request bridge.DurableExecutionRequest) (bridge.ExecuteResponse, error) {
				t.Fatalf("worker loop must not execute while expired active lease is unrecovered; request=%#v", request)
				return bridge.ExecuteResponse{
					StatusCode: 200,
					Kind:       "durable_agent_response",
					Body:       durableAgentResponseBodyForTest("ok"),
				}, nil
			},
		},
		WorkerID:               "worker-loop-recovery",
		WorkerKind:             "execution-control",
		Lane:                   execution.DurableLaneRAG,
		StepID:                 "handoff:rag-agent:rag_request",
		LeaseTTL:               20 * time.Second,
		LeaseHeartbeatInterval: 5 * time.Second,
		Now: func() time.Time {
			return now.Add(3 * time.Second)
		},
		GenerateLeaseID: func() string {
			return "lease-loop-next"
		},
	})

	_, err := loop.RunOnce(ctx)
	if err == nil {
		t.Fatal("run worker loop with unrecovered expired active lease returned nil error")
	}
	if !errors.Is(err, execution.ErrLaneBudgetExceeded) {
		t.Fatalf("worker loop error = %v, want lane budget exceeded until recovery loop runs", err)
	}
	expiredRun, err := store.GetRun(ctx, "run-loop-expired")
	if err != nil {
		t.Fatalf("get unrecovered run: %v", err)
	}
	if expiredRun.Status != execution.DurableRunStatusRunning {
		t.Fatalf("unrecovered run status = %q, want running", expiredRun.Status)
	}
}

func TestDurableWorkerLoopRunOnceDoesNotOwnQueuedRunTimeoutRecovery(t *testing.T) {
	ctx := context.Background()
	store := execution.NewInMemoryDurableRuntimeStore()
	now := time.Date(2026, 6, 4, 16, 9, 0, 0, time.UTC)
	if err := store.UpsertLaneBudget(ctx, execution.LaneBudget{
		Lane:                   execution.DurableLaneRAG,
		MaxActiveLeases:        1,
		MaxQueuedRuns:          4,
		QueueTimeout:           time.Second,
		RunTimeout:             60 * time.Second,
		LeaseTimeout:           20 * time.Second,
		WorkerHeartbeatTimeout: 45 * time.Second,
		Enabled:                true,
		UpdatedAt:              now,
	}); err != nil {
		t.Fatalf("upsert lane budget: %v", err)
	}
	createHTTPAPIQueuedDurableRunForTest(t, store, "run-loop-queue-timeout", "conv-loop-queue-timeout", now, nil)
	createHTTPAPIQueuedDurableRunForTest(t, store, "run-loop-after-timeout", "conv-loop-after-timeout", now.Add(1500*time.Millisecond), nil)
	loop := newDurableWorkerLoop(durableWorkerLoopOptions{
		Store:       store,
		Coordinator: execution.NewDurableLeaseCoordinator(store),
		Bridge: &fakeBridge{
			configured: true,
			executeDurableFn: func(_ context.Context, request bridge.DurableExecutionRequest) (bridge.ExecuteResponse, error) {
				if request.RunID != "run-loop-queue-timeout" {
					t.Fatalf("durable request run_id = %q, want run-loop-queue-timeout", request.RunID)
				}
				return bridge.ExecuteResponse{
					StatusCode: 200,
					Kind:       "durable_agent_response",
					Body:       durableAgentResponseBodyForTest("ok"),
				}, nil
			},
		},
		WorkerID:               "worker-loop-timeout",
		WorkerKind:             "execution-control",
		Lane:                   execution.DurableLaneRAG,
		StepID:                 "handoff:rag-agent:rag_request",
		LeaseTTL:               20 * time.Second,
		LeaseHeartbeatInterval: 5 * time.Second,
		Now: func() time.Time {
			return now.Add(2 * time.Second)
		},
		GenerateLeaseID: func() string {
			return "lease-loop-after-timeout"
		},
	})

	result, err := loop.RunOnce(ctx)
	if err != nil {
		t.Fatalf("run worker loop before recovery loop: %v", err)
	}
	if result.Outcome != durableWorkerLoopOutcomeProcessed || result.RunID != "run-loop-queue-timeout" {
		t.Fatalf("loop result = %#v, want worker loop to consume oldest queued run without timeout recovery", result)
	}
	processedRun, err := store.GetRun(ctx, "run-loop-queue-timeout")
	if err != nil {
		t.Fatalf("get processed run: %v", err)
	}
	if processedRun.Status != execution.DurableRunStatusCompleted {
		t.Fatalf("processed run status = %q, want completed", processedRun.Status)
	}
}

func TestDurableWorkerLoopRunKeepsPollingAfterLaneBudgetBackpressure(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	store := execution.NewInMemoryDurableRuntimeStore()
	now := time.Date(2026, 6, 4, 16, 12, 0, 0, time.UTC)
	if err := store.UpsertLaneBudget(ctx, execution.LaneBudget{
		Lane:                   execution.DurableLaneRAG,
		MaxActiveLeases:        1,
		MaxQueuedRuns:          4,
		QueueTimeout:           30 * time.Second,
		RunTimeout:             60 * time.Second,
		LeaseTimeout:           20 * time.Second,
		WorkerHeartbeatTimeout: 45 * time.Second,
		Enabled:                true,
		UpdatedAt:              now,
	}); err != nil {
		t.Fatalf("upsert lane budget: %v", err)
	}
	if err := store.UpsertWorkerHeartbeat(ctx, execution.WorkerHeartbeat{
		WorkerID:       "worker-loop-backpressure-active",
		WorkerKind:     "execution-control",
		Lanes:          []execution.DurableLane{execution.DurableLaneRAG},
		RuntimeVersion: "test",
		Status:         execution.WorkerHeartbeatStatusReady,
		HeartbeatAt:    now,
		StartedAt:      now.Add(-time.Second),
	}); err != nil {
		t.Fatalf("upsert active worker heartbeat: %v", err)
	}
	createHTTPAPIQueuedDurableRunForTest(t, store, "run-loop-backpressure-active", "conv-loop-backpressure-active", now, nil)
	coordinator := execution.NewDurableLeaseCoordinator(store)
	if _, err := coordinator.AcquireNextLease(ctx, execution.NextExecutionLeaseRequest{
		LeaseID:   "lease-loop-backpressure-active",
		StepID:    "handoff:rag-agent:rag_request",
		Lane:      execution.DurableLaneRAG,
		WorkerID:  "worker-loop-backpressure-active",
		Now:       now.Add(time.Second),
		ExpiresAt: now.Add(30 * time.Second),
	}); err != nil {
		t.Fatalf("acquire active lease fixture: %v", err)
	}
	createHTTPAPIQueuedDurableRunForTest(t, store, "run-loop-backpressure-next", "conv-loop-backpressure-next", now.Add(2*time.Second), nil)

	bridgeCalls := make(chan string, 1)
	loop := newDurableWorkerLoop(durableWorkerLoopOptions{
		Store:       store,
		Coordinator: coordinator,
		Bridge: &fakeBridge{
			configured: true,
			executeDurableFn: func(_ context.Context, request bridge.DurableExecutionRequest) (bridge.ExecuteResponse, error) {
				bridgeCalls <- request.RunID
				return bridge.ExecuteResponse{
					StatusCode: 200,
					Kind:       "durable_agent_response",
					Body:       durableAgentResponseBodyForTest("ok"),
				}, nil
			},
		},
		WorkerID:               "worker-loop-backpressure-waiting",
		WorkerKind:             "execution-control",
		Lane:                   execution.DurableLaneRAG,
		StepID:                 "handoff:rag-agent:rag_request",
		LeaseTTL:               20 * time.Second,
		LeaseHeartbeatInterval: 5 * time.Second,
		Now: func() time.Time {
			return time.Now().UTC()
		},
		GenerateLeaseID: sequentialLeaseIDsForTest(
			"lease-loop-backpressure-wait-1",
			"lease-loop-backpressure-wait-2",
			"lease-loop-backpressure-wait-3",
		),
	})

	errCh := make(chan error, 1)
	go func() {
		errCh <- loop.Run(ctx, 10*time.Millisecond)
	}()
	waitForDurableWorkerLoopErrorContaining(t, loop, "lane budget exceeded")
	if _, err := store.ReleaseExecutionLease(
		ctx,
		"lease-loop-backpressure-active",
		"worker-loop-backpressure-active",
		"test_release",
		time.Now().UTC(),
	); err != nil {
		t.Fatalf("release active lease fixture: %v", err)
	}

	select {
	case runID := <-bridgeCalls:
		if runID != "run-loop-backpressure-next" {
			t.Fatalf("bridge run_id = %q, want queued run after backpressure clears", runID)
		}
	case err := <-errCh:
		t.Fatalf("worker loop exited during lane backpressure: %v", err)
	case <-time.After(500 * time.Millisecond):
		t.Fatal("worker loop did not resume after lane backpressure cleared")
	}
	cancel()
	if err := <-errCh; err != nil && !errors.Is(err, context.Canceled) {
		t.Fatalf("worker loop shutdown err = %v, want context canceled", err)
	}
}

func TestDurableWorkerLoopRunOnceFailsClosedWhenBridgeIsMissing(t *testing.T) {
	loop := newDurableWorkerLoop(durableWorkerLoopOptions{
		Store:                  execution.NewInMemoryDurableRuntimeStore(),
		Coordinator:            execution.NewDurableLeaseCoordinator(execution.NewInMemoryDurableRuntimeStore()),
		WorkerID:               "worker-loop-missing-bridge",
		Lane:                   execution.DurableLaneRAG,
		StepID:                 "handoff:rag-agent:rag_request",
		LeaseTTL:               20 * time.Second,
		LeaseHeartbeatInterval: 5 * time.Second,
	})

	_, err := loop.RunOnce(context.Background())
	if err == nil {
		t.Fatal("run worker loop without bridge returned nil error")
	}
	if !errors.Is(err, errDurableWorkerLoopBridgeNotConfigured) {
		t.Fatalf("error = %v, want bridge not configured", err)
	}
}

func TestServerStartDurableWorkerLoopRejectsRetiredMode(t *testing.T) {
	server := NewServerWithDependencies(config.Config{AppName: "campus-agent"}, &fakeBridge{configured: true}, nil, nil, nil)

	err := server.StartDurableWorkerLoop(context.Background())
	if err == nil {
		t.Fatal("start retired durable worker loop returned nil error")
	}
	if !errors.Is(err, errDurableLeaseLoopRetired) {
		t.Fatalf("error = %v, want retired durable loop error", err)
	}
}

func TestServerConfigureDurableWorkerLoopDoesNotStartRetiredMode(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	server := NewServerWithDependencies(config.Config{
		AppName:     "campus-agent",
		LaneBudgets: map[string]config.LaneBudget{"rag": {MaxConcurrent: 1, QueueCapacity: 4, QueueTimeoutMS: 30_000}},
	}, &fakeBridge{
		configured: true,
		executeDurableFn: func(context.Context, bridge.DurableExecutionRequest) (bridge.ExecuteResponse, error) {
			return bridge.ExecuteResponse{
				StatusCode: 200,
				Kind:       "durable_agent_response",
				Body:       durableAgentResponseBodyForTest("ok"),
			}, nil
		},
	}, nil, nil, nil)
	err := server.StartDurableWorkerLoop(ctx)
	if err == nil {
		t.Fatal("start retired durable worker loop returned nil error")
	}
	if !errors.Is(err, errDurableLeaseLoopRetired) {
		t.Fatalf("error = %v, want retired durable loop error", err)
	}
}

func waitForDurableRunStatus(
	t *testing.T,
	store execution.DurableRuntimeStore,
	runID string,
	expected execution.DurableRunStatus,
) {
	t.Helper()
	deadline := time.Now().Add(500 * time.Millisecond)
	var lastStatus execution.DurableRunStatus
	for time.Now().Before(deadline) {
		run, err := store.GetRun(context.Background(), runID)
		if err != nil {
			t.Fatalf("get run: %v", err)
		}
		lastStatus = run.Status
		if run.Status == expected {
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatalf("run status = %q, want %q", lastStatus, expected)
}

func sequentialLeaseIDsForTest(ids ...string) func() string {
	index := 0
	return func() string {
		if index >= len(ids) {
			return ids[len(ids)-1]
		}
		value := ids[index]
		index++
		return value
	}
}

func waitForDurableWorkerLoopErrorContaining(
	t *testing.T,
	loop *durableWorkerLoop,
	expected string,
) {
	t.Helper()
	deadline := time.Now().Add(500 * time.Millisecond)
	for time.Now().Before(deadline) {
		status := loop.Status()
		if strings.Contains(status.LastError, expected) {
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatalf("worker loop did not record error containing %q; status=%#v", expected, loop.Status())
}
