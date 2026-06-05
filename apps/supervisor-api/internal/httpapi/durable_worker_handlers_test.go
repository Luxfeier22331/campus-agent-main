package httpapi

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/supervisor-api/internal/bridge"
	"github.com/MUC-WIKI/campus-agent/apps/supervisor-api/internal/config"
	"github.com/MUC-WIKI/campus-agent/apps/supervisor-api/internal/execution"
)

func TestDurableWorkerProcessNextConsumesQueuedRun(t *testing.T) {
	store := execution.NewInMemoryDurableRuntimeStore()
	now := time.Now().UTC()
	prepareHTTPAPIDurableLeaseDependenciesForTest(t, store, execution.DurableLaneRAG, "worker-http", now)
	server := NewServer(config.Config{
		WorkerSharedSecret:    "secret",
		RequestBodyLimitBytes: 1_048_576,
		MaxConcurrentAnswers:  8,
	}, &fakeBridge{
		configured: true,
		executeDurableFn: func(context.Context, bridge.DurableExecutionRequest) (bridge.ExecuteResponse, error) {
			return bridge.ExecuteResponse{
				StatusCode: http.StatusOK,
				Kind:       "durable_agent_response",
				Body:       durableAgentResponseBodyForTest("ok"),
			}, nil
		},
	})
	server.durableRuntime = store
	server.durableLeaseCoordinator = execution.NewDurableLeaseCoordinator(store)
	create := newTestRequest(
		http.MethodPost,
		"/internal/durable/runs",
		strings.NewReader(durableRunCreateBodyForTest("run-process-001", "conv-process-001")),
	)
	create.Header.Set("x-worker-origin-auth", "secret")
	createResponse := httptest.NewRecorder()
	server.ServeHTTP(createResponse, create)
	if createResponse.Code != http.StatusAccepted {
		t.Fatalf("create status = %d; body: %s", createResponse.Code, createResponse.Body.String())
	}

	process := newTestRequest(
		http.MethodPost,
		"/internal/durable/workers/process-next",
		strings.NewReader(`{
			"worker_id":"worker-http",
			"lane":"rag",
			"step_id":"handoff:rag-agent:rag_request",
			"lease_id":"lease-http-process-001",
			"lease_ttl_ms":30000,
			"lease_heartbeat_interval_ms":5000
		}`),
	)
	process.Header.Set("x-worker-origin-auth", "secret")
	processResponse := httptest.NewRecorder()
	server.ServeHTTP(processResponse, process)

	if processResponse.Code != http.StatusOK {
		t.Fatalf("process status = %d; body: %s", processResponse.Code, processResponse.Body.String())
	}
	body := decodeBody(t, processResponse)
	if body["run_id"] != "run-process-001" || body["status"] != "completed" {
		t.Fatalf("process body = %#v", body)
	}
	run, err := store.GetRun(process.Context(), "run-process-001")
	if err != nil {
		t.Fatalf("get run: %v", err)
	}
	if run.Status != execution.DurableRunStatusCompleted {
		t.Fatalf("run status = %q, want completed", run.Status)
	}
}

func TestDurableWorkerProcessNextRequiresExplicitWorkerMetadata(t *testing.T) {
	server := NewServer(config.Config{
		WorkerSharedSecret:    "secret",
		RequestBodyLimitBytes: 1_048_576,
		MaxConcurrentAnswers:  8,
	}, &fakeBridge{configured: true})
	server.durableRuntime = execution.NewInMemoryDurableRuntimeStore()
	server.durableLeaseCoordinator = execution.NewDurableLeaseCoordinator(server.durableRuntime)
	request := newTestRequest(
		http.MethodPost,
		"/internal/durable/workers/process-next",
		strings.NewReader(`{"lane":"rag","step_id":"handoff:rag-agent:rag_request","lease_id":"lease-missing-worker","lease_ttl_ms":30000,"lease_heartbeat_interval_ms":5000}`),
	)
	request.Header.Set("x-worker-origin-auth", "secret")
	response := httptest.NewRecorder()

	server.ServeHTTP(response, request)

	assertError(t, response, http.StatusBadRequest, "invalid_request")
}
