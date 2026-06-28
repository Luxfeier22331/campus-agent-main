package httpapi

import (
	"context"
	"errors"
	"strings"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/execution"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/memoryruntime"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/ragruntime"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/temporalruntime"
	"go.temporal.io/sdk/temporal"
)

func memoryRecallRequestForRun(
	run execution.DurableRun,
	requestedTool string,
) (memoryruntime.RecallRequest, error) {
	payload, ok := run.Metadata["execution_payload"].(map[string]any)
	if !ok {
		return memoryruntime.RecallRequest{}, errors.New("run metadata.execution_payload must be an object")
	}
	userGoal := strings.TrimSpace(optionalStringFromAny(payload["user_goal"]))
	if userGoal == "" {
		return memoryruntime.RecallRequest{}, errors.New("memory recall user_goal is required")
	}
	tool := strings.TrimSpace(requestedTool)
	if tool == "" {
		tool = firstNonEmptyText(payload["requested_tool"], run.RequestedTool)
	}
	if tool == "" {
		tool = "any"
	}
	userID := firstNonEmptyText(
		nestedAny(payload, "actor", "user_id"),
		nestedAny(payload, "context", "actor", "user_id"),
		run.OwnerUserID,
	)
	request := memoryruntime.RecallRequest{
		RequestedTool: tool,
		RunID:         run.RunID,
		SessionSlots:  memorySessionSlotsFromPayload(payload),
		TenantID:      firstNonEmptyText(payload["tenant_id"], nestedAny(payload, "context", "tenant_id")),
		ThreadID:      run.ConversationID,
		UserGoal:      userGoal,
		UserID:        userID,
	}
	if err := memoryruntime.ValidateRecallRequest(request); err != nil {
		return memoryruntime.RecallRequest{}, err
	}
	return request, nil
}

func memoryRecallToolForRun(run execution.DurableRun, requestedTool string) string {
	payload, _ := run.Metadata["execution_payload"].(map[string]any)
	tool := strings.TrimSpace(requestedTool)
	if tool == "" {
		tool = firstNonEmptyText(payload["requested_tool"], run.RequestedTool)
	}
	if tool == "" {
		tool = "any"
	}
	return tool
}

func memorySessionSlotsFromPayload(payload map[string]any) map[string]string {
	rawSlots := nestedAny(payload, "context", "session", "confirmed_slots")
	items, ok := rawSlots.([]any)
	if !ok || len(items) == 0 {
		return nil
	}
	result := map[string]string{}
	for _, raw := range items {
		record, ok := raw.(map[string]any)
		if !ok {
			continue
		}
		name := strings.TrimSpace(optionalStringFromAny(record["name"]))
		value := strings.TrimSpace(optionalStringFromAny(record["value"]))
		if name != "" && value != "" {
			result[name] = value
		}
	}
	if len(result) == 0 {
		return nil
	}
	return result
}

func (s *Server) recallPersonalMemory(
	ctx context.Context,
	request memoryruntime.RecallRequest,
) (memoryruntime.RecallResult, error) {
	if s.personalMemoryErr != nil {
		return memoryruntime.RecallResult{}, s.personalMemoryErr
	}
	if s.personalMemoryExecutor == nil {
		return memoryruntime.RecallResult{}, errors.New("personal memory executor is not configured")
	}
	return s.personalMemoryExecutor.Recall(ctx, request)
}

func (s *Server) replaceTemporalMemoryMetadata(
	ctx context.Context,
	run execution.DurableRun,
	mutate func(map[string]any),
) error {
	latest, err := s.runProjectionStore.GetRun(ctx, run.RunID)
	if err != nil {
		return err
	}
	metadata := cloneTemporalMetadata(latest.Metadata)
	memoryMetadata := cloneAnyMapFromMetadata(metadata["temporal_memory"])
	mutate(memoryMetadata)
	metadata["temporal_memory"] = memoryMetadata
	return s.runProjectionStore.ReplaceRunMetadata(ctx, latest.RunID, metadata)
}

func temporalMemoryRecallResultFromRun(
	run execution.DurableRun,
) (memoryruntime.RecallResult, bool) {
	raw, ok := run.Metadata["temporal_memory"].(map[string]any)
	if !ok {
		return memoryruntime.RecallResult{}, false
	}
	result, err := decodeRAGProjection[memoryruntime.RecallResult](raw["recall_result"])
	if err != nil {
		return memoryruntime.RecallResult{}, false
	}
	if result.RunID != run.RunID {
		return memoryruntime.RecallResult{}, false
	}
	return result, true
}

func (s *Server) failMemoryRecallActivity(
	ctx context.Context,
	run execution.DurableRun,
	failureKind string,
	cause error,
) (temporalruntime.MemoryRecallActivityOutput, error) {
	if memoryFailureKindIsNonRetryable(failureKind) {
		_, err := s.failTemporalRunStep(ctx, run, temporalStepFailureProjection{
			Tool:          "memory",
			FailureKind:   failureKind,
			ProjectionRef: temporalProjectionRef(run.RunID, "memory/recall"),
			ResultKind:    "activity_failure",
			StepID:        "memory.recall",
			StepKind:      "memory",
			TaskQueue:     temporalruntime.ActivityTaskQueueCore,
			Payload: map[string]any{
				"failure_kind": failureKind,
				"message":      cause.Error(),
			},
		}, cause)
		return temporalruntime.MemoryRecallActivityOutput{}, temporal.NewNonRetryableApplicationError(
			cause.Error(),
			failureKind,
			err,
		)
	}
	now := time.Now().UTC()
	if err := s.projectTemporalStep(ctx, temporalStepProjection{
		Attempt:       1,
		Tool:          "memory",
		Run:           run,
		Status:        "failed",
		StepID:        "memory.recall",
		StepKind:      "memory",
		TaskQueue:     temporalruntime.ActivityTaskQueueCore,
		WorkerID:      s.config.TemporalWorkerIdentity,
		StartedAt:     now,
		CompletedAt:   now,
		UpdatedAt:     now,
		ResultKind:    "activity_failure",
		ProjectionRef: temporalProjectionRef(run.RunID, "memory/recall"),
		Payload: map[string]any{
			"failure_kind": failureKind,
			"message":      cause.Error(),
		},
	}); err != nil {
		return temporalruntime.MemoryRecallActivityOutput{}, err
	}
	return temporalruntime.MemoryRecallActivityOutput{}, cause
}

func memoryFailureKindIsNonRetryable(failureKind string) bool {
	switch strings.TrimSpace(failureKind) {
	case "memory_append_request_invalid",
		"memory_projection_invalid",
		"memory_recall_request_invalid",
		"personal_memory_not_configured":
		return true
	default:
		return false
	}
}

func memoryContextForRAG(run execution.DurableRun) ([]ragruntime.MemoryContextItem, string) {
	result, ok := temporalMemoryRecallResultFromRun(run)
	if !ok {
		return nil, ""
	}
	items := make([]ragruntime.MemoryContextItem, 0, len(result.Items))
	for _, item := range result.Items {
		items = append(items, ragruntime.MemoryContextItem{
			Tool:        item.Tool,
			CompactText: item.CompactText,
			MemoryID:    item.MemoryID,
			MemoryType:  item.MemoryType,
			Score:       item.Score,
			UpdatedAt:   item.UpdatedAt,
		})
	}
	return items, result.MemoryRef
}
