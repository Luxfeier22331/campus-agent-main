package httpapi

import (
	"context"
	"fmt"
)

type staticProviderConfigResolver map[providerConfigKind]providerConfigSnapshot

func attachPrimaryAgentProviderConfigForTest(server *Server) {
	server.providerConfigResolver = staticProviderConfigResolver{
		providerConfigKindLLM: primaryAgentProviderConfigSnapshotForTest(),
	}
}

func primaryAgentProviderConfigSnapshotForTest() providerConfigSnapshot {
	return providerConfigSnapshot{
		APIKey:    "sk-primary-agent",
		BaseURL:   "https://provider.example/v1",
		Kind:      providerConfigKindLLM,
		Model:     "gpt-test",
		Provider:  "openai",
		Transport: "responses",
	}
}

func embeddingProviderConfigSnapshotForTest(
	kind providerConfigKind,
	baseURL string,
	model string,
	dimensions int,
) providerConfigSnapshot {
	return providerConfigSnapshot{
		APIKey:     "test-embedding-key",
		BaseURL:    baseURL,
		Dimensions: dimensions,
		Kind:       kind,
		Model:      model,
		Provider:   "openai-compatible",
		Transport:  "embeddings",
	}
}

func (resolver staticProviderConfigResolver) ResolveActiveProviderConfig(
	_ context.Context,
	kind providerConfigKind,
) (providerConfigSnapshot, error) {
	snapshot, ok := resolver[kind]
	if !ok {
		return providerConfigSnapshot{}, fmt.Errorf("no active model setting for kind %s", kind)
	}
	if err := validateProviderConfigSnapshot(snapshot, kind); err != nil {
		return providerConfigSnapshot{}, err
	}
	return snapshot, nil
}
