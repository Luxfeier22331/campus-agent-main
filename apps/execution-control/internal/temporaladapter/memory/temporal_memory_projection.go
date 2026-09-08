package memory

import (
	"context"
	"encoding/json"
	"errors"
	"strings"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/execution"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/memoryruntime"
)

func MemoryRecallRequestForRun(
	run execution.DurableRun,
	payload map[string]any,
) (memoryruntime.RecallRequest, error) {
	if payload == nil {
		return memoryruntime.RecallRequest{}, errors.New("execution input is required")
	}
	userGoal := strings.TrimSpace(execution.OptionalStringFromAny(payload["user_goal"]))
	if userGoal == "" {
		return memoryruntime.RecallRequest{}, errors.New("memory recall user_goal is required")
	}
	userID := execution.FirstNonEmptyText(
		execution.NestedAny(payload, "actor", "user_id"),
		execution.NestedAny(payload, "context", "actor", "user_id"),
		run.OwnerUserID,
	)
	ownerGeneration, ownerSequence, err := MemoryOwnerFenceFromPayload(payload)
	if err != nil {
		return memoryruntime.RecallRequest{}, err
	}
	queryTimestamp := strings.TrimSpace(execution.OptionalStringFromAny(
		execution.NestedAny(payload, "context", "conversation", "current_user_message", "created_at"),
	))
	request := memoryruntime.RecallRequest{
		OwnerGeneration: ownerGeneration,
		OwnerSequence:   ownerSequence,
		QueryTimestamp:  queryTimestamp,
		RequestID:       run.RequestID,
		SessionSlots:    MemorySessionSlotsFromPayload(payload),
		TenantID:        execution.FirstNonEmptyText(payload["tenant_id"], execution.NestedAny(payload, "context", "tenant_id")),
		ThreadID:        run.ConversationID,
		UserGoal:        userGoal,
		UserID:          userID,
	}
	if err := memoryruntime.ValidateRecallRequest(request); err != nil {
		return memoryruntime.RecallRequest{}, err
	}
	return request, nil
}

func MemoryOwnerFenceFromPayload(payload map[string]any) (int64, int64, error) {
	generation, ok := ExactInt64(execution.NestedAny(payload, "context", "memory", "owner_generation"))
	if !ok || generation < 1 {
		return 0, 0, errors.New("memory owner generation is required")
	}
	sequence, ok := ExactInt64(execution.NestedAny(payload, "context", "memory", "owner_sequence"))
	if !ok || sequence < 0 {
		return 0, 0, errors.New("memory owner sequence is required")
	}
	return generation, sequence, nil
}

func ExactInt64(value any) (int64, bool) {
	switch typed := value.(type) {
	case int:
		return int64(typed), true
	case int64:
		return typed, true
	case float64:
		converted := int64(typed)
		return converted, typed == float64(converted)
	case json.Number:
		converted, err := typed.Int64()
		return converted, err == nil
	default:
		return 0, false
	}
}

func MemorySessionSlotsFromPayload(payload map[string]any) map[string]string {
	rawSlots := execution.NestedAny(payload, "context", "session", "confirmed_slots")
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
		name := strings.TrimSpace(execution.OptionalStringFromAny(record["name"]))
		value := strings.TrimSpace(execution.OptionalStringFromAny(record["value"]))
		if name != "" && value != "" {
			result[name] = value
		}
	}
	if len(result) == 0 {
		return nil
	}
	return result
}

func (s *Adapter) RecallPersonalMemory(
	ctx context.Context,
	request memoryruntime.RecallRequest,
) (memoryruntime.RecallResult, error) {
	if s.PersonalMemoryErr != nil {
		return memoryruntime.RecallResult{}, s.PersonalMemoryErr
	}
	if s.PersonalMemoryExecutor == nil {
		return memoryruntime.RecallResult{}, errors.New("personal memory executor is not configured")
	}
	return s.PersonalMemoryExecutor.Recall(ctx, request)
}

func MemoryFailureKindIsNonRetryable(failureKind string) bool {
	switch strings.TrimSpace(failureKind) {
	case "memory_append_request_invalid",
		"memory_projection_invalid",
		"personal_memory_not_configured":
		return true
	default:
		return false
	}
}
