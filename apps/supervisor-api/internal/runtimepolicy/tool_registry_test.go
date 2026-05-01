package runtimepolicy

import (
	"os"
	"path/filepath"
	"testing"
)

func TestLoadToolSpecRegistryLoadsDefaultStructuredTools(t *testing.T) {
	registry, err := LoadToolSpecRegistry("")
	if err != nil {
		t.Fatalf("LoadToolSpecRegistry default failed: %v", err)
	}

	if registry.SchemaVersion != ToolSpecSchemaVersion {
		t.Fatalf("schema_version = %q, want %q", registry.SchemaVersion, ToolSpecSchemaVersion)
	}
	want := []string{
		"service_status_lookup",
		"service_guide_lookup",
		"transport_schedule_lookup",
		"contact_directory_lookup",
	}
	if got := registry.AllowedToolsForTarget("campus-services-agent"); !sameStrings(got, want) {
		t.Fatalf("campus services tools = %#v, want %#v", got, want)
	}
	wantNotice := []string{"campus_notice_discover"}
	if got := registry.AllowedToolsForTarget("notice-agent"); !sameStrings(got, wantNotice) {
		t.Fatalf("notice tools = %#v, want %#v", got, wantNotice)
	}
	if got := registry.AllowedToolsForTarget("rag-agent"); len(got) != 0 {
		t.Fatalf("rag-agent structured tools = %#v, want none", got)
	}
	noticeGet, ok := registry.ToolByName("campus_notice_get")
	if !ok {
		t.Fatal("campus_notice_get missing from ToolSpec")
	}
	if !noticeGet.Active ||
		noticeGet.Surface != "agent_internal" ||
		noticeGet.FunctionSchema.Available ||
		noticeGet.RuntimePosture != "closed" {
		t.Fatalf(
			"campus_notice_get active/surface/function/runtime posture = %v/%q/%#v/%q, want active agent_internal unavailable closed",
			noticeGet.Active,
			noticeGet.Surface,
			noticeGet.FunctionSchema,
			noticeGet.RuntimePosture,
		)
	}
	serviceStatus, ok := registry.ToolByName("service_status_lookup")
	if !ok {
		t.Fatal("service_status_lookup missing from ToolSpec")
	}
	if !serviceStatus.FunctionSchema.Available || serviceStatus.RuntimePosture != "typed_handoff_only" {
		t.Fatalf(
			"service_status_lookup function/runtime posture = %#v/%q, want available typed_handoff_only",
			serviceStatus.FunctionSchema,
			serviceStatus.RuntimePosture,
		)
	}
}

func TestRuntimePolicyAllowedToolsMatchDefaultToolSpec(t *testing.T) {
	registry, err := LoadToolSpecRegistry("")
	if err != nil {
		t.Fatalf("LoadToolSpecRegistry default failed: %v", err)
	}
	for _, target := range []string{
		"rag-agent",
		"navigation-agent",
		"campus-services-agent",
		"notice-agent",
	} {
		if got, want := AllowedToolsForTarget(target), registry.AllowedToolsForTarget(target); !sameStrings(got, want) {
			t.Fatalf("%s allowed tools = %#v, want ToolSpec %#v", target, got, want)
		}
	}
}

func TestToolSpecRegistryValidationRejectsDuplicateTools(t *testing.T) {
	path := writeToolRegistryFixture(
		t,
		`{
		  "schema_version": "tool-spec-registry-v1",
		  "registry_version": "test",
		  "tools": [
		    {
		      "name": "service_status_lookup",
		      "owner_agent": "campus-services-agent",
		      "capability": "campus_services",
		      "payload_kind": "service_status_lookup",
		      "payload_schema_ref": "campus_contracts.models_tools.ServiceStatusLookupPayload",
		      "result_schema_ref": "campus_contracts.models_tools.ServiceStatusLookupResult",
		      "backend": "internal_structured_query_service",
		      "surface": "structured_handoff",
		      "read_only": true,
		      "active": true,
		      "provider_schema": {"enabled": true, "strict": true}
		    },
		    {
		      "name": "service_status_lookup",
		      "owner_agent": "campus-services-agent",
		      "capability": "campus_services",
		      "payload_kind": "service_status_lookup",
		      "payload_schema_ref": "campus_contracts.models_tools.ServiceStatusLookupPayload",
		      "result_schema_ref": "campus_contracts.models_tools.ServiceStatusLookupResult",
		      "backend": "internal_structured_query_service",
		      "surface": "structured_handoff",
		      "read_only": true,
		      "active": true,
		      "provider_schema": {"enabled": true, "strict": true}
		    }
		  ]
		}`,
	)

	if _, err := LoadToolSpecRegistry(path); err == nil {
		t.Fatal("LoadToolSpecRegistry accepted duplicate tool names")
	}
}

func TestToolSpecRegistryValidationRejectsUnsupportedOwnerAndMutableTools(t *testing.T) {
	tests := []struct {
		name string
		body string
	}{
		{
			name: "unsupported owner",
			body: `{
			  "schema_version": "tool-spec-registry-v1",
			  "registry_version": "test",
			  "tools": [{
			    "name": "bad_tool",
			    "owner_agent": "external-agent",
			    "capability": "campus_services",
			    "payload_kind": "bad_tool",
			    "payload_schema_ref": "x.Payload",
			    "result_schema_ref": "x.Result",
			    "backend": "internal_structured_query_service",
			    "surface": "structured_handoff",
			    "read_only": true,
			    "active": true,
			    "provider_schema": {"enabled": false, "strict": true}
			  }]
			}`,
		},
		{
			name: "mutable active tool",
			body: `{
			  "schema_version": "tool-spec-registry-v1",
			  "registry_version": "test",
			  "tools": [{
			    "name": "bad_tool",
			    "owner_agent": "campus-services-agent",
			    "capability": "campus_services",
			    "payload_kind": "bad_tool",
			    "payload_schema_ref": "x.Payload",
			    "result_schema_ref": "x.Result",
			    "backend": "internal_structured_query_service",
			    "surface": "structured_handoff",
			    "read_only": false,
			    "active": true,
			    "provider_schema": {"enabled": false, "strict": true}
			  }]
			}`,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if _, err := LoadToolSpecRegistry(writeToolRegistryFixture(t, tt.body)); err == nil {
				t.Fatalf("LoadToolSpecRegistry accepted %s", tt.name)
			}
		})
	}
}

func TestToolSpecRegistryValidationRequiresStructuredHandoffPayloadMatch(t *testing.T) {
	path := writeToolRegistryFixture(
		t,
		`{
		  "schema_version": "tool-spec-registry-v1",
		  "registry_version": "test",
		  "tools": [{
		    "name": "service_status_lookup",
		    "owner_agent": "campus-services-agent",
		    "capability": "campus_services",
		    "payload_kind": "transport_schedule_lookup",
		    "payload_schema_ref": "campus_contracts.models_tools.ServiceStatusLookupPayload",
		    "result_schema_ref": "campus_contracts.models_tools.ServiceStatusLookupResult",
		    "backend": "internal_structured_query_service",
		    "surface": "structured_handoff",
		    "read_only": true,
		    "active": true,
		    "provider_schema": {"enabled": true, "strict": true}
		  }]
		}`,
	)

	if _, err := LoadToolSpecRegistry(path); err == nil {
		t.Fatal("LoadToolSpecRegistry accepted structured tool with mismatched payload_kind")
	}
}

func writeToolRegistryFixture(t *testing.T, body string) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), "tools.v1.json")
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
