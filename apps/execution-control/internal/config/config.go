package config

import (
	"fmt"
	"os"
	"strings"

	env "github.com/caarlos0/env/v11"
)

type Config struct {
	AppName                             string
	DeploymentEnvironment               string
	Host                                string
	Port                                int
	RuntimeProfile                      string
	RuntimeRelease                      string
	AuthMode                            string
	BearerToken                         string
	WorkerSharedSecret                  string
	DefaultActorID                      string
	DefaultActorRoles                   []string
	BridgeResponseLimitBytes            int64
	BridgeBreakerFailureThreshold       int
	BridgeBreakerOpenMS                 int
	BridgeRetryMaxAttempts              int
	BridgeRetryBaseMS                   int
	MaxConcurrentAnswers                int
	QueueCapacity                       int
	QueueTimeoutMS                      int
	RequestTimeoutMS                    int
	RequestBodyLimitBytes               int64
	BridgeTimeoutMS                     int
	BridgeCancelTimeoutMS               int
	ShutdownGraceMS                     int
	MetricsBearerToken                  string
	IntentPolicyPath                    string
	LaneBudgets                         map[string]LaneBudget
	OTelEnabled                         bool
	OTelEndpoint                        string
	OTelMetricsEnabled                  bool
	OTelMetricsEndpoint                 string
	OTelHeaders                         string
	OTelServiceName                     string
	OTelExportTimeoutMS                 int
	OTelExportIntervalMS                int
	OTelSampleRatio                     float64
	OTelAllowedAttributesVersion        string
	TemporalTracingEnabled              bool
	ExecutionAuditEnabled               bool
	ExecutionAuditURL                   string
	ExecutionAuditSharedSecret          string
	ExecutionAuditTimeoutMS             int
	OpenCapabilities                    []string
	MultiStepWorkflowEnabled            bool
	WorkflowRunDatabaseURL              string
	WorkflowRunAutoMigrate              bool
	RunProjectionDatabaseURL            string
	RunProjectionAutoMigrate            bool
	TemporalAddress                     string
	TemporalNamespace                   string
	TemporalTaskQueue                   string
	TemporalWorkerIdentity              string
	TemporalWorkflowIDSalt              string
	TemporalStartTimeoutMS              int
	AgentRuntimeBaseURL                 string
	AgentRuntimeSharedSecret            string
	AgentRuntimeTimeoutMS               int
	AppAPIInternalBaseURL               string
	AppAPIInternalSharedSecret          string
	AppAPIInternalTimeoutMS             int
	QueryServingScopesPath              string
	InternalQuerySharedSecret           string
	StructuredQueryTrustedTimeRFC3339   string
	StructuredQueryTimeoutMS            int
	StructuredProjectionDatabaseURL     string
	ProviderPricingPath                 string
	NoticeReadModelDatabaseURL          string
	NoticeReadModelTable                string
	NoticeBodyObjectStoreEndpoint       string
	NoticeBodyObjectStoreAccessKey      string
	NoticeBodyObjectStoreSecretKey      string
	NoticeBodyObjectStoreRegion         string
	NoticeBodyObjectStoreBucket         string
	NoticeBodyObjectStoreBodyLimitBytes int64
	QdrantURL                           string
	QdrantQueryAPIKey                   string
	QdrantTLSCACertPath                 string
	QdrantTimeoutSeconds                float64
	RAGTopKMax                          int
	RAGSelectedEvidenceMax              int
	RAGRetrievalMaxConcurrent           int
	RAGSynthesisMaxConcurrent           int
	RAGEmbeddingTimeoutMS               int
	RAGQdrantTimeoutMS                  int
	RAGProviderTimeoutMS                int
	WorkerProfiles                      map[string]WorkerProfile
	PersonalMemoryRuntime               string
	PersonalMemoryBaseURL               string
	PersonalMemoryAPISecret             string
	PersonalMemoryOwnerSalt             string
	PersonalMemoryTimeoutSeconds        float64
	PersonalMemoryRecallLimit           int
	PersonalMemoryRecallMaxChars        int
	EmbeddingProvider                   string
	EmbeddingBaseURL                    string
	EmbeddingAPIKey                     string
	EmbeddingModel                      string
	EmbeddingDimensions                 int
}

type LaneBudget struct {
	MaxConcurrent  int
	QueueCapacity  int
	QueueTimeoutMS int
}

