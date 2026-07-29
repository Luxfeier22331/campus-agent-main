package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"strings"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/execution"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/memoryruntime"
)

func memoryRecallRequestForRun(
	run execution.DurableRun,
	payload map[string]any,
) (memoryruntime.RecallRequest, error) {
	if payload == nil {
		return memoryruntime.RecallRequest{}, errors.New("execution input is required")
	}
	userGoal := strings.TrimSpace(optionalStringFromAny(payload["user_goal"]))
	if userGoal == "" {
		return memoryruntime.RecallRequest{}, errors.New("memory recall user_goal is required")
	}
	userID := firstNonEmptyText(
		nestedAny(payload, "actor", "user_id"),
		nestedAny(payload, "context", "actor", "user_id"),
		run.OwnerUserID,
	)
	ownerGeneration, ownerSequence, err := memoryOwnerFenceFromPayload(payload)
	if err != nil {
		return memoryruntime.RecallRequest{}, err
	}
	queryTimestamp := strings.TrimSpace(optionalStringFromAny(
		nestedAny(payload, "context", "conversation", "current_user_message", "created_at"),
	))
	request := memoryruntime.RecallRequest{
		OwnerGeneration: ownerGeneration,
		OwnerSequence:   ownerSequence,
		QueryTimestamp:  queryTimestamp,
		RunID:           run.RunID,
		SessionSlots:    memorySessionSlotsFromPayload(payload),
		TenantID:        firstNonEmptyText(payload["tenant_id"], nestedAny(payload, "context", "tenant_id")),
		ThreadID:        run.ConversationID,
		UserGoal:        userGoal,
		UserID:          userID,
	}
	if err := memoryruntime.ValidateRecallRequest(request); err != nil {
		return memoryruntime.RecallRequest{}, err
	}
	return request, nil
}

func memoryOwnerFenceFromPayload(payload map[string]any) (int64, int64, error) {
	generation, ok := exactInt64(nestedAny(payload, "context", "memory", "owner_generation"))
	if !ok || generation < 1 {
		return 0, 0, errors.New("memory owner generation is required")
	}
	sequence, ok := exactInt64(nestedAny(payload, "context", "memory", "owner_sequence"))
	if !ok || sequence < 0 {
		return 0, 0, errors.New("memory owner sequence is required")
	}
	return generation, sequence, nil
}

func exactInt64(value any) (int64, bool) {
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

func memoryFailureKindIsNonRetryable(failureKind string) bool {
	switch strings.TrimSpace(failureKind) {
	case "memory_append_request_invalid",
		"memory_projection_invalid",
		"personal_memory_not_configured":
		return true
	default:
		return false
	}
}
