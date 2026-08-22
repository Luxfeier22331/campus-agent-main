package httpapi

import (
	"context"
	"errors"
	"testing"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/modelconfigclient"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/temporalruntime"
)

type staticPrimaryAgentTargetResolver struct {
	targetSHA256 string
	err          error
}

func attachPrimaryAgentProviderConfigForTest(server *Server) {
	attachAgentAdmissionProviderConfigsForTest(server)
}

func attachAgentAdmissionProviderConfigsForTest(server *Server) {
	server.primaryAgentTargetResolver = staticPrimaryAgentTargetResolver{
		targetSHA256: primaryAgentModelTargetSHA256ForTest,
	}
	server.primaryAgentTargetErr = nil
}

func withAgentAdmissionSnapshotForTest(
	t *testing.T,
	server *Server,
	input temporalruntime.ExecutePrimaryAgentActivityInput,
) temporalruntime.ExecutePrimaryAgentActivityInput {
	t.Helper()
	memoryAllowed := len(input.VisibleToolNames) == 1 && input.VisibleToolNames[0] == personalMemoryRecallToolName
	snapshot, err := server.buildAgentAdmissionSnapshot(t.Context(), memoryAllowed)
	if err != nil {
		t.Fatalf("build agent admission snapshot: %v", err)
	}
	input.AdmissionSnapshot = snapshot
	return input
}

func (resolver staticPrimaryAgentTargetResolver) ResolvePrimaryAgentTarget(
	_ context.Context,
) (modelconfigclient.PrimaryAgentTarget, error) {
	if resolver.err != nil {
		return modelconfigclient.PrimaryAgentTarget{}, resolver.err
	}
	if resolver.targetSHA256 == "" {
		return modelconfigclient.PrimaryAgentTarget{}, errors.New("primary agent model target is missing")
	}
	return modelconfigclient.PrimaryAgentTarget{TargetSHA256: resolver.targetSHA256}, nil
}

const primaryAgentModelTargetSHA256ForTest = "4b20ab70a9ac22073110f59ea007f27de19d731319b62ed4bd60b11d057c6635"
