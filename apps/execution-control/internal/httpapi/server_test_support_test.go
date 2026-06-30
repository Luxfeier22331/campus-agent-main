package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/config"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/memoryruntime"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/ragruntime"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/temporalruntime"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/toolreadmodel"
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
		RAGSelectedEvidenceMax:          8,
		RAGSynthesisMaxOutputTokens:     900,
		RAGSynthesisReasoningEffort:     "low",
		RAGSynthesisStoreProviderOutput: false,
		RAGSynthesisTextVerbosity:       "low",
		RAGTopKMax:                      8,
	})
}

func newWorkerAuthServerForTest() *Server {
	server := newServerForTest()
	server.config.WorkerSharedSecret = "secret"
	return server
}

func newToolReadModelAuthServerForTest() *Server {
	return NewServer(config.Config{
		InternalQuerySharedSecret:       "query-secret",
		RAGSelectedEvidenceMax:          8,
		RAGSynthesisMaxOutputTokens:     900,
		RAGSynthesisReasoningEffort:     "low",
		RAGSynthesisStoreProviderOutput: false,
		RAGSynthesisTextVerbosity:       "low",
		RAGTopKMax:                      8,
		ToolReadModelTrustedTimeRFC3339: "2026-04-24T10:30:00+08:00",
	})
}

func delegateAnswerBody(requestID string) io.Reader {
	return strings.NewReader(
		`{"user_goal":"学生手册图书馆开放时间","request_id":"` + requestID + `","requested_scope":{"corpus":"regulations","collection":"student_rules"}}`,
	)
}

type readyTemporalStarter struct {
	readiness temporalruntime.RuntimeReadiness
}

type readyRAGLookupExecutor struct{}

type readyPersonalMemoryExecutor struct{}

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

func (readyPersonalMemoryExecutor) OperationStatus(
	_ context.Context,
	request memoryruntime.OperationStatusRequest,
) (memoryruntime.OperationStatusResult, error) {
	return memoryruntime.FinalizeOperationStatusResult(memoryruntime.OperationStatusResult{
		OperationID:   request.OperationID,
		OperationRef:  "projection://runs/" + request.RunID + "/memory/operations/" + request.OperationID,
		OperationType: "retain",
		RunID:         request.RunID,
		SchemaVersion: "memory_operation_status_result_v1",
		Status:        "completed",
		UserID:        request.UserID,
	})
}

func (readyPersonalMemoryExecutor) ListOperations(
	_ context.Context,
	request memoryruntime.OperationListRequest,
) (memoryruntime.OperationListResult, error) {
	return memoryruntime.FinalizeOperationListResult(memoryruntime.OperationListResult{
		RunID:         request.RunID,
		SchemaVersion: "memory_operation_list_result_v1",
		UserID:        request.UserID,
	})
}

func (readyPersonalMemoryExecutor) CancelOperation(
	_ context.Context,
	request memoryruntime.OperationActionRequest,
) (memoryruntime.OperationActionResult, error) {
	return memoryruntime.FinalizeOperationActionResult(memoryruntime.OperationActionResult{
		Action:        "cancel",
		OperationID:   request.OperationID,
		OperationRef:  "projection://runs/" + request.RunID + "/memory/operations/" + request.OperationID,
		RunID:         request.RunID,
		SchemaVersion: "memory_operation_action_result_v1",
		Status:        "accepted",
		Success:       true,
		UserID:        request.UserID,
	})
}

func (readyPersonalMemoryExecutor) RetryOperation(
	_ context.Context,
	request memoryruntime.OperationActionRequest,
) (memoryruntime.OperationActionResult, error) {
	return memoryruntime.FinalizeOperationActionResult(memoryruntime.OperationActionResult{
		Action:        "retry",
		OperationID:   request.OperationID,
		OperationRef:  "projection://runs/" + request.RunID + "/memory/operations/" + request.OperationID,
		RunID:         request.RunID,
		SchemaVersion: "memory_operation_action_result_v1",
		Status:        "accepted",
		Success:       true,
		UserID:        request.UserID,
	})
}

func (readyPersonalMemoryExecutor) Reflect(
	_ context.Context,
	request memoryruntime.ReflectRequest,
) (memoryruntime.ReflectResult, error) {
	return memoryruntime.FinalizeReflectResult(memoryruntime.ReflectResult{
		Provider:      "hindsight",
		ReflectRef:    "projection://runs/" + request.RunID + "/memory/reflect",
		RunID:         request.RunID,
		SchemaVersion: "memory_reflect_result_v1",
		Status:        "completed",
		Text:          "memory reflection",
		ThreadID:      request.ThreadID,
		UserID:        request.UserID,
	})
}

