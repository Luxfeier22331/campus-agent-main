package executionpersistence

import "encoding/json"

// These copies belong to the adapter because they protect the in-memory and
// database boundary; lifecycle and projection decisions remain in execution.
func cloneAnyMap(source map[string]any) map[string]any {
	if source == nil {
		return map[string]any{}
	}
	result := make(map[string]any, len(source))
	for key, value := range source {
		result[key] = value
	}
	return result
}

func cloneRawMessage(value json.RawMessage) json.RawMessage {
	return append(json.RawMessage(nil), value...)
}
