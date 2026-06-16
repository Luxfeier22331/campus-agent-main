package httpapi

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

func (s *Server) AppendConversationMemoryActivity(
	ctx context.Context,
	input temporalruntime.AppendConversationMemoryActivityInput,
) (temporalruntime.AppendConversationMemoryActivityOutput, error) {
	run, err := s.temporalActivityRunAllowTerminal(ctx, input.RunID, input.TraceID)
	if err != nil {
		return temporalruntime.AppendConversationMemoryActivityOutput{}, err
	}
	payload, _ := run.Metadata["execution_payload"].(map[string]any)
	enabled, known := memoryEnabledFromExecutionPayload(payload)
	if !known {
		return s.projectMemoryAppendResult(ctx, run, skippedMemoryAppendOutput(run.RunID, "memory_enabled_unknown"))
	}
	if !enabled {
		return s.projectMemoryAppendResult(ctx, run, skippedMemoryAppendOutput(run.RunID, "memory_disabled"))
	}
	if s.personalMemoryErr != nil {
		return temporalruntime.AppendConversationMemoryActivityOutput{}, s.personalMemoryErr
	}
	if s.personalMemoryExecutor == nil {
		return temporalruntime.AppendConversationMemoryActivityOutput{}, errors.New("personal memory executor is not configured")
	}
	request, err := memoryAppendRequestForRun(ctx, s.runProjectionStore, run, payload)
	if err != nil {
		return temporalruntime.AppendConversationMemoryActivityOutput{}, err
	}
	result, err := s.personalMemoryExecutor.AppendConversationTurn(ctx, request)
	if err != nil {
		return temporalruntime.AppendConversationMemoryActivityOutput{}, err
	}
	return s.projectMemoryAppendResult(ctx, run, temporalruntime.AppendConversationMemoryActivityOutput{
		AppendedMessageCount: result.AppendedMessageCount,
		PayloadSHA256:        result.PayloadSHA256,
		RunID:                run.RunID,
		SchemaVersion:        result.SchemaVersion,
		Status:               result.Status,
		ThreadID:             result.ThreadID,
	})
}

func memoryAppendRequestForRun(
	ctx context.Context,
	store execution.RunProjectionStore,
	run execution.DurableRun,
	payload map[string]any,
) (memoryruntime.AppendConversationTurnRequest, error) {
	if store == nil {
		return memoryruntime.AppendConversationTurnRequest{}, execution.ErrRunProjectionStoreNotConfigured
	}
	userMessage := strings.TrimSpace(optionalStringFromAny(payload["user_goal"]))
	if userMessage == "" {
		return memoryruntime.AppendConversationTurnRequest{}, fmt.Errorf("memory append user_goal is required")
	}
	assistantMessage, err := finalAnswerTextForRun(ctx, store, run)
	if err != nil {
		return memoryruntime.AppendConversationTurnRequest{}, err
	}
	userID := firstNonEmptyText(
		nestedAny(payload, "actor", "user_id"),
		nestedAny(payload, "context", "actor", "user_id"),
		run.OwnerUserID,
	)
	tenantID := firstNonEmptyText(payload["tenant_id"], nestedAny(payload, "context", "tenant_id"))
	request := memoryruntime.AppendConversationTurnRequest{
		AssistantMessage:        assistantMessage,
		IgnoreAssistantForGraph: true,
		RunID:                   run.RunID,
		TenantID:                tenantID,
		ThreadID:                run.ConversationID,
		UserID:                  userID,
		UserMessage:             userMessage,
	}
	if err := memoryruntime.ValidateAppendConversationTurnRequest(request); err != nil {
		return memoryruntime.AppendConversationTurnRequest{}, err
	}
	return request, nil
}

func finalAnswerTextForRun(
	ctx context.Context,
	store execution.RunProjectionStore,
	run execution.DurableRun,
) (string, error) {
	results, err := store.ListStepResults(ctx, run.RunID)
	if err != nil {
		return "", err
	}
	for _, result := range results {
		if result.StepID != "finalization.write" {
			continue
		}
		response, ok := result.SanitizedPayload["finalized_response"].(map[string]any)
		if !ok {
			continue
		}
		answer := strings.TrimSpace(optionalStringFromAny(response["answer_text"]))
		if answer != "" {
			return answer, nil
		}
	}
	return "", fmt.Errorf("finalization answer_text is required for memory append")
}

func memoryEnabledFromExecutionPayload(payload map[string]any) (bool, bool) {
	value := nestedAny(payload, "context", "memory", "enabled")
	enabled, ok := value.(bool)
	return enabled, ok
}

func skippedMemoryAppendOutput(
	runID string,
	reason string,
) temporalruntime.AppendConversationMemoryActivityOutput {
	return temporalruntime.AppendConversationMemoryActivityOutput{
		RunID:         strings.TrimSpace(runID),
		SchemaVersion: "memory_conversation_append_result_v1",
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
		output.SchemaVersion = "memory_conversation_append_result_v1"
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
		Attempt:       1,
		Capability:    "memory",
		Run:           run,
		Status:        output.Status,
		StepID:        "memory.append",
		StepKind:      "memory",
		TaskQueue:     temporalruntime.ActivityTaskQueueContext,
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
