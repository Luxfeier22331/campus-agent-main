package config

import (
	"fmt"
	"os"
	"strings"

	env "github.com/caarlos0/env/v11"
)

type Config struct {
	AppName                           string
	DeploymentEnvironment             string
	Host                              string
	Port                              int
	RuntimeProfile                    string
	RuntimeRelease                    string
	AuthMode                          string
	BearerToken                       string
	WorkerSharedSecret                string
	DefaultActorID                    string
	DefaultActorRoles                 []string
	ExecutionResponseLimitBytes       int64
	ExecutionBreakerFailureThreshold  int
	ExecutionBreakerOpenMS            int
	ExecutionRetryMaxAttempts         int
	ExecutionRetryBaseMS              int
	MaxConcurrentAnswers              int
	QueueCapacity                     int
	QueueTimeoutMS                    int
	RequestTimeoutMS                  int
	RequestBodyLimitBytes             int64
	ExecutionTimeoutMS                int
	ExecutionCancelTimeoutMS          int
	ShutdownGraceMS                   int
	MetricsBearerToken                string
	IntentPolicyPath                  string
	OTelEnabled                       bool
	OTelEndpoint                      string
	OTelMetricsEnabled                bool
	OTelMetricsEndpoint               string
	OTelHeaders                       string
	OTelServiceName                   string
	OTelExportTimeoutMS               int
	OTelExportIntervalMS              int
	OTelSampleRatio                   float64
	OTelAllowedAttributesVersion      string
	TemporalTracingEnabled            bool
	ExecutionAuditEnabled             bool
	ExecutionAuditURL                 string
	ExecutionAuditSharedSecret        string
	ExecutionAuditTimeoutMS           int
	OpenTools                         []string
	MultiStepWorkflowEnabled          bool
	WorkflowRunDatabaseURL            string
	WorkflowRunAutoMigrate            bool
	RunProjectionDatabaseURL          string
	RunProjectionAutoMigrate          bool
	TemporalAddress                   string
	TemporalNamespace                 string
	TemporalTaskQueue                 string
	TemporalWorkerIdentity            string
	TemporalWorkflowIDSalt            string
	TemporalStartTimeoutMS            int
	AgentRuntimeBaseURL               string
	AgentRuntimeSharedSecret          string
	AgentRuntimeTimeoutMS             int
	AppAPIInternalBaseURL             string
	AppAPIInternalSharedSecret        string
	AppAPIInternalTimeoutMS           int
	ProviderConfigSnapshotPath        string
	ObservabilityConfigProjectionPath string
	QueryServingScopesPath            string
	InternalQuerySharedSecret         string
	ToolReadModelTrustedTimeRFC3339   string
	ToolReadModelTimeoutMS            int
	StructuredProjectionDatabaseURL   string
	ProviderPricingPath               string
	NoticeReadModelDatabaseURL        string
	NoticeReadModelTable              string
	QdrantURL                         string
	QdrantQueryAPIKey                 string
	QdrantTLSCACertPath               string
	QdrantTimeoutSeconds              float64
	RAGTopKMax                        int
	RAGSelectedEvidenceMax            int
	RAGRetrievalMaxConcurrent         int
	RAGSynthesisMaxConcurrent         int
	RAGEmbeddingTimeoutMS             int
	RAGQdrantTimeoutMS                int
	RAGProviderTimeoutMS              int
	RAGSynthesisMaxOutputTokens       int
	RAGSynthesisReasoningEffort       string
	RAGSynthesisStoreProviderOutput   bool
	RAGSynthesisTextVerbosity         string
	WorkerProfiles                    map[string]WorkerProfile
	PersonalMemoryRuntime             string
	PersonalMemoryBaseURL             string
	PersonalMemoryAPISecret           string
	PersonalMemoryOwnerSalt           string
	PersonalMemoryTimeoutSeconds      float64
	PersonalMemoryRecallLimit         int
	PersonalMemoryRecallMaxTokens     int
	PersonalMemoryContextCharBudget   int
	EmbeddingProvider                 string
	EmbeddingBaseURL                  string
	EmbeddingAPIKey                   string
	EmbeddingModel                    string
	EmbeddingDimensions               int
}

