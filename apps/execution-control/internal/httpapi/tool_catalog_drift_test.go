package httpapi

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/runtimepolicy"
)

type checkedInToolFunctionSchemas struct {
	SchemaVersion string                        `json:"schema_version"`
	Tools         []checkedInToolFunctionSchema `json:"tools"`
}

type checkedInToolFunctionSchema struct {
	Type       string         `json:"type"`
	Name       string         `json:"name"`
	Strict     bool           `json:"strict"`
	Parameters map[string]any `json:"parameters"`
}

func TestCheckedInExecutionControlToolsRetainCurrentExposure(t *testing.T) {
	toolRegistry, err := runtimepolicy.LoadToolSpecRegistry("")
	if err != nil {
		t.Fatalf("load Go tool registry: %v", err)
	}
	registeredEndpoints := executionControlToolEndpointsByPath()
	wantEndpoints := map[string]string{
		"campus_search":          "/internal/campus/search",
		"personal_memory_recall": "/internal/memory/personal/recall",
	}

	for _, tool := range toolRegistry.Tools {
		endpoint, ok := wantEndpoints[tool.Name]
		if !ok {
			t.Fatalf("unexpected registered tool %s", tool.Name)
		}
		wantExposure := "model_visible"
		if tool.Exposure != wantExposure || !tool.ReadOnly || tool.RequiresApproval {
			t.Fatalf("registered tool %s exposure/read policy drifted: %#v", tool.Name, tool)
		}
		if tool.Handler.Type != "execution_control_internal_query" || tool.Handler.Endpoint != endpoint {
			t.Fatalf("tool %s handler = %#v, want endpoint %q", tool.Name, tool.Handler, endpoint)
		}
		if registeredEndpoints[tool.Handler.Endpoint] != tool.Name {
			t.Fatalf(
				"tool %s endpoint %q not registered to matching execution-control handler; registered=%q",
				tool.Name,
				tool.Handler.Endpoint,
				registeredEndpoints[tool.Handler.Endpoint],
			)
		}
		delete(wantEndpoints, tool.Name)
	}
	if len(wantEndpoints) != 0 {
		t.Fatalf("registered tools are missing: %#v", wantEndpoints)
	}
}

func TestRegisteredToolCatalogRetainsCanonicalStrictFunctionSchemas(t *testing.T) {
	toolRegistry, err := runtimepolicy.LoadToolSpecRegistry("")
	if err != nil {
		t.Fatalf("load Go tool registry: %v", err)
	}
	rawSchemas, err := os.ReadFile(filepath.Join(
		"..",
		"..",
		"..",
		"..",
		"configs",
		"runtime",
		"tool-function-schemas.v4.json",
	))
	if err != nil {
		t.Fatalf("read tool function schemas: %v", err)
	}
	var schemas checkedInToolFunctionSchemas
	if err := json.Unmarshal(rawSchemas, &schemas); err != nil {
		t.Fatalf("parse tool function schemas: %v", err)
	}
	if schemas.SchemaVersion != toolFunctionSchemaVersion {
		t.Fatalf("schema_version = %q, want %s", schemas.SchemaVersion, toolFunctionSchemaVersion)
	}
	strictSchemas := map[string]checkedInToolFunctionSchema{}
	for _, schema := range schemas.Tools {
		if schema.Type == "function" && schema.Strict {
			strictSchemas[schema.Name] = schema
		}
	}
	for _, tool := range toolRegistry.Tools {
		schema, ok := strictSchemas[tool.Name]
		if !ok {
			t.Fatalf("registered tool %s missing canonical strict function schema", tool.Name)
		}
		if schema.Parameters["additionalProperties"] != false {
			t.Fatalf("tool %s schema must set additionalProperties=false", tool.Name)
		}
		if _, ok := schema.Parameters["required"].([]any); !ok {
			t.Fatalf("tool %s schema missing required array", tool.Name)
		}
		assertStrictObjectSchema(t, tool.Name, schema.Parameters)
	}
}

func assertStrictObjectSchema(t *testing.T, toolName string, schema map[string]any) {
	t.Helper()
	if !isObjectOrNullableObject(schema["type"]) {
		t.Fatalf("tool %s object schema has type=%v, want object", toolName, schema["type"])
	}
	if schema["additionalProperties"] != false {
		t.Fatalf("tool %s object schema must set additionalProperties=false", toolName)
	}
	rawProperties, ok := schema["properties"].(map[string]any)
	if !ok {
		t.Fatalf("tool %s object schema missing properties", toolName)
	}
	rawRequired, ok := schema["required"].([]any)
	if !ok {
		t.Fatalf("tool %s object schema missing required array", toolName)
	}
	required := map[string]struct{}{}
	for _, value := range rawRequired {
		name, ok := value.(string)
		if !ok || name == "" {
			t.Fatalf("tool %s required entry must be a non-empty string: %#v", toolName, value)
		}
		required[name] = struct{}{}
	}
	for name, rawProperty := range rawProperties {
		if _, ok := required[name]; !ok {
			t.Fatalf("tool %s property %s must be listed in required for strict mode", toolName, name)
		}
		property, ok := rawProperty.(map[string]any)
		if !ok {
			continue
		}
		if isObjectOrNullableObject(property["type"]) {
			assertStrictObjectSchema(t, toolName+"."+name, property)
		}
	}
}

func isObjectOrNullableObject(value any) bool {
	if value == "object" {
		return true
	}
	values, ok := value.([]any)
	if !ok {
		return false
	}
	for _, item := range values {
		if item == "object" {
			return true
		}
	}
	return false
}

func executionControlToolEndpointsByPath() map[string]string {
	return map[string]string{
		"/internal/campus/search":          campusSearchToolName,
		"/internal/memory/personal/recall": personalMemoryRecallToolName,
	}
}
