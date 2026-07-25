package httpapi

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/config"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/retrievalruntime"
)

func TestQdrantKnowledgeSearchQueryUsesHybridPrefetchFromServingConfig(t *testing.T) {
	var captured map[string]any
	server := qdrantQueryServerForTest(t, &captured)
	defer server.Close()
	executor := qdrantKnowledgeSearchExecutor{
		configResolver:    defaultKnowledgeSearchEmbeddingResolverForTest(),
		httpClient:        server.Client(),
		qdrantQueryAPIKey: "test-qdrant-key",
		qdrantURL:         server.URL,
		timeout:           time.Second,
	}
	points, err := executor.queryPoints(context.Background(), retrievalruntime.SearchRequest{
		QueryText:         "学生请假手续",
		ServingConfigPath: "regulations/student_rules/serving-config.json",
		RetrievalAccess:   publicRetrievalAccessProjectionForTest(),
		Target:            "student_rules",
		TopK:              3,
	}, make([]float64, 2560))
	if err != nil {
		t.Fatalf("query points: %v", err)
	}
	if len(points) != 1 {
		t.Fatalf("point count = %d, want 1", len(points))
	}
	prefetch, ok := captured["prefetch"].([]any)
	if !ok || len(prefetch) != 2 {
		t.Fatalf("prefetch = %#v, want dense and sparse prefetch", captured["prefetch"])
	}
	dense, ok := prefetch[0].(map[string]any)
	if !ok || dense["using"] != "dense" {
		t.Fatalf("dense prefetch = %#v", prefetch[0])
	}
	sparse, ok := prefetch[1].(map[string]any)
	if !ok || sparse["using"] != "sparse" {
		t.Fatalf("sparse prefetch = %#v", prefetch[1])
	}
	fusion, ok := captured["query"].(map[string]any)
	if !ok || fusion["fusion"] != "rrf" {
		t.Fatalf("query = %#v, want rrf fusion", captured["query"])
	}
	must := qdrantMustConditionsForTest(t, captured)
	assertQdrantMatchConditionForTest(t, must, "corpus", "regulations")
	assertQdrantMatchConditionForTest(t, must, "collection", "student_rules")
	assertQdrantMatchConditionForTest(t, must, "status", "active")
	assertQdrantMatchConditionForTest(t, must, "is_current", true)
	assertQdrantMatchConditionForTest(t, must, "visibility_level", "public")
}

func TestQdrantKnowledgeSearchHistoryOmitsCurrentFilter(t *testing.T) {
	var captured map[string]any
	server := qdrantQueryServerForTest(t, &captured)
	defer server.Close()
	executor := qdrantKnowledgeSearchExecutor{
		configResolver:    defaultKnowledgeSearchEmbeddingResolverForTest(),
		httpClient:        server.Client(),
		qdrantQueryAPIKey: "test-qdrant-key",
		qdrantURL:         server.URL,
		timeout:           time.Second,
	}
	_, err := executor.queryPoints(context.Background(), retrievalruntime.SearchRequest{
		IncludeHistory:    true,
		QueryText:         "旧版国奖评审办法",
		ServingConfigPath: "regulations/student_rules/serving-config.json",
		RetrievalAccess:   publicRetrievalAccessProjectionForTest(),
		Target:            "student_rules",
		TopK:              3,
	}, make([]float64, 2560))
	if err != nil {
		t.Fatalf("query points: %v", err)
	}
	must := qdrantMustConditionsForTest(t, captured)
	if _, ok := must["is_current"]; ok {
		t.Fatalf("history query must not include is_current: %#v", must)
	}
}

func qdrantQueryServerForTest(t *testing.T, captured *map[string]any) *httptest.Server {
	t.Helper()
	return httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		if request.URL.Path != "/collections/student_rules/points/query" {
			t.Fatalf("qdrant path = %q", request.URL.Path)
		}
		if err := json.NewDecoder(request.Body).Decode(captured); err != nil {
			t.Fatalf("decode qdrant query body: %v", err)
		}
		response.Header().Set("content-type", "application/json")
		_, _ = response.Write([]byte(`{"result":{"points":[{"id":"point-1","score":0.91,"payload":{"text":"学生应当按照学校规定办理请假手续。","document_id":"doc-1","chunk_id":"chunk-1"}}]},"status":"ok"}`))
	}))
}

func TestSearchEvidenceFromQdrantPointPreservesPublicSourceMetadata(t *testing.T) {
	evidence, ok, err := searchEvidenceFromQdrantPoint(qdrantPoint{
		ID:    "point-1",
		Score: 0.93,
		Payload: map[string]any{
			"canonical_url": "https://docs.example.edu/student-rules.html#leave",
			"chunk_id":      "chunk-1",
			"document_id":   "doc-student-rules",
			"source_title":  "学生手册",
			"text":          "学生应当按照学校规定办理请假手续。",
			"version_id":    "v3",
		},
	}, "student_rules", 1)
	if err != nil {
		t.Fatalf("build evidence: %v", err)
	}
	if !ok {
		t.Fatal("qdrant point with public metadata must produce evidence")
	}
	if evidence.CanonicalURL != "https://docs.example.edu/student-rules.html#leave" ||
		evidence.Title != "学生手册" || evidence.VersionID != "v3" ||
		evidence.RetrievalTarget != "student_rules" || evidence.Rank != 1 ||
		evidence.DocumentID != "doc-student-rules" || evidence.ChunkID != "chunk-1" {
		t.Fatalf("public source metadata drifted: %#v", evidence)
	}
	if evidence.FusionScore != 0.93 {
		t.Fatalf("evidence scores drifted: %#v", evidence)
	}
}