func (readyPersonalMemoryExecutor) AppendConversationTurn(
	_ context.Context,
	request memoryruntime.AppendConversationTurnRequest,
) (memoryruntime.AppendConversationTurnResult, error) {
	return memoryruntime.FinalizeAppendConversationTurnResult(memoryruntime.AppendConversationTurnResult{
		AppendedMessageCount: 1,
		RunID:                request.RunID,
		SchemaVersion:        "memory_conversation_append_result_v1",
		Status:               "completed",
		ThreadID:             request.ThreadID,
		UserID:               request.UserID,
	})
}

func (readyPersonalMemoryExecutor) UpsertProfileMemoryItem(
	_ context.Context,
	request memoryruntime.UpsertProfileMemoryItemRequest,
) (memoryruntime.ProfileMemoryItemResult, error) {
	return memoryruntime.FinalizeProfileMemoryItemResult(memoryruntime.ProfileMemoryItemResult{
		EpisodeUUID:   "episode-" + request.MemoryID,
		MemoryID:      request.MemoryID,
		SchemaVersion: "memory_profile_item_result_v1",
		Status:        "active",
		UpdatedAt:     request.UpdatedAt,
		UserID:        request.UserID,
	})
}

func (readyPersonalMemoryExecutor) DeleteProfileMemoryItem(
	_ context.Context,
	request memoryruntime.DisableProfileMemoryItemRequest,
) (memoryruntime.ProfileMemoryItemResult, error) {
	return memoryruntime.FinalizeProfileMemoryItemResult(memoryruntime.ProfileMemoryItemResult{
		EpisodeUUID:   request.EpisodeUUID,
		MemoryID:      request.MemoryID,
		SchemaVersion: "memory_profile_item_result_v1",
		Status:        "disabled",
		UpdatedAt:     request.UpdatedAt,
		UserID:        request.UserID,
	})
}

func (readyPersonalMemoryExecutor) DeleteProfileMemoryOwner(
	_ context.Context,
	request memoryruntime.DisableProfileMemoryOwnerRequest,
) (memoryruntime.ProfileMemoryOwnerDisableResult, error) {
	return memoryruntime.FinalizeProfileMemoryOwnerDisableResult(memoryruntime.ProfileMemoryOwnerDisableResult{
		SchemaVersion: "memory_profile_owner_disable_result_v1",
		Status:        "disabled",
		UpdatedAt:     request.UpdatedAt,
		UserID:        request.UserID,
	})
}

func (readyRAGLookupExecutor) HealthCheck(context.Context) error {
	return nil
}

func (readyRAGLookupExecutor) Lookup(
	context.Context,
	ragruntime.PlanProjection,
) (ragruntime.RetrievalLookupResult, error) {
	return ragruntime.RetrievalLookupResult{}, nil
}

type readyRAGSynthesisExecutor struct{}

func (readyRAGSynthesisExecutor) HealthCheck(context.Context) error {
	return nil
}

func (readyRAGSynthesisExecutor) ExecuteRAGSynthesis(
	context.Context,
	ragSynthesisPacket,
) (ragSynthesisResult, error) {
	return ragSynthesisResult{}, nil
}

func (readyTemporalStarter) StartToolExecutionWorkflow(
	context.Context,
	temporalruntime.ToolExecutionWorkflowInput,
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
			{
				Name:    temporalruntime.ActivityTaskQueueKnowledge,
				Type:    temporalruntime.TaskQueueTypeActivity,
				Pollers: 1,
				Healthy: true,
			},
			{
				Name:    temporalruntime.ActivityTaskQueueKnowledge,
				Type:    temporalruntime.TaskQueueTypeActivity,
				Pollers: 1,
				Healthy: true,
			},
			{
				Name:    temporalruntime.ActivityTaskQueueKnowledge,
				Type:    temporalruntime.TaskQueueTypeActivity,
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
				Name:    temporalruntime.ActivityTaskQueueCore,
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

func markRAGRuntimeReadyForTest(server *Server) {
	server.personalMemoryExecutor = readyPersonalMemoryExecutor{}
	server.personalMemoryErr = nil
	server.ragLookupExecutor = readyRAGLookupExecutor{}
	server.ragLookupErr = nil
	server.ragSynthesisExecutor = readyRAGSynthesisExecutor{}
	server.ragSynthesisErr = nil
	server.ragVersionResolver = fakeRAGVersionResolver{}
}

func attachReadyRAGVersionResolverForTest(server *Server) {
	server.ragVersionResolver = fakeRAGVersionResolver{}
}

func providerPricingCatalogForTest(t *testing.T) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), "provider-pricing.v1.json")
	body := `{
		"schema_version":"provider-pricing-v1",
		"currency":"USD",
		"models":[{
			"provider":"openai",
			"model":"gpt-5-mini",
			"input_microusd_per_1k_tokens":250,
			"cached_input_microusd_per_1k_tokens":25,
			"output_microusd_per_1k_tokens":2000
		}]
	}`
	if err := os.WriteFile(path, []byte(body), 0o600); err != nil {
		t.Fatalf("write provider pricing catalog: %v", err)
	}
	return path
}

