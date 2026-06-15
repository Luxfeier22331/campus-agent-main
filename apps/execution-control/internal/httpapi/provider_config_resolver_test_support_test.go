package httpapi

import (
	"context"
	"fmt"
)

type staticProviderConfigResolver map[string]providerConfigSnapshot

func attachPrimaryAgentProviderConfigForTest(server *Server) {
	server.providerConfigResolver = staticProviderConfigResolver{
		"primary_agent": primaryAgentProviderConfigSnapshotForTest(),
	}
}

func primaryAgentProviderConfigSnapshotForTest() providerConfigSnapshot {
	return providerConfigSnapshot{
		APIKey:    "sk-primary-agent",
		BaseURL:   "https://provider.example/v1",
		Model:     "gpt-test",
		ProfileID: "provider_profile_primary",
		Provider:  "openai",
		Revision:  3,
		Role:      "primary_agent",
		TimeoutMS: 30000,
		Transport: "responses",
	}
}

func personalMemoryExtractionProviderConfigSnapshotForTest(baseURL string) providerConfigSnapshot {
	return providerConfigSnapshot{
		APIKey:    "sk-personal-memory-extraction",
		BaseURL:   baseURL,
		Model:     "gpt-test",
		ProfileID: "provider_profile_personal_memory_extraction",
		Provider:  "openai",
		Revision:  3,
		Role:      "personal_memory_extraction",
		TimeoutMS: 30000,
		Transport: "responses",
	}
}

func embeddingProviderConfigSnapshotForTest(
	role providerConfigRole,
	baseURL string,
	model string,
	dimensions int,
) providerConfigSnapshot {
	return providerConfigSnapshot{
		APIKey:     "test-embedding-key",
		BaseURL:    baseURL,
		Dimensions: dimensions,
		Model:      model,
		ProfileID:  "provider_profile_" + string(role),
		Provider:   "openai-compatible",
		Revision:   3,
		Role:       string(role),
		TimeoutMS:  30000,
		Transport:  "embeddings",
	}
}

func (resolver staticProviderConfigResolver) ResolveActiveProviderConfig(
	_ context.Context,
	role providerConfigRole,
) (providerConfigSnapshot, error) {
	snapshot, ok := resolver[string(role)]
	if !ok {
		return providerConfigSnapshot{}, fmt.Errorf("No active provider profile for role %s.", role)
	}
	if err := validateProviderConfigSnapshot(snapshot, role); err != nil {
		return providerConfigSnapshot{}, err
	}
	return snapshot, nil
}
