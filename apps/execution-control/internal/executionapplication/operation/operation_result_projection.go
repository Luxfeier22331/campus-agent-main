package operation

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/execution"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/executionapplication"
	activityprojection "github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/executionapplication/projection"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/executioncontract"
	"log/slog"
	"strings"
	"time"
)

// NormalizeOperationResult validates completed model output without invoking a provider.
func (s *OperationService) NormalizeOperationResult(ctx context.Context, run execution.DurableRun, request OperationRequest, response executionapplication.AgentRuntimeResult) (executioncontract.OperationOutput, error) {
	resultRef := activityprojection.WorkflowOperationResultRef(run.RequestID, request.StepID)
	if response.Operation != "" && strings.TrimSpace(response.Operation) != string(request.Operation) {
		return s.FailOperation(
			ctx,
			run,
			request,
			"workflow_operation_result_invalid",
			fmt.Errorf("runtime operation %q does not match %q", response.Operation, request.Operation),
		)
	}
	if err := execution.ValidateAgentRuntimeToolContract(
		request.AdmissionSnapshot.ToolContractFingerprint,
		response.ToolContractFingerprint,
	); err != nil {
		return s.FailOperation(ctx, run, request, "tool_contract_mismatch", err)
	}
	output, err := WorkflowOperationOutputFromRuntimeResponse(response, request.Operation, resultRef)
	if err != nil {
		return s.FailOperation(ctx, run, request, "workflow_operation_result_invalid", err)
	}
	output.RequestID = run.RequestID
	output.WorkflowResultRef = resultRef
	output.RuntimeRelease = strings.TrimSpace(response.RuntimeRelease)

	if output.Status != "completed" && output.Status != "failed" {
		return s.FailOperation(
			ctx,
			run,
			request,
			"workflow_operation_incomplete",
			fmt.Errorf("runtime operation status is %q", output.Status),
		)
	}
	if output.Status == "failed" {
		if output.Failure == nil || strings.TrimSpace(output.Failure.Code) == "" {
			return s.FailOperation(ctx, run, request, "workflow_operation_result_invalid", errors.New("failed runtime result has no classified failure"))
		}
	}
	if err := ValidateWorkflowOperationOutputSources(request, output); err != nil {
		return s.FailOperation(ctx, run, request, "workflow_operation_result_invalid", err)
	}
	if request.Operation == executioncontract.WorkflowOperationSynthesize {
		// Validate the runtime response before restoring already-admitted materials
		// for finalization and receipt replay.
		output.Evidence = append([]executioncontract.WorkflowEvidence{}, request.Evidence...)
		output.SourceAttempts = append([]executioncontract.WorkflowSourceAttempt{}, request.SourceAttempts...)
	}
	if output.Status != "failed" && request.Operation == executioncontract.WorkflowOperationSolve {
		if output.SolveOutcome != "answer" && output.SolveOutcome != "plan" {
			return s.FailOperation(ctx, run, request, "workflow_operation_result_invalid", errors.New("solver result has no valid outcome"))
		}
		if output.SolveOutcome == "answer" && strings.TrimSpace(output.FinalOutput) == "" {
			return s.FailOperation(ctx, run, request, "workflow_operation_result_invalid", errors.New("solver answer is empty"))
		}
		if output.SolveOutcome == "plan" && output.Plan == nil {
			return s.FailOperation(ctx, run, request, "workflow_operation_result_invalid", errors.New("solver plan is missing"))
		}
	}
	if output.Status != "failed" && request.Operation == executioncontract.WorkflowOperationReplan && output.Replan == nil {
		return s.FailOperation(ctx, run, request, "workflow_operation_result_invalid", errors.New("replanner result has no decision"))
	}
	if output.Status != "failed" && request.Operation == executioncontract.WorkflowOperationReplan {
		decisionErr := executioncontract.ValidateWorkflowReplanDecision(*output.Replan)
		if decisionErr == nil {
			decisionErr = executioncontract.ValidateWorkflowRemainingSteps(
				output.Replan.RemainingSteps,
				request.AdmissionSnapshot.AgentBudget.MaxPlanSteps,
				request.CompletedSteps,
				executioncontract.AgentCapabilitiesSnapshot(request.AdmissionSnapshot.AgentCapabilities),
			)
		}
		if decisionErr != nil {
			// A rejected model decision is not a transport failure. Preserve its
			// usage and let the workflow continue the existing admitted plan.
			output.Status = "failed"
			output.TerminalReason = "agent_runtime_failed"
			output.Failure = &executioncontract.ExecutionFailure{Code: "model_output_invalid", Operation: "workflow.replan", Detail: decisionErr.Error()}
			output.Replan = nil
		}
	}
	if output.Status != "failed" && (request.Operation == executioncontract.WorkflowOperationSolve || request.Operation == executioncontract.WorkflowOperationExecuteStep || request.Operation == executioncontract.WorkflowOperationSynthesize) &&
		strings.TrimSpace(output.FinalOutput) == "" {
		if request.Operation != executioncontract.WorkflowOperationSolve || output.SolveOutcome == "answer" {
			return s.FailOperation(ctx, run, request, "workflow_operation_result_invalid", errors.New("text operation result is empty"))
		}
	}
	if err := ValidateOperationOutputFields(output); err != nil {
		kind := "workflow_operation_result_invalid"
		var sizeError *execution.OperationPayloadTooLargeError
		if errors.As(err, &sizeError) {
			kind = "workflow_operation_payload_too_large"
		}
		return s.FailOperation(ctx, run, request, kind, err)
	}
	return output, nil
}

