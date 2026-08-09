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
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/toolreadmodel"
)

type knowledgeReadModelStoreForTest struct {
	currentReleaseFn func(
		context.Context,
		string,
	) (toolreadmodel.KnowledgeServingRelease, bool, error)
}

func (s knowledgeReadModelStoreForTest) CurrentRelease(
	ctx context.Context,
	documentScope string,
) (toolreadmodel.KnowledgeServingRelease, bool, error) {
	if s.currentReleaseFn != nil {
		return s.currentReleaseFn(ctx, documentScope)
	}
	collections := map[string]struct {
		corpus     string
		collection string
	}{
		"curriculum":          {corpus: "curriculum", collection: "curriculum_plan"},
		"institutional_rules": {corpus: "regulations", collection: "institutional_rules"},
		"student_rules":       {corpus: "regulations", collection: "student_rules"},
	}
	entry, ok := collections[documentScope]
	if !ok {
		return toolreadmodel.KnowledgeServingRelease{}, false, nil
	}
	return toolreadmodel.KnowledgeServingRelease{
		Collection:          entry.collection,
		Corpus:              entry.corpus,
		DocumentScope:       documentScope,
		EmbeddingDimensions: 2560,
		EmbeddingModel:      "Qwen3-Embedding-4B",
		QdrantCollection:    entry.collection + "__admitted_release",
		ReleaseID:           "knowledge:admitted:" + documentScope,
	}, true, nil
}

func knowledgeReadModelForTest() *toolreadmodel.Runtime {
	return toolreadmodel.NewRuntime(toolreadmodel.Options{
		KnowledgeReadModelStore: knowledgeReadModelStoreForTest{},
	})
}

func knowledgeReadModelWithStoreForTest(store knowledgeReadModelStoreForTest) *toolreadmodel.Runtime {
	return toolreadmodel.NewRuntime(toolreadmodel.Options{KnowledgeReadModelStore: store})
}

func TestDocumentScopeAdmissionFreezesEveryPublishedRelease(t *testing.T) {
	server := NewServer(config.Config{})
	server.toolReadModel = knowledgeReadModelForTest()

	scopes, err := server.documentScopesForAgent(
		context.Background(),
		[]string{"student_rules", "institutional_rules", "curriculum"},
	)
	if err != nil {
		t.Fatalf("resolve document scope admission: %v", err)
	}
	if len(scopes) != 3 {
		t.Fatalf("document scopes = %#v, want three published scopes", scopes)
	}
	for _, scope := range scopes {
		if scope.ReleaseID != "knowledge:admitted:"+scope.Scope ||
			scope.QdrantCollection != scope.Collection+"__admitted_release" ||
			scope.QdrantCollection == scope.Collection {
			t.Fatalf("scope %s is not frozen to an immutable release: %#v", scope.Scope, scope)
		}
	}
}

func TestDocumentScopeAdmissionFailsClosedWithoutCompatibleRelease(t *testing.T) {
	base := knowledgeReadModelStoreForTest{}
	tests := []struct {
		name      string
		resolve   func(context.Context, string) (toolreadmodel.KnowledgeServingRelease, bool, error)
		wantError string
	}{
		{
			name: "missing current release",
			resolve: func(context.Context, string) (toolreadmodel.KnowledgeServingRelease, bool, error) {
				return toolreadmodel.KnowledgeServingRelease{}, false, nil
			},
			wantError: "does not have a current knowledge release",
		},
		{
			name: "incompatible release",
			resolve: func(ctx context.Context, scope string) (toolreadmodel.KnowledgeServingRelease, bool, error) {
				release, found, err := base.CurrentRelease(ctx, scope)
				release.EmbeddingDimensions++
				return release, found, err
			},
			wantError: "current release is incompatible with serving config",
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			server := NewServer(config.Config{})
			server.toolReadModel = knowledgeReadModelWithStoreForTest(knowledgeReadModelStoreForTest{
				currentReleaseFn: test.resolve,
			})
			_, err := server.documentScopesForAgent(context.Background(), []string{"student_rules"})
			if err == nil || !strings.Contains(err.Error(), test.wantError) {
				t.Fatalf("admission error = %v, want %q", err, test.wantError)
			}
		})
	}
}

