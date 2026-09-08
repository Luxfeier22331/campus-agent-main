//go:build temporal_integration

package execution_http_test

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/integration/httpapitest"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/config"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/execution"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/executionapplication"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/httpapi"
)

type fakeRunCommands struct{}

func (fakeRunCommands) StoreConfigured() bool { return true }
func (fakeRunCommands) CreateRun(context.Context, executionapplication.CreateRunRequest) (execution.DurableRunCreateResult, error) {
	return execution.DurableRunCreateResult{Run: execution.DurableRun{RequestID: "run-http-boundary", Status: execution.DurableRunStatusQueued}}, nil
}
func (fakeRunCommands) RequestRunCancellation(context.Context, executionapplication.RequestRunCancellationRequest) (execution.DurableRun, error) {
	return execution.DurableRun{RequestID: "run-http-boundary", Status: execution.DurableRunStatusQueued}, nil
}

// This package is the owner for HTTP/Temporal integration coverage. The
// boundary test intentionally uses the public HTTP surface and does not reach
// into httpapi's test-only helpers.
func TestExecutionHTTPRequiresWorkerOriginAuthentication(t *testing.T) {
	server := httpapi.NewServer(config.Config{AppAPIExecutionSharedSecret: "secret"})
	response := httptest.NewRecorder()
	request := httptest.NewRequestWithContext(t.Context(), http.MethodPost, "/internal/execution/requests", nil)
	server.ServeHTTP(response, request)
	if response.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want %d", response.Code, http.StatusUnauthorized)
	}
}

func TestExecutionHTTPDelegatesValidCreateToApplicationPort(t *testing.T) {
	server := httpapi.NewServerWithOptions(config.Config{AppAPIExecutionSharedSecret: "secret"}, httpapi.ServerOptions{RunService: fakeRunCommands{}})
	req := httpapitest.ExecutionCreateRequest(t.Context(), "run-http-boundary", "conv-http-boundary", "secret")
	resp := httptest.NewRecorder()
	server.ServeHTTP(resp, req)
	if resp.Code != http.StatusAccepted {
		t.Fatalf("status = %d, body = %s", resp.Code, resp.Body.String())
	}
}