type WorkerProfile struct {
	ActivitySlots                int
	ActivityTaskPollers          int
	TaskQueueActivitiesPerSecond float64
	WorkerActivitiesPerSecond    float64
	WorkflowTaskSlots            int
	WorkflowTaskPollers          int
}

var laneNames = []string{"rag", "navigation", "campus_services", "notice", "default"}

type envValues struct {
	AppName                             string `env:"CAMPUS_AGENT_APP_NAME" envDefault:"campus-agent"`
	DeploymentEnvironment               string `env:"DEPLOYMENT_ENVIRONMENT"`
	Host                                string `env:"CAMPUS_AGENT_HTTP_HOST" envDefault:"127.0.0.1"`
	Port                                int    `env:"CAMPUS_AGENT_HTTP_PORT" envDefault:"8000"`
	RuntimeProfile                      string `env:"EXECUTION_CONTROL_RUNTIME_PROFILE" envDefault:"local"`
	RuntimeRelease                      string `env:"EXECUTION_CONTROL_RUNTIME_RELEASE"`
	AuthMode                            string `env:"API_AUTH_MODE" envDefault:"bearer"`
	BearerToken                         string `env:"API_BEARER_TOKEN"`
	WorkerSharedSecret                  string `env:"API_WORKER_SHARED_SECRET"`
	DefaultActorID                      string `env:"API_DEFAULT_ACTOR_ID"`
	MaxConcurrentAnswers                int
	QueueCapacity                       int
	QueueTimeoutMS                      int
	RequestTimeoutMS                    int
	RequestBodyLimitBytes               int64
	ShutdownGraceMS                     int
	MetricsBearerToken                  string `env:"EXECUTION_CONTROL_METRICS_BEARER_TOKEN"`
	IntentPolicyPath                    string
	OTelEndpoint                        string
	OTelMetricsEndpoint                 string
	OTelHeaders                         string `env:"EXECUTION_CONTROL_OTEL_EXPORTER_OTLP_HEADERS"`
	OTelServiceName                     string
	OTelExportTimeoutMS                 int
	OTelExportIntervalMS                int
	OTelSampleRatio                     float64
	OTelAllowedAttributesVersion        string
	TemporalTracingEnabled              bool
	ExecutionAuditURL                   string `env:"EXECUTION_CONTROL_EXECUTION_AUDIT_URL"`
	ExecutionAuditSharedSecret          string `env:"EXECUTION_CONTROL_EXECUTION_AUDIT_SHARED_SECRET"`
	ExecutionAuditTimeoutMS             int
	WorkflowRunDatabaseURL              string `env:"EXECUTION_CONTROL_WORKFLOW_RUN_DATABASE_URL"`
	RunProjectionDatabaseURL            string `env:"EXECUTION_CONTROL_RUN_PROJECTION_DATABASE_URL"`
	TemporalAddress                     string `env:"EXECUTION_CONTROL_TEMPORAL_ADDRESS"`
	TemporalNamespace                   string `env:"EXECUTION_CONTROL_TEMPORAL_NAMESPACE"`
	TemporalTaskQueue                   string `env:"EXECUTION_CONTROL_TEMPORAL_TASK_QUEUE" envDefault:"campus-agent.workflow"`
	TemporalWorkerIdentity              string `env:"EXECUTION_CONTROL_TEMPORAL_WORKER_IDENTITY"`
	TemporalWorkflowIDSalt              string `env:"EXECUTION_CONTROL_TEMPORAL_WORKFLOW_ID_SALT"`
	TemporalStartTimeoutMS              int    `env:"EXECUTION_CONTROL_TEMPORAL_START_TIMEOUT_MS" envDefault:"5000"`
	AgentRuntimeBaseURL                 string `env:"EXECUTION_CONTROL_AGENT_RUNTIME_BASE_URL"`
	AgentRuntimeSharedSecret            string `env:"EXECUTION_CONTROL_AGENT_RUNTIME_SHARED_SECRET"`
	AgentRuntimeTimeoutMS               int    `env:"EXECUTION_CONTROL_AGENT_RUNTIME_TIMEOUT_MS" envDefault:"30000"`
	AppAPIInternalBaseURL               string `env:"EXECUTION_CONTROL_APP_API_INTERNAL_BASE_URL"`
	AppAPIInternalSharedSecret          string `env:"EXECUTION_CONTROL_APP_API_INTERNAL_SHARED_SECRET"`
	AppAPIInternalTimeoutMS             int    `env:"EXECUTION_CONTROL_APP_API_INTERNAL_TIMEOUT_MS" envDefault:"1000"`
	QueryServingScopesPath              string
	InternalQuerySharedSecret           string `env:"EXECUTION_CONTROL_INTERNAL_QUERY_SHARED_SECRET"`
	StructuredQueryTrustedTimeRFC3339   string `env:"EXECUTION_CONTROL_STRUCTURED_QUERY_TRUSTED_TIME_RFC3339"`
	StructuredQueryTimeoutMS            int
	ProviderPricingPath                 string
	NoticeReadModelTable                string  `env:"INTERNAL_NOTICE_READ_MODEL_TABLE" envDefault:"ingestion_projection.internal_notice_read_model"`
	NoticeBodyObjectStoreEndpoint       string  `env:"EXECUTION_CONTROL_NOTICE_BODY_OBJECT_STORE_ENDPOINT"`
	NoticeBodyObjectStoreAccessKey      string  `env:"EXECUTION_CONTROL_NOTICE_BODY_OBJECT_STORE_ACCESS_KEY"`
	NoticeBodyObjectStoreSecretKey      string  `env:"EXECUTION_CONTROL_NOTICE_BODY_OBJECT_STORE_SECRET_KEY"`
	NoticeBodyObjectStoreRegion         string  `env:"EXECUTION_CONTROL_NOTICE_BODY_OBJECT_STORE_REGION" envDefault:"us-east-1"`
	NoticeBodyObjectStoreBucket         string  `env:"EXECUTION_CONTROL_NOTICE_BODY_OBJECT_STORE_BUCKET"`
	NoticeBodyObjectStoreBodyLimitBytes int64   `env:"EXECUTION_CONTROL_NOTICE_BODY_LIMIT_BYTES" envDefault:"1048576"`
	QdrantURL                           string  `env:"QDRANT_URL"`
	QdrantQueryAPIKey                   string  `env:"QDRANT_QUERY_API_KEY"`
	QdrantTLSCACertPath                 string  `env:"QDRANT_TLS_CA_CERT_PATH"`
	QdrantTimeoutSeconds                float64 `env:"QDRANT_TIMEOUT_SECONDS" envDefault:"10"`
	RAGTopKMax                          int
	RAGSelectedEvidenceMax              int
	RAGRetrievalMaxConcurrent           int
	RAGSynthesisMaxConcurrent           int
	RAGEmbeddingTimeoutMS               int
	RAGQdrantTimeoutMS                  int
	RAGProviderTimeoutMS                int
	PersonalMemoryRuntime               string
	PersonalMemoryBaseURL               string `env:"PERSONAL_MEMORY_BASE_URL"`
	PersonalMemoryAPISecret             string `env:"PERSONAL_MEMORY_API_SECRET"`
	PersonalMemoryOwnerSalt             string `env:"PERSONAL_MEMORY_OWNER_SALT"`
	PersonalMemoryTimeoutSeconds        float64
	PersonalMemoryRecallLimit           int
	PersonalMemoryRecallMaxChars        int
	EmbeddingProvider                   string `env:"EMBEDDING_PROVIDER"`
	EmbeddingBaseURL                    string `env:"EMBEDDING_BASE_URL"`
	EmbeddingAPIKey                     string `env:"EMBEDDING_API_KEY"`
	EmbeddingModel                      string `env:"EMBEDDING_MODEL"`
	EmbeddingDimensions                 int    `env:"EMBEDDING_DIMENSIONS"`
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
	if err := validateEnvValues(values, runtimeProfile, otelEnabled); err != nil {
		return Config{}, err
	}
	laneBudgets := defaultLaneBudgets(values.MaxConcurrentAnswers, values.QueueCapacity, values.QueueTimeoutMS)
	laneBudgets, err = applyRuntimeConfigProfileLaneBudgets(laneBudgets, runtimeConfigProfile)
	if err != nil {
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
	var openCapabilities []string
	if runtimeConfigProfile.OpenCapabilities != nil {
		openCapabilities, err = validateOpenCapabilities(runtimeConfigProfile.OpenCapabilities)
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
	if err := rejectRetiredPythonBridgeSettings(); err != nil {
		return Config{}, err
	}
	if err := rejectRetiredSupervisorSettings(); err != nil {
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
		AppName:                             defaultString(strings.TrimSpace(values.AppName), "campus-agent"),
		DeploymentEnvironment:               defaultString(strings.TrimSpace(values.DeploymentEnvironment), runtimeProfile),
		Host:                                defaultString(strings.TrimSpace(values.Host), "127.0.0.1"),
		Port:                                values.Port,
		RuntimeProfile:                      runtimeProfile,
		RuntimeRelease:                      strings.TrimSpace(values.RuntimeRelease),
		AuthMode:                            defaultString(strings.TrimSpace(values.AuthMode), "bearer"),
		BearerToken:                         strings.TrimSpace(values.BearerToken),
		WorkerSharedSecret:                  strings.TrimSpace(values.WorkerSharedSecret),
		DefaultActorID:                      strings.TrimSpace(values.DefaultActorID),
		DefaultActorRoles:                   readStringList("API_DEFAULT_ACTOR_ROLES"),
		MaxConcurrentAnswers:                values.MaxConcurrentAnswers,
		QueueCapacity:                       values.QueueCapacity,
		QueueTimeoutMS:                      values.QueueTimeoutMS,
		RequestTimeoutMS:                    values.RequestTimeoutMS,
		RequestBodyLimitBytes:               values.RequestBodyLimitBytes,
		ShutdownGraceMS:                     values.ShutdownGraceMS,
		MetricsBearerToken:                  strings.TrimSpace(values.MetricsBearerToken),
		IntentPolicyPath:                    strings.TrimSpace(values.IntentPolicyPath),
		LaneBudgets:                         laneBudgets,
		OTelEnabled:                         otelEnabled,
		OTelEndpoint:                        strings.TrimSpace(values.OTelEndpoint),
		OTelMetricsEnabled:                  otelMetricsEnabled,
		OTelMetricsEndpoint:                 strings.TrimSpace(values.OTelMetricsEndpoint),
		OTelHeaders:                         strings.TrimSpace(values.OTelHeaders),
		OTelServiceName:                     defaultString(strings.TrimSpace(values.OTelServiceName), "campus-execution-control"),
		OTelExportTimeoutMS:                 values.OTelExportTimeoutMS,
		OTelExportIntervalMS:                values.OTelExportIntervalMS,
		OTelSampleRatio:                     values.OTelSampleRatio,
		OTelAllowedAttributesVersion:        defaultString(strings.TrimSpace(values.OTelAllowedAttributesVersion), "execution-control-otel-attrs-v1"),
		TemporalTracingEnabled:              values.TemporalTracingEnabled,
		ExecutionAuditEnabled:               executionAuditEnabled,
		ExecutionAuditURL:                   strings.TrimSpace(values.ExecutionAuditURL),
		ExecutionAuditSharedSecret:          strings.TrimSpace(values.ExecutionAuditSharedSecret),
		ExecutionAuditTimeoutMS:             values.ExecutionAuditTimeoutMS,
		OpenCapabilities:                    openCapabilities,
		MultiStepWorkflowEnabled:            multiStepWorkflowEnabled,
		WorkflowRunDatabaseURL:              readWorkflowRunDatabaseURL(values),
		WorkflowRunAutoMigrate:              workflowRunAutoMigrate,
		RunProjectionDatabaseURL:            readRunProjectionDatabaseURL(values),
		RunProjectionAutoMigrate:            runProjectionAutoMigrate,
		TemporalAddress:                     strings.TrimSpace(values.TemporalAddress),
		TemporalNamespace:                   strings.TrimSpace(values.TemporalNamespace),
		TemporalTaskQueue:                   defaultString(strings.TrimSpace(values.TemporalTaskQueue), "campus-agent.workflow"),
		TemporalWorkerIdentity:              strings.TrimSpace(values.TemporalWorkerIdentity),
		TemporalWorkflowIDSalt:              strings.TrimSpace(values.TemporalWorkflowIDSalt),
		TemporalStartTimeoutMS:              values.TemporalStartTimeoutMS,
		AgentRuntimeBaseURL:                 strings.TrimRight(strings.TrimSpace(values.AgentRuntimeBaseURL), "/"),
		AgentRuntimeSharedSecret:            strings.TrimSpace(values.AgentRuntimeSharedSecret),
		AgentRuntimeTimeoutMS:               values.AgentRuntimeTimeoutMS,
		AppAPIInternalBaseURL:               strings.TrimRight(strings.TrimSpace(values.AppAPIInternalBaseURL), "/"),
		AppAPIInternalSharedSecret:          strings.TrimSpace(values.AppAPIInternalSharedSecret),
		AppAPIInternalTimeoutMS:             values.AppAPIInternalTimeoutMS,
		QueryServingScopesPath:              strings.TrimSpace(values.QueryServingScopesPath),
		InternalQuerySharedSecret:           strings.TrimSpace(values.InternalQuerySharedSecret),
		StructuredQueryTrustedTimeRFC3339:   strings.TrimSpace(values.StructuredQueryTrustedTimeRFC3339),
		StructuredQueryTimeoutMS:            values.StructuredQueryTimeoutMS,
		StructuredProjectionDatabaseURL:     readStructuredProjectionDatabaseURL(),
		ProviderPricingPath:                 strings.TrimSpace(values.ProviderPricingPath),
		NoticeReadModelDatabaseURL:          readNoticeReadModelDatabaseURL(),
		NoticeReadModelTable:                defaultString(strings.TrimSpace(values.NoticeReadModelTable), "ingestion_projection.internal_notice_read_model"),
		NoticeBodyObjectStoreEndpoint:       strings.TrimSpace(values.NoticeBodyObjectStoreEndpoint),
		NoticeBodyObjectStoreAccessKey:      strings.TrimSpace(values.NoticeBodyObjectStoreAccessKey),
		NoticeBodyObjectStoreSecretKey:      strings.TrimSpace(values.NoticeBodyObjectStoreSecretKey),
		NoticeBodyObjectStoreRegion:         defaultString(strings.TrimSpace(values.NoticeBodyObjectStoreRegion), "us-east-1"),
		NoticeBodyObjectStoreBucket:         strings.TrimSpace(values.NoticeBodyObjectStoreBucket),
		NoticeBodyObjectStoreBodyLimitBytes: values.NoticeBodyObjectStoreBodyLimitBytes,
		QdrantURL:                           strings.TrimRight(strings.TrimSpace(values.QdrantURL), "/"),
		QdrantQueryAPIKey:                   strings.TrimSpace(values.QdrantQueryAPIKey),
		QdrantTLSCACertPath:                 strings.TrimSpace(values.QdrantTLSCACertPath),
		QdrantTimeoutSeconds:                values.QdrantTimeoutSeconds,
		RAGTopKMax:                          values.RAGTopKMax,
		RAGSelectedEvidenceMax:              values.RAGSelectedEvidenceMax,
		RAGRetrievalMaxConcurrent:           values.RAGRetrievalMaxConcurrent,
		RAGSynthesisMaxConcurrent:           values.RAGSynthesisMaxConcurrent,
		RAGEmbeddingTimeoutMS:               values.RAGEmbeddingTimeoutMS,
		RAGQdrantTimeoutMS:                  values.RAGQdrantTimeoutMS,
		RAGProviderTimeoutMS:                values.RAGProviderTimeoutMS,
		WorkerProfiles:                      workerProfiles,
		PersonalMemoryRuntime:               defaultString(strings.TrimSpace(values.PersonalMemoryRuntime), "hindsight"),
		PersonalMemoryBaseURL:               strings.TrimRight(strings.TrimSpace(values.PersonalMemoryBaseURL), "/"),
		PersonalMemoryAPISecret:             strings.TrimSpace(values.PersonalMemoryAPISecret),
		PersonalMemoryOwnerSalt:             strings.TrimSpace(values.PersonalMemoryOwnerSalt),
		PersonalMemoryTimeoutSeconds:        values.PersonalMemoryTimeoutSeconds,
		PersonalMemoryRecallLimit:           values.PersonalMemoryRecallLimit,
		PersonalMemoryRecallMaxChars:        values.PersonalMemoryRecallMaxChars,
		EmbeddingProvider:                   strings.TrimSpace(values.EmbeddingProvider),
		EmbeddingBaseURL:                    strings.TrimRight(strings.TrimSpace(values.EmbeddingBaseURL), "/"),
		EmbeddingAPIKey:                     strings.TrimSpace(values.EmbeddingAPIKey),
		EmbeddingModel:                      strings.TrimSpace(values.EmbeddingModel),
		EmbeddingDimensions:                 embeddingDimensions,
	}, nil
}

func parseEnvValues() (envValues, error) {
	values := envValues{}
	if err := env.Parse(&values); err != nil {
		return envValues{}, fmt.Errorf("parse execution-control env: %w", err)
	}
	return values, nil
}

func validateEnvValues(values envValues, runtimeProfile string, otelEnabled bool) error {
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
		{"runtime profile structured_query_timeout_ms", values.StructuredQueryTimeoutMS},
		{"EXECUTION_CONTROL_TEMPORAL_START_TIMEOUT_MS", values.TemporalStartTimeoutMS},
		{"EXECUTION_CONTROL_AGENT_RUNTIME_TIMEOUT_MS", values.AgentRuntimeTimeoutMS},
		{"runtime profile rag.top_k_max", values.RAGTopKMax},
		{"runtime profile rag.selected_evidence_max", values.RAGSelectedEvidenceMax},
		{"runtime profile rag.retrieval_max_concurrent", values.RAGRetrievalMaxConcurrent},
		{"runtime profile rag.synthesis_max_concurrent", values.RAGSynthesisMaxConcurrent},
		{"runtime profile rag.embedding_timeout_ms", values.RAGEmbeddingTimeoutMS},
		{"runtime profile rag.qdrant_timeout_ms", values.RAGQdrantTimeoutMS},
		{"runtime profile rag.provider_timeout_ms", values.RAGProviderTimeoutMS},
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
	if values.NoticeBodyObjectStoreBodyLimitBytes <= 0 {
		return fmt.Errorf("EXECUTION_CONTROL_NOTICE_BODY_LIMIT_BYTES must be a positive integer")
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
	if values.PersonalMemoryRecallMaxChars <= 0 {
		return fmt.Errorf("runtime profile personal_memory.recall_max_chars must be a positive integer")
	}
	if values.OTelSampleRatio < 0 || values.OTelSampleRatio > 1 {
		return fmt.Errorf("runtime profile otel.sample_ratio must be a number between 0 and 1")
	}
	if values.TemporalTracingEnabled && !otelEnabled {
		return fmt.Errorf("runtime profile otel.enabled=true is required when otel.temporal_tracing_enabled=true")
	}
	if otelEnabled && strings.TrimSpace(values.RuntimeRelease) == "" {
		return fmt.Errorf("EXECUTION_CONTROL_RUNTIME_RELEASE is required when runtime profile otel.enabled=true")
	}
	if runtimeProfile != "local" && strings.TrimSpace(values.MetricsBearerToken) == "" {
		return fmt.Errorf(
			"EXECUTION_CONTROL_METRICS_BEARER_TOKEN is required when EXECUTION_CONTROL_RUNTIME_PROFILE=%s",
			runtimeProfile,
		)
	}
	return nil
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
	if role == "activity-knowledge" {
		return fmt.Errorf("activity-knowledge is retired; use activity-knowledge-plan, activity-knowledge-retrieval, or activity-knowledge-synthesis")
	}
	if runtimeProfile == "local" {
		return nil
	}
	switch role {
	case "workflow",
		"activity-agent",
		"activity-finalization",
		"activity-campus-services",
		"activity-notice",
		"activity-navigation",
		"activity-knowledge-plan",
		"activity-knowledge-synthesis":
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
	case "activity-context", "activity-worker-context", "context":
		return "activity-context"
	case "activity-agent", "activity-worker-agent", "agent":
		return "activity-agent"
	case "activity-knowledge", "activity-worker-knowledge", "knowledge":
		return "activity-knowledge"
	case "activity-knowledge-plan", "activity-worker-knowledge-plan", "knowledge-plan":
		return "activity-knowledge-plan"
	case "activity-knowledge-retrieval", "activity-worker-knowledge-retrieval", "knowledge-retrieval":
		return "activity-knowledge-retrieval"
	case "activity-knowledge-synthesis", "activity-worker-knowledge-synthesis", "knowledge-synthesis":
		return "activity-knowledge-synthesis"
	case "activity-campus-services", "activity-worker-campus-services", "campus_services":
		return "activity-campus-services"
	case "activity-notice", "activity-worker-notice", "notice":
		return "activity-notice"
	case "activity-navigation", "activity-worker-navigation", "navigation":
		return "activity-navigation"
	case "activity-finalization", "activity-worker-finalization", "finalization":
		return "activity-finalization"
	case "workflow", "workflow-worker":
		return "workflow"
	case "execution-control", "http", "api":
		return "execution-control"
	default:
		return strings.TrimSpace(value)
	}
}
