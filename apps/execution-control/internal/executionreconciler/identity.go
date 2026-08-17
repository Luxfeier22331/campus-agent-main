package executionreconciler

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/execution"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/telemetry"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/temporalruntime"
	enumspb "go.temporal.io/api/enums/v1"
	"net/http"
	"strings"
)

func (r *Reconciler) DecodeAndValidateWorkflowStartInput(
	intent execution.WorkflowStartIntent,
	run execution.DurableRun,
) (temporalruntime.ToolExecutionWorkflowInput, error) {
	var input temporalruntime.ToolExecutionWorkflowInput
	if err := json.Unmarshal(intent.WorkflowInputJSON, &input); err != nil {
		return input, fmt.Errorf("workflow input JSON is invalid: %w", err)
	}
	if input.RunID != run.RunID || input.RequestID != run.RequestID || input.TraceID != run.TraceID ||
		input.TurnID != run.TurnID || input.ConversationID != run.ConversationID {
		return input, errors.New("workflow input identity does not match durable run")
	}
	wantWorkflowID := "campus-agent.chat." + run.RunID
	if input.WorkflowID != wantWorkflowID || intent.WorkflowID != wantWorkflowID {
		return input, errors.New("workflow identity is not canonical")
	}
	if input.TaskQueue != temporalruntime.WorkflowTaskQueue || intent.TaskQueue != temporalruntime.WorkflowTaskQueue {
		return input, errors.New("workflow task queue is not v3")
	}
	if input.PayloadSHA256 != intent.PayloadSHA256 || !validTemporalFailureHash(input.PayloadSHA256) {
		return input, errors.New("workflow input payload hash is invalid")
	}
	if r.finalizer == nil {
		return input, errors.New("workflow admission validator is not configured")
	}
	if err := r.finalizer.ValidateWorkflowAdmission(
		input.AdmissionSnapshot,
		input.AdmissionSnapshot.ExecutionStrategy.VisibleToolNames,
	); err != nil {
		return input, fmt.Errorf("workflow admission snapshot is invalid: %w", err)
	}
	return input, nil
}

func traceContextForWorkflowStart(ctx context.Context, input temporalruntime.ToolExecutionWorkflowInput) context.Context {
	traceParent := strings.TrimSpace(input.TraceParent)
	if traceParent == "" {
		return ctx
	}
	headers := http.Header{}
	headers.Set("traceparent", traceParent)
	return telemetry.ExtractIncomingContext(ctx, headers)
}

func temporalWorkflowTerminal(status enumspb.WorkflowExecutionStatus) bool {
	switch status {
	case enumspb.WORKFLOW_EXECUTION_STATUS_COMPLETED,
		enumspb.WORKFLOW_EXECUTION_STATUS_FAILED,
		enumspb.WORKFLOW_EXECUTION_STATUS_CANCELED,
		enumspb.WORKFLOW_EXECUTION_STATUS_TERMINATED,
		enumspb.WORKFLOW_EXECUTION_STATUS_CONTINUED_AS_NEW,
		enumspb.WORKFLOW_EXECUTION_STATUS_TIMED_OUT:
		return true
	default:
		return false
	}
}

func (r *Reconciler) failCloseUnauthorizedWorkflowSuccessor(
	ctx context.Context,
	store execution.RunProjectionStore,
	control temporalruntime.WorkflowControl,
	run execution.DurableRun,
	start execution.WorkflowStartIntent,
	expected temporalruntime.ToolExecutionWorkflowIdentity,
	exact temporalruntime.WorkflowExecutionInfo,
	command *execution.RunCancellationCommand,
) bool {
	if exact.CloseTime.IsZero() || strings.TrimSpace(exact.RunID) == "" ||
		strings.TrimSpace(exact.FirstRunID) != strings.TrimSpace(exact.RunID) {
		return false
	}
	if _, found := r.describeMatchingWorkflowSuccessor(
		ctx,
		control,
		start.WorkflowID,
		exact.RunID,
		expected,
	); !found {
		return false
	}
	if command != nil && !r.confirmCancellation(ctx, store, *command) {
		return true
	}
	if err := r.finalizeClosedWorkflowFailure(
		ctx,
		store,
		run,
		exact.CloseTime,
		WorkflowUnauthorizedSuccessorFailure,
	); err != nil && ctx.Err() == nil {
		r.logWarn("unauthorized Temporal workflow successor fail-close failed", "run_id", run.RunID, "error", err)
	}
	return true
}

