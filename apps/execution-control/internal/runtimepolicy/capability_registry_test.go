package runtimepolicy

import "testing"

func TestLoadCapabilitySpecRegistryLoadsCurrentInventory(t *testing.T) {
	registry, err := LoadCapabilitySpecRegistry("")
	if err != nil {
		t.Fatalf("LoadCapabilitySpecRegistry default failed: %v", err)
	}

	if registry.SchemaVersion != CapabilitySpecSchemaVersion {
		t.Fatalf("schema_version = %q, want %q", registry.SchemaVersion, CapabilitySpecSchemaVersion)
	}
	if len(registry.Capabilities) != 4 {
		t.Fatalf("capabilities = %#v, want 4 current capabilities", registry.Capabilities)
	}
	if _, ok := registry.CapabilityByID("calendar"); ok {
		t.Fatal("calendar must not be active in CapabilitySpec")
	}
	notice, ok := registry.CapabilityByID("notice")
	if !ok {
		t.Fatal("notice missing from CapabilitySpec")
	}
	if notice.WorkerRole != "activity-worker-notice" {
		t.Fatalf("notice worker_role = %q, want activity-worker-notice", notice.WorkerRole)
	}
	if len(notice.AllowedStructuredTools) != 2 ||
		notice.AllowedStructuredTools[0] != "campus_notice_discover" ||
		notice.AllowedStructuredTools[1] != "campus_notice_change_set_lookup" {
		t.Fatalf(
			"notice structured tools = %#v, want campus_notice_discover and campus_notice_change_set_lookup",
			notice.AllowedStructuredTools,
		)
	}
	campusServices, ok := registry.CapabilityByID("campus_services")
	if !ok {
		t.Fatal("campus_services missing from CapabilitySpec")
	}
	if !campusServices.Active || campusServices.WorkerRole != "activity-worker-campus-services" {
		t.Fatalf("campus services capability = %#v, want active campus_services worker", campusServices)
	}
	if !containsString(campusServices.AllowedStructuredTools, "academic_calendar_lookup") {
		t.Fatalf(
			"campus services structured tools = %#v, want academic_calendar_lookup",
			campusServices.AllowedStructuredTools,
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
