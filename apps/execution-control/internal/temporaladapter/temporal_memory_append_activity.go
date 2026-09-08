package temporaladapter

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/execution"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/memoryruntime"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/temporalruntime"
)

func (s *Adapter) AppendConversationMemory(
	ctx context.Context,
	input temporalruntime.AppendConversationMemoryActivityInput,
) (temporalruntime.AppendConversationMemoryActivityOutput, error) {
	activityStartedAt := time.Now().UTC().Truncate(time.Microsecond)
	stopHeartbeat := startTemporalActivityHeartbeat(ctx, "memory.append", 10*time.Second)
	defer stopHeartbeat()
	recordTemporalActivityHeartbeat(ctx, "memory.append.started")
	run, err := s.temporalCompletedFinalizationRun(ctx, input.RequestID)
	if err != nil {
		return temporalruntime.AppendConversationMemoryActivityOutput{}, err
	}
	payload, err := s.loadExecutionPayload(ctx, run)
	if err != nil {
		failureKind := execution.InputFailureKind(err, "memory_append_request_invalid")
		return s.projectMemoryAppendFailure(ctx, run, failureKind, err, activityStartedAt, time.Now())
	}
	enabled, known := memoryEnabledFromExecutionPayload(payload)
	if !known {
		return s.projectMemoryAppendResult(
			ctx,
			run,
			skippedMemoryAppendOutput(run.RequestID, "memory_enabled_unknown"),
			activityStartedAt,
			time.Now(),
		)
	}
	if !enabled {
		return s.projectMemoryAppendResult(
			ctx,
			run,
			skippedMemoryAppendOutput(run.RequestID, "memory_disabled"),
			activityStartedAt,
			time.Now(),
		)
	}
	if s.personalMemoryErr != nil {
		return s.projectMemoryAppendResult(
			ctx,
			run,
			skippedMemoryAppendOutput(run.RequestID, "personal_memory_not_configured"),
			activityStartedAt,
			time.Now(),
		)
	}
	if s.personalMemoryExecutor == nil {
		return s.projectMemoryAppendResult(
			ctx,
			run,
			skippedMemoryAppendOutput(run.RequestID, "personal_memory_not_configured"),
			activityStartedAt,
			time.Now(),
		)
	}
	request, err := memoryAppendRequestForRun(run, payload)
	if err != nil {
		return s.projectMemoryAppendFailure(
			ctx,
			run,
			"memory_append_request_invalid",
			err,
			activityStartedAt,
			time.Now(),
		)
	}
	recordTemporalActivityHeartbeat(ctx, "memory.append.request_ready")
	recordTemporalActivityHeartbeat(ctx, "memory.append.call_hindsight")
	stopProviderHeartbeat := startPersonalMemoryHeartbeat(ctx, "memory.append.call_hindsight")
	providerStartedAt := time.Now().UTC().Truncate(time.Microsecond)
	result, err := s.personalMemoryExecutor.AppendConversationTurn(ctx, request)
	providerCompletedAt := time.Now().UTC().Truncate(time.Microsecond)
	stopProviderHeartbeat()
	if err != nil {
		return s.projectMemoryAppendFailure(
			ctx,
			run,
			"hindsight_append_failed",
			err,
			providerStartedAt,
			providerCompletedAt,
		)
	}
	recordTemporalActivityHeartbeat(ctx, "memory.append.project_result")
	output, err := s.projectMemoryAppendResult(ctx, run, temporalruntime.AppendConversationMemoryActivityOutput{
		AppendedMessageCount: result.AppendedMessageCount,
		RequestID:            run.RequestID,
		SchemaVersion:        "memory_conversation_append_result_v3",
		Status:               "completed",
		ThreadID:             run.ConversationID,
	}, providerStartedAt, providerCompletedAt)
	recordTemporalActivityHeartbeat(ctx, "memory.append.completed")
	return output, err
}

func (s *Adapter) projectMemoryAppendFailure(
	ctx context.Context,
	run execution.DurableRun,
	failureKind string,
	cause error,
	startedAt time.Time,
	completedAt time.Time,
) (temporalruntime.AppendConversationMemoryActivityOutput, error) {
	summary := summarizeTemporalFailure(failureKind)
	output := temporalruntime.AppendConversationMemoryActivityOutput{
		RequestID:     run.RequestID,
		SchemaVersion: "memory_conversation_append_result_v3",
		SkipReasons:   []string{failureKind},
		Status:        "failed",
	}
	startedAt = canonicalMemoryAppendTime(startedAt)
	completedAt = canonicalMemoryAppendTime(completedAt)
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
	if err := s.projectTemporalStep(ctx, temporalStepProjection{
		Attempt:            temporalActivityAttempt(ctx),
		Tool:               "memory",
		Run:                run,
		Status:             "failed",
		StepID:             "memory.append",
		StepKind:           "memory",
		TaskQueue:          temporalruntime.ActivityTaskQueueCore,
		WorkerID:           s.config.TemporalWorkerIdentity,
		StartedAt:          startedAt,
		CompletedAt:        completedAt,
		AttemptStartedAt:   startedAt,
		AttemptCompletedAt: completedAt,
		UpdatedAt:          updatedAt,
		AttemptUpdatedAt:   updatedAt,
		ResultKind:         "memory_conversation_append_result",
		ProjectionRef:      temporalProjectionRef(run.RequestID, "memory/append"),
		Payload:            payload,
	}); err != nil {
		return temporalruntime.AppendConversationMemoryActivityOutput{}, sanitizedTemporalApplicationError(
			"activity_projection_failed",
			err,
			false,
		)
	}
	return output, temporalApplicationError(summary, memoryFailureKindIsNonRetryable(summary.Kind))
}

