package httpapi

import (
	"context"
	"testing"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/providerconfig"
)

func TestEmbeddingAdmissionPinRejectsProviderDrift(t *testing.T) {
	resolver := staticProviderConfigResolver{
		providerconfig.KindEmbedding: providerconfig.RuntimeSetting{
			APIKey: "key", BaseURL: "https://embedding.example/v1",
			Kind: providerconfig.KindEmbedding, Model: providerconfig.CanonicalEmbeddingModel,
			Provider: providerconfig.CanonicalEmbeddingProvider, Transport: providerconfig.CanonicalEmbeddingTransport,
		},
	}
	executor := campusDocsQdrantClient{configResolver: resolver}
	pinned := providerConfigAdmissionPin{ConfigSHA256: "sha256:" + repeatedHex("a", 64)}
	if _, err := executor.resolveEmbeddingProviderConfig(context.Background(), pinned); err == nil {
		t.Fatal("invalid provider pin was accepted")
	}
}
