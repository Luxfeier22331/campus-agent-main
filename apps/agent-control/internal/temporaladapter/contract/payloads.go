package contract

import (
	"github.com/MUC-WIKI/campus-agent/apps/agent-control/internal/execution"
	"github.com/MUC-WIKI/campus-agent/apps/agent-control/internal/temporalruntime"
)

func AdmissionToDomain(s temporalruntime.AgentAdmissionSnapshot) execution.AgentAdmissionSnapshot {
	return execution.AgentAdmissionSnapshot{
		AgentLimits: execution.AgentRuntimeLimitsSnapshot(s.AgentLimits), AgentCapabilities: execution.AgentCapabilitiesSnapshot(s.AgentCapabilities), AgentBudget: execution.AgentRuntimeBudgetSnapshot(s.AgentBudget), ModelTargetSHA256: s.ModelTargetSHA256, ToolContractFingerprint: execution.ToolContractFingerprintSnapshot(s.ToolContractFingerprint),
	}
}
func AdmissionToWorkflow(s execution.AgentAdmissionSnapshot) temporalruntime.AgentAdmissionSnapshot {
	return temporalruntime.AgentAdmissionSnapshot{
		AgentLimits: temporalruntime.AgentRuntimeLimitsSnapshot(s.AgentLimits), AgentCapabilities: temporalruntime.AgentCapabilitiesSnapshot(s.AgentCapabilities), AgentBudget: temporalruntime.AgentRuntimeBudgetSnapshot(s.AgentBudget), ModelTargetSHA256: s.ModelTargetSHA256, ToolContractFingerprint: temporalruntime.ToolContractFingerprintSnapshot(s.ToolContractFingerprint),
	}
}
func WorkflowInput(input execution.WorkflowStartInput) temporalruntime.ToolExecutionWorkflowInput {
	return temporalruntime.ToolExecutionWorkflowInput{
		DeadlineAt:             input.DeadlineAt,
		MemoryDeliveryExternal: input.MemoryDeliveryExternal,
		AdmissionSnapshot:      AdmissionToWorkflow(input.AdmissionSnapshot), AdmissionSnapshotSHA256: input.AdmissionSnapshotSHA256, ConversationID: input.ConversationID, Namespace: input.Namespace, PayloadSHA256: input.PayloadSHA256, PersonalMemoryTimeoutSeconds: input.PersonalMemoryTimeoutSeconds, RequestID: input.RequestID, TaskQueue: input.TaskQueue, TraceParent: input.TraceParent, WorkflowID: input.WorkflowID,
	}
}
