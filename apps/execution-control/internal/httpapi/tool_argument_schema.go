package httpapi

import (
	"encoding/json"
	"fmt"
	"os"
	"strings"
)

const toolFunctionSchemaVersion = "tool-function-schemas-v3"

const packagedToolFunctionSchemaPath = "/etc/campus-agent/tool-function-schemas.v3.json"

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

type toolArgumentSchemaMetadata struct {
	ArgumentsJSONSHA256    string
	ArgumentsSchemaSHA256  string
	ArgumentsSchemaVersion string
}

type toolJSONSchema struct {
	Type                 any                       `json:"type"`
	AdditionalProperties *bool                     `json:"additionalProperties,omitempty"`
	Properties           map[string]toolJSONSchema `json:"properties,omitempty"`
	Required             []string                  `json:"required,omitempty"`
	Enum                 []any                     `json:"enum,omitempty"`
	Items                *toolJSONSchema           `json:"items,omitempty"`
	Minimum              *float64                  `json:"minimum,omitempty"`
	Maximum              *float64                  `json:"maximum,omitempty"`
	MinLength            *int                      `json:"minLength,omitempty"`
	MaxLength            *int                      `json:"maxLength,omitempty"`
}

func validateSDKToolArguments(
	toolName string,
	arguments map[string]any,
) (toolArgumentSchemaMetadata, error) {
	schema, schemaVersion, ok, err := sdkToolArgumentSchema(toolName)
	metadata := toolArgumentSchemaMetadata{
		ArgumentsJSONSHA256:    sha256JSONRef(arguments),
		ArgumentsSchemaVersion: schemaVersion,
	}
	if err != nil {
		return metadata, err
	}
	if !ok {
		return metadata, fmt.Errorf("schema for tool %s is not available", toolName)
	}
	metadata.ArgumentsSchemaSHA256 = sha256JSONRef(schema)
	return metadata, schema.validate("$", arguments)
}

func sdkToolArgumentSchema(toolName string) (toolJSONSchema, string, bool, error) {
	path := resolveToolFunctionSchemaPath()
	if path == "" {
		return toolJSONSchema{}, "", false, fmt.Errorf("tool function schema config is not available")
	}
	file, err := loadToolFunctionSchemaFile(path)
	if err != nil {
		return toolJSONSchema{}, "", false, err
	}
	for _, tool := range file.Tools {
		if tool.Type == "function" && tool.Strict && tool.Name == toolName {
			return tool.Parameters, file.SchemaVersion, true, nil
		}
	}
	return toolJSONSchema{}, file.SchemaVersion, false, nil
}

func loadToolFunctionSchemaFile(path string) (toolFunctionSchemaFile, error) {
	raw, err := os.ReadFile(path)
	if err != nil {
		return toolFunctionSchemaFile{}, fmt.Errorf("read tool function schemas: %w", err)
	}
	var file toolFunctionSchemaFile
	if err := json.Unmarshal(raw, &file); err != nil {
		return toolFunctionSchemaFile{}, fmt.Errorf("parse tool function schemas: %w", err)
	}
	if err := validateSupportedToolFunctionSchemaKeywords(raw); err != nil {
		return toolFunctionSchemaFile{}, err
	}
	if file.SchemaVersion != toolFunctionSchemaVersion {
		return toolFunctionSchemaFile{}, fmt.Errorf("tool function schema_version = %q", file.SchemaVersion)
	}
	if len(file.Tools) == 0 {
		return toolFunctionSchemaFile{}, fmt.Errorf("tool function schemas tools must not be empty")
	}
	for _, tool := range file.Tools {
		if err := validateSupportedToolJSONSchema("$."+tool.Name+".parameters", tool.Parameters); err != nil {
			return toolFunctionSchemaFile{}, err
		}
	}
	return file, nil
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
	if schema.Maximum != nil {
		number, ok := numericValue(value)
		if !ok || number > *schema.Maximum {
			return fmt.Errorf("%s is above maximum", path)
		}
	}
	if text, ok := value.(string); ok {
		length := len([]rune(text))
		if schema.MinLength != nil && length < *schema.MinLength {
			return fmt.Errorf("%s is shorter than minLength", path)
		}
		if schema.MaxLength != nil && length > *schema.MaxLength {
			return fmt.Errorf("%s is longer than maxLength", path)
		}
	}
	return nil
}

