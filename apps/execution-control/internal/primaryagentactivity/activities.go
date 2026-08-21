package primaryagentactivity

import (
	"context"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/temporalruntime"
)

type Handler interface {
	ExecutePrimaryAgent(
		context.Context,
		temporalruntime.ExecutePrimaryAgentActivityInput,
	) (temporalruntime.ExecutePrimaryAgentActivityOutput, error)
}

type Activities struct {
	handler Handler
}

func New(handler Handler) Activities {
	return Activities{handler: handler}
}

func (activities Activities) ExecutePrimaryAgentActivity(
	ctx context.Context,
	input temporalruntime.ExecutePrimaryAgentActivityInput,
) (temporalruntime.ExecutePrimaryAgentActivityOutput, error) {
	return activities.handler.ExecutePrimaryAgent(ctx, input)
}

var _ temporalruntime.AgentActivities = Activities{}
