package config

import (
	"fmt"
	"os"
	"strconv"
	"strings"

	env "github.com/caarlos0/env/v11"
)

type Config struct {
	AppName                             string
	Host                                string
	Port                                int
	RuntimeProfile                      string
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
	QueryServingScopesPath              string
	InternalQuerySharedSecret           string
	StructuredQueryTrustedTimeRFC3339   string
	StructuredQueryTimeoutMS            int
	StructuredProjectionDatabaseURL     string
	PromptRuntimeProvider               string
	ProviderPricingPath                 string
	SupervisorPromptModel               string
	AgentPromptModel                    string
	PromptRuntimeAPIKey                 string
	PromptRuntimeTransport              string
	PromptRuntimeBaseURL                string
	PromptStrictStructuredOutputs       bool
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
	QdrantWriteAPIKey                   string
	QdrantTLSCACertPath                 string
	QdrantTimeoutSeconds                float64
	PersonalMemoryCollection            string
	PersonalMemoryTopK                  int
	PersonalMemoryMaxChars              int
	PersonalMemoryScoreThreshold        float64
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

type envValues struct {
	AppName                             string  `env:"CAMPUS_AGENT_APP_NAME" envDefault:"campus-agent"`
	Host                                string  `env:"CAMPUS_AGENT_HTTP_HOST" envDefault:"127.0.0.1"`
	Port                                int     `env:"CAMPUS_AGENT_HTTP_PORT" envDefault:"8000"`
	RuntimeProfile                      string  `env:"EXECUTION_CONTROL_RUNTIME_PROFILE" envDefault:"local"`
	AuthMode                            string  `env:"API_AUTH_MODE" envDefault:"bearer"`
	BearerToken                         string  `env:"API_BEARER_TOKEN"`
	WorkerSharedSecret                  string  `env:"API_WORKER_SHARED_SECRET"`
	DefaultActorID                      string  `env:"API_DEFAULT_ACTOR_ID"`
	MaxConcurrentAnswers                int     `env:"EXECUTION_CONTROL_MAX_CONCURRENT_ANSWERS" envDefault:"8"`
	QueueCapacity                       int     `env:"EXECUTION_CONTROL_QUEUE_CAPACITY" envDefault:"24"`
	QueueTimeoutMS                      int     `env:"EXECUTION_CONTROL_QUEUE_TIMEOUT_MS" envDefault:"3000"`
	RequestTimeoutMS                    int     `env:"EXECUTION_CONTROL_REQUEST_TIMEOUT_MS" envDefault:"45000"`
	RequestBodyLimitBytes               int64   `env:"EXECUTION_CONTROL_REQUEST_BODY_LIMIT_BYTES" envDefault:"1048576"`
	ShutdownGraceMS                     int     `env:"EXECUTION_CONTROL_SHUTDOWN_GRACE_MS" envDefault:"45000"`
	MetricsBearerToken                  string  `env:"EXECUTION_CONTROL_METRICS_BEARER_TOKEN"`
	IntentPolicyPath                    string  `env:"EXECUTION_CONTROL_INTENT_POLICY_PATH"`
	OTelEndpoint                        string  `env:"EXECUTION_CONTROL_OTEL_EXPORTER_OTLP_ENDPOINT"`
	OTelMetricsEndpoint                 string  `env:"EXECUTION_CONTROL_OTEL_EXPORTER_OTLP_METRICS_ENDPOINT"`
	OTelHeaders                         string  `env:"EXECUTION_CONTROL_OTEL_EXPORTER_OTLP_HEADERS"`
	OTelServiceName                     string  `env:"EXECUTION_CONTROL_OTEL_SERVICE_NAME" envDefault:"campus-execution-control"`
	OTelExportTimeoutMS                 int     `env:"EXECUTION_CONTROL_OTEL_EXPORT_TIMEOUT_MS" envDefault:"1000"`
	OTelExportIntervalMS                int     `env:"EXECUTION_CONTROL_OTEL_EXPORT_INTERVAL_MS" envDefault:"15000"`
	OTelSampleRatio                     float64 `env:"EXECUTION_CONTROL_OTEL_SAMPLE_RATIO" envDefault:"1.0"`
	OTelAllowedAttributesVersion        string  `env:"EXECUTION_CONTROL_OTEL_ALLOWED_ATTRIBUTES_VERSION" envDefault:"execution-control-otel-attrs-v1"`
	ExecutionAuditURL                   string  `env:"EXECUTION_CONTROL_EXECUTION_AUDIT_URL"`
	ExecutionAuditSharedSecret          string  `env:"EXECUTION_CONTROL_EXECUTION_AUDIT_SHARED_SECRET"`
	ExecutionAuditTimeoutMS             int     `env:"EXECUTION_CONTROL_EXECUTION_AUDIT_TIMEOUT_MS" envDefault:"500"`
	WorkflowRunDatabaseURL              string  `env:"EXECUTION_CONTROL_WORKFLOW_RUN_DATABASE_URL"`
	RunProjectionDatabaseURL            string  `env:"EXECUTION_CONTROL_RUN_PROJECTION_DATABASE_URL"`
	TemporalAddress                     string  `env:"EXECUTION_CONTROL_TEMPORAL_ADDRESS"`
	TemporalNamespace                   string  `env:"EXECUTION_CONTROL_TEMPORAL_NAMESPACE"`
	TemporalTaskQueue                   string  `env:"EXECUTION_CONTROL_TEMPORAL_TASK_QUEUE" envDefault:"campus-agent.workflow"`
	TemporalWorkerIdentity              string  `env:"EXECUTION_CONTROL_TEMPORAL_WORKER_IDENTITY"`
	TemporalWorkflowIDSalt              string  `env:"EXECUTION_CONTROL_TEMPORAL_WORKFLOW_ID_SALT"`
	TemporalStartTimeoutMS              int     `env:"EXECUTION_CONTROL_TEMPORAL_START_TIMEOUT_MS" envDefault:"5000"`
	QueryServingScopesPath              string  `env:"EXECUTION_CONTROL_QUERY_SERVING_SCOPES_PATH"`
	InternalQuerySharedSecret           string  `env:"EXECUTION_CONTROL_INTERNAL_QUERY_SHARED_SECRET"`
	StructuredQueryTrustedTimeRFC3339   string  `env:"EXECUTION_CONTROL_STRUCTURED_QUERY_TRUSTED_TIME_RFC3339"`
	StructuredQueryTimeoutMS            int     `env:"EXECUTION_CONTROL_STRUCTURED_QUERY_TIMEOUT_MS" envDefault:"1000"`
	PromptRuntimeTransport              string  `env:"PROMPT_RUNTIME_TRANSPORT" envDefault:"responses"`
	PromptRuntimeBaseURL                string  `env:"PROMPT_RUNTIME_BASE_URL"`
	ProviderPricingPath                 string  `env:"EXECUTION_CONTROL_PROVIDER_PRICING_PATH" envDefault:"../../configs/runtime/provider-pricing.v1.json"`
	PromptStrictStructuredOutputs       string  `env:"PROMPT_STRICT_STRUCTURED_OUTPUTS" envDefault:"true"`
	NoticeReadModelTable                string  `env:"INTERNAL_NOTICE_READ_MODEL_TABLE" envDefault:"ingestion_projection.internal_notice_read_model"`
	NoticeBodyObjectStoreEndpoint       string  `env:"EXECUTION_CONTROL_NOTICE_BODY_OBJECT_STORE_ENDPOINT"`
	NoticeBodyObjectStoreAccessKey      string  `env:"EXECUTION_CONTROL_NOTICE_BODY_OBJECT_STORE_ACCESS_KEY"`
	NoticeBodyObjectStoreSecretKey      string  `env:"EXECUTION_CONTROL_NOTICE_BODY_OBJECT_STORE_SECRET_KEY"`
	NoticeBodyObjectStoreRegion         string  `env:"EXECUTION_CONTROL_NOTICE_BODY_OBJECT_STORE_REGION" envDefault:"us-east-1"`
	NoticeBodyObjectStoreBucket         string  `env:"EXECUTION_CONTROL_NOTICE_BODY_OBJECT_STORE_BUCKET"`
	NoticeBodyObjectStoreBodyLimitBytes int64   `env:"EXECUTION_CONTROL_NOTICE_BODY_LIMIT_BYTES" envDefault:"1048576"`
	QdrantURL                           string  `env:"QDRANT_URL"`
	QdrantQueryAPIKey                   string  `env:"QDRANT_QUERY_API_KEY"`
	QdrantWriteAPIKey                   string  `env:"QDRANT_WRITE_API_KEY"`
	QdrantTLSCACertPath                 string  `env:"QDRANT_TLS_CA_CERT_PATH"`
	QdrantTimeoutSeconds                float64 `env:"QDRANT_TIMEOUT_SECONDS" envDefault:"10"`
	PersonalMemoryCollection            string  `env:"PERSONAL_MEMORY_COLLECTION" envDefault:"personal_memory_v1"`
	PersonalMemoryTopK                  int     `env:"PERSONAL_MEMORY_TOP_K" envDefault:"5"`
	PersonalMemoryMaxChars              int     `env:"PERSONAL_MEMORY_MAX_CHARS" envDefault:"1200"`
	PersonalMemoryScoreThreshold        float64 `env:"PERSONAL_MEMORY_SCORE_THRESHOLD" envDefault:"0"`
	EmbeddingProvider                   string  `env:"EMBEDDING_PROVIDER"`
	EmbeddingBaseURL                    string  `env:"EMBEDDING_BASE_URL"`
	EmbeddingAPIKey                     string  `env:"EMBEDDING_API_KEY"`
	EmbeddingModel                      string  `env:"EMBEDDING_MODEL"`
	EmbeddingDimensions                 int     `env:"EMBEDDING_DIMENSIONS"`
}

func LoadFromEnv() (Config, error) {
	return LoadFromEnvForRole("")
}

func LoadFromEnvForRole(runtimeRole string) (Config, error) {
	values, err := parseEnvValues()
	if err != nil {
		return Config{}, err
	}
	otelEnabled, err := readBoolStrict("EXECUTION_CONTROL_OTEL_ENABLED", false)
	if err != nil {
		return Config{}, err
	}
	otelMetricsEnabled, err := readBoolStrict("EXECUTION_CONTROL_OTEL_METRICS_ENABLED", false)
	if err != nil {
		return Config{}, err
	}
	executionAuditEnabled, err := readBoolStrict("EXECUTION_CONTROL_EXECUTION_AUDIT_ENABLED", false)
	if err != nil {
		return Config{}, err
	}
	promptStrictStructuredOutputs, err := parseBoolStrict(
		"PROMPT_STRICT_STRUCTURED_OUTPUTS",
		values.PromptStrictStructuredOutputs,
	)
	if err != nil {
		return Config{}, err
	}
	runtimeProfile, err := normalizeRuntimeProfile(values.RuntimeProfile)
	if err != nil {
		return Config{}, err
	}
	if err := validateEnvValues(values, runtimeProfile); err != nil {
		return Config{}, err
	}
	laneBudgets, err := readLaneBudgetsStrict(values.MaxConcurrentAnswers, values.QueueCapacity, values.QueueTimeoutMS)
	if err != nil {
		return Config{}, err
	}
	openCapabilities, err := readOpenCapabilitiesStrict()
	if err != nil {
		return Config{}, err
	}
	multiStepWorkflowEnabled, err := readBoolStrict("EXECUTION_CONTROL_MULTI_STEP_WORKFLOW_ENABLED", false)
	if err != nil {
		return Config{}, err
	}
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
	personalMemoryTopK, err := readPositiveIntStrict("PERSONAL_MEMORY_TOP_K", values.PersonalMemoryTopK)
	if err != nil {
		return Config{}, err
	}
	personalMemoryMaxChars, err := readPositiveIntStrict(
		"PERSONAL_MEMORY_MAX_CHARS",
		values.PersonalMemoryMaxChars,
	)
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
	if err := validateTemporalSettings(values, runtimeProfile); err != nil {
		return Config{}, err
	}
	if err := validatePersonalMemorySettings(
		values,
		runtimeProfile,
		embeddingDimensions,
		runtimeRole,
	); err != nil {
		return Config{}, err
	}

	return Config{
		AppName:                             defaultString(strings.TrimSpace(values.AppName), "campus-agent"),
		Host:                                defaultString(strings.TrimSpace(values.Host), "127.0.0.1"),
		Port:                                values.Port,
		RuntimeProfile:                      runtimeProfile,
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
		QueryServingScopesPath:              strings.TrimSpace(values.QueryServingScopesPath),
		InternalQuerySharedSecret:           strings.TrimSpace(values.InternalQuerySharedSecret),
		StructuredQueryTrustedTimeRFC3339:   strings.TrimSpace(values.StructuredQueryTrustedTimeRFC3339),
		StructuredQueryTimeoutMS:            values.StructuredQueryTimeoutMS,
		StructuredProjectionDatabaseURL:     readStructuredProjectionDatabaseURL(),
		PromptRuntimeProvider:               readString("PROMPT_RUNTIME_PROVIDER", ""),
		ProviderPricingPath:                 strings.TrimSpace(values.ProviderPricingPath),
		SupervisorPromptModel:               readPromptModel("SUPERVISOR_PROMPT_MODEL"),
		AgentPromptModel:                    readPromptModel("AGENT_PROMPT_MODEL"),
		PromptRuntimeAPIKey:                 readString("PROMPT_RUNTIME_API_KEY", ""),
		PromptRuntimeTransport:              defaultString(strings.TrimSpace(values.PromptRuntimeTransport), "responses"),
		PromptRuntimeBaseURL:                promptRuntimeBaseURL(values),
		PromptStrictStructuredOutputs:       promptStrictStructuredOutputs,
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
		QdrantWriteAPIKey:                   strings.TrimSpace(values.QdrantWriteAPIKey),
		QdrantTLSCACertPath:                 strings.TrimSpace(values.QdrantTLSCACertPath),
		QdrantTimeoutSeconds:                values.QdrantTimeoutSeconds,
		PersonalMemoryCollection:            defaultString(strings.TrimSpace(values.PersonalMemoryCollection), "personal_memory_v1"),
		PersonalMemoryTopK:                  personalMemoryTopK,
		PersonalMemoryMaxChars:              personalMemoryMaxChars,
		PersonalMemoryScoreThreshold:        values.PersonalMemoryScoreThreshold,
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

func validateEnvValues(values envValues, runtimeProfile string) error {
	checks := []struct {
		name  string
		value int
	}{
		{"CAMPUS_AGENT_HTTP_PORT", values.Port},
		{"EXECUTION_CONTROL_MAX_CONCURRENT_ANSWERS", values.MaxConcurrentAnswers},
		{"EXECUTION_CONTROL_QUEUE_TIMEOUT_MS", values.QueueTimeoutMS},
		{"EXECUTION_CONTROL_REQUEST_TIMEOUT_MS", values.RequestTimeoutMS},
		{"EXECUTION_CONTROL_SHUTDOWN_GRACE_MS", values.ShutdownGraceMS},
		{"EXECUTION_CONTROL_OTEL_EXPORT_TIMEOUT_MS", values.OTelExportTimeoutMS},
		{"EXECUTION_CONTROL_OTEL_EXPORT_INTERVAL_MS", values.OTelExportIntervalMS},
		{"EXECUTION_CONTROL_EXECUTION_AUDIT_TIMEOUT_MS", values.ExecutionAuditTimeoutMS},
		{"EXECUTION_CONTROL_STRUCTURED_QUERY_TIMEOUT_MS", values.StructuredQueryTimeoutMS},
		{"EXECUTION_CONTROL_TEMPORAL_START_TIMEOUT_MS", values.TemporalStartTimeoutMS},
	}
	for _, check := range checks {
		if check.value <= 0 {
			return fmt.Errorf("%s must be a positive integer", check.name)
		}
	}
	if values.QueueCapacity < 0 {
		return fmt.Errorf("EXECUTION_CONTROL_QUEUE_CAPACITY must be a non-negative integer")
	}
	if values.RequestBodyLimitBytes <= 0 {
		return fmt.Errorf("EXECUTION_CONTROL_REQUEST_BODY_LIMIT_BYTES must be a positive integer")
	}
	if values.NoticeBodyObjectStoreBodyLimitBytes <= 0 {
		return fmt.Errorf("EXECUTION_CONTROL_NOTICE_BODY_LIMIT_BYTES must be a positive integer")
	}
	if values.QdrantTimeoutSeconds <= 0 {
		return fmt.Errorf("QDRANT_TIMEOUT_SECONDS must be greater than zero")
	}
	if values.OTelSampleRatio < 0 || values.OTelSampleRatio > 1 {
		return fmt.Errorf("EXECUTION_CONTROL_OTEL_SAMPLE_RATIO must be a number between 0 and 1")
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
	embeddingDimensions int,
	runtimeRole string,
) error {
	if runtimeProfile == "local" {
		return nil
	}
	role := normalizeRuntimeRole(runtimeRole)
	switch role {
	case "workflow", "activity-finalization":
		return nil
	}
	required := []struct {
		name  string
		value string
	}{
		{"QDRANT_URL", values.QdrantURL},
		{"QDRANT_QUERY_API_KEY", values.QdrantQueryAPIKey},
		{"QDRANT_TLS_CA_CERT_PATH", values.QdrantTLSCACertPath},
		{"EMBEDDING_API_KEY", values.EmbeddingAPIKey},
		{"EMBEDDING_MODEL", values.EmbeddingModel},
	}
	if role == "" || role == "execution-control" {
		required = append(required, struct {
			name  string
			value string
		}{"QDRANT_WRITE_API_KEY", values.QdrantWriteAPIKey})
	}
	for _, item := range required {
		if strings.TrimSpace(item.value) == "" {
			return fmt.Errorf("%s is required for deployed personal memory recall", item.name)
		}
	}
	if !strings.HasPrefix(strings.TrimSpace(values.QdrantURL), "https://") {
		return fmt.Errorf("QDRANT_URL must use https for deployed personal memory recall")
	}
	if embeddingDimensions <= 0 {
		return fmt.Errorf("EMBEDDING_DIMENSIONS must be a positive integer for deployed personal memory recall")
	}
	return nil
}

func normalizeRuntimeRole(value string) string {
	switch strings.TrimSpace(value) {
	case "activity-rag", "activity-worker-rag", "rag":
		return "activity-rag"
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

func normalizeRuntimeProfile(value string) (string, error) {
	profile := strings.ToLower(strings.TrimSpace(value))
	if profile == "" {
		profile = "local"
	}
	switch profile {
	case "local", "staging", "production":
		return profile, nil
	default:
		return "", fmt.Errorf("EXECUTION_CONTROL_RUNTIME_PROFILE contains unsupported profile %q", value)
	}
}

func promptRuntimeBaseURL(values envValues) string {
	if baseURL := strings.TrimSpace(values.PromptRuntimeBaseURL); baseURL != "" {
		return baseURL
	}
	return "https://api.openai.com/v1"
}

func defaultString(value string, defaultValue string) string {
	if value == "" {
		return defaultValue
	}
	return value
}

func readString(name string, defaultValue string) string {
	value := strings.TrimSpace(os.Getenv(name))
	if value == "" {
		return defaultValue
	}
	return value
}

func readFirstString(names ...string) string {
	for _, name := range names {
		value := strings.TrimSpace(os.Getenv(name))
		if value != "" {
			return value
		}
	}
	return ""
}

func readPromptModel(roleSpecificName string) string {
	if value := strings.TrimSpace(os.Getenv(roleSpecificName)); value != "" {
		return value
	}
	return strings.TrimSpace(os.Getenv("PROMPT_RUNTIME_MODEL"))
}

func readNoticeReadModelDatabaseURL() string {
	databaseURL := readFirstString(
		"INTERNAL_NOTICE_READ_MODEL_DATABASE_URL",
		"CAMPUS_SHARED_POSTGRES_URL",
	)
	return normalizePostgresDatabaseURL(databaseURL)
}

func readStructuredProjectionDatabaseURL() string {
	databaseURL := readFirstString("CAMPUS_SHARED_POSTGRES_URL")
	return normalizePostgresDatabaseURL(databaseURL)
}

func readWorkflowRunDatabaseURL(values envValues) string {
	databaseURL := strings.TrimSpace(values.WorkflowRunDatabaseURL)
	if databaseURL == "" {
		databaseURL = readFirstString("CAMPUS_SHARED_POSTGRES_URL")
	}
	return normalizePostgresDatabaseURL(databaseURL)
}

func readRunProjectionDatabaseURL(values envValues) string {
	return normalizePostgresDatabaseURL(strings.TrimSpace(values.RunProjectionDatabaseURL))
}

func normalizePostgresDatabaseURL(databaseURL string) string {
	if strings.HasPrefix(databaseURL, "postgres://") {
		return "postgresql://" + strings.TrimPrefix(databaseURL, "postgres://")
	}
	return databaseURL
}

func readPositiveIntStrict(name string, defaultValue int) (int, error) {
	value := strings.TrimSpace(os.Getenv(name))
	if value == "" {
		return defaultValue, nil
	}

	parsed, err := strconv.Atoi(value)
	if err != nil || parsed <= 0 {
		return 0, fmt.Errorf("%s must be a positive integer", name)
	}
	return parsed, nil
}

func readNonNegativeIntStrict(name string, defaultValue int) (int, error) {
	value := strings.TrimSpace(os.Getenv(name))
	if value == "" {
		return defaultValue, nil
	}

	parsed, err := strconv.Atoi(value)
	if err != nil || parsed < 0 {
		return 0, fmt.Errorf("%s must be a non-negative integer", name)
	}
	return parsed, nil
}

func readBoolStrict(name string, defaultValue bool) (bool, error) {
	value := strings.ToLower(strings.TrimSpace(os.Getenv(name)))
	if value == "" {
		return defaultValue, nil
	}
	return parseBoolStrict(name, value)
}

func parseBoolStrict(name string, value string) (bool, error) {
	normalized := strings.ToLower(strings.TrimSpace(value))
	if normalized == "" {
		return false, fmt.Errorf("%s must be a boolean", name)
	}
	switch normalized {
	case "1", "true", "yes", "on":
		return true, nil
	case "0", "false", "no", "off":
		return false, nil
	default:
		return false, fmt.Errorf("%s must be a boolean", name)
	}
}

func readLaneBudgetsStrict(
	globalMaxConcurrent int,
	globalQueueCapacity int,
	globalQueueTimeoutMS int,
) (map[string]LaneBudget, error) {
	budgets := make(map[string]LaneBudget, len(laneNames()))
	for _, lane := range laneNames() {
		prefix := "EXECUTION_CONTROL_LANE_" + strings.ToUpper(lane) + "_"
		maxConcurrent, err := readPositiveIntStrict(
			prefix+"MAX_CONCURRENT",
			globalMaxConcurrent,
		)
		if err != nil {
			return nil, err
		}
		queueCapacity, err := readNonNegativeIntStrict(
			prefix+"QUEUE_CAPACITY",
			globalQueueCapacity,
		)
		if err != nil {
			return nil, err
		}
		queueTimeout, err := readPositiveIntStrict(
			prefix+"QUEUE_TIMEOUT_MS",
			globalQueueTimeoutMS,
		)
		if err != nil {
			return nil, err
		}
		budgets[lane] = LaneBudget{
			MaxConcurrent:  maxConcurrent,
			QueueCapacity:  queueCapacity,
			QueueTimeoutMS: queueTimeout,
		}
	}
	return budgets, nil
}

func laneNames() []string {
	return []string{"rag", "navigation", "campus_services", "notice", "default"}
}

func rejectRetiredDurableWorkerLoopSettings() error {
	retired := []string{
		"EXECUTION_CONTROL_DURABLE_WORKER_LOOP_ENABLED",
		"EXECUTION_CONTROL_DURABLE_WORKER_LOOP_WORKER_ID",
		"EXECUTION_CONTROL_DURABLE_WORKER_LOOP_LANE",
		"EXECUTION_CONTROL_DURABLE_WORKER_LOOP_STEP_ID",
		"EXECUTION_CONTROL_DURABLE_WORKER_LOOP_POLL_INTERVAL_MS",
		"EXECUTION_CONTROL_DURABLE_WORKER_LOOP_LEASE_TTL_MS",
		"EXECUTION_CONTROL_DURABLE_WORKER_LOOP_LEASE_HEARTBEAT_INTERVAL_MS",
	}
	for _, name := range retired {
		if strings.TrimSpace(os.Getenv(name)) != "" {
			return fmt.Errorf("%s is retired; use Temporal workers", name)
		}
	}
	return nil
}

func rejectRetiredDurableRecoveryLoopSettings() error {
	retired := []string{
		"EXECUTION_CONTROL_DURABLE_RECOVERY_LOOP_ENABLED",
		"EXECUTION_CONTROL_DURABLE_RECOVERY_LOOP_INTERVAL_MS",
		"EXECUTION_CONTROL_DURABLE_RECOVERY_LOOP_MAX_RETRY_ATTEMPTS",
	}
	for _, name := range retired {
		if strings.TrimSpace(os.Getenv(name)) != "" {
			return fmt.Errorf("%s is retired; use Temporal retry and timeout policies", name)
		}
	}
	return nil
}

func rejectRetiredPythonBridgeSettings() error {
	retired := []string{
		"SUPERVISOR_AGENT_WORKER_BASE_URL",
		"SUPERVISOR_AGENT_WORKER_SHARED_SECRET",
		"SUPERVISOR_AGENT_WORKER_RESPONSE_LIMIT_BYTES",
		"SUPERVISOR_AGENT_WORKER_TIMEOUT_MS",
		"SUPERVISOR_AGENT_WORKER_CANCEL_TIMEOUT_MS",
		"EXECUTION_CONTROL_BRIDGE_BREAKER_FAILURE_THRESHOLD",
		"EXECUTION_CONTROL_BRIDGE_BREAKER_OPEN_MS",
		"EXECUTION_CONTROL_BRIDGE_RETRY_MAX_ATTEMPTS",
		"EXECUTION_CONTROL_BRIDGE_RETRY_BASE_MS",
	}
	for _, name := range retired {
		if strings.TrimSpace(os.Getenv(name)) != "" {
			return fmt.Errorf("%s is retired; online answer execution uses Temporal RAG activities", name)
		}
	}
	return nil
}

func readStringList(name string) []string {
	value := strings.TrimSpace(os.Getenv(name))
	if value == "" {
		return nil
	}

	parts := strings.Split(value, ",")
	values := make([]string, 0, len(parts))
	for _, part := range parts {
		normalized := strings.TrimSpace(part)
		if normalized != "" {
			values = append(values, normalized)
		}
	}
	return values
}

func readOpenCapabilitiesStrict() ([]string, error) {
	values := readStringList("EXECUTION_CONTROL_OPEN_CAPABILITIES")
	for _, value := range values {
		switch strings.TrimSpace(value) {
		case "campus_services", "navigation", "notice":
		case "*", "all":
			return nil, fmt.Errorf("EXECUTION_CONTROL_OPEN_CAPABILITIES does not support wildcard value %q", value)
		default:
			return nil, fmt.Errorf("EXECUTION_CONTROL_OPEN_CAPABILITIES contains unsupported capability %q", value)
		}
	}
	return values, nil
}
