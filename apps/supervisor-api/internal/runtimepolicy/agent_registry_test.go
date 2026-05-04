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
	notice, ok := registry.AgentByID("notice-agent")
	if !ok {
		t.Fatal("notice-agent missing from AgentSpec")
	}
	if len(notice.AllowedStructuredHandoffTools) != 1 || notice.AllowedStructuredHandoffTools[0] != "campus_notice_discover" {
		t.Fatalf("notice structured tools = %#v, want campus_notice_discover only", notice.AllowedStructuredHandoffTools)
	}
}
