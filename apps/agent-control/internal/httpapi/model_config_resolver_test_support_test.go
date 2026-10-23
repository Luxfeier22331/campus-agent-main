package httpapi

import (
	"context"
	"fmt"

	"github.com/MUC-WIKI/campus-agent/apps/agent-control/internal/modelconfigclient"
)

type staticModelConfigResolver map[string]modelconfigclient.RuntimeConfig

const (
	campusDocsEmbeddingModel = "Qwen3-Embedding-4B"
	campusDocsRerankModel    = "Qwen3-Reranker-4B"
)

func campusDocsRuntimeConfigResolverForTest(baseURL string) staticModelConfigResolver {
	return staticModelConfigResolver{
		"campus_docs_embedding": {
			APIKey:        "test-embedding-key",
			APIProtocol:   "openai.embeddings",
			BaseURL:       baseURL,
			Model:         campusDocsEmbeddingModel,
			Name:          "campus_docs_embedding",
			Provider:      "openai-compatible",
			SchemaVersion: "model_runtime_config.v1",
			TargetSHA256:  "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
		},
		"campus_docs_reranker": {
			APIKey:        "test-reranker-key",
			APIProtocol:   "cohere.rerank",
			BaseURL:       baseURL,
			Model:         campusDocsRerankModel,
			Name:          "campus_docs_reranker",
			Provider:      "cohere-compatible",
			SchemaVersion: "model_runtime_config.v1",
			TargetSHA256:  "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
		},
	}
}

func (resolver staticModelConfigResolver) ResolveRuntimeConfig(
	_ context.Context,
	name string,
) (modelconfigclient.RuntimeConfig, error) {
	snapshot, ok := resolver[name]
	if !ok {
		return modelconfigclient.RuntimeConfig{}, fmt.Errorf("no runtime config for %s", name)
	}
	return snapshot, nil
}