func TestQdrantDocumentEvidenceQueryUsesHybridPrefetchFromServingConfig(t *testing.T) {
	var captured map[string]any
	server := qdrantQueryServerForTest(t, &captured)
	defer server.Close()
	executor := qdrantDocumentEvidenceExecutor{
		configResolver:     defaultDocumentEvidenceEmbeddingResolverForTest(),
		httpClient:         server.Client(),
		knowledgeReadModel: knowledgeReadModelForTest(),
		qdrantQueryAPIKey:  "test-qdrant-key",
		qdrantURL:          server.URL,
		timeout:            time.Second,
	}
	points, err := executor.queryPoints(context.Background(), retrievalruntime.SearchRequest{
		QueryText:         "学生请假手续",
		ServingConfigPath: "regulations/student_rules/serving-config.json",
		RetrievalAccess:   publicRetrievalAccessProjectionForTest(),
		DocumentScope:     "student_rules",
		CandidateTopK:     3,
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

func qdrantQueryServerForTest(t *testing.T, captured *map[string]any) *httptest.Server {
	t.Helper()
	return httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		if request.URL.Path != "/collections/student_rules__admitted_release/points/query" {
			t.Fatalf("qdrant path = %q", request.URL.Path)
		}
		if err := json.NewDecoder(request.Body).Decode(captured); err != nil {
			t.Fatalf("decode qdrant query body: %v", err)
		}
		response.Header().Set("content-type", "application/json")
		_, _ = response.Write([]byte(`{"result":{"points":[{"id":"point-1","score":0.91,"payload":{"section_ref":"section://student_rules/doc-1/v3/leave"}}]},"status":"ok"}`))
	}))
}

func TestQdrantDocumentEvidenceEmbeddingRequestUsesConfiguredDimensions(t *testing.T) {
	var captured map[string]any
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		if err := json.NewDecoder(request.Body).Decode(&captured); err != nil {
			t.Fatalf("decode embedding request: %v", err)
		}
		response.Header().Set("content-type", "application/json")
		_, _ = response.Write([]byte(embeddingResponseForTest(2560)))
	}))
	defer server.Close()
	executor := qdrantDocumentEvidenceExecutor{
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

func TestQdrantDocumentEvidenceEmbeddingFailsOnDimensionMismatch(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, _ *http.Request) {
		response.Header().Set("content-type", "application/json")
		_, _ = response.Write([]byte(`{"data":[{"embedding":[0.1,0.2,0.3]}]}`))
	}))
	defer server.Close()
	executor := qdrantDocumentEvidenceExecutor{
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

func TestQdrantDocumentEvidenceServingConfigsFollowPublishedTargets(t *testing.T) {
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
	executor := qdrantDocumentEvidenceExecutor{servingConfigRoot: profileRoot}
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

func TestNewQdrantDocumentEvidenceExecutorRejectsHTTPOutsideLocal(t *testing.T) {
	_, err := newQdrantDocumentEvidenceExecutor(config.Config{
		DeploymentEnvironment: "staging",
		QdrantReadOnlyAPIKey:  "readonly-key",
		QdrantTLSCACertPath:   "/srv/qdrant/tls/ca.pem",
		QdrantURL:             "http://qdrant:6333",
	}, defaultDocumentEvidenceEmbeddingResolverForTest(), knowledgeReadModelForTest())
	if err == nil || !strings.Contains(err.Error(), "QDRANT_URL must use https") {
		t.Fatalf("error = %v, want https diagnostic", err)
	}
}

func TestNewQdrantDocumentEvidenceExecutorAllowsLocalHTTP(t *testing.T) {
	executor, err := newQdrantDocumentEvidenceExecutor(config.Config{
		DeploymentEnvironment: "local",
		QdrantReadOnlyAPIKey:  "readonly-key",
		QdrantURL:             "http://qdrant:6333",
	}, defaultDocumentEvidenceEmbeddingResolverForTest(), knowledgeReadModelForTest())
	if err != nil || executor == nil {
		t.Fatalf("local qdrant executor = %#v, error = %v", executor, err)
	}
}

func TestNewQdrantDocumentEvidenceExecutorUsesQueryKeyAndTLSCA(t *testing.T) {
	qdrant := httptest.NewTLSServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		if request.Method != http.MethodPost || request.URL.Path != "/collections/student_rules__admitted_release/points/query" {
			t.Fatalf("qdrant request = %s %s", request.Method, request.URL.Path)
		}
		if request.Header.Get("api-key") != "readonly-key" {
			t.Fatalf("qdrant api-key = %q", request.Header.Get("api-key"))
		}
		response.Header().Set("content-type", "application/json")
		_, _ = response.Write([]byte(`{"result":{"points":[{"id":"point-1","score":0.91,"payload":{"section_ref":"section://student_rules/doc-1/v3/leave"}}]},"status":"ok"}`))
	}))
	defer qdrant.Close()
	configured, err := newQdrantDocumentEvidenceExecutor(config.Config{
		QdrantReadOnlyAPIKey: "readonly-key",
		QdrantTLSCACertPath:  writeTestCACert(t, qdrant),
		QdrantURL:            qdrant.URL,
	}, defaultDocumentEvidenceEmbeddingResolverForTest(), knowledgeReadModelForTest())
	if err != nil {
		t.Fatalf("new qdrant executor: %v", err)
	}
	executor := configured.(qdrantDocumentEvidenceExecutor)
	points, err := executor.queryPoints(context.Background(), retrievalruntime.SearchRequest{
		QueryText:         "学生请假手续",
		ServingConfigPath: "regulations/student_rules/serving-config.json",
		RetrievalAccess:   publicRetrievalAccessProjectionForTest(),
		DocumentScope:     "student_rules",
		CandidateTopK:     3,
	}, make([]float64, 2560))
	if err != nil {
		t.Fatalf("qdrant query: %v", err)
	}
	if len(points) != 1 {
		t.Fatalf("qdrant point count = %d, want 1", len(points))
	}
}