func validateSupportedToolJSONSchema(path string, schema toolJSONSchema) error {
	if schema.Type == nil &&
		schema.AdditionalProperties == nil &&
		len(schema.Properties) == 0 &&
		len(schema.Required) == 0 &&
		len(schema.Enum) == 0 &&
		schema.Items == nil &&
		schema.Minimum == nil &&
		schema.Maximum == nil &&
		schema.MinLength == nil &&
		schema.MaxLength == nil {
		return fmt.Errorf("%s is empty", path)
	}
	if !supportedToolSchemaTypeValue(schema.Type) {
		return fmt.Errorf("%s.type is not supported", path)
	}
	for key, child := range schema.Properties {
		if err := validateSupportedToolJSONSchema(path+".properties."+key, child); err != nil {
			return err
		}
	}
	if schema.Items != nil {
		if err := validateSupportedToolJSONSchema(path+".items", *schema.Items); err != nil {
			return err
		}
	}
	return nil
}

func supportedToolSchemaTypeValue(value any) bool {
	if value == nil {
		return true
	}
	switch typed := value.(type) {
	case string:
		return supportedToolSchemaTypeName(typed)
	case []any:
		for _, item := range typed {
			name, ok := item.(string)
			if !ok || !supportedToolSchemaTypeName(name) {
				return false
			}
		}
		return true
	default:
		return false
	}
}

func supportedToolSchemaTypeName(value string) bool {
	switch strings.TrimSpace(value) {
	case "null", "object", "array", "string", "integer", "number", "boolean":
		return true
	default:
		return false
	}
}

func validateSupportedToolFunctionSchemaKeywords(raw []byte) error {
	var root map[string]any
	if err := json.Unmarshal(raw, &root); err != nil {
		return fmt.Errorf("parse tool function schemas for keyword validation: %w", err)
	}
	tools, ok := root["tools"].([]any)
	if !ok {
		return fmt.Errorf("tool function schemas tools must be an array")
	}
	for index, item := range tools {
		tool, ok := item.(map[string]any)
		if !ok {
			return fmt.Errorf("tool function schemas tools[%d] must be an object", index)
		}
		parameters, ok := tool["parameters"].(map[string]any)
		if !ok {
			return fmt.Errorf("tool function schemas tools[%d].parameters must be an object", index)
		}
		name, _ := tool["name"].(string)
		if err := validateSupportedToolJSONSchemaKeywords("$.tools."+strings.TrimSpace(name)+".parameters", parameters); err != nil {
			return err
		}
	}
	return nil
}

func validateSupportedToolJSONSchemaKeywords(path string, schema map[string]any) error {
	for key := range schema {
		switch key {
		case "type", "additionalProperties", "properties", "required", "enum", "items", "minimum", "maximum", "minLength", "maxLength", "description":
		default:
			return fmt.Errorf("%s.%s is not a supported tool argument schema keyword", path, key)
		}
	}
	properties, ok := schema["properties"].(map[string]any)
	if ok {
		for key, childRaw := range properties {
			child, ok := childRaw.(map[string]any)
			if !ok {
				return fmt.Errorf("%s.properties.%s must be an object schema", path, key)
			}
			if err := validateSupportedToolJSONSchemaKeywords(path+".properties."+key, child); err != nil {
				return err
			}
		}
	}
	if childRaw, exists := schema["items"]; exists {
		child, ok := childRaw.(map[string]any)
		if !ok {
			return fmt.Errorf("%s.items must be an object schema", path)
		}
		if err := validateSupportedToolJSONSchemaKeywords(path+".items", child); err != nil {
			return err
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
	return resolveToolFunctionSchemaPathFrom("")
}

func resolveToolFunctionSchemaPathFrom(schemaPath string) string {
	return resolveRuntimeConfigPath(
		schemaPath,
		defaultToolFunctionSchemaRelativePath,
		packagedToolFunctionSchemaPath,
	)
}