type WorkerProfile struct {
	ActivitySlots                int
	ActivityTaskPollers          int
	TaskQueueActivitiesPerSecond float64
	WorkerActivitiesPerSecond    float64
	WorkflowTaskSlots            int
	WorkflowTaskPollers          int
}

type envValues struct {
	AppName                           string `env:"CAMPUS_AGENT_APP_NAME" envDefault:"campus-agent"`
	DeploymentEnvironment             string `env:"DEPLOYMENT_ENVIRONMENT"`
	Host                              string `env:"CAMPUS_AGENT_HTTP_HOST" envDefault:"127.0.0.1"`
	Port                              int    `env:"CAMPUS_AGENT_HTTP_PORT" envDefault:"8000"`
	RuntimeProfile                    string `env:"EXECUTION_CONTROL_RUNTIME_PROFILE" envDefault:"local"`
	RuntimeRelease                    string `env:"EXECUTION_CONTROL_RUNTIME_RELEASE"`
	AuthMode                          string `env:"API_AUTH_MODE" envDefault:"bearer"`
	BearerToken                       string `env:"API_BEARER_TOKEN"`
	WorkerSharedSecret                string `env:"API_WORKER_SHARED_SECRET"`
	DefaultActorID                    string `env:"API_DEFAULT_ACTOR_ID"`
	MaxConcurrentAnswers              int
	QueueCapacity                     int
	QueueTimeoutMS                    int
	RequestTimeoutMS                  int
	RequestBodyLimitBytes             int64
	ShutdownGraceMS                   int
	MetricsBearerToken                string `env:"EXECUTION_CONTROL_METRICS_BEARER_TOKEN"`
	IntentPolicyPath                  string
	OTelEndpoint                      string
	OTelMetricsEndpoint               string
	OTelHeaders                       string `env:"EXECUTION_CONTROL_OTEL_EXPORTER_OTLP_HEADERS"`
	OTelServiceName                   string
	OTelExportTimeoutMS               int
	OTelExportIntervalMS              int
	OTelSampleRatio                   float64
	OTelAllowedAttributesVersion      string
	TemporalTracingEnabled            bool
	ExecutionAuditURL                 string `env:"EXECUTION_CONTROL_EXECUTION_AUDIT_URL"`
	ExecutionAuditSharedSecret        string `env:"EXECUTION_CONTROL_EXECUTION_AUDIT_SHARED_SECRET"`
	ExecutionAuditTimeoutMS           int
	WorkflowRunDatabaseURL            string `env:"EXECUTION_CONTROL_WORKFLOW_RUN_DATABASE_URL"`
	RunProjectionDatabaseURL          string `env:"EXECUTION_CONTROL_RUN_PROJECTION_DATABASE_URL"`
	TemporalAddress                   string `env:"EXECUTION_CONTROL_TEMPORAL_ADDRESS"`
	TemporalNamespace                 string `env:"EXECUTION_CONTROL_TEMPORAL_NAMESPACE"`
	TemporalTaskQueue                 string `env:"EXECUTION_CONTROL_TEMPORAL_TASK_QUEUE" envDefault:"campus-agent.workflow"`
	TemporalWorkerIdentity            string `env:"EXECUTION_CONTROL_TEMPORAL_WORKER_IDENTITY"`
	TemporalWorkflowIDSalt            string `env:"EXECUTION_CONTROL_TEMPORAL_WORKFLOW_ID_SALT"`
	TemporalStartTimeoutMS            int    `env:"EXECUTION_CONTROL_TEMPORAL_START_TIMEOUT_MS" envDefault:"5000"`
	AgentRuntimeBaseURL               string `env:"EXECUTION_CONTROL_AGENT_RUNTIME_BASE_URL"`
	AgentRuntimeSharedSecret          string `env:"EXECUTION_CONTROL_AGENT_RUNTIME_SHARED_SECRET"`
	AgentRuntimeTimeoutMS             int    `env:"EXECUTION_CONTROL_AGENT_RUNTIME_TIMEOUT_MS" envDefault:"30000"`
	AppAPIInternalBaseURL             string `env:"EXECUTION_CONTROL_APP_API_INTERNAL_BASE_URL"`
	AppAPIInternalSharedSecret        string `env:"EXECUTION_CONTROL_APP_API_INTERNAL_SHARED_SECRET"`
	AppAPIInternalTimeoutMS           int    `env:"EXECUTION_CONTROL_APP_API_INTERNAL_TIMEOUT_MS" envDefault:"1000"`
	ProviderConfigSnapshotPath        string `env:"EXECUTION_CONTROL_PROVIDER_CONFIG_SNAPSHOT_PATH"`
	ObservabilityConfigProjectionPath string
	QueryServingScopesPath            string
	InternalQuerySharedSecret         string `env:"EXECUTION_CONTROL_INTERNAL_QUERY_SHARED_SECRET"`
	ToolReadModelTrustedTimeRFC3339   string `env:"EXECUTION_CONTROL_TOOL_READ_MODEL_TRUSTED_TIME_RFC3339"`
	ToolReadModelTimeoutMS            int
	ProviderPricingPath               string
	NoticeReadModelTable              string  `env:"INTERNAL_NOTICE_READ_MODEL_TABLE" envDefault:"ingestion_projection.internal_notice_read_model"`
	QdrantURL                         string  `env:"QDRANT_URL"`
	QdrantQueryAPIKey                 string  `env:"QDRANT_QUERY_API_KEY"`
	QdrantTLSCACertPath               string  `env:"QDRANT_TLS_CA_CERT_PATH"`
	QdrantTimeoutSeconds              float64 `env:"QDRANT_TIMEOUT_SECONDS" envDefault:"10"`
	RAGTopKMax                        int
	RAGSelectedEvidenceMax            int
	RAGRetrievalMaxConcurrent         int
	RAGSynthesisMaxConcurrent         int
	RAGEmbeddingTimeoutMS             int
	RAGQdrantTimeoutMS                int
	RAGProviderTimeoutMS              int
	RAGSynthesisMaxOutputTokens       int
	RAGSynthesisReasoningEffort       string
	RAGSynthesisStoreProviderOutput   bool
	RAGSynthesisTextVerbosity         string
	PersonalMemoryRuntime             string
	PersonalMemoryBaseURL             string `env:"PERSONAL_MEMORY_BASE_URL"`
	PersonalMemoryAPISecret           string `env:"PERSONAL_MEMORY_API_SECRET"`
	PersonalMemoryOwnerSalt           string `env:"PERSONAL_MEMORY_OWNER_SALT"`
	PersonalMemoryTimeoutSeconds      float64
	PersonalMemoryRecallLimit         int
	PersonalMemoryRecallMaxTokens     int
	PersonalMemoryContextCharBudget   int
	EmbeddingProvider                 string `env:"EMBEDDING_PROVIDER"`
	EmbeddingBaseURL                  string `env:"EMBEDDING_BASE_URL"`
	EmbeddingAPIKey                   string `env:"EMBEDDING_API_KEY"`
	EmbeddingModel                    string `env:"EMBEDDING_MODEL"`
	EmbeddingDimensions               int    `env:"EMBEDDING_DIMENSIONS"`
}