func TestSearchEvidenceFromQdrantPointTruncatesChineseSnippetByBytes(t *testing.T) {
	value := strings.Repeat("培养方案", 200)
	evidence, ok, err := searchEvidenceFromQdrantPoint(qdrantPoint{
		ID: "point-long-snippet",
		Payload: map[string]any{
			"canonical_url": "https://docs.example.edu/curriculum.html",
			"chunk_id":      "chunk-long",
			"document_id":   "doc-curriculum",
			"source_title":  "培养方案",
			"text":          value,
		},
	}, "curriculum", 1)
	if err != nil {
		t.Fatalf("build evidence: %v", err)
	}
	if !ok {
		t.Fatal("valid Qdrant point must produce evidence")
	}
	if len(evidence.Snippet) > retrievalruntime.MaxEvidenceSnippet || !strings.HasPrefix(value, evidence.Snippet) {
		t.Fatalf("snippet truncation is invalid: bytes=%d", len(evidence.Snippet))
	}
}

func TestQdrantKnowledgeSearchEmbeddingRequestUsesConfiguredDimensions(t *testing.T) {
	var captured map[string]any
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		if err := json.NewDecoder(request.Body).Decode(&captured); err != nil {
			t.Fatalf("decode embedding request: %v", err)
		}
		response.Header().Set("content-type", "application/json")
		_, _ = response.Write([]byte(embeddingResponseForTest(2560)))
	}))
	defer server.Close()
	executor := qdrantKnowledgeSearchExecutor{
		configResolver: staticProviderConfigResolver{
			providerConfigKindEmbedding: embeddingProviderConfigSnapshotForTest(
				providerConfigKindEmbedding,
				server.URL,
				"Qwen3-Embedding-4B",
				2560,
			),
		},
		embeddingHTTPClient: server.Client(),
	}
	embedding, err := executor.embedQuery(context.Background(), "学生请假手续")
	if err != nil {
		t.Fatalf("embed query: %v", err)
	}
	if len(embedding) != 2560 || captured["dimensions"] != float64(2560) {
		t.Fatalf("embedding response/request drift: len=%d request=%#v", len(embedding), captured)
	}
}

func TestQdrantKnowledgeSearchEmbeddingFailsOnDimensionMismatch(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, _ *http.Request) {
		response.Header().Set("content-type", "application/json")
		_, _ = response.Write([]byte(`{"data":[{"embedding":[0.1,0.2,0.3]}]}`))
	}))
	defer server.Close()
	executor := qdrantKnowledgeSearchExecutor{
		configResolver: staticProviderConfigResolver{
			providerConfigKindEmbedding: embeddingProviderConfigSnapshotForTest(
				providerConfigKindEmbedding,
				server.URL,
				"Qwen3-Embedding-4B",
				2560,
			),
		},
		embeddingHTTPClient: server.Client(),
	}
	_, err := executor.embedQuery(context.Background(), "学生请假手续")
	if err == nil || !strings.Contains(err.Error(), "embedding dimension") {
		t.Fatalf("error = %v, want embedding dimension diagnostic", err)
	}
}

func TestQdrantKnowledgeSearchServingConfigsFollowPublishedTargets(t *testing.T) {
	profileRoot := t.TempDir()
	for _, target := range []struct {
		corpus     string
		collection string
	}{
		{corpus: "regulations", collection: "student_rules"},
		{corpus: "regulations", collection: "institutional_rules"},
		{corpus: "curriculum", collection: "curriculum_plan"},
		{corpus: "regulations", collection: "scoped_rules"},
	} {
		writeServingConfigForCompatibilityTest(t, profileRoot, target.corpus, target.collection)
	}
	executor := qdrantKnowledgeSearchExecutor{servingConfigRoot: profileRoot}
	profiles, err := executor.queryServingConfigs()
	if err != nil {
		t.Fatalf("query serving configs: %v", err)
	}
	got := map[string]bool{}
	for _, profile := range profiles {
		got[profile.Corpus+"/"+profile.Collection] = true
	}
	for _, target := range []string{
		"regulations/student_rules",
		"regulations/institutional_rules",
		"curriculum/curriculum_plan",
	} {
		if !got[target] {
			t.Fatalf("published query target %s missing: %#v", target, got)
		}
	}
	if got["regulations/scoped_rules"] {
		t.Fatal("registry-closed scoped_rules must not be checked")
	}
}

