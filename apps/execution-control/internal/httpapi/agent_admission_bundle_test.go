package httpapi

import (
	"context"
	"errors"
	"testing"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/config"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/modelconfigclient"
)

type countingPrimaryAgentTargetResolver struct {
	targetSHA256 string
	calls        int
}

func (resolver *countingPrimaryAgentTargetResolver) ResolvePrimaryAgentTarget(
	context.Context,
) (modelconfigclient.PrimaryAgentTarget, error) {
	resolver.calls++
	if resolver.targetSHA256 == "" {
		return modelconfigclient.PrimaryAgentTarget{}, errors.New("requested model target is missing")
	}
	return modelconfigclient.PrimaryAgentTarget{TargetSHA256: resolver.targetSHA256}, nil
}

func TestBuildAgentAdmissionSnapshotResolvesPrimaryAgentTargetOnce(t *testing.T) {
	resolver := &countingPrimaryAgentTargetResolver{targetSHA256: primaryAgentModelTargetSHA256ForTest}
	server := NewServer(config.Config{DeploymentEnvironment: "test"})
	server.primaryAgentTargetResolver = resolver
	server.primaryAgentTargetErr = nil

	snapshot, err := server.buildAgentAdmissionSnapshot(t.Context(), true)
	if err != nil {
		t.Fatalf("build admission snapshot: %v", err)
	}
	if resolver.calls != 1 {
		t.Fatalf("primary agent target calls = %d, want 1", resolver.calls)
	}
	if snapshot.PrimaryAgentTargetSHA256 != primaryAgentModelTargetSHA256ForTest {
		t.Fatalf("provider admission hashes = %#v", snapshot)
	}
	if !containsString(snapshot.ExecutionStrategy.VisibleFunctionToolNames, personalMemoryRecallToolName) {
		t.Fatalf("execution strategy = %#v", snapshot.ExecutionStrategy)
	}
	snapshot.ExecutionStrategy.MaxFunctionToolCalls++
	if err := validateAdmissionSnapshot(snapshot); err == nil {
		t.Fatal("admission snapshot accepted a mutated execution strategy")
	}
}

func TestBuildAgentAdmissionSnapshotDoesNotRequireCampusDocs(t *testing.T) {
	resolver := &countingPrimaryAgentTargetResolver{targetSHA256: primaryAgentModelTargetSHA256ForTest}
	server := NewServer(config.Config{DeploymentEnvironment: "test"})
	server.primaryAgentTargetResolver = resolver

	_, err := server.buildAgentAdmissionSnapshot(t.Context(), false)
	if err != nil {
		t.Fatalf("build direct admission snapshot: %v", err)
	}
	if resolver.calls != 1 {
		t.Fatalf("primary agent target calls = %d, want 1", resolver.calls)
	}
}

func TestBuildAgentAdmissionSnapshotRequiresProviderSettings(t *testing.T) {
	server := NewServer(config.Config{DeploymentEnvironment: "test"})

	if _, err := server.buildAgentAdmissionSnapshot(t.Context(), false); !errors.Is(err, modelconfigclient.ErrNotConfigured) {
		t.Fatalf("provider-less admission error = %v", err)
	}
}
