package httpapi

import (
	"encoding/json"
	"encoding/pem"
	"fmt"
	"net/http/httptest"
	"os"
	"strings"
	"testing"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/retrievalruntime"
)

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

func defaultKnowledgeSearchEmbeddingResolverForTest() providerConfigResolver {
	return staticProviderConfigResolver{
		"rag_query_embedding": embeddingProviderConfigSnapshotForTest(
			providerConfigRoleRAGQueryEmbedding,
			"https://provider.example/v1",
			"Qwen3-Embedding-4B",
			2560,
		),
	}
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
	return qdrantCollectionMetadataResponseForEmbeddingTest(t, corpus, collection, providerConfigSnapshot{
		Dimensions: 2560,
		Model:      "Qwen3-Embedding-4B",
		Provider:   "openai-compatible",
	})
}

func qdrantCollectionMetadataResponseForEmbeddingTest(
	t *testing.T,
	corpus string,
	collection string,
	embedding providerConfigSnapshot,
) string {
	t.Helper()
	profile, err := retrievalServingConfigForTest(corpus, collection)
	if err != nil {
		t.Fatalf("load serving config for metadata fixture: %v", err)
	}
	metadata := releaseMetadataFixtureForEmbeddingHTTPTest(profile, collection, embedding)
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
	profile retrievalruntime.ServingConfig,
	collection string,
) map[string]any {
	return releaseMetadataFixtureForEmbeddingHTTPTest(profile, collection, providerConfigSnapshot{
		Dimensions: 2560,
		Model:      "Qwen3-Embedding-4B",
		Provider:   "openai-compatible",
	})
}

func releaseMetadataFixtureForEmbeddingHTTPTest(
	profile retrievalruntime.ServingConfig,
	collection string,
	embedding providerConfigSnapshot,
) map[string]any {
	embeddingProvider := strings.TrimSpace(embedding.Provider)
	embeddingModel := strings.TrimSpace(embedding.Model)
	embeddingDimensions := embedding.Dimensions
	return map[string]any{
		"chunk_policy_version":                profile.ChunkPolicyVersion,
		"chunk_quality_status":                "passed",
		"cleaning_policy_version":             profile.CleaningPolicyVersion,
		"component_eval_status":               "passed",
		"dense_prefetch_limit":                profile.DensePrefetchLimit,
		"dense_vector_name":                   profile.DenseVectorName,
		"embedding_dimensions":                embeddingDimensions,
		"embedding_model":                     embeddingModel,
		"embedding_provider":                  embeddingProvider,
		"embedding_query_instruction_hash":    retrievalruntime.HashText(profile.EmbeddingQueryInstruction),
		"index_release_id":                    "r20260615_" + collection,
		"index_validation_status":             "passed",
		"serving_config_identity_hash":        retrievalruntime.ServingConfigIdentityHash(profile, embeddingProvider, embeddingModel, embeddingDimensions),
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
	profile, err := retrievalServingConfigForTest(corpus, collection)
	if err != nil {
		t.Fatalf("load serving config for metadata fixture: %v", err)
	}
	metadata := releaseMetadataFixtureForEmbeddingHTTPTest(profile, collection, providerConfigSnapshot{
		Dimensions: 2560,
		Model:      "Qwen3-Embedding-4B",
		Provider:   "openai-compatible",
	})
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

func retrievalServingConfigForTest(corpus string, collection string) (retrievalruntime.ServingConfig, error) {
	return retrievalruntime.LoadServingConfig("", corpus, collection)
}
