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
		"academic_calendar_lookup",
	}
	if got := registry.AllowedToolsForCapability("campus_services"); !sameStrings(got, want) {
		t.Fatalf("campus services tools = %#v, want %#v", got, want)
	}
	wantNotice := []string{
		"campus_notice_change_set_lookup",
		"campus_notice_discover",
		"campus_notice_period_summary",
	}
	if got := registry.AllowedToolsForCapability("notice"); !sameStrings(got, wantNotice) {
		t.Fatalf("notice tools = %#v, want %#v", got, wantNotice)
	}
	if got := registry.AllowedToolsForCapability("knowledge"); len(got) != 0 {
		t.Fatalf("knowledge structured tools = %#v, want none", got)
	}
	retrieveEvidence, ok := registry.ToolByName("retrieve_evidence")
	if !ok {
		t.Fatal("retrieve_evidence missing from ToolSpec")
	}
	if !retrieveEvidence.Active ||
		retrieveEvidence.Surface != "capability_internal" ||
		!retrieveEvidence.FunctionSchema.Available ||
		!retrieveEvidence.FunctionSchema.Strict ||
		retrieveEvidence.RuntimePosture != "capability_internal_admitted" {
		t.Fatalf(
			"retrieve_evidence active/surface/function/runtime posture = %v/%q/%#v/%q, want active capability_internal strict capability_internal_admitted",
			retrieveEvidence.Active,
			retrieveEvidence.Surface,
			retrieveEvidence.FunctionSchema,
			retrieveEvidence.RuntimePosture,
		)
	}
	if got := registry.AllowedToolsForCapability("calendar"); len(got) != 0 {
		t.Fatalf("calendar tools = %#v, want none", got)
	}
	noticeGet, ok := registry.ToolByName("campus_notice_get")
	if !ok {
		t.Fatal("campus_notice_get missing from ToolSpec")
	}
	if !noticeGet.Active ||
		noticeGet.Surface != "capability_internal" ||
		noticeGet.FunctionSchema.Available ||
		noticeGet.RuntimePosture != "internal_function" {
		t.Fatalf(
			"campus_notice_get active/surface/function/runtime posture = %v/%q/%#v/%q, want active capability_internal unavailable internal_function",
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
	if !serviceStatus.FunctionSchema.Available || serviceStatus.RuntimePosture != "typed_activity_admitted" {
		t.Fatalf(
			"service_status_lookup function/runtime posture = %#v/%q, want available typed_activity_admitted",
			serviceStatus.FunctionSchema,
			serviceStatus.RuntimePosture,
		)
	}
	serviceGuide, ok := registry.ToolByName("service_guide_lookup")
	if !ok {
		t.Fatal("service_guide_lookup missing from ToolSpec")
	}
	if !serviceGuide.FunctionSchema.Available || serviceGuide.RuntimePosture != "typed_activity_admitted" {
		t.Fatalf(
			"service_guide_lookup function/runtime posture = %#v/%q, want available typed_activity_admitted",
			serviceGuide.FunctionSchema,
			serviceGuide.RuntimePosture,
		)
	}
	transport, ok := registry.ToolByName("transport_schedule_lookup")
	if !ok {
		t.Fatal("transport_schedule_lookup missing from ToolSpec")
	}
	if !transport.FunctionSchema.Available || transport.RuntimePosture != "typed_activity_admitted" {
		t.Fatalf(
			"transport_schedule_lookup function/runtime posture = %#v/%q, want available typed_activity_admitted",
			transport.FunctionSchema,
			transport.RuntimePosture,
		)
	}
	contact, ok := registry.ToolByName("contact_directory_lookup")
	if !ok {
		t.Fatal("contact_directory_lookup missing from ToolSpec")
	}
	if !contact.FunctionSchema.Available || contact.RuntimePosture != "typed_activity_admitted" {
		t.Fatalf(
			"contact_directory_lookup function/runtime posture = %#v/%q, want available typed_activity_admitted",
			contact.FunctionSchema,
			contact.RuntimePosture,
		)
	}
	calendar, ok := registry.ToolByName("academic_calendar_lookup")
	if !ok {
		t.Fatal("academic_calendar_lookup missing from ToolSpec")
	}
	if !calendar.FunctionSchema.Available || calendar.RuntimePosture != "typed_activity_admitted" {
		t.Fatalf(
			"academic_calendar_lookup function/runtime posture = %#v/%q, want available typed_activity_admitted",
			calendar.FunctionSchema,
			calendar.RuntimePosture,
		)
	}
	if calendar.OwnerCapability != "campus_services" || calendar.Capability != "campus_services" {
		t.Fatalf(
			"academic_calendar_lookup owner/capability = %q/%q, want campus_services/campus_services",
			calendar.OwnerCapability,
			calendar.Capability,
		)
	}
	noticeDiscover, ok := registry.ToolByName("campus_notice_discover")
	if !ok {
		t.Fatal("campus_notice_discover missing from ToolSpec")
	}
	if !noticeDiscover.FunctionSchema.Available || noticeDiscover.RuntimePosture != "typed_activity_admitted" {
		t.Fatalf(
			"campus_notice_discover function/runtime posture = %#v/%q, want available typed_activity_admitted",
			noticeDiscover.FunctionSchema,
			noticeDiscover.RuntimePosture,
		)
	}
	noticePeriodSummary, ok := registry.ToolByName("campus_notice_period_summary")
	if !ok {
		t.Fatal("campus_notice_period_summary missing from ToolSpec")
	}
	if !noticePeriodSummary.FunctionSchema.Available ||
		noticePeriodSummary.RuntimePosture != "typed_activity_admitted" {
		t.Fatalf(
			"campus_notice_period_summary function/runtime posture = %#v/%q, want available typed_activity_admitted",
			noticePeriodSummary.FunctionSchema,
			noticePeriodSummary.RuntimePosture,
		)
	}
}

func TestRuntimePolicyAllowedToolsMatchDefaultToolSpec(t *testing.T) {
	registry, err := LoadToolSpecRegistry("")
	if err != nil {
		t.Fatalf("LoadToolSpecRegistry default failed: %v", err)
	}
	for _, target := range []string{
		"knowledge",
		"navigation",
		"campus_services",
		"notice",
	} {
		if got, want := AllowedToolsForCapability(target), registry.AllowedToolsForCapability(target); !sameStrings(got, want) {
			t.Fatalf("%s allowed tools = %#v, want ToolSpec %#v", target, got, want)
		}
	}
}

func TestToolSpecRegistryValidationRejectsDuplicateTools(t *testing.T) {
	path := writeToolRegistryFixture(
		t,
		`{
		  "schema_version": "tool-spec-registry-v3",
		  "registry_version": "test",
		  "tools": [
		    {
		      "name": "service_status_lookup",
		      "owner_capability": "campus_services",
		      "capability": "campus_services",
		      "payload_kind": "service_status_lookup",
		      "payload_schema_ref": "campus_contracts.models_tools.ServiceStatusLookupPayload",
		      "result_schema_ref": "campus_contracts.models_tools.ServiceStatusLookupResult",
		      "backend": "internal_structured_query_service",
		      "surface": "structured_handoff",
		      "read_only": true,
		      "active": true,
		      "function_schema": {"available": true, "strict": true},
		      "runtime_posture": "typed_activity_admitted",
		      "description": "Lookup current or temporally qualified campus service status."
		    },
		    {
		      "name": "service_status_lookup",
		      "owner_capability": "campus_services",
		      "capability": "campus_services",
		      "payload_kind": "service_status_lookup",
		      "payload_schema_ref": "campus_contracts.models_tools.ServiceStatusLookupPayload",
		      "result_schema_ref": "campus_contracts.models_tools.ServiceStatusLookupResult",
		      "backend": "internal_structured_query_service",
		      "surface": "structured_handoff",
		      "read_only": true,
		      "active": true,
		      "function_schema": {"available": true, "strict": true},
		      "runtime_posture": "typed_activity_admitted",
		      "description": "Lookup current or temporally qualified campus service status."
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
			  "schema_version": "tool-spec-registry-v3",
			  "registry_version": "test",
			  "tools": [{
			    "name": "bad_tool",
			    "owner_capability": "external",
			    "capability": "campus_services",
			    "payload_kind": "bad_tool",
			    "payload_schema_ref": "x.Payload",
			    "result_schema_ref": "x.Result",
			    "backend": "internal_structured_query_service",
			    "surface": "structured_handoff",
			    "read_only": true,
			    "active": true,
			    "function_schema": {"available": false, "strict": true},
			    "runtime_posture": "typed_handoff_only",
			    "description": "bad tool"
			  }]
			}`,
		},
		{
			name: "mutable active tool",
			body: `{
			  "schema_version": "tool-spec-registry-v3",
			  "registry_version": "test",
			  "tools": [{
			    "name": "bad_tool",
			    "owner_capability": "campus_services",
			    "capability": "campus_services",
			    "payload_kind": "bad_tool",
			    "payload_schema_ref": "x.Payload",
			    "result_schema_ref": "x.Result",
			    "backend": "internal_structured_query_service",
			    "surface": "structured_handoff",
			    "read_only": false,
			    "active": true,
			    "function_schema": {"available": false, "strict": true},
			    "runtime_posture": "typed_handoff_only",
			    "description": "bad tool"
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
		  "schema_version": "tool-spec-registry-v3",
		  "registry_version": "test",
		  "tools": [{
		    "name": "service_status_lookup",
		    "owner_capability": "campus_services",
		    "capability": "campus_services",
		    "payload_kind": "transport_schedule_lookup",
		    "payload_schema_ref": "campus_contracts.models_tools.ServiceStatusLookupPayload",
		    "result_schema_ref": "campus_contracts.models_tools.ServiceStatusLookupResult",
		    "backend": "internal_structured_query_service",
		    "surface": "structured_handoff",
		    "read_only": true,
		    "active": true,
		    "function_schema": {"available": true, "strict": true},
		    "runtime_posture": "typed_activity_admitted",
		    "description": "Lookup current or temporally qualified campus service status."
		  }]
		}`,
	)

	if _, err := LoadToolSpecRegistry(path); err == nil {
		t.Fatal("LoadToolSpecRegistry accepted structured tool with mismatched payload_kind")
	}
}

func TestToolSpecRegistryValidationRejectsLegacySdkAdapterCandidatePosture(t *testing.T) {
	path := writeToolRegistryFixture(
		t,
		`{
		  "schema_version": "tool-spec-registry-v3",
		  "registry_version": "test",
		  "tools": [{
		    "name": "service_status_lookup",
		    "owner_capability": "campus_services",
		    "capability": "campus_services",
		    "payload_kind": "service_status_lookup",
		    "payload_schema_ref": "campus_contracts.models_tools.ServiceStatusLookupPayload",
		    "result_schema_ref": "campus_contracts.models_tools.ServiceStatusLookupResult",
		    "backend": "internal_structured_query_service",
		    "surface": "structured_handoff",
		    "read_only": true,
		    "active": true,
		    "function_schema": {"available": true, "strict": true},
		    "runtime_posture": "sdk_adapter_candidate",
		    "description": "Lookup current or temporally qualified campus service status."
		  }]
		}`,
	)

	if _, err := LoadToolSpecRegistry(path); err == nil {
		t.Fatal("LoadToolSpecRegistry accepted legacy sdk_adapter_candidate runtime posture")
	}
}

func writeToolRegistryFixture(t *testing.T, body string) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), "tools.v3.json")
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
