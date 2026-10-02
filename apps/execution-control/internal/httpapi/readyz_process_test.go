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