func TestNewQdrantDocumentEvidenceExecutorUsesSplitTimeouts(t *testing.T) {
	qdrant := httptest.NewTLSServer(http.HandlerFunc(func(response http.ResponseWriter, _ *http.Request) {
		_, _ = response.Write([]byte("all shards are ready"))
	}))
	defer qdrant.Close()
	lookupExecutor, err := newQdrantDocumentEvidenceExecutor(config.Config{
		QdrantReadOnlyAPIKey:  "readonly-key",
		QdrantTLSCACertPath:   writeTestCACert(t, qdrant),
		QdrantURL:             qdrant.URL,
		RAGEmbeddingTimeoutMS: 2500,
		RAGQdrantTimeoutMS:    3500,
	}, defaultDocumentEvidenceEmbeddingResolverForTest(), knowledgeReadModelForTest())
	if err != nil {
		t.Fatalf("new qdrant executor: %v", err)
	}
	executor := lookupExecutor.(qdrantDocumentEvidenceExecutor)
	if executor.embeddingHTTPClient.Timeout != 2500*time.Millisecond ||
		executor.httpClient.Timeout != 3500*time.Millisecond {
		t.Fatalf("timeouts = %s / %s", executor.embeddingHTTPClient.Timeout, executor.httpClient.Timeout)
	}
}

func TestNewQdrantDocumentEvidenceExecutorFailsWithoutTLSCA(t *testing.T) {
	_, err := newQdrantDocumentEvidenceExecutor(config.Config{
		QdrantReadOnlyAPIKey: "readonly-key",
		QdrantURL:            "https://qdrant:6333",
	}, defaultDocumentEvidenceEmbeddingResolverForTest(), knowledgeReadModelForTest())
	if err == nil || !strings.Contains(err.Error(), "QDRANT_TLS_CA_CERT_PATH") {
		t.Fatalf("error = %v, want TLS CA diagnostic", err)
	}
}
