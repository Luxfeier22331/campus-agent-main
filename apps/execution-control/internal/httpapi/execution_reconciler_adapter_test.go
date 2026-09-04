package httpapi

import (
	"context"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/execution"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/executionreconciler"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/temporaladapter"
)

func reconcileTemporalRunsOnceForTest(ctx context.Context, server *Server) {
	if server == nil {
		return
	}
	adapter := temporaladapter.New(temporaladapter.Options{
		Config:             server.config,
		RunProjectionStore: server.runProjectionStore,
		ProductFinalizationWriter: func(
			context.Context,
			execution.DurableRun,
			time.Time,
			map[string]any,
		) error {
			return nil
		},
	})
	reconciler := executionreconciler.New(executionreconciler.Options{
		Finalizer:        adapter,
		OperationTimeout: time.Duration(server.config.TemporalStartTimeoutMS) * time.Millisecond,
		Starter:          server.temporalStarter,
		Store:            server.runProjectionStore,
	})
	reconciler.ReconcileOnce(ctx)
}
