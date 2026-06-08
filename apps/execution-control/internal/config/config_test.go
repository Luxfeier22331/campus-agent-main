package config

import (
	"strings"
	"testing"
)

func TestFromEnvUsesSupervisorDefaults(t *testing.T) {
	t.Setenv("API_AUTH_MODE", "")
	t.Setenv("EXECUTION_CONTROL_RUNTIME_PROFILE", "")
	t.Setenv("API_DEFAULT_ACTOR_ID", "")
	t.Setenv("API_DEFAULT_ACTOR_ROLES", "")
	t.Setenv("CAMPUS_AGENT_HTTP_HOST", "")
	t.Setenv("CAMPUS_AGENT_HTTP_PORT", "")
	t.Setenv("EXECUTION_CONTROL_MAX_CONCURRENT_ANSWERS", "")
	t.Setenv("EXECUTION_CONTROL_QUEUE_CAPACITY", "")
	t.Setenv("EXECUTION_CONTROL_QUEUE_TIMEOUT_MS", "")
	t.Setenv("EXECUTION_CONTROL_REQUEST_TIMEOUT_MS", "")
	t.Setenv("EXECUTION_CONTROL_REQUEST_BODY_LIMIT_BYTES", "")
	t.Setenv("EXECUTION_CONTROL_SHUTDOWN_GRACE_MS", "")
	t.Setenv("EXECUTION_CONTROL_METRICS_BEARER_TOKEN", "")
	t.Setenv("EXECUTION_CONTROL_INTENT_POLICY_PATH", "")
	t.Setenv("EXECUTION_CONTROL_EXECUTION_AUDIT_ENABLED", "")
	t.Setenv("EXECUTION_CONTROL_EXECUTION_AUDIT_URL", "")
	t.Setenv("EXECUTION_CONTROL_EXECUTION_AUDIT_SHARED_SECRET", "")
	t.Setenv("EXECUTION_CONTROL_EXECUTION_AUDIT_TIMEOUT_MS", "")
	t.Setenv("EXECUTION_CONTROL_MULTI_STEP_WORKFLOW_ENABLED", "")
	t.Setenv("EXECUTION_CONTROL_WORKFLOW_RUN_DATABASE_URL", "")
	t.Setenv("EXECUTION_CONTROL_WORKFLOW_RUN_AUTO_MIGRATE", "")
	t.Setenv("EXECUTION_CONTROL_DURABLE_RUNTIME_DATABASE_URL", "")
	t.Setenv("EXECUTION_CONTROL_DURABLE_RUNTIME_AUTO_MIGRATE", "")
	t.Setenv("EXECUTION_CONTROL_TEMPORAL_ADDRESS", "")
	t.Setenv("EXECUTION_CONTROL_TEMPORAL_NAMESPACE", "")
	t.Setenv("EXECUTION_CONTROL_TEMPORAL_TASK_QUEUE", "")
	t.Setenv("EXECUTION_CONTROL_TEMPORAL_WORKER_IDENTITY", "")
	t.Setenv("EXECUTION_CONTROL_TEMPORAL_WORKFLOW_ID_SALT", "")
	t.Setenv("EXECUTION_CONTROL_TEMPORAL_START_TIMEOUT_MS", "")
	t.Setenv("INTERNAL_NOTICE_READ_MODEL_DATABASE_URL", "")
	t.Setenv("CAMPUS_SHARED_POSTGRES_URL", "")
	t.Setenv("INTERNAL_NOTICE_READ_MODEL_TABLE", "")
	t.Setenv("EXECUTION_CONTROL_NOTICE_BODY_OBJECT_STORE_ENDPOINT", "")
	t.Setenv("EXECUTION_CONTROL_NOTICE_BODY_OBJECT_STORE_ACCESS_KEY", "")
	t.Setenv("EXECUTION_CONTROL_NOTICE_BODY_OBJECT_STORE_SECRET_KEY", "")
	t.Setenv("EXECUTION_CONTROL_NOTICE_BODY_OBJECT_STORE_REGION", "")
	t.Setenv("EXECUTION_CONTROL_NOTICE_BODY_OBJECT_STORE_BUCKET", "")
	t.Setenv("EXECUTION_CONTROL_NOTICE_BODY_LIMIT_BYTES", "")
	t.Setenv("PROMPT_RUNTIME_PROVIDER", "")
	t.Setenv("AGENT_RUNTIME_PROVIDER", "")
	t.Setenv("PROMPT_RUNTIME_MODEL", "")
	t.Setenv("SUPERVISOR_PROMPT_MODEL", "")
	t.Setenv("AGENT_PROMPT_MODEL", "")
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
	if cfg.RuntimeProfile != "local" {
		t.Fatalf("runtime profile = %q, want local", cfg.RuntimeProfile)
	}
	if cfg.DefaultActorID != "" {
		t.Fatalf("default actor id = %q, want empty", cfg.DefaultActorID)
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
	if cfg.OTelServiceName != "campus-execution-control" {
		t.Fatalf("otel service name = %q, want campus-execution-control", cfg.OTelServiceName)
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
	if cfg.OTelSampleRatio != 1.0 {
		t.Fatalf("otel sample ratio = %v, want 1.0", cfg.OTelSampleRatio)
	}
	if cfg.OTelAllowedAttributesVersion != "execution-control-otel-attrs-v1" {
		t.Fatalf("otel allowed attrs version = %q", cfg.OTelAllowedAttributesVersion)
	}
	if cfg.NoticeReadModelDatabaseURL != "" {
		t.Fatalf("notice read model database url = %q, want empty", cfg.NoticeReadModelDatabaseURL)
	}
	if cfg.NoticeReadModelTable != "ingestion_projection.internal_notice_read_model" {
		t.Fatalf("notice read model table = %q", cfg.NoticeReadModelTable)
	}
	if cfg.StructuredProjectionDatabaseURL != "" {
		t.Fatalf("structured projection database url = %q, want empty", cfg.StructuredProjectionDatabaseURL)
	}
	if cfg.MultiStepWorkflowEnabled {
		t.Fatal("multi-step workflow must be disabled by default")
	}
	if cfg.WorkflowRunDatabaseURL != "" {
		t.Fatalf("workflow run database url = %q, want empty", cfg.WorkflowRunDatabaseURL)
	}
	if cfg.WorkflowRunAutoMigrate {
		t.Fatal("workflow run auto migrate must be disabled by default")
	}
	if cfg.RunProjectionDatabaseURL != "" {
		t.Fatalf("run projection database url = %q, want empty", cfg.RunProjectionDatabaseURL)
	}
	if cfg.RunProjectionAutoMigrate {
		t.Fatal("run projection auto migrate must be disabled by default")
	}
	if cfg.TemporalAddress != "" ||
		cfg.TemporalNamespace != "" ||
		cfg.TemporalTaskQueue != "campus-agent.workflow" ||
		cfg.TemporalWorkerIdentity != "" ||
		cfg.TemporalWorkflowIDSalt != "" ||
		cfg.TemporalStartTimeoutMS != 5000 {
		t.Fatalf("unexpected temporal defaults: %#v", cfg)
	}
	if cfg.NoticeBodyObjectStoreBucket != "" {
		t.Fatalf("notice body object store bucket = %q, want empty", cfg.NoticeBodyObjectStoreBucket)
	}
	if cfg.NoticeBodyObjectStoreBodyLimitBytes != 1_048_576 {
		t.Fatalf("notice body limit = %d, want 1048576", cfg.NoticeBodyObjectStoreBodyLimitBytes)
	}
	if cfg.PromptRuntimeProvider != "" ||
		cfg.SupervisorPromptModel != "" ||
		cfg.AgentPromptModel != "" ||
		cfg.PromptRuntimeAPIKey != "" ||
		cfg.PromptRuntimeTransport != "responses" ||
		cfg.PromptRuntimeBaseURL != "https://api.openai.com/v1" ||
		!cfg.PromptStrictStructuredOutputs {
		t.Fatalf("unexpected prompt config defaults: %#v", cfg)
	}
}

func TestLoadFromEnvRequiresTemporalSettingsForStaging(t *testing.T) {
	t.Setenv("EXECUTION_CONTROL_RUNTIME_PROFILE", "staging")
	t.Setenv("EXECUTION_CONTROL_METRICS_BEARER_TOKEN", "metrics-token")
	t.Setenv("EXECUTION_CONTROL_TEMPORAL_ADDRESS", "")
	t.Setenv("EXECUTION_CONTROL_TEMPORAL_NAMESPACE", "campus-agent-staging")
	t.Setenv("EXECUTION_CONTROL_TEMPORAL_WORKER_IDENTITY", "staging:gateway:001")
	t.Setenv("EXECUTION_CONTROL_TEMPORAL_WORKFLOW_ID_SALT", "salt")

	if _, err := LoadFromEnv(); err == nil {
		t.Fatal("LoadFromEnv returned nil error, want missing Temporal address failure")
	}
}

func TestLoadFromEnvReadsTemporalSettings(t *testing.T) {
	t.Setenv("EXECUTION_CONTROL_RUNTIME_PROFILE", "staging")
	t.Setenv("EXECUTION_CONTROL_METRICS_BEARER_TOKEN", "metrics-token")
	t.Setenv("EXECUTION_CONTROL_TEMPORAL_ADDRESS", "temporal:7233")
	t.Setenv("EXECUTION_CONTROL_TEMPORAL_NAMESPACE", "campus-agent-staging")
	t.Setenv("EXECUTION_CONTROL_TEMPORAL_TASK_QUEUE", "campus-agent.workflow")
	t.Setenv("EXECUTION_CONTROL_TEMPORAL_WORKER_IDENTITY", "staging:gateway:001")
	t.Setenv("EXECUTION_CONTROL_TEMPORAL_WORKFLOW_ID_SALT", "workflow-salt")
	t.Setenv("EXECUTION_CONTROL_TEMPORAL_START_TIMEOUT_MS", "7000")

	cfg, err := LoadFromEnv()
	if err != nil {
		t.Fatalf("LoadFromEnv returned error: %v", err)
	}
	if cfg.TemporalAddress != "temporal:7233" ||
		cfg.TemporalNamespace != "campus-agent-staging" ||
		cfg.TemporalTaskQueue != "campus-agent.workflow" ||
		cfg.TemporalWorkerIdentity != "staging:gateway:001" ||
		cfg.TemporalWorkflowIDSalt != "workflow-salt" ||
		cfg.TemporalStartTimeoutMS != 7000 {
		t.Fatalf("unexpected Temporal settings: %#v", cfg)
	}
}

func TestLoadFromEnvReadsRunProjectionDatabaseSettingsExplicitly(t *testing.T) {
	t.Setenv("EXECUTION_CONTROL_RUN_PROJECTION_DATABASE_URL", "postgres://runtime.example/campus_agent")
	t.Setenv("EXECUTION_CONTROL_RUN_PROJECTION_AUTO_MIGRATE", "true")
	t.Setenv("CAMPUS_SHARED_POSTGRES_URL", "postgres://shared.example/campus_agent")

	cfg, err := LoadFromEnv()
	if err != nil {
		t.Fatalf("LoadFromEnv returned error: %v", err)
	}
	if cfg.RunProjectionDatabaseURL != "postgresql://runtime.example/campus_agent" {
		t.Fatalf("run projection database url = %q", cfg.RunProjectionDatabaseURL)
	}
	if !cfg.RunProjectionAutoMigrate {
		t.Fatal("run projection auto migrate = false, want true")
	}
	if cfg.WorkflowRunDatabaseURL != "postgresql://shared.example/campus_agent" {
		t.Fatalf("workflow run database url = %q, want shared postgres normalized", cfg.WorkflowRunDatabaseURL)
	}
}

func TestLoadFromEnvDoesNotInferRunProjectionDatabaseURLFromSharedPostgres(t *testing.T) {
	t.Setenv("EXECUTION_CONTROL_RUN_PROJECTION_DATABASE_URL", "")
	t.Setenv("CAMPUS_SHARED_POSTGRES_URL", "postgres://shared.example/campus_agent")

	cfg, err := LoadFromEnv()
	if err != nil {
		t.Fatalf("LoadFromEnv returned error: %v", err)
	}
	if cfg.RunProjectionDatabaseURL != "" {
		t.Fatalf(
			"run projection database url = %q, want explicit setting only",
			cfg.RunProjectionDatabaseURL,
		)
	}
}

func TestLoadFromEnvRejectsRetiredDurableRuntimeDatabaseSettings(t *testing.T) {
	t.Setenv("EXECUTION_CONTROL_DURABLE_RUNTIME_DATABASE_URL", "postgres://runtime.example/campus_agent")

	if _, err := LoadFromEnv(); err == nil {
		t.Fatal("expected retired run projection database env to fail")
	}
}

func TestLoadFromEnvRejectsRetiredDurableWorkerLoopSettings(t *testing.T) {
	t.Setenv("EXECUTION_CONTROL_DURABLE_WORKER_LOOP_ENABLED", "true")
	t.Setenv("EXECUTION_CONTROL_DURABLE_WORKER_LOOP_WORKER_ID", "worker-staging-rag-001")
	t.Setenv("EXECUTION_CONTROL_DURABLE_WORKER_LOOP_LANE", "rag")
	t.Setenv("EXECUTION_CONTROL_DURABLE_WORKER_LOOP_STEP_ID", "handoff:rag-agent:rag_request")
	t.Setenv("EXECUTION_CONTROL_DURABLE_WORKER_LOOP_POLL_INTERVAL_MS", "250")
	t.Setenv("EXECUTION_CONTROL_DURABLE_WORKER_LOOP_LEASE_TTL_MS", "30000")
	t.Setenv("EXECUTION_CONTROL_DURABLE_WORKER_LOOP_LEASE_HEARTBEAT_INTERVAL_MS", "5000")

	if _, err := LoadFromEnv(); err == nil {
		t.Fatal("expected retired durable worker loop env to fail")
	}
}

func TestLoadFromEnvRejectsRetiredDurableRecoveryLoopSettings(t *testing.T) {
	t.Setenv("EXECUTION_CONTROL_DURABLE_RECOVERY_LOOP_ENABLED", "true")
	t.Setenv("EXECUTION_CONTROL_DURABLE_RECOVERY_LOOP_INTERVAL_MS", "250")
	t.Setenv("EXECUTION_CONTROL_DURABLE_RECOVERY_LOOP_MAX_RETRY_ATTEMPTS", "2")

	if _, err := LoadFromEnv(); err == nil {
		t.Fatal("expected retired durable recovery loop env to fail")
	}
}

func TestLoadFromEnvRejectsAnyRetiredDurableLoopSetting(t *testing.T) {
	for _, tc := range []struct {
		name  string
		value string
	}{
		{"EXECUTION_CONTROL_DURABLE_WORKER_LOOP_WORKER_ID", "worker-staging-rag-001"},
		{"EXECUTION_CONTROL_DURABLE_WORKER_LOOP_LANE", "rag"},
		{"EXECUTION_CONTROL_DURABLE_WORKER_LOOP_STEP_ID", "handoff:rag-agent:rag_request"},
		{"EXECUTION_CONTROL_DURABLE_WORKER_LOOP_POLL_INTERVAL_MS", "250"},
		{"EXECUTION_CONTROL_DURABLE_WORKER_LOOP_LEASE_TTL_MS", "30000"},
		{"EXECUTION_CONTROL_DURABLE_WORKER_LOOP_LEASE_HEARTBEAT_INTERVAL_MS", "5000"},
		{"EXECUTION_CONTROL_DURABLE_RECOVERY_LOOP_INTERVAL_MS", "250"},
		{"EXECUTION_CONTROL_DURABLE_RECOVERY_LOOP_MAX_RETRY_ATTEMPTS", "2"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			t.Setenv(tc.name, tc.value)
			if _, err := LoadFromEnv(); err == nil {
				t.Fatalf("expected %s to be rejected", tc.name)
			}
		})
	}
}

func TestLoadFromEnvReportsRetiredDurableLoopBeforeParsingOldValues(t *testing.T) {
	t.Setenv("EXECUTION_CONTROL_DURABLE_WORKER_LOOP_POLL_INTERVAL_MS", "old-value")

	_, err := LoadFromEnv()
	if err == nil {
		t.Fatal("expected retired durable worker loop env to fail")
	}
	if !strings.Contains(err.Error(), "is retired") {
		t.Fatalf("error = %q, want retired env error", err.Error())
	}
}

func TestFromEnvRejectsNonLocalRuntimeProfileWithoutMetricsToken(t *testing.T) {
	t.Setenv("EXECUTION_CONTROL_RUNTIME_PROFILE", "staging")
	t.Setenv("EXECUTION_CONTROL_METRICS_BEARER_TOKEN", "")

	if _, err := LoadFromEnv(); err == nil {
		t.Fatal("expected staging runtime profile without metrics token to fail")
	}
}

func TestFromEnvAcceptsStagingRuntimeProfileWithMetricsToken(t *testing.T) {
	t.Setenv("EXECUTION_CONTROL_RUNTIME_PROFILE", "staging")
	t.Setenv("EXECUTION_CONTROL_METRICS_BEARER_TOKEN", "metrics-token")
	t.Setenv("EXECUTION_CONTROL_TEMPORAL_ADDRESS", "temporal:7233")
	t.Setenv("EXECUTION_CONTROL_TEMPORAL_NAMESPACE", "campus-agent-staging")
	t.Setenv("EXECUTION_CONTROL_TEMPORAL_WORKER_IDENTITY", "staging:gateway:001")
	t.Setenv("EXECUTION_CONTROL_TEMPORAL_WORKFLOW_ID_SALT", "workflow-salt")

	cfg, err := LoadFromEnv()
	if err != nil {
		t.Fatalf("LoadFromEnv returned error: %v", err)
	}
	if cfg.RuntimeProfile != "staging" {
		t.Fatalf("runtime profile = %q, want staging", cfg.RuntimeProfile)
	}
}

func TestLoadFromEnvRejectsInvalidPositiveIntegers(t *testing.T) {
	t.Setenv("EXECUTION_CONTROL_QUEUE_CAPACITY", "not-a-number")

	_, err := LoadFromEnv()
	if err == nil {
		t.Fatal("expected LoadFromEnv to reject invalid queue capacity")
	}
}

func TestLoadFromEnvFallsBackForBlankDefaultedStrings(t *testing.T) {
	t.Setenv("API_AUTH_MODE", "   ")
	t.Setenv("PROMPT_RUNTIME_TRANSPORT", "   ")
	t.Setenv("EXECUTION_CONTROL_NOTICE_BODY_OBJECT_STORE_REGION", "   ")

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
	if cfg.NoticeBodyObjectStoreRegion != "us-east-1" {
		t.Fatalf("notice object store region = %q, want us-east-1", cfg.NoticeBodyObjectStoreRegion)
	}
}

func TestLoadFromEnvAcceptsExplicitHardeningSettings(t *testing.T) {
	t.Setenv("EXECUTION_CONTROL_MAX_CONCURRENT_ANSWERS", "4")
	t.Setenv("EXECUTION_CONTROL_QUEUE_CAPACITY", "12")
	t.Setenv("EXECUTION_CONTROL_QUEUE_TIMEOUT_MS", "2500")
	t.Setenv("EXECUTION_CONTROL_REQUEST_TIMEOUT_MS", "30000")
	t.Setenv("EXECUTION_CONTROL_SHUTDOWN_GRACE_MS", "20000")
	t.Setenv("EXECUTION_CONTROL_METRICS_BEARER_TOKEN", "metrics-token")
	t.Setenv("EXECUTION_CONTROL_INTENT_POLICY_PATH", "/etc/campus-agent/intent-policy.v1.json")
	t.Setenv("EXECUTION_CONTROL_LANE_RAG_MAX_CONCURRENT", "2")
	t.Setenv("EXECUTION_CONTROL_LANE_RAG_QUEUE_CAPACITY", "5")
	t.Setenv("EXECUTION_CONTROL_LANE_RAG_QUEUE_TIMEOUT_MS", "1500")
	t.Setenv("EXECUTION_CONTROL_OTEL_ENABLED", "true")
	t.Setenv("EXECUTION_CONTROL_OTEL_EXPORTER_OTLP_ENDPOINT", "http://collector:4318/v1/traces")
	t.Setenv("EXECUTION_CONTROL_OTEL_EXPORTER_OTLP_HEADERS", "authorization=Bearer test")
	t.Setenv("EXECUTION_CONTROL_OTEL_SERVICE_NAME", "custom-execution-control")
	t.Setenv("EXECUTION_CONTROL_OTEL_EXPORT_TIMEOUT_MS", "750")
	t.Setenv("EXECUTION_CONTROL_OTEL_EXPORT_INTERVAL_MS", "15000")
	t.Setenv("EXECUTION_CONTROL_OTEL_METRICS_ENABLED", "true")
	t.Setenv("EXECUTION_CONTROL_OTEL_EXPORTER_OTLP_METRICS_ENDPOINT", "http://collector:4318/v1/metrics")
	t.Setenv("EXECUTION_CONTROL_EXECUTION_AUDIT_ENABLED", "true")
	t.Setenv("EXECUTION_CONTROL_EXECUTION_AUDIT_URL", "http://app-api:27031/api/internal/execution/audit-events")
	t.Setenv("EXECUTION_CONTROL_EXECUTION_AUDIT_SHARED_SECRET", "audit-secret")
	t.Setenv("EXECUTION_CONTROL_EXECUTION_AUDIT_TIMEOUT_MS", "250")
	t.Setenv("EXECUTION_CONTROL_OTEL_SAMPLE_RATIO", "0.25")
	t.Setenv("EXECUTION_CONTROL_OTEL_ALLOWED_ATTRIBUTES_VERSION", "custom-attrs-v1")
	t.Setenv("EXECUTION_CONTROL_OPEN_CAPABILITIES", "campus_services, notice")
	t.Setenv("EXECUTION_CONTROL_MULTI_STEP_WORKFLOW_ENABLED", "true")
	t.Setenv("EXECUTION_CONTROL_WORKFLOW_RUN_DATABASE_URL", "postgres://workflow.example/db")
	t.Setenv("EXECUTION_CONTROL_WORKFLOW_RUN_AUTO_MIGRATE", "true")
	t.Setenv("PROMPT_RUNTIME_PROVIDER", "openai-responses")
	t.Setenv("PROMPT_RUNTIME_MODEL", "gpt-shared")
	t.Setenv("SUPERVISOR_PROMPT_MODEL", "gpt-supervisor")
	t.Setenv("AGENT_PROMPT_MODEL", "gpt-agent")
	t.Setenv("PROMPT_RUNTIME_API_KEY", "prompt-key")
	t.Setenv("PROMPT_RUNTIME_TRANSPORT", "responses")
	t.Setenv("PROMPT_RUNTIME_BASE_URL", "https://api.openai.com/v1")
	t.Setenv("PROMPT_STRICT_STRUCTURED_OUTPUTS", "false")
	t.Setenv("EXECUTION_CONTROL_NOTICE_BODY_LIMIT_BYTES", "4096")

	cfg, err := LoadFromEnv()
	if err != nil {
		t.Fatalf("LoadFromEnv returned error: %v", err)
	}

	if cfg.MaxConcurrentAnswers != 4 ||
		cfg.QueueCapacity != 12 ||
		cfg.QueueTimeoutMS != 2500 ||
		cfg.RequestTimeoutMS != 30000 ||
		cfg.ShutdownGraceMS != 20000 ||
		cfg.MetricsBearerToken != "metrics-token" ||
		cfg.IntentPolicyPath != "/etc/campus-agent/intent-policy.v1.json" ||
		cfg.LaneBudgets["rag"].MaxConcurrent != 2 ||
		cfg.LaneBudgets["rag"].QueueCapacity != 5 ||
		cfg.LaneBudgets["rag"].QueueTimeoutMS != 1500 ||
		!cfg.OTelEnabled ||
		cfg.OTelEndpoint != "http://collector:4318/v1/traces" ||
		cfg.OTelHeaders != "authorization=Bearer test" ||
		cfg.OTelServiceName != "custom-execution-control" ||
		cfg.OTelExportTimeoutMS != 750 ||
		cfg.OTelExportIntervalMS != 15000 ||
		!cfg.OTelMetricsEnabled ||
		cfg.OTelMetricsEndpoint != "http://collector:4318/v1/metrics" ||
		!cfg.ExecutionAuditEnabled ||
		cfg.ExecutionAuditURL != "http://app-api:27031/api/internal/execution/audit-events" ||
		cfg.ExecutionAuditSharedSecret != "audit-secret" ||
		cfg.ExecutionAuditTimeoutMS != 250 ||
		cfg.OTelSampleRatio != 0.25 ||
		cfg.OTelAllowedAttributesVersion != "custom-attrs-v1" ||
		len(cfg.OpenCapabilities) != 2 ||
		cfg.OpenCapabilities[0] != "campus_services" ||
		cfg.OpenCapabilities[1] != "notice" ||
		!cfg.MultiStepWorkflowEnabled ||
		cfg.WorkflowRunDatabaseURL != "postgresql://workflow.example/db" ||
		!cfg.WorkflowRunAutoMigrate ||
		cfg.PromptRuntimeProvider != "openai-responses" ||
		cfg.SupervisorPromptModel != "gpt-supervisor" ||
		cfg.AgentPromptModel != "gpt-agent" ||
		cfg.PromptRuntimeAPIKey != "prompt-key" ||
		cfg.PromptRuntimeTransport != "responses" ||
		cfg.PromptRuntimeBaseURL != "https://api.openai.com/v1" ||
		cfg.PromptStrictStructuredOutputs ||
		cfg.NoticeBodyObjectStoreBodyLimitBytes != 4096 {
		t.Fatalf("unexpected config: %#v", cfg)
	}
}

func TestLoadFromEnvRejectsRetiredPythonBridgeSettings(t *testing.T) {
	for _, tc := range []struct {
		name  string
		value string
	}{
		{"SUPERVISOR_AGENT_WORKER_BASE_URL", "http://127.0.0.1:27052"},
		{"SUPERVISOR_AGENT_WORKER_SHARED_SECRET", "bridge-secret"},
		{"SUPERVISOR_AGENT_WORKER_RESPONSE_LIMIT_BYTES", "2048"},
		{"SUPERVISOR_AGENT_WORKER_TIMEOUT_MS", "25000"},
		{"SUPERVISOR_AGENT_WORKER_CANCEL_TIMEOUT_MS", "500"},
		{"EXECUTION_CONTROL_BRIDGE_BREAKER_FAILURE_THRESHOLD", "3"},
		{"EXECUTION_CONTROL_BRIDGE_BREAKER_OPEN_MS", "7500"},
		{"EXECUTION_CONTROL_BRIDGE_RETRY_MAX_ATTEMPTS", "4"},
		{"EXECUTION_CONTROL_BRIDGE_RETRY_BASE_MS", "15"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			t.Setenv(tc.name, tc.value)
			if _, err := LoadFromEnv(); err == nil {
				t.Fatalf("expected retired Python bridge setting %s to fail", tc.name)
			}
		})
	}
}

