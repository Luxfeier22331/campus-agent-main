package httpapi

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/bridge"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/config"
)

func TestReadyzReportsTemporalWorkerNotStarted(t *testing.T) {
	server := NewServer(config.Config{
		AppName:                       "campus-agent",
		MaxConcurrentAnswers:          8,
		TemporalAddress:               "127.0.0.1:7233",
		TemporalNamespace:             "campus-agent-test",
		TemporalTaskQueue:             "campus-agent.workflow",
		TemporalWorkerIdentity:        "test:execution-control:readyz",
		PromptRuntimeProvider:         "openai",
		SupervisorPromptModel:         "gpt-5-mini",
		AgentPromptModel:              "gpt-5-mini",
		PromptRuntimeAPIKey:           "test-key",
		PromptRuntimeTransport:        "responses",
		PromptRuntimeBaseURL:          "https://api.openai.com/v1",
		ProviderPricingPath:           providerPricingCatalogForTest(t),
		PromptStrictStructuredOutputs: true,
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
		t.Fatalf("status = %d, want 503, body: %s", response.Code, response.Body.String())
	}
	body := decodeBody(t, response)
	temporalRuntime := expectRecord(t, body["temporal_runtime"], "temporal_runtime")
	if temporalRuntime["configured"] != true ||
		temporalRuntime["healthy"] != false ||
		temporalRuntime["last_error"] == "" {
		t.Fatalf("temporal_runtime = %#v, want unstarted degraded", temporalRuntime)
	}
}
