package httpapi

import (
	"context"
	"errors"
	"testing"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/config"
)

type countingProviderConfigResolver struct {
	configs map[providerConfigKind]providerConfigSnapshot
	calls   []providerConfigKind
}

func (resolver *countingProviderConfigResolver) ResolveActiveProviderConfig(
	ctx context.Context,
	kind providerConfigKind,
) (providerConfigSnapshot, error) {
	resolver.calls = append(resolver.calls, kind)
	snapshot, ok := resolver.configs[kind]
	if !ok {
		return providerConfigSnapshot{}, errors.New("requested model setting is missing")
	}
	return snapshot, nil
}

func TestBuildAgentAdmissionSnapshotResolvesOnlyRuntimeModelSettings(t *testing.T) {
	primary := primaryAgentProviderConfigSnapshotForTest()
	embedding := embeddingProviderConfigSnapshotForTest(
		providerConfigKindEmbedding,
		"https://embedding.example/v1",
		"provider-model-alias",
	)
	resolver := &countingProviderConfigResolver{configs: map[providerConfigKind]providerConfigSnapshot{
		providerConfigKindLLM:       primary,
		providerConfigKindEmbedding: embedding,
	}}
	server := NewServer(config.Config{DeploymentEnvironment: "test"})
	server.providerConfigResolver = resolver
	server.providerConfigErr = nil
	server.campusDocsIndexStore = campusDocsIndexStoreForTest()

	snapshot, err := server.buildAgentAdmissionSnapshot(
		t.Context(),
		true,
		campusDocsQuerySHA256ForTest("学生请假手续"),
	)
	if err != nil {
		t.Fatalf("build admission snapshot: %v", err)
	}
	if len(resolver.calls) != 2 || resolver.calls[0] != providerConfigKindEmbedding || resolver.calls[1] != providerConfigKindLLM {
		t.Fatalf("provider setting calls = %#v, want embedding then llm", resolver.calls)
	}
	if snapshot.ProviderConfigSHA256 != providerConfigAdmissionHash(primary) ||
		snapshot.CampusDocsRetrieval.EmbeddingProviderConfigSHA256 != providerConfigAdmissionHash(embedding) {
		t.Fatalf("provider admission hashes = %#v", snapshot)
	}
	if snapshot.ExecutionStrategy.MemoryRecall != "model_optional" {
		t.Fatalf("execution strategy = %#v", snapshot.ExecutionStrategy)
	}
	snapshot.ExecutionStrategy.MaxToolCalls++
	if err := validateAdmissionSnapshot(snapshot); err == nil {
		t.Fatal("admission snapshot accepted a mutated execution strategy")
	}
}

func TestBuildAgentAdmissionSnapshotAlwaysPinsRetrieval(t *testing.T) {
	embedding := embeddingProviderConfigSnapshotForTest(
		providerConfigKindEmbedding,
		"https://embedding.example/v1",
		"provider-model-alias",
	)
	resolver := &countingProviderConfigResolver{configs: map[providerConfigKind]providerConfigSnapshot{
		providerConfigKindLLM:       primaryAgentProviderConfigSnapshotForTest(),
		providerConfigKindEmbedding: embedding,
	}}
	server := NewServer(config.Config{DeploymentEnvironment: "test"})
	server.providerConfigResolver = resolver
	server.campusDocsIndexStore = campusDocsIndexStoreForTest()

	snapshot, err := server.buildAgentAdmissionSnapshot(
		t.Context(),
		false,
		campusDocsQuerySHA256ForTest("你好"),
	)
	if err != nil {
		t.Fatalf("build direct admission snapshot: %v", err)
	}
	if len(resolver.calls) != 2 || resolver.calls[0] != providerConfigKindEmbedding || resolver.calls[1] != providerConfigKindLLM {
		t.Fatalf("provider setting calls = %#v, want embedding then llm", resolver.calls)
	}
	if snapshot.CampusDocsRetrieval.QuerySHA256 == "" {
		t.Fatalf("admission did not pin Campus docs retrieval: %#v", snapshot)
	}
}

func TestBuildAgentAdmissionSnapshotRequiresProviderSettings(t *testing.T) {
	server := NewServer(config.Config{DeploymentEnvironment: "test"})
	server.campusDocsIndexStore = campusDocsIndexStoreForTest()

	if _, err := server.buildAgentAdmissionSnapshot(
		t.Context(),
		false,
		campusDocsQuerySHA256ForTest("学生请假手续"),
	); !errors.Is(err, errProviderConfigResolverNotConfigured) {
		t.Fatalf("provider-less admission error = %v", err)
	}
}
