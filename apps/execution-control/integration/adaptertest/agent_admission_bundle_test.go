package adaptertest

import (
	"context"
	"errors"
	"testing"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/execution"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/executionapplication"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/modelconfigclient"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/toolcontract"
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
		ToolContract:        toolcontract.Files{},
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
	originalHash := execution.SHA256JSONRef(snapshot)
	snapshot.AgentBudget.MaxFunctionToolCalls++
	if execution.SHA256JSONRef(snapshot) == originalHash {
		t.Fatal("top-level hash did not cover changed budget")
	}
	if err := execution.ValidateAdmissionSnapshot(snapshot); err != nil {
		t.Fatalf("valid budget rejected: %v", err)
	}
}

func TestBuildAgentAdmissionSnapshotDoesNotRequireCampusDocs(t *testing.T) {
	resolver := &countingModelTargetResolver{targetSHA256: modelTargetSHA256ForTest}
	service := executionapplication.NewAdmissionService(executionapplication.AdmissionOptions{
		ToolContract:        toolcontract.Files{},
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

func TestAdmissionSnapshotRejectsInvalidPolicy(t *testing.T) {
	for name, mutate := range map[string]func(*execution.AgentAdmissionSnapshot){
		"duplicate tools": func(s *execution.AgentAdmissionSnapshot) {
			s.AgentCapabilities.VisibleFunctionToolNames = []string{"campus_search", "campus_search"}
		},
		"blank tool": func(s *execution.AgentAdmissionSnapshot) {
			s.AgentCapabilities.VisibleFunctionToolNames = []string{" "}
		},
		"noncanonical tool": func(s *execution.AgentAdmissionSnapshot) {
			s.AgentCapabilities.VisibleFunctionToolNames = []string{" campus_search"}
		},
		"unknown tool": func(s *execution.AgentAdmissionSnapshot) {
			s.AgentCapabilities.VisibleFunctionToolNames = []string{"unknown"}
		},
		"budget": func(s *execution.AgentAdmissionSnapshot) { s.AgentBudget.MaxModelTurns = 0 },
		"limits": func(s *execution.AgentAdmissionSnapshot) { s.AgentLimits.MaxOutputTokens = 0 },
	} {
		t.Run(name, func(t *testing.T) {
			snapshot := admissionSnapshotForTest(t, false)
			mutate(&snapshot)
			if err := execution.ValidateAdmissionSnapshot(snapshot); err == nil {
				t.Fatal("invalid policy accepted")
			}
		})
	}
}

func TestBuildAgentAdmissionSnapshotRequiresProviderSettings(t *testing.T) {
	service := executionapplication.NewAdmissionService(executionapplication.AdmissionOptions{
		ToolContract:     toolcontract.Files{},
		ModelTargetError: modelconfigclient.ErrNotConfigured,
	})

	if _, err := service.BuildAgentAdmissionSnapshot(t.Context(), false); !errors.Is(err, modelconfigclient.ErrNotConfigured) {
		t.Fatalf("provider-less admission error = %v", err)
	}
}
