package control

import (
	"github.com/MUC-WIKI/campus-agent/apps/agent-control/internal/execution"
	"github.com/MUC-WIKI/campus-agent/apps/agent-control/internal/executioncontract"
	"github.com/MUC-WIKI/campus-agent/apps/agent-control/internal/temporalclient"
)

func AdmissionToDomain(s executioncontract.AgentAdmissionSnapshot) execution.AgentAdmissionSnapshot {
	return execution.AgentAdmissionSnapshot{
		AgentLimits: execution.AgentRuntimeLimitsSnapshot(s.AgentLimits), AgentCapabilities: execution.AgentCapabilitiesSnapshot(s.AgentCapabilities), AgentBudget: execution.AgentRuntimeBudgetSnapshot(s.AgentBudget), ModelTargetSHA256: s.ModelTargetSHA256, ToolContractFingerprint: execution.ToolContractFingerprintSnapshot(s.ToolContractFingerprint),
	}
}
func AdmissionToWorkflow(s execution.AgentAdmissionSnapshot) executioncontract.AgentAdmissionSnapshot {
	return executioncontract.AgentAdmissionSnapshot{
		AgentLimits: executioncontract.AgentRuntimeLimitsSnapshot(s.AgentLimits), AgentCapabilities: executioncontract.AgentCapabilitiesSnapshot(s.AgentCapabilities), AgentBudget: executioncontract.AgentRuntimeBudgetSnapshot(s.AgentBudget), ModelTargetSHA256: s.ModelTargetSHA256, ToolContractFingerprint: executioncontract.ToolContractFingerprintSnapshot(s.ToolContractFingerprint),
	}
}
func WorkflowInput(input execution.WorkflowStartInput) temporalclient.ToolExecutionWorkflowInput {
	return temporalclient.ToolExecutionWorkflowInput{
		DeadlineAt:             input.DeadlineAt,
		MemoryDeliveryExternal: input.MemoryDeliveryExternal,
		AdmissionSnapshot:      AdmissionToWorkflow(input.AdmissionSnapshot), AdmissionSnapshotSHA256: input.AdmissionSnapshotSHA256, ConversationID: input.ConversationID, Namespace: input.Namespace, PayloadSHA256: input.PayloadSHA256, PersonalMemoryTimeoutSeconds: input.PersonalMemoryTimeoutSeconds, RequestID: input.RequestID, TaskQueue: input.TaskQueue, TraceParent: input.TraceParent, WorkflowID: input.WorkflowID,
	}
}
