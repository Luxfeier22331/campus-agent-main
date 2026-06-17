package httpapi

import (
	"bytes"
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/ragruntime"
)

func TestProviderConfigCompatibilityEndpointRequiresWorkerAuth(t *testing.T) {
	server := newWorkerAuthServerForTest()
	response := httptest.NewRecorder()

	server.ServeHTTP(
		response,
		newTestRequest(http.MethodPost, "/internal/provider-config/embedding:check-compatibility", strings.NewReader(`{}`)),
	)

	assertError(t, response, http.StatusUnauthorized, "unauthorized")
}

func TestProviderConfigCompatibilityEndpointChecksRAGEmbedding(t *testing.T) {
	checker := &fakeRAGCompatibilityChecker{}
	server := newWorkerAuthServerForTest()
	server.ragLookupExecutor = checker
	server.ragLookupErr = nil
	request := newTestRequest(
		http.MethodPost,
		"/internal/provider-config/embedding:check-compatibility",
		bytes.NewBufferString(`{"role":"rag_query_embedding","provider":"openai","transport":"embeddings","base_url":"https://embedding.example/v1","model":"embedding-model","dimensions":2560,"timeout_ms":30000}`),
	)
	request.Header.Set("x-worker-origin-auth", "secret")
	response := httptest.NewRecorder()

	server.ServeHTTP(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("status = %d body = %s, want 200", response.Code, response.Body.String())
	}
	body := decodeBody(t, response)
	if body["ok"] != true || body["reason"] != "" {
		t.Fatalf("body = %#v, want ok compatibility", body)
	}
	if checker.seen.Model != "embedding-model" || checker.seen.Dimensions != 2560 {
		t.Fatalf("seen snapshot = %#v", checker.seen)
	}
}

func TestProviderConfigCompatibilityEndpointReportsRAGDrift(t *testing.T) {
	server := newWorkerAuthServerForTest()
	server.ragLookupExecutor = &fakeRAGCompatibilityChecker{err: errProviderCompatibilityDriftForTest{}}
	server.ragLookupErr = nil
	request := newTestRequest(
		http.MethodPost,
		"/internal/provider-config/embedding:check-compatibility",
		bytes.NewBufferString(`{"role":"rag_query_embedding","provider":"openai","transport":"embeddings","base_url":"https://embedding.example/v1","model":"embedding-model","dimensions":1536,"timeout_ms":30000}`),
	)
	request.Header.Set("x-worker-origin-auth", "secret")
	response := httptest.NewRecorder()

	server.ServeHTTP(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("status = %d body = %s, want 200", response.Code, response.Body.String())
	}
	body := decodeBody(t, response)
	if body["ok"] != false || !strings.Contains(body["reason"].(string), "release metadata drift") {
		t.Fatalf("body = %#v, want drift blocker", body)
	}
}

type fakeRAGCompatibilityChecker struct {
	err  error
	seen providerConfigSnapshot
}

func (f *fakeRAGCompatibilityChecker) HealthCheck(context.Context) error {
	return nil
}

func (f *fakeRAGCompatibilityChecker) Lookup(
	context.Context,
	ragruntime.PlanProjection,
) (ragruntime.RetrievalLookupResult, error) {
	return ragruntime.RetrievalLookupResult{}, nil
}

func (f *fakeRAGCompatibilityChecker) CheckEmbeddingCompatibility(
	_ context.Context,
	snapshot providerConfigSnapshot,
) error {
	f.seen = snapshot
	return f.err
}

type errProviderCompatibilityDriftForTest struct{}

func (errProviderCompatibilityDriftForTest) Error() string {
	return "release metadata drift for student_rules/r20260615_student_rules"
}
