package httpapi

import (
	"context"
	"errors"
	"strings"

	"github.com/MUC-WIKI/campus-agent/apps/agent-control/internal/execution"
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
		return execution.AgentAdmissionSnapshot{}, errors.New("workflow model target is missing")
	}
	visibleTools := []string{"campus_search"}
	if personalMemoryRecallAvailable {
		visibleTools = append(visibleTools, "personal_memory_recall")
	}
	capabilities := execution.AgentCapabilitiesSnapshot{
		SchemaVersion:            execution.AgentCapabilitiesSchemaVersion,
		HostedWebSearch:          true,
		VisibleFunctionToolNames: visibleTools,
	}
	budget := execution.AgentRuntimeBudgetSnapshot{
		MaxFunctionToolCalls: 8,
		MaxModelTurns:        8,
		MaxPlanSteps:         6,
		MaxReplans:           3,
		SchemaVersion:        execution.AgentRuntimeBudgetSchemaVersion,
	}
	snapshot := execution.AgentAdmissionSnapshot{
		AgentLimits: execution.AgentRuntimeLimitsSnapshot{
			AgentDeadlineMS:       1,
			ContextCharLimit:      1,
			CurrentInputCharLimit: 1,
			MaxOutputTokens:       1,
		},
		AgentCapabilities: capabilities,
		AgentBudget:       budget,
		ModelTargetSHA256: builder.targetSHA256,
		ToolContractFingerprint: execution.ToolContractFingerprintSnapshot{
			FunctionSchemaSHA256: "sha256:" + strings.Repeat("a", 64),
			SchemaVersion:        execution.ToolContractFingerprintSchemaVersion,
			ToolsSHA256:          "sha256:" + strings.Repeat("b", 64),
		},
	}
	return snapshot, nil
}

const primaryAgentModelTargetSHA256ForTest = "4b20ab70a9ac22073110f59ea007f27de19d731319b62ed4bd60b11d057c6635"
