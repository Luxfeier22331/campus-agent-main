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
	RetrieveCampusDocsEvidence(
		context.Context,
		temporalruntime.RetrieveCampusDocsEvidenceActivityInput,
	) (temporalruntime.CampusDocsRetrievalResult, error)
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

func (activities Activities) RetrieveCampusDocsEvidenceActivity(
	ctx context.Context,
	input temporalruntime.RetrieveCampusDocsEvidenceActivityInput,
) (temporalruntime.CampusDocsRetrievalResult, error) {
	return activities.handler.RetrieveCampusDocsEvidence(ctx, input)
}

var _ temporalruntime.AgentActivities = Activities{}
