package httpapi

import (
	"context"
	"fmt"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/modelconfigclient"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/providerconfig"
)

type staticProviderConfigResolver map[providerconfig.Kind]providerconfig.RuntimeSetting

const campusDocsRerankModel = "Qwen3-Reranker-4B"

func embeddingProviderConfigSnapshotForTest(
	kind providerconfig.Kind,
	baseURL string,
) providerconfig.RuntimeSetting {
	return providerconfig.RuntimeSetting{
		APIKey:    "test-embedding-key",
		BaseURL:   baseURL,
		Kind:      kind,
		Model:     providerconfig.CanonicalEmbeddingModel,
		Provider:  providerconfig.CanonicalEmbeddingProvider,
		Transport: providerconfig.CanonicalEmbeddingTransport,
	}
}

func (resolver staticProviderConfigResolver) ResolveActiveProviderConfig(
	_ context.Context,
	kind providerconfig.Kind,
) (providerconfig.RuntimeSetting, error) {
	snapshot, ok := resolver[kind]
	if !ok {
		return providerconfig.RuntimeSetting{}, fmt.Errorf("no active model setting for kind %s", kind)
	}
	if err := providerconfig.ValidateRuntimeSetting(snapshot, kind); err != nil {
		return providerconfig.RuntimeSetting{}, err
	}
	return snapshot, nil
}

func (resolver staticProviderConfigResolver) ResolveRuntimeConfig(
	ctx context.Context,
	name string,
) (modelconfigclient.RuntimeConfig, error) {
	kind := providerconfig.KindEmbedding
	if name != "campus_docs_embedding" && name != "campus_docs_reranker" {
		return modelconfigclient.RuntimeConfig{}, fmt.Errorf("no active model setting for kind %s", name)
	}
	snapshot, err := resolver.ResolveActiveProviderConfig(ctx, kind)
	if err != nil {
		return modelconfigclient.RuntimeConfig{}, err
	}
	model := snapshot.Model
	protocol := "openai.embeddings"
	if name == "campus_docs_reranker" {
		model = campusDocsRerankModel
		protocol = "cohere.rerank"
	}
	return modelconfigclient.RuntimeConfig{
		APIKey:        snapshot.APIKey,
		APIProtocol:   protocol,
		BaseURL:       snapshot.BaseURL,
		Model:         model,
		Name:          name,
		Provider:      snapshot.Provider,
		SchemaVersion: "model_runtime_config.v1",
		TargetSHA256:  "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
	}, nil
}
