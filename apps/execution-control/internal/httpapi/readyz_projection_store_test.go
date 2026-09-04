package httpapi

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/config"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/temporalruntime"
)

func TestReadyzReportsTemporalWorkerNotStarted(t *testing.T) {
	cfg := readyServerConfigForTest(t, func(cfg *config.Config) {
		cfg.TemporalAddress = "127.0.0.1:7233"
		cfg.TemporalNamespace = "campus-agent-test"
		cfg.TemporalTaskQueue = "campus-agent.workflow"
		cfg.TemporalWorkerIdentity = "test:execution-control:readyz"
	})
	server := NewServerWithOptions(cfg, ServerOptions{
		TemporalStarter: readyTemporalStarter{readiness: temporalruntime.RuntimeReadiness{
			Healthy:   false,
			LastError: "temporal worker not started",
		}},
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
