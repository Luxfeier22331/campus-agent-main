package httpapi

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
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
}
