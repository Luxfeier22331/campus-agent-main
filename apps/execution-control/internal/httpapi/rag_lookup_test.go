package httpapi

import (
	"context"
	"encoding/json"
	"encoding/pem"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/config"
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
		httpClient:        server.Client(),
		qdrantQueryAPIKey: "test-qdrant-key",
		qdrantURL:         server.URL,
		timeout:           time.Second,
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

func TestQdrantRAGLookupHistoricalVersionFilterDoesNotFallbackToCurrent(t *testing.T) {
	var captured map[string]any
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		if err := json.NewDecoder(request.Body).Decode(&captured); err != nil {
			t.Fatalf("decode qdrant query body: %v", err)
		}
		response.Header().Set("content-type", "application/json")
		_, _ = response.Write([]byte(`{"result":{"points":[]},"status":"ok"}`))
	}))
	defer server.Close()
	executor := qdrantRAGLookupExecutor{
		httpClient:        server.Client(),
		qdrantQueryAPIKey: "test-qdrant-key",
		qdrantURL:         server.URL,
		timeout:           time.Second,
	}

	_, err := executor.queryPoints(context.Background(), ragruntime.PlanProjection{
		Collection:      "student_rules",
		CollectionAlias: "student_rules",
		Corpus:          "regulations",
		QueryMode:       "historical",
		QueryText:       "旧版国奖评审办法",
		RunID:           "run-qdrant-historical-query",
		TopK:            3,
		VersionQuery: &ragruntime.VersionQueryProjection{
			Mode:      "historical",
			VersionID: "v1:national-scholarship",
		},
	}, []float64{0.1, 0.2, 0.3})
	if err != nil {
		t.Fatalf("query points: %v", err)
	}
	must := qdrantMustConditionsForTest(t, captured)
	if _, ok := must["is_current"]; ok {
		t.Fatalf("historical version query must not include is_current fallback: %#v", must)
	}
	rawMust := qdrantMustConditionPayloadsForTest(t, captured)
	versionMatch, ok := rawMust["version_id"]["match"].(map[string]any)
	if !ok {
		t.Fatalf("version_id filter missing match payload: %#v", rawMust["version_id"])
	}
	versionIDs, ok := versionMatch["any"].([]any)
	if !ok || len(versionIDs) != 1 || versionIDs[0] != "v1:national-scholarship" {
		t.Fatalf("version_id any = %#v, want v1:national-scholarship", versionMatch["any"])
	}
}

func TestQdrantRAGLookupHistoricalModeRequiresExplicitVersionQuery(t *testing.T) {
	executor := qdrantRAGLookupExecutor{}

	_, err := executor.queryPoints(context.Background(), ragruntime.PlanProjection{
		Collection:      "student_rules",
		CollectionAlias: "student_rules",
		Corpus:          "regulations",
		QueryMode:       "historical",
		QueryText:       "旧版国奖评审办法",
		RunID:           "run-qdrant-historical-missing-version",
		TopK:            3,
	}, []float64{0.1, 0.2, 0.3})
	if err == nil {
		t.Fatal("historical lookup without version query must fail closed")
	}
	if !strings.Contains(err.Error(), "version_id") {
		t.Fatalf("error = %v, want version_id diagnostic", err)
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
		embeddingHTTPClient: server.Client(),
		embeddingModel:      "Qwen3-Embedding-4B",
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
		embeddingHTTPClient: server.Client(),
		embeddingModel:      "Qwen3-Embedding-4B",
	}

	_, err := executor.embedQuery(context.Background(), "学生请假手续")
	if err == nil {
		t.Fatal("embedding dimension mismatch must fail closed")
	}
	if !strings.Contains(err.Error(), "embedding dimension") {
		t.Fatalf("error = %v, want embedding dimension diagnostic", err)
	}
}

func TestNewQdrantRAGLookupExecutorRejectsHTTPDataPlaneWithAPIKey(t *testing.T) {
	_, err := newQdrantRAGLookupExecutor(config.Config{
		EmbeddingAPIKey:      "embedding-key",
		EmbeddingBaseURL:     "https://provider.example/v1",
		EmbeddingDimensions:  3,
		EmbeddingModel:       "embedding-model",
		QdrantQueryAPIKey:    "readonly-key",
		QdrantTLSCACertPath:  "/srv/docker/campus-agent/staging/qdrant/tls/ca.pem",
		QdrantTimeoutSeconds: 10,
		QdrantURL:            "http://qdrant:6333",
	})
	if err == nil {
		t.Fatal("authenticated Qdrant data-plane must reject http:// URLs")
	}
	if !strings.Contains(err.Error(), "QDRANT_URL must use https") {
		t.Fatalf("error = %v, want https diagnostic", err)
	}
}

