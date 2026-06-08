package httpapi

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/ragruntime"
)

func TestQdrantRAGLookupQueryUsesDenseNamedVector(t *testing.T) {
	var captured map[string]any
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		if request.URL.Path != "/collections/student_rules/points/query" {
			t.Fatalf("qdrant path = %q, want /collections/student_rules/points/query", request.URL.Path)
		}
		if err := json.NewDecoder(request.Body).Decode(&captured); err != nil {
			t.Fatalf("decode qdrant query body: %v", err)
		}
		response.Header().Set("content-type", "application/json")
		_, _ = response.Write([]byte(`{"result":{"points":[{"id":"point-1","score":0.91,"payload":{"text":"学生应当按照学校规定办理请假手续。","corpus":"regulations","collection":"student_rules","document_id":"doc-1","chunk_id":"chunk-1","source_title":"学生手册","serving_status":"query_enabled"}}]},"status":"ok"}`))
	}))
	defer server.Close()
	executor := qdrantRAGLookupExecutor{
		httpClient:   server.Client(),
		qdrantAPIKey: "test-qdrant-key",
		qdrantURL:    server.URL,
		timeout:      time.Second,
	}

	points, err := executor.queryPoints(context.Background(), ragruntime.PlanProjection{
		Collection:      "student_rules",
		CollectionAlias: "student_rules",
		Corpus:          "regulations",
		QueryMode:       "current",
		QueryText:       "学生请假手续",
		RunID:           "run-qdrant-query",
		TopK:            3,
	}, []float64{0.1, 0.2, 0.3})
	if err != nil {
		t.Fatalf("query points: %v", err)
	}
	if len(points) != 1 {
		t.Fatalf("point count = %d, want 1", len(points))
	}
	if captured["using"] != "dense" {
		t.Fatalf("using = %#v, want dense", captured["using"])
	}
	vector, ok := captured["query"].([]any)
	if !ok || len(vector) != 3 {
		t.Fatalf("query = %#v, want 3-dimensional vector", captured["query"])
	}
	must := qdrantMustConditionsForTest(t, captured)
	assertQdrantMatchConditionForTest(t, must, "corpus", "regulations")
	assertQdrantMatchConditionForTest(t, must, "collection", "student_rules")
	assertQdrantMatchConditionForTest(t, must, "status", "active")
	assertQdrantMatchConditionForTest(t, must, "is_current", true)
	assertQdrantMatchConditionForTest(t, must, "visibility_level", "public")
	if _, ok := must["serving_status"]; ok {
		t.Fatalf("serving_status filter must not be used: %#v", must["serving_status"])
	}
}

func TestQdrantRAGLookupEmbeddingRequestUsesConfiguredDimensions(t *testing.T) {
	var captured map[string]any
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		if request.URL.Path != "/embeddings" {
			t.Fatalf("embedding path = %q, want /embeddings", request.URL.Path)
		}
		if err := json.NewDecoder(request.Body).Decode(&captured); err != nil {
			t.Fatalf("decode embedding request: %v", err)
		}
		response.Header().Set("content-type", "application/json")
		_, _ = response.Write([]byte(embeddingResponseForTest(2560)))
	}))
	defer server.Close()
	executor := qdrantRAGLookupExecutor{
		embeddingAPIKey:     "test-embedding-key",
		embeddingBaseURL:    server.URL,
		embeddingDimensions: 2560,
		embeddingModel:      "Qwen3-Embedding-4B",
		httpClient:          server.Client(),
	}

	embedding, err := executor.embedQuery(context.Background(), "学生请假手续")
	if err != nil {
		t.Fatalf("embed query: %v", err)
	}
	if len(embedding) != 2560 {
		t.Fatalf("embedding dim = %d, want 2560", len(embedding))
	}
	if captured["model"] != "Qwen3-Embedding-4B" {
		t.Fatalf("model = %#v", captured["model"])
	}
	if captured["dimensions"] != float64(2560) {
		t.Fatalf("dimensions = %#v, want 2560", captured["dimensions"])
	}
}

func TestQdrantRAGLookupEmbeddingFailsClosedOnDimensionMismatch(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		response.Header().Set("content-type", "application/json")
		_, _ = response.Write([]byte(`{"data":[{"embedding":[0.1,0.2,0.3]}]}`))
	}))
	defer server.Close()
	executor := qdrantRAGLookupExecutor{
		embeddingAPIKey:     "test-embedding-key",
		embeddingBaseURL:    server.URL,
		embeddingDimensions: 2560,
		embeddingModel:      "Qwen3-Embedding-4B",
		httpClient:          server.Client(),
	}

	_, err := executor.embedQuery(context.Background(), "学生请假手续")
	if err == nil {
		t.Fatal("embedding dimension mismatch must fail closed")
	}
	if !strings.Contains(err.Error(), "embedding dimension") {
		t.Fatalf("error = %v, want embedding dimension diagnostic", err)
	}
}

func qdrantMustConditionsForTest(t *testing.T, captured map[string]any) map[string]any {
	t.Helper()
	filter, ok := captured["filter"].(map[string]any)
	if !ok {
		t.Fatalf("filter = %#v, want object", captured["filter"])
	}
	rawMust, ok := filter["must"].([]any)
	if !ok {
		t.Fatalf("filter.must = %#v, want array", filter["must"])
	}
	must := map[string]any{}
	for _, rawCondition := range rawMust {
		condition, ok := rawCondition.(map[string]any)
		if !ok {
			t.Fatalf("condition = %#v, want object", rawCondition)
		}
		key, _ := condition["key"].(string)
		match, _ := condition["match"].(map[string]any)
		must[key] = match["value"]
	}
	return must
}

func assertQdrantMatchConditionForTest(
	t *testing.T,
	must map[string]any,
	key string,
	expected any,
) {
	t.Helper()
	if must[key] != expected {
		t.Fatalf("filter %s = %#v, want %#v", key, must[key], expected)
	}
}

func embeddingResponseForTest(dimensions int) string {
	values := make([]string, 0, dimensions)
	for index := range dimensions {
		values = append(values, fmt.Sprintf("%.1f", float64(index%3)/10))
	}
	return `{"data":[{"embedding":[` + strings.Join(values, ",") + `]}]}`
}
