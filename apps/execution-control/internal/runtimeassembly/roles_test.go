package runtimeassembly

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/config"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/executionapplication"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/memorypersistence"
)

type healthyRoleStore struct{ executionapplication.RunStore }

func (healthyRoleStore) HealthCheck(context.Context) error { return nil }

func TestAPIStartsWithoutTemporalConnectivity(t *testing.T) {
	owner, err := NewAPI(config.Config{TemporalAddress: "127.0.0.1:1", TemporalNamespace: "test"}, nil)
	if err != nil {
		t.Fatal(err)
	}
	owner.Start(t.Context())
	response := httptest.NewRecorder()
	owner.Handler().ServeHTTP(response, httptest.NewRequestWithContext(t.Context(), http.MethodGet, "/healthz", nil))
	if response.Code != http.StatusOK {
		t.Fatalf("health: %d", response.Code)
	}
	if err := owner.Shutdown(t.Context()); err != nil {
		t.Fatal(err)
	}
}

func TestWorkerOnlyExposesHealthAndTracksLocalLifecycle(t *testing.T) {
	runtime := &Runtime{}
	owner := &WorkerOwner{cfg: config.Config{AppAPIExecutionSharedSecret: "secret"}, resources: &resources{runProjectionStore: healthyRoleStore{}, personalMemoryStateStore: memorypersistence.NewInMemoryStateStore()}}
	check := func(path, secret string, want int) {
		t.Helper()
		request := httptest.NewRequestWithContext(t.Context(), http.MethodGet, path, nil)
		request.Header.Set("x-worker-origin-auth", secret)
		response := httptest.NewRecorder()
		owner.Handler(runtime).ServeHTTP(response, request)
		if response.Code != want {
			t.Fatalf("%s = %d, want %d", path, response.Code, want)
		}
	}
	check("/healthz", "", http.StatusOK)
	check("/readyz", "", http.StatusUnauthorized)
	check("/readyz", "secret", http.StatusServiceUnavailable)
	runtime.ready.Store(true)
	check("/readyz", "secret", http.StatusOK)
	check("/internal/execution/requests/example", "secret", http.StatusNotFound)
	runtime.failed.Store(true)
	check("/readyz", "secret", http.StatusServiceUnavailable)
	runtime.failed.Store(false)
	runtime.StartDraining()
	check("/readyz", "secret", http.StatusServiceUnavailable)
	check("/healthz", "", http.StatusOK)
}