func TestLoadFromEnvIgnoresLegacyLLMPromptRuntimeAliases(t *testing.T) {
	t.Setenv("PROMPT_RUNTIME_API_KEY", "")
	t.Setenv("PROMPT_RUNTIME_BASE_URL", "")
	t.Setenv("LLM_API_KEY", "legacy-key")
	t.Setenv("LLM_BASE_URL", "https://legacy.example/v1")

	cfg, err := LoadFromEnv()
	if err != nil {
		t.Fatalf("LoadFromEnv returned error: %v", err)
	}

	if cfg.PromptRuntimeAPIKey != "" {
		t.Fatalf("prompt runtime api key = %q, want empty", cfg.PromptRuntimeAPIKey)
	}
	if cfg.PromptRuntimeBaseURL != "https://api.openai.com/v1" {
		t.Fatalf(
			"prompt runtime base url = %q, want official default",
			cfg.PromptRuntimeBaseURL,
		)
	}
}

func TestLoadFromEnvDoesNotTreatAgentRuntimeProviderAsPromptRuntimeProvider(t *testing.T) {
	t.Setenv("PROMPT_RUNTIME_PROVIDER", "")
	t.Setenv("AGENT_RUNTIME_PROVIDER", "agent-os")

	cfg, err := LoadFromEnv()
	if err != nil {
		t.Fatalf("LoadFromEnv returned error: %v", err)
	}

	if cfg.PromptRuntimeProvider != "" {
		t.Fatalf("prompt runtime provider = %q, want empty", cfg.PromptRuntimeProvider)
	}
}

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
	t.Setenv("EXECUTION_CONTROL_OPEN_CAPABILITIES", "navigation")

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

