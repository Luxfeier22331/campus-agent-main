package outboundadapter

import (
	"context"
	"encoding/json"
	"fmt"
	"math"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/campusdocs"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/config"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/execution"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/modelconfigclient"
)

func TestCampusDocsRetrievalUsesEmbeddingProviderAndReturnsNoMatch(t *testing.T) {
	collection := "campus_docs_" + strings.Repeat("a", 64)
	embeddingsCalled := false
	qdrantCalled := false
	provider := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		switch request.URL.Path {
		case "/v1/embeddings":
			embeddingsCalled = true
			var body map[string]any
			if err := json.NewDecoder(request.Body).Decode(&body); err != nil {
				t.Fatalf("decode embedding request: %v", err)
			}
			if body["model"] != campusDocsEmbeddingModel ||
				!strings.HasPrefix(body["input"].(string), "Instruct: ") ||
				body["dimensions"] != float64(campusdocs.EmbeddingDimensions) {
				t.Fatalf("embedding request = %#v", body)
			}
			if body["input"] !=
				"Instruct: "+campusdocs.EmbeddingQueryInstruction+"\nQuery:学籍规定" {
				t.Fatalf("embedding query instruction = %q", body["input"])
			}
			embedding := make([]float64, campusdocs.EmbeddingDimensions)
			embedding[0] = 0.25
			writeJSON(response, http.StatusOK, map[string]any{
				"data": []map[string]any{{"embedding": embedding}},
			})
		case "/collections/" + collection + "/points/query":
			qdrantCalled = true
			if request.Header.Get("api-key") != "qdrant-read-only" {
				t.Fatalf("qdrant api key = %q", request.Header.Get("api-key"))
			}
			var body map[string]any
			if err := json.NewDecoder(request.Body).Decode(&body); err != nil {
				t.Fatalf("decode qdrant request: %v", err)
			}
			if body["with_payload"] != true || body["with_vector"] != false {
				t.Fatalf("qdrant request = %#v", body)
			}
			writeJSON(response, http.StatusOK, map[string]any{"result": map[string]any{"points": []any{}}})
		default:
			http.NotFound(response, request)
		}
	}))
	defer provider.Close()

	client := newCampusDocsHTTPClientForTest(t,
		config.Config{
			DeploymentEnvironment: "local",
			QdrantURL:             provider.URL,
			QdrantReadOnlyAPIKey:  "qdrant-read-only",
		},
		campusDocsRuntimeConfigResolverForTest(provider.URL+"/v1///"),
	)
	evidence, err := client.Search(
		t.Context(),
		campusdocs.Index{Collection: collection},
		"学籍规定",
		campusdocs.SearchResultLimit,
	)
	if err != nil {
		t.Fatalf("retrieve Campus docs evidence: %v", err)
	}
	if len(evidence) != 0 {
		t.Fatalf("no-match evidence = %#v", evidence)
	}
	result := campusdocs.EncodeSearchResult(evidence, 1)
	if result["outcome"] != "no_match" {
		t.Fatalf("no-match result = %#v", result)
	}
	if !embeddingsCalled || !qdrantCalled {
		t.Fatalf("embedding called = %t, qdrant called = %t", embeddingsCalled, qdrantCalled)
	}
}

