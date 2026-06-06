package httpapi

import (
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/MUC-WIKI/campus-agent/apps/execution-gateway/internal/config"
	"github.com/MUC-WIKI/campus-agent/apps/execution-gateway/internal/execution"
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

func TestNewServerDoesNotCreateDurableLeaseCoordinatorForOnlineServing(t *testing.T) {
	server := NewServerWithDependencies(config.Config{}, nil, nil, nil, nil)
	if server.durableLeaseCoordinator != nil {
		t.Fatal("durable lease coordinator must not be initialized for Temporal online serving")
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

func TestNewServerDoesNotCreateDurableWorkerLoopForOnlineServing(t *testing.T) {
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
		t.Fatalf("durable worker loop = %#v, want nil for Temporal online serving", server.durableWorkerLoop)
	}
	if server.durableWorkerLoopErr != nil {
		t.Fatalf("durable worker loop error = %v, want nil because server wiring ignores retired loop", server.durableWorkerLoopErr)
	}
}

func TestStartDurableWorkerLoopRejectsRetiredOnlineServingMode(t *testing.T) {
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
		t.Fatal("start retired durable worker loop returned nil error")
	}
	if !errors.Is(err, errDurableLeaseLoopRetired) {
		t.Fatalf("error = %v, want retired durable loop error", err)
	}
}

func TestConfigureDurableWorkerLoopDoesNotReintroduceOnlineServingLoop(t *testing.T) {
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

	if server.durableWorkerLoop != nil {
		t.Fatalf("durable worker loop = %#v, want nil for Temporal online serving", server.durableWorkerLoop)
	}
	if server.durableWorkerLoopErr != nil {
		t.Fatalf("durable worker loop error = %v, want nil", server.durableWorkerLoopErr)
	}
}