func TestLoadFromEnvAcceptsNoticeReadModelSettings(t *testing.T) {
	t.Setenv("INTERNAL_NOTICE_READ_MODEL_DATABASE_URL", "postgres://notice.example/db")
	t.Setenv("INTERNAL_NOTICE_READ_MODEL_TABLE", "custom_schema.custom_notice_read_model")
	t.Setenv("EXECUTION_CONTROL_NOTICE_BODY_OBJECT_STORE_ENDPOINT", "http://minio:9000")
	t.Setenv("EXECUTION_CONTROL_NOTICE_BODY_OBJECT_STORE_ACCESS_KEY", "derived-access")
	t.Setenv("EXECUTION_CONTROL_NOTICE_BODY_OBJECT_STORE_SECRET_KEY", "derived-secret")
	t.Setenv("EXECUTION_CONTROL_NOTICE_BODY_OBJECT_STORE_REGION", "us-east-1")
	t.Setenv("EXECUTION_CONTROL_NOTICE_BODY_OBJECT_STORE_BUCKET", "notice-body-test")

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
	if cfg.NoticeBodyObjectStoreEndpoint != "http://minio:9000" ||
		cfg.NoticeBodyObjectStoreAccessKey != "derived-access" ||
		cfg.NoticeBodyObjectStoreSecretKey != "derived-secret" ||
		cfg.NoticeBodyObjectStoreRegion != "us-east-1" ||
		cfg.NoticeBodyObjectStoreBucket != "notice-body-test" {
		t.Fatalf("unexpected notice object store config: %#v", cfg)
	}
}