func TestCampusDocsRetrievalReranksCandidatesBeforeEvidenceLimit(t *testing.T) {
	collection := "campus_docs_" + strings.Repeat("c", 64)
	points := make([]qdrantPoint, 7)
	for index := range points {
		points[index] = validCampusDocsPointAtTest(index)
	}

	embeddingsCalled := false
	qdrantCalled := false
	rerankCalled := false
	provider := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		switch request.URL.Path {
		case "/v1/embeddings":
			embeddingsCalled = true
			embedding := make([]float64, campusdocs.EmbeddingDimensions)
			embedding[0] = 0.25
			writeJSON(response, http.StatusOK, map[string]any{
				"data": []map[string]any{{"embedding": embedding}},
			})
		case "/v1/rerank":
			rerankCalled = true
			var body map[string]any
			if err := json.NewDecoder(request.Body).Decode(&body); err != nil {
				t.Fatalf("decode rerank request: %v", err)
			}
			if body["model"] != campusDocsRerankModel || body["query"] != "学籍规定" {
				t.Fatalf("rerank request = %#v", body)
			}
			documents, ok := body["documents"].([]any)
			if !ok || len(documents) != len(points) {
				t.Fatalf("rerank documents = %#v", body["documents"])
			}
			results := make([]map[string]any, len(points))
			for index := range points {
				results[index] = map[string]any{
					"index":           len(points) - index - 1,
					"relevance_score": 0.99 - float64(index)*0.05,
				}
			}
			writeJSON(response, http.StatusOK, map[string]any{"results": results})
		case "/collections/" + collection + "/points/query":
			qdrantCalled = true
			writeJSON(response, http.StatusOK, map[string]any{
				"result": map[string]any{"points": points},
			})
		default:
			http.NotFound(response, request)
		}
	}))
	defer provider.Close()

	client := newCampusDocsHTTPClientForTest(t,
		config.Config{
			DeploymentEnvironment: "local",
			QdrantURL:             provider.URL,
			QdrantReadOnlyAPIKey:  "qdrant-read-only",
		},
		campusDocsRuntimeConfigResolverForTest(provider.URL+"/v1///"),
	)
	evidence, err := client.Search(
		t.Context(),
		campusdocs.Index{Collection: collection},
		"学籍规定",
		campusdocs.SearchResultLimit,
	)
	if err != nil {
		t.Fatalf("retrieve Campus docs evidence: %v", err)
	}
	if len(evidence) != campusdocs.SearchResultLimit {
		t.Fatalf("evidence count = %d, want %d", len(evidence), campusdocs.SearchResultLimit)
	}
	for index, item := range evidence {
		want := fmt.Sprintf("chunk-%d", len(points)-index-1)
		if item.DocumentID != "student-rules" || !strings.Contains(item.Text, want) {
			t.Fatalf("evidence[%d] = %#v, want %s", index, item, want)
		}
	}
	if !embeddingsCalled || !qdrantCalled || !rerankCalled {
		t.Fatalf("embedding called = %t, qdrant called = %t, rerank called = %t", embeddingsCalled, qdrantCalled, rerankCalled)
	}
}

func TestCampusDocsRerankerKeepsThresholdBoundaryAndDropsLowerScores(t *testing.T) {
	provider := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		if request.URL.Path != "/v1/rerank" {
			http.NotFound(response, request)
			return
		}
		if request.Header.Get("X-Failover-Enabled") != "true" {
			response.WriteHeader(http.StatusBadRequest)
			return
		}
		writeJSON(response, http.StatusOK, map[string]any{
			"results": []map[string]any{
				{"index": 1, "relevance_score": 0.499},
				{"index": 2, "relevance_score": campusDocsRerankRelevanceThreshold},
				{"index": 0, "relevance_score": 0.9},
			},
		})
	}))
	defer provider.Close()

	candidates := make([]campusDocsCandidate, 3)
	for index := range candidates {
		point := validCampusDocsPointAtTest(index)
		candidate, err := campusDocsCandidateFromQdrantPoint(
			campusdocs.Index{Collection: "campus_docs_" + strings.Repeat("e", 64)},
			point,
		)
		if err != nil {
			t.Fatalf("build candidate %d: %v", index, err)
		}
		candidates[index] = candidate
	}
	ranked, err := (&campusDocsHTTPClient{rerankHTTPClient: provider.Client()}).rerankCampusDocsCandidates(
		t.Context(),
		modelconfigclient.RuntimeConfig{
			APIKey:        "test-embedding-key",
			BaseURL:       provider.URL + "/v1",
			Model:         campusDocsRerankModel,
			Name:          "campus_docs_reranker",
			Provider:      "cohere-compatible",
			APIProtocol:   "cohere.rerank",
			SchemaVersion: "model_runtime_config.v1",
			TargetSHA256:  "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
		},
		"学籍规定",
		candidates,
	)
	if err != nil {
		t.Fatalf("rerank candidates: %v", err)
	}
	if len(ranked) != 2 || !strings.Contains(ranked[0].result.Text, "chunk-0") ||
		!strings.Contains(ranked[1].result.Text, "chunk-2") {
		t.Fatalf("threshold-filtered candidates = %#v", ranked)
	}
}