func readyServerConfigForTest(t *testing.T, mutators ...func(*config.Config)) config.Config {
	t.Helper()
	cfg := config.Config{
		AppName:                    "campus-agent",
		MaxConcurrentAnswers:       8,
		ProviderConfigSnapshotPath: writeProviderProjectionForTest(t),
		ProviderPricingPath:        providerPricingCatalogForTest(t),
		RAGSelectedEvidenceMax:     8,
		RAGTopKMax:                 8,
	}
	for _, mutate := range mutators {
		mutate(&cfg)
	}
	return cfg
}

func newReadyServerForTest(t *testing.T, mutators ...func(*config.Config)) *Server {
	t.Helper()
	server := NewServer(readyServerConfigForTest(t, mutators...))
	markTemporalReadyForTest(server)
	markRAGRuntimeReadyForTest(server)
	return server
}

func writeToolReadModelProjectionFixture(t *testing.T, body string) string {
	t.Helper()
	path := t.TempDir() + "/campus-services-projection.json"
	if err := os.WriteFile(path, []byte(body), 0o600); err != nil {
		t.Fatalf("write projection fixture: %v", err)
	}
	return path
}

func useToolReadModelRuntimeFixture(
	t *testing.T,
	server *Server,
	body string,
	trustedTime string,
) {
	t.Helper()
	bundle := decodeProjectionBundleFixture(t, body)
	server.toolReadModel = toolreadmodel.NewRuntime(toolreadmodel.Options{
		TransportScheduleReadModelStore: &fakeStructuredReadModelStore{
			bundle: bundle,
		},
		TrustedTimeRFC3339: trustedTime,
	})
}

func useToolReadModelRuntimeFixtures(
	t *testing.T,
	server *Server,
	transportScheduleBody string,
	trustedTime string,
) {
	t.Helper()
	server.toolReadModel = toolreadmodel.NewRuntime(toolreadmodel.Options{
		TransportScheduleReadModelStore: &fakeStructuredReadModelStore{
			bundle: decodeProjectionBundleFixture(t, transportScheduleBody),
		},
		TrustedTimeRFC3339: trustedTime,
	})
}

func decodeProjectionBundleFixture(t *testing.T, body string) toolreadmodel.ProjectionBundle {
	t.Helper()
	var bundle toolreadmodel.ProjectionBundle
	if err := json.Unmarshal([]byte(body), &bundle); err != nil {
		t.Fatalf("decode projection fixture: %v", err)
	}
	return bundle
}

type fakeStructuredReadModelStore struct {
	bundle             toolreadmodel.ProjectionBundle
	loadCount          int
	projectionReady    bool
	projectionReadySet bool
	projectionReadyErr error
}

func (s *fakeStructuredReadModelStore) HealthCheck(context.Context) error {
	return nil
}

func (s *fakeStructuredReadModelStore) CurrentReleaseID(context.Context) (string, error) {
	return "test-release", nil
}

func (s *fakeStructuredReadModelStore) ProjectionReady(context.Context) (bool, error) {
	if s.projectionReadyErr != nil {
		return false, s.projectionReadyErr
	}
	if s.projectionReadySet {
		return s.projectionReady, nil
	}
	return len(s.bundle.TransportScheduleSnapshots) > 0, nil
}

func (s *fakeStructuredReadModelStore) LoadBundleForRelease(
	context.Context,
	string,
) (toolreadmodel.ProjectionBundle, error) {
	s.loadCount++
	return s.bundle, nil
}

type fakeHealthyNoticeBodyStore struct{}

func (fakeHealthyNoticeBodyStore) HealthCheck(context.Context) error {
	return nil
}

func (fakeHealthyNoticeBodyStore) GetNoticeBody(context.Context, string) (string, error) {
	return "notice body", nil
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
