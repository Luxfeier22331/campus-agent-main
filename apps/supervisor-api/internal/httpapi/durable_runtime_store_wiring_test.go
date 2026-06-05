package httpapi

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/MUC-WIKI/campus-agent/apps/supervisor-api/internal/config"
	"github.com/MUC-WIKI/campus-agent/apps/supervisor-api/internal/execution"
)

func TestNewDurableRuntimeStoreIsNilWhenDatabaseURLIsNotConfigured(t *testing.T) {
	store, err := newDurableRuntimeStore(config.Config{})
	if err != nil {
		t.Fatalf("new durable runtime store without database url: %v", err)
	}
	if store != nil {
		t.Fatalf("durable runtime store = %#v, want nil when database url is not configured", store)
	}
}

func TestNewDurableRuntimeStoreDoesNotFallbackToWorkflowRunDatabaseURL(t *testing.T) {
	store, err := newDurableRuntimeStore(config.Config{
		WorkflowRunDatabaseURL: "postgresql://postgres:postgres@127.0.0.1:1/campus_agent",
	})
	if err != nil {
		t.Fatalf("new durable runtime store with only workflow database url: %v", err)
	}
	if store != nil {
		t.Fatalf("durable runtime store = %#v, want nil without explicit durable runtime database url", store)
	}
}

func TestNewDurableRuntimeStoreReturnsConnectionErrorForExplicitInvalidDatabaseURL(t *testing.T) {
	store, err := newDurableRuntimeStore(config.Config{
		DurableRuntimeDatabaseURL: "postgresql://postgres:postgres@127.0.0.1:1/campus_agent",
	})
	if store != nil {
		t.Fatalf("durable runtime store = %#v, want nil on connection error", store)
	}
	if err == nil {
		t.Fatal("expected explicit invalid durable runtime database url to fail")
	}
	if !strings.Contains(err.Error(), "durable runtime") {
		t.Fatalf("error = %v, want durable runtime context", err)
	}
}

func TestNewServerCreatesDurableLeaseCoordinatorWhenRuntimeStoreIsConfigured(t *testing.T) {
	server := NewServerWithDependencies(config.Config{}, nil, nil, nil, nil)
	if server.durableLeaseCoordinator == nil {
		t.Fatal("durable lease coordinator must be initialized even when store is not configured")
	}
	if server.durableRuntime != nil {
		t.Fatalf("durable runtime store = %#v, want nil without explicit durable runtime database url", server.durableRuntime)
	}
}

func TestReadyzReportsDurableRuntimeStatus(t *testing.T) {
	server := NewServer(config.Config{
		RequestBodyLimitBytes:     1_048_576,
		MaxConcurrentAnswers:      8,
		DurableRuntimeDatabaseURL: "",
	}, nil)
	server.durableRuntime = execution.NewInMemoryDurableRuntimeStore()
	response := httptest.NewRecorder()

	server.ServeHTTP(response, newTestRequest(http.MethodGet, "/readyz", nil))

	if response.Code != http.StatusServiceUnavailable {
		t.Fatalf("readyz status = %d, want degraded because bridge is not configured", response.Code)
	}
	body := decodeBody(t, response)
	durable := expectRecord(t, body["durable_runtime"], "durable_runtime")
	if durable["configured"] != true || durable["healthy"] != true {
		t.Fatalf("durable_runtime = %#v, want configured healthy", durable)
	}
}

func TestNewServerDoesNotCreateDurableWorkerLoopWithoutRuntimeStore(t *testing.T) {
	server := NewServer(config.Config{
		DurableWorkerLoopEnabled:                  true,
		DurableWorkerLoopWorkerID:                 "worker-loop",
		DurableWorkerLoopLane:                     "rag",
		DurableWorkerLoopStepID:                   "handoff:rag-agent:rag_request",
		DurableWorkerLoopPollIntervalMS:           250,
		DurableWorkerLoopLeaseTTLMS:               30_000,
		DurableWorkerLoopLeaseHeartbeatIntervalMS: 5_000,
	}, &fakeBridge{configured: true})

	if server.durableWorkerLoop != nil {
		t.Fatalf("durable worker loop = %#v, want nil when durable runtime store is not configured", server.durableWorkerLoop)
	}
	if server.durableWorkerLoopErr == nil {
		t.Fatal("expected durable worker loop error when enabled without durable runtime store")
	}
}

func TestStartDurableWorkerLoopReturnsDurableRuntimeInitializationError(t *testing.T) {
	server := NewServer(config.Config{
		DurableRuntimeDatabaseURL:                 "postgresql://postgres:postgres@127.0.0.1:1/campus_agent",
		DurableWorkerLoopEnabled:                  true,
		DurableWorkerLoopWorkerID:                 "worker-loop",
		DurableWorkerLoopLane:                     "rag",
		DurableWorkerLoopStepID:                   "handoff:rag-agent:rag_request",
		DurableWorkerLoopPollIntervalMS:           250,
		DurableWorkerLoopLeaseTTLMS:               30_000,
		DurableWorkerLoopLeaseHeartbeatIntervalMS: 5_000,
	}, &fakeBridge{configured: true})

	err := server.StartDurableWorkerLoop(t.Context())
	if err == nil {
		t.Fatal("expected durable runtime initialization error")
	}
	if !strings.Contains(err.Error(), "ping durable runtime postgres") {
		t.Fatalf("error = %v, want durable postgres ping failure", err)
	}
}

func TestNewServerCreatesDurableWorkerLoopWhenRuntimeStoreIsConfigured(t *testing.T) {
	store := execution.NewInMemoryDurableRuntimeStore()
	server := NewServer(config.Config{
		DurableWorkerLoopEnabled:                  true,
		DurableWorkerLoopWorkerID:                 "worker-loop",
		DurableWorkerLoopLane:                     "rag",
		DurableWorkerLoopStepID:                   "handoff:rag-agent:rag_request",
		DurableWorkerLoopPollIntervalMS:           250,
		DurableWorkerLoopLeaseTTLMS:               30_000,
		DurableWorkerLoopLeaseHeartbeatIntervalMS: 5_000,
	}, &fakeBridge{configured: true})
	server.durableRuntime = store
	server.durableLeaseCoordinator = execution.NewDurableLeaseCoordinator(store)
	server.configureDurableWorkerLoop()

	if server.durableWorkerLoop == nil {
		t.Fatal("durable worker loop must be configured when durable runtime store is configured")
	}
	if server.durableWorkerLoopErr != nil {
		t.Fatalf("durable worker loop error = %v", server.durableWorkerLoopErr)
	}
}
