package httpapi

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestQdrantKnowledgeSearchEmbeddingFailsClosedWithoutProviderResolver(t *testing.T) {
	executor := qdrantKnowledgeSearchExecutor{
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

func TestQdrantKnowledgeSearchEmbeddingUsesActiveProviderSnapshot(t *testing.T) {
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
	executor := qdrantKnowledgeSearchExecutor{
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

func TestQdrantKnowledgeSearchChecksAliasVectorCompatibility(t *testing.T) {
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
	executor := qdrantKnowledgeSearchExecutor{
		httpClient:        server.Client(),
		qdrantQueryAPIKey: "test-qdrant-key",
		qdrantURL:         server.URL,
		timeout:           time.Second,
	}
	profile := mustRetrievalServingConfigForTest(t, "regulations", "student_rules")
	err := executor.validateAliasCompatibility(context.Background(), profile, providerConfigSnapshot{
		Dimensions: 2560,
		Model:      "Qwen3-Embedding-4B",
		Provider:   "openai-compatible",
	})
	if err != nil {
		t.Fatalf("validate alias compatibility: %v", err)
	}
}

func TestQdrantKnowledgeSearchRejectsAliasDimensionDrift(t *testing.T) {
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
	executor := qdrantKnowledgeSearchExecutor{
		httpClient:        server.Client(),
		qdrantQueryAPIKey: "test-qdrant-key",
		qdrantURL:         server.URL,
		timeout:           time.Second,
	}
	profile := mustRetrievalServingConfigForTest(t, "regulations", "student_rules")
	err := executor.validateAliasCompatibility(context.Background(), profile, providerConfigSnapshot{
		Dimensions: 2560,
		Model:      "Qwen3-Embedding-4B",
		Provider:   "openai-compatible",
	})
	if err == nil || !strings.Contains(err.Error(), "provider dimensions") {
		t.Fatalf("error = %v, want dimension drift", err)
	}
}
