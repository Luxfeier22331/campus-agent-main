package httpapi

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/providerconfig"
)

type embeddingSnapshotResolverFixture struct {
	setting providerconfig.RuntimeSetting
	err     error
}

func (f embeddingSnapshotResolverFixture) Resolve(
	context.Context,
	providerconfig.Kind,
) (providerconfig.RuntimeSetting, error) {
	return f.setting, f.err
}

func TestEmbeddingProviderSnapshotReturnsOnlyConnectionSnapshot(t *testing.T) {
	handler := &ProviderSnapshotServer{resolver: embeddingSnapshotResolverFixture{
		setting: providerconfig.RuntimeSetting{
			APIKey: "embedding-secret", BaseURL: "https://embedding.example/v1",
			Kind: providerconfig.KindEmbedding, Model: providerconfig.CanonicalEmbeddingModel,
			Provider: providerconfig.CanonicalEmbeddingProvider, Transport: providerconfig.CanonicalEmbeddingTransport,
		},
	}}
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, httptest.NewRequestWithContext(
		t.Context(),
		http.MethodGet,
		embeddingProviderSnapshotPath,
		nil,
	))

	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", response.Code)
	}
	if response.Header().Get("Cache-Control") != "no-store" {
		t.Fatalf("Cache-Control = %q, want no-store", response.Header().Get("Cache-Control"))
	}
	body := decodeBody(t, response)
	if len(body) != 5 || body["schema_version"] != "embedding_provider_snapshot.v1" ||
		body["provider"] != "openai-compatible" || body["base_url"] != "https://embedding.example/v1" ||
		body["model"] != providerconfig.CanonicalEmbeddingModel || body["api_key"] != "embedding-secret" {
		t.Fatalf("snapshot body = %#v", body)
	}
	if body["dimensions"] != nil || body["embedding_space_id"] != nil || body["transport"] != nil {
		t.Fatalf("snapshot contains non-connection fields: %#v", body)
	}
}

func TestEmbeddingProviderSnapshotRejectsModelDrift(t *testing.T) {
	handler := &ProviderSnapshotServer{resolver: embeddingSnapshotResolverFixture{
		setting: providerconfig.RuntimeSetting{
			APIKey: "embedding-secret", BaseURL: "https://embedding.example/v1",
			Kind: providerconfig.KindEmbedding, Model: "operator-selected-model",
			Provider: providerconfig.CanonicalEmbeddingProvider, Transport: providerconfig.CanonicalEmbeddingTransport,
		},
	}}
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, httptest.NewRequestWithContext(
		t.Context(), http.MethodGet, embeddingProviderSnapshotPath, nil,
	))
	assertError(t, response, http.StatusServiceUnavailable, "embedding_provider_unavailable")
}

func TestEmbeddingProviderSnapshotRejectsOtherRoutes(t *testing.T) {
	handler := &ProviderSnapshotServer{}
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, httptest.NewRequestWithContext(
		t.Context(),
		http.MethodGet,
		"/healthz",
		nil,
	))
	assertError(t, response, http.StatusNotFound, "not_found")
}

func TestNoticeClassifierProviderSnapshotReturnsConfiguredTransport(t *testing.T) {
	handler := &ProviderSnapshotServer{resolver: embeddingSnapshotResolverFixture{
		setting: providerconfig.RuntimeSetting{
			APIKey: "classifier-secret", BaseURL: "https://classifier.example/v1",
			Kind: providerconfig.KindNoticeClassifier, Model: "classifier-model",
			Provider: "openai-compatible", Transport: "chat_completions",
		},
	}}
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, httptest.NewRequestWithContext(
		t.Context(), http.MethodGet, noticeClassifierProviderSnapshotPath, nil,
	))
	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", response.Code)
	}
	body := decodeBody(t, response)
	if body["schema_version"] != "notice_classifier_provider_snapshot.v1" ||
		body["transport"] != "chat_completions" || body["model"] != "classifier-model" ||
		body["api_key"] != "classifier-secret" {
		t.Fatalf("snapshot body = %#v", body)
	}
}
