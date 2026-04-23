package config

import "testing"

func TestFromEnvUsesSupervisorDefaults(t *testing.T) {
	t.Setenv("API_AUTH_MODE", "")
	t.Setenv("API_DEFAULT_ACTOR_ID", "")
	t.Setenv("API_DEFAULT_ACTOR_ROLES", "")
	t.Setenv("SUPERVISOR_PY_BRIDGE_BASE_URL", "")
	t.Setenv("SUPERVISOR_PY_BRIDGE_SHARED_SECRET", "")
	t.Setenv("CAMPUS_AGENT_HTTP_HOST", "")
	t.Setenv("CAMPUS_AGENT_HTTP_PORT", "")
	t.Setenv("SUPERVISOR_API_MAX_CONCURRENT_ANSWERS", "")
	t.Setenv("SUPERVISOR_API_REQUEST_BODY_LIMIT_BYTES", "")
	t.Setenv("SUPERVISOR_PY_BRIDGE_TIMEOUT_MS", "")

	cfg := FromEnv()

	if cfg.Host != "127.0.0.1" {
		t.Fatalf("host = %q, want 127.0.0.1", cfg.Host)
	}
	if cfg.Port != 8000 {
		t.Fatalf("port = %d, want 8000", cfg.Port)
	}
	if cfg.AuthMode != "bearer" {
		t.Fatalf("auth mode = %q, want bearer", cfg.AuthMode)
	}
	if cfg.DefaultActorID != "" {
		t.Fatalf("default actor id = %q, want empty", cfg.DefaultActorID)
	}
	if cfg.BridgeBaseURL != "" {
		t.Fatalf("bridge base url = %q, want empty", cfg.BridgeBaseURL)
	}
	if cfg.BridgeSharedSecret != "" {
		t.Fatalf("bridge shared secret = %q, want empty", cfg.BridgeSharedSecret)
	}
	if cfg.MaxConcurrentAnswers != 8 {
		t.Fatalf("max concurrent answers = %d, want 8", cfg.MaxConcurrentAnswers)
	}
	if cfg.RequestBodyLimitBytes != 1_048_576 {
		t.Fatalf("body limit = %d, want 1048576", cfg.RequestBodyLimitBytes)
	}
	if cfg.BridgeTimeoutMS != 35_000 {
		t.Fatalf("bridge timeout = %d, want 35000", cfg.BridgeTimeoutMS)
	}
}