func LoadFromEnv() (Config, error) {
	return LoadFromEnvForRole("")
}

func LoadFromEnvForRole(runtimeRole string) (Config, error) {
	if err := rejectRuntimeProfileOwnedEnvSettings(); err != nil {
		return Config{}, err
	}
	if err := rejectRetiredPromptRuntimeSettings(); err != nil {
		return Config{}, err
	}
	if err := rejectRetiredPythonBridgeSettings(); err != nil {
		return Config{}, err
	}
	values, err := parseEnvValues()
	if err != nil {
		return Config{}, err
	}
	runtimeConfigProfile, err := loadRuntimeConfigProfileFromEnv()
	if err != nil {
		return Config{}, err
	}
	values = applyRuntimeConfigProfileValues(values, runtimeConfigProfile)
	otelEnabled := false
	if runtimeConfigProfile.OTel != nil {
		otelEnabled = boolFromRuntimeProfile(runtimeConfigProfile.OTel.Enabled, otelEnabled)
	}
	otelMetricsEnabled := false
	if runtimeConfigProfile.OTel != nil {
		otelMetricsEnabled = boolFromRuntimeProfile(runtimeConfigProfile.OTel.MetricsEnabled, otelMetricsEnabled)
	}
	executionAuditEnabled := false
	if runtimeConfigProfile.ExecutionAudit != nil {
		executionAuditEnabled = boolFromRuntimeProfile(
			runtimeConfigProfile.ExecutionAudit.Enabled,
			executionAuditEnabled,
		)
	}
	runtimeProfile, err := normalizeRuntimeProfile(values.RuntimeProfile)
	if err != nil {
		return Config{}, err
	}
	if err := validateEnvValues(values, runtimeProfile, runtimeRole, otelEnabled); err != nil {
		return Config{}, err
	}
	workerProfiles, err := readWorkerProfilesStrict(values)
	if err != nil {
		return Config{}, err
	}
	workerProfiles, err = applyRuntimeConfigProfileWorkerProfiles(workerProfiles, runtimeConfigProfile)
	if err != nil {
		return Config{}, err
	}
	var openTools []string
	if runtimeConfigProfile.OpenTools != nil {
		openTools, err = validateOpenTools(runtimeConfigProfile.OpenTools)
		if err != nil {
			return Config{}, err
		}
	}
	multiStepWorkflowEnabled := boolFromRuntimeProfile(
		runtimeConfigProfile.MultiStepWorkflowEnabled,
		false,
	)
	workflowRunAutoMigrate, err := readBoolStrict("EXECUTION_CONTROL_WORKFLOW_RUN_AUTO_MIGRATE", false)
	if err != nil {
		return Config{}, err
	}
	if strings.TrimSpace(os.Getenv("EXECUTION_CONTROL_DURABLE_RUNTIME_DATABASE_URL")) != "" {
		return Config{}, fmt.Errorf("EXECUTION_CONTROL_DURABLE_RUNTIME_DATABASE_URL is retired; use EXECUTION_CONTROL_RUN_PROJECTION_DATABASE_URL")
	}
	if strings.TrimSpace(os.Getenv("EXECUTION_CONTROL_DURABLE_RUNTIME_AUTO_MIGRATE")) != "" {
		return Config{}, fmt.Errorf("EXECUTION_CONTROL_DURABLE_RUNTIME_AUTO_MIGRATE is retired; use EXECUTION_CONTROL_RUN_PROJECTION_AUTO_MIGRATE")
	}
	runProjectionAutoMigrate, err := readBoolStrict("EXECUTION_CONTROL_RUN_PROJECTION_AUTO_MIGRATE", false)
	if err != nil {
		return Config{}, err
	}
	embeddingDimensions, err := readNonNegativeIntStrict("EMBEDDING_DIMENSIONS", values.EmbeddingDimensions)
	if err != nil {
		return Config{}, err
	}
	if err := rejectRetiredDurableWorkerLoopSettings(); err != nil {
		return Config{}, err
	}
	if err := rejectRetiredDurableRecoveryLoopSettings(); err != nil {
		return Config{}, err
	}
	if err := rejectRetiredPersonalMemoryQdrantSettings(); err != nil {
		return Config{}, err
	}
	if err := rejectRetiredPredecessorMemorySettings(); err != nil {
		return Config{}, err
	}
	if err := validateTemporalSettings(values, runtimeProfile); err != nil {
		return Config{}, err
	}
	if err := validatePersonalMemorySettings(values, runtimeProfile, runtimeRole); err != nil {
		return Config{}, err
	}

	return Config{
		AppName:                           defaultString(strings.TrimSpace(values.AppName), "campus-agent"),
		DeploymentEnvironment:             defaultString(strings.TrimSpace(values.DeploymentEnvironment), runtimeProfile),
		Host:                              defaultString(strings.TrimSpace(values.Host), "127.0.0.1"),
		Port:                              values.Port,
		RuntimeProfile:                    runtimeProfile,
		RuntimeRelease:                    strings.TrimSpace(values.RuntimeRelease),
		AuthMode:                          defaultString(strings.TrimSpace(values.AuthMode), "bearer"),
		BearerToken:                       strings.TrimSpace(values.BearerToken),
		WorkerSharedSecret:                strings.TrimSpace(values.WorkerSharedSecret),
		DefaultActorID:                    strings.TrimSpace(values.DefaultActorID),
		DefaultActorRoles:                 readStringList("API_DEFAULT_ACTOR_ROLES"),
		MaxConcurrentAnswers:              values.MaxConcurrentAnswers,
		QueueCapacity:                     values.QueueCapacity,
		QueueTimeoutMS:                    values.QueueTimeoutMS,
		RequestTimeoutMS:                  values.RequestTimeoutMS,
		RequestBodyLimitBytes:             values.RequestBodyLimitBytes,
		ShutdownGraceMS:                   values.ShutdownGraceMS,
		MetricsBearerToken:                strings.TrimSpace(values.MetricsBearerToken),
		IntentPolicyPath:                  strings.TrimSpace(values.IntentPolicyPath),
		OTelEnabled:                       otelEnabled,
		OTelEndpoint:                      strings.TrimSpace(values.OTelEndpoint),
		OTelMetricsEnabled:                otelMetricsEnabled,
		OTelMetricsEndpoint:               strings.TrimSpace(values.OTelMetricsEndpoint),
		OTelHeaders:                       strings.TrimSpace(values.OTelHeaders),
		OTelServiceName:                   defaultString(strings.TrimSpace(values.OTelServiceName), "campus-execution-control"),
		OTelExportTimeoutMS:               values.OTelExportTimeoutMS,
		OTelExportIntervalMS:              values.OTelExportIntervalMS,
		OTelSampleRatio:                   values.OTelSampleRatio,
		OTelAllowedAttributesVersion:      defaultString(strings.TrimSpace(values.OTelAllowedAttributesVersion), "execution-control-otel-attrs-v1"),
		TemporalTracingEnabled:            values.TemporalTracingEnabled,
		ExecutionAuditEnabled:             executionAuditEnabled,
		ExecutionAuditURL:                 strings.TrimSpace(values.ExecutionAuditURL),
		ExecutionAuditSharedSecret:        strings.TrimSpace(values.ExecutionAuditSharedSecret),
		ExecutionAuditTimeoutMS:           values.ExecutionAuditTimeoutMS,
		OpenTools:                         openTools,
		MultiStepWorkflowEnabled:          multiStepWorkflowEnabled,
		WorkflowRunDatabaseURL:            readWorkflowRunDatabaseURL(values),
		WorkflowRunAutoMigrate:            workflowRunAutoMigrate,
		RunProjectionDatabaseURL:          readRunProjectionDatabaseURL(values),
		RunProjectionAutoMigrate:          runProjectionAutoMigrate,
		TemporalAddress:                   strings.TrimSpace(values.TemporalAddress),
		TemporalNamespace:                 strings.TrimSpace(values.TemporalNamespace),
		TemporalTaskQueue:                 defaultString(strings.TrimSpace(values.TemporalTaskQueue), "campus-agent.workflow"),
		TemporalWorkerIdentity:            strings.TrimSpace(values.TemporalWorkerIdentity),
		TemporalWorkflowIDSalt:            strings.TrimSpace(values.TemporalWorkflowIDSalt),
		TemporalStartTimeoutMS:            values.TemporalStartTimeoutMS,
		AgentRuntimeBaseURL:               strings.TrimRight(strings.TrimSpace(values.AgentRuntimeBaseURL), "/"),
		AgentRuntimeSharedSecret:          strings.TrimSpace(values.AgentRuntimeSharedSecret),
		AgentRuntimeTimeoutMS:             values.AgentRuntimeTimeoutMS,
		AppAPIInternalBaseURL:             strings.TrimRight(strings.TrimSpace(values.AppAPIInternalBaseURL), "/"),
		AppAPIInternalSharedSecret:        strings.TrimSpace(values.AppAPIInternalSharedSecret),
		AppAPIInternalTimeoutMS:           values.AppAPIInternalTimeoutMS,
		ProviderConfigSnapshotPath:        strings.TrimSpace(values.ProviderConfigSnapshotPath),
		ObservabilityConfigProjectionPath: strings.TrimSpace(values.ObservabilityConfigProjectionPath),
		QueryServingScopesPath:            strings.TrimSpace(values.QueryServingScopesPath),
		InternalQuerySharedSecret:         strings.TrimSpace(values.InternalQuerySharedSecret),
		ToolReadModelTrustedTimeRFC3339:   strings.TrimSpace(values.ToolReadModelTrustedTimeRFC3339),
		ToolReadModelTimeoutMS:            values.ToolReadModelTimeoutMS,
		StructuredProjectionDatabaseURL:   readStructuredProjectionDatabaseURL(),
		ProviderPricingPath:               strings.TrimSpace(values.ProviderPricingPath),
		NoticeReadModelDatabaseURL:        readNoticeReadModelDatabaseURL(),
		NoticeReadModelTable:              defaultString(strings.TrimSpace(values.NoticeReadModelTable), "ingestion_projection.internal_notice_read_model"),
		QdrantURL:                         strings.TrimRight(strings.TrimSpace(values.QdrantURL), "/"),
		QdrantQueryAPIKey:                 strings.TrimSpace(values.QdrantQueryAPIKey),
		QdrantTLSCACertPath:               strings.TrimSpace(values.QdrantTLSCACertPath),
		QdrantTimeoutSeconds:              values.QdrantTimeoutSeconds,
		RAGTopKMax:                        values.RAGTopKMax,
		RAGSelectedEvidenceMax:            values.RAGSelectedEvidenceMax,
		RAGRetrievalMaxConcurrent:         values.RAGRetrievalMaxConcurrent,
		RAGSynthesisMaxConcurrent:         values.RAGSynthesisMaxConcurrent,
		RAGEmbeddingTimeoutMS:             values.RAGEmbeddingTimeoutMS,
		RAGQdrantTimeoutMS:                values.RAGQdrantTimeoutMS,
		RAGProviderTimeoutMS:              values.RAGProviderTimeoutMS,
		RAGSynthesisMaxOutputTokens:       values.RAGSynthesisMaxOutputTokens,
		RAGSynthesisReasoningEffort:       strings.TrimSpace(values.RAGSynthesisReasoningEffort),
		RAGSynthesisStoreProviderOutput:   values.RAGSynthesisStoreProviderOutput,
		RAGSynthesisTextVerbosity:         strings.TrimSpace(values.RAGSynthesisTextVerbosity),
		WorkerProfiles:                    workerProfiles,
		PersonalMemoryRuntime:             defaultString(strings.TrimSpace(values.PersonalMemoryRuntime), "hindsight"),
		PersonalMemoryBaseURL:             strings.TrimRight(strings.TrimSpace(values.PersonalMemoryBaseURL), "/"),
		PersonalMemoryAPISecret:           strings.TrimSpace(values.PersonalMemoryAPISecret),
		PersonalMemoryOwnerSalt:           strings.TrimSpace(values.PersonalMemoryOwnerSalt),
		PersonalMemoryTimeoutSeconds:      values.PersonalMemoryTimeoutSeconds,
		PersonalMemoryRecallLimit:         values.PersonalMemoryRecallLimit,
		PersonalMemoryRecallMaxTokens:     values.PersonalMemoryRecallMaxTokens,
		PersonalMemoryContextCharBudget:   values.PersonalMemoryContextCharBudget,
		EmbeddingProvider:                 strings.TrimSpace(values.EmbeddingProvider),
		EmbeddingBaseURL:                  strings.TrimRight(strings.TrimSpace(values.EmbeddingBaseURL), "/"),
		EmbeddingAPIKey:                   strings.TrimSpace(values.EmbeddingAPIKey),
		EmbeddingModel:                    strings.TrimSpace(values.EmbeddingModel),
		EmbeddingDimensions:               embeddingDimensions,
	}, nil
}

