package temporaladapter

import (
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/execution"
)

func limitsFromAdmissionSnapshot(snapshot execution.AgentRuntimeLimitsSnapshot) primaryAgentRuntimeLimits {
	return primaryAgentRuntimeLimits{
		AgentDeadlineMS:       snapshot.AgentDeadlineMS,
		ContextCharLimit:      snapshot.ContextCharLimit,
		CurrentInputCharLimit: snapshot.CurrentInputCharLimit,
		MaxOutputTokens:       snapshot.MaxOutputTokens,
	}
}
