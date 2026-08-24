package runtimepolicy

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

const (
	testPayloadSchemaRef = "https://muc.wiki/campus-agent/schemas/personal-memory-tool-contracts.v1.schema.json#/$defs/PersonalMemoryRecallPayload"
	testResultSchemaRef  = "https://muc.wiki/campus-agent/schemas/personal-memory-tool-contracts.v1.schema.json#/$defs/PersonalMemoryRecallResult"
)

func TestLoadToolSpecRegistryLoadsDefaultToolInventory(t *testing.T) {
	registry, err := LoadToolSpecRegistry("")
	if err != nil {
		t.Fatalf("LoadToolSpecRegistry default failed: %v", err)
	}

	if registry.SchemaVersion != ToolRegistrySchemaVersion {
		t.Fatalf("schema_version = %q, want %q", registry.SchemaVersion, ToolRegistrySchemaVersion)
	}
	if got := registry.ModelVisibleToolNames(); !sameStrings(got, []string{"campus_search", "personal_memory_recall"}) {
		t.Fatalf("model-visible tools = %#v, want campus_search and personal_memory_recall", got)
	}
	wantTools := map[string]struct {
		endpoint string
		exposure string
	}{
		"campus_search": {
			endpoint: "/internal/campus/search",
			exposure: "model_visible",
		},
		"personal_memory_recall": {
			endpoint: "/internal/memory/personal/recall",
			exposure: "model_visible",
		},
	}
	if len(registry.Tools) != len(wantTools) {
		t.Fatalf("registered tools = %d, want %d", len(registry.Tools), len(wantTools))
	}
	for name, expected := range wantTools {
		tool, ok := registry.ToolByName(name)
		if !ok {
			t.Fatalf("registered tool %s is missing", name)
		}
		if tool.Exposure != expected.exposure {
			t.Fatalf("registered tool %s exposure = %q, want %q", name, tool.Exposure, expected.exposure)
		}
		if tool.Handler.Type != "execution_control_internal_query" ||
			tool.Handler.Target != "" || tool.Handler.Endpoint != expected.endpoint {
			t.Fatalf("registered tool %s handler = %#v", name, tool.Handler)
		}
	}
}

func TestRuntimePolicyModelVisibleToolsMatchDefaultToolSpec(t *testing.T) {
	registry, err := LoadToolSpecRegistry("")
	if err != nil {
		t.Fatalf("LoadToolSpecRegistry default failed: %v", err)
	}
	if got, want := ModelVisibleToolNames(), registry.ModelVisibleToolNames(); !sameStrings(got, want) {
		t.Fatalf("model visible tools = %#v, want ToolSpec %#v", got, want)
	}
}

func TestToolSpecRegistryValidationRejectsDuplicateTools(t *testing.T) {
	path := writeToolRegistryFixture(
		t,
		`{
		  "schema_version": "tool-registry-v6",
		  "registry_version": "test",
		  "tools": [`+validToolJSON("test_lookup", "model_visible", true, false, "execution_control_internal_query", "/internal/query/fixture/test")+`,
		            `+validToolJSON("test_lookup", "model_visible", true, false, "execution_control_internal_query", "/internal/query/fixture/test")+`]
		}`,
	)

	if _, err := LoadToolSpecRegistry(path); err == nil {
		t.Fatal("LoadToolSpecRegistry accepted duplicate tool names")
	}
}

