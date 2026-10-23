package operation

import (
	"github.com/MUC-WIKI/campus-agent/apps/agent-control/internal/execution"
)

func LimitsFromAdmissionSnapshot(snapshot execution.AgentRuntimeLimitsSnapshot) WorkflowRuntimeLimits {
	return WorkflowRuntimeLimits{
		AgentDeadlineMS:       snapshot.AgentDeadlineMS,
		ContextCharLimit:      snapshot.ContextCharLimit,
		CurrentInputCharLimit: snapshot.CurrentInputCharLimit,
		MaxOutputTokens:       snapshot.MaxOutputTokens,
	}
}
