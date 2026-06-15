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
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/retrievalruntime"
)

func TestQdrantRAGLookupQueryUsesHybridPrefetchFromRuntimeProfile(t *testing.T) {
	var captured map[string]any
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		response.Header().Set("content-type", "application/json")
		switch request.URL.Path {
		case "/collections/student_rules":
			_, _ = response.Write([]byte(qdrantCollectionMetadataResponseForTest(t, "regulations", "student_rules")))
		case "/collections/student_rules/points/query":
			if err := json.NewDecoder(request.Body).Decode(&captured); err != nil {
				t.Fatalf("decode qdrant query body: %v", err)
			}
			_, _ = response.Write([]byte(`{"result":{"points":[{"id":"point-1","score":0.91,"payload":{"text":"学生应当按照学校规定办理请假手续。","corpus":"regulations","collection":"student_rules","document_id":"doc-1","chunk_id":"chunk-1","source_title":"学生手册","serving_status":"query_enabled","is_answer_bearing":true}}]},"status":"ok"}`))
		default:
			t.Fatalf("qdrant path = %q, want collection metadata or point query", request.URL.Path)
		}
	}))
	defer server.Close()
	executor := qdrantRAGLookupExecutor{
		httpClient:          server.Client(),
		embeddingDimensions: 2560,
		embeddingModel:      "Qwen3-Embedding-4B",
		embeddingProvider:   "openai-compatible",
		qdrantQueryAPIKey:   "test-qdrant-key",
		qdrantURL:           server.URL,
		timeout:             time.Second,
	}

	points, err := executor.queryPoints(context.Background(), ragruntime.PlanProjection{
		Collection:       "student_rules",
		CollectionAlias:  "student_rules",
		Corpus:           "regulations",
		QueryMode:        "current",
		QueryText:        "学生请假手续",
		RunID:            "run-qdrant-query",
		TopK:             3,
		RuntimeProfileID: "regulations/student_rules",
	}, []float64{0.1, 0.2, 0.3})
	if err != nil {
		t.Fatalf("query points: %v", err)
	}
	if len(points) != 1 {
		t.Fatalf("point count = %d, want 1", len(points))
	}
	if captured["using"] != nil {
		t.Fatalf("top-level using = %#v, want absent for hybrid query", captured["using"])
	}
	prefetch, ok := captured["prefetch"].([]any)
	if !ok || len(prefetch) != 2 {
		t.Fatalf("prefetch = %#v, want dense and sparse prefetch", captured["prefetch"])
	}
	dense, ok := prefetch[0].(map[string]any)
	if !ok {
		t.Fatalf("dense prefetch = %#v, want object", prefetch[0])
	}
	if dense["using"] != "dense" {
		t.Fatalf("dense using = %#v, want dense", dense["using"])
	}
	vector, ok := dense["query"].([]any)
	if !ok || len(vector) != 3 {
		t.Fatalf("dense query = %#v, want 3-dimensional vector", dense["query"])
	}
	sparse, ok := prefetch[1].(map[string]any)
	if !ok || sparse["using"] != "sparse" {
		t.Fatalf("sparse prefetch = %#v, want sparse vector", prefetch[1])
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
	if _, ok := must["serving_status"]; ok {
		t.Fatalf("serving_status filter must not be used: %#v", must["serving_status"])
	}
}

