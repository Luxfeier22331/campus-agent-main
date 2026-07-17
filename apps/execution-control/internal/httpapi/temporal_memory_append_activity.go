package httpapi

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/execution"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/memoryruntime"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/temporalruntime"
)

func (s *Server) AppendConversationMemoryActivity(
	ctx context.Context,
	input temporalruntime.AppendConversationMemoryActivityInput,
) (temporalruntime.AppendConversationMemoryActivityOutput, error) {
	stopHeartbeat := startTemporalActivityHeartbeat(ctx, "memory.append", 10*time.Second)
	defer stopHeartbeat()
	recordTemporalActivityHeartbeat(ctx, "memory.append.started")
	run, err := s.temporalActivityRunAllowTerminal(ctx, input.RunID, input.TraceID)
	if err != nil {
		return temporalruntime.AppendConversationMemoryActivityOutput{}, err
	}
	startedAt := time.Now().UTC()
	payload, _ := run.Metadata["execution_payload"].(map[string]any)
	enabled, known := memoryEnabledFromExecutionPayload(payload)
	if !known {
		output, err := s.projectMemoryAppendResult(ctx, run, skippedMemoryAppendOutput(run.RunID, "memory_enabled_unknown"))
		if err == nil {
			s.recordPersonalMemoryOperation("append", "skipped", "memory_enabled_unknown", startedAt, 0, 0)
		}
		return output, err
	}
	if !enabled {
		output, err := s.projectMemoryAppendResult(ctx, run, skippedMemoryAppendOutput(run.RunID, "memory_disabled"))
		if err == nil {
			s.recordPersonalMemoryOperation("append", "skipped", "memory_disabled", startedAt, 0, 0)
		}
		return output, err
	}
	if s.personalMemoryErr != nil {
		output, err := s.projectMemoryAppendFailure(ctx, run, "personal_memory_not_configured", s.personalMemoryErr)
		if output.Status == "failed" {
			s.recordPersonalMemoryOperation("append", "failed", "personal_memory_not_configured", startedAt, 0, 0)
		}
		return output, err
	}
	if s.personalMemoryExecutor == nil {
		output, err := s.projectMemoryAppendFailure(
			ctx,
			run,
			"personal_memory_not_configured",
			errors.New("personal memory executor is not configured"),
		)
		if output.Status == "failed" {
			s.recordPersonalMemoryOperation("append", "failed", "personal_memory_not_configured", startedAt, 0, 0)
		}
		return output, err
	}
	request, err := memoryAppendRequestForRun(run, payload)
	if err != nil {
		output, projectErr := s.projectMemoryAppendFailure(ctx, run, "memory_append_request_invalid", err)
		if output.Status == "failed" {
			s.recordPersonalMemoryOperation("append", "failed", "memory_append_request_invalid", startedAt, 0, 0)
		}
		return output, projectErr
	}
	recordTemporalActivityHeartbeat(ctx, "memory.append.request_ready")
	recordTemporalActivityHeartbeat(ctx, "memory.append.call_hindsight")
	stopProviderHeartbeat := startPersonalMemoryHeartbeat(ctx, "memory.append.call_hindsight")
	result, err := s.personalMemoryExecutor.AppendConversationTurn(ctx, request)
	stopProviderHeartbeat()
	if err != nil {
		output, projectErr := s.projectMemoryAppendFailure(ctx, run, "hindsight_append_failed", err)
		if output.Status == "failed" {
			s.recordPersonalMemoryOperation("append", "failed", "hindsight_append_failed", startedAt, 0, 0)
		}
		return output, projectErr
	}
	recordTemporalActivityHeartbeat(ctx, "memory.append.project_result")
	output, err := s.projectMemoryAppendResult(ctx, run, temporalruntime.AppendConversationMemoryActivityOutput{
		AppendedMessageCount: result.AppendedMessageCount,
		PayloadSHA256:        result.PayloadSHA256,
		RunID:                run.RunID,
		SchemaVersion:        result.SchemaVersion,
		Status:               result.Status,
		ThreadID:             result.ThreadID,
	})
	if err == nil {
		s.recordPersonalMemoryOperation("append", output.Status, "none", startedAt, output.AppendedMessageCount, 0)
	}
	recordTemporalActivityHeartbeat(ctx, "memory.append.completed")
	return output, err
}

