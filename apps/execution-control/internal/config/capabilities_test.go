package config

import "testing"

func TestLoadFromEnvRejectsWildcardOpenCapabilities(t *testing.T) {
	for _, value := range []string{"*", "all", "campus_services,all"} {
		t.Run(value, func(t *testing.T) {
			t.Setenv("EXECUTION_CONTROL_OPEN_CAPABILITIES", value)

			_, err := LoadFromEnv()
			if err == nil {
				t.Fatalf("expected EXECUTION_CONTROL_OPEN_CAPABILITIES=%q to fail", value)
			}
		})
	}
}

func TestLoadFromEnvRejectsUnknownOpenCapabilities(t *testing.T) {
	for _, value := range []string{"campus_services,unknown_capability", "academic_calendar"} {
		t.Run(value, func(t *testing.T) {
			t.Setenv("EXECUTION_CONTROL_OPEN_CAPABILITIES", value)

			_, err := LoadFromEnv()
			if err == nil {
				t.Fatalf("expected EXECUTION_CONTROL_OPEN_CAPABILITIES=%q to fail", value)
			}
		})
	}
}

func TestLoadFromEnvAcceptsNavigationOpenCapability(t *testing.T) {
	setRuntimeConfigProfile(t, `{
  "schema_version": "campus_execution_control_runtime_profile.v1",
  "open_capabilities": ["navigation"]
}`)

	cfg, err := LoadFromEnv()
	if err != nil {
		t.Fatalf("LoadFromEnv returned error: %v", err)
	}

	if len(cfg.OpenCapabilities) != 1 || cfg.OpenCapabilities[0] != "navigation" {
		t.Fatalf("open capabilities = %#v, want navigation", cfg.OpenCapabilities)
	}
}

func TestCapabilityOpenDoesNotTreatWildcardAsRuntimeAllow(t *testing.T) {
	cfg := Config{OpenCapabilities: []string{"*"}}

	if cfg.CapabilityOpen("notice") {
		t.Fatal("wildcard open capability must not open notice")
	}
}

func TestCapabilityOpenDoesNotOpenPlaceLookupBeforeMapRollout(t *testing.T) {
	cfg := Config{}

	if cfg.CapabilityOpen("place_lookup") {
		t.Fatal("place_lookup must remain closed until map rollout")
	}
}
