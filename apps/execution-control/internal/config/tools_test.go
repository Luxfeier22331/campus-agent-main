package config

import "testing"

func TestLoadFromEnvRejectsRetiredOpenToolsEnv(t *testing.T) {
	t.Setenv("EXECUTION_CONTROL_OPEN_TOOLS", "transport_schedule_lookup")

	_, err := LoadFromEnv()
	if err == nil {
		t.Fatal("expected EXECUTION_CONTROL_OPEN_TOOLS to fail")
	}
}

func TestLoadFromEnvRejectsWildcardOpenTools(t *testing.T) {
	for _, value := range []string{"*", "all", "campus_services,all"} {
		t.Run(value, func(t *testing.T) {
			setRuntimeConfigProfile(t, `{
  "schema_version": "campus_execution_control_runtime_profile.v1",
  "open_tools": ["`+value+`"]
}`)

			_, err := LoadFromEnv()
			if err == nil {
				t.Fatalf("expected open_tools=%q to fail", value)
			}
		})
	}
}

func TestLoadFromEnvRejectsUnknownOpenTools(t *testing.T) {
	for _, value := range []string{"campus_services,unknown_tool", "academic_calendar"} {
		t.Run(value, func(t *testing.T) {
			setRuntimeConfigProfile(t, `{
  "schema_version": "campus_execution_control_runtime_profile.v1",
  "open_tools": ["`+value+`"]
}`)

			_, err := LoadFromEnv()
			if err == nil {
				t.Fatalf("expected open_tools=%q to fail", value)
			}
		})
	}
}

func TestLoadFromEnvAcceptsOpenTool(t *testing.T) {
	setRuntimeConfigProfile(t, `{
  "schema_version": "campus_execution_control_runtime_profile.v1",
  "open_tools": ["transport_schedule_lookup"]
}`)

	cfg, err := LoadFromEnv()
	if err != nil {
		t.Fatalf("LoadFromEnv returned error: %v", err)
	}

	if len(cfg.OpenTools) != 1 || cfg.OpenTools[0] != "transport_schedule_lookup" {
		t.Fatalf("open tools = %#v, want transport_schedule_lookup", cfg.OpenTools)
	}
}

func TestToolOpenDoesNotTreatWildcardAsRuntimeAllow(t *testing.T) {
	cfg := Config{OpenTools: []string{"*"}}

	if cfg.ToolOpen("campus_notice_discover") {
		t.Fatal("wildcard open tool must not open campus_notice_discover")
	}
}

func TestToolOpenDoesNotOpenPlaceLookupBeforeMapRollout(t *testing.T) {
	cfg := Config{}

	if cfg.ToolOpen("place_lookup") {
		t.Fatal("place_lookup must remain closed until map rollout")
	}
}