func parseEnvValues() (envValues, error) {
	values := envValues{}
	if err := env.Parse(&values); err != nil {
		return envValues{}, fmt.Errorf("parse execution-control env: %w", err)
	}
	return values, nil
}

func validateEnvValues(values envValues, runtimeProfile string, runtimeRole string, otelEnabled bool) error {
	checks := []struct {
		name  string
		value int
	}{
		{"CAMPUS_AGENT_HTTP_PORT", values.Port},
		{"runtime profile max_concurrent_answers", values.MaxConcurrentAnswers},
		{"runtime profile queue_timeout_ms", values.QueueTimeoutMS},
		{"runtime profile request_timeout_ms", values.RequestTimeoutMS},
		{"runtime profile shutdown_grace_ms", values.ShutdownGraceMS},
		{"runtime profile otel.export_timeout_ms", values.OTelExportTimeoutMS},
		{"runtime profile otel.export_interval_ms", values.OTelExportIntervalMS},
		{"runtime profile execution_audit.timeout_ms", values.ExecutionAuditTimeoutMS},
		{"runtime profile tool_read_model_timeout_ms", values.ToolReadModelTimeoutMS},
		{"EXECUTION_CONTROL_TEMPORAL_START_TIMEOUT_MS", values.TemporalStartTimeoutMS},
		{"EXECUTION_CONTROL_AGENT_RUNTIME_TIMEOUT_MS", values.AgentRuntimeTimeoutMS},
		{"runtime profile rag.top_k_max", values.RAGTopKMax},
		{"runtime profile rag.selected_evidence_max", values.RAGSelectedEvidenceMax},
		{"runtime profile rag.retrieval_max_concurrent", values.RAGRetrievalMaxConcurrent},
		{"runtime profile rag.synthesis_max_concurrent", values.RAGSynthesisMaxConcurrent},
		{"runtime profile rag.embedding_timeout_ms", values.RAGEmbeddingTimeoutMS},
		{"runtime profile rag.qdrant_timeout_ms", values.RAGQdrantTimeoutMS},
		{"runtime profile rag.provider_timeout_ms", values.RAGProviderTimeoutMS},
		{"runtime profile rag.synthesis_generation.max_output_tokens", values.RAGSynthesisMaxOutputTokens},
		{"EXECUTION_CONTROL_APP_API_INTERNAL_TIMEOUT_MS", values.AppAPIInternalTimeoutMS},
	}
	for _, check := range checks {
		if check.value <= 0 {
			return fmt.Errorf("%s must be a positive integer", check.name)
		}
	}
	if values.QueueCapacity < 0 {
		return fmt.Errorf("runtime profile queue_capacity must be a non-negative integer")
	}
	if values.RequestBodyLimitBytes <= 0 {
		return fmt.Errorf("runtime profile request_body_limit_bytes must be a positive integer")
	}
	if values.QdrantTimeoutSeconds <= 0 {
		return fmt.Errorf("QDRANT_TIMEOUT_SECONDS must be greater than zero")
	}
	if values.PersonalMemoryTimeoutSeconds <= 0 {
		return fmt.Errorf("runtime profile personal_memory.timeout_seconds must be greater than zero")
	}
	if values.PersonalMemoryRecallLimit <= 0 {
		return fmt.Errorf("runtime profile personal_memory.recall_limit must be a positive integer")
	}
	if values.PersonalMemoryRecallMaxTokens <= 0 {
		return fmt.Errorf("runtime profile personal_memory.recall_max_tokens must be a positive integer")
	}
	if values.PersonalMemoryContextCharBudget <= 0 {
		return fmt.Errorf("runtime profile personal_memory.context_char_budget must be a positive integer")
	}
	if values.OTelSampleRatio < 0 || values.OTelSampleRatio > 1 {
		return fmt.Errorf("runtime profile otel.sample_ratio must be a number between 0 and 1")
	}
	switch strings.TrimSpace(values.RAGSynthesisReasoningEffort) {
	case "none", "minimal", "low", "medium", "high", "xhigh":
	default:
		return fmt.Errorf("runtime profile rag.synthesis_generation.reasoning_effort is unsupported")
	}
	switch strings.TrimSpace(values.RAGSynthesisTextVerbosity) {
	case "low", "medium", "high":
	default:
		return fmt.Errorf("runtime profile rag.synthesis_generation.text_verbosity is unsupported")
	}
	if values.TemporalTracingEnabled && !otelEnabled {
		return fmt.Errorf("runtime profile otel.enabled=true is required when otel.temporal_tracing_enabled=true")
	}
	if otelEnabled && strings.TrimSpace(values.RuntimeRelease) == "" {
		return fmt.Errorf("EXECUTION_CONTROL_RUNTIME_RELEASE is required when runtime profile otel.enabled=true")
	}
	if runtimeProfile != "local" &&
		roleRequiresMetricsBearerToken(runtimeRole) &&
		strings.TrimSpace(values.MetricsBearerToken) == "" {
		return fmt.Errorf(
			"EXECUTION_CONTROL_METRICS_BEARER_TOKEN is required when EXECUTION_CONTROL_RUNTIME_PROFILE=%s",
			runtimeProfile,
		)
	}
	if runtimeProfile != "local" &&
		roleRequiresRunProjectionDatabaseURL(runtimeRole) &&
		strings.TrimSpace(values.RunProjectionDatabaseURL) == "" {
		return fmt.Errorf(
			"EXECUTION_CONTROL_RUN_PROJECTION_DATABASE_URL is required when EXECUTION_CONTROL_RUNTIME_PROFILE=%s",
			runtimeProfile,
		)
	}
	if runtimeProfile != "local" &&
		roleRequiresAgentRuntimeClient(runtimeRole) &&
		(strings.TrimSpace(values.AgentRuntimeBaseURL) == "" ||
			strings.TrimSpace(values.AgentRuntimeSharedSecret) == "") {
		return fmt.Errorf(
			"EXECUTION_CONTROL_AGENT_RUNTIME_BASE_URL and EXECUTION_CONTROL_AGENT_RUNTIME_SHARED_SECRET are required when EXECUTION_CONTROL_RUNTIME_PROFILE=%s",
			runtimeProfile,
		)
	}
	return nil
}

