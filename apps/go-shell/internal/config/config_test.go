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
	t.Setenv("SUPERVISOR_API_QUEUE_CAPACITY", "")
	t.Setenv("SUPERVISOR_API_QUEUE_TIMEOUT_MS", "")
	t.Setenv("SUPERVISOR_API_REQUEST_TIMEOUT_MS", "")
	t.Setenv("SUPERVISOR_API_REQUEST_BODY_LIMIT_BYTES", "")
	t.Setenv("SUPERVISOR_API_SHUTDOWN_GRACE_MS", "")
	t.Setenv("SUPERVISOR_API_METRICS_BEARER_TOKEN", "")
	t.Setenv("SUPERVISOR_PY_BRIDGE_TIMEOUT_MS", "")

	cfg, err := LoadFromEnv()
	if err != nil {
		t.Fatalf("LoadFromEnv returned error: %v", err)
	}

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
	if cfg.QueueCapacity != 24 {
		t.Fatalf("queue capacity = %d, want 24", cfg.QueueCapacity)
	}
	if cfg.QueueTimeoutMS != 3_000 {
		t.Fatalf("queue timeout = %d, want 3000", cfg.QueueTimeoutMS)
	}
	if cfg.RequestTimeoutMS != 45_000 {
		t.Fatalf("request timeout = %d, want 45000", cfg.RequestTimeoutMS)
	}
	if cfg.RequestBodyLimitBytes != 1_048_576 {
		t.Fatalf("body limit = %d, want 1048576", cfg.RequestBodyLimitBytes)
	}
	if cfg.BridgeTimeoutMS != 35_000 {
		t.Fatalf("bridge timeout = %d, want 35000", cfg.BridgeTimeoutMS)
	}
	if cfg.ShutdownGraceMS != 45_000 {
		t.Fatalf("shutdown grace = %d, want 45000", cfg.ShutdownGraceMS)
	}
	if cfg.MetricsBearerToken != "" {
		t.Fatalf("metrics bearer token = %q, want empty", cfg.MetricsBearerToken)
	}
}

func TestLoadFromEnvRejectsInvalidPositiveIntegers(t *testing.T) {
	t.Setenv("SUPERVISOR_API_QUEUE_CAPACITY", "not-a-number")

	_, err := LoadFromEnv()
	if err == nil {
		t.Fatal("expected LoadFromEnv to reject invalid queue capacity")
	}
}

func TestLoadFromEnvAcceptsExplicitHardeningSettings(t *testing.T) {
	t.Setenv("SUPERVISOR_API_MAX_CONCURRENT_ANSWERS", "4")
	t.Setenv("SUPERVISOR_API_QUEUE_CAPACITY", "12")
	t.Setenv("SUPERVISOR_API_QUEUE_TIMEOUT_MS", "2500")
	t.Setenv("SUPERVISOR_API_REQUEST_TIMEOUT_MS", "30000")
	t.Setenv("SUPERVISOR_PY_BRIDGE_TIMEOUT_MS", "25000")
	t.Setenv("SUPERVISOR_API_SHUTDOWN_GRACE_MS", "20000")
	t.Setenv("SUPERVISOR_API_METRICS_BEARER_TOKEN", "metrics-token")

	cfg, err := LoadFromEnv()
	if err != nil {
		t.Fatalf("LoadFromEnv returned error: %v", err)
	}

	if cfg.MaxConcurrentAnswers != 4 ||
		cfg.QueueCapacity != 12 ||
		cfg.QueueTimeoutMS != 2500 ||
		cfg.RequestTimeoutMS != 30000 ||
		cfg.BridgeTimeoutMS != 25000 ||
		cfg.ShutdownGraceMS != 20000 ||
		cfg.MetricsBearerToken != "metrics-token" {
		t.Fatalf("unexpected config: %#v", cfg)
	}
}
