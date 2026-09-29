package memory

import (
	"context"
	"encoding/json"
	"errors"
	"strings"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/execution"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/memoryruntime"
)

func MemoryOwnerGenerationFromPayload(payload map[string]any) (int64, error) {
	generation, ok := ExactInt64(execution.NestedAny(payload, "context", "memory", "owner_generation"))
	if !ok || generation < 1 {
		return 0, errors.New("memory owner generation is required")
	}
	return generation, nil
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
