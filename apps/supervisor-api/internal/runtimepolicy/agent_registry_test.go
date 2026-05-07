package runtimepolicy

import "testing"

func TestLoadAgentSpecRegistryLoadsCurrentInventory(t *testing.T) {
	registry, err := LoadAgentSpecRegistry("")
	if err != nil {
		t.Fatalf("LoadAgentSpecRegistry default failed: %v", err)
	}

	if registry.SchemaVersion != AgentSpecSchemaVersion {
		t.Fatalf("schema_version = %q, want %q", registry.SchemaVersion, AgentSpecSchemaVersion)
	}
	if len(registry.Agents) != 4 {
		t.Fatalf("agents = %#v, want 4 current agents", registry.Agents)
	}
	if _, ok := registry.AgentByID("calendar-agent"); ok {
		t.Fatal("calendar-agent must not be active in AgentSpec")
	}
	notice, ok := registry.AgentByID("notice-agent")
	if !ok {
		t.Fatal("notice-agent missing from AgentSpec")
	}
	if len(notice.AllowedStructuredHandoffTools) != 1 || notice.AllowedStructuredHandoffTools[0] != "campus_notice_discover" {
		t.Fatalf("notice structured tools = %#v, want campus_notice_discover only", notice.AllowedStructuredHandoffTools)
	}
	campusServices, ok := registry.AgentByID("campus-services-agent")
	if !ok {
		t.Fatal("campus-services-agent missing from AgentSpec")
	}
	if !campusServices.Active || campusServices.Capability != "campus_services" {
		t.Fatalf("campus services agent = %#v, want active campus_services agent", campusServices)
	}
	if !containsString(campusServices.AllowedStructuredHandoffTools, "academic_calendar_lookup") {
		t.Fatalf(
			"campus services structured tools = %#v, want academic_calendar_lookup",
			campusServices.AllowedStructuredHandoffTools,
		)
	}
}

func containsString(values []string, target string) bool {
	for _, value := range values {
		if value == target {
			return true
		}
	}
	return false
}
