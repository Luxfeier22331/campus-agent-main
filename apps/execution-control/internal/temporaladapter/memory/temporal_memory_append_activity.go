package memory

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/execution"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/memoryruntime"
	activityprojection "github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/temporaladapter/finalization/projection"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/temporalruntime"
)

func (s *Adapter) AppendConversationMemory(
	ctx context.Context,
	input temporalruntime.AppendConversationMemoryActivityInput,
) (temporalruntime.AppendConversationMemoryActivityOutput, error) {
	activityStartedAt := time.Now().UTC().Truncate(time.Microsecond)
	stopHeartbeat := activityprojection.StartTemporalActivityHeartbeat(ctx, "memory.append", 10*time.Second)
	defer stopHeartbeat()
	activityprojection.RecordTemporalActivityHeartbeat(ctx, "memory.append.started")
	run, err := s.TemporalCompletedFinalizationRun(ctx, input.RequestID)
	if err != nil {
		return temporalruntime.AppendConversationMemoryActivityOutput{}, err
	}
	payload, err := s.LoadExecutionPayload(ctx, run)
	if err != nil {
		failureKind := execution.InputFailureKind(err, "memory_append_request_invalid")
		return s.ProjectMemoryAppendFailure(ctx, run, failureKind, err, activityStartedAt, time.Now())
	}
	enabled, known := MemoryEnabledFromExecutionPayload(payload)
	if !known {
		return s.ProjectMemoryAppendResult(
			ctx,
			run,
			SkippedMemoryAppendOutput(run.RequestID, "memory_enabled_unknown"),
			activityStartedAt,
			time.Now(),
		)
	}
	if !enabled {
		return s.ProjectMemoryAppendResult(
			ctx,
			run,
			SkippedMemoryAppendOutput(run.RequestID, "memory_disabled"),
			activityStartedAt,
			time.Now(),
		)
	}
	if s.PersonalMemoryErr != nil {
		return s.ProjectMemoryAppendResult(
			ctx,
			run,
			SkippedMemoryAppendOutput(run.RequestID, "personal_memory_not_configured"),
			activityStartedAt,
			time.Now(),
		)
	}
	if s.PersonalMemoryExecutor == nil {
		return s.ProjectMemoryAppendResult(
			ctx,
			run,
			SkippedMemoryAppendOutput(run.RequestID, "personal_memory_not_configured"),
			activityStartedAt,
			time.Now(),
		)
	}
	request, err := MemoryAppendRequestForRun(run, payload)
	if err != nil {
		return s.ProjectMemoryAppendFailure(
			ctx,
			run,
			"memory_append_request_invalid",
			err,
			activityStartedAt,
			time.Now(),
		)
	}
	activityprojection.RecordTemporalActivityHeartbeat(ctx, "memory.append.request_ready")
	activityprojection.RecordTemporalActivityHeartbeat(ctx, "memory.append.call_hindsight")
	stopProviderHeartbeat := StartPersonalMemoryHeartbeat(ctx, "memory.append.call_hindsight")
	providerStartedAt := time.Now().UTC().Truncate(time.Microsecond)
	result, err := s.PersonalMemoryExecutor.AppendConversationTurn(ctx, request)
	providerCompletedAt := time.Now().UTC().Truncate(time.Microsecond)
	stopProviderHeartbeat()
	if err != nil {
		return s.ProjectMemoryAppendFailure(
			ctx,
			run,
			"hindsight_append_failed",
			err,
			providerStartedAt,
			providerCompletedAt,
		)
	}
	activityprojection.RecordTemporalActivityHeartbeat(ctx, "memory.append.project_result")
	output, err := s.ProjectMemoryAppendResult(ctx, run, temporalruntime.AppendConversationMemoryActivityOutput{
		AppendedMessageCount: result.AppendedMessageCount,
		RequestID:            run.RequestID,
		SchemaVersion:        "memory_conversation_append_result_v3",
		Status:               "completed",
		ThreadID:             run.ConversationID,
	}, providerStartedAt, providerCompletedAt)
	activityprojection.RecordTemporalActivityHeartbeat(ctx, "memory.append.completed")
	return output, err
}

