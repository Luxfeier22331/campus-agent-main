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
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/structuredquery"
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
	return NewServer(config.Config{})
}

func newWorkerAuthServerForTest() *Server {
	server := newServerForTest()
	server.config.WorkerSharedSecret = "secret"
	return server
}

func newStructuredQueryAuthServerForTest() *Server {
	return NewServer(config.Config{
		InternalQuerySharedSecret:         "query-secret",
		StructuredQueryTrustedTimeRFC3339: "2026-04-24T10:30:00+08:00",
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

func (readyPersonalMemoryExecutor) EnsureSchema(context.Context) error {
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
	})
}

func (readyPersonalMemoryExecutor) Upsert(
	_ context.Context,
	request memoryruntime.UpsertRequest,
) (memoryruntime.UpsertResult, error) {
	return memoryruntime.NormalizeUpsertResult(request), nil
}

func (readyPersonalMemoryExecutor) Disable(
	_ context.Context,
	request memoryruntime.DisableRequest,
) (memoryruntime.UpsertResult, error) {
	return memoryruntime.UpsertResult{
		MemoryID:      request.MemoryID,
		PointID:       memoryruntime.PointID(request.UserID, request.MemoryID),
		SchemaVersion: "personal_memory_upsert_result_v1",
		Status:        "disabled",
		UpdatedAt:     request.UpdatedAt,
	}, nil
}

func (readyPersonalMemoryExecutor) DisableOwner(
	_ context.Context,
	request memoryruntime.DisableOwnerRequest,
) (memoryruntime.DisableOwnerResult, error) {
	return memoryruntime.DisableOwnerResult{
		SchemaVersion: "personal_memory_owner_disable_result_v1",
		Status:        "disabled",
		UpdatedAt:     request.UpdatedAt,
		UserID:        request.UserID,
	}, nil
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

func (readyTemporalStarter) StartCapabilityExecutionWorkflow(
	context.Context,
	temporalruntime.CapabilityExecutionWorkflowInput,
) error {
	return nil
}

func (readyTemporalStarter) CancelCapabilityExecutionWorkflow(
	context.Context,
	temporalruntime.CapabilityExecutionWorkflowCancelInput,
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
				Name:    temporalruntime.ActivityTaskQueueContext,
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
				Name:    temporalruntime.ActivityTaskQueueFinalization,
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
		AppName:                       "campus-agent",
		MaxConcurrentAnswers:          8,
		PromptRuntimeProvider:         "openai",
		AgentPromptModel:              "gpt-5-mini",
		PromptRuntimeAPIKey:           "test-key",
		PromptRuntimeTransport:        "responses",
		PromptRuntimeBaseURL:          "https://api.openai.com/v1",
		ProviderPricingPath:           providerPricingCatalogForTest(t),
		PromptStrictStructuredOutputs: true,
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

func writeStructuredQueryProjectionFixture(t *testing.T, body string) string {
	t.Helper()
	path := t.TempDir() + "/campus-services-projection.json"
	if err := os.WriteFile(path, []byte(body), 0o600); err != nil {
		t.Fatalf("write projection fixture: %v", err)
	}
	return path
}

func useStructuredQueryRuntimeFixture(
	t *testing.T,
	server *Server,
	body string,
	trustedTime string,
) {
	t.Helper()
	bundle := decodeProjectionBundleFixture(t, body)
	server.structuredQuery = structuredquery.NewRuntime(structuredquery.Options{
		ServiceStatusReadModelStore: &fakeStructuredReadModelStore{
			bundle: bundle,
		},
		TransportScheduleReadModelStore: &fakeStructuredReadModelStore{
			bundle: bundle,
		},
		ServiceGuideReadModelStore: &fakeStructuredReadModelStore{
			bundle: bundle,
		},
		ContactDirectoryReadModelStore: &fakeStructuredReadModelStore{
			bundle: bundle,
		},
		AcademicCalendarReadModelStore: &fakeStructuredReadModelStore{
			bundle: bundle,
		},
		TrustedTimeRFC3339: trustedTime,
	})
}

func useStructuredQueryRuntimeFixtures(
	t *testing.T,
	server *Server,
	serviceStatusBody string,
	transportScheduleBody string,
	serviceGuideBody string,
	trustedTime string,
) {
	t.Helper()
	server.structuredQuery = structuredquery.NewRuntime(structuredquery.Options{
		ServiceStatusReadModelStore: &fakeStructuredReadModelStore{
			bundle: decodeProjectionBundleFixture(t, serviceStatusBody),
		},
		TransportScheduleReadModelStore: &fakeStructuredReadModelStore{
			bundle: decodeProjectionBundleFixture(t, transportScheduleBody),
		},
		ServiceGuideReadModelStore: &fakeStructuredReadModelStore{
			bundle: decodeProjectionBundleFixture(t, serviceGuideBody),
		},
		ContactDirectoryReadModelStore: &fakeStructuredReadModelStore{
			bundle: decodeProjectionBundleFixture(t, serviceGuideBody),
		},
		AcademicCalendarReadModelStore: &fakeStructuredReadModelStore{
			bundle: decodeProjectionBundleFixture(t, serviceGuideBody),
		},
		TrustedTimeRFC3339: trustedTime,
	})
}

func decodeProjectionBundleFixture(t *testing.T, body string) structuredquery.ProjectionBundle {
	t.Helper()
	var bundle structuredquery.ProjectionBundle
	if err := json.Unmarshal([]byte(body), &bundle); err != nil {
		t.Fatalf("decode projection fixture: %v", err)
	}
	return bundle
}

type fakeStructuredReadModelStore struct {
	bundle             structuredquery.ProjectionBundle
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
	return len(s.bundle.ServiceStatusRecords) > 0 ||
		len(s.bundle.TransportScheduleSnapshots) > 0 ||
		len(s.bundle.ServiceGuideRecords) > 0 ||
		len(s.bundle.ContactDirectoryRecords) > 0 ||
		len(s.bundle.AcademicCalendarRecords) > 0, nil
}

func (s *fakeStructuredReadModelStore) LoadBundleForRelease(
	context.Context,
	string,
) (structuredquery.ProjectionBundle, error) {
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
