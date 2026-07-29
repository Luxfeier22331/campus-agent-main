package httpapi

import (
	"bytes"
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
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
	server.documentEvidenceExecutor = checker
	server.documentEvidenceErr = nil
	request := newTestRequest(
		http.MethodPost,
		"/internal/provider-config/embedding:check-compatibility",
		bytes.NewBufferString(`{"kind":"embedding","provider":"openai-compatible","transport":"embeddings","base_url":"https://embedding.example/v1","model":"Qwen3-Embedding-4B","dimensions":2560}`),
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
	if checker.seen.Model != "Qwen3-Embedding-4B" || checker.seen.Dimensions != 2560 {
		t.Fatalf("seen snapshot = %#v", checker.seen)
	}
}

func TestProviderConfigCompatibilityEndpointReportsRAGDrift(t *testing.T) {
	server := newWorkerAuthServerForTest()
	server.documentEvidenceExecutor = &fakeRAGCompatibilityChecker{err: errProviderCompatibilityDriftForTest{}}
	server.documentEvidenceErr = nil
	request := newTestRequest(
		http.MethodPost,
		"/internal/provider-config/embedding:check-compatibility",
		bytes.NewBufferString(`{"kind":"embedding","provider":"openai-compatible","transport":"embeddings","base_url":"https://embedding.example/v1","model":"Qwen3-Embedding-4B","dimensions":2560}`),
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

func TestProviderConfigCompatibilityEndpointRejectsRetiredTimeoutField(t *testing.T) {
	server := newWorkerAuthServerForTest()
	request := newTestRequest(
		http.MethodPost,
		"/internal/provider-config/embedding:check-compatibility",
		bytes.NewBufferString(`{"kind":"embedding","provider":"openai-compatible","transport":"embeddings","base_url":"https://embedding.example/v1","model":"Qwen3-Embedding-4B","dimensions":2560,"timeout_ms":30000}`),
	)
	request.Header.Set("x-worker-origin-auth", "secret")
	response := httptest.NewRecorder()

	server.ServeHTTP(response, request)

	assertError(t, response, http.StatusBadRequest, "invalid_request")
}

type fakeRAGCompatibilityChecker struct {
	err  error
	seen providerConfigSnapshot
}

func (f *fakeRAGCompatibilityChecker) HealthCheck(context.Context) error {
	return nil
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
