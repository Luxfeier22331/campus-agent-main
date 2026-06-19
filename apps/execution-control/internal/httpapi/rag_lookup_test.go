package httpapi

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/config"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/ragruntime"
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
		configResolver:    defaultRAGEmbeddingResolverForTest(),
		httpClient:        server.Client(),
		qdrantQueryAPIKey: "test-qdrant-key",
		qdrantURL:         server.URL,
		timeout:           time.Second,
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
		configResolver:    defaultRAGEmbeddingResolverForTest(),
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
		configResolver:    defaultRAGEmbeddingResolverForTest(),
		httpClient:        server.Client(),
		qdrantQueryAPIKey: "test-qdrant-key",
		qdrantURL:         server.URL,
		timeout:           time.Second,
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
		configResolver:    defaultRAGEmbeddingResolverForTest(),
		httpClient:        server.Client(),
		qdrantQueryAPIKey: "test-qdrant-key",
		qdrantURL:         server.URL,
		timeout:           time.Second,
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
		configResolver:    defaultRAGEmbeddingResolverForTest(),
		httpClient:        server.Client(),
		qdrantQueryAPIKey: "test-qdrant-key",
		qdrantURL:         server.URL,
		timeout:           time.Second,
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
		configResolver: staticProviderConfigResolver{
			"rag_query_embedding": embeddingProviderConfigSnapshotForTest(
				providerConfigRoleRAGQueryEmbedding,
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
		configResolver: staticProviderConfigResolver{
			"rag_query_embedding": embeddingProviderConfigSnapshotForTest(
				providerConfigRoleRAGQueryEmbedding,
				server.URL,
				"Qwen3-Embedding-4B",
				2560,
			),
		},
		embeddingHTTPClient: server.Client(),
	}

	_, err := executor.embedQuery(context.Background(), "学生请假手续")
	if err == nil {
		t.Fatal("embedding dimension mismatch must fail closed")
	}
	if !strings.Contains(err.Error(), "embedding dimension") {
		t.Fatalf("error = %v, want embedding dimension diagnostic", err)
	}
}

func TestNewQdrantRAGLookupExecutorRejectsHTTPDataPlaneWithAPIKeyOutsideLocalProfile(t *testing.T) {
	_, err := newQdrantRAGLookupExecutor(config.Config{
		EmbeddingAPIKey:      "embedding-key",
		EmbeddingBaseURL:     "https://provider.example/v1",
		EmbeddingDimensions:  3,
		EmbeddingModel:       "embedding-model",
		QdrantQueryAPIKey:    "readonly-key",
		QdrantTLSCACertPath:  "/srv/docker/campus-agent/staging/qdrant/tls/ca.pem",
		QdrantTimeoutSeconds: 10,
		QdrantURL:            "http://qdrant:6333",
		RuntimeProfile:       "staging",
	}, nil)
	if err == nil {
		t.Fatal("authenticated Qdrant data-plane must reject http:// URLs")
	}
	if !strings.Contains(err.Error(), "QDRANT_URL must use https") {
		t.Fatalf("error = %v, want https diagnostic", err)
	}
}

func TestNewQdrantRAGLookupExecutorAllowsLocalHTTPDataPlaneWithAPIKey(t *testing.T) {
	executor, err := newQdrantRAGLookupExecutor(config.Config{
		EmbeddingAPIKey:      "embedding-key",
		EmbeddingBaseURL:     "https://provider.example/v1",
		EmbeddingDimensions:  3,
		EmbeddingModel:       "embedding-model",
		QdrantQueryAPIKey:    "readonly-key",
		QdrantTimeoutSeconds: 10,
		QdrantURL:            "http://qdrant:6333",
		RuntimeProfile:       "local",
	}, nil)
	if err != nil {
		t.Fatalf("local authenticated Qdrant http data-plane rejected: %v", err)
	}
	if executor == nil {
		t.Fatal("executor is nil")
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
	}, nil)
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
	}, nil)
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

func TestNewQdrantRAGLookupExecutorUsesSplitTimeouts(t *testing.T) {
	qdrant := httptest.NewTLSServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		_, _ = response.Write([]byte("all shards are ready"))
	}))
	defer qdrant.Close()
	caPath := writeTestCACert(t, qdrant)

	lookupExecutor, err := newQdrantRAGLookupExecutor(config.Config{
		QdrantQueryAPIKey:     "readonly-key",
		QdrantTLSCACertPath:   caPath,
		QdrantTimeoutSeconds:  10,
		QdrantURL:             qdrant.URL,
		RAGEmbeddingTimeoutMS: 2500,
		RAGQdrantTimeoutMS:    3500,
	}, staticProviderConfigResolver{
		string(providerConfigRoleRAGQueryEmbedding): embeddingProviderConfigSnapshotForTest(
			providerConfigRoleRAGQueryEmbedding,
			"https://provider.example/v1",
			"embedding-model",
			3,
		),
	})
	if err != nil {
		t.Fatalf("new qdrant executor: %v", err)
	}
	executor, ok := lookupExecutor.(qdrantRAGLookupExecutor)
	if !ok {
		t.Fatalf("executor type = %T, want qdrantRAGLookupExecutor", lookupExecutor)
	}
	if executor.embeddingHTTPClient.Timeout.String() != "2.5s" {
		t.Fatalf("embedding timeout = %s, want 2.5s", executor.embeddingHTTPClient.Timeout)
	}
	if executor.httpClient.Timeout.String() != "3.5s" {
		t.Fatalf("qdrant timeout = %s, want 3.5s", executor.httpClient.Timeout)
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
	}, nil)
	if err == nil {
		t.Fatal("QDRANT_TLS_CA_CERT_PATH must be required for HTTPS Qdrant")
	}
	if !strings.Contains(err.Error(), "QDRANT_TLS_CA_CERT_PATH") {
		t.Fatalf("error = %v, want TLS CA diagnostic", err)
	}
}