func (s *Adapter) ProjectMemoryAppendFailure(
	ctx context.Context,
	run execution.DurableRun,
	failureKind string,
	cause error,
	startedAt time.Time,
	completedAt time.Time,
) (temporalruntime.AppendConversationMemoryActivityOutput, error) {
	summary := activityprojection.SummarizeTemporalFailure(failureKind)
	output := temporalruntime.AppendConversationMemoryActivityOutput{
		RequestID:     run.RequestID,
		SchemaVersion: "memory_conversation_append_result_v3",
		SkipReasons:   []string{failureKind},
		Status:        "failed",
	}
	startedAt = CanonicalMemoryAppendTime(startedAt)
	completedAt = CanonicalMemoryAppendTime(completedAt)
	updatedAt := time.Now().UTC().Truncate(time.Microsecond)
	payload := map[string]any{
		"appended_message_count": output.AppendedMessageCount,
		"failure": map[string]any{
			"code":      summary.Kind,
			"operation": "memory.append",
		},
		"message":        summary.Message,
		"schema_version": output.SchemaVersion,
		"skip_reasons":   output.SkipReasons,
		"skipped_count":  output.SkippedCount,
		"status":         output.Status,
		"thread_id":      output.ThreadID,
	}
	if err := s.ProjectTemporalStep(ctx, activityprojection.TemporalStepProjection{
		Attempt:            activityprojection.TemporalActivityAttempt(ctx),
		Tool:               "memory",
		Run:                run,
		Status:             "failed",
		StepID:             "memory.append",
		StepKind:           "memory",
		TaskQueue:          temporalruntime.ActivityTaskQueueCore,
		WorkerID:           s.Config.TemporalWorkerIdentity,
		StartedAt:          startedAt,
		CompletedAt:        completedAt,
		AttemptStartedAt:   startedAt,
		AttemptCompletedAt: completedAt,
		UpdatedAt:          updatedAt,
		AttemptUpdatedAt:   updatedAt,
		ResultKind:         "memory_conversation_append_result",
		ProjectionRef:      activityprojection.TemporalProjectionRef(run.RequestID, "memory/append"),
		Payload:            payload,
	}); err != nil {
		return temporalruntime.AppendConversationMemoryActivityOutput{}, activityprojection.SanitizedTemporalApplicationError(
			"activity_projection_failed",
			err,
			false,
		)
	}
	return output, activityprojection.TemporalApplicationError(summary, MemoryFailureKindIsNonRetryable(summary.Kind))
}

func MemoryAppendRequestForRun(
	run execution.DurableRun,
	payload map[string]any,
) (memoryruntime.AppendConversationTurnRequest, error) {
	userMessage := strings.TrimSpace(execution.OptionalStringFromAny(payload["user_goal"]))
	if userMessage == "" {
		return memoryruntime.AppendConversationTurnRequest{}, fmt.Errorf("memory append user_goal is required")
	}
	userMessageCreatedAt := strings.TrimSpace(execution.OptionalStringFromAny(
		execution.NestedAny(payload, "context", "conversation", "current_user_message", "created_at"),
	))
	userMessageID := strings.TrimSpace(execution.OptionalStringFromAny(
		execution.NestedAny(payload, "context", "conversation", "user_message_id"),
	))
	userID := execution.FirstNonEmptyText(
		execution.NestedAny(payload, "actor", "user_id"),
		execution.NestedAny(payload, "context", "actor", "user_id"),
		run.OwnerUserID,
	)
	tenantID := execution.FirstNonEmptyText(payload["tenant_id"], execution.NestedAny(payload, "context", "tenant_id"))
	ownerGeneration, ownerSequence, err := MemoryOwnerFenceFromPayload(payload)
	if err != nil {
		return memoryruntime.AppendConversationTurnRequest{}, err
	}
	request := memoryruntime.AppendConversationTurnRequest{
		OwnerGeneration:      ownerGeneration,
		OwnerSequence:        ownerSequence,
		RequestID:            run.RequestID,
		TenantID:             tenantID,
		ThreadID:             run.ConversationID,
		UserID:               userID,
		UserMessage:          userMessage,
		UserMessageCreatedAt: userMessageCreatedAt,
		UserMessageID:        userMessageID,
	}
	if err := memoryruntime.ValidateAppendConversationTurnRequest(request); err != nil {
		return memoryruntime.AppendConversationTurnRequest{}, err
	}
	return request, nil
}

func MemoryEnabledFromExecutionPayload(payload map[string]any) (bool, bool) {
	value := execution.NestedAny(payload, "context", "memory", "append_enabled")
	enabled, ok := value.(bool)
	return enabled, ok
}

func SkippedMemoryAppendOutput(
	requestID string,
	reason string,
) temporalruntime.AppendConversationMemoryActivityOutput {
	return temporalruntime.AppendConversationMemoryActivityOutput{
		RequestID:     strings.TrimSpace(requestID),
		SchemaVersion: "memory_conversation_append_result_v3",
		SkipReasons:   []string{reason},
		SkippedCount:  1,
		Status:        "skipped",
	}
}

