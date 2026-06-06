package httpapi

import (
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/config"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/execution"
)

func TestNewRunProjectionStoreIsNilWhenDatabaseURLIsNotConfigured(t *testing.T) {
	store, err := newRunProjectionStore(config.Config{})
	if err != nil {
		t.Fatalf("new run projection store without database url: %v", err)
	}
	if store != nil {
		t.Fatalf("run projection store = %#v, want nil when database url is not configured", store)
	}
}

func TestNewRunProjectionStoreDoesNotFallbackToWorkflowRunDatabaseURL(t *testing.T) {
	store, err := newRunProjectionStore(config.Config{
		WorkflowRunDatabaseURL: "postgresql://postgres:postgres@127.0.0.1:1/campus_agent",
	})
	if err != nil {
		t.Fatalf("new run projection store with only workflow database url: %v", err)
	}
	if store != nil {
		t.Fatalf("run projection store = %#v, want nil without explicit run projection database url", store)
	}
}

func TestNewRunProjectionStoreReturnsConnectionErrorForExplicitInvalidDatabaseURL(t *testing.T) {
	store, err := newRunProjectionStore(config.Config{
		RunProjectionDatabaseURL: "postgresql://postgres:postgres@127.0.0.1:1/campus_agent",
	})
	if store != nil {
		t.Fatalf("run projection store = %#v, want nil on connection error", store)
	}
	if err == nil {
		t.Fatal("expected explicit invalid run projection database url to fail")
	}
	if !strings.Contains(err.Error(), "run projection") {
		t.Fatalf("error = %v, want run projection context", err)
	}
}

func TestNewServerDoesNotCreateDurableLeaseCoordinatorForOnlineServing(t *testing.T) {
	server := NewServerWithDependencies(config.Config{}, nil, nil, nil, nil)
	if server.runProjectionStore != nil {
		t.Fatalf("run projection store = %#v, want nil without explicit run projection database url", server.runProjectionStore)
	}
}

func TestReadyzReportsRunProjectionStoreStatus(t *testing.T) {
	server := NewServer(config.Config{
		RequestBodyLimitBytes:    1_048_576,
		MaxConcurrentAnswers:     8,
		RunProjectionDatabaseURL: "",
	}, nil)
	server.runProjectionStore = execution.NewInMemoryDurableRuntimeStore()
	response := httptest.NewRecorder()

	server.ServeHTTP(response, newTestRequest(http.MethodGet, "/readyz", nil))

	if response.Code != http.StatusServiceUnavailable {
		t.Fatalf("readyz status = %d, want degraded because bridge is not configured", response.Code)
	}
	body := decodeBody(t, response)
	projection := expectRecord(t, body["run_projection_store"], "run_projection_store")
	if projection["configured"] != true || projection["healthy"] != true {
		t.Fatalf("run_projection_store = %#v, want configured healthy", projection)
	}
}

func TestNewServerDoesNotCreateDurableWorkerLoopForOnlineServing(t *testing.T) {
	server := NewServer(config.Config{}, &fakeBridge{configured: true})

	response := httptest.NewRecorder()
	server.ServeHTTP(response, newTestRequest(http.MethodGet, "/readyz", nil))
	body := decodeBody(t, response)
	if _, ok := body["durable_worker_loop"]; ok {
		t.Fatalf("readyz must not publish retired durable_worker_loop: %#v", body["durable_worker_loop"])
	}
}

func TestStartDurableWorkerLoopRejectsRetiredOnlineServingMode(t *testing.T) {
	server := NewServer(config.Config{
		RunProjectionDatabaseURL:                  "postgresql://postgres:postgres@127.0.0.1:1/campus_agent",
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
	server := NewServer(config.Config{}, &fakeBridge{configured: true})
	if err := server.StartDurableWorkerLoop(t.Context()); !errors.Is(err, errDurableLeaseLoopRetired) {
		t.Fatalf("start durable worker loop error = %v, want retired durable loop error", err)
	}
}
