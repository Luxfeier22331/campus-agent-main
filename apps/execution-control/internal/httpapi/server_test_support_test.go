package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/config"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/memoryruntime"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/retrievalruntime"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/temporalruntime"
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
		RAGTopKMax:                  8,
		AppAPIExecutionSharedSecret: "test-execution-input-secret",
	})
}

func newWorkerAuthServerForTest() *Server {
	server := newServerForTest()
	server.config.AppAPIExecutionSharedSecret = "secret"
	return server
}

func delegateAnswerBody(requestID string) io.Reader {
	return strings.NewReader(
		`{"user_goal":"学生手册图书馆开放时间","request_id":"` + requestID + `","scope":"student_rules"}`,
	)
}

type readyTemporalStarter struct {
	readiness temporalruntime.RuntimeReadiness
}

type readyDocumentEvidenceExecutor struct{}

func publicRetrievalAccessProjectionForTest() retrievalruntime.RetrievalAccess {
	return retrievalruntime.RetrievalAccess{
		PolicyProjectionVersion: "phase1-authorization-projection-v1",
		VisibilityLevel:         "public",
	}
}

type readyPersonalMemoryExecutor struct{}

func (readyPersonalMemoryExecutor) ExecuteCommand(
	_ context.Context,
	request memoryruntime.PersonalMemoryCommandRequest,
) (memoryruntime.PersonalMemoryCommandResult, error) {
	return memoryruntime.PersonalMemoryCommandResult{CommandID: request.CommandID, Status: "succeeded"}, nil
}

func (readyPersonalMemoryExecutor) HealthCheck(context.Context) error {
	return nil
}

func (readyPersonalMemoryExecutor) Recall(
	_ context.Context,
	request memoryruntime.RecallRequest,
) (memoryruntime.RecallResult, error) {
	return memoryruntime.FinalizeRecallResult(memoryruntime.RecallResult{
		MemoryRef:     "projection://runs/" + request.RunID + "/memory/recall",
		RunID:         request.RunID,
		SchemaVersion: "memory_recall_result_v1",
		ThreadID:      request.ThreadID,
	})
}

func (readyPersonalMemoryExecutor) AppendConversationTurn(
	_ context.Context,
	request memoryruntime.AppendConversationTurnRequest,
) (memoryruntime.AppendConversationTurnResult, error) {
	return memoryruntime.FinalizeAppendConversationTurnResult(memoryruntime.AppendConversationTurnResult{
		AppendedMessageCount: 1,
		RunID:                request.RunID,
		SchemaVersion:        "memory_conversation_append_result_v2",
		Status:               "completed",
		ThreadID:             request.ThreadID,
		UserID:               request.UserID,
	})
}

func (readyDocumentEvidenceExecutor) HealthCheck(context.Context) error {
	return nil
}

func (readyTemporalStarter) StartToolExecutionWorkflow(
	context.Context,
	temporalruntime.ToolExecutionWorkflowInput,
) (string, error) {
	return "temporal-ready-run", nil
}

func (readyTemporalStarter) StartPersonalMemoryCommandWorkflow(
	context.Context,
	temporalruntime.PersonalMemoryCommandWorkflowInput,
) error {
	return nil
}

func (readyTemporalStarter) CancelToolExecutionWorkflow(
	context.Context,
	temporalruntime.ToolExecutionWorkflowCancelInput,
) error {
	return nil
}

func (starter readyTemporalStarter) CheckReadiness(context.Context) temporalruntime.RuntimeReadiness {
	if starter.readiness.TaskQueues != nil || starter.readiness.LastError != "" {
		return starter.readiness
	}
	return temporalruntime.RuntimeReadiness{
		Healthy: true,
		TaskQueues: []temporalruntime.TaskQueueReadiness{
			{
				Name:    temporalruntime.WorkflowTaskQueue,
				Type:    temporalruntime.TaskQueueTypeWorkflow,
				Pollers: 1,
				Healthy: true,
			},
			{
				Name:    temporalruntime.ActivityTaskQueueCore,
				Type:    temporalruntime.TaskQueueTypeActivity,
				Pollers: 1,
				Healthy: true,
			},
			{
				Name:    temporalruntime.ActivityTaskQueueAgent,
				Type:    temporalruntime.TaskQueueTypeActivity,
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

func markKnowledgeRuntimeReadyForTest(server *Server) {
	server.personalMemoryExecutor = readyPersonalMemoryExecutor{}
	server.personalMemoryErr = nil
	server.documentEvidenceExecutor = readyDocumentEvidenceExecutor{}
	server.documentEvidenceErr = nil
}

func readyServerConfigForTest(t *testing.T, mutators ...func(*config.Config)) config.Config {
	t.Helper()
	agentRuntime := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		if request.URL.Path != "/readyz" {
			t.Fatalf("agent runtime readiness path = %q", request.URL.Path)
		}
		writeJSON(response, http.StatusOK, map[string]any{"status": "ready"})
	}))
	t.Cleanup(agentRuntime.Close)
	cfg := config.Config{
		AppName:                     "campus-agent",
		AgentRuntimeBaseURL:         agentRuntime.URL,
		AgentRuntimeSharedSecret:    "agent-runtime-secret",
		AppAPIExecutionSharedSecret: "test-execution-input-secret",
		MaxConcurrentAnswers:        8,
		RAGTopKMax:                  8,
	}
	for _, mutate := range mutators {
		mutate(&cfg)
	}
	return cfg
}

func newReadyServerForTest(t *testing.T, mutators ...func(*config.Config)) *Server {
	t.Helper()
	server := NewServer(readyServerConfigForTest(t, mutators...))
	server.providerConfigResolver = staticProviderConfigResolver{
		providerConfigKindLLM: primaryAgentProviderConfigSnapshotForTest(),
		providerConfigKindEmbedding: embeddingProviderConfigSnapshotForTest(
			providerConfigKindEmbedding,
			"https://embedding.example/v1",
			"embedding-test",
			2560,
		),
	}
	server.providerConfigErr = nil
	markTemporalReadyForTest(server)
	markKnowledgeRuntimeReadyForTest(server)
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
