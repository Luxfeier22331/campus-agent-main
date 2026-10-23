// Package agenttest owns synthetic admission and frozen input fixtures used by
// stream and receipt integration tests. It starts no services.
package agenttest

import (
	"context"
	"strings"
	"testing"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/agent-control/internal/contracts"
	"github.com/MUC-WIKI/campus-agent/apps/agent-control/internal/execution"
	"github.com/MUC-WIKI/campus-agent/apps/agent-control/internal/executionapplication"
	"github.com/MUC-WIKI/campus-agent/apps/agent-control/internal/toolcontract"
)

type Input struct {
	Wire contracts.ExecutionPayloadWire
}

func (input Input) Load(context.Context, execution.DurableRun) (contracts.ExecutionPayloadWire, error) {
	return input.Wire, nil
}

func CreateQueuedRun(t *testing.T, store executionapplication.RunStore, requestID string) Input {
	t.Helper()
	input := Input{Wire: contracts.ExecutionPayloadWire{
		ExecutionContractVersion: contracts.ExecutionContractVersion,
		ResponseContract:         contracts.ResponseContract,
		RequestID:                requestID, ConversationID: "conversation-" + requestID,
		UserGoal: "校园服务指南", Context: map[string]any{},
	}}
	now := time.Now().UTC()
	_, err := store.CreateRun(t.Context(), execution.DurableRun{
		RequestID: requestID, ConversationID: input.Wire.ConversationID,
		OwnerUserID: "integration-user", Surface: "campus-web",
		Status: execution.DurableRunStatusCreated, TaskQueue: execution.WorkflowTaskQueue,
		CreatedAt: now, UpdatedAt: now,
		Metadata: map[string]any{
			"execution_contract_version": contracts.ExecutionContractVersion,
			"execution_input_ref":        "app-api://execution-inputs/" + requestID,
			"execution_input_sha256":     execution.HashAdmissionJSON(input.Wire),
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := store.TransitionRun(t.Context(), requestID, execution.DurableRunStatusQueued, "", now); err != nil {
		t.Fatal(err)
	}
	return input
}

type modelTarget struct{}

func (modelTarget) ResolveModelTarget(context.Context) (execution.ModelTarget, error) {
	return execution.ModelTarget{TargetSHA256: strings.Repeat("a", 64), HostedWebSearch: true}, nil
}

func AdmissionSnapshot(t *testing.T, personalMemory ...bool) execution.AgentAdmissionSnapshot {
	t.Helper()
	service := executionapplication.NewAdmissionService(executionapplication.AdmissionOptions{
		ToolContract:        toolcontract.Files{},
		ModelTargetResolver: modelTarget{}, AgentDeadlineMS: 60000,
	})
	snapshot, err := service.BuildAgentAdmissionSnapshot(t.Context(), len(personalMemory) > 0 && personalMemory[0])
	if err != nil {
		t.Fatal(err)
	}
	return snapshot
}
