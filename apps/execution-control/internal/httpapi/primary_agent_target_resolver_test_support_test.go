package httpapi

import (
	"context"
	"errors"
	"strings"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/execution"
)

type staticAdmissionSnapshotBuilder struct {
	targetSHA256 string
	err          error
}

func attachAgentAdmissionProviderConfigsForTest(server *Server) {
	if server == nil || server.runProjectionStore == nil {
		return
	}
	attachRunServiceForHandlerTest(
		server,
		server.runProjectionStore,
		mapExecutionInputLoader{},
		staticAdmissionSnapshotBuilder{targetSHA256: primaryAgentModelTargetSHA256ForTest},
		false,
	)
}

func (builder staticAdmissionSnapshotBuilder) BuildAgentAdmissionSnapshot(
	_ context.Context,
	personalMemoryRecallAvailable bool,
) (execution.AgentAdmissionSnapshot, error) {
	if builder.err != nil {
		return execution.AgentAdmissionSnapshot{}, execution.NewDependencyNotReadyError(builder.err)
	}
	if builder.targetSHA256 == "" {
		return execution.AgentAdmissionSnapshot{}, errors.New("primary agent model target is missing")
	}
	visibleTools := []string{campusSearchToolName}
	maxModelTurns := 2
	maxFunctionToolCalls := 1
	if personalMemoryRecallAvailable {
		visibleTools = append(visibleTools, personalMemoryRecallToolName)
		maxModelTurns = 3
		maxFunctionToolCalls = 2
	}
	snapshot := execution.AgentAdmissionSnapshot{
		AgentLimits: execution.AgentRuntimeLimitsSnapshot{
			AgentDeadlineMS:       1,
			ContextCharLimit:      1,
			CurrentInputCharLimit: 1,
			MaxOutputTokens:       1,
		},
		ExecutionStrategy: execution.ExecutionStrategySnapshot{
			Kind:                     "direct",
			MaxModelTurns:            maxModelTurns,
			MaxFunctionToolCalls:     maxFunctionToolCalls,
			SchemaVersion:            "execution_strategy.v4",
			VisibleFunctionToolNames: visibleTools,
		},
		PrimaryAgentTargetSHA256: builder.targetSHA256,
		ToolContractFingerprint: execution.ToolContractFingerprintSnapshot{
			FunctionSchemaSHA256: "sha256:" + strings.Repeat("a", 64),
			SchemaVersion:        "tool_contract_fingerprint.v1",
			ToolsSHA256:          "sha256:" + strings.Repeat("b", 64),
		},
		ToolContractFingerprintSHA256: "test-tool-contract-hash",
	}
	snapshot.AgentLimitsSHA256 = strings.TrimPrefix(execution.SHA256JSONRef(snapshot.AgentLimits), "sha256:")
	snapshot.ExecutionStrategySHA256 = strings.TrimPrefix(
		execution.SHA256JSONRef(snapshot.ExecutionStrategy),
		"sha256:",
	)
	snapshot.ToolContractFingerprintSHA256 = strings.TrimPrefix(
		execution.SHA256JSONRef(snapshot.ToolContractFingerprint),
		"sha256:",
	)
	return snapshot, nil
}

const primaryAgentModelTargetSHA256ForTest = "4b20ab70a9ac22073110f59ea007f27de19d731319b62ed4bd60b11d057c6635"
