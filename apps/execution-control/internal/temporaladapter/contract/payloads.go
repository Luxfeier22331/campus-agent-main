package contract

import (
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/execution"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/memoryruntime"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/temporalruntime"
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
func MemoryCommandToDomain(s temporalruntime.PersonalMemoryCommandRequest) memoryruntime.PersonalMemoryCommandRequest {
	return memoryruntime.PersonalMemoryCommandRequest{CommandID: s.CommandID, CommandKind: s.CommandKind, Item: (*memoryruntime.PersonalMemoryCommandItem)(s.Item), LifecycleState: s.LifecycleState, OwnerGeneration: s.OwnerGeneration, OwnerSequence: s.OwnerSequence, SchemaVersion: s.SchemaVersion, SubjectID: s.SubjectID, SubjectRevision: s.SubjectRevision, SourceUpdatedAt: s.SourceUpdatedAt, SourceMessageIDs: s.SourceMessageIDs, SubjectScopeHash: s.SubjectScopeHash, SupersessionScope: s.SupersessionScope, TenantID: s.TenantID, UserID: s.UserID}
}
func MemoryCommandToWorkflow(s memoryruntime.PersonalMemoryCommandRequest) temporalruntime.PersonalMemoryCommandRequest {
	return temporalruntime.PersonalMemoryCommandRequest{CommandID: s.CommandID, CommandKind: s.CommandKind, Item: (*temporalruntime.PersonalMemoryCommandItem)(s.Item), LifecycleState: s.LifecycleState, OwnerGeneration: s.OwnerGeneration, OwnerSequence: s.OwnerSequence, SchemaVersion: s.SchemaVersion, SubjectID: s.SubjectID, SubjectRevision: s.SubjectRevision, SourceUpdatedAt: s.SourceUpdatedAt, SourceMessageIDs: s.SourceMessageIDs, SubjectScopeHash: s.SubjectScopeHash, SupersessionScope: s.SupersessionScope, TenantID: s.TenantID, UserID: s.UserID}
}
func WorkflowInput(input execution.WorkflowStartInput) temporalruntime.ToolExecutionWorkflowInput {
	return temporalruntime.ToolExecutionWorkflowInput{
		AdmissionSnapshot: AdmissionToWorkflow(input.AdmissionSnapshot), AdmissionSnapshotSHA256: input.AdmissionSnapshotSHA256, ConversationID: input.ConversationID, Namespace: input.Namespace, PayloadSHA256: input.PayloadSHA256, PersonalMemoryTimeoutSeconds: input.PersonalMemoryTimeoutSeconds, RequestID: input.RequestID, TaskQueue: input.TaskQueue, TraceParent: input.TraceParent, WorkflowID: input.WorkflowID,
	}
}
