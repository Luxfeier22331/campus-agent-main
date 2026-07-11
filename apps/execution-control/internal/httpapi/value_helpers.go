package httpapi

import (
	"strings"
)

func nestedMap(parent map[string]any, key string) map[string]any {
	value, ok := parent[key].(map[string]any)
	if !ok {
		return map[string]any{}
	}
	return value
}

func nestedAny(parent map[string]any, path ...string) any {
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

func stringValue(value any) string {
	text, ok := value.(string)
	if !ok {
		return ""
	}
	return strings.TrimSpace(text)
}

func containsString(values []string, needle string) bool {
	for _, value := range values {
		if value == needle {
			return true
		}
	}
	return false
}

func workflowToolLifecycleState(status string) string {
	if status == "error" || status == "cancelled" || status == "timed_out" {
		return "failed"
	}
	return "completed"
}
