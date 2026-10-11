package httpapi

import (
	"context"
	"time"

	temporaladapter "github.com/MUC-WIKI/campus-agent/apps/agent-control/integration/adaptertest"
	"github.com/MUC-WIKI/campus-agent/apps/agent-control/internal/execution"
	"github.com/MUC-WIKI/campus-agent/apps/agent-control/internal/executionapplication"
	"github.com/MUC-WIKI/campus-agent/apps/agent-control/internal/executionreconciler"
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
	starter, _ := server.temporalStarter.(executionapplication.WorkflowStarter)
	reconciler := executionreconciler.New(executionreconciler.Options{
		Finalizer:        adapter.FinalizationAdapter,
		OperationTimeout: time.Duration(server.config.TemporalStartTimeoutMS) * time.Millisecond,
		Starter:          starter,
		Store:            server.runProjectionStore,
	})
	reconciler.ReconcileOnce(ctx)
}
