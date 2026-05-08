package config

import (
	"fmt"
	"os"
	"strconv"
	"strings"

	env "github.com/caarlos0/env/v11"
)

type Config struct {
	AppName                           string
	Host                              string
	Port                              int
	AuthMode                          string
	BearerToken                       string
	WorkerSharedSecret                string
	DefaultActorID                    string
	DefaultActorRoles                 []string
	BridgeBaseURL                     string
	BridgeSharedSecret                string
	BridgeResponseLimitBytes          int64
	BridgeBreakerFailureThreshold     int
	BridgeBreakerOpenMS               int
	BridgeRetryMaxAttempts            int
	BridgeRetryBaseMS                 int
	MaxConcurrentAnswers              int
	QueueCapacity                     int
	QueueTimeoutMS                    int
	RequestTimeoutMS                  int
	RequestBodyLimitBytes             int64
	BridgeTimeoutMS                   int
	BridgeCancelTimeoutMS             int
	ShutdownGraceMS                   int
	MetricsBearerToken                string
	IntentPolicyPath                  string
	LaneBudgets                       map[string]LaneBudget
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
	ExecutionAuditEnabled             bool
	ExecutionAuditURL                 string
	ExecutionAuditSharedSecret        string
	ExecutionAuditTimeoutMS           int
	ExecutionAuditQueueCapacity       int
	ExecutionAuditBatchSize           int
	ExecutionAuditFlushMS             int
	ExecutionAuditRetryMaxAttempts    int
	ExecutionAuditRetryBaseMS         int
	ExecutionAuditSpoolDir            string
	ExecutionAuditSpoolMaxBytes       int
	OpenCapabilities                  []string
	MultiStepWorkflowEnabled          bool
	WorkflowRunDatabaseURL            string
	WorkflowRunAutoMigrate            bool
	QueryServingScopesPath            string
	InternalQuerySharedSecret         string
	StructuredQueryTrustedTimeRFC3339 string
	StructuredQueryTimeoutMS          int
	StructuredProjectionDatabaseURL   string
	PromptRuntimeProvider             string
	SupervisorPromptModel             string
	AgentPromptModel                  string
	PromptRuntimeAPIKey               string
	PromptRuntimeTransport            string
	PromptRuntimeBaseURL              string
	PromptStrictStructuredOutputs     bool
	NoticeReadModelDatabaseURL        string
	NoticeReadModelTable              string
	NoticeObjectStoreEndpoint         string
	NoticeObjectStoreAccessKey        string
	NoticeObjectStoreSecretKey        string
	NoticeObjectStoreRegion           string
	NoticeObjectStoreBucketDerived    string
	NoticeObjectStoreBodyLimitBytes   int64
}

type LaneBudget struct {
	MaxConcurrent  int
	QueueCapacity  int
	QueueTimeoutMS int
}

