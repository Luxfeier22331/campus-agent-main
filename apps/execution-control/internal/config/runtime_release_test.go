package config

import (
	"strings"
	"testing"
)

func TestLoadFromEnvFailsClosedWhenOTelEnabledWithoutRuntimeRelease(t *testing.T) {
	setRuntimeConfigProfile(t, `{
  "schema_version": "campus_execution_control_runtime_profile.v1",
  "otel": {
    "enabled": true
  }
}`)
	t.Setenv("EXECUTION_CONTROL_RUNTIME_RELEASE", "")

	_, err := LoadFromEnv()
	if err == nil {
		t.Fatal("expected OTel-enabled runtime without release identity to fail")
	}
	if !strings.Contains(err.Error(), "EXECUTION_CONTROL_RUNTIME_RELEASE is required when runtime profile otel.enabled=true") {
		t.Fatalf("error = %q, want runtime release diagnostic", err.Error())
	}
}

func TestLoadFromEnvFailsClosedWhenTemporalTracingEnabledWithoutOTel(t *testing.T) {
	setRuntimeConfigProfile(t, `{
  "schema_version": "campus_execution_control_runtime_profile.v1",
  "otel": {
    "enabled": false,
    "temporal_tracing_enabled": true
  }
}`)

	_, err := LoadFromEnv()
	if err == nil {
		t.Fatal("expected Temporal tracing without OTel runtime to fail")
	}
	if !strings.Contains(err.Error(), "runtime profile otel.enabled=true is required when otel.temporal_tracing_enabled=true") {
		t.Fatalf("error = %q, want Temporal tracing diagnostic", err.Error())
	}
}