func TestCampusDocsRetrievalReturnsNoMatchWhenAllRerankerScoresAreBelowThreshold(t *testing.T) {
	collection := "campus_docs_" + strings.Repeat("f", 64)
	rerankCalled := false
	provider := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		switch request.URL.Path {
		case "/v1/embeddings":
			embedding := make([]float64, campusdocs.EmbeddingDimensions)
			writeJSON(response, http.StatusOK, map[string]any{
				"data": []map[string]any{{"embedding": embedding}},
			})
		case "/v1/rerank":
			rerankCalled = true
			writeJSON(response, http.StatusOK, map[string]any{
				"results": []map[string]any{
					{"index": 0, "relevance_score": 0.2},
					{"index": 1, "relevance_score": 0.1},
				},
			})
		case "/collections/" + collection + "/points/query":
			writeJSON(response, http.StatusOK, map[string]any{
				"result": map[string]any{
					"points": []qdrantPoint{validCampusDocsPointAtTest(0), validCampusDocsPointAtTest(1)},
				},
			})
		default:
			http.NotFound(response, request)
		}
	}))
	defer provider.Close()

	client := newCampusDocsHTTPClientForTest(t,
		config.Config{
			DeploymentEnvironment: "local",
			QdrantURL:             provider.URL,
			QdrantReadOnlyAPIKey:  "qdrant-read-only",
		},
		campusDocsRuntimeConfigResolverForTest(provider.URL+"/v1///"),
	)
	evidence, err := client.Search(
		t.Context(),
		campusdocs.Index{Collection: collection},
		"火星校区服务",
		campusdocs.SearchResultLimit,
	)
	if err != nil {
		t.Fatalf("retrieve Campus docs evidence: %v", err)
	}
	result := campusdocs.EncodeSearchResult(evidence, 1)
	if !rerankCalled || len(evidence) != 0 || result["outcome"] != "no_match" {
		t.Fatalf("low-score retrieval result = %#v; rerank called = %t", result, rerankCalled)
	}
}

func TestCampusDocsRetrievalDoesNotFallbackWhenRerankerResponseIsInvalid(t *testing.T) {
	collection := "campus_docs_" + strings.Repeat("d", 64)
	provider := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		switch request.URL.Path {
		case "/v1/embeddings":
			embedding := make([]float64, campusdocs.EmbeddingDimensions)
			writeJSON(response, http.StatusOK, map[string]any{
				"data": []map[string]any{{"embedding": embedding}},
			})
		case "/v1/rerank":
			writeJSON(response, http.StatusOK, map[string]any{
				"results": []map[string]any{{"index": 1, "relevance_score": 0.9}},
			})
		case "/collections/" + collection + "/points/query":
			writeJSON(response, http.StatusOK, map[string]any{
				"result": map[string]any{"points": []qdrantPoint{validCampusDocsPointAtTest(0)}},
			})
		default:
			http.NotFound(response, request)
		}
	}))
	defer provider.Close()

	client := newCampusDocsHTTPClientForTest(t,
		config.Config{
			DeploymentEnvironment: "local",
			QdrantURL:             provider.URL,
			QdrantReadOnlyAPIKey:  "qdrant-read-only",
		},
		campusDocsRuntimeConfigResolverForTest(provider.URL+"/v1///"),
	)
	evidence, err := client.Search(
		t.Context(),
		campusdocs.Index{Collection: collection},
		"学籍规定",
		campusdocs.SearchResultLimit,
	)
	if err == nil || !strings.Contains(err.Error(), "reranker response index is invalid") {
		t.Fatalf("invalid reranker response error = %v", err)
	}
	if evidence != nil {
		t.Fatalf("invalid reranker response returned fallback evidence = %#v", evidence)
	}
}

