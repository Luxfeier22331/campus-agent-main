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
	if len(registry.Agents) != 5 {
		t.Fatalf("agents = %#v, want 5 current agents", registry.Agents)
	}
	notice, ok := registry.AgentByID("notice-agent")
	if !ok {
		t.Fatal("notice-agent missing from AgentSpec")
	}
	if len(notice.AllowedStructuredHandoffTools) != 1 || notice.AllowedStructuredHandoffTools[0] != "campus_notice_discover" {
		t.Fatalf("notice structured tools = %#v, want campus_notice_discover only", notice.AllowedStructuredHandoffTools)
	}
	calendar, ok := registry.AgentByID("calendar-agent")
	if !ok {
		t.Fatal("calendar-agent missing from AgentSpec")
	}
	if !calendar.Active || calendar.Capability != "academic_calendar" {
		t.Fatalf("calendar agent = %#v, want active academic_calendar agent", calendar)
	}
	if len(calendar.AllowedStructuredHandoffTools) != 1 || calendar.AllowedStructuredHandoffTools[0] != "academic_calendar_lookup" {
		t.Fatalf("calendar structured tools = %#v, want academic_calendar_lookup only", calendar.AllowedStructuredHandoffTools)
	}
}