func (s *Server) projectMemoryAppendFailure(
	ctx context.Context,
	run execution.DurableRun,
	failureKind string,
	cause error,
) (temporalruntime.AppendConversationMemoryActivityOutput, error) {
	summary := summarizeTemporalFailure(failureKind, "", cause)
	output := temporalruntime.AppendConversationMemoryActivityOutput{
		RunID:         run.RunID,
		SchemaVersion: "memory_conversation_append_result_v2",
		SkipReasons:   []string{failureKind},
		Status:        "failed",
	}
	now := time.Now().UTC()
	payload := map[string]any{
		"appended_message_count": output.AppendedMessageCount,
		"failure_kind":           summary.Kind,
		"failure_hash":           summary.Hash,
		"message":                summary.Message,
		"payload_sha256":         output.PayloadSHA256,
		"schema_version":         output.SchemaVersion,
		"skip_reasons":           output.SkipReasons,
		"skipped_count":          output.SkippedCount,
		"status":                 output.Status,
		"thread_id":              output.ThreadID,
	}
	if err := s.projectTemporalStep(ctx, temporalStepProjection{
		Attempt:       temporalActivityAttempt(ctx),
		Tool:          "memory",
		Run:           run,
		Status:        "failed",
		StepID:        "memory.append",
		StepKind:      "memory",
		TaskQueue:     temporalruntime.ActivityTaskQueueCore,
		WorkerID:      s.config.TemporalWorkerIdentity,
		StartedAt:     now,
		CompletedAt:   now,
		UpdatedAt:     now,
		ResultKind:    "memory_conversation_append_result",
		ProjectionRef: temporalProjectionRef(run.RunID, "memory/append"),
		Payload:       payload,
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
	userMessage := strings.TrimSpace(optionalStringFromAny(payload["user_goal"]))
	if userMessage == "" {
		return memoryruntime.AppendConversationTurnRequest{}, fmt.Errorf("memory append user_goal is required")
	}
	userMessageCreatedAt := strings.TrimSpace(optionalStringFromAny(
		nestedAny(payload, "context", "conversation", "current_user_message", "created_at"),
	))
	userMessageID := strings.TrimSpace(optionalStringFromAny(
		nestedAny(payload, "context", "conversation", "user_message_id"),
	))
	userID := firstNonEmptyText(
		nestedAny(payload, "actor", "user_id"),
		nestedAny(payload, "context", "actor", "user_id"),
		run.OwnerUserID,
	)
	tenantID := firstNonEmptyText(payload["tenant_id"], nestedAny(payload, "context", "tenant_id"))
	ownerGeneration, ownerSequence, err := memoryOwnerFenceFromPayload(payload)
	if err != nil {
		return memoryruntime.AppendConversationTurnRequest{}, err
	}
	request := memoryruntime.AppendConversationTurnRequest{
		OwnerGeneration:      ownerGeneration,
		OwnerSequence:        ownerSequence,
		RunID:                run.RunID,
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
	value := nestedAny(payload, "context", "memory", "append_enabled")
	enabled, ok := value.(bool)
	return enabled, ok
}

func memoryRecallEnabledFromExecutionPayload(payload map[string]any) (bool, bool) {
	value := nestedAny(payload, "context", "memory", "recall_enabled")
	enabled, ok := value.(bool)
	return enabled, ok
}

func skippedMemoryAppendOutput(
	runID string,
	reason string,
) temporalruntime.AppendConversationMemoryActivityOutput {
	return temporalruntime.AppendConversationMemoryActivityOutput{
		RunID:         strings.TrimSpace(runID),
		SchemaVersion: "memory_conversation_append_result_v2",
		SkipReasons:   []string{reason},
		SkippedCount:  1,
		Status:        "skipped",
	}
}

func (s *Server) projectMemoryAppendResult(
	ctx context.Context,
	run execution.DurableRun,
	output temporalruntime.AppendConversationMemoryActivityOutput,
) (temporalruntime.AppendConversationMemoryActivityOutput, error) {
	now := time.Now().UTC()
	if strings.TrimSpace(output.SchemaVersion) == "" {
		output.SchemaVersion = "memory_conversation_append_result_v2"
	}
	if strings.TrimSpace(output.Status) == "" {
		output.Status = "completed"
	}
	payload := map[string]any{
		"appended_message_count": output.AppendedMessageCount,
		"payload_sha256":         output.PayloadSHA256,
		"schema_version":         output.SchemaVersion,
		"skip_reasons":           output.SkipReasons,
		"skipped_count":          output.SkippedCount,
		"status":                 output.Status,
		"thread_id":              output.ThreadID,
	}
	err := s.projectTemporalStep(ctx, temporalStepProjection{
		Attempt:       temporalActivityAttempt(ctx),
		Tool:          "memory",
		Run:           run,
		Status:        output.Status,
		StepID:        "memory.append",
		StepKind:      "memory",
		TaskQueue:     temporalruntime.ActivityTaskQueueCore,
		WorkerID:      s.config.TemporalWorkerIdentity,
		StartedAt:     now,
		CompletedAt:   now,
		UpdatedAt:     now,
		ResultKind:    "memory_conversation_append_result",
		ProjectionRef: temporalProjectionRef(run.RunID, "memory/append"),
		Payload:       payload,
	})
	if err != nil {
		return temporalruntime.AppendConversationMemoryActivityOutput{}, err
	}
	return output, nil
}

func (s *Server) temporalActivityRunAllowTerminal(
	ctx context.Context,
	runID string,
	traceID string,
) (execution.DurableRun, error) {
	if s == nil || s.runProjectionStore == nil {
		return execution.DurableRun{}, execution.ErrRunProjectionStoreNotConfigured
	}
	run, err := s.runProjectionStore.GetRun(ctx, strings.TrimSpace(runID))
	if err != nil {
		return execution.DurableRun{}, err
	}
	if run.TraceID != traceID {
		return execution.DurableRun{}, fmt.Errorf(
			"activity trace_id %s does not match run trace_id %s",
			traceID,
			run.TraceID,
		)
	}
	return run, nil
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

func memoryFailureHash(cause error) string {
	if cause == nil {
		return ""
	}
	sum := sha256.Sum256([]byte(cause.Error()))
	return hex.EncodeToString(sum[:])
}
