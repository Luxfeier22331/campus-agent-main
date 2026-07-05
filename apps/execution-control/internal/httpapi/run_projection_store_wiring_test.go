package httpapi

import (
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

func TestNewServerDoesNotCreateRetiredPGLeaseCoordinatorForOnlineServing(t *testing.T) {
	server := NewServerWithDependencies(config.Config{}, nil, nil, nil)
	if server.runProjectionStore != nil {
		t.Fatalf("run projection store = %#v, want nil without explicit run projection database url", server.runProjectionStore)
	}
}

func TestReadyzReportsRunProjectionStoreStatus(t *testing.T) {
	server := newServerForTest()
	server.runProjectionStore = execution.NewInMemoryRunProjectionStore()
	response := httptest.NewRecorder()

	server.ServeHTTP(response, newTestRequest(http.MethodGet, "/readyz", nil))

	if response.Code != http.StatusServiceUnavailable {
		t.Fatalf("readyz status = %d, want degraded because Temporal/RAG are not configured", response.Code)
	}
	body := decodeBody(t, response)
	projection := expectRecord(t, body["run_projection_store"], "run_projection_store")
	if projection["configured"] != true || projection["healthy"] != true {
		t.Fatalf("run_projection_store = %#v, want configured healthy", projection)
	}
}

func TestNewServerDoesNotCreateDurableWorkerLoopForOnlineServing(t *testing.T) {
	server := newServerForTest()
	response := httptest.NewRecorder()

	server.ServeHTTP(response, newTestRequest(http.MethodGet, "/readyz", nil))

	body := decodeBody(t, response)
	if _, ok := body["durable_worker_loop"]; ok {
		t.Fatalf("readyz must not publish retired durable_worker_loop: %#v", body["durable_worker_loop"])
	}
	if _, ok := body["workflow_run_runtime"]; ok {
		t.Fatalf("readyz must not publish retired workflow_run_runtime: %#v", body["workflow_run_runtime"])
	}
}
