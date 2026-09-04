package httpapi

import (
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/executionpersistence"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/config"
)

func TestNewServerDoesNotCreateRetiredPGLeaseCoordinatorForOnlineServing(t *testing.T) {
	server := NewServerWithOptions(config.Config{}, ServerOptions{})
	if server.runProjectionStore != nil {
		t.Fatalf("run projection store = %#v, want nil without explicit run projection database url", server.runProjectionStore)
	}
}

func TestReadyzReportsRunProjectionStoreStatus(t *testing.T) {
	server := newServerForTest()
	server.runProjectionStore = executionpersistence.NewInMemoryRunProjectionStore()
	response := httptest.NewRecorder()

	server.ServeHTTP(response, newTestRequest(http.MethodGet, "/readyz", nil))

	if response.Code != http.StatusServiceUnavailable {
		t.Fatalf("readyz status = %d, want unavailable because core Temporal dependencies are not configured", response.Code)
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
