package runtimeprojection

import (
	"context"
	"errors"
	"github.com/MUC-WIKI/campus-agent/apps/agent-control/internal/executionapplication"
	"github.com/MUC-WIKI/campus-agent/apps/agent-control/internal/executionapplication/projection"
	"github.com/MUC-WIKI/campus-agent/apps/agent-control/internal/executioncontract"
	"github.com/MUC-WIKI/campus-agent/apps/agent-control/internal/executionfailure"
)

func BindActivity(ctx context.Context, store executionapplication.StepProjectionStore, requestID string, m executioncontract.ActivityMetadata) (context.Context, error) {
	invalid := func(code string, retryable bool) (context.Context, error) {
		return ctx, executionfailure.SanitizedError(code, errors.New(code), !retryable)
	}
	if requestID == "" || m.WorkflowID == "" || m.TemporalRunID == "" || m.ActivityID == "" || m.ActivityType == "" || m.ActivityAttempt < 1 || m.TaskQueue == "" || m.ScheduledAt.IsZero() || m.StartedAt.IsZero() {
		return invalid("runtime_activity_metadata_invalid", false)
	}
	intent, err := store.GetWorkflowStartIntent(ctx, requestID)
	if err != nil {
		return ctx, err
	}
	if intent.WorkflowID != m.WorkflowID {
		return invalid("runtime_execution_identity_mismatch", false)
	}
	if intent.TemporalRunID == "" {
		return invalid("runtime_execution_binding_pending", true)
	}
	if intent.TemporalRunID != m.TemporalRunID {
		return invalid("runtime_execution_identity_mismatch", false)
	}
	return projection.WithEvidence(ctx, projection.InvocationEvidence{Present: true, WorkflowID: m.WorkflowID, RunID: m.TemporalRunID, ActivityID: m.ActivityID, ActivityType: m.ActivityType, Attempt: m.ActivityAttempt, ScheduledTime: m.ScheduledAt, StartedTime: m.StartedAt, TaskQueue: m.TaskQueue}), nil
}
