package httpapi

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/campusdocs"
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
		EmbeddingModel:            "Qwen3-Embedding-4B",
		EmbeddingProvider:         "openai-compatible",
		EmbeddingQueryInstruction: "Given a Campus Web document question, retrieve relevant current passages that answer the query.",
		EmbeddingSpaceID:          "qwen3-embedding-4b-test-v1",
		SparseModel:               "fnv1a_log_tf.v1",
		SparseVectorName:          "sparse",
	}
}

func campusDocsTargetForHTTPTest() *temporalruntime.CampusDocsIndexSnapshot {
	return &temporalruntime.CampusDocsIndexSnapshot{
		Collection:                "campus_docs_" + repeatedHex("d", 64),
		DenseVectorName:           "dense",
		EmbeddingDimensions:       3,
		EmbeddingModel:            "embedding-test",
		EmbeddingProvider:         "openai-compatible",
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
	provider := providerConfigSnapshot{
		Dimensions:       3,
		EmbeddingSpaceID: "embedding-test-space-v1",
		Model:            "embedding-test",
		Provider:         "openai-compatible",
	}
	if _, err := executor.queryCampusDocsPoints(context.Background(), "学生请假", []float64{0.1, 0.2, 0.3}, provider, target); err != nil {
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

func TestCampusDocsEmbeddingAdmissionRejectsDifferentEmbeddingSpace(t *testing.T) {
	target := campusDocsTargetForHTTPTest()
	provider := providerConfigSnapshot{
		Dimensions:       target.EmbeddingDimensions,
		EmbeddingSpaceID: "different-space-v1",
		Model:            target.EmbeddingModel,
		Provider:         target.EmbeddingProvider,
	}
	if err := validateCampusDocsEmbeddingAdmission(target, provider); err == nil {
		t.Fatal("embedding provider from a different vector space was accepted")
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
