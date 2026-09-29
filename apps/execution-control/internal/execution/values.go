package execution

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"strings"
)

// CloneAnyMapFromValue returns a shallow copy of a JSON object. Projection
// boundaries use this to prevent callers from mutating the map owned by a
// durable contract while deliberately leaving nested JSON values untouched.
func CloneAnyMapFromValue(value any) map[string]any {
	source, ok := value.(map[string]any)
	if !ok || source == nil {
		return map[string]any{}
	}
	return CloneAnyMap(source)
}

func CloneAnyMap(source map[string]any) map[string]any {
	if source == nil {
		return map[string]any{}
	}
	clone := make(map[string]any, len(source))
	for key, value := range source {
		clone[key] = value
	}
	return clone
}

func NestedAny(parent map[string]any, path ...string) any {
	var current any = parent
	for _, key := range path {
		object, ok := current.(map[string]any)
		if !ok {
			return nil
		}
		current = object[key]
	}
	return current
}

func NestedMap(parent map[string]any, key string) map[string]any {
	value, ok := parent[key].(map[string]any)
	if !ok {
		return map[string]any{}
	}
	return value
}

func OptionalMapFromMap(payload map[string]any, key string) map[string]any {
	value, ok := payload[key].(map[string]any)
	if !ok || value == nil {
		return map[string]any{}
	}
	return value
}

func OptionalStringFromAny(value any) string {
	switch typed := value.(type) {
	case string:
		return typed
	case fmt.Stringer:
		return typed.String()
	case nil:
		return ""
	default:
		return fmt.Sprint(typed)
	}
}

func FirstNonEmptyText(values ...any) string {
	for _, value := range values {
		text := strings.TrimSpace(OptionalStringFromAny(value))
		if text != "" {
			return text
		}
	}
	return ""
}

func StringValue(value any) string {
	text, ok := value.(string)
	if !ok {
		return ""
	}
	return strings.TrimSpace(text)
}

func ContainsString(values []string, needle string) bool {
	for _, value := range values {
		if value == needle {
			return true
		}
	}
	return false
}

func IntFromAny(value any) int {
	switch typed := value.(type) {
	case int:
		return typed
	case int64:
		return int(typed)
	case float64:
		return int(typed)
	default:
		return 0
	}
}

func PositiveIntValue(value any) (int, bool) {
	switch typed := value.(type) {
	case int:
		return typed, typed >= 1
	case int64:
		return int(typed), typed >= 1
	case float64:
		intValue := int(typed)
		return intValue, typed == float64(intValue) && intValue >= 1
	default:
		return 0, false
	}
}

func ValidSHA256Ref(value string) bool {
	hashValue := strings.TrimPrefix(strings.TrimSpace(value), "sha256:")
	if len(hashValue) != 64 {
		return false
	}
	for _, char := range hashValue {
		if (char < '0' || char > '9') && (char < 'a' || char > 'f') {
			return false
		}
	}
	return true
}

func SHA256JSONRef(value any) string {
	raw, err := json.Marshal(value)
	if err != nil {
		raw = []byte("null")
	}
	sum := sha256.Sum256(raw)
	return "sha256:" + hex.EncodeToString(sum[:])
}

func SHA256TextRef(value string) string {
	sum := sha256.Sum256([]byte(value))
	return "sha256:" + hex.EncodeToString(sum[:])
}
