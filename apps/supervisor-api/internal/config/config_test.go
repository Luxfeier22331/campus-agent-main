package config

import "testing"

func TestFromEnvUsesSupervisorDefaults(t *testing.T) {
	t.Setenv("API_AUTH_MODE", "")
	t.Setenv("API_DEFAULT_ACTOR_ID", "")
	t.Setenv("API_DEFAULT_ACTOR_ROLES", "")
	t.Setenv("SUPERVISOR_CORE_WORKER_BASE_URL", "")
	t.Setenv("SUPERVISOR_CORE_WORKER_SHARED_SECRET", "")
	t.Setenv("SUPERVISOR_API_BRIDGE_BREAKER_FAILURE_THRESHOLD", "")
	t.Setenv("SUPERVISOR_API_BRIDGE_BREAKER_OPEN_MS", "")
	t.Setenv("CAMPUS_AGENT_HTTP_HOST", "")
	t.Setenv("CAMPUS_AGENT_HTTP_PORT", "")
	t.Setenv("SUPERVISOR_API_MAX_CONCURRENT_ANSWERS", "")
	t.Setenv("SUPERVISOR_API_QUEUE_CAPACITY", "")
	t.Setenv("SUPERVISOR_API_QUEUE_TIMEOUT_MS", "")
	t.Setenv("SUPERVISOR_API_REQUEST_TIMEOUT_MS", "")
	t.Setenv("SUPERVISOR_API_REQUEST_BODY_LIMIT_BYTES", "")
	t.Setenv("SUPERVISOR_CORE_WORKER_RESPONSE_LIMIT_BYTES", "")
	t.Setenv("SUPERVISOR_API_SHUTDOWN_GRACE_MS", "")
	t.Setenv("SUPERVISOR_API_METRICS_BEARER_TOKEN", "")
	t.Setenv("SUPERVISOR_CORE_WORKER_TIMEOUT_MS", "")
	t.Setenv("SUPERVISOR_API_EXECUTION_AUDIT_ENABLED", "")
	t.Setenv("SUPERVISOR_API_EXECUTION_AUDIT_URL", "")
	t.Setenv("SUPERVISOR_API_EXECUTION_AUDIT_SHARED_SECRET", "")
	t.Setenv("SUPERVISOR_API_EXECUTION_AUDIT_TIMEOUT_MS", "")
	t.Setenv("SUPERVISOR_API_EXECUTION_AUDIT_QUEUE_CAPACITY", "")
	t.Setenv("INTERNAL_NOTICE_READ_MODEL_DATABASE_URL", "")
	t.Setenv("CAMPUS_SHARED_POSTGRES_URL", "")
	t.Setenv("INTERNAL_NOTICE_READ_MODEL_TABLE", "")
	t.Setenv("OBJECT_STORE_ENDPOINT", "")
	t.Setenv("OBJECT_STORE_DERIVED_ACCESS_KEY", "")
	t.Setenv("OBJECT_STORE_DERIVED_SECRET_KEY", "")
	t.Setenv("OBJECT_STORE_ACCESS_KEY", "")
	t.Setenv("OBJECT_STORE_SECRET_KEY", "")
	t.Setenv("OBJECT_STORE_REGION", "")
	t.Setenv("OBJECT_STORE_BUCKET_DERIVED", "")
	t.Setenv("SUPERVISOR_NOTICE_BODY_LIMIT_BYTES", "")
	t.Setenv("PROMPT_RUNTIME_PROVIDER", "")
	t.Setenv("AGENT_RUNTIME_PROVIDER", "")
	t.Setenv("PROMPT_RUNTIME_MODEL", "")
	t.Setenv("SUPERVISOR_PROMPT_MODEL", "")
	t.Setenv("SPECIALIST_PROMPT_MODEL", "")
	t.Setenv("PROMPT_RUNTIME_API_KEY", "")
	t.Setenv("LLM_API_KEY", "")
	t.Setenv("PROMPT_RUNTIME_TRANSPORT", "")
	t.Setenv("PROMPT_RUNTIME_BASE_URL", "")
	t.Setenv("LLM_BASE_URL", "")
	t.Setenv("PROMPT_STRICT_STRUCTURED_OUTPUTS", "")

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
	if cfg.BridgeBreakerFailureThreshold != 5 {
		t.Fatalf("bridge breaker failure threshold = %d, want 5", cfg.BridgeBreakerFailureThreshold)
	}
	if cfg.BridgeBreakerOpenMS != 10_000 {
		t.Fatalf("bridge breaker open ms = %d, want 10000", cfg.BridgeBreakerOpenMS)
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
	if cfg.BridgeResponseLimitBytes != 1_048_576 {
		t.Fatalf("bridge response limit = %d, want 1048576", cfg.BridgeResponseLimitBytes)
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
	if cfg.OTelServiceName != "campus-supervisor-api" {
		t.Fatalf("otel service name = %q, want campus-supervisor-api", cfg.OTelServiceName)
	}
	if cfg.ExecutionAuditEnabled {
		t.Fatal("execution audit enabled = true, want false by default")
	}
	if len(cfg.OpenCapabilities) != 0 {
		t.Fatalf("open capabilities = %#v, want empty by default", cfg.OpenCapabilities)
	}
	if cfg.ExecutionAuditTimeoutMS != 500 {
		t.Fatalf("execution audit timeout = %d, want 500", cfg.ExecutionAuditTimeoutMS)
	}
	if cfg.ExecutionAuditQueueCapacity != 128 {
		t.Fatalf("execution audit queue capacity = %d, want 128", cfg.ExecutionAuditQueueCapacity)
	}
	if cfg.ExecutionAuditBatchSize != 10 ||
		cfg.ExecutionAuditFlushMS != 1_000 ||
		cfg.ExecutionAuditRetryMaxAttempts != 3 ||
		cfg.ExecutionAuditRetryBaseMS != 100 ||
		cfg.ExecutionAuditSpoolDir != "" ||
		cfg.ExecutionAuditSpoolMaxBytes != 10_485_760 {
		t.Fatalf("unexpected execution audit hardening defaults: %#v", cfg)
	}
	if cfg.OTelSampleRatio != 1.0 {
		t.Fatalf("otel sample ratio = %v, want 1.0", cfg.OTelSampleRatio)
	}
	if cfg.OTelAllowedAttributesVersion != "supervisor-api-otel-attrs-v1" {
		t.Fatalf("otel allowed attrs version = %q", cfg.OTelAllowedAttributesVersion)
	}
	if cfg.NoticeReadModelDatabaseURL != "" {
		t.Fatalf("notice read model database url = %q, want empty", cfg.NoticeReadModelDatabaseURL)
	}
	if cfg.NoticeReadModelTable != "ingestion_projection.internal_notice_read_model" {
		t.Fatalf("notice read model table = %q", cfg.NoticeReadModelTable)
	}
	if cfg.NoticeObjectStoreBucketDerived != "campus-rag-derived" {
		t.Fatalf("notice derived bucket = %q", cfg.NoticeObjectStoreBucketDerived)
	}
	if cfg.NoticeObjectStoreBodyLimitBytes != 1_048_576 {
		t.Fatalf("notice body limit = %d, want 1048576", cfg.NoticeObjectStoreBodyLimitBytes)
	}
	if cfg.PromptRuntimeProvider != "" ||
		cfg.SupervisorPromptModel != "" ||
		cfg.SpecialistPromptModel != "" ||
		cfg.PromptRuntimeAPIKey != "" ||
		cfg.PromptRuntimeTransport != "responses" ||
		cfg.PromptRuntimeBaseURL != "https://api.openai.com/v1" ||
		!cfg.PromptStrictStructuredOutputs {
		t.Fatalf("unexpected prompt config defaults: %#v", cfg)
	}
}

func TestLoadFromEnvRejectsInvalidPositiveIntegers(t *testing.T) {
	t.Setenv("SUPERVISOR_API_QUEUE_CAPACITY", "not-a-number")

	_, err := LoadFromEnv()
	if err == nil {
		t.Fatal("expected LoadFromEnv to reject invalid queue capacity")
	}
}

func TestLoadFromEnvFallsBackForBlankDefaultedStrings(t *testing.T) {
	t.Setenv("API_AUTH_MODE", "   ")
	t.Setenv("PROMPT_RUNTIME_TRANSPORT", "   ")
	t.Setenv("OBJECT_STORE_REGION", "   ")

	cfg, err := LoadFromEnv()
	if err != nil {
		t.Fatalf("LoadFromEnv returned error: %v", err)
	}
	if cfg.AuthMode != "bearer" {
		t.Fatalf("auth mode = %q, want bearer", cfg.AuthMode)
	}
	if cfg.PromptRuntimeTransport != "responses" {
		t.Fatalf("prompt runtime transport = %q, want responses", cfg.PromptRuntimeTransport)
	}
	if cfg.NoticeObjectStoreRegion != "us-east-1" {
		t.Fatalf("notice object store region = %q, want us-east-1", cfg.NoticeObjectStoreRegion)
	}
}

func TestLoadFromEnvAcceptsExplicitHardeningSettings(t *testing.T) {
	t.Setenv("SUPERVISOR_API_MAX_CONCURRENT_ANSWERS", "4")
	t.Setenv("SUPERVISOR_API_QUEUE_CAPACITY", "12")
	t.Setenv("SUPERVISOR_API_QUEUE_TIMEOUT_MS", "2500")
	t.Setenv("SUPERVISOR_API_REQUEST_TIMEOUT_MS", "30000")
	t.Setenv("SUPERVISOR_CORE_WORKER_TIMEOUT_MS", "25000")
	t.Setenv("SUPERVISOR_CORE_WORKER_RESPONSE_LIMIT_BYTES", "2048")
	t.Setenv("SUPERVISOR_API_BRIDGE_BREAKER_FAILURE_THRESHOLD", "3")
	t.Setenv("SUPERVISOR_API_BRIDGE_BREAKER_OPEN_MS", "7500")
	t.Setenv("SUPERVISOR_API_SHUTDOWN_GRACE_MS", "20000")
	t.Setenv("SUPERVISOR_API_METRICS_BEARER_TOKEN", "metrics-token")
	t.Setenv("SUPERVISOR_API_LANE_RAG_MAX_CONCURRENT", "2")
	t.Setenv("SUPERVISOR_API_LANE_RAG_QUEUE_CAPACITY", "5")
	t.Setenv("SUPERVISOR_API_LANE_RAG_QUEUE_TIMEOUT_MS", "1500")
	t.Setenv("SUPERVISOR_API_OTEL_ENABLED", "true")
	t.Setenv("SUPERVISOR_API_OTEL_EXPORTER_OTLP_ENDPOINT", "http://collector:4318/v1/traces")
	t.Setenv("SUPERVISOR_API_OTEL_EXPORTER_OTLP_HEADERS", "authorization=Bearer test")
	t.Setenv("SUPERVISOR_API_OTEL_SERVICE_NAME", "custom-supervisor-api")
	t.Setenv("SUPERVISOR_API_OTEL_EXPORT_TIMEOUT_MS", "750")
	t.Setenv("SUPERVISOR_API_EXECUTION_AUDIT_ENABLED", "true")
	t.Setenv("SUPERVISOR_API_EXECUTION_AUDIT_URL", "http://app-api:8787/api/internal/execution/audit-events")
	t.Setenv("SUPERVISOR_API_EXECUTION_AUDIT_SHARED_SECRET", "audit-secret")
	t.Setenv("SUPERVISOR_API_EXECUTION_AUDIT_TIMEOUT_MS", "250")
	t.Setenv("SUPERVISOR_API_EXECUTION_AUDIT_QUEUE_CAPACITY", "16")
	t.Setenv("SUPERVISOR_API_EXECUTION_AUDIT_BATCH_SIZE", "3")
	t.Setenv("SUPERVISOR_API_EXECUTION_AUDIT_FLUSH_MS", "25")
	t.Setenv("SUPERVISOR_API_EXECUTION_AUDIT_RETRY_MAX_ATTEMPTS", "5")
	t.Setenv("SUPERVISOR_API_EXECUTION_AUDIT_RETRY_BASE_MS", "10")
	t.Setenv("SUPERVISOR_API_EXECUTION_AUDIT_SPOOL_DIR", "/tmp/supervisor-audit-spool")
	t.Setenv("SUPERVISOR_API_EXECUTION_AUDIT_SPOOL_MAX_BYTES", "2048")
	t.Setenv("SUPERVISOR_API_OTEL_SAMPLE_RATIO", "0.25")
	t.Setenv("SUPERVISOR_API_OTEL_ALLOWED_ATTRIBUTES_VERSION", "custom-attrs-v1")
	t.Setenv("SUPERVISOR_API_OPEN_CAPABILITIES", "campus_services, notice")
	t.Setenv("SUPERVISOR_STRUCTURED_QUERY_PLACE_CATALOG_PATH", "/etc/campus-agent/place-catalog.seed.v1.json")
	t.Setenv("PROMPT_RUNTIME_PROVIDER", "openai-responses")
	t.Setenv("PROMPT_RUNTIME_MODEL", "gpt-shared")
	t.Setenv("SUPERVISOR_PROMPT_MODEL", "gpt-supervisor")
	t.Setenv("SPECIALIST_PROMPT_MODEL", "gpt-specialist")
	t.Setenv("PROMPT_RUNTIME_API_KEY", "prompt-key")
	t.Setenv("PROMPT_RUNTIME_TRANSPORT", "responses")
	t.Setenv("PROMPT_RUNTIME_BASE_URL", "https://api.openai.com/v1")
	t.Setenv("PROMPT_STRICT_STRUCTURED_OUTPUTS", "false")
	t.Setenv("SUPERVISOR_NOTICE_BODY_LIMIT_BYTES", "4096")

	cfg, err := LoadFromEnv()
	if err != nil {
		t.Fatalf("LoadFromEnv returned error: %v", err)
	}

	if cfg.MaxConcurrentAnswers != 4 ||
		cfg.QueueCapacity != 12 ||
		cfg.QueueTimeoutMS != 2500 ||
		cfg.RequestTimeoutMS != 30000 ||
		cfg.BridgeTimeoutMS != 25000 ||
		cfg.BridgeResponseLimitBytes != 2048 ||
		cfg.BridgeBreakerFailureThreshold != 3 ||
		cfg.BridgeBreakerOpenMS != 7500 ||
		cfg.ShutdownGraceMS != 20000 ||
		cfg.MetricsBearerToken != "metrics-token" ||
		cfg.LaneBudgets["rag"].MaxConcurrent != 2 ||
		cfg.LaneBudgets["rag"].QueueCapacity != 5 ||
		cfg.LaneBudgets["rag"].QueueTimeoutMS != 1500 ||
		!cfg.OTelEnabled ||
		cfg.OTelEndpoint != "http://collector:4318/v1/traces" ||
		cfg.OTelHeaders != "authorization=Bearer test" ||
		cfg.OTelServiceName != "custom-supervisor-api" ||
		cfg.OTelExportTimeoutMS != 750 ||
		!cfg.ExecutionAuditEnabled ||
		cfg.ExecutionAuditURL != "http://app-api:8787/api/internal/execution/audit-events" ||
		cfg.ExecutionAuditSharedSecret != "audit-secret" ||
		cfg.ExecutionAuditTimeoutMS != 250 ||
		cfg.ExecutionAuditQueueCapacity != 16 ||
		cfg.ExecutionAuditBatchSize != 3 ||
		cfg.ExecutionAuditFlushMS != 25 ||
		cfg.ExecutionAuditRetryMaxAttempts != 5 ||
		cfg.ExecutionAuditRetryBaseMS != 10 ||
		cfg.ExecutionAuditSpoolDir != "/tmp/supervisor-audit-spool" ||
		cfg.ExecutionAuditSpoolMaxBytes != 2048 ||
		cfg.OTelSampleRatio != 0.25 ||
		cfg.OTelAllowedAttributesVersion != "custom-attrs-v1" ||
		len(cfg.OpenCapabilities) != 2 ||
		cfg.OpenCapabilities[0] != "campus_services" ||
		cfg.OpenCapabilities[1] != "notice" ||
		cfg.StructuredQueryPlaceCatalogPath != "/etc/campus-agent/place-catalog.seed.v1.json" ||
		cfg.PromptRuntimeProvider != "openai-responses" ||
		cfg.SupervisorPromptModel != "gpt-supervisor" ||
		cfg.SpecialistPromptModel != "gpt-specialist" ||
		cfg.PromptRuntimeAPIKey != "prompt-key" ||
		cfg.PromptRuntimeTransport != "responses" ||
		cfg.PromptRuntimeBaseURL != "https://api.openai.com/v1" ||
		cfg.PromptStrictStructuredOutputs ||
		cfg.NoticeObjectStoreBodyLimitBytes != 4096 {
		t.Fatalf("unexpected config: %#v", cfg)
	}
}

func TestLoadFromEnvRejectsWildcardOpenCapabilities(t *testing.T) {
	for _, value := range []string{"*", "all", "campus_services,all"} {
		t.Run(value, func(t *testing.T) {
			t.Setenv("SUPERVISOR_API_OPEN_CAPABILITIES", value)

			_, err := LoadFromEnv()
			if err == nil {
				t.Fatalf("expected SUPERVISOR_API_OPEN_CAPABILITIES=%q to fail", value)
			}
		})
	}
}

func TestLoadFromEnvRejectsUnknownOpenCapabilities(t *testing.T) {
	t.Setenv("SUPERVISOR_API_OPEN_CAPABILITIES", "campus_services,unknown_capability")

	_, err := LoadFromEnv()
	if err == nil {
		t.Fatal("expected unknown open capability to fail")
	}
}

func TestCapabilityOpenDoesNotTreatWildcardAsRuntimeAllow(t *testing.T) {
	cfg := Config{OpenCapabilities: []string{"*"}}

	if cfg.CapabilityOpen("notice") {
		t.Fatal("wildcard open capability must not open notice")
	}
}

func TestLoadFromEnvAcceptsNoticeReadModelSettings(t *testing.T) {
	t.Setenv("INTERNAL_NOTICE_READ_MODEL_DATABASE_URL", "postgres://notice.example/db")
	t.Setenv("INTERNAL_NOTICE_READ_MODEL_TABLE", "custom_schema.custom_notice_read_model")
	t.Setenv("OBJECT_STORE_ENDPOINT", "http://minio:9000")
	t.Setenv("OBJECT_STORE_DERIVED_ACCESS_KEY", "derived-access")
	t.Setenv("OBJECT_STORE_DERIVED_SECRET_KEY", "derived-secret")
	t.Setenv("OBJECT_STORE_REGION", "us-east-1")
	t.Setenv("OBJECT_STORE_BUCKET_DERIVED", "campus-rag-derived-test")

	cfg, err := LoadFromEnv()
	if err != nil {
		t.Fatalf("LoadFromEnv returned error: %v", err)
	}

	if cfg.NoticeReadModelDatabaseURL != "postgresql://notice.example/db" {
		t.Fatalf("notice read model database url = %q", cfg.NoticeReadModelDatabaseURL)
	}
	if cfg.NoticeReadModelTable != "custom_schema.custom_notice_read_model" {
		t.Fatalf("notice read model table = %q", cfg.NoticeReadModelTable)
	}
	if cfg.NoticeObjectStoreEndpoint != "http://minio:9000" ||
		cfg.NoticeObjectStoreAccessKey != "derived-access" ||
		cfg.NoticeObjectStoreSecretKey != "derived-secret" ||
		cfg.NoticeObjectStoreRegion != "us-east-1" ||
		cfg.NoticeObjectStoreBucketDerived != "campus-rag-derived-test" {
		t.Fatalf("unexpected notice object store config: %#v", cfg)
	}
}

func TestLoadFromEnvFallsBackToSharedPostgresAndGenericObjectStoreKeysForNoticeRuntime(t *testing.T) {
	t.Setenv("CAMPUS_SHARED_POSTGRES_URL", "postgres://shared.example/db")
	t.Setenv("OBJECT_STORE_ENDPOINT", "http://minio:9000")
	t.Setenv("OBJECT_STORE_ACCESS_KEY", "generic-access")
	t.Setenv("OBJECT_STORE_SECRET_KEY", "generic-secret")

	cfg, err := LoadFromEnv()
	if err != nil {
		t.Fatalf("LoadFromEnv returned error: %v", err)
	}

	if cfg.NoticeReadModelDatabaseURL != "postgresql://shared.example/db" {
		t.Fatalf("notice read model database url = %q", cfg.NoticeReadModelDatabaseURL)
	}
	if cfg.NoticeObjectStoreAccessKey != "generic-access" {
		t.Fatalf("notice object store access key = %q", cfg.NoticeObjectStoreAccessKey)
	}
	if cfg.NoticeObjectStoreSecretKey != "generic-secret" {
		t.Fatalf("notice object store secret key = %q", cfg.NoticeObjectStoreSecretKey)
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

	t.Setenv("SUPERVISOR_API_EXECUTION_AUDIT_ENABLED", "")
	t.Setenv("SUPERVISOR_API_OTEL_SAMPLE_RATIO", "1.5")
	_, err = LoadFromEnv()
	if err == nil {
		t.Fatal("expected invalid otel sample ratio to fail")
	}
}
