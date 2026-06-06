package httpapi

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/bridge"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/config"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/execution"
)

func TestDurableRecoveryLoopRunOnceExpiresTimedOutRunWithoutWorkerBridge(t *testing.T) {
	ctx := context.Background()
	store := execution.NewInMemoryDurableRuntimeStore()
	now := time.Date(2026, 6, 4, 21, 0, 0, 0, time.UTC)
	if err := store.UpsertLaneBudget(ctx, execution.LaneBudget{
		Lane:                   execution.DurableLaneRAG,
		MaxActiveLeases:        1,
		MaxQueuedRuns:          4,
		QueueTimeout:           time.Second,
		RunTimeout:             10 * time.Second,
		LeaseTimeout:           20 * time.Second,
		WorkerHeartbeatTimeout: 45 * time.Second,
		Enabled:                true,
		UpdatedAt:              now,
	}); err != nil {
		t.Fatalf("upsert lane budget: %v", err)
	}
	createHTTPAPIQueuedDurableRunForTest(t, store, "run-recovery-loop-timeout", "conv-recovery-loop-timeout", now, nil)
	loop := newDurableRecoveryLoop(durableRecoveryLoopOptions{
		Store:            store,
		Coordinator:      execution.NewDurableLeaseCoordinator(store),
		MaxRetryAttempts: 2,
		Now: func() time.Time {
			return now.Add(2 * time.Second)
		},
	})

	result, err := loop.RunOnce(ctx)
	if err != nil {
		t.Fatalf("run recovery loop once: %v", err)
	}
	if result.TimedOutRuns != 1 {
		t.Fatalf("timed out runs = %d, want 1", result.TimedOutRuns)
	}
	if result.ExpiredLeases != 0 {
		t.Fatalf("expired leases = %d, want 0", result.ExpiredLeases)
	}
	run, err := store.GetRun(ctx, "run-recovery-loop-timeout")
	if err != nil {
		t.Fatalf("get run: %v", err)
	}
	if run.Status != execution.DurableRunStatusExpired {
		t.Fatalf("run status = %q, want expired", run.Status)
	}
	if run.TerminalReason != execution.DurableTerminalReasonQueueTimeout {
		t.Fatalf("terminal reason = %q, want queue_timeout", run.TerminalReason)
	}
	status := loop.Status()
	if !status.Started || !status.Healthy || status.LastTimedOutRuns != 1 {
		t.Fatalf("recovery loop status = %#v, want started healthy with timeout count", status)
	}
}

func TestServerStartDurableRecoveryLoopRejectsRetiredOnlineServingMode(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	store := execution.NewInMemoryDurableRuntimeStore()
	now := time.Now().UTC().Add(-time.Second)
	createHTTPAPIQueuedDurableRunForTest(t, store, "run-server-recovery-loop", "conv-server-recovery-loop", now, nil)
	server := NewServerWithDependencies(config.Config{
		AppName:                             "campus-agent",
		LaneBudgets:                         map[string]config.LaneBudget{"rag": {MaxConcurrent: 1, QueueCapacity: 4, QueueTimeoutMS: 1}},
		RequestTimeoutMS:                    60_000,
		DurableRecoveryLoopEnabled:          true,
		DurableRecoveryLoopIntervalMS:       10,
		DurableRecoveryLoopMaxRetryAttempts: 2,
	}, &fakeBridge{configured: true}, nil, nil, nil)
	server.durableRuntime = store
	server.durableLeaseCoordinator = execution.NewDurableLeaseCoordinator(store)
	server.configureDurableRecoveryLoop()

	err := server.StartDurableRecoveryLoop(ctx)
	if err == nil {
		t.Fatal("start retired durable recovery loop returned nil error")
	}
	if !errors.Is(err, errDurableLeaseLoopRetired) {
		t.Fatalf("error = %v, want retired durable loop error", err)
	}
}

func TestReadyzDoesNotPublishRetiredRecoveryLoopStatus(t *testing.T) {
	server := NewServerWithDependencies(config.Config{
		AppName:                             "campus-agent",
		DurableRecoveryLoopEnabled:          true,
		DurableRecoveryLoopIntervalMS:       250,
		DurableRecoveryLoopMaxRetryAttempts: 2,
	}, &fakeBridge{
		configured: true,
		readyz: bridge.ReadyzResponse{
			StatusCode: 200,
			Body:       []byte(`{"status":"ready"}`),
		},
	}, nil, nil, nil)

	response := httptest.NewRecorder()
	server.ServeHTTP(response, newTestRequest(http.MethodGet, "/readyz", nil))
	body := decodeBody(t, response)
	if _, ok := body["durable_recovery_loop"]; ok {
		t.Fatalf("readyz must not publish retired durable_recovery_loop: %#v", body["durable_recovery_loop"])
	}
}
