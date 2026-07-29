package httpapi

import (
	"context"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/execution"
)

func (s *Server) deleteProtectedPayloads(ctx context.Context, run execution.DurableRun) error {
	store, err := s.protectedPayloadStore()
	if err != nil {
		return err
	}
	return store.DeleteProtectedPayloads(ctx, run.RunID)
}
