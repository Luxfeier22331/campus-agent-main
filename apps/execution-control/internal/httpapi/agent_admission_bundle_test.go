package httpapi

import (
	"context"
	"errors"
	"testing"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/config"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/providerconfig"
)

type countingProviderConfigResolver struct {
	configs map[providerconfig.Kind]providerconfig.RuntimeSetting
	calls   []providerconfig.Kind
}

func (resolver *countingProviderConfigResolver) ResolveActiveProviderConfig(
	ctx context.Context,
	kind providerconfig.Kind,
) (providerconfig.RuntimeSetting, error) {
	resolver.calls = append(resolver.calls, kind)
	snapshot, ok := resolver.configs[kind]
	if !ok {
		return providerconfig.RuntimeSetting{}, errors.New("requested model setting is missing")
	}
	return snapshot, nil
}

func TestBuildAgentAdmissionSnapshotResolvesOnlyLLMSettings(t *testing.T) {
	primary := primaryAgentProviderConfigSnapshotForTest()
	resolver := &countingProviderConfigResolver{configs: map[providerconfig.Kind]providerconfig.RuntimeSetting{
		providerconfig.KindLLM: primary,
	}}
	server := NewServer(config.Config{DeploymentEnvironment: "test"})
	server.providerConfigResolver = resolver
	server.providerConfigErr = nil

	snapshot, err := server.buildAgentAdmissionSnapshot(t.Context(), true)
	if err != nil {
		t.Fatalf("build admission snapshot: %v", err)
	}
	if len(resolver.calls) != 1 || resolver.calls[0] != providerconfig.KindLLM {
		t.Fatalf("provider setting calls = %#v, want llm only", resolver.calls)
	}
	if snapshot.ProviderConfigSHA256 != providerconfig.AdmissionHash(primary) {
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

func TestBuildAgentAdmissionSnapshotDoesNotRequireCampusDocs(t *testing.T) {
	resolver := &countingProviderConfigResolver{configs: map[providerconfig.Kind]providerconfig.RuntimeSetting{
		providerconfig.KindLLM: primaryAgentProviderConfigSnapshotForTest(),
	}}
	server := NewServer(config.Config{DeploymentEnvironment: "test"})
	server.providerConfigResolver = resolver

	_, err := server.buildAgentAdmissionSnapshot(t.Context(), false)
	if err != nil {
		t.Fatalf("build direct admission snapshot: %v", err)
	}
	if len(resolver.calls) != 1 || resolver.calls[0] != providerconfig.KindLLM {
		t.Fatalf("provider setting calls = %#v, want llm only", resolver.calls)
	}
}

func TestBuildAgentAdmissionSnapshotRequiresProviderSettings(t *testing.T) {
	server := NewServer(config.Config{DeploymentEnvironment: "test"})

	if _, err := server.buildAgentAdmissionSnapshot(t.Context(), false); !errors.Is(err, providerconfig.ErrResolverNotConfigured) {
		t.Fatalf("provider-less admission error = %v", err)
	}
}