func TestValidateCampusDocsRerankResultsRejectsInvalidIndexesAndScores(t *testing.T) {
	indexValue := func(value int) *int { return &value }
	scoreValue := func(value float64) *float64 { return &value }
	tests := map[string][]campusDocsRerankResultWire{
		"out of range": {
			{Index: indexValue(2), RelevanceScore: scoreValue(0.9)},
			{Index: indexValue(0), RelevanceScore: scoreValue(0.8)},
		},
		"duplicate": {
			{Index: indexValue(0), RelevanceScore: scoreValue(0.9)},
			{Index: indexValue(0), RelevanceScore: scoreValue(0.8)},
		},
		"missing score": {
			{Index: indexValue(0), RelevanceScore: nil},
			{Index: indexValue(1), RelevanceScore: scoreValue(0.8)},
		},
		"non finite score": {
			{Index: indexValue(0), RelevanceScore: scoreValue(math.NaN())},
			{Index: indexValue(1), RelevanceScore: scoreValue(0.8)},
		},
	}
	for name, results := range tests {
		t.Run(name, func(t *testing.T) {
			if err := validateCampusDocsRerankResults(results, 2); err == nil {
				t.Fatalf("invalid reranker response was accepted: %#v", results)
			}
		})
	}
}

func TestCampusDocsCandidateValidatesPayloadIdentityAndURL(t *testing.T) {
	index := campusdocs.Index{Collection: "campus_docs_" + strings.Repeat("b", 64)}
	point := validCampusDocsPointForTest()
	if _, err := campusDocsCandidateFromQdrantPoint(index, point); err != nil {
		t.Fatalf("valid Campus docs point rejected: %v", err)
	}

	for name, mutate := range map[string]func(map[string]any){
		"text hash":     func(payload map[string]any) { payload["text_sha256"] = "sha256:" + strings.Repeat("0", 64) },
		"section URL":   func(payload map[string]any) { payload["section_ref"] = "/docs/regulations/student_rules/attendance" },
		"root unit ids": func(payload map[string]any) { payload["root_unit_ids"] = []any{"unit-1", "unit-1"} },
		"version slug":  func(payload map[string]any) { payload["version_slug"] = "2026-current" },
	} {
		t.Run(name, func(t *testing.T) {
			mutated := validCampusDocsPointForTest()
			mutate(mutated.Payload)
			if _, err := campusDocsCandidateFromQdrantPoint(index, mutated); err == nil {
				t.Fatalf("invalid %s was accepted", name)
			}
		})
	}
}

func TestCampusNoticeCandidateValidatesCitationIdentity(t *testing.T) {
	index := campusdocs.Index{Collection: "campus_docs_" + strings.Repeat("c", 64)}
	text := "通知正文"
	point := qdrantPoint{
		ID:    "notice-point",
		Score: 0.91,
		Payload: map[string]any{
			"citation_href":         "/notices/54321",
			"chunk_id":              "notice-chunk",
			"notice_id":             "12345",
			"retrieval_text_sha256": execution.SHA256TextRef("通知\n" + text),
			"schema_version":        "campus_rag_point.v1",
			"section_title":         "正文",
			"text":                  text,
			"text_sha256":           execution.SHA256TextRef(text),
			"title":                 "通知",
		},
	}
	if _, err := campusDocsCandidateFromQdrantPoint(index, point); err == nil {
		t.Fatal("accepted notice point whose citation href identifies another notice")
	}
}