type envValues struct {
	AppName                           string  `env:"CAMPUS_AGENT_APP_NAME" envDefault:"campus-agent"`
	Host                              string  `env:"CAMPUS_AGENT_HTTP_HOST" envDefault:"127.0.0.1"`
	Port                              int     `env:"CAMPUS_AGENT_HTTP_PORT" envDefault:"8000"`
	AuthMode                          string  `env:"API_AUTH_MODE" envDefault:"bearer"`
	BearerToken                       string  `env:"API_BEARER_TOKEN"`
	WorkerSharedSecret                string  `env:"API_WORKER_SHARED_SECRET"`
	DefaultActorID                    string  `env:"API_DEFAULT_ACTOR_ID"`
	BridgeBaseURL                     string  `env:"SUPERVISOR_AGENT_WORKER_BASE_URL"`
	BridgeSharedSecret                string  `env:"SUPERVISOR_AGENT_WORKER_SHARED_SECRET"`
	BridgeResponseLimitBytes          int64   `env:"SUPERVISOR_AGENT_WORKER_RESPONSE_LIMIT_BYTES" envDefault:"1048576"`
	BridgeBreakerFailureThreshold     int     `env:"SUPERVISOR_API_BRIDGE_BREAKER_FAILURE_THRESHOLD" envDefault:"5"`
	BridgeBreakerOpenMS               int     `env:"SUPERVISOR_API_BRIDGE_BREAKER_OPEN_MS" envDefault:"10000"`
	BridgeRetryMaxAttempts            int     `env:"SUPERVISOR_API_BRIDGE_RETRY_MAX_ATTEMPTS" envDefault:"2"`
	BridgeRetryBaseMS                 int     `env:"SUPERVISOR_API_BRIDGE_RETRY_BASE_MS" envDefault:"50"`
	MaxConcurrentAnswers              int     `env:"SUPERVISOR_API_MAX_CONCURRENT_ANSWERS" envDefault:"8"`
	QueueCapacity                     int     `env:"SUPERVISOR_API_QUEUE_CAPACITY" envDefault:"24"`
	QueueTimeoutMS                    int     `env:"SUPERVISOR_API_QUEUE_TIMEOUT_MS" envDefault:"3000"`
	RequestTimeoutMS                  int     `env:"SUPERVISOR_API_REQUEST_TIMEOUT_MS" envDefault:"45000"`
	RequestBodyLimitBytes             int64   `env:"SUPERVISOR_API_REQUEST_BODY_LIMIT_BYTES" envDefault:"1048576"`
	BridgeTimeoutMS                   int     `env:"SUPERVISOR_AGENT_WORKER_TIMEOUT_MS" envDefault:"35000"`
	BridgeCancelTimeoutMS             int     `env:"SUPERVISOR_AGENT_WORKER_CANCEL_TIMEOUT_MS" envDefault:"500"`
	ShutdownGraceMS                   int     `env:"SUPERVISOR_API_SHUTDOWN_GRACE_MS" envDefault:"45000"`
	MetricsBearerToken                string  `env:"SUPERVISOR_API_METRICS_BEARER_TOKEN"`
	IntentPolicyPath                  string  `env:"SUPERVISOR_API_INTENT_POLICY_PATH"`
	OTelEndpoint                      string  `env:"SUPERVISOR_API_OTEL_EXPORTER_OTLP_ENDPOINT"`
	OTelMetricsEndpoint               string  `env:"SUPERVISOR_API_OTEL_EXPORTER_OTLP_METRICS_ENDPOINT"`
	OTelHeaders                       string  `env:"SUPERVISOR_API_OTEL_EXPORTER_OTLP_HEADERS"`
	OTelServiceName                   string  `env:"SUPERVISOR_API_OTEL_SERVICE_NAME" envDefault:"campus-supervisor-api"`
	OTelExportTimeoutMS               int     `env:"SUPERVISOR_API_OTEL_EXPORT_TIMEOUT_MS" envDefault:"1000"`
	OTelExportIntervalMS              int     `env:"SUPERVISOR_API_OTEL_EXPORT_INTERVAL_MS" envDefault:"15000"`
	OTelSampleRatio                   float64 `env:"SUPERVISOR_API_OTEL_SAMPLE_RATIO" envDefault:"1.0"`
	OTelAllowedAttributesVersion      string  `env:"SUPERVISOR_API_OTEL_ALLOWED_ATTRIBUTES_VERSION" envDefault:"supervisor-api-otel-attrs-v1"`
	ExecutionAuditURL                 string  `env:"SUPERVISOR_API_EXECUTION_AUDIT_URL"`
	ExecutionAuditSharedSecret        string  `env:"SUPERVISOR_API_EXECUTION_AUDIT_SHARED_SECRET"`
	ExecutionAuditTimeoutMS           int     `env:"SUPERVISOR_API_EXECUTION_AUDIT_TIMEOUT_MS" envDefault:"500"`
	ExecutionAuditQueueCapacity       int     `env:"SUPERVISOR_API_EXECUTION_AUDIT_QUEUE_CAPACITY" envDefault:"128"`
	ExecutionAuditBatchSize           int     `env:"SUPERVISOR_API_EXECUTION_AUDIT_BATCH_SIZE" envDefault:"10"`
	ExecutionAuditFlushMS             int     `env:"SUPERVISOR_API_EXECUTION_AUDIT_FLUSH_MS" envDefault:"1000"`
	ExecutionAuditRetryMaxAttempts    int     `env:"SUPERVISOR_API_EXECUTION_AUDIT_RETRY_MAX_ATTEMPTS" envDefault:"3"`
	ExecutionAuditRetryBaseMS         int     `env:"SUPERVISOR_API_EXECUTION_AUDIT_RETRY_BASE_MS" envDefault:"100"`
	ExecutionAuditSpoolDir            string  `env:"SUPERVISOR_API_EXECUTION_AUDIT_SPOOL_DIR"`
	ExecutionAuditSpoolMaxBytes       int     `env:"SUPERVISOR_API_EXECUTION_AUDIT_SPOOL_MAX_BYTES" envDefault:"10485760"`
	WorkflowRunDatabaseURL            string  `env:"SUPERVISOR_API_WORKFLOW_RUN_DATABASE_URL"`
	QueryServingScopesPath            string  `env:"SUPERVISOR_API_QUERY_SERVING_SCOPES_PATH"`
	InternalQuerySharedSecret         string  `env:"SUPERVISOR_INTERNAL_QUERY_SHARED_SECRET"`
	StructuredQueryTrustedTimeRFC3339 string  `env:"SUPERVISOR_STRUCTURED_QUERY_TRUSTED_TIME_RFC3339"`
	StructuredQueryTimeoutMS          int     `env:"SUPERVISOR_STRUCTURED_QUERY_TIMEOUT_MS" envDefault:"1000"`
	PromptRuntimeTransport            string  `env:"PROMPT_RUNTIME_TRANSPORT" envDefault:"responses"`
	PromptRuntimeBaseURL              string  `env:"PROMPT_RUNTIME_BASE_URL"`
	PromptStrictStructuredOutputs     string  `env:"PROMPT_STRICT_STRUCTURED_OUTPUTS" envDefault:"true"`
	NoticeReadModelTable              string  `env:"INTERNAL_NOTICE_READ_MODEL_TABLE" envDefault:"ingestion_projection.internal_notice_read_model"`
	NoticeObjectStoreEndpoint         string  `env:"OBJECT_STORE_ENDPOINT"`
	NoticeObjectStoreRegion           string  `env:"OBJECT_STORE_REGION" envDefault:"us-east-1"`
	NoticeObjectStoreBucketDerived    string  `env:"OBJECT_STORE_BUCKET_DERIVED" envDefault:"campus-rag-derived"`
	NoticeObjectStoreBodyLimitBytes   int64   `env:"SUPERVISOR_NOTICE_BODY_LIMIT_BYTES" envDefault:"1048576"`
}

