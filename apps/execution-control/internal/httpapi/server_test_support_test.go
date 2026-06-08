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

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/bridge"
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

func delegateAnswerBody(requestID string) io.Reader {
	return strings.NewReader(
		`{"user_goal":"学生手册图书馆开放时间","request_id":"` + requestID + `","requested_scope":{"corpus":"regulations","collection":"student_rules"}}`,
	)
}

type fakeBridge struct {
	configured        bool
	response          bridge.ExecuteResponse
	readyz            bridge.ReadyzResponse
	executeErr        error
	readyzErr         error
	seen              bridge.Request
	seenSemantic      bridge.SemanticExecutionRequest
	executeFn         func(context.Context, bridge.Request) (bridge.ExecuteResponse, error)
	executeSemanticFn func(context.Context, bridge.SemanticExecutionRequest) (bridge.ExecuteResponse, error)
	cancelFn          func(context.Context, bridge.CancelRequest) (bridge.CancelResponse, error)
}

type readyTemporalStarter struct {
	readiness temporalruntime.RuntimeReadiness
}

func (readyTemporalStarter) StartChatAnswerWorkflow(
	context.Context,
	temporalruntime.ChatAnswerWorkflowInput,
) error {
	return nil
}

func (readyTemporalStarter) CancelChatAnswerWorkflow(
	context.Context,
	temporalruntime.ChatAnswerWorkflowCancelInput,
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
				Name:    temporalruntime.ActivityTaskQueueRAG,
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

var _ bridge.Client = (*fakeBridge)(nil)

func (f *fakeBridge) Configured() bool {
	return f.configured
}

func (f *fakeBridge) Execute(ctx context.Context, request bridge.Request) (bridge.ExecuteResponse, error) {
	f.seen = request
	if f.executeFn != nil {
		return f.executeFn(ctx, request)
	}
	if f.executeErr != nil {
		return bridge.ExecuteResponse{}, f.executeErr
	}
	return f.response, nil
}

func (f *fakeBridge) ExecuteSemantic(
	ctx context.Context,
	request bridge.SemanticExecutionRequest,
) (bridge.ExecuteResponse, error) {
	f.seenSemantic = request
	if f.executeSemanticFn != nil {
		return f.executeSemanticFn(ctx, request)
	}
	return bridge.ExecuteResponse{}, errors.New("unexpected semantic bridge execution")
}

func (f *fakeBridge) Readyz(_ context.Context) (bridge.ReadyzResponse, error) {
	if f.readyzErr != nil {
		return bridge.ReadyzResponse{}, f.readyzErr
	}
	return f.readyz, nil
}

func (f *fakeBridge) Cancel(ctx context.Context, request bridge.CancelRequest) (bridge.CancelResponse, error) {
	if f.cancelFn != nil {
		return f.cancelFn(ctx, request)
	}
	return bridge.CancelResponse{
		StatusCode: http.StatusNotFound,
		Body:       json.RawMessage(`{"error":{"code":"execution_not_found"}}`),
	}, nil
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
