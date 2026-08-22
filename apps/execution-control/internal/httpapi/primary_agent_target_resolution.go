package httpapi

import (
	"context"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/modelconfigclient"
)

func (s *Server) resolvePrimaryAgentTarget(
	ctx context.Context,
) (modelconfigclient.PrimaryAgentTarget, error) {
	if s.primaryAgentTargetErr != nil {
		return modelconfigclient.PrimaryAgentTarget{}, s.primaryAgentTargetErr
	}
	if s.primaryAgentTargetResolver == nil {
		return modelconfigclient.PrimaryAgentTarget{}, modelconfigclient.ErrNotConfigured
	}
	return s.primaryAgentTargetResolver.ResolvePrimaryAgentTarget(ctx)
}
