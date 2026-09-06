package temporaladapter

import (
	"context"
	"errors"
	"testing"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/execution"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/executionapplication"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/modelconfigclient"
)

type countingModelTargetResolver struct {
	targetSHA256 string
	calls        int
}

func (resolver *countingModelTargetResolver) ResolveModelTarget(
	context.Context,
) (modelconfigclient.ModelTarget, error) {
	resolver.calls++
	if resolver.targetSHA256 == "" {
		return modelconfigclient.ModelTarget{}, errors.New("requested model target is missing")
	}
	return modelconfigclient.ModelTarget{TargetSHA256: resolver.targetSHA256, HostedWebSearch: true}, nil
}

func TestBuildAgentAdmissionSnapshotResolvesModelTargetOnce(t *testing.T) {
	resolver := &countingModelTargetResolver{targetSHA256: modelTargetSHA256ForTest}
	service := executionapplication.NewAdmissionService(executionapplication.AdmissionOptions{
		ModelTargetResolver: resolver,
	})

	snapshot, err := service.BuildAgentAdmissionSnapshot(t.Context(), true)
	if err != nil {
		t.Fatalf("build admission snapshot: %v", err)
	}
	if resolver.calls != 1 {
		t.Fatalf("workflow model target calls = %d, want 1", resolver.calls)
	}
	if snapshot.ModelTargetSHA256 != modelTargetSHA256ForTest {
		t.Fatalf("provider admission hashes = %#v", snapshot)
	}
	if !execution.ContainsString(snapshot.AgentCapabilities.VisibleFunctionToolNames, personalMemoryRecallToolName) {
		t.Fatalf("agent capabilities = %#v", snapshot.AgentCapabilities)
	}
	snapshot.AgentBudget.MaxFunctionToolCalls++
	if err := execution.ValidateAdmissionSnapshot(snapshot); err == nil {
		t.Fatal("admission snapshot accepted a mutated agent budget")
	}
}

func TestBuildAgentAdmissionSnapshotDoesNotRequireCampusDocs(t *testing.T) {
	resolver := &countingModelTargetResolver{targetSHA256: modelTargetSHA256ForTest}
	service := executionapplication.NewAdmissionService(executionapplication.AdmissionOptions{
		ModelTargetResolver: resolver,
	})

	_, err := service.BuildAgentAdmissionSnapshot(t.Context(), false)
	if err != nil {
		t.Fatalf("build workflow admission snapshot: %v", err)
	}
	if resolver.calls != 1 {
		t.Fatalf("workflow model target calls = %d, want 1", resolver.calls)
	}
}

func TestBuildAgentAdmissionSnapshotRequiresProviderSettings(t *testing.T) {
	service := executionapplication.NewAdmissionService(executionapplication.AdmissionOptions{
		ModelTargetError: modelconfigclient.ErrNotConfigured,
	})

	if _, err := service.BuildAgentAdmissionSnapshot(t.Context(), false); !errors.Is(err, modelconfigclient.ErrNotConfigured) {
		t.Fatalf("provider-less admission error = %v", err)
	}
}
