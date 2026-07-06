package httpapi

import "strings"

var projectedModelParamEnumValues = map[string]map[string]bool{
	"reasoning_effort": {"high": true, "low": true, "medium": true, "minimal": true, "none": true, "xhigh": true},
	"response_format":  {"json_object": true, "json_schema": true, "text": true},
	"text_verbosity":   {"high": true, "low": true, "medium": true},
	"tool_choice":      {"auto": true, "none": true, "required": true, "tool_name": true},
}

func safeModelParamsProjection(value any) (map[string]any, bool) {
	source := cloneAnyMapFromMetadata(value)
	if !validAllowedMapKeys(source, stringBoolSet(
		"schema_version",
		"params_schema_version",
		"params_sha256",
		"projected_params",
	)) ||
		stringValue(source["schema_version"]) != "model_params_projection.v1" ||
		stringValue(source["params_schema_version"]) == "" ||
		!validSHA256Ref(stringValue(source["params_sha256"])) {
		return nil, false
	}
	projectedParams, ok := safeProjectedModelParams(source["projected_params"])
	if !ok {
		return nil, false
	}
	return map[string]any{
		"schema_version":        "model_params_projection.v1",
		"params_schema_version": stringValue(source["params_schema_version"]),
		"params_sha256":         stringValue(source["params_sha256"]),
		"projected_params":      projectedParams,
	}, true
}

func safeProjectedModelParams(value any) (map[string]any, bool) {
	source := cloneAnyMapFromMetadata(value)
	if !validAllowedMapKeys(source, stringBoolSet(
		"max_output_tokens",
		"reasoning_effort",
		"response_format",
		"store",
		"temperature",
		"text_verbosity",
		"tool_choice",
		"top_p",
	)) {
		return nil, false
	}
	projected := map[string]any{}
	for _, field := range []string{
		"max_output_tokens",
		"reasoning_effort",
		"response_format",
		"store",
		"temperature",
		"text_verbosity",
		"tool_choice",
		"top_p",
	} {
		value, exists := source[field]
		if !exists || value == nil {
			projected[field] = nil
			continue
		}
		switch field {
		case "max_output_tokens":
			intValue, ok := positiveIntValue(value)
			if !ok {
				return nil, false
			}
			projected[field] = intValue
		case "temperature":
			numberValue, ok := numberInRange(value, 0, 2)
			if !ok {
				return nil, false
			}
			projected[field] = numberValue
		case "top_p":
			numberValue, ok := numberInRange(value, 0, 1)
			if !ok {
				return nil, false
			}
			projected[field] = numberValue
		case "store":
			boolValue, ok := value.(bool)
			if !ok {
				return nil, false
			}
			projected[field] = boolValue
		default:
			text := stringValue(value)
			if text == "" || !projectedModelParamEnumValues[field][text] {
				return nil, false
			}
			projected[field] = text
		}
	}
	return projected, true
}

func primaryAgentModelParamsForFingerprint(snapshot providerConfigSnapshot) map[string]any {
	return map[string]any{
		"base_url":    strings.TrimSpace(snapshot.BaseURL),
		"provider":    strings.TrimSpace(snapshot.Provider),
		"model":       strings.TrimSpace(snapshot.Model),
		"transport":   strings.TrimSpace(snapshot.Transport),
		"timeout_ms":  snapshot.TimeoutMS,
		"tool_config": cloneAnyMapFromMetadata(snapshot.ToolConfig),
	}
}

func modelParamsProjection(projectedParams map[string]any) map[string]any {
	projection := map[string]any{
		"max_output_tokens": nil,
		"reasoning_effort":  nil,
		"response_format":   nil,
		"store":             nil,
		"temperature":       nil,
		"text_verbosity":    nil,
		"tool_choice":       nil,
		"top_p":             nil,
	}
	if value, ok := projectedParams["max_output_tokens"].(int); ok && value > 0 {
		projection["max_output_tokens"] = value
	}
	if value := firstNonEmptyText(projectedParams["reasoning_effort"]); value != "" {
		projection["reasoning_effort"] = value
	}
	if value := firstNonEmptyText(projectedParams["response_format"]); value != "" {
		projection["response_format"] = value
	}
	if value, ok := projectedParams["store"].(bool); ok {
		projection["store"] = value
	}
	if value, ok := projectedParams["temperature"].(float64); ok {
		projection["temperature"] = value
	}
	if value := firstNonEmptyText(projectedParams["text_verbosity"]); value != "" {
		projection["text_verbosity"] = value
	}
	toolConfig := cloneAnyMapFromMetadata(projectedParams["tool_config"])
	if len(toolConfig) > 0 {
		if value := firstNonEmptyText(toolConfig["tool_choice"]); value != "" {
			projection["tool_choice"] = value
		}
	}
	if value, ok := projectedParams["top_p"].(float64); ok {
		projection["top_p"] = value
	}
	return map[string]any{
		"schema_version":        "model_params_projection.v1",
		"params_schema_version": modelParamsSchemaVersion,
		"params_sha256":         sha256JSONRef(projectedParams),
		"projected_params":      projection,
	}
}