func TestQdrantRAGLookupHistoricalVersionFilterDoesNotFallbackToCurrent(t *testing.T) {
	var captured map[string]any
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		response.Header().Set("content-type", "application/json")
		switch request.URL.Path {
		case "/collections/student_rules":
			_, _ = response.Write([]byte(qdrantCollectionMetadataResponseForTest(t, "regulations", "student_rules")))
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
		httpClient:          server.Client(),
		embeddingDimensions: 2560,
		embeddingModel:      "Qwen3-Embedding-4B",
		embeddingProvider:   "openai-compatible",
		qdrantQueryAPIKey:   "test-qdrant-key",
		qdrantURL:           server.URL,
		timeout:             time.Second,
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
		ResolvedVersionQuery: &ragruntime.ResolvedVersionQueryProjection{
			Mode:             "historical",
			TargetVersionIDs: []string{"v1:national-scholarship"},
			VersionID:        "v1:national-scholarship",
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

func TestQdrantRAGLookupAsOfUsesResolvedVersionFilter(t *testing.T) {
	var captured map[string]any
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		response.Header().Set("content-type", "application/json")
		switch request.URL.Path {
		case "/collections/student_rules":
			_, _ = response.Write([]byte(qdrantCollectionMetadataResponseForTest(t, "regulations", "student_rules")))
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
		httpClient:          server.Client(),
		embeddingDimensions: 2560,
		embeddingModel:      "Qwen3-Embedding-4B",
		embeddingProvider:   "openai-compatible",
		qdrantQueryAPIKey:   "test-qdrant-key",
		qdrantURL:           server.URL,
		timeout:             time.Second,
	}

	_, err := executor.queryPoints(context.Background(), ragruntime.PlanProjection{
		Collection:      "student_rules",
		CollectionAlias: "student_rules",
		Corpus:          "regulations",
		QueryMode:       "as_of",
		QueryText:       "2025 年请假手续",
		RunID:           "run-qdrant-as-of-query",
		TopK:            3,
		VersionQuery: &ragruntime.VersionQueryProjection{
			Mode: "as_of",
			AsOf: "2025-09-01T00:00:00Z",
		},
		ResolvedVersionQuery: &ragruntime.ResolvedVersionQueryProjection{
			AsOf:             "2025-09-01T00:00:00Z",
			Mode:             "as_of",
			TargetVersionIDs: []string{"student_rules:v2025"},
			VersionID:        "student_rules:v2025",
		},
	}, []float64{0.1, 0.2, 0.3})
	if err != nil {
		t.Fatalf("query points: %v", err)
	}
	must := qdrantMustConditionsForTest(t, captured)
	if _, ok := must["is_current"]; ok {
		t.Fatalf("as_of version query must not include is_current fallback: %#v", must)
	}
	rawMust := qdrantMustConditionPayloadsForTest(t, captured)
	versionMatch, ok := rawMust["version_id"]["match"].(map[string]any)
	if !ok {
		t.Fatalf("version_id filter missing match payload: %#v", rawMust["version_id"])
	}
	versionIDs, ok := versionMatch["any"].([]any)
	if !ok || len(versionIDs) != 1 || versionIDs[0] != "student_rules:v2025" {
		t.Fatalf("version_id any = %#v, want resolved student_rules:v2025", versionMatch["any"])
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

func TestEvidenceRefFromQdrantPointPreservesAnswerReadyMetadata(t *testing.T) {
	ref, ok := evidenceRefFromQdrantPoint(qdrantPoint{
		ID:    "point-1",
		Score: 0.93,
		Payload: map[string]any{
			"canonical_url":     "https://docs.example.edu/student-rules.html#leave",
			"chunk_id":          "chunk-1",
			"document_id":       "doc-student-rules",
			"is_answer_bearing": true,
			"is_current":        true,
			"latest_url":        "https://docs.example.edu/student-rules.html",
			"revision_track":    "current-effective",
			"source_channel":    "official_web",
			"source_title":      "学生手册",
			"source_unit_key":   "leave",
			"source_unit_kind":  "clause",
			"text":              "学生应当按照学校规定办理请假手续。",
			"version_id":        "v3",
		},
	})
	if !ok {
		t.Fatal("qdrant point with answer-ready metadata must produce evidence ref")
	}
	if !ref.IsAnswerBearing || !ref.IsCurrent {
		t.Fatalf("answer-ready flags = answer_bearing:%v current:%v, want true/true", ref.IsAnswerBearing, ref.IsCurrent)
	}
	if ref.DocumentID != "doc-student-rules" || ref.VersionID != "v3" ||
		ref.RevisionTrack != "current-effective" {
		t.Fatalf("version metadata drifted: %#v", ref)
	}
	if ref.CanonicalURL != "https://docs.example.edu/student-rules.html#leave" ||
		ref.SourceChannel != "official_web" ||
		ref.SourceUnitKind != "clause" {
		t.Fatalf("source metadata drifted: %#v", ref)
	}
}

func TestQdrantRAGLookupFailsClosedBeforeQueryWhenReleaseMetadataMissing(t *testing.T) {
	requestPaths := []string{}
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		requestPaths = append(requestPaths, request.URL.Path)
		response.Header().Set("content-type", "application/json")
		switch request.URL.Path {
		case "/collections/student_rules":
			_, _ = response.Write([]byte(`{"result":{"payload":{}},"status":"ok"}`))
		case "/collections/student_rules/points/scroll":
			_, _ = response.Write([]byte(`{"result":{"points":[]},"status":"ok"}`))
		case "/collections/student_rules/points/query":
			t.Fatal("qdrant point query must not execute when release metadata is missing")
		default:
			t.Fatalf("unexpected qdrant path %q", request.URL.Path)
		}
	}))
	defer server.Close()
	executor := qdrantRAGLookupExecutor{
		embeddingDimensions: 2560,
		embeddingModel:      "Qwen3-Embedding-4B",
		embeddingProvider:   "openai-compatible",
		httpClient:          server.Client(),
		qdrantQueryAPIKey:   "test-qdrant-key",
		qdrantURL:           server.URL,
		timeout:             time.Second,
	}

	_, err := executor.queryPoints(context.Background(), ragruntime.PlanProjection{
		Collection:       "student_rules",
		CollectionAlias:  "student_rules",
		Corpus:           "regulations",
		QueryMode:        "current",
		QueryText:        "学生请假手续",
		RunID:            "run-release-metadata-missing",
		TopK:             3,
		RuntimeProfileID: "regulations/student_rules",
	}, []float64{0.1, 0.2, 0.3})
	if err == nil {
		t.Fatal("missing release metadata must fail closed")
	}
	if !strings.Contains(err.Error(), "release metadata") {
		t.Fatalf("error = %v, want release metadata diagnostic", err)
	}
	wantPaths := []string{"/collections/student_rules", "/collections/student_rules/points/scroll"}
	if strings.Join(requestPaths, "|") != strings.Join(wantPaths, "|") {
		t.Fatalf("qdrant paths = %#v, want metadata lookup and scroll fallback", requestPaths)
	}
}

func TestQdrantRAGLookupUsesPointPayloadReleaseMetadataWhenCollectionMetadataMissing(t *testing.T) {
	requestPaths := []string{}
	var captured map[string]any
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		requestPaths = append(requestPaths, request.URL.Path)
		response.Header().Set("content-type", "application/json")
		switch request.URL.Path {
		case "/collections/student_rules":
			_, _ = response.Write([]byte(`{"result":{"payload":{}},"status":"ok"}`))
		case "/collections/student_rules/points/scroll":
			_, _ = response.Write([]byte(qdrantReleaseMetadataScrollResponseForTest(t, "regulations", "student_rules")))
		case "/collections/student_rules/points/query":
			if err := json.NewDecoder(request.Body).Decode(&captured); err != nil {
				t.Fatalf("decode qdrant query body: %v", err)
			}
			_, _ = response.Write([]byte(`{"result":{"points":[]},"status":"ok"}`))
		default:
			t.Fatalf("unexpected qdrant path %q", request.URL.Path)
		}
	}))
	defer server.Close()
	executor := qdrantRAGLookupExecutor{
		embeddingDimensions: 2560,
		embeddingModel:      "Qwen3-Embedding-4B",
		embeddingProvider:   "openai-compatible",
		httpClient:          server.Client(),
		qdrantQueryAPIKey:   "test-qdrant-key",
		qdrantURL:           server.URL,
		timeout:             time.Second,
	}

	_, err := executor.queryPoints(context.Background(), ragruntime.PlanProjection{
		Collection:       "student_rules",
		CollectionAlias:  "student_rules",
		Corpus:           "regulations",
		QueryMode:        "current",
		QueryText:        "学生请假手续",
		RunID:            "run-release-metadata-scroll",
		TopK:             3,
		RuntimeProfileID: "regulations/student_rules",
	}, []float64{0.1, 0.2, 0.3})
	if err != nil {
		t.Fatalf("query points with scroll release metadata: %v", err)
	}
	if captured == nil {
		t.Fatal("qdrant points query was not executed after release metadata scroll guard")
	}
	wantPaths := []string{
		"/collections/student_rules",
		"/collections/student_rules/points/scroll",
		"/collections/student_rules/points/query",
	}
	if strings.Join(requestPaths, "|") != strings.Join(wantPaths, "|") {
		t.Fatalf("qdrant paths = %#v, want %#v", requestPaths, wantPaths)
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
	filter := qdrantFilterForTest(t, captured)
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

func qdrantFilterForTest(t *testing.T, captured map[string]any) map[string]any {
	t.Helper()
	filter, ok := captured["filter"].(map[string]any)
	if !ok {
		prefetch, prefetchOK := captured["prefetch"].([]any)
		if !prefetchOK || len(prefetch) == 0 {
			t.Fatalf("filter = %#v and prefetch = %#v, want filter object", captured["filter"], captured["prefetch"])
		}
		firstPrefetch, ok := prefetch[0].(map[string]any)
		if !ok {
			t.Fatalf("prefetch[0] = %#v, want object", prefetch[0])
		}
		filter, ok = firstPrefetch["filter"].(map[string]any)
		if !ok {
			t.Fatalf("prefetch[0].filter = %#v, want object", firstPrefetch["filter"])
		}
	}
	return filter
}

func qdrantMustConditionPayloadsForTest(t *testing.T, captured map[string]any) map[string]map[string]any {
	t.Helper()
	filter := qdrantFilterForTest(t, captured)
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

func qdrantCollectionMetadataResponseForTest(t *testing.T, corpus string, collection string) string {
	t.Helper()
	profile, err := retrievalRuntimeProfileForTest(corpus, collection)
	if err != nil {
		t.Fatalf("load runtime profile for metadata fixture: %v", err)
	}
	metadata := releaseMetadataFixtureForHTTPTest(profile, collection)
	body, err := json.Marshal(map[string]any{
		"result": map[string]any{
			"payload": metadata,
		},
		"status": "ok",
	})
	if err != nil {
		t.Fatalf("marshal qdrant collection metadata fixture: %v", err)
	}
	return string(body)
}

func releaseMetadataFixtureForHTTPTest(
	profile retrievalruntime.RuntimeProfile,
	collection string,
) map[string]any {
	return map[string]any{
		"chunk_policy_version":                profile.ChunkPolicyVersion,
		"chunk_quality_status":                "passed",
		"cleaning_policy_version":             profile.CleaningPolicyVersion,
		"component_eval_status":               "passed",
		"dense_prefetch_limit":                profile.DensePrefetchLimit,
		"dense_vector_name":                   profile.DenseVectorName,
		"embedding_dimensions":                2560,
		"embedding_model":                     "Qwen3-Embedding-4B",
		"embedding_provider":                  "openai-compatible",
		"embedding_query_instruction_hash":    retrievalruntime.HashText(profile.EmbeddingQueryInstruction),
		"index_release_id":                    "r20260615_" + collection,
		"index_validation_status":             "passed",
		"profile_identity_hash":               retrievalruntime.ProfileIdentityHash(profile, "openai-compatible", "Qwen3-Embedding-4B", 2560),
		"qrels_coverage_status":               "passed",
		"quality_gate_status":                 "passed",
		"release_admission_status":            "passed",
		"release_metadata_consistency_status": "passed",
		"rrf_dense_weight":                    profile.RRFDenseWeight,
		"rrf_k":                               profile.RRFK,
		"rrf_sparse_weight":                   profile.RRFSparseWeight,
		"sparse_language":                     retrievalruntime.DefaultSparseLanguage,
		"sparse_model":                        retrievalruntime.DefaultSparseModel,
		"sparse_prefetch_limit":               profile.SparsePrefetchLimit,
		"sparse_provider":                     retrievalruntime.DefaultSparseProvider,
		"sparse_tokenizer":                    retrievalruntime.DefaultSparseTokenizer,
		"sparse_vector_name":                  profile.SparseVectorName,
	}
}

func qdrantReleaseMetadataScrollResponseForTest(t *testing.T, corpus string, collection string) string {
	t.Helper()
	profile, err := retrievalRuntimeProfileForTest(corpus, collection)
	if err != nil {
		t.Fatalf("load runtime profile for metadata fixture: %v", err)
	}
	metadata := releaseMetadataFixtureForHTTPTest(profile, collection)
	body, err := json.Marshal(map[string]any{
		"result": map[string]any{
			"points": []map[string]any{
				{"id": "sample-1", "payload": metadata},
				{"id": "sample-2", "payload": metadata},
			},
		},
		"status": "ok",
	})
	if err != nil {
		t.Fatalf("marshal qdrant scroll metadata fixture: %v", err)
	}
	return string(body)
}

func retrievalRuntimeProfileForTest(corpus string, collection string) (retrievalruntime.RuntimeProfile, error) {
	return retrievalruntime.LoadRuntimeProfile("", corpus, collection)
}

func mustRetrievalRuntimeProfileForTest(
	t *testing.T,
	corpus string,
	collection string,
) retrievalruntime.RuntimeProfile {
	t.Helper()
	profile, err := retrievalRuntimeProfileForTest(corpus, collection)
	if err != nil {
		t.Fatalf("load runtime profile for test: %v", err)
	}
	return profile
}