func TestCampusDocsEmbeddingRejectsNonFiniteValues(t *testing.T) {
	embedding := make([]float64, campusdocs.EmbeddingDimensions)
	embedding[17] = math.NaN()
	if err := validateCampusDocsEmbedding(embedding); err == nil {
		t.Fatal("non-finite embedding was accepted")
	}
}

func validCampusDocsPointForTest() qdrantPoint {
	return validCampusDocsPointAtTest(0)
}

func validCampusDocsPointAtTest(index int) qdrantPoint {
	text := fmt.Sprintf("学生应当在规定期限内提交材料，候选 chunk-%d。", index)
	return qdrantPoint{
		ID:    fmt.Sprintf("chunk-%d", index),
		Score: 0.91,
		Payload: map[string]any{
			"chunk_id":              fmt.Sprintf("chunk-%d", index),
			"document_id":           "student-rules",
			"document_title":        "学生管理规定",
			"retrieval_text_sha256": execution.SHA256TextRef(fmt.Sprintf("retrieval-%d", index)),
			"root_unit_ids":         []any{fmt.Sprintf("attendance-%d", index)},
			"schema_version":        "campus_docs_point.v3",
			"section_ref":           fmt.Sprintf("/docs/regulations/student_rules/attendance/v/2026#attendance-%d", index),
			"section_title":         "材料提交",
			"text":                  text,
			"text_sha256":           execution.SHA256TextRef(text),
			"version_id":            "student-rules-2026",
			"version_slug":          "2026",
		},
	}
}

const (
	campusDocsEmbeddingModel = "Qwen3-Embedding-4B"
	campusDocsRerankModel    = "Qwen3-Reranker-4B"
)

func newCampusDocsHTTPClientForTest(
	t *testing.T,
	cfg config.Config,
	resolver runtimeConfigResolver,
) *campusDocsHTTPClient {
	t.Helper()
	searcher, err := NewCampusDocsSearcher(cfg, resolver)
	if err != nil {
		t.Fatalf("build Campus docs searcher: %v", err)
	}
	client, ok := searcher.(*campusDocsHTTPClient)
	if !ok {
		t.Fatalf("Campus docs searcher type = %T, want *campusDocsHTTPClient", searcher)
	}
	return client
}

type staticCampusDocsRuntimeConfigResolverForTest map[string]modelconfigclient.RuntimeConfig

func campusDocsRuntimeConfigResolverForTest(baseURL string) staticCampusDocsRuntimeConfigResolverForTest {
	return staticCampusDocsRuntimeConfigResolverForTest{
		"campus_docs_embedding": {
			APIKey:        "test-embedding-key",
			APIProtocol:   "openai.embeddings",
			BaseURL:       baseURL,
			Model:         campusDocsEmbeddingModel,
			Name:          "campus_docs_embedding",
			Provider:      "openai-compatible",
			SchemaVersion: "model_runtime_config.v1",
			TargetSHA256:  strings.Repeat("a", 64),
		},
		"campus_docs_reranker": {
			APIKey:        "test-reranker-key",
			APIProtocol:   "cohere.rerank",
			BaseURL:       baseURL,
			Model:         campusDocsRerankModel,
			Name:          "campus_docs_reranker",
			Provider:      "cohere-compatible",
			SchemaVersion: "model_runtime_config.v1",
			TargetSHA256:  strings.Repeat("b", 64),
		},
	}
}

func (resolver staticCampusDocsRuntimeConfigResolverForTest) ResolveRuntimeConfig(
	_ context.Context,
	name string,
) (modelconfigclient.RuntimeConfig, error) {
	snapshot, ok := resolver[name]
	if !ok {
		return modelconfigclient.RuntimeConfig{}, fmt.Errorf("no runtime config for %s", name)
	}
	return snapshot, nil
}

func writeJSON(response http.ResponseWriter, status int, body any) {
	response.Header().Set("content-type", "application/json")
	response.WriteHeader(status)
	_ = json.NewEncoder(response).Encode(body)
}
