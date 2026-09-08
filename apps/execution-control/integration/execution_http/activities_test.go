//go:build temporal_integration

package execution_http_test

import (
	"context"
	"sync"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/integration/temporalfake"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/execution"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/executionpersistence"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/temporalruntime"
)

type projectionActivities struct {
	temporalfake.Activities
	store *executionpersistence.InMemoryRunProjectionStore
}

func (a projectionActivities) SolveTaskActivity(
	ctx context.Context,
	input temporalruntime.SolveTaskActivityInput,
) (temporalruntime.WorkflowOperationActivityOutput, error) {
	if err := a.transitionRunToRunning(ctx, input.RequestID); err != nil {
		return temporalruntime.WorkflowOperationActivityOutput{}, err
	}
	return temporalruntime.WorkflowOperationActivityOutput{
		Operation:         temporalruntime.WorkflowOperationSolve,
		SolveOutcome:      "answer",
		WorkflowResultRef: "projection://runs/" + input.RequestID + "/solve/initial/result",
		FinalOutput:       "HTTP Temporal integration answer",
		RequestID:         input.RequestID,
		Status:            "completed",
		TerminalReason:    "answer_completed",
	}, nil
}

func (a projectionActivities) WriteWorkflowFinalizationActivity(
	ctx context.Context,
	input temporalruntime.WriteWorkflowFinalizationActivityInput,
) (temporalruntime.WorkflowFinalizationActivityOutput, error) {
	run, err := a.store.GetRun(ctx, input.RequestID)
	if err != nil {
		return temporalruntime.WorkflowFinalizationActivityOutput{}, err
	}
	completedAt := time.Now().UTC()
	finalizationRef := "projection://runs/" + input.RequestID + "/finalization"
	if _, err := a.store.AppendRunEvent(ctx, execution.DurableRunEvent{
		EventID:              input.RequestID + ":finalization-completed",
		RequestID:            input.RequestID,
		ConversationID:       run.ConversationID,
		EventType:            execution.DurableRunEventTypeFinalizationCompleted,
		OccurredAt:           completedAt,
		Visibility:           execution.DurableRunEventVisibilityBrowser,
		PayloadSchemaVersion: "run-event-v1",
		Payload: map[string]any{
			"request_id": run.RequestID,
		},
	}); err != nil {
		return temporalruntime.WorkflowFinalizationActivityOutput{}, err
	}
	if _, err := a.store.UpsertStepResult(ctx, execution.StepResultProjection{
		ResultID:             input.RequestID + ":finalization.write:result-1",
		StepID:               "finalization.write",
		RequestID:            input.RequestID,
		AttemptID:            input.RequestID + ":finalization.write:attempt-1",
		Status:               "completed",
		ResultKind:           "final_answer_projection",
		ProjectionRef:        finalizationRef,
		CreatedAt:            completedAt,
		PayloadSchemaVersion: "step-result-projection-v1",
		SanitizedPayload:     map[string]any{"activity_attempt": 1},
	}); err != nil {
		return temporalruntime.WorkflowFinalizationActivityOutput{}, err
	}
	if _, err := a.store.CompleteRunProjection(ctx, execution.DurableRunCompleteRequest{
		FinalResponseRef: finalizationRef,
		Now:              completedAt,
		RequestID:        input.RequestID,
		TerminalReason:   execution.DurableTerminalReasonAnswerCompleted,
	}); err != nil {
		return temporalruntime.WorkflowFinalizationActivityOutput{}, err
	}
	if _, err := a.store.AppendRunEvent(ctx, execution.DurableRunEvent{
		EventID:              input.RequestID + ":run-completed",
		RequestID:            input.RequestID,
		ConversationID:       run.ConversationID,
		EventType:            execution.DurableRunEventTypeRunCompleted,
		OccurredAt:           completedAt,
		Visibility:           execution.DurableRunEventVisibilityBrowser,
		PayloadSchemaVersion: "run-event-v1",
		Payload: map[string]any{
			"projection_ref":  finalizationRef,
			"status":          string(execution.DurableRunStatusCompleted),
			"terminal_reason": string(execution.DurableTerminalReasonAnswerCompleted),
		},
	}); err != nil {
		return temporalruntime.WorkflowFinalizationActivityOutput{}, err
	}
	if _, err := a.store.UpsertRunStep(ctx, execution.RunStepProjection{
		StepID:               "finalization.write",
		RequestID:            input.RequestID,
		ConversationID:       run.ConversationID,
		StepKind:             "finalization",
		Tool:                 "",
		Status:               "completed",
		TaskQueue:            temporalruntime.ActivityTaskQueueCore,
		WorkerID:             "http-temporal-integration",
		StartedAt:            completedAt,
		CompletedAt:          completedAt,
		UpdatedAt:            completedAt,
		PayloadSchemaVersion: "run-step-projection-v1",
		SanitizedPayload: map[string]any{
			"agent_result_ref": input.WorkflowResult.WorkflowResultRef,
			"projection_ref":   finalizationRef,
		},
	}); err != nil {
		return temporalruntime.WorkflowFinalizationActivityOutput{}, err
	}
	return temporalruntime.WorkflowFinalizationActivityOutput{
		CompletedAt:   completedAt,
		ProjectionRef: finalizationRef,
		RequestID:     input.RequestID,
		Status:        "completed",
	}, nil
}

func (a projectionActivities) FinalizeExecutionCancellationActivity(
	ctx context.Context,
	input temporalruntime.FinalizeExecutionCancellationActivityInput,
) (temporalruntime.FinalizeExecutionCancellationActivityOutput, error) {
	run, err := a.store.CancelRunProjection(ctx, execution.DurableRunCancelRequest{
		RequestID: input.RequestID,
		Reason:    input.Reason,
		Now:       input.CanceledAt,
	})
	if err != nil {
		return temporalruntime.FinalizeExecutionCancellationActivityOutput{}, err
	}
	return temporalruntime.FinalizeExecutionCancellationActivityOutput{
		RequestID: run.RequestID,
		Status:    string(run.Status),
	}, nil
}

func (a projectionActivities) transitionRunToRunning(ctx context.Context, runID string) error {
	now := time.Now().UTC()
	run, err := a.store.GetRun(ctx, runID)
	if err != nil {
		return err
	}
	switch run.Status {
	case execution.DurableRunStatusQueued:
		if _, err := a.store.TransitionRun(ctx, runID, execution.DurableRunStatusAdmitted, "", now); err != nil {
			return err
		}
		_, err := a.store.TransitionRun(ctx, runID, execution.DurableRunStatusRunning, "", now)
		return err
	case execution.DurableRunStatusAdmitted:
		_, err := a.store.TransitionRun(ctx, runID, execution.DurableRunStatusRunning, "", now)
		return err
	case execution.DurableRunStatusRunning, execution.DurableRunStatusStreaming:
		return nil
	default:
		return nil
	}
}

type blockingProjectionActivities struct {
	projectionActivities
	once    sync.Once
	started chan struct{}
}

func (a *blockingProjectionActivities) SolveTaskActivity(
	ctx context.Context,
	input temporalruntime.SolveTaskActivityInput,
) (temporalruntime.WorkflowOperationActivityOutput, error) {
	if err := a.transitionRunToRunning(ctx, input.RequestID); err != nil {
		return temporalruntime.WorkflowOperationActivityOutput{}, err
	}
	a.once.Do(func() { close(a.started) })
	return temporalruntime.WorkflowOperationActivityOutput{}, temporalfake.WaitForCancellation(ctx)
}
