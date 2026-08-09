package httpapi

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

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

func TestNewRunProjectionStoreDefersConnectionErrorToHealthCheck(t *testing.T) {
	store, err := newRunProjectionStore(config.Config{
		DatabaseURL: "postgresql://postgres:postgres@127.0.0.1:1/campus_agent",
	})
	if err != nil {
		t.Fatalf("new run projection store: %v", err)
	}
	postgresStore, ok := store.(*execution.PostgresRunProjectionStore)
	if !ok {
		t.Fatalf("run projection store = %T, want *execution.PostgresRunProjectionStore", store)
	}
	defer postgresStore.Close()

	ctx, cancel := context.WithTimeout(context.Background(), 100*time.Millisecond)
	defer cancel()
	if err := postgresStore.HealthCheck(ctx); err == nil {
		t.Fatal("HealthCheck returned nil error for unavailable Postgres")
	}
}

func TestNewRunProjectionStoreRejectsMalformedDatabaseURL(t *testing.T) {
	store, err := newRunProjectionStore(config.Config{
		DatabaseURL: "://malformed",
	})
	if store != nil || err == nil {
		t.Fatalf("new run projection store = (%#v, %v), want malformed URL error", store, err)
	}
}

func TestNewServerDoesNotCreateRetiredPGLeaseCoordinatorForOnlineServing(t *testing.T) {
	server := NewServerWithDependencies(config.Config{}, nil, nil)
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