func LoadFromEnv() (Config, error) {
	values, err := parseEnvValues()
	if err != nil {
		return Config{}, err
	}
	otelEnabled, err := readBoolStrict("SUPERVISOR_API_OTEL_ENABLED", false)
	if err != nil {
		return Config{}, err
	}
	otelMetricsEnabled, err := readBoolStrict("SUPERVISOR_API_OTEL_METRICS_ENABLED", false)
	if err != nil {
		return Config{}, err
	}
	executionAuditEnabled, err := readBoolStrict("SUPERVISOR_API_EXECUTION_AUDIT_ENABLED", false)
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
	if err := validateEnvValues(values); err != nil {
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
	multiStepWorkflowEnabled, err := readBoolStrict("SUPERVISOR_API_MULTI_STEP_WORKFLOW_ENABLED", false)
	if err != nil {
		return Config{}, err
	}
	workflowRunAutoMigrate, err := readBoolStrict("SUPERVISOR_API_WORKFLOW_RUN_AUTO_MIGRATE", false)
	if err != nil {
		return Config{}, err
	}

	return Config{
		AppName:                           defaultString(strings.TrimSpace(values.AppName), "campus-agent"),
		Host:                              defaultString(strings.TrimSpace(values.Host), "127.0.0.1"),
		Port:                              values.Port,
		AuthMode:                          defaultString(strings.TrimSpace(values.AuthMode), "bearer"),
		BearerToken:                       strings.TrimSpace(values.BearerToken),
		WorkerSharedSecret:                strings.TrimSpace(values.WorkerSharedSecret),
		DefaultActorID:                    strings.TrimSpace(values.DefaultActorID),
		DefaultActorRoles:                 readStringList("API_DEFAULT_ACTOR_ROLES"),
		BridgeBaseURL:                     strings.TrimRight(strings.TrimSpace(values.BridgeBaseURL), "/"),
		BridgeSharedSecret:                strings.TrimSpace(values.BridgeSharedSecret),
		BridgeResponseLimitBytes:          values.BridgeResponseLimitBytes,
		BridgeBreakerFailureThreshold:     values.BridgeBreakerFailureThreshold,
		BridgeBreakerOpenMS:               values.BridgeBreakerOpenMS,
		BridgeRetryMaxAttempts:            values.BridgeRetryMaxAttempts,
		BridgeRetryBaseMS:                 values.BridgeRetryBaseMS,
		MaxConcurrentAnswers:              values.MaxConcurrentAnswers,
		QueueCapacity:                     values.QueueCapacity,
		QueueTimeoutMS:                    values.QueueTimeoutMS,
		RequestTimeoutMS:                  values.RequestTimeoutMS,
		RequestBodyLimitBytes:             values.RequestBodyLimitBytes,
		BridgeTimeoutMS:                   values.BridgeTimeoutMS,
		BridgeCancelTimeoutMS:             values.BridgeCancelTimeoutMS,
		ShutdownGraceMS:                   values.ShutdownGraceMS,
		MetricsBearerToken:                strings.TrimSpace(values.MetricsBearerToken),
		IntentPolicyPath:                  strings.TrimSpace(values.IntentPolicyPath),
		LaneBudgets:                       laneBudgets,
		OTelEnabled:                       otelEnabled,
		OTelEndpoint:                      strings.TrimSpace(values.OTelEndpoint),
		OTelMetricsEnabled:                otelMetricsEnabled,
		OTelMetricsEndpoint:               strings.TrimSpace(values.OTelMetricsEndpoint),
		OTelHeaders:                       strings.TrimSpace(values.OTelHeaders),
		OTelServiceName:                   defaultString(strings.TrimSpace(values.OTelServiceName), "campus-supervisor-api"),
		OTelExportTimeoutMS:               values.OTelExportTimeoutMS,
		OTelExportIntervalMS:              values.OTelExportIntervalMS,
		OTelSampleRatio:                   values.OTelSampleRatio,
		OTelAllowedAttributesVersion:      defaultString(strings.TrimSpace(values.OTelAllowedAttributesVersion), "supervisor-api-otel-attrs-v1"),
		ExecutionAuditEnabled:             executionAuditEnabled,
		ExecutionAuditURL:                 strings.TrimSpace(values.ExecutionAuditURL),
		ExecutionAuditSharedSecret:        strings.TrimSpace(values.ExecutionAuditSharedSecret),
		ExecutionAuditTimeoutMS:           values.ExecutionAuditTimeoutMS,
		ExecutionAuditQueueCapacity:       values.ExecutionAuditQueueCapacity,
		ExecutionAuditBatchSize:           values.ExecutionAuditBatchSize,
		ExecutionAuditFlushMS:             values.ExecutionAuditFlushMS,
		ExecutionAuditRetryMaxAttempts:    values.ExecutionAuditRetryMaxAttempts,
		ExecutionAuditRetryBaseMS:         values.ExecutionAuditRetryBaseMS,
		ExecutionAuditSpoolDir:            strings.TrimSpace(values.ExecutionAuditSpoolDir),
		ExecutionAuditSpoolMaxBytes:       values.ExecutionAuditSpoolMaxBytes,
		OpenCapabilities:                  openCapabilities,
		MultiStepWorkflowEnabled:          multiStepWorkflowEnabled,
		WorkflowRunDatabaseURL:            readWorkflowRunDatabaseURL(values),
		WorkflowRunAutoMigrate:            workflowRunAutoMigrate,
		QueryServingScopesPath:            strings.TrimSpace(values.QueryServingScopesPath),
		InternalQuerySharedSecret:         strings.TrimSpace(values.InternalQuerySharedSecret),
		StructuredQueryTrustedTimeRFC3339: strings.TrimSpace(values.StructuredQueryTrustedTimeRFC3339),
		StructuredQueryTimeoutMS:          values.StructuredQueryTimeoutMS,
		StructuredProjectionDatabaseURL:   readStructuredProjectionDatabaseURL(),
		PromptRuntimeProvider:             readFirstString("PROMPT_RUNTIME_PROVIDER", "AGENT_RUNTIME_PROVIDER"),
		SupervisorPromptModel:             readPromptModel("SUPERVISOR_PROMPT_MODEL"),
		AgentPromptModel:                  readPromptModel("AGENT_PROMPT_MODEL"),
		PromptRuntimeAPIKey:               readFirstString("PROMPT_RUNTIME_API_KEY", "LLM_API_KEY"),
		PromptRuntimeTransport:            defaultString(strings.TrimSpace(values.PromptRuntimeTransport), "responses"),
		PromptRuntimeBaseURL:              promptRuntimeBaseURL(values),
		PromptStrictStructuredOutputs:     promptStrictStructuredOutputs,
		NoticeReadModelDatabaseURL:        readNoticeReadModelDatabaseURL(),
		NoticeReadModelTable:              defaultString(strings.TrimSpace(values.NoticeReadModelTable), "ingestion_projection.internal_notice_read_model"),
		NoticeObjectStoreEndpoint:         strings.TrimSpace(values.NoticeObjectStoreEndpoint),
		NoticeObjectStoreAccessKey:        readFirstString("OBJECT_STORE_DERIVED_ACCESS_KEY", "OBJECT_STORE_ACCESS_KEY"),
		NoticeObjectStoreSecretKey:        readFirstString("OBJECT_STORE_DERIVED_SECRET_KEY", "OBJECT_STORE_SECRET_KEY"),
		NoticeObjectStoreRegion:           defaultString(strings.TrimSpace(values.NoticeObjectStoreRegion), "us-east-1"),
		NoticeObjectStoreBucketDerived:    defaultString(strings.TrimSpace(values.NoticeObjectStoreBucketDerived), "campus-rag-derived"),
		NoticeObjectStoreBodyLimitBytes:   values.NoticeObjectStoreBodyLimitBytes,
	}, nil
}

func parseEnvValues() (envValues, error) {
	values := envValues{}
	if err := env.Parse(&values); err != nil {
		return envValues{}, fmt.Errorf("parse supervisor-api env: %w", err)
	}
	return values, nil
}

func validateEnvValues(values envValues) error {
	checks := []struct {
		name  string
		value int
	}{
		{"CAMPUS_AGENT_HTTP_PORT", values.Port},
		{"SUPERVISOR_API_MAX_CONCURRENT_ANSWERS", values.MaxConcurrentAnswers},
		{"SUPERVISOR_API_QUEUE_TIMEOUT_MS", values.QueueTimeoutMS},
		{"SUPERVISOR_API_REQUEST_TIMEOUT_MS", values.RequestTimeoutMS},
		{"SUPERVISOR_AGENT_WORKER_TIMEOUT_MS", values.BridgeTimeoutMS},
		{"SUPERVISOR_AGENT_WORKER_CANCEL_TIMEOUT_MS", values.BridgeCancelTimeoutMS},
		{"SUPERVISOR_API_BRIDGE_BREAKER_FAILURE_THRESHOLD", values.BridgeBreakerFailureThreshold},
		{"SUPERVISOR_API_BRIDGE_BREAKER_OPEN_MS", values.BridgeBreakerOpenMS},
		{"SUPERVISOR_API_BRIDGE_RETRY_MAX_ATTEMPTS", values.BridgeRetryMaxAttempts},
		{"SUPERVISOR_API_BRIDGE_RETRY_BASE_MS", values.BridgeRetryBaseMS},
		{"SUPERVISOR_API_SHUTDOWN_GRACE_MS", values.ShutdownGraceMS},
		{"SUPERVISOR_API_OTEL_EXPORT_TIMEOUT_MS", values.OTelExportTimeoutMS},
		{"SUPERVISOR_API_OTEL_EXPORT_INTERVAL_MS", values.OTelExportIntervalMS},
		{"SUPERVISOR_API_EXECUTION_AUDIT_TIMEOUT_MS", values.ExecutionAuditTimeoutMS},
		{"SUPERVISOR_API_EXECUTION_AUDIT_QUEUE_CAPACITY", values.ExecutionAuditQueueCapacity},
		{"SUPERVISOR_API_EXECUTION_AUDIT_BATCH_SIZE", values.ExecutionAuditBatchSize},
		{"SUPERVISOR_API_EXECUTION_AUDIT_FLUSH_MS", values.ExecutionAuditFlushMS},
		{"SUPERVISOR_API_EXECUTION_AUDIT_RETRY_MAX_ATTEMPTS", values.ExecutionAuditRetryMaxAttempts},
		{"SUPERVISOR_API_EXECUTION_AUDIT_RETRY_BASE_MS", values.ExecutionAuditRetryBaseMS},
		{"SUPERVISOR_API_EXECUTION_AUDIT_SPOOL_MAX_BYTES", values.ExecutionAuditSpoolMaxBytes},
		{"SUPERVISOR_STRUCTURED_QUERY_TIMEOUT_MS", values.StructuredQueryTimeoutMS},
	}
	for _, check := range checks {
		if check.value <= 0 {
			return fmt.Errorf("%s must be a positive integer", check.name)
		}
	}
	if values.QueueCapacity < 0 {
		return fmt.Errorf("SUPERVISOR_API_QUEUE_CAPACITY must be a non-negative integer")
	}
	if values.RequestBodyLimitBytes <= 0 {
		return fmt.Errorf("SUPERVISOR_API_REQUEST_BODY_LIMIT_BYTES must be a positive integer")
	}
	if values.BridgeResponseLimitBytes <= 0 {
		return fmt.Errorf("SUPERVISOR_AGENT_WORKER_RESPONSE_LIMIT_BYTES must be a positive integer")
	}
	if values.NoticeObjectStoreBodyLimitBytes <= 0 {
		return fmt.Errorf("SUPERVISOR_NOTICE_BODY_LIMIT_BYTES must be a positive integer")
	}
	if values.OTelSampleRatio < 0 || values.OTelSampleRatio > 1 {
		return fmt.Errorf("SUPERVISOR_API_OTEL_SAMPLE_RATIO must be a number between 0 and 1")
	}
	return nil
}

func promptRuntimeBaseURL(values envValues) string {
	if baseURL := strings.TrimSpace(values.PromptRuntimeBaseURL); baseURL != "" {
		return baseURL
	}
	return readString("LLM_BASE_URL", "https://api.openai.com/v1")
}

func defaultString(value string, fallback string) string {
	if value == "" {
		return fallback
	}
	return value
}

func readString(name string, fallback string) string {
	value := strings.TrimSpace(os.Getenv(name))
	if value == "" {
		return fallback
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

func normalizePostgresDatabaseURL(databaseURL string) string {
	if strings.HasPrefix(databaseURL, "postgres://") {
		return "postgresql://" + strings.TrimPrefix(databaseURL, "postgres://")
	}
	return databaseURL
}

func readPositiveIntStrict(name string, fallback int) (int, error) {
	value := strings.TrimSpace(os.Getenv(name))
	if value == "" {
		return fallback, nil
	}

	parsed, err := strconv.Atoi(value)
	if err != nil || parsed <= 0 {
		return 0, fmt.Errorf("%s must be a positive integer", name)
	}
	return parsed, nil
}

func readNonNegativeIntStrict(name string, fallback int) (int, error) {
	value := strings.TrimSpace(os.Getenv(name))
	if value == "" {
		return fallback, nil
	}

	parsed, err := strconv.Atoi(value)
	if err != nil || parsed < 0 {
		return 0, fmt.Errorf("%s must be a non-negative integer", name)
	}
	return parsed, nil
}

func readBoolStrict(name string, fallback bool) (bool, error) {
	value := strings.ToLower(strings.TrimSpace(os.Getenv(name)))
	if value == "" {
		return fallback, nil
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
		prefix := "SUPERVISOR_API_LANE_" + strings.ToUpper(lane) + "_"
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
	values := readStringList("SUPERVISOR_API_OPEN_CAPABILITIES")
	for _, value := range values {
		switch strings.TrimSpace(value) {
		case "campus_services", "notice":
		case "*", "all":
			return nil, fmt.Errorf("SUPERVISOR_API_OPEN_CAPABILITIES does not support wildcard value %q", value)
		default:
			return nil, fmt.Errorf("SUPERVISOR_API_OPEN_CAPABILITIES contains unsupported capability %q", value)
		}
	}
	return values, nil
}
