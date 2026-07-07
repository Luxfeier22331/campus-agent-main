package httpapi

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/ragruntime"
)

func TestQdrantRAGLookupEmbeddingFailsClosedWithoutProviderResolver(t *testing.T) {
	executor := qdrantRAGLookupExecutor{
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

func TestQdrantRAGLookupEmbeddingUsesActiveProviderSnapshot(t *testing.T) {
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
	executor := qdrantRAGLookupExecutor{
		configResolver: staticProviderConfigResolver{
			"rag_query_embedding": {
				APIKey:     "snapshot-embedding-key",
				BaseURL:    server.URL,
				Dimensions: 3,
				Model:      "snapshot-embedding-model",
				ProfileID:  "provider_profile_rag_embedding",
				Provider:   "openai-compatible",
				Revision:   4,
				Role:       "rag_query_embedding",
				TimeoutMS:  30000,
				Transport:  "embeddings",
			},
		},
		embeddingHTTPClient: server.Client(),
		embeddingRole:       providerConfigRoleRAGQueryEmbedding,
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

func TestQdrantRAGLookupReleaseGuardUsesActiveProviderSnapshot(t *testing.T) {
	var captured map[string]any
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		response.Header().Set("content-type", "application/json")
		switch request.URL.Path {
		case "/collections/student_rules":
			_, _ = response.Write([]byte(qdrantCollectionMetadataResponseForEmbeddingTest(
				t,
				"regulations",
				"student_rules",
				providerConfigSnapshot{
					Dimensions: 3,
					Model:      "snapshot-embedding-model",
					Provider:   "openai",
				},
			)))
		case "/collections/student_rules/points/query":
			if err := json.NewDecoder(request.Body).Decode(&captured); err != nil {
				t.Fatalf("decode qdrant query body: %v", err)
			}
			_, _ = response.Write([]byte(`{"result":{"points":[]},"status":"ok"}`))
		default:
			t.Fatalf("qdrant path = %q, want collection metadata or point query", request.URL.Path)
		}
	}))
	defer server.Close()
	executor := qdrantRAGLookupExecutor{
		configResolver: staticProviderConfigResolver{
			"rag_query_embedding": {
				APIKey:     "snapshot-embedding-key",
				BaseURL:    "https://provider.example/v1",
				Dimensions: 3,
				Model:      "snapshot-embedding-model",
				ProfileID:  "provider_profile_rag_embedding",
				Provider:   "openai",
				Revision:   4,
				Role:       "rag_query_embedding",
				TimeoutMS:  30000,
				Transport:  "embeddings",
			},
		},
		httpClient:        server.Client(),
		qdrantQueryAPIKey: "test-qdrant-key",
		qdrantURL:         server.URL,
		timeout:           time.Second,
	}

	_, err := executor.queryPoints(context.Background(), ragruntime.PlanProjection{
		Collection:      "student_rules",
		CollectionAlias: "student_rules",
		Corpus:          "regulations",
		QueryMode:       "current",
		QueryText:       "学生请假手续",
		RetrievalAccess: publicRetrievalAccessProjectionForTest(),
		RunID:           "run-release-guard-provider-snapshot",
		TopK:            3,
		ServingConfigID: "regulations/student_rules",
	}, []float64{0.1, 0.2, 0.3})
	if err != nil {
		t.Fatalf("query points: %v", err)
	}
	if captured["prefetch"] == nil {
		t.Fatalf("query body = %#v, want hybrid prefetch", captured)
	}
}

func TestQdrantRAGLookupReranksWhenServingConfigOptsIn(t *testing.T) {
	profile := mustRetrievalServingConfigForTest(t, "regulations", "student_rules")
	profile.RerankerEnabledByDefault = true
	embeddingSnapshot := providerConfigSnapshot{
		Dimensions: 3,
		Model:      "snapshot-embedding-model",
		Provider:   "openai",
	}
	var rerankAuthorization string
	var rerankRequest map[string]any
	rerankServer := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		rerankAuthorization = request.Header.Get("authorization")
		if request.URL.Path != "/configured-rerank" {
			t.Fatalf("rerank path = %q, want configured path", request.URL.Path)
		}
		if err := json.NewDecoder(request.Body).Decode(&rerankRequest); err != nil {
			t.Fatalf("decode rerank request: %v", err)
		}
		response.Header().Set("content-type", "application/json")
		_, _ = response.Write([]byte(`{"results":[{"index":1,"relevance_score":0.91},{"index":0,"relevance_score":0.12}]}`))
	}))
	defer rerankServer.Close()
	qdrantServer := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		response.Header().Set("content-type", "application/json")
		switch request.URL.Path {
		case "/collections/student_rules":
			body, err := json.Marshal(map[string]any{
				"result": map[string]any{
					"payload": releaseMetadataFixtureForEmbeddingHTTPTest(
						profile,
						"student_rules",
						embeddingSnapshot,
					),
				},
				"status": "ok",
			})
			if err != nil {
				t.Fatalf("marshal metadata fixture: %v", err)
			}
			_, _ = response.Write(body)
		case "/collections/student_rules/points/query":
			_, _ = response.Write([]byte(`{"result":{"points":[{"id":"point-1","score":0.95,"payload":{"text":"low rerank document","chunk_id":"chunk-1","source_doc_id":"doc-1"}},{"id":"point-2","score":0.70,"payload":{"text":"high rerank document","chunk_id":"chunk-2","source_doc_id":"doc-2"}}]},"status":"ok"}`))
		default:
			t.Fatalf("qdrant path = %q, want collection metadata or point query", request.URL.Path)
		}
	}))
	defer qdrantServer.Close()
	executor := qdrantRAGLookupExecutor{
		configResolver: staticProviderConfigResolver{
			"rag_reranker": {
				APIKey:     "snapshot-rerank-key",
				BaseURL:    rerankServer.URL,
				ToolConfig: map[string]any{"rerank": map[string]any{"path": "/configured-rerank"}},
				Kind:       "rerank",
				Model:      "snapshot-rerank-model",
				ProfileID:  "provider_profile_reranker",
				Provider:   "gitee",
				Revision:   2,
				Role:       "rag_reranker",
				TimeoutMS:  30000,
				Transport:  "gitee_rerank",
			},
		},
		httpClient:          qdrantServer.Client(),
		embeddingHTTPClient: rerankServer.Client(),
		qdrantQueryAPIKey:   "test-qdrant-key",
		qdrantURL:           qdrantServer.URL,
		timeout:             time.Second,
	}

	points, err := executor.queryPointsWithProfileAndProviderConfig(
		context.Background(),
		ragruntime.PlanProjection{
			Collection:      "student_rules",
			CollectionAlias: "student_rules",
			Corpus:          "regulations",
			QueryMode:       "current",
			QueryText:       "学生请假手续",
			RetrievalAccess: publicRetrievalAccessProjectionForTest(),
			RunID:           "run-rerank-provider-snapshot",
			TopK:            2,
		},
		profile,
		[]float64{0.1, 0.2, 0.3},
		embeddingSnapshot,
	)
	if err != nil {
		t.Fatalf("query points with rerank: %v", err)
	}
	if points[0].Payload["chunk_id"] != "chunk-2" {
		t.Fatalf("first reranked chunk = %#v, want chunk-2", points[0].Payload)
	}
	if rerankAuthorization != "Bearer snapshot-rerank-key" {
		t.Fatalf("rerank authorization = %q, want snapshot key", rerankAuthorization)
	}
	if rerankRequest["model"] != "snapshot-rerank-model" {
		t.Fatalf("rerank request = %#v", rerankRequest)
	}
}
