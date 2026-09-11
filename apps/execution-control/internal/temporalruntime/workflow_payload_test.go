package temporalruntime

import (
	"context"
	"strings"
	"testing"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/execution"
	"go.temporal.io/sdk/testsuite"
	"go.temporal.io/sdk/workflow"
)

func TestOversizedActivityInputIsRejectedBeforeScheduling(t *testing.T) {
	env := (&testsuite.WorkflowTestSuite{}).NewTestWorkflowEnvironment()
	calls := 0
	activity := func(context.Context, string) error { calls++; return nil }
	env.RegisterActivity(activity)
	flow := func(ctx workflow.Context) error {
		ctx = workflow.WithActivityOptions(ctx, workflow.ActivityOptions{StartToCloseTimeout: time.Second})
		return executeBoundedActivity(ctx, "activity", strings.Repeat("x", execution.MaxAgentOperationPayloadBytes)).Get(ctx, nil)
	}
	env.ExecuteWorkflow(flow)
	if err := env.GetWorkflowError(); err == nil || !strings.Contains(err.Error(), "workflow_operation_payload_too_large") {
		t.Fatalf("error=%v", err)
	}
	if calls != 0 {
		t.Fatal("oversized input was dispatched")
	}
}