func (s *OperationService) ProjectBufferedSolveAnswer(ctx context.Context, run execution.DurableRun, request OperationRequest, output *executioncontract.OperationOutput) error {
	// Buffered solve answers arrive as one FinalOutput payload without streaming
	// answer_delta events. Project the full text as a single delta + completion so
	// the browser-visible event sequence matches the streaming shape and the
	// canonical terminal projection can render it unchanged.
	if !request.Stream &&
		request.Operation == executioncontract.WorkflowOperationSolve &&
		output.Status == "completed" &&
		output.SolveOutcome == "answer" &&
		strings.TrimSpace(output.FinalOutput) != "" {
		messageID := run.RequestID + ":answer"
		// Starting the stream atomically writes both answer_started and its first
		// delta. A repair after that commit only needs the completion event.
		if run.Status != execution.DurableRunStatusStreaming {
			if err := s.ProjectWorkflowAnswerDelta(ctx, run, messageID, 1, output.FinalOutput); err != nil {
				return err
			}
		}
		if err := s.ProjectWorkflowAnswerCompleted(ctx, run, messageID); err != nil {
			return err
		}
		output.AnswerStarted = true
	}
	return nil
}

func (s *OperationService) ProjectOperationCompletion(ctx context.Context, run execution.DurableRun, request OperationRequest, response executionapplication.AgentRuntimeResult, output executioncontract.OperationOutput, startedProjection activityprojection.StepProjection, completedAt time.Time) error {
	startedAt := startedProjection.StartedAt
	resultRef := activityprojection.WorkflowOperationResultRef(run.RequestID, request.StepID)
	resultPayload, err := WorkflowOperationResultPayload(request, output, startedProjection.Attempt, s.Options.DeploymentRelease)
	if err != nil {
		return err
	}
	identity := WorkflowProjectionIdentity{
		ActivityAttempt:   startedProjection.ActivityAttempt,
		ActivityID:        startedProjection.ActivityID,
		ActivityType:      startedProjection.ActivityType,
		Attempt:           startedProjection.Attempt,
		PreserveAttempt:   true,
		ScheduledAt:       startedProjection.ScheduledAt,
		ScheduleToStartMS: startedProjection.ScheduleToStartMS,
		StartedAt:         startedProjection.StartedAt,
		TemporalRunID:     startedProjection.TemporalRunID,
		WorkerID:          startedProjection.WorkerID,
		WorkflowID:        startedProjection.WorkflowID,
	}
	projectionStatus := "completed"
	if output.Status == "failed" {
		projectionStatus = "failed"
	}
	if err := s.ProjectStep(ctx, identity.Apply(activityprojection.StepProjection{
		Attempt:            startedProjection.Attempt,
		ActivityAttempt:    startedProjection.ActivityAttempt,
		PreserveAttempt:    true,
		Run:                run,
		Status:             projectionStatus,
		StepID:             request.StepID,
		StepKind:           request.StepKind,
		TaskQueue:          execution.FirstNonEmptyText(startedProjection.TaskQueue, executioncontract.ActivityTaskQueueAgent),
		WorkerID:           identity.WorkerID,
		StartedAt:          startedAt,
		CompletedAt:        completedAt,
		UpdatedAt:          completedAt,
		ResultKind:         WorkflowOperationResultKind(request.Operation),
		ProjectionRef:      resultRef,
		ProviderResponseID: output.ProviderResponseID,
		ModelProvider:      output.ModelProvider,
		ModelName:          output.ModelName,
		ModelRequestCount:  output.Usage.ModelRequestCount,
		InputTokens:        output.Usage.InputTokens,
		OutputTokens:       output.Usage.OutputTokens,
		CachedInputTokens:  output.Usage.CachedInputTokens,
		UsageObserved:      output.Usage.UsageObserved,
		TerminalReason:     output.TerminalReason,
		Payload:            resultPayload,
	})); err != nil {
		return err
	}
	if err := s.AppendRunEvent(ctx, execution.DurableRunEvent{
		EventID:              run.RequestID + ":" + request.StepID + ":completed",
		RequestID:            run.RequestID,
		ConversationID:       run.ConversationID,
		EventType:            execution.DurableRunEventTypeWorkflowOperationCompleted,
		OccurredAt:           completedAt,
		Visibility:           execution.DurableRunEventVisibilityInternal,
		PayloadSchemaVersion: "workflow-operation-event-v1",
		Payload: map[string]any{
			"operation":  string(request.Operation),
			"result_ref": resultRef,
			"step_id":    request.StepID,
			"status":     output.Status,
		},
	}); err != nil {
		return err
	}
	if output.Status == "failed" && output.Failure != nil && output.Failure.Code == "model_output_invalid" && len(response.ModelOutputDiagnostic) > 0 {
		var diagnostic execution.ModelOutputDiagnostic
		if json.Unmarshal(response.ModelOutputDiagnostic, &diagnostic) == nil && diagnostic.Valid() {
			diagnosticCtx, cancel := context.WithTimeout(ctx, time.Second)
			err := s.StateWriter.RecordModelOutputDiagnostic(diagnosticCtx, run.RequestID,
				activityprojection.StepResultID(run.RequestID, request.StepID, startedProjection.Attempt), diagnostic)
			cancel()
			if err != nil {
				slog.Warn("model output diagnostic was not stored", "request_id", run.RequestID, "step_id", request.StepID)
			}
		}
	}
	return nil
}
