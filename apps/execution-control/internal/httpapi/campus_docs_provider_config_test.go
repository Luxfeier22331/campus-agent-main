package httpapi

import (
	"context"
	"testing"
)

func TestEmbeddingAdmissionPinRejectsProviderDrift(t *testing.T) {
	resolver := staticProviderConfigResolver{
		providerConfigKindEmbedding: providerConfigSnapshot{
			APIKey: "key", BaseURL: "https://embedding.example/v1", Dimensions: 3, EmbeddingSpaceID: "embedding-test-space-v1",
			Kind: providerConfigKindEmbedding, Model: "embedding-test", Provider: "openai-compatible", Transport: "embeddings",
		},
	}
	executor := campusDocsQdrantClient{configResolver: resolver}
	pinned := providerConfigAdmissionPin{ConfigSHA256: "sha256:" + repeatedHex("a", 64)}
	if _, err := executor.resolveEmbeddingProviderConfig(context.Background(), pinned); err == nil {
		t.Fatal("invalid provider pin was accepted")
	}
}
