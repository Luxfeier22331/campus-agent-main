package httpapi

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/config"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/executionapplication"
)

type processReadyStore struct {
	executionapplication.RunStore
	err error
}

func (s processReadyStore) HealthCheck(context.Context) error { return s.err }

func TestProcessReadinessIsIndependentOfExecutionDependencies(t *testing.T) {
	store := processReadyStore{}
	s := NewServerWithOptions(config.Config{DeploymentEnvironment: "staging", AppAPIExecutionSharedSecret: "test-secret"}, ServerOptions{RunProjectionStore: store, RunService: executionapplication.NewRunService(executionapplication.RunServiceOptions{Store: store})})
	check := func(path, secret string, want int) {
		t.Helper()
		request := httptest.NewRequestWithContext(t.Context(), http.MethodGet, path, nil)
		request.Header.Set("x-worker-origin-auth", secret)
		response := httptest.NewRecorder()
		s.ServeHTTP(response, request)
		if response.Code != want {
			t.Fatalf("%s = %d: %s, want %d", path, response.Code, response.Body, want)
		}
	}
	check("/readyz/process", "", http.StatusUnauthorized)
	check("/readyz/process", "test-secret", http.StatusOK)
	check("/readyz", "test-secret", http.StatusServiceUnavailable)
	s.runProjectionStore = processReadyStore{err: errors.New("database unavailable")}
	check("/readyz/process", "test-secret", http.StatusServiceUnavailable)
	s.runProjectionStore = nil
	check("/readyz/process", "test-secret", http.StatusServiceUnavailable)
	s.runProjectionStore = store
	s.StartDraining()
	check("/readyz/process", "test-secret", http.StatusServiceUnavailable)
	check("/healthz", "", http.StatusOK)
}

func TestReadinessRequiresHealthyProjectionStore(t *testing.T) {
	for _, tc := range []struct {
		name       string
		store      executionapplication.RunStore
		storeError error
		configured bool
	}{
		{name: "missing"},
		{name: "initialization failed", storeError: errors.New("invalid database configuration")},
		{name: "unhealthy", store: processReadyStore{err: errors.New("database unavailable")}, configured: true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			server := newReadyServerForTest(t)
			server.runProjectionStore = tc.store
			server.runProjectionStoreErr = tc.storeError
			for _, path := range []string{"/readyz", "/readyz/process"} {
				response := httptest.NewRecorder()
				server.ServeHTTP(response, newTestRequest(http.MethodGet, path, nil))
				if response.Code != http.StatusServiceUnavailable {
					t.Fatalf("%s = %d, want 503: %s", path, response.Code, response.Body)
				}
				store := expectRecord(t, decodeBody(t, response)["run_projection_store"], "run_projection_store")
				if store["configured"] != tc.configured || store["healthy"] != false {
					t.Fatalf("%s store = %#v, want configured=%t and unhealthy", path, store, tc.configured)
				}
			}
		})
	}
}

func TestReadinessDrainingWithHealthyDependencies(t *testing.T) {
	server := newReadyServerForTest(t)
	check := func(path string, want int) {
		t.Helper()
		response := httptest.NewRecorder()
		server.ServeHTTP(response, newTestRequest(http.MethodGet, path, nil))
		if response.Code != want {
			t.Fatalf("%s = %d, want %d: %s", path, response.Code, want, response.Body)
		}
	}
	check("/readyz", http.StatusOK)
	check("/readyz/process", http.StatusOK)
	server.StartDraining()
	server.StartDraining()
	check("/readyz", http.StatusServiceUnavailable)
	check("/readyz/process", http.StatusServiceUnavailable)
	check("/healthz", http.StatusOK)
}
