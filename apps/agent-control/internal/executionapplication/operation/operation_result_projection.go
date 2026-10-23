package operation

import (
	"context"
	"encoding/json"
	"errors"
	"github.com/MUC-WIKI/campus-agent/apps/agent-control/internal/answerstream"
	"github.com/MUC-WIKI/campus-agent/apps/agent-control/internal/execution"
	"github.com/MUC-WIKI/campus-agent/apps/agent-control/internal/executionapplication"
	activityprojection "github.com/MUC-WIKI/campus-agent/apps/agent-control/internal/executionapplication/projection"
	"github.com/MUC-WIKI/campus-agent/apps/agent-control/internal/executioncontract"
	"log/slog"
	"strings"
	"time"
)

// AcceptOperationResult validates the projection envelope without deciding Agent behavior.
func (s *RuntimeResultBoundary) AcceptOperationResult(run execution.DurableRun, request OperationRequest, response executionapplication.AgentRuntimeResult) (executioncontract.OperationOutput, error) {
	if response.Operation != string(request.Operation) {
		return executioncontract.OperationOutput{}, errors.New("runtime operation identity mismatch")
	}
	if err := execution.ValidateAgentRuntimeToolContract(request.AdmissionSnapshot.ToolContractFingerprint, response.ToolContractFingerprint); err != nil {
		return executioncontract.OperationOutput{}, err
	}
	output, err := WorkflowOperationOutputFromRuntimeResponse(response, request.Operation, activityprojection.WorkflowOperationResultRef(run.RequestID, request.StepID))
	if err != nil {
		return output, err
	}
	output.RequestID = run.RequestID
	if output.Status != "completed" && output.Status != "failed" {
		return output, errors.New("runtime operation is not terminal")
	}
	if output.Status == "failed" && (output.Failure == nil || strings.TrimSpace(output.Failure.Code) == "") {
		return output, errors.New("failed runtime result has no classified failure")
	}
	if err := ValidateOperationOutputFields(output); err != nil {
		return output, err
	}
	return output, nil
}

func (s *RunProjectionService) ProjectBufferedSolveAnswer(ctx context.Context, run execution.DurableRun, request OperationRequest, output *executioncontract.OperationOutput) error {
	// Buffered solve publishes the validated full answer through the temporary transport.
	if !request.Stream &&
		request.Operation == executioncontract.WorkflowOperationSolve &&
		output.Status == "completed" &&
		output.SolveOutcome == "answer" &&
		strings.TrimSpace(output.FinalOutput) != "" {
		messageID := run.RequestID + ":answer"
		if err := s.ProjectWorkflowAnswerStarted(ctx, run, messageID); err != nil {
			return err
		}
		run.Status = execution.DurableRunStatusStreaming
		publishCtx, cancel := context.WithTimeout(ctx, time.Second)
		defer cancel()
		runes := []rune(output.FinalOutput)
		for offset, index := 0, 1; offset < len(runes); offset, index = offset+answerstream.MaxChunkRunes, index+1 {
			end := min(offset+answerstream.MaxChunkRunes, len(runes))
			if err := s.ProjectWorkflowAnswerDelta(publishCtx, run, messageID, index, string(runes[offset:end])); err != nil {
				if ctx.Err() != nil {
					return ctx.Err()
				}
				if !errors.Is(err, answerstream.ErrUnavailable) {
					return err
				}
				slog.Warn("temporary answer publishing stopped", "request_id", run.RequestID)
				break
			}
		}
		if err := s.ProjectWorkflowAnswerCompleted(ctx, run, messageID); err != nil {
			return err
		}
		output.AnswerStarted = true
	}
	return nil
}

func (s *RunProjectionService) ProjectOperationCompletion(ctx context.Context, run execution.DurableRun, request OperationRequest, response executionapplication.AgentRuntimeResult, output executioncontract.OperationOutput, startedProjection activityprojection.StepProjection, completedAt time.Time) error {
	startedAt := startedProjection.StartedAt
	resultRef := activityprojection.WorkflowOperationResultRef(run.RequestID, request.StepID)
	resultPayload, err := WorkflowOperationResultPayload(request, output, startedProjection.Attempt, s.DeploymentRelease)
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
