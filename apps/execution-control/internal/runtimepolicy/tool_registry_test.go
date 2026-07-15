package runtimepolicy

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

const (
	transportPayloadSchemaRef = "https://muc.wiki/campus-agent/schemas/campus-services-tool-contracts.v1.schema.json#/$defs/TransportScheduleLookupPayload"
	transportResultSchemaRef  = "https://muc.wiki/campus-agent/schemas/campus-services-tool-contracts.v1.schema.json#/$defs/TransportScheduleLookupResult"
	knowledgePayloadSchemaRef = "https://muc.wiki/campus-agent/schemas/knowledge-tool-contracts.v2.schema.json#/$defs/KnowledgeQueryPayload"
	knowledgeResultSchemaRef  = "https://muc.wiki/campus-agent/schemas/knowledge-tool-contracts.v2.schema.json#/$defs/KnowledgeAgentTerminalResult"
)

func TestLoadToolSpecRegistryLoadsDefaultToolInventory(t *testing.T) {
	registry, err := LoadToolSpecRegistry("")
	if err != nil {
		t.Fatalf("LoadToolSpecRegistry default failed: %v", err)
	}

	if registry.SchemaVersion != ToolRegistrySchemaVersion {
		t.Fatalf("schema_version = %q, want %q", registry.SchemaVersion, ToolRegistrySchemaVersion)
	}
	wantVisible := []string{
		"transport_schedule_lookup",
		"knowledge_query",
	}
	if got := registry.ModelVisibleToolNames(); !sameStrings(got, wantVisible) {
		t.Fatalf("model-visible tools = %#v, want %#v", got, wantVisible)
	}
	if got := registry.ToolNamesByHandlerEndpoint("/internal/query/campus-services/transport-schedule"); !sameStrings(got, []string{"transport_schedule_lookup"}) {
		t.Fatalf("transport endpoint tools = %#v, want transport_schedule_lookup", got)
	}
	if _, ok := registry.ToolByName("retrieval.query"); ok {
		t.Fatal("retrieval.query must not be registered as a tool")
	}
	knowledgeTool, ok := registry.ModelVisibleToolByName("knowledge_query")
	if !ok {
		t.Fatal("knowledge_query must be model-visible")
	}
	if knowledgeTool.Handler.Type != "agent_handoff" ||
		knowledgeTool.Handler.Target != "knowledge_agent" ||
		knowledgeTool.Handler.Endpoint != "" {
		t.Fatalf("knowledge_query handler = %#v, want handoff without endpoint", knowledgeTool.Handler)
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
		  "schema_version": "tool-registry-v5",
		  "registry_version": "test",
		  "tools": [`+validToolJSON("transport_schedule_lookup", "model_visible", true, false, "execution_control_internal_query", "/internal/query/campus-services/transport-schedule")+`,
		            `+validToolJSON("transport_schedule_lookup", "model_visible", true, false, "execution_control_internal_query", "/internal/query/campus-services/transport-schedule")+`]
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
			  "schema_version": "tool-registry-v5",
			  "registry_version": "test",
			  "tools": [{
			    "name": "bad_tool",
			    "description": "bad tool",
			    "exposure": "model_visible",
			    "read_only": true,
			    "requires_approval": false,
			    "payload_schema_ref": "https://campus-agent.local/schemas/unregistered.v1.schema.json#/$defs/BadPayload",
			    "result_schema_ref": "` + transportResultSchemaRef + `",
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
			name: "handoff endpoint present",
			body: registryJSON(validKnowledgeHandoffToolJSON("knowledge_query", "/internal/query/knowledge")),
			want: "handler.endpoint must be empty for agent_handoff",
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

func validKnowledgeHandoffToolJSON(name string, endpoint string) string {
	handler := `{"type":"agent_handoff","target":"knowledge_agent"}`
	if endpoint != "" {
		handler = `{"type":"agent_handoff","target":"knowledge_agent","endpoint":"` + endpoint + `"}`
	}
	return `{
	  "name": "` + name + `",
	  "description": "Handoff campus knowledge questions to governed RAG.",
	  "exposure": "model_visible",
	  "read_only": true,
	  "requires_approval": false,
	  "payload_schema_ref": "` + knowledgePayloadSchemaRef + `",
	  "result_schema_ref": "` + knowledgeResultSchemaRef + `",
	  "handler": ` + handler + `,
	  "timeout_ms": 1000,
	  "result_projection_policy": "bounded_json"
	}`
}

func registryJSON(toolJSON string) string {
	return `{"schema_version":"tool-registry-v5","registry_version":"test","tools":[` + toolJSON + `]}`
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
	  "payload_schema_ref": "` + transportPayloadSchemaRef + `",
	  "result_schema_ref": "` + transportResultSchemaRef + `",
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
	path := filepath.Join(t.TempDir(), "tools.v5.json")
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
