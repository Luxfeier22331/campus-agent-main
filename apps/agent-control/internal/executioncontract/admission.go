package executioncontract

import "github.com/MUC-WIKI/campus-agent/apps/agent-control/internal/execution"

func (s AgentAdmissionSnapshot) ToDomain() execution.AgentAdmissionSnapshot {
	return execution.AgentAdmissionSnapshot{AgentLimits: execution.AgentRuntimeLimitsSnapshot(s.AgentLimits), AgentCapabilities: execution.AgentCapabilitiesSnapshot(s.AgentCapabilities), AgentBudget: execution.AgentRuntimeBudgetSnapshot(s.AgentBudget), ModelTargetSHA256: s.ModelTargetSHA256, ToolContractFingerprint: execution.ToolContractFingerprintSnapshot(s.ToolContractFingerprint)}
}

func AdmissionFromDomain(s execution.AgentAdmissionSnapshot) AgentAdmissionSnapshot {
	return AgentAdmissionSnapshot{AgentLimits: AgentRuntimeLimitsSnapshot(s.AgentLimits), AgentCapabilities: AgentCapabilitiesSnapshot(s.AgentCapabilities), AgentBudget: AgentRuntimeBudgetSnapshot(s.AgentBudget), ModelTargetSHA256: s.ModelTargetSHA256, ToolContractFingerprint: ToolContractFingerprintSnapshot(s.ToolContractFingerprint)}
}
