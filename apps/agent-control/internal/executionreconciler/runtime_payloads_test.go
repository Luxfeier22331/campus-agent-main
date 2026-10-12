package executionreconciler

import (
	"context"
	"errors"
	"github.com/MUC-WIKI/campus-agent/apps/agent-control/internal/execution"
	"github.com/MUC-WIKI/campus-agent/apps/agent-control/internal/executionapplication"
	"testing"
)

type payloadCleanupStore struct {
	fail    bool
	deleted int
}

func (s *payloadCleanupStore) ListTerminalRuntimePayloads(context.Context, string, int) ([]execution.RuntimePayloadExecution, error) {
	return []execution.RuntimePayloadExecution{{RequestID: "run", WorkflowID: "wf", TemporalRunID: "root"}}, nil
}
func (s *payloadCleanupStore) DeleteRuntimePayloads(context.Context, string) error {
	if s.fail {
		s.fail = false
		return errors.New("temporary deletion failure")
	}
	s.deleted++
	return nil
}

type payloadWorkflow struct {
	executionapplication.WorkflowStarter
	status execution.WorkflowExecutionStatus
}

func (s *payloadWorkflow) DescribeToolExecutionWorkflow(context.Context, string, string) (execution.WorkflowExecutionInfo, error) {
	return execution.WorkflowExecutionInfo{Found: true, Status: s.status}, nil
}
func TestPayloadCleanupWaitsForWorkflowAndRetriesDeletion(t *testing.T) {
	store := &payloadCleanupStore{fail: true}
	workflow := &payloadWorkflow{status: execution.WorkflowExecutionStatusRunning}
	r := New(Options{Payloads: store, Starter: workflow})
	r.ReconcileRuntimePayloads(t.Context())
	if store.deleted != 0 || !store.fail {
		t.Fatal("deleted before activity acknowledgement")
	}
	workflow.status = execution.WorkflowExecutionStatusCompleted
	r.ReconcileRuntimePayloads(t.Context())
	if store.deleted != 0 {
		t.Fatal("failed deletion counted as success")
	}
	r.ReconcileRuntimePayloads(t.Context())
	if store.deleted != 1 {
		t.Fatal("cleanup did not retry")
	}
}
