package httpapi

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/campusdocs"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/providerconfig"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/temporalruntime"
)

type campusDocsIndexStoreFixture struct {
	index campusdocs.Index
	found bool
	err   error
}

func (s campusDocsIndexStoreFixture) CurrentIndex(context.Context) (campusdocs.Index, bool, error) {
	return s.index, s.found, s.err
}

func campusDocsIndexStoreForTest() campusdocs.IndexStore {
	return campusDocsIndexStoreFixture{
		found: true,
		index: campusDocsIndexForTest(),
	}
}

func campusDocsIndexForTest() campusdocs.Index {
	return campusdocs.Index{
		Collection:                "campus_docs_" + repeatedHex("a", 64),
		DenseVectorName:           "dense",
		EmbeddingDimensions:       2560,
		EmbeddingQueryInstruction: "Given a Campus Web document question, retrieve relevant current passages that answer the query.",
		EmbeddingSpaceID:          "qwen3-embedding-4b@2560-v1",
		SparseModel:               "fnv1a_log_tf.v1",
		SparseVectorName:          "sparse",
	}
}

func campusDocsTargetForHTTPTest() *temporalruntime.CampusDocsIndexSnapshot {
	return &temporalruntime.CampusDocsIndexSnapshot{
		Collection:                "campus_docs_" + repeatedHex("d", 64),
		DenseVectorName:           "dense",
		EmbeddingDimensions:       3,
		EmbeddingQueryInstruction: "retrieve Campus Web document passages",
		EmbeddingSpaceID:          "embedding-test-space-v1",
		SparseModel:               "fnv1a_log_tf.v1",
		SparseVectorName:          "sparse",
	}
}

func TestCampusDocsQueryUsesFrozenCollectionAndExplicitSparseVector(t *testing.T) {
	var received map[string]any
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		if request.URL.Path != "/collections/"+campusDocsTargetForHTTPTest().Collection+"/points/query" {
			t.Fatalf("path = %s", request.URL.Path)
		}
		if err := json.NewDecoder(request.Body).Decode(&received); err != nil {
			t.Fatalf("decode request: %v", err)
		}
		response.Header().Set("content-type", "application/json")
		_, _ = response.Write([]byte(`{"result":{"points":[]}}`))
	}))
	defer server.Close()
	executor := campusDocsQdrantClient{
		httpClient:        server.Client(),
		qdrantURL:         server.URL,
		qdrantQueryAPIKey: "test-key",
	}
	target := campusDocsTargetForHTTPTest()
	if _, err := executor.queryCampusDocsPoints(context.Background(), "学生请假", []float64{0.1, 0.2, 0.3}, target); err != nil {
		t.Fatal(err)
	}
	prefetch, ok := received["prefetch"].([]any)
	if !ok || len(prefetch) != 2 {
		t.Fatalf("prefetch = %#v", received["prefetch"])
	}
	if received["limit"] != float64(campusDocsCandidateLimit) {
		t.Fatalf("limit = %#v, want %d", received["limit"], campusDocsCandidateLimit)
	}
	for index, raw := range prefetch {
		item, ok := raw.(map[string]any)
		if !ok || item["limit"] != float64(campusDocsCandidateLimit) {
			t.Fatalf("prefetch[%d].limit = %#v, want %d", index, item["limit"], campusDocsCandidateLimit)
		}
	}
	if strings.Contains(stringValue(prefetch[1]), "qdrant/bm25") {
		t.Fatal("query still requests Qdrant text inference")
	}
}

func TestCampusDocsEmbeddingAdmissionDoesNotDuplicateIndexVectorSpace(t *testing.T) {
	target := campusDocsTargetForHTTPTest()
	provider := providerconfig.RuntimeSetting{
		APIKey:    "secret",
		BaseURL:   "https://embedding.example/v1",
		Kind:      providerconfig.KindEmbedding,
		Model:     providerconfig.CanonicalEmbeddingModel,
		Provider:  providerconfig.CanonicalEmbeddingProvider,
		Transport: providerconfig.CanonicalEmbeddingTransport,
	}
	if err := validateCampusDocsEmbeddingAdmission(target, provider); err != nil {
		t.Fatalf("provider connection was incorrectly coupled to index vector space: %v", err)
	}
}

func TestCampusDocsEmbeddingRequestUsesAdmittedIndexDimensions(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		var payload map[string]any
		if err := json.NewDecoder(request.Body).Decode(&payload); err != nil {
			t.Fatalf("decode request: %v", err)
		}
		if payload["dimensions"] != float64(3) {
			t.Fatalf("dimensions = %#v, want 3", payload["dimensions"])
		}
		_, _ = response.Write([]byte(`{"data":[{"embedding":[0.1,0.2,0.3]}]}`))
	}))
	defer server.Close()
	executor := campusDocsQdrantClient{embeddingHTTPClient: server.Client()}
	provider := providerconfig.RuntimeSetting{
		APIKey: "secret", BaseURL: server.URL, Kind: providerconfig.KindEmbedding,
		Model: "embedding-model", Provider: "openai-compatible", Transport: "embeddings",
	}
	vector, err := executor.embedQueryWithProviderConfig(t.Context(), provider, "query", 3)
	if err != nil {
		t.Fatal(err)
	}
	if len(vector) != 3 {
		t.Fatalf("vector dimensions = %d, want 3", len(vector))
	}
}

func TestDecodeCampusDocsQdrantQueryResponseRequiresExplicitPoints(t *testing.T) {
	valid, err := decodeCampusDocsQdrantQueryResponse([]byte(`{"result":{"points":[]}}`))
	if err != nil {
		t.Fatal(err)
	}
	if len(valid) != 0 {
		t.Fatalf("points = %#v, want empty", valid)
	}

	for _, testCase := range []struct {
		body string
		name string
	}{
		{name: "missing result", body: `{}`},
		{name: "null result", body: `{"result":null}`},
		{name: "missing points", body: `{"result":{}}`},
		{name: "null points", body: `{"result":{"points":null}}`},
		{name: "missing payload", body: `{"result":{"points":[{"id":1,"score":0.5}]}}`},
		{name: "null payload", body: `{"result":{"points":[{"id":1,"payload":null,"score":0.5}]}}`},
		{name: "missing score", body: `{"result":{"points":[{"id":1,"payload":{}}]}}`},
		{name: "null score", body: `{"result":{"points":[{"id":1,"payload":{},"score":null}]}}`},
	} {
		t.Run(testCase.name, func(t *testing.T) {
			if _, err := decodeCampusDocsQdrantQueryResponse([]byte(testCase.body)); err == nil {
				t.Fatal("malformed Qdrant response was accepted")
			}
		})
	}
}
