package httpapi

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

func TestQdrantDocumentEvidenceEmbeddingFailsClosedWithoutProviderResolver(t *testing.T) {
	executor := qdrantDocumentEvidenceExecutor{
		embeddingHTTPClient: http.DefaultClient,
		timeout:             time.Second,
	}
	_, err := executor.embedQuery(context.Background(), "学生请假手续")
	if err == nil {
		t.Fatal("online RAG lookup embedding must require active provider config resolver")
	}
	if !strings.Contains(err.Error(), "provider config resolver is not configured") {
		t.Fatalf("error = %v, want provider resolver diagnostic", err)
	}
}

func TestQdrantDocumentEvidenceEmbeddingUsesActiveProviderSnapshot(t *testing.T) {
	var captured map[string]any
	var authorization string
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		authorization = request.Header.Get("authorization")
		if err := json.NewDecoder(request.Body).Decode(&captured); err != nil {
			t.Fatalf("decode embedding request: %v", err)
		}
		response.Header().Set("content-type", "application/json")
		_, _ = response.Write([]byte(`{"data":[{"embedding":[0.1,0.2,0.3]}]}`))
	}))
	defer server.Close()
	executor := qdrantDocumentEvidenceExecutor{
		configResolver: staticProviderConfigResolver{
			providerConfigKindEmbedding: {
				APIKey:     "snapshot-embedding-key",
				BaseURL:    server.URL,
				Dimensions: 3,
				Kind:       providerConfigKindEmbedding,
				Model:      "snapshot-embedding-model",
				Provider:   "openai-compatible",
				Transport:  "embeddings",
			},
		},
		embeddingHTTPClient: server.Client(),
		embeddingKind:       providerConfigKindEmbedding,
		timeout:             time.Second,
	}

	embedding, err := executor.embedQuery(context.Background(), "学生请假手续")
	if err != nil {
		t.Fatalf("embed query: %v", err)
	}
	if len(embedding) != 3 {
		t.Fatalf("embedding dim = %d, want snapshot dim 3", len(embedding))
	}
	if authorization != "Bearer snapshot-embedding-key" {
		t.Fatalf("authorization = %q, want snapshot key", authorization)
	}
	if captured["model"] != "snapshot-embedding-model" || captured["dimensions"] != float64(3) {
		t.Fatalf("embedding request = %#v", captured)
	}
}

func TestQdrantDocumentEvidenceEmbeddingUsesAdmittedProviderHash(t *testing.T) {
	pinned := embeddingProviderConfigSnapshotForTest(
		providerConfigKindEmbedding,
		"https://embedding-pinned.example/v1",
		"embedding-pinned",
		2560,
	)
	resolver := staticProviderConfigResolver{providerConfigKindEmbedding: pinned}
	executor := qdrantDocumentEvidenceExecutor{
		configResolver: resolver,
		embeddingKind:  providerConfigKindEmbedding,
	}
	pin := providerConfigAdmissionPin{
		ConfigSHA256: providerConfigAdmissionHash(pinned),
	}

	resolved, err := executor.resolveEmbeddingProviderConfig(context.Background(), pin)
	if err != nil {
		t.Fatalf("resolve admitted embedding provider: %v", err)
	}
	if resolved.Model != pinned.Model || resolved.Kind != providerConfigKindEmbedding {
		t.Fatalf("resolved provider = %#v, want admitted setting", resolved)
	}

	pin.ConfigSHA256 = strings.Repeat("0", 64)
	if _, err := executor.resolveEmbeddingProviderConfig(context.Background(), pin); err == nil ||
		!strings.Contains(err.Error(), "does not match admission") {
		t.Fatalf("mismatched admitted provider error = %v", err)
	}
	if _, err := executor.resolveEmbeddingProviderConfig(
		context.Background(),
		providerConfigAdmissionPin{},
	); err == nil || !strings.Contains(err.Error(), "admission pin is invalid") {
		t.Fatalf("invalid admitted provider pin error = %v", err)
	}
}

func TestQdrantDocumentEvidenceEmbeddingRejectsRedirectWithoutContactingTarget(t *testing.T) {
	var targetRequests atomic.Int32
	target := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, _ *http.Request) {
		targetRequests.Add(1)
		response.Header().Set("content-type", "application/json")
		_, _ = response.Write([]byte(`{"data":[{"embedding":[0.1]}]}`))
	}))
	defer target.Close()
	redirect := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, _ *http.Request) {
		response.Header().Set("location", target.URL+"/embeddings")
		response.WriteHeader(http.StatusTemporaryRedirect)
	}))
	defer redirect.Close()

	executor := qdrantDocumentEvidenceExecutor{
		configResolver: staticProviderConfigResolver{
			providerConfigKindEmbedding: embeddingProviderConfigSnapshotForTest(
				providerConfigKindEmbedding,
				redirect.URL,
				"embedding-model",
				1,
			),
		},
		embeddingHTTPClient: redirect.Client(),
	}
	_, err := executor.embedQuery(context.Background(), "学生请假手续")
	if err == nil || !strings.Contains(err.Error(), "embedding provider status 307") {
		t.Fatalf("error = %v, want redirect status rejection", err)
	}
	if got := targetRequests.Load(); got != 0 {
		t.Fatalf("redirect target requests = %d, want 0", got)
	}
}

func TestQdrantDocumentEvidenceChecksCollectionVectorCompatibility(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		if request.URL.Path != "/collections/student_rules" {
			t.Fatalf("qdrant path = %q", request.URL.Path)
		}
		response.Header().Set("content-type", "application/json")
		_, _ = response.Write([]byte(`{
			"result":{"config":{"params":{
				"vectors":{"dense":{"size":2560,"distance":"Cosine"}},
				"sparse_vectors":{"sparse":{}}
			}}},
			"status":"ok"
		}`))
	}))
	defer server.Close()
	executor := qdrantDocumentEvidenceExecutor{
		httpClient:        server.Client(),
		qdrantQueryAPIKey: "test-qdrant-key",
		qdrantURL:         server.URL,
		timeout:           time.Second,
	}
	profile := mustRetrievalServingConfigForTest(t, "regulations", "student_rules")
	err := executor.validateCollectionCompatibility(context.Background(), profile, providerConfigSnapshot{
		Dimensions: 2560,
		Model:      "Qwen3-Embedding-4B",
		Provider:   "openai-compatible",
	}, "student_rules")
	if err != nil {
		t.Fatalf("validate collection compatibility: %v", err)
	}
}

func TestQdrantDocumentEvidenceRejectsCollectionDimensionDrift(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, _ *http.Request) {
		response.Header().Set("content-type", "application/json")
		_, _ = response.Write([]byte(`{
			"result":{"config":{"params":{
				"vectors":{"dense":{"size":2,"distance":"Cosine"}},
				"sparse_vectors":{"sparse":{}}
			}}},
			"status":"ok"
		}`))
	}))
	defer server.Close()
	executor := qdrantDocumentEvidenceExecutor{
		httpClient:        server.Client(),
		qdrantQueryAPIKey: "test-qdrant-key",
		qdrantURL:         server.URL,
		timeout:           time.Second,
	}
	profile := mustRetrievalServingConfigForTest(t, "regulations", "student_rules")
	err := executor.validateCollectionCompatibility(context.Background(), profile, providerConfigSnapshot{
		Dimensions: 2560,
		Model:      "Qwen3-Embedding-4B",
		Provider:   "openai-compatible",
	}, "student_rules")
	if err == nil || !strings.Contains(err.Error(), "provider dimensions") {
		t.Fatalf("error = %v, want dimension drift", err)
	}
}
