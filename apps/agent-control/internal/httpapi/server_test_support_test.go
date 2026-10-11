package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/MUC-WIKI/campus-agent/apps/agent-control/internal/config"
	"github.com/MUC-WIKI/campus-agent/apps/agent-control/internal/execution"
	"github.com/MUC-WIKI/campus-agent/apps/agent-control/internal/executionapplication"
	"github.com/MUC-WIKI/campus-agent/apps/agent-control/internal/executionpersistence"
)

type failingReadCloser struct{}

func (failingReadCloser) Read(_ []byte) (int, error) {
	return 0, errors.New("read failed")
}

func (failingReadCloser) Close() error {
	return nil
}

func newTestRequest(method string, target string, body io.Reader) *http.Request {
	return httptest.NewRequestWithContext(context.Background(), method, target, body)
}

func newServerForTest() *Server {
	return NewServer(config.Config{
		IngressSharedSecret: "test-execution-input-secret", AppAPIExecutionSharedSecret: "test-execution-input-secret",
	})
}

func newWorkerAuthServerForTest() *Server {
	server := newServerForTest()
	server.config.IngressSharedSecret = "secret"
	return server
}

type readyTemporalStarter struct {
	readiness executionapplication.RuntimeReadiness
}

func (readyTemporalStarter) StartToolExecutionWorkflow(
	context.Context,
	execution.WorkflowStartInput,
) (string, error) {
	return "temporal-ready-run", nil
}

func (readyTemporalStarter) CancelToolExecutionWorkflow(
	context.Context,
	execution.WorkflowCancelInput,
) error {
	return nil
}

func (starter readyTemporalStarter) CheckReadiness(context.Context) executionapplication.RuntimeReadiness {
	if starter.readiness.TaskQueues != nil || starter.readiness.LastError != "" {
		return starter.readiness
	}
	return executionapplication.RuntimeReadiness{
		Healthy: true,
		TaskQueues: []executionapplication.TaskQueueReadiness{
			{
				Name:    "campus-agent.agent.workflow.v1",
				Type:    "workflow",
				Pollers: 1,
				Healthy: true,
			},
			{
				Name:    "campus-agent.agent.tool.v1",
				Type:    "activity",
				Pollers: 1,
				Healthy: true,
			},
			{
				Name:    "campus-agent.agent.model.v1",
				Type:    "activity",
				Pollers: 1,
				Healthy: true,
			},
		},
	}
}

func markTemporalReadyForTest(server *Server) {
	server.temporalStarter = readyTemporalStarter{}
	server.temporalStarterErr = nil
}

func readyServerConfigForTest(t *testing.T, mutators ...func(*config.Config)) config.Config {
	t.Helper()
	agentRuntime := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		if request.URL.Path != "/internal/readyz" {
			t.Fatalf("agent runtime readiness path = %q", request.URL.Path)
		}
		if got := request.Header.Get("authorization"); got != "Bearer agent-runtime-secret" {
			t.Fatalf("agent runtime readiness authorization = %q", got)
		}
		writeJSON(response, http.StatusOK, map[string]any{"status": "ready"})
	}))
	t.Cleanup(agentRuntime.Close)
	cfg := config.Config{
		AppName:                  "campus-agent",
		AgentRuntimeBaseURL:      agentRuntime.URL,
		AgentRuntimeSharedSecret: "agent-runtime-secret",
		IngressSharedSecret:      "test-execution-input-secret", AppAPIExecutionSharedSecret: "test-execution-input-secret",
	}
	for _, mutate := range mutators {
		mutate(&cfg)
	}
	return cfg
}

func newReadyServerForTest(t *testing.T, mutators ...func(*config.Config)) *Server {
	t.Helper()
	store := executionpersistence.NewInMemoryRunProjectionStore()
	server := NewServerWithOptions(readyServerConfigForTest(t, mutators...), ServerOptions{
		RunProjectionStore: store,
		RunService:         executionapplication.NewRunService(executionapplication.RunServiceOptions{Store: store}),
	})
	markTemporalReadyForTest(server)
	return server
}

func anySlice(values []string) []any {
	result := make([]any, 0, len(values))
	for _, value := range values {
		result = append(result, value)
	}
	return result
}

func containsStringValue(values []any, want string) bool {
	for _, value := range values {
		if text, ok := value.(string); ok && text == want {
			return true
		}
	}
	return false
}

func decodeBody(t *testing.T, response *httptest.ResponseRecorder) map[string]any {
	t.Helper()
	return decodeJSONRecord(t, response.Body.Bytes())
}

func decodeJSONRecord(t *testing.T, rawBody []byte) map[string]any {
	t.Helper()

	var body map[string]any
	if err := json.Unmarshal(rawBody, &body); err != nil {
		t.Fatalf("response body is not JSON: %v", err)
	}
	return body
}

func expectRecord(t *testing.T, value any, name string) map[string]any {
	t.Helper()
	record, ok := value.(map[string]any)
	if !ok {
		t.Fatalf("%s missing or wrong type: %#v", name, value)
	}
	return record
}

func assertError(t *testing.T, response *httptest.ResponseRecorder, status int, code string) {
	t.Helper()

	if response.Code != status {
		t.Fatalf("status = %d, want %d; body: %s", response.Code, status, response.Body.String())
	}
	body := decodeBody(t, response)
	errorBody := expectRecord(t, body["error"], "error")
	if errorBody["code"] != code {
		t.Fatalf("error code = %v, want %s", errorBody["code"], code)
	}
}

type trackingResponseWriter struct {
	header http.Header
	status int
	wrote  bool
}

func newTrackingResponseWriter() *trackingResponseWriter {
	return &trackingResponseWriter{
		header: make(http.Header),
	}
}

func (w *trackingResponseWriter) Header() http.Header {
	return w.header
}

func (w *trackingResponseWriter) Write(body []byte) (int, error) {
	if !w.wrote {
		w.WriteHeader(http.StatusOK)
	}
	return len(body), nil
}

func (w *trackingResponseWriter) WriteHeader(status int) {
	w.status = status
	w.wrote = true
}
