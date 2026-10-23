package memoryworkflow

import (
	"context"
	"errors"
	"github.com/MUC-WIKI/campus-agent/apps/memory-service/memoryruntime"
	enumspb "go.temporal.io/api/enums/v1"
	"go.temporal.io/api/serviceerror"
	"go.temporal.io/sdk/client"
)

func operationID(id string) string { return "campus-agent.memory.operation." + id }
func (d *Dispatcher) RestartMemoryAppendWorkflow(ctx context.Context, requestID string) error {
	id := "append:" + requestID
	r, err := d.Store.GetRequest(ctx, id)
	if err != nil {
		return err
	}
	if r.Kind != "append" {
		return memoryruntime.ErrRequestConflict
	}
	_, err = d.Client.ExecuteWorkflow(ctx, client.StartWorkflowOptions{ID: operationID(id), TaskQueue: WorkflowQueue, WorkflowIDReusePolicy: enumspb.WORKFLOW_ID_REUSE_POLICY_ALLOW_DUPLICATE, WorkflowIDConflictPolicy: enumspb.WORKFLOW_ID_CONFLICT_POLICY_USE_EXISTING}, Type, Input{ID: id})
	return err
}
func (d *Dispatcher) RunningMemoryAppendWorkflows(ctx context.Context, ids []string) (map[string]bool, error) {
	out := make(map[string]bool, len(ids))
	for _, id := range ids {
		desc, err := d.Client.DescribeWorkflowExecution(ctx, operationID("append:"+id), "")
		var missing *serviceerror.NotFound
		if errors.As(err, &missing) {
			continue
		}
		if err != nil {
			return nil, err
		}
		out[id] = desc.WorkflowExecutionInfo.Status == enumspb.WORKFLOW_EXECUTION_STATUS_RUNNING
	}
	return out, nil
}