func (s *Adapter) ProjectMemoryAppendResult(
	ctx context.Context,
	run execution.DurableRun,
	output temporalruntime.AppendConversationMemoryActivityOutput,
	startedAt time.Time,
	completedAt time.Time,
) (temporalruntime.AppendConversationMemoryActivityOutput, error) {
	startedAt = CanonicalMemoryAppendTime(startedAt)
	completedAt = CanonicalMemoryAppendTime(completedAt)
	updatedAt := time.Now().UTC().Truncate(time.Microsecond)
	if strings.TrimSpace(output.SchemaVersion) == "" {
		output.SchemaVersion = "memory_conversation_append_result_v3"
	}
	if strings.TrimSpace(output.Status) == "" {
		output.Status = "completed"
	}
	payload := map[string]any{
		"appended_message_count": output.AppendedMessageCount,
		"schema_version":         output.SchemaVersion,
		"skip_reasons":           output.SkipReasons,
		"skipped_count":          output.SkippedCount,
		"status":                 output.Status,
		"thread_id":              output.ThreadID,
	}
	err := s.ProjectTemporalStep(ctx, activityprojection.TemporalStepProjection{
		Attempt:            activityprojection.TemporalActivityAttempt(ctx),
		Tool:               "memory",
		Run:                run,
		Status:             output.Status,
		StepID:             "memory.append",
		StepKind:           "memory",
		TaskQueue:          temporalruntime.ActivityTaskQueueCore,
		WorkerID:           s.Config.TemporalWorkerIdentity,
		StartedAt:          startedAt,
		CompletedAt:        completedAt,
		AttemptStartedAt:   startedAt,
		AttemptCompletedAt: completedAt,
		UpdatedAt:          updatedAt,
		AttemptUpdatedAt:   updatedAt,
		ResultKind:         "memory_conversation_append_result",
		ProjectionRef:      activityprojection.TemporalProjectionRef(run.RequestID, "memory/append"),
		Payload:            payload,
	})
	if err != nil {
		return temporalruntime.AppendConversationMemoryActivityOutput{}, err
	}
	return output, nil
}

func CanonicalMemoryAppendTime(value time.Time) time.Time {
	if value.IsZero() {
		return time.Now().UTC().Truncate(time.Microsecond)
	}
	return value.UTC().Truncate(time.Microsecond)
}

func (s *Adapter) TemporalCompletedFinalizationRun(
	ctx context.Context,
	requestID string,
) (execution.DurableRun, error) {
	if s == nil || s.RunProjectionStore == nil {
		return execution.DurableRun{}, execution.ErrRunProjectionStoreNotConfigured
	}
	if err := s.EnsureTemporalActivityOwnsRootExecution(ctx, requestID, false); err != nil {
		return execution.DurableRun{}, err
	}
	run, err := s.RunProjectionStore.GetRun(ctx, strings.TrimSpace(requestID))
	if err != nil {
		return execution.DurableRun{}, err
	}
	if run.Status != execution.DurableRunStatusCompleted {
		if activityprojection.TemporalRunTerminal(run.Status) {
			return execution.DurableRun{}, activityprojection.SanitizedTemporalApplicationError(
				"post_finalization_activity_terminal_conflict",
				fmt.Errorf("post-finalization activity is not allowed for run status %s", run.Status),
				true,
			)
		}
		return execution.DurableRun{}, errors.New("post-finalization activity cannot run before completed projection")
	}
	results, err := s.RunProjectionStore.ListStepResults(ctx, run.RequestID)
	if err != nil {
		return execution.DurableRun{}, err
	}
	for _, result := range results {
		if result.StepID == "finalization.write" && result.Status == "completed" &&
			strings.TrimSpace(result.ProjectionRef) == strings.TrimSpace(run.FinalResponseRef) {
			return run, nil
		}
	}
	return execution.DurableRun{}, activityprojection.SanitizedTemporalApplicationError(
		"post_finalization_activity_identity_invalid",
		errors.New("completed run is not bound to a completed finalization projection"),
		true,
	)
}

func StartPersonalMemoryHeartbeat(ctx context.Context, detail string) func() {
	stop := make(chan struct{})
	go func() {
		ticker := time.NewTicker(10 * time.Second)
		defer ticker.Stop()
		for {
			select {
			case <-ticker.C:
				activityprojection.RecordTemporalActivityHeartbeat(ctx, detail)
			case <-stop:
				return
			case <-ctx.Done():
				return
			}
		}
	}()
	return func() { close(stop) }
}
