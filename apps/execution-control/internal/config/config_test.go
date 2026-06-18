package config

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

const testDefaultRuntimeConfigProfile = `{
  "schema_version": "campus_execution_control_runtime_profile.v1",
  "max_concurrent_answers": 8,
  "queue_capacity": 24,
  "queue_timeout_ms": 3000,
  "request_timeout_ms": 45000,
  "request_body_limit_bytes": 1048576,
  "shutdown_grace_ms": 45000,
  "intent_policy_path": "../../configs/runtime/intent-policy.v1.json",
  "provider_pricing_path": "../../configs/runtime/provider-pricing.v1.json",
  "query_serving_scopes_path": "../../configs/runtime/query-serving-scopes.v1.json",
  "structured_query_timeout_ms": 1000,
  "open_capabilities": [],
  "multi_step_workflow_enabled": false,
  "otel": {
    "enabled": false,
    "endpoint": "http://otel-collector:4318/v1/traces",
    "metrics_enabled": false,
    "metrics_endpoint": "http://otel-collector:4318/v1/metrics",
    "service_name": "campus-execution-control",
    "export_timeout_ms": 1000,
    "export_interval_ms": 15000,
    "sample_ratio": 1,
    "allowed_attributes_version": "execution-control-otel-attrs-v1",
    "temporal_tracing_enabled": false
  },
  "execution_audit": {
    "enabled": false,
    "timeout_ms": 500
  },
  "lane_budgets": {
    "rag": {"max_concurrent": 8, "queue_capacity": 24, "queue_timeout_ms": 3000},
    "navigation": {"max_concurrent": 8, "queue_capacity": 24, "queue_timeout_ms": 3000},
    "campus_services": {"max_concurrent": 8, "queue_capacity": 24, "queue_timeout_ms": 3000},
    "notice": {"max_concurrent": 8, "queue_capacity": 24, "queue_timeout_ms": 3000},
    "default": {"max_concurrent": 8, "queue_capacity": 24, "queue_timeout_ms": 3000}
  },
  "rag": {
    "top_k_max": 8,
    "selected_evidence_max": 8,
    "retrieval_max_concurrent": 4,
    "synthesis_max_concurrent": 2,
    "embedding_timeout_ms": 10000,
    "qdrant_timeout_ms": 10000,
    "provider_timeout_ms": 60000
  },
  "personal_memory": {
    "runtime": "hindsight",
    "timeout_seconds": 10,
    "recall_limit": 8,
    "recall_max_chars": 2500
  }
}`

func TestMain(m *testing.M) {
	dir, err := os.MkdirTemp("", "campus-execution-control-config-test-")
	if err != nil {
		panic(err)
	}
	profilePath := filepath.Join(dir, "runtime-profile.json")
	if err := os.WriteFile(profilePath, []byte(testDefaultRuntimeConfigProfile), 0o600); err != nil {
		panic(err)
	}
	if os.Getenv("EXECUTION_CONTROL_RUNTIME_CONFIG_PATH") == "" {
		if err := os.Setenv("EXECUTION_CONTROL_RUNTIME_CONFIG_PATH", profilePath); err != nil {
			panic(err)
		}
	}
	code := m.Run()
	_ = os.RemoveAll(dir)
	os.Exit(code)
}

func setStagingPersonalMemoryEnv(t *testing.T) {
	t.Helper()
	t.Setenv("PERSONAL_MEMORY_BASE_URL", "http://hindsight-api:8000")
	t.Setenv("PERSONAL_MEMORY_API_SECRET", "hindsight-secret")
	t.Setenv("PERSONAL_MEMORY_OWNER_SALT", "staging-memory-salt")
}

