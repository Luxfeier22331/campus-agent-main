package httpapi

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/runtimepolicy"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/structuredquery"
)

type checkedInToolCatalog struct {
	Tools []checkedInToolCatalogEntry `json:"tools"`
}

type checkedInToolCatalogEntry struct {
	Name       string                      `json:"name"`
	Capability string                      `json:"capability"`
	Exposure   string                      `json:"exposure"`
	ReadOnly   bool                        `json:"read_only"`
	Handler    checkedInToolCatalogHandler `json:"handler"`
}

type checkedInToolCatalogHandler struct {
	Type     string `json:"type"`
	Endpoint string `json:"endpoint"`
}

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

func TestModelVisibleExecutionControlToolsMatchGoRuntimeAndRoutes(t *testing.T) {
	rawCatalog, err := os.ReadFile(filepath.Join(
		"..",
		"..",
		"..",
		"..",
		"configs",
		"runtime",
		"tool-catalog.v1.json",
	))
	if err != nil {
		t.Fatalf("read tool catalog: %v", err)
	}
	var catalog checkedInToolCatalog
	if err := json.Unmarshal(rawCatalog, &catalog); err != nil {
		t.Fatalf("parse tool catalog: %v", err)
	}
	toolRegistry, err := runtimepolicy.LoadToolSpecRegistry("")
	if err != nil {
		t.Fatalf("load Go tool registry: %v", err)
	}
	artifactRegistry, err := runtimepolicy.LoadWorkflowArtifactRegistry("")
	if err != nil {
		t.Fatalf("load workflow artifact registry: %v", err)
	}
	registeredEndpoints := structuredQueryEndpointsByPath()

	for _, tool := range catalog.Tools {
		if tool.Exposure != "model_visible" || tool.Handler.Type != "execution_control_internal_query" {
			continue
		}
		spec, ok := toolRegistry.ToolByName(tool.Name)
		if !ok {
			t.Fatalf("model-visible tool %s missing from Go tool registry", tool.Name)
		}
		if !spec.Active || !spec.ReadOnly || spec.RuntimePosture != "typed_activity_admitted" {
			t.Fatalf("tool %s spec is not active read-only typed activity: %#v", tool.Name, spec)
		}
		if spec.OwnerCapability != tool.Capability || spec.PayloadKind != tool.Name {
			t.Fatalf("tool %s spec drift: capability=%q payload_kind=%q", tool.Name, spec.OwnerCapability, spec.PayloadKind)
		}
		if spec.OwnerCapability == "campus_services" {
			if err := runtimepolicy.ValidateModelVisibleToolArtifactGate(spec, artifactRegistry); err != nil {
				t.Fatalf("tool %s is not backed by an open supported workflow artifact binding: %v", tool.Name, err)
			}
		}
		if registeredEndpoints[tool.Handler.Endpoint] != tool.Name {
			t.Fatalf(
				"tool %s endpoint %q not registered to matching structured query handler; registered=%q",
				tool.Name,
				tool.Handler.Endpoint,
				registeredEndpoints[tool.Handler.Endpoint],
			)
		}
	}
}

func TestModelVisibleToolCatalogHasCanonicalStrictFunctionSchemas(t *testing.T) {
	rawCatalog, err := os.ReadFile(filepath.Join(
		"..",
		"..",
		"..",
		"..",
		"configs",
		"runtime",
		"tool-catalog.v1.json",
	))
	if err != nil {
		t.Fatalf("read tool catalog: %v", err)
	}
	var catalog checkedInToolCatalog
	if err := json.Unmarshal(rawCatalog, &catalog); err != nil {
		t.Fatalf("parse tool catalog: %v", err)
	}
	rawSchemas, err := os.ReadFile(filepath.Join(
		"..",
		"..",
		"..",
		"..",
		"configs",
		"runtime",
		"tool-function-schemas.v1.json",
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
	for _, tool := range catalog.Tools {
		if tool.Exposure != "model_visible" {
			continue
		}
		schema, ok := strictSchemas[tool.Name]
		if !ok {
			t.Fatalf("model-visible tool %s missing canonical strict function schema", tool.Name)
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

func structuredQueryEndpointsByPath() map[string]string {
	return map[string]string{
		"/internal/query/campus-services/transport-schedule": structuredquery.ToolTransportScheduleLookup,
		"/internal/query/notices/discover":                   structuredquery.ToolCampusNoticeDiscover,
		"/internal/query/notices/period-summary":             structuredquery.ToolCampusNoticePeriodSummary,
		"/internal/query/notices/change-set":                 structuredquery.ToolCampusNoticeChangeSet,
		"/internal/query/notices/get":                        structuredquery.ToolCampusNoticeGet,
	}
}
