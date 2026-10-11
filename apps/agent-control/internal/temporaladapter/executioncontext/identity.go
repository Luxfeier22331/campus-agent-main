package executioncontext

import (
	"context"
	"errors"
	"github.com/MUC-WIKI/campus-agent/apps/agent-control/internal/execution"
	"github.com/MUC-WIKI/campus-agent/apps/agent-control/internal/executionapplication"
	projection "github.com/MUC-WIKI/campus-agent/apps/agent-control/internal/executionapplication/projection"
	activitysupport "github.com/MUC-WIKI/campus-agent/apps/agent-control/internal/temporaladapter/activitysupport"
	"go.temporal.io/sdk/activity"
	"strings"
)

func EnsureRootExecution(
	ctx context.Context,
	store executionapplication.StepProjectionStore,
	requestID string,
	allowSuperseded bool,
) error {
	if !activity.IsActivity(ctx) {
		return nil
	}
	if store == nil {
		return execution.ErrRunProjectionStoreNotConfigured
	}
	intent, err := store.GetWorkflowStartIntent(ctx, strings.TrimSpace(requestID))
	if err != nil {
		return activitysupport.SanitizedTemporalApplicationError(
			"temporal_execution_binding_unavailable",
			err,
			false,
		)
	}
	info := activity.GetInfo(ctx)
	workflowID := strings.TrimSpace(info.WorkflowExecution.ID)
	temporalRunID := strings.TrimSpace(info.WorkflowExecution.RunID)
	if workflowID == "" || temporalRunID == "" || strings.TrimSpace(intent.WorkflowID) != workflowID {
		return activitysupport.SanitizedTemporalApplicationError(
			"temporal_execution_binding_mismatch",
			errors.New("activity workflow execution does not match its durable workflow identity"),
			true,
		)
	}
	boundRunID := strings.TrimSpace(intent.TemporalRunID)
	if boundRunID == "" {
		return activitysupport.SanitizedTemporalApplicationError(
			"temporal_execution_binding_pending",
			errors.New("durable root Temporal Run ID is not confirmed yet"),
			false,
		)
	}
	if boundRunID != temporalRunID {
		return activitysupport.SanitizedTemporalApplicationError(
			"temporal_execution_binding_mismatch",
			errors.New("activity Temporal Run ID is not the durable root execution"),
			true,
		)
	}
	if intent.State == execution.LifecycleIntentStateSuperseded && !allowSuperseded {
		return activitysupport.SanitizedTemporalApplicationError(
			"temporal_execution_cancellation_pending",
			errors.New("durable workflow execution was superseded by cancellation"),
			false,
		)
	}
	if intent.State != execution.LifecycleIntentStateConfirmed &&
		(!allowSuperseded || intent.State != execution.LifecycleIntentStateSuperseded) {
		return activitysupport.SanitizedTemporalApplicationError(
			"temporal_execution_binding_pending",
			errors.New("durable workflow execution binding is not active"),
			false,
		)
	}
	return nil
}

func InvocationEvidence(ctx context.Context) projection.InvocationEvidence {
	if !activity.IsActivity(ctx) {
		return projection.InvocationEvidence{}
	}
	info := activity.GetInfo(ctx)
	return projection.InvocationEvidence{Present: true, WorkflowID: info.WorkflowExecution.ID, RunID: info.WorkflowExecution.RunID, ActivityID: info.ActivityID, ActivityType: info.ActivityType.Name, Attempt: info.Attempt, ScheduledTime: info.ScheduledTime, StartedTime: info.StartedTime, TaskQueue: info.TaskQueue}
}