func TestFromEnvUsesExecutionDefaults(t *testing.T) {
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
	t.Setenv("EXECUTION_PROMPT_MODEL", "")
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
		cfg.ExecutionPromptModel != "" ||
		cfg.PromptRuntimeAPIKey != "" ||
		cfg.PromptRuntimeTransport != "responses" ||
		cfg.PromptRuntimeBaseURL != "https://api.openai.com/v1" ||
		!cfg.PromptStrictStructuredOutputs {
		t.Fatalf("unexpected prompt config defaults: %#v", cfg)
	}
	if cfg.PersonalMemoryRuntime != "hindsight" ||
		cfg.PersonalMemoryBaseURL != "" ||
		cfg.PersonalMemoryAPISecret != "" ||
		cfg.PersonalMemoryOwnerSalt != "" ||
		cfg.PersonalMemoryTimeoutSeconds != 10 ||
		cfg.PersonalMemoryRecallLimit != 8 ||
		cfg.PersonalMemoryRecallMaxChars != 2500 ||
		cfg.EmbeddingDimensions != 0 {
		t.Fatalf("unexpected local personal memory defaults: %#v", cfg)
	}
	if cfg.RAGTopKMax != 8 ||
		cfg.RAGSelectedEvidenceMax != 8 ||
		cfg.RAGRetrievalMaxConcurrent != 4 ||
		cfg.RAGSynthesisMaxConcurrent != 2 ||
		cfg.RAGEmbeddingTimeoutMS != 10_000 ||
		cfg.RAGQdrantTimeoutMS != 10_000 ||
		cfg.RAGProviderTimeoutMS != 60_000 {
		t.Fatalf("unexpected rag budget defaults: %#v", cfg)
	}
	if cfg.WorkerProfiles["activity-knowledge-retrieval"].ActivitySlots != 4 ||
		cfg.WorkerProfiles["activity-knowledge-synthesis"].ActivitySlots != 2 ||
		cfg.WorkerProfiles["activity-knowledge-plan"].ActivitySlots != 16 {
		t.Fatalf("unexpected worker profile defaults: %#v", cfg.WorkerProfiles)
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
	setStagingPersonalMemoryEnv(t)

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

func TestLoadFromEnvRequiresDeployedPersonalMemorySettings(t *testing.T) {
	t.Setenv("EXECUTION_CONTROL_RUNTIME_PROFILE", "staging")
	t.Setenv("EXECUTION_CONTROL_METRICS_BEARER_TOKEN", "metrics-token")
	t.Setenv("EXECUTION_CONTROL_TEMPORAL_ADDRESS", "temporal:7233")
	t.Setenv("EXECUTION_CONTROL_TEMPORAL_NAMESPACE", "campus-agent-staging")
	t.Setenv("EXECUTION_CONTROL_TEMPORAL_WORKER_IDENTITY", "staging:gateway:001")
	t.Setenv("EXECUTION_CONTROL_TEMPORAL_WORKFLOW_ID_SALT", "workflow-salt")

	if _, err := LoadFromEnv(); err == nil {
		t.Fatal("expected deployed personal memory settings to be required")
	}
}

func TestLoadFromEnvForRoleScopesPersonalMemoryRequirements(t *testing.T) {
	t.Setenv("EXECUTION_CONTROL_RUNTIME_PROFILE", "staging")
	t.Setenv("EXECUTION_CONTROL_METRICS_BEARER_TOKEN", "metrics-token")
	t.Setenv("EXECUTION_CONTROL_TEMPORAL_ADDRESS", "temporal:7233")
	t.Setenv("EXECUTION_CONTROL_TEMPORAL_NAMESPACE", "campus-agent-staging")
	t.Setenv("EXECUTION_CONTROL_TEMPORAL_WORKER_IDENTITY", "staging:workflow-worker:001")
	t.Setenv("EXECUTION_CONTROL_TEMPORAL_WORKFLOW_ID_SALT", "workflow-salt")

	if _, err := LoadFromEnvForRole("workflow"); err != nil {
		t.Fatalf("workflow worker must not require personal memory config: %v", err)
	}
	if _, err := LoadFromEnvForRole("activity-finalization"); err != nil {
		t.Fatalf("finalization worker must not require personal memory config: %v", err)
	}
	if _, err := LoadFromEnvForRole("activity-context"); err == nil {
		t.Fatal("context worker must require personal memory config")
	}
	if _, err := LoadFromEnvForRole("activity-agent"); err != nil {
		t.Fatalf("agent worker must not require personal memory config: %v", err)
	}
	if _, err := LoadFromEnvForRole("activity-knowledge"); err == nil {
		t.Fatal("retired single knowledge worker role must be rejected")
	}
	if _, err := LoadFromEnvForRole("activity-knowledge-plan"); err != nil {
		t.Fatalf("knowledge plan worker must not require query-side personal memory config: %v", err)
	}
	if _, err := LoadFromEnvForRole("activity-knowledge-synthesis"); err != nil {
		t.Fatalf("knowledge synthesis worker must not require query-side personal memory config: %v", err)
	}
	if _, err := LoadFromEnvForRole("activity-knowledge-retrieval"); err == nil {
		t.Fatal("knowledge retrieval worker must require query-side personal memory config")
	}
	if _, err := LoadFromEnvForRole("activity-campus-services"); err != nil {
		t.Fatalf("campus services worker must not require personal memory config: %v", err)
	}
	if _, err := LoadFromEnvForRole("activity-notice"); err != nil {
		t.Fatalf("notice worker must not require personal memory config: %v", err)
	}
	if _, err := LoadFromEnvForRole("activity-navigation"); err != nil {
		t.Fatalf("navigation worker must not require personal memory config: %v", err)
	}
	setStagingPersonalMemoryEnv(t)
	if _, err := LoadFromEnvForRole("activity-context"); err != nil {
		t.Fatalf("context worker must accept personal memory config: %v", err)
	}
	if _, err := LoadFromEnvForRole("activity-knowledge-retrieval"); err != nil {
		t.Fatalf("knowledge retrieval worker recall must accept Hindsight config: %v", err)
	}
	if _, err := LoadFromEnvForRole("execution-control"); err != nil {
		t.Fatalf("execution-control must accept personal memory config: %v", err)
	}
}

func TestLoadFromEnvRejectsRetiredQdrantPersonalMemoryEnv(t *testing.T) {
	for _, tc := range []struct {
		name  string
		value string
	}{
		{"PERSONAL_MEMORY_COLLECTION", "personal_memory_v1"},
		{"PERSONAL_MEMORY_TOP_K", "5"},
		{"PERSONAL_MEMORY_MAX_CHARS", "1200"},
		{"PERSONAL_MEMORY_SCORE_THRESHOLD", "0"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			t.Setenv(tc.name, tc.value)
			if _, err := LoadFromEnv(); err == nil {
				t.Fatalf("expected retired personal memory env %s to be rejected", tc.name)
			} else if !strings.Contains(err.Error(), "is retired") {
				t.Fatalf("error = %q, want retired env diagnostic", err.Error())
			}
		})
	}
}

func TestLoadFromEnvRejectsRetiredPredecessorMemoryEnv(t *testing.T) {
	for _, tc := range []struct {
		name  string
		value string
	}{
		{"ZEP_BASE_URL", "https://api.getzep.com"},
		{"ZEP_API_KEY", "zep-key"},
		{"ZEP_PROJECT_SALT", "salt"},
		{"ZEP_TIMEOUT_SECONDS", "10"},
		{"ZEP_RECALL_MAX_CHARS", "2500"},
		{"ZEP_ASSISTANT_NAME", "校园助理"},
		{"ZEP_USER_NAME", "学生"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			t.Setenv(tc.name, tc.value)
			if _, err := LoadFromEnv(); err == nil {
				t.Fatalf("expected retired Hindsight-retired env %s to be rejected", tc.name)
			} else if !strings.Contains(err.Error(), "is retired") {
				t.Fatalf("error = %q, want retired env diagnostic", err.Error())
			}
		})
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
	t.Setenv("EXECUTION_CONTROL_DURABLE_WORKER_LOOP_STEP_ID", "capability:knowledge:rag_request")
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
		{"EXECUTION_CONTROL_DURABLE_WORKER_LOOP_STEP_ID", "capability:knowledge:rag_request"},
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
	setStagingPersonalMemoryEnv(t)

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
	} else if !strings.Contains(err.Error(), "EXECUTION_CONTROL_QUEUE_CAPACITY is retired") {
		t.Fatalf("error = %q, want retired queue capacity error", err.Error())
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
	setRuntimeConfigProfile(t, `{
  "schema_version": "campus_execution_control_runtime_profile.v1",
  "max_concurrent_answers": 4,
  "queue_capacity": 12,
  "queue_timeout_ms": 2500,
  "request_timeout_ms": 30000,
  "shutdown_grace_ms": 20000,
  "intent_policy_path": "/etc/campus-agent/intent-policy.v1.json",
  "lane_budgets": {
    "rag": {"max_concurrent": 2, "queue_capacity": 5, "queue_timeout_ms": 1500}
  },
  "otel": {
    "enabled": true,
    "endpoint": "http://collector:4318/v1/traces",
    "headers": "authorization=Bearer test",
    "service_name": "custom-execution-control",
    "export_timeout_ms": 750,
    "export_interval_ms": 15000,
    "metrics_enabled": true,
    "metrics_endpoint": "http://collector:4318/v1/metrics",
    "sample_ratio": 0.25,
    "allowed_attributes_version": "custom-attrs-v1",
    "temporal_tracing_enabled": true
  },
  "execution_audit": {
    "enabled": true,
    "url": "http://app-api:27031/api/internal/execution/audit-events",
    "shared_secret": "audit-secret",
    "timeout_ms": 250
  },
  "open_capabilities": ["campus_services", "notice"],
  "multi_step_workflow_enabled": true
}`)
	t.Setenv("EXECUTION_CONTROL_METRICS_BEARER_TOKEN", "metrics-token")
	t.Setenv("EXECUTION_CONTROL_WORKFLOW_RUN_DATABASE_URL", "postgres://workflow.example/db")
	t.Setenv("EXECUTION_CONTROL_WORKFLOW_RUN_AUTO_MIGRATE", "true")
	t.Setenv("PROMPT_RUNTIME_PROVIDER", "openai-responses")
	t.Setenv("EXECUTION_PROMPT_MODEL", "gpt-execution")
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
		!cfg.TemporalTracingEnabled ||
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
		cfg.ExecutionPromptModel != "gpt-execution" ||
		cfg.PromptRuntimeAPIKey != "prompt-key" ||
		cfg.PromptRuntimeTransport != "responses" ||
		cfg.PromptRuntimeBaseURL != "https://api.openai.com/v1" ||
		cfg.PromptStrictStructuredOutputs ||
		cfg.NoticeBodyObjectStoreBodyLimitBytes != 4096 {
		t.Fatalf("unexpected config: %#v", cfg)
	}
}

func TestLoadFromEnvRejectsRetiredSupervisorPromptModel(t *testing.T) {
	t.Setenv("SUPERVISOR_PROMPT_MODEL", "gpt-supervisor")

	if _, err := LoadFromEnv(); err == nil {
		t.Fatal("expected retired supervisor prompt model env to fail")
	} else if !strings.Contains(err.Error(), "SUPERVISOR_PROMPT_MODEL is retired") {
		t.Fatalf("error = %q, want retired supervisor prompt model error", err.Error())
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