func roleRequiresMetricsBearerToken(runtimeRole string) bool {
	switch normalizeRuntimeRole(runtimeRole) {
	case "", "execution-control":
		return true
	default:
		return false
	}
}

func roleRequiresRunProjectionDatabaseURL(runtimeRole string) bool {
	switch normalizeRuntimeRole(runtimeRole) {
	case "workflow", "personal-memory-runtime":
		return false
	default:
		return true
	}
}

func roleRequiresAgentRuntimeClient(runtimeRole string) bool {
	switch normalizeRuntimeRole(runtimeRole) {
	case "activity-agent":
		return true
	default:
		return false
	}
}

func validateTemporalSettings(values envValues, runtimeProfile string) error {
	if runtimeProfile == "local" &&
		strings.TrimSpace(values.TemporalAddress) == "" &&
		strings.TrimSpace(values.TemporalNamespace) == "" {
		return nil
	}
	required := []struct {
		name  string
		value string
	}{
		{"EXECUTION_CONTROL_TEMPORAL_ADDRESS", values.TemporalAddress},
		{"EXECUTION_CONTROL_TEMPORAL_NAMESPACE", values.TemporalNamespace},
		{"EXECUTION_CONTROL_TEMPORAL_WORKER_IDENTITY", values.TemporalWorkerIdentity},
		{"EXECUTION_CONTROL_TEMPORAL_WORKFLOW_ID_SALT", values.TemporalWorkflowIDSalt},
	}
	for _, item := range required {
		if strings.TrimSpace(item.value) == "" {
			return fmt.Errorf("%s is required for execution control Temporal runtime", item.name)
		}
	}
	if !strings.Contains(strings.TrimSpace(values.TemporalWorkerIdentity), ":") {
		return fmt.Errorf("EXECUTION_CONTROL_TEMPORAL_WORKER_IDENTITY must be <env>:<role>:<instance>")
	}
	return nil
}