func writeServingConfigForCompatibilityTest(
	t *testing.T,
	root string,
	corpus string,
	collection string,
) {
	t.Helper()
	dir := filepath.Join(root, corpus, collection)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatalf("mkdir serving config fixture: %v", err)
	}
	body, err := json.Marshal(map[string]any{
		"collection": collection,
		"corpus":     corpus,
		"embedding_profile": map[string]any{
			"dense_vector_name": "dense",
			"dimensions":        2560,
			"model":             "Qwen3-Embedding-4B",
			"provider":          "openai-compatible",
		},
		"qdrant_alias_name":         collection,
		"qdrant_dense_vector_name":  "dense",
		"qdrant_sparse_vector_name": "sparse",
		"retrieval_enabled":         true,
		"serving_stage":             "query_serving",
		"serving_visibility_levels": []string{"public"},
	})
	if err != nil {
		t.Fatalf("marshal serving config fixture: %v", err)
	}
	if err := os.WriteFile(filepath.Join(dir, "serving-config.json"), body, 0o600); err != nil {
		t.Fatalf("write serving config fixture: %v", err)
	}
}

func TestNewQdrantKnowledgeSearchExecutorRejectsHTTPOutsideLocal(t *testing.T) {
	_, err := newQdrantKnowledgeSearchExecutor(config.Config{
		DeploymentEnvironment: "staging",
		QdrantQueryAPIKey:     "readonly-key",
		QdrantTLSCACertPath:   "/srv/qdrant/tls/ca.pem",
		QdrantURL:             "http://qdrant:6333",
	}, defaultKnowledgeSearchEmbeddingResolverForTest())
	if err == nil || !strings.Contains(err.Error(), "QDRANT_URL must use https") {
		t.Fatalf("error = %v, want https diagnostic", err)
	}
}

func TestNewQdrantKnowledgeSearchExecutorAllowsLocalHTTP(t *testing.T) {
	executor, err := newQdrantKnowledgeSearchExecutor(config.Config{
		DeploymentEnvironment: "local",
		QdrantQueryAPIKey:     "readonly-key",
		QdrantURL:             "http://qdrant:6333",
	}, defaultKnowledgeSearchEmbeddingResolverForTest())
	if err != nil || executor == nil {
		t.Fatalf("local qdrant executor = %#v, error = %v", executor, err)
	}
}

func TestNewQdrantKnowledgeSearchExecutorUsesQueryKeyAndTLSCA(t *testing.T) {
	qdrant := httptest.NewTLSServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		if request.Header.Get("api-key") != "readonly-key" {
			t.Fatalf("qdrant api-key = %q", request.Header.Get("api-key"))
		}
		_, _ = response.Write([]byte("all shards are ready"))
	}))
	defer qdrant.Close()
	executor, err := newQdrantKnowledgeSearchExecutor(config.Config{
		QdrantQueryAPIKey:   "readonly-key",
		QdrantTLSCACertPath: writeTestCACert(t, qdrant),
		QdrantURL:           qdrant.URL,
	}, defaultKnowledgeSearchEmbeddingResolverForTest())
	if err != nil {
		t.Fatalf("new qdrant executor: %v", err)
	}
	if err := executor.HealthCheck(context.Background()); err != nil {
		t.Fatalf("qdrant health check: %v", err)
	}
}

func TestNewQdrantKnowledgeSearchExecutorUsesSplitTimeouts(t *testing.T) {
	qdrant := httptest.NewTLSServer(http.HandlerFunc(func(response http.ResponseWriter, _ *http.Request) {
		_, _ = response.Write([]byte("all shards are ready"))
	}))
	defer qdrant.Close()
	lookupExecutor, err := newQdrantKnowledgeSearchExecutor(config.Config{
		QdrantQueryAPIKey:     "readonly-key",
		QdrantTLSCACertPath:   writeTestCACert(t, qdrant),
		QdrantURL:             qdrant.URL,
		RAGEmbeddingTimeoutMS: 2500,
		RAGQdrantTimeoutMS:    3500,
	}, defaultKnowledgeSearchEmbeddingResolverForTest())
	if err != nil {
		t.Fatalf("new qdrant executor: %v", err)
	}
	executor := lookupExecutor.(qdrantKnowledgeSearchExecutor)
	if executor.embeddingHTTPClient.Timeout != 2500*time.Millisecond ||
		executor.httpClient.Timeout != 3500*time.Millisecond {
		t.Fatalf("timeouts = %s / %s", executor.embeddingHTTPClient.Timeout, executor.httpClient.Timeout)
	}
}

func TestNewQdrantKnowledgeSearchExecutorFailsWithoutTLSCA(t *testing.T) {
	_, err := newQdrantKnowledgeSearchExecutor(config.Config{
		QdrantQueryAPIKey: "readonly-key",
		QdrantURL:         "https://qdrant:6333",
	}, defaultKnowledgeSearchEmbeddingResolverForTest())
	if err == nil || !strings.Contains(err.Error(), "QDRANT_TLS_CA_CERT_PATH") {
		t.Fatalf("error = %v, want TLS CA diagnostic", err)
	}
}