func memoryAppendRequestForRun(
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
	ownerGeneration, ownerSequence, err := memoryOwnerFenceFromPayload(payload)
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

func memoryEnabledFromExecutionPayload(payload map[string]any) (bool, bool) {
	value := execution.NestedAny(payload, "context", "memory", "append_enabled")
	enabled, ok := value.(bool)
	return enabled, ok
}

func skippedMemoryAppendOutput(
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

func (s *Adapter) projectMemoryAppendResult(
	ctx context.Context,
	run execution.DurableRun,
	output temporalruntime.AppendConversationMemoryActivityOutput,
	startedAt time.Time,
	completedAt time.Time,
) (temporalruntime.AppendConversationMemoryActivityOutput, error) {
	startedAt = canonicalMemoryAppendTime(startedAt)
	completedAt = canonicalMemoryAppendTime(completedAt)
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
	err := s.projectTemporalStep(ctx, temporalStepProjection{
		Attempt:            temporalActivityAttempt(ctx),
		Tool:               "memory",
		Run:                run,
		Status:             output.Status,
		StepID:             "memory.append",
		StepKind:           "memory",
		TaskQueue:          temporalruntime.ActivityTaskQueueCore,
		WorkerID:           s.config.TemporalWorkerIdentity,
		StartedAt:          startedAt,
		CompletedAt:        completedAt,
		AttemptStartedAt:   startedAt,
		AttemptCompletedAt: completedAt,
		UpdatedAt:          updatedAt,
		AttemptUpdatedAt:   updatedAt,
		ResultKind:         "memory_conversation_append_result",
		ProjectionRef:      temporalProjectionRef(run.RequestID, "memory/append"),
		Payload:            payload,
	})
	if err != nil {
		return temporalruntime.AppendConversationMemoryActivityOutput{}, err
	}
	return output, nil
}

func canonicalMemoryAppendTime(value time.Time) time.Time {
	if value.IsZero() {
		return time.Now().UTC().Truncate(time.Microsecond)
	}
	return value.UTC().Truncate(time.Microsecond)
}

func (s *Adapter) temporalCompletedFinalizationRun(
	ctx context.Context,
	requestID string,
) (execution.DurableRun, error) {
	if s == nil || s.runProjectionStore == nil {
		return execution.DurableRun{}, execution.ErrRunProjectionStoreNotConfigured
	}
	if err := s.ensureTemporalActivityOwnsRootExecution(ctx, requestID, false); err != nil {
		return execution.DurableRun{}, err
	}
	run, err := s.runProjectionStore.GetRun(ctx, strings.TrimSpace(requestID))
	if err != nil {
		return execution.DurableRun{}, err
	}
	if run.Status != execution.DurableRunStatusCompleted {
		if temporalRunTerminal(run.Status) {
			return execution.DurableRun{}, sanitizedTemporalApplicationError(
				"post_finalization_activity_terminal_conflict",
				fmt.Errorf("post-finalization activity is not allowed for run status %s", run.Status),
				true,
			)
		}
		return execution.DurableRun{}, errors.New("post-finalization activity cannot run before completed projection")
	}
	results, err := s.runProjectionStore.ListStepResults(ctx, run.RequestID)
	if err != nil {
		return execution.DurableRun{}, err
	}
	for _, result := range results {
		if result.StepID == "finalization.write" && result.Status == "completed" &&
			strings.TrimSpace(result.ProjectionRef) == strings.TrimSpace(run.FinalResponseRef) {
			return run, nil
		}
	}
	return execution.DurableRun{}, sanitizedTemporalApplicationError(
		"post_finalization_activity_identity_invalid",
		errors.New("completed run is not bound to a completed finalization projection"),
		true,
	)
}

func startPersonalMemoryHeartbeat(ctx context.Context, detail string) func() {
	stop := make(chan struct{})
	go func() {
		ticker := time.NewTicker(10 * time.Second)
		defer ticker.Stop()
		for {
			select {
			case <-ticker.C:
				recordTemporalActivityHeartbeat(ctx, detail)
			case <-stop:
				return
			case <-ctx.Done():
				return
			}
		}
	}()
	return func() { close(stop) }
}