func (r *Reconciler) describeMatchingWorkflowSuccessor(
	ctx context.Context,
	control temporalruntime.WorkflowControl,
	workflowID string,
	rootTemporalRunID string,
	expected temporalruntime.ToolExecutionWorkflowIdentity,
) (temporalruntime.WorkflowExecutionInfo, bool) {
	rootTemporalRunID = strings.TrimSpace(rootTemporalRunID)
	if rootTemporalRunID == "" {
		return temporalruntime.WorkflowExecutionInfo{}, false
	}
	probeCtx, cancel := context.WithTimeout(ctx, r.operationTimeout)
	latest, err := control.DescribeToolExecutionWorkflow(probeCtx, workflowID, "")
	cancel()
	if err != nil || !latest.Found || strings.TrimSpace(latest.RunID) == "" ||
		strings.TrimSpace(latest.RunID) == rootTemporalRunID ||
		strings.TrimSpace(latest.FirstRunID) != rootTemporalRunID ||
		!temporalWorkflowMemoIdentityMatches(latest, expected) {
		return temporalruntime.WorkflowExecutionInfo{}, false
	}
	return latest, true
}

func temporalWorkflowMemoIdentityMatches(
	info temporalruntime.WorkflowExecutionInfo,
	expected temporalruntime.ToolExecutionWorkflowIdentity,
) bool {
	return info.Found && strings.TrimSpace(info.WorkflowID) == expected.WorkflowID &&
		info.IdentityState == temporalruntime.WorkflowIdentityKnown && info.Identity == expected
}

func (r *Reconciler) verifyUnboundRootWorkflowExecutionCandidate(
	ctx context.Context,
	control temporalruntime.WorkflowControl,
	workflowID string,
	expected temporalruntime.ToolExecutionWorkflowIdentity,
	candidate temporalruntime.WorkflowExecutionInfo,
) (temporalruntime.WorkflowExecutionInfo, bool) {
	temporalRunID := strings.TrimSpace(candidate.RunID)
	if temporalRunID == "" || strings.TrimSpace(candidate.FirstRunID) != temporalRunID {
		return temporalruntime.WorkflowExecutionInfo{}, false
	}
	if err := temporalruntime.ValidateToolExecutionWorkflowIdentity(candidate, expected); err != nil {
		return temporalruntime.WorkflowExecutionInfo{}, false
	}
	probeCtx, cancel := context.WithTimeout(ctx, r.operationTimeout)
	exact, err := control.DescribeToolExecutionWorkflow(probeCtx, workflowID, temporalRunID)
	cancel()
	if err != nil || strings.TrimSpace(exact.RunID) != temporalRunID ||
		strings.TrimSpace(exact.FirstRunID) != temporalRunID {
		return temporalruntime.WorkflowExecutionInfo{}, false
	}
	if err := temporalruntime.ValidateToolExecutionWorkflowIdentity(exact, expected); err != nil {
		return temporalruntime.WorkflowExecutionInfo{}, false
	}
	return r.describeLatestMatchingBoundWorkflowExecution(
		ctx,
		control,
		workflowID,
		temporalRunID,
		expected,
		temporalRunID,
	)
}

func (r *Reconciler) describeLatestMatchingBoundWorkflowExecution(
	ctx context.Context,
	control temporalruntime.WorkflowControl,
	workflowID string,
	temporalRunID string,
	expected temporalruntime.ToolExecutionWorkflowIdentity,
	firstRunID string,
) (temporalruntime.WorkflowExecutionInfo, bool) {
	temporalRunID = strings.TrimSpace(temporalRunID)
	firstRunID = strings.TrimSpace(firstRunID)
	if temporalRunID == "" || firstRunID != temporalRunID {
		return temporalruntime.WorkflowExecutionInfo{}, false
	}
	probeCtx, cancel := context.WithTimeout(ctx, r.operationTimeout)
	latest, err := control.DescribeToolExecutionWorkflow(probeCtx, workflowID, "")
	cancel()
	if err != nil || !latest.Found || strings.TrimSpace(latest.RunID) != temporalRunID ||
		strings.TrimSpace(latest.FirstRunID) != firstRunID {
		return temporalruntime.WorkflowExecutionInfo{}, false
	}
	if err := temporalruntime.ValidateToolExecutionWorkflowIdentity(latest, expected); err != nil {
		return temporalruntime.WorkflowExecutionInfo{}, false
	}
	return latest, true
}

func validTemporalFailureHash(value string) bool {
	value = strings.TrimSpace(value)
	if len(value) != 64 {
		return false
	}
	for _, char := range value {
		if (char >= '0' && char <= '9') || (char >= 'a' && char <= 'f') {
			continue
		}
		return false
	}
	return true
}

func temporalRunTerminal(status execution.DurableRunStatus) bool {
	switch status {
	case execution.DurableRunStatusCompleted,
		execution.DurableRunStatusFailed,
		execution.DurableRunStatusCanceled,
		execution.DurableRunStatusExpired:
		return true
	default:
		return false
	}
}
