package httpapi

import (
	"context"
	"errors"
	"strings"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/execution"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/memoryruntime"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/ragruntime"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/temporalruntime"
)

func memoryRecallRequestForRun(
	run execution.DurableRun,
	requestedCapability string,
) (memoryruntime.RecallRequest, error) {
	payload, ok := run.Metadata["execution_payload"].(map[string]any)
	if !ok {
		return memoryruntime.RecallRequest{}, errors.New("run metadata.execution_payload must be an object")
	}
	userGoal := strings.TrimSpace(optionalStringFromAny(payload["user_goal"]))
	if userGoal == "" {
		return memoryruntime.RecallRequest{}, errors.New("memory recall user_goal is required")
	}
	capability := strings.TrimSpace(requestedCapability)
	if capability == "" {
		capability = firstNonEmptyText(payload["requested_capability"], run.RequestedCapability, "knowledge")
	}
	userID := firstNonEmptyText(
		nestedAny(payload, "actor", "user_id"),
		nestedAny(payload, "context", "actor", "user_id"),
		run.OwnerUserID,
	)
	request := memoryruntime.RecallRequest{
		RequestedCapability: capability,
		RunID:               run.RunID,
		SessionSlots:        memorySessionSlotsFromPayload(payload),
		TenantID:            firstNonEmptyText(payload["tenant_id"], nestedAny(payload, "context", "tenant_id")),
		UserGoal:            userGoal,
		UserID:              userID,
	}
	if err := memoryruntime.ValidateRecallRequest(request); err != nil {
		return memoryruntime.RecallRequest{}, err
	}
	return request, nil
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
	_, err := s.failTemporalRunStep(ctx, run, temporalStepFailureProjection{
		FailureKind:   failureKind,
		ProjectionRef: temporalProjectionRef(run.RunID, "memory/recall"),
		ResultKind:    "activity_failure",
		StepID:        "memory.recall",
		StepKind:      "memory",
		TaskQueue:     temporalruntime.ActivityTaskQueueContext,
		Payload: map[string]any{
			"failure_kind": failureKind,
			"message":      cause.Error(),
		},
	}, cause)
	return temporalruntime.MemoryRecallActivityOutput{}, err
}

func memoryContextForRAG(run execution.DurableRun) ([]ragruntime.MemoryContextItem, string) {
	result, ok := temporalMemoryRecallResultFromRun(run)
	if !ok {
		return nil, ""
	}
	items := make([]ragruntime.MemoryContextItem, 0, len(result.Items))
	for _, item := range result.Items {
		items = append(items, ragruntime.MemoryContextItem{
			Capability:  item.Capability,
			CompactText: item.CompactText,
			MemoryID:    item.MemoryID,
			MemoryType:  item.MemoryType,
			Score:       item.Score,
			UpdatedAt:   item.UpdatedAt,
		})
	}
	return items, result.MemoryRef
}
