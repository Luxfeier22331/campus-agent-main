package temporaladapter

import (
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/execution"
)

func limitsFromAdmissionSnapshot(snapshot execution.AgentRuntimeLimitsSnapshot) workflowRuntimeLimits {
	return workflowRuntimeLimits{
		AgentDeadlineMS:       snapshot.AgentDeadlineMS,
		ContextCharLimit:      snapshot.ContextCharLimit,
		CurrentInputCharLimit: snapshot.CurrentInputCharLimit,
		MaxOutputTokens:       snapshot.MaxOutputTokens,
	}
}
