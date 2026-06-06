package httpapi

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/MUC-WIKI/campus-agent/apps/supervisor-api/internal/bridge"
	"github.com/MUC-WIKI/campus-agent/apps/supervisor-api/internal/config"
)

func TestReadyzReportsDurableWorkerLoopConfigurationError(t *testing.T) {
	server := NewServer(config.Config{
		AppName:                                   "campus-agent",
		MaxConcurrentAnswers:                      8,
		DurableWorkerLoopEnabled:                  true,
		DurableWorkerLoopWorkerID:                 "worker-loop",
		DurableWorkerLoopLane:                     "rag",
		DurableWorkerLoopStepID:                   "handoff:rag-agent:rag_request",
		DurableWorkerLoopPollIntervalMS:           250,
		DurableWorkerLoopLeaseTTLMS:               30_000,
		DurableWorkerLoopLeaseHeartbeatIntervalMS: 5_000,
		PromptRuntimeProvider:                     "openai-responses",
		SupervisorPromptModel:                     "gpt-supervisor",
		AgentPromptModel:                          "gpt-agent",
		PromptRuntimeAPIKey:                       "test-key",
		PromptRuntimeTransport:                    "responses",
		PromptRuntimeBaseURL:                      "https://api.openai.com/v1",
		PromptStrictStructuredOutputs:             true,
	}, &fakeBridge{
		configured: true,
		readyz: bridge.ReadyzResponse{
			StatusCode: http.StatusOK,
			Body:       json.RawMessage(`{"status":"ready"}`),
		},
	})
	response := httptest.NewRecorder()

	server.ServeHTTP(response, newTestRequest(http.MethodGet, "/readyz", nil))

	if response.Code != http.StatusServiceUnavailable {
		t.Fatalf("status = %d, want 503; body: %s", response.Code, response.Body.String())
	}
	body := decodeBody(t, response)
	workerLoop := expectRecord(t, body["durable_worker_loop"], "durable_worker_loop")
	if workerLoop["enabled"] != true ||
		workerLoop["configured"] != false ||
		workerLoop["healthy"] != false ||
		workerLoop["last_error"] == "" {
		t.Fatalf("durable_worker_loop = %#v, want enabled unconfigured degraded", workerLoop)
	}
}
