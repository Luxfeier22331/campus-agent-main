package answermemory

import (
	"encoding/json"
	"errors"

	"github.com/MUC-WIKI/campus-agent/apps/agent-control/internal/execution"
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