func TestToolSpecRegistryValidationRejectsInvalidToolShape(t *testing.T) {
	tests := []struct {
		name string
		body string
		want string
	}{
		{
			name: "mutable model-visible tool",
			body: registryJSON(validToolJSON("bad_tool", "model_visible", false, false, "execution_control_internal_query", "/internal/query/test")),
			want: "model-visible tools must be read_only",
		},
		{
			name: "unregistered schema ref",
			body: `{
			  "schema_version": "tool-registry-v6",
			  "registry_version": "test",
			  "tools": [{
			    "name": "bad_tool",
			    "description": "bad tool",
			    "exposure": "model_visible",
			    "read_only": true,
			    "requires_approval": false,
			    "payload_schema_ref": "https://campus-agent.local/schemas/unregistered.v1.schema.json#/$defs/BadPayload",
			    "result_schema_ref": "` + testResultSchemaRef + `",
			    "handler": {"type": "execution_control_internal_query", "endpoint": "/internal/query/test"},
			    "timeout_ms": 1000,
			    "result_projection_policy": "bounded_json"
			  }]
			}`,
			want: "payload_schema_ref must reference a registered JSON Schema definition",
		},
		{
			name: "missing internal endpoint prefix",
			body: registryJSON(validToolJSON("bad_tool", "model_visible", true, false, "execution_control_internal_query", "/query/test")),
			want: "handler.endpoint must be an /internal/ path",
		},
		{
			name: "internal query target present",
			body: strings.Replace(
				registryJSON(validToolJSON("bad_tool", "model_visible", true, false, "execution_control_internal_query", "/internal/query/test")),
				`"endpoint":"/internal/query/test"`,
				`"endpoint":"/internal/query/test","target":"retired_agent"`,
				1,
			),
			want: "handler.target must be empty for execution_control_internal_query",
		},
		{
			name: "unsupported retired internal route handler",
			body: registryJSON(validToolJSON("bad_tool", "model_visible", true, false, "workflow_signal", "")),
			want: "handler.type is unsupported",
		},
		{
			name: "closed requires approval",
			body: registryJSON(validToolJSON("bad_tool", "closed", true, true, "execution_control_internal_query", "/internal/query/test")),
			want: "closed tools must not require approval",
		},
		{
			name: "unsupported projection policy",
			body: strings.Replace(
				registryJSON(validToolJSON("bad_tool", "model_visible", true, false, "execution_control_internal_query", "/internal/query/test")),
				`"result_projection_policy": "bounded_json"`,
				`"result_projection_policy": "raw"`,
				1,
			),
			want: "result_projection_policy is unsupported",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			_, err := LoadToolSpecRegistry(writeToolRegistryFixture(t, tt.body))
			if err == nil {
				t.Fatalf("LoadToolSpecRegistry accepted %s", tt.name)
			}
			if !strings.Contains(err.Error(), tt.want) {
				t.Fatalf("LoadToolSpecRegistry error = %q, want %q", err.Error(), tt.want)
			}
		})
	}
}

func registryJSON(toolJSON string) string {
	return `{"schema_version":"tool-registry-v6","registry_version":"test","tools":[` + toolJSON + `]}`
}

func validToolJSON(
	name string,
	exposure string,
	readOnly bool,
	requiresApproval bool,
	handlerType string,
	endpoint string,
) string {
	handler := `{"type":"` + handlerType + `"}`
	if endpoint != "" {
		handler = `{"type":"` + handlerType + `","endpoint":"` + endpoint + `"}`
	}
	return `{
	  "name": "` + name + `",
	  "description": "Lookup current campus shuttle timetable.",
	  "exposure": "` + exposure + `",
	  "read_only": ` + boolJSON(readOnly) + `,
	  "requires_approval": ` + boolJSON(requiresApproval) + `,
	  "payload_schema_ref": "` + testPayloadSchemaRef + `",
	  "result_schema_ref": "` + testResultSchemaRef + `",
	  "handler": ` + handler + `,
	  "timeout_ms": 1000,
	  "result_projection_policy": "bounded_json"
	}`
}

func boolJSON(value bool) string {
	if value {
		return "true"
	}
	return "false"
}

func writeToolRegistryFixture(t *testing.T, body string) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), "tools.v6.json")
	if err := os.WriteFile(path, []byte(body), 0o600); err != nil {
		t.Fatalf("write fixture: %v", err)
	}
	return path
}

func sameStrings(left []string, right []string) bool {
	if len(left) != len(right) {
		return false
	}
	for i := range left {
		if left[i] != right[i] {
			return false
		}
	}
	return true
}
