package memoryworkflow

import (
	"context"
	"errors"
	"github.com/MUC-WIKI/campus-agent/apps/memory-service/memoryruntime"
	enumspb "go.temporal.io/api/enums/v1"
	"go.temporal.io/api/serviceerror"
	"go.temporal.io/sdk/client"
	"log/slog"
	"time"
)

type Dispatcher struct {
	Store  memoryruntime.DurableRequestStore
	Client client.Client
}

func (d *Dispatcher) Run(ctx context.Context) {
	t := time.NewTicker(time.Second)
	defer t.Stop()
	for {
		if err := d.Once(ctx); err != nil && ctx.Err() == nil {
			slog.Error("memory dispatch failed", "error", err)
		}
		select {
		case <-ctx.Done():
			return
		case <-t.C:
		}
	}
}
func (d *Dispatcher) Once(ctx context.Context) error {
	rows, err := d.Store.PendingRequests(ctx, 32)
	if err != nil {
		return err
	}
	for _, r := range rows {
		_, err := d.Client.ExecuteWorkflow(ctx, client.StartWorkflowOptions{ID: "campus-agent.memory.operation." + r.ID, TaskQueue: WorkflowQueue, WorkflowIDReusePolicy: enumspb.WORKFLOW_ID_REUSE_POLICY_REJECT_DUPLICATE, WorkflowIDConflictPolicy: enumspb.WORKFLOW_ID_CONFLICT_POLICY_USE_EXISTING}, Type, Input{ID: r.ID})
		var exists *serviceerror.WorkflowExecutionAlreadyStarted
		if err != nil && !errors.As(err, &exists) {
			return err
		}
		if err := d.Store.MarkDispatched(ctx, r.ID); err != nil {
			return err
		}
	}
	return nil
}
