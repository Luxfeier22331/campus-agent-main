package httpapi

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

const toolFunctionSchemaVersion = "tool-function-schemas-v1"

type toolFunctionSchemaFile struct {
	SchemaVersion string               `json:"schema_version"`
	Tools         []toolFunctionSchema `json:"tools"`
}

type toolFunctionSchema struct {
	Type       string         `json:"type"`
	Name       string         `json:"name"`
	Strict     bool           `json:"strict"`
	Parameters toolJSONSchema `json:"parameters"`
}

type toolJSONSchema struct {
	Type                 any                       `json:"type"`
	AdditionalProperties *bool                     `json:"additionalProperties,omitempty"`
	Properties           map[string]toolJSONSchema `json:"properties,omitempty"`
	Required             []string                  `json:"required,omitempty"`
	Enum                 []any                     `json:"enum,omitempty"`
	Items                *toolJSONSchema           `json:"items,omitempty"`
	Minimum              *float64                  `json:"minimum,omitempty"`
}

func validateSDKToolArguments(toolName string, arguments map[string]any) error {
	schema, ok, err := sdkToolArgumentSchema(toolName)
	if err != nil {
		return err
	}
	if !ok {
		return fmt.Errorf("schema for tool %s is not available", toolName)
	}
	return schema.validate("$", arguments)
}

func sdkToolArgumentSchema(toolName string) (toolJSONSchema, bool, error) {
	path := resolveToolFunctionSchemaPath()
	if path == "" {
		return toolJSONSchema{}, false, fmt.Errorf("tool function schema fixture is not available")
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		return toolJSONSchema{}, false, fmt.Errorf("read tool function schemas: %w", err)
	}
	var file toolFunctionSchemaFile
	if err := json.Unmarshal(raw, &file); err != nil {
		return toolJSONSchema{}, false, fmt.Errorf("parse tool function schemas: %w", err)
	}
	if file.SchemaVersion != toolFunctionSchemaVersion {
		return toolJSONSchema{}, false, fmt.Errorf("tool function schema_version = %q", file.SchemaVersion)
	}
	for _, tool := range file.Tools {
		if tool.Type == "function" && tool.Strict && tool.Name == toolName {
			return tool.Parameters, true, nil
		}
	}
	return toolJSONSchema{}, false, nil
}

func (schema toolJSONSchema) validate(path string, value any) error {
	if !schema.typeAllows(value) {
		return fmt.Errorf("%s has invalid type", path)
	}
	switch typed := value.(type) {
	case map[string]any:
		return schema.validateObject(path, typed)
	case []any:
		return schema.validateArray(path, typed)
	default:
		return schema.validateScalar(path, typed)
	}
}

func (schema toolJSONSchema) validateObject(path string, value map[string]any) error {
	if schema.AdditionalProperties != nil && !*schema.AdditionalProperties {
		for key := range value {
			if _, ok := schema.Properties[key]; !ok {
				return fmt.Errorf("%s.%s is not allowed", path, key)
			}
		}
	}
	for _, required := range schema.Required {
		if _, ok := value[required]; !ok {
			return fmt.Errorf("%s.%s is required", path, required)
		}
	}
	for key, child := range schema.Properties {
		if childValue, ok := value[key]; ok {
			if err := child.validate(path+"."+key, childValue); err != nil {
				return err
			}
		}
	}
	return nil
}

func (schema toolJSONSchema) validateArray(path string, values []any) error {
	if schema.Items == nil {
		return nil
	}
	for index, value := range values {
		if err := schema.Items.validate(fmt.Sprintf("%s[%d]", path, index), value); err != nil {
			return err
		}
	}
	return nil
}

func (schema toolJSONSchema) validateScalar(path string, value any) error {
	if len(schema.Enum) > 0 && !enumContains(schema.Enum, value) {
		return fmt.Errorf("%s is outside enum", path)
	}
	if schema.Minimum != nil {
		number, ok := numericValue(value)
		if !ok || number < *schema.Minimum {
			return fmt.Errorf("%s is below minimum", path)
		}
	}
	return nil
}

func (schema toolJSONSchema) typeAllows(value any) bool {
	types := schema.typeNames()
	if len(types) == 0 {
		return true
	}
	for _, candidate := range types {
		switch candidate {
		case "null":
			if value == nil {
				return true
			}
		case "object":
			if _, ok := value.(map[string]any); ok {
				return true
			}
		case "array":
			if _, ok := value.([]any); ok {
				return true
			}
		case "string":
			if _, ok := value.(string); ok {
				return true
			}
		case "integer":
			if number, ok := numericValue(value); ok && number == float64(int64(number)) {
				return true
			}
		case "number":
			if _, ok := numericValue(value); ok {
				return true
			}
		case "boolean":
			if _, ok := value.(bool); ok {
				return true
			}
		}
	}
	return false
}

func (schema toolJSONSchema) typeNames() []string {
	switch value := schema.Type.(type) {
	case string:
		return []string{value}
	case []any:
		result := make([]string, 0, len(value))
		for _, item := range value {
			if text, ok := item.(string); ok {
				result = append(result, text)
			}
		}
		return result
	default:
		return nil
	}
}

func enumContains(values []any, target any) bool {
	for _, value := range values {
		if fmt.Sprint(value) == fmt.Sprint(target) {
			return true
		}
	}
	return false
}

func numericValue(value any) (float64, bool) {
	switch typed := value.(type) {
	case int:
		return float64(typed), true
	case int64:
		return float64(typed), true
	case float64:
		return typed, true
	case json.Number:
		number, err := typed.Float64()
		return number, err == nil
	default:
		return 0, false
	}
}

func resolveToolFunctionSchemaPath() string {
	if envPath := strings.TrimSpace(os.Getenv("EXECUTION_CONTROL_TOOL_FUNCTION_SCHEMA_PATH")); envPath != "" {
		return envPath
	}
	workingDir, err := os.Getwd()
	if err != nil {
		return ""
	}
	for dir := workingDir; ; dir = filepath.Dir(dir) {
		candidate := filepath.Join(dir, "packages", "evals", "fixtures", "tool_function_schemas.v1.json")
		if _, err := os.Stat(candidate); err == nil {
			return candidate
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			return ""
		}
	}
}
