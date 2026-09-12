package outboundadapter

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/campusdocs"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/config"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/embedding"
)

func TestRepeatedSearchCachesOnlyEmbedding(t *testing.T) {
	var embeddings, retrievals, reranks atomic.Int64
	collection := "campus_docs_" + strings.Repeat("a", 64)
	provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/v1/embeddings":
			embeddings.Add(1)
			writeJSON(w, http.StatusOK, map[string]any{"data": []any{map[string]any{"embedding": make([]float64, campusdocs.EmbeddingDimensions)}}})
		case "/v1/rerank":
			reranks.Add(1)
			writeJSON(w, http.StatusOK, map[string]any{"results": []any{map[string]any{"index": 0, "relevance_score": 0.95}}})
		case "/collections/" + collection + "/points/query":
			retrievals.Add(1)
			writeJSON(w, http.StatusOK, map[string]any{"result": map[string]any{"points": []qdrantPoint{validCampusDocsPointAtTest(0)}}})
		default:
			http.NotFound(w, r)
		}
	}))
	defer provider.Close()
	resolver := campusDocsRuntimeConfigResolverForTest(provider.URL + "/v1///")
	client := newCampusDocsHTTPClientForTest(t, config.Config{DeploymentEnvironment: "local", QdrantURL: provider.URL, QdrantReadOnlyAPIKey: "test"}, resolver)
	search := func(rerankQuery string) []campusdocs.SearchResultItem {
		t.Helper()
		result, err := client.Search(t.Context(), campusdocs.Index{Collection: collection}, campusdocs.SearchQuery{RetrievalQuery: "图书馆 开放时间", RerankQuery: rerankQuery}, 5)
		if err != nil {
			t.Fatal(err)
		}
		return result
	}
	first := search("图书馆什么时候开放？")
	// A key rotation or equivalent normalized URL does not change the vector space.
	updated := resolver["campus_docs_embedding"]
	updated.BaseURL, updated.APIKey = provider.URL+"/v1", "rotated-key"
	resolver["campus_docs_embedding"] = updated
	second := search("想去图书馆，几点可以进入？")
	if len(first) != 1 || !reflect.DeepEqual(first, second) {
		t.Fatalf("retrieval changed: %v / %v", first, second)
	}
	if embeddings.Load() != 1 || retrievals.Load() != 2 || reranks.Load() != 2 {
		t.Fatalf("calls: embedding=%d retrieval=%d rerank=%d", embeddings.Load(), retrievals.Load(), reranks.Load())
	}
	updated.Model += "-new"
	resolver["campus_docs_embedding"] = updated
	search("图书馆什么时候开放？")
	if embeddings.Load() != 2 {
		t.Fatal("current model config was not resolved before lookup")
	}
	// Even a warm cache must not hide failure to resolve the current configuration.
	delete(resolver, "campus_docs_embedding")
	if _, err := client.Search(t.Context(), campusdocs.Index{Collection: collection}, campusdocs.SearchQuery{RetrievalQuery: "图书馆 开放时间", RerankQuery: "图书馆"}, 5); err == nil {
		t.Fatal("cache bypassed current config resolution")
	}
}

func TestEmbeddingProviderSendsExactInputAndCurrentCredential(t *testing.T) {
	input := "  Instruct: 检索\nQuery:图书馆  "
	provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			Input      string
			Dimensions int
			Model      string
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Error(err)
		}
		if body.Input != input || body.Dimensions != 2 || body.Model != "model" || r.Header.Get("Authorization") != "Bearer current-key" {
			t.Errorf("request = %+v", body)
		}
		writeJSON(w, http.StatusOK, map[string]any{"data": []any{map[string]any{"embedding": []float64{1, 2}}}})
	}))
	defer provider.Close()
	client := &embeddingHTTPProvider{httpClient: provider.Client(), apiKey: "current-key"}
	if _, err := client.Embed(context.Background(), embedding.Request{Input: input, BaseURL: provider.URL, Model: "model", Dimensions: 2}); err != nil {
		t.Fatal(err)
	}
}