func TestLoadFromEnvUsesSharedPostgresWithoutTreatingGenericObjectStoreKeysAsNoticeRuntimeTruth(t *testing.T) {
	t.Setenv("CAMPUS_SHARED_POSTGRES_URL", "postgres://shared.example/db")
	t.Setenv("OBJECT_STORE_ENDPOINT", "http://minio:9000")
	t.Setenv("OBJECT_STORE_ACCESS_KEY", "generic-access")
	t.Setenv("OBJECT_STORE_SECRET_KEY", "generic-secret")
	t.Setenv("OBJECT_STORE_DERIVED_ACCESS_KEY", "derived-access")
	t.Setenv("OBJECT_STORE_DERIVED_SECRET_KEY", "derived-secret")
	t.Setenv("OBJECT_STORE_BUCKET_DERIVED", "campus-rag-derived")

	cfg, err := LoadFromEnv()
	if err != nil {
		t.Fatalf("LoadFromEnv returned error: %v", err)
	}

	if cfg.NoticeReadModelDatabaseURL != "postgresql://shared.example/db" {
		t.Fatalf("notice read model database url = %q", cfg.NoticeReadModelDatabaseURL)
	}
	if cfg.StructuredProjectionDatabaseURL != "postgresql://shared.example/db" {
		t.Fatalf("structured projection database url = %q", cfg.StructuredProjectionDatabaseURL)
	}
	if cfg.WorkflowRunDatabaseURL != "postgresql://shared.example/db" {
		t.Fatalf("workflow run database url = %q", cfg.WorkflowRunDatabaseURL)
	}
	if cfg.NoticeBodyObjectStoreAccessKey != "" {
		t.Fatalf("notice object store access key = %q, want empty without derived credential pair", cfg.NoticeBodyObjectStoreAccessKey)
	}
	if cfg.NoticeBodyObjectStoreSecretKey != "" {
		t.Fatalf("notice object store secret key = %q, want empty without derived credential pair", cfg.NoticeBodyObjectStoreSecretKey)
	}
	if cfg.NoticeBodyObjectStoreEndpoint != "" || cfg.NoticeBodyObjectStoreBucket != "" {
		t.Fatalf("notice body object store config must not come from generic object store env: %#v", cfg)
	}
}

