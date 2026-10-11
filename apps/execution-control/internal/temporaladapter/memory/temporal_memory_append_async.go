package memory

import (
	"context"
	"errors"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/temporalruntime"
	"github.com/MUC-WIKI/campus-agent/apps/memory-service/memoryapplication"
	"go.temporal.io/sdk/activity"
	"go.temporal.io/sdk/temporal"
)

func (s *Adapter) AdvanceMemoryAppendActivity(ctx context.Context, input temporalruntime.MemoryAppendWorkflowInput) (temporalruntime.AdvanceMemoryAppendActivityOutput, error) {
	if activity.IsActivity(ctx) && activity.GetInfo(ctx).WorkflowExecution.ID != "memory.append/"+input.RequestID {
		return temporalruntime.AdvanceMemoryAppendActivityOutput{}, temporal.NewNonRetryableApplicationError("memory append workflow identity mismatch", "memory_append_identity_invalid", nil)
	}
	source, journal, err := s.AnswerAppend.PrepareAppend(ctx, input.RequestID)
	if err != nil {
		return temporalruntime.AdvanceMemoryAppendActivityOutput{}, err
	}
	if s.AppendClient != nil {
		status := "completed"
		if source.SkipReason != "" {
			status = "skipped"
		} else if source.RequestError != nil {
			return temporalruntime.AdvanceMemoryAppendActivityOutput{}, source.RequestError
		} else if err := s.AppendClient.Append(ctx, source.Request); err != nil {
			return temporalruntime.AdvanceMemoryAppendActivityOutput{}, err
		}
		result := memoryapplication.AppendResult{RequestID: input.RequestID, Status: status, SchemaVersion: "memory_append_delivery.v1"}
		now := time.Now().UTC()
		if err := journal.Save(ctx, memoryapplication.AppendProgress{Result: result, StartedAt: now, CompletedAt: now, UpdatedAt: now}); err != nil {
			return temporalruntime.AdvanceMemoryAppendActivityOutput{}, err
		}
		return appendOutput(result), nil
	}
	result, err := s.AdvanceAppend(ctx, source, journal, input.Submitted, input.StartedAt)
	// Append application errors carry the same fixed, non-provider messages as
	// the original Activity; command errors use their separate sanitized mapping.
	var failure *memoryapplication.Error
	if errors.As(err, &failure) {
		return appendOutput(result), temporal.NewApplicationError(failure.Cause.Error(), failure.Code)
	}
	return appendOutput(result), err
}
func appendOutput(result memoryapplication.AppendResult) temporalruntime.AdvanceMemoryAppendActivityOutput {
	return temporalruntime.AdvanceMemoryAppendActivityOutput{
		RequestID: result.RequestID, ThreadID: result.ThreadID, SchemaVersion: result.SchemaVersion,
		Status: result.Status, SkipReasons: result.SkipReasons, SkippedCount: result.SkippedCount, AppendedMessageCount: result.AppendedMessageCount,
	}
}