func TestNewQdrantRAGLookupExecutorUsesQueryKeyAndTLSCA(t *testing.T) {
	qdrant := httptest.NewTLSServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		if request.Header.Get("api-key") != "readonly-key" {
			t.Fatalf("qdrant api-key = %q, want readonly-key", request.Header.Get("api-key"))
		}
		_, _ = response.Write([]byte("all shards are ready"))
	}))
	defer qdrant.Close()
	caPath := writeTestCACert(t, qdrant)

	executor, err := newQdrantRAGLookupExecutor(config.Config{
		EmbeddingAPIKey:      "embedding-key",
		EmbeddingBaseURL:     "https://provider.example/v1",
		EmbeddingDimensions:  3,
		EmbeddingModel:       "embedding-model",
		QdrantQueryAPIKey:    "readonly-key",
		QdrantTLSCACertPath:  caPath,
		QdrantTimeoutSeconds: 10,
		QdrantURL:            qdrant.URL,
	})
	if err != nil {
		t.Fatalf("new qdrant executor: %v", err)
	}
	if err := executor.HealthCheck(context.Background()); err != nil {
		t.Fatalf("qdrant health check with tls ca: %v", err)
	}
}

func TestNewQdrantRAGLookupExecutorSeparatesQdrantTLSClientFromEmbeddingClient(t *testing.T) {
	qdrant := httptest.NewTLSServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		_, _ = response.Write([]byte("all shards are ready"))
	}))
	defer qdrant.Close()
	caPath := writeTestCACert(t, qdrant)

	lookupExecutor, err := newQdrantRAGLookupExecutor(config.Config{
		EmbeddingAPIKey:      "embedding-key",
		EmbeddingBaseURL:     "https://provider.example/v1",
		EmbeddingDimensions:  3,
		EmbeddingModel:       "embedding-model",
		QdrantQueryAPIKey:    "readonly-key",
		QdrantTLSCACertPath:  caPath,
		QdrantTimeoutSeconds: 10,
		QdrantURL:            qdrant.URL,
	})
	if err != nil {
		t.Fatalf("new qdrant executor: %v", err)
	}
	executor, ok := lookupExecutor.(qdrantRAGLookupExecutor)
	if !ok {
		t.Fatalf("executor type = %T, want qdrantRAGLookupExecutor", lookupExecutor)
	}
	if executor.embeddingHTTPClient == nil {
		t.Fatal("embedding client must be configured")
	}
	if executor.embeddingHTTPClient == executor.httpClient {
		t.Fatal("embedding provider client must not reuse private Qdrant TLS client")
	}
}

func TestNewQdrantRAGLookupExecutorFailsClosedWithoutTLSCA(t *testing.T) {
	_, err := newQdrantRAGLookupExecutor(config.Config{
		EmbeddingAPIKey:      "embedding-key",
		EmbeddingBaseURL:     "https://provider.example/v1",
		EmbeddingDimensions:  3,
		EmbeddingModel:       "embedding-model",
		QdrantQueryAPIKey:    "readonly-key",
		QdrantTimeoutSeconds: 10,
		QdrantURL:            "https://qdrant:6333",
	})
	if err == nil {
		t.Fatal("QDRANT_TLS_CA_CERT_PATH must be required for HTTPS Qdrant")
	}
	if !strings.Contains(err.Error(), "QDRANT_TLS_CA_CERT_PATH") {
		t.Fatalf("error = %v, want TLS CA diagnostic", err)
	}
}

func writeTestCACert(t *testing.T, server *httptest.Server) string {
	t.Helper()
	block := &pem.Block{
		Type:  "CERTIFICATE",
		Bytes: server.Certificate().Raw,
	}
	path := t.TempDir() + "/ca.pem"
	if err := os.WriteFile(path, pem.EncodeToMemory(block), 0o600); err != nil {
		t.Fatalf("write test ca: %v", err)
	}
	return path
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

func qdrantMustConditionPayloadsForTest(t *testing.T, captured map[string]any) map[string]map[string]any {
	t.Helper()
	filter, ok := captured["filter"].(map[string]any)
	if !ok {
		t.Fatalf("filter = %#v, want object", captured["filter"])
	}
	rawMust, ok := filter["must"].([]any)
	if !ok {
		t.Fatalf("filter.must = %#v, want array", filter["must"])
	}
	must := map[string]map[string]any{}
	for _, rawCondition := range rawMust {
		condition, ok := rawCondition.(map[string]any)
		if !ok {
			t.Fatalf("condition = %#v, want object", rawCondition)
		}
		key, _ := condition["key"].(string)
		must[key] = condition
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