func TestLoadFromEnvRejectsInvalidLaneAndOTelSettings(t *testing.T) {
	t.Setenv("EXECUTION_CONTROL_LANE_RAG_QUEUE_CAPACITY", "-1")

	_, err := LoadFromEnv()
	if err == nil {
		t.Fatal("expected invalid lane queue capacity to fail")
	}

	t.Setenv("EXECUTION_CONTROL_LANE_RAG_QUEUE_CAPACITY", "")
	t.Setenv("EXECUTION_CONTROL_OTEL_ENABLED", "maybe")
	_, err = LoadFromEnv()
	if err == nil {
		t.Fatal("expected invalid otel bool to fail")
	}

	t.Setenv("EXECUTION_CONTROL_OTEL_ENABLED", "")
	t.Setenv("EXECUTION_CONTROL_EXECUTION_AUDIT_ENABLED", "maybe")
	_, err = LoadFromEnv()
	if err == nil {
		t.Fatal("expected invalid execution audit bool to fail")
	}

	t.Setenv("EXECUTION_CONTROL_EXECUTION_AUDIT_ENABLED", "")
	t.Setenv("EXECUTION_CONTROL_OTEL_SAMPLE_RATIO", "1.5")
	_, err = LoadFromEnv()
	if err == nil {
		t.Fatal("expected invalid otel sample ratio to fail")
	}

	t.Setenv("EXECUTION_CONTROL_OTEL_SAMPLE_RATIO", "")
	t.Setenv("EXECUTION_CONTROL_OTEL_METRICS_ENABLED", "true")
	t.Setenv("EXECUTION_CONTROL_OTEL_EXPORT_INTERVAL_MS", "0")
	_, err = LoadFromEnv()
	if err == nil {
		t.Fatal("expected invalid otel export interval to fail")
	}
}
