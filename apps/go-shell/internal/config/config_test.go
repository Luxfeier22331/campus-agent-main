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
	t.Setenv("SUPERVISOR_API_EXECUTION_AUDIT_ENABLED", "")
	t.Setenv("SUPERVISOR_API_EXECUTION_AUDIT_URL", "")
	t.Setenv("SUPERVISOR_API_EXECUTION_AUDIT_SHARED_SECRET", "")
	t.Setenv("SUPERVISOR_API_EXECUTION_AUDIT_TIMEOUT_MS", "")
	t.Setenv("SUPERVISOR_API_EXECUTION_AUDIT_QUEUE_CAPACITY", "")

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
	if cfg.LaneBudgets["rag"].MaxConcurrent != 8 ||
		cfg.LaneBudgets["rag"].QueueCapacity != 24 ||
		cfg.LaneBudgets["rag"].QueueTimeoutMS != 3_000 {
		t.Fatalf("unexpected default rag lane budget: %#v", cfg.LaneBudgets["rag"])
	}
	if cfg.OTelEnabled {
		t.Fatal("otel enabled = true, want false by default")
	}
	if cfg.OTelServiceName != "campus-go-shell" {
		t.Fatalf("otel service name = %q, want campus-go-shell", cfg.OTelServiceName)
	}
	if cfg.ExecutionAuditEnabled {
		t.Fatal("execution audit enabled = true, want false by default")
	}
	if cfg.ExecutionAuditTimeoutMS != 500 {
		t.Fatalf("execution audit timeout = %d, want 500", cfg.ExecutionAuditTimeoutMS)
	}
	if cfg.ExecutionAuditQueueCapacity != 128 {
		t.Fatalf("execution audit queue capacity = %d, want 128", cfg.ExecutionAuditQueueCapacity)
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
	t.Setenv("SUPERVISOR_API_LANE_RAG_MAX_CONCURRENT", "2")
	t.Setenv("SUPERVISOR_API_LANE_RAG_QUEUE_CAPACITY", "5")
	t.Setenv("SUPERVISOR_API_LANE_RAG_QUEUE_TIMEOUT_MS", "1500")
	t.Setenv("SUPERVISOR_API_OTEL_ENABLED", "true")
	t.Setenv("SUPERVISOR_API_OTEL_EXPORTER_OTLP_ENDPOINT", "http://collector:4318/v1/traces")
	t.Setenv("SUPERVISOR_API_OTEL_EXPORTER_OTLP_HEADERS", "authorization=Bearer test")
	t.Setenv("SUPERVISOR_API_OTEL_SERVICE_NAME", "custom-go-shell")
	t.Setenv("SUPERVISOR_API_OTEL_EXPORT_TIMEOUT_MS", "750")
	t.Setenv("SUPERVISOR_API_EXECUTION_AUDIT_ENABLED", "true")
	t.Setenv("SUPERVISOR_API_EXECUTION_AUDIT_URL", "http://app-api:8787/api/internal/execution/audit-events")
	t.Setenv("SUPERVISOR_API_EXECUTION_AUDIT_SHARED_SECRET", "audit-secret")
	t.Setenv("SUPERVISOR_API_EXECUTION_AUDIT_TIMEOUT_MS", "250")
	t.Setenv("SUPERVISOR_API_EXECUTION_AUDIT_QUEUE_CAPACITY", "16")

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
		cfg.MetricsBearerToken != "metrics-token" ||
		cfg.LaneBudgets["rag"].MaxConcurrent != 2 ||
		cfg.LaneBudgets["rag"].QueueCapacity != 5 ||
		cfg.LaneBudgets["rag"].QueueTimeoutMS != 1500 ||
		!cfg.OTelEnabled ||
		cfg.OTelEndpoint != "http://collector:4318/v1/traces" ||
		cfg.OTelHeaders != "authorization=Bearer test" ||
		cfg.OTelServiceName != "custom-go-shell" ||
		cfg.OTelExportTimeoutMS != 750 ||
		!cfg.ExecutionAuditEnabled ||
		cfg.ExecutionAuditURL != "http://app-api:8787/api/internal/execution/audit-events" ||
		cfg.ExecutionAuditSharedSecret != "audit-secret" ||
		cfg.ExecutionAuditTimeoutMS != 250 ||
		cfg.ExecutionAuditQueueCapacity != 16 {
		t.Fatalf("unexpected config: %#v", cfg)
	}
}

func TestLoadFromEnvRejectsInvalidLaneAndOTelSettings(t *testing.T) {
	t.Setenv("SUPERVISOR_API_LANE_RAG_QUEUE_CAPACITY", "-1")

	_, err := LoadFromEnv()
	if err == nil {
		t.Fatal("expected invalid lane queue capacity to fail")
	}

	t.Setenv("SUPERVISOR_API_LANE_RAG_QUEUE_CAPACITY", "")
	t.Setenv("SUPERVISOR_API_OTEL_ENABLED", "maybe")
	_, err = LoadFromEnv()
	if err == nil {
		t.Fatal("expected invalid otel bool to fail")
	}

	t.Setenv("SUPERVISOR_API_OTEL_ENABLED", "")
	t.Setenv("SUPERVISOR_API_EXECUTION_AUDIT_ENABLED", "maybe")
	_, err = LoadFromEnv()
	if err == nil {
		t.Fatal("expected invalid execution audit bool to fail")
	}
}
