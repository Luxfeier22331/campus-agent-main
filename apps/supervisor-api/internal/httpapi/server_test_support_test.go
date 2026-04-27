package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"

	"github.com/MUC-WIKI/campus-agent/apps/supervisor-api/internal/bridge"
	"github.com/MUC-WIKI/campus-agent/apps/supervisor-api/internal/structuredquery"
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
	configured bool
	response   bridge.ExecuteResponse
	readyz     bridge.ReadyzResponse
	executeErr error
	readyzErr  error
	seen       bridge.Request
	executeFn  func(context.Context, bridge.Request) (bridge.ExecuteResponse, error)
	cancelFn   func(context.Context, bridge.CancelRequest) (bridge.CancelResponse, error)
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
	bundle structuredquery.ProjectionBundle
}

func (s *fakeStructuredReadModelStore) HealthCheck(context.Context) error {
	return nil
}

func (s *fakeStructuredReadModelStore) CurrentReleaseID(context.Context) (string, error) {
	return "test-release", nil
}

func (s *fakeStructuredReadModelStore) LoadBundleForRelease(
	context.Context,
	string,
) (structuredquery.ProjectionBundle, error) {
	return s.bundle, nil
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