func validatePersonalMemorySettings(
	values envValues,
	runtimeProfile string,
	runtimeRole string,
) error {
	role := normalizeRuntimeRole(runtimeRole)
	if runtimeProfile == "local" {
		return nil
	}
	switch role {
	case "workflow",
		"activity-agent",
		"activity-knowledge":
		return nil
	}
	if strings.TrimSpace(values.PersonalMemoryRuntime) != "" &&
		strings.TrimSpace(values.PersonalMemoryRuntime) != "hindsight" {
		return fmt.Errorf("PERSONAL_MEMORY_RUNTIME must be hindsight")
	}
	required := []struct {
		name  string
		value string
	}{
		{"PERSONAL_MEMORY_BASE_URL", values.PersonalMemoryBaseURL},
		{"PERSONAL_MEMORY_API_SECRET", values.PersonalMemoryAPISecret},
		{"PERSONAL_MEMORY_OWNER_SALT", values.PersonalMemoryOwnerSalt},
	}
	for _, item := range required {
		if strings.TrimSpace(item.value) == "" {
			return fmt.Errorf("%s is required for deployed Hindsight memory runtime", item.name)
		}
	}
	return nil
}

func normalizeRuntimeRole(value string) string {
	switch strings.TrimSpace(value) {
	case "activity-agent":
		return "activity-agent"
	case "activity-core":
		return "activity-core"
	case "activity-knowledge":
		return "activity-knowledge"
	case "workflow":
		return "workflow"
	case "execution-control":
		return "execution-control"
	case "personal-memory-runtime":
		return "personal-memory-runtime"
	default:
		return strings.TrimSpace(value)
	}
}
