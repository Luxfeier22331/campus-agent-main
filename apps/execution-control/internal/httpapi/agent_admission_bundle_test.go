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
		"embedding-test",
		2560,
	)
	resolver := &countingProviderConfigResolver{configs: map[providerConfigKind]providerConfigSnapshot{
		providerConfigKindLLM:       primary,
		providerConfigKindEmbedding: embedding,
	}}
	server := NewServer(config.Config{DeploymentEnvironment: "test"})
	server.providerConfigResolver = resolver
	server.providerConfigErr = nil
	server.toolReadModel = knowledgeReadModelForTest()

	snapshot, err := server.buildAgentAdmissionSnapshot(
		t.Context(),
		true,
		false,
		groundingPlanForTest("学生请假手续", "student_rules"),
	)
	if err != nil {
		t.Fatalf("build admission snapshot: %v", err)
	}
	if len(resolver.calls) != 2 || resolver.calls[0] != providerConfigKindLLM || resolver.calls[1] != providerConfigKindEmbedding {
		t.Fatalf("provider setting calls = %#v, want llm then embedding", resolver.calls)
	}
	if snapshot.ProviderConfigSHA256 != providerConfigAdmissionHash(primary) ||
		snapshot.EmbeddingProviderConfigSHA256 != providerConfigAdmissionHash(embedding) {
		t.Fatalf("provider admission hashes = %#v", snapshot)
	}
	if snapshot.ExecutionStrategy.MemoryRecall != "model_optional" {
		t.Fatalf("execution strategy = %#v", snapshot.ExecutionStrategy)
	}
	if snapshot.ExecutionStrategy.AllowUngroundedAnswer {
		t.Fatalf("grounded execution strategy allows ungrounded answers: %#v", snapshot.ExecutionStrategy)
	}
	snapshot.ExecutionStrategy.MaxToolCalls++
	if err := validateAdmissionSnapshot(snapshot); err == nil {
		t.Fatal("admission snapshot accepted a mutated execution strategy")
	}
}

func TestBuildAgentAdmissionSnapshotDirectRequestsLLMOnly(t *testing.T) {
	resolver := &countingProviderConfigResolver{configs: map[providerConfigKind]providerConfigSnapshot{
		providerConfigKindLLM: primaryAgentProviderConfigSnapshotForTest(),
	}}
	server := NewServer(config.Config{DeploymentEnvironment: "test"})
	server.providerConfigResolver = resolver

	snapshot, err := server.buildAgentAdmissionSnapshot(
		t.Context(),
		false,
		true,
		groundingPlanForTest("你好"),
	)
	if err != nil {
		t.Fatalf("build direct admission snapshot: %v", err)
	}
	if len(resolver.calls) != 1 || resolver.calls[0] != providerConfigKindLLM {
		t.Fatalf("direct provider setting calls = %#v, want llm only", resolver.calls)
	}
	if snapshot.EmbeddingProviderConfigSHA256 != "" {
		t.Fatalf("direct admission pinned embedding setting: %#v", snapshot)
	}
	if !snapshot.ExecutionStrategy.AllowUngroundedAnswer {
		t.Fatalf("direct execution strategy rejected an authorized ungrounded answer: %#v", snapshot)
	}
}

func TestBuildAgentAdmissionSnapshotRequiresProviderSettings(t *testing.T) {
	server := NewServer(config.Config{DeploymentEnvironment: "test"})
	server.toolReadModel = knowledgeReadModelForTest()

	if _, err := server.buildAgentAdmissionSnapshot(
		t.Context(),
		false,
		true,
		groundingPlanForTest("你好"),
	); !errors.Is(err, errProviderConfigResolverNotConfigured) {
		t.Fatalf("provider-less admission error = %v", err)
	}
}
