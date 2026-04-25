package config

import (
	"fmt"
	"os"
	"strconv"
	"strings"
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
	BridgeBreakerFailureThreshold     int
	BridgeBreakerOpenMS               int
	MaxConcurrentAnswers              int
	QueueCapacity                     int
	QueueTimeoutMS                    int
	RequestTimeoutMS                  int
	RequestBodyLimitBytes             int64
	BridgeTimeoutMS                   int
	BridgeCancelTimeoutMS             int
	ShutdownGraceMS                   int
	MetricsBearerToken                string
	LaneBudgets                       map[string]LaneBudget
	OTelEnabled                       bool
	OTelEndpoint                      string
	OTelHeaders                       string
	OTelServiceName                   string
	OTelExportTimeoutMS               int
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
	StructuredQuerySharedSecret       string
	StructuredQueryProjectionPath     string
	StructuredQueryTrustedTimeRFC3339 string
	StructuredQueryTimeoutMS          int
	PromptRuntimeProvider             string
	SupervisorPromptModel             string
	SpecialistPromptModel             string
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
}

type LaneBudget struct {
	MaxConcurrent  int
	QueueCapacity  int
	QueueTimeoutMS int
}

func FromEnv() Config {
	cfg, err := LoadFromEnv()
	if err == nil {
		return cfg
	}

	globalMaxConcurrent := readPositiveInt("SUPERVISOR_API_MAX_CONCURRENT_ANSWERS", 8)
	globalQueueCapacity := readPositiveIntAllowZero("SUPERVISOR_API_QUEUE_CAPACITY", 24)
	globalQueueTimeout := readPositiveInt("SUPERVISOR_API_QUEUE_TIMEOUT_MS", 3_000)

	return Config{
		AppName:                           readString("CAMPUS_AGENT_APP_NAME", "campus-agent"),
		Host:                              readString("CAMPUS_AGENT_HTTP_HOST", "127.0.0.1"),
		Port:                              readPositiveInt("CAMPUS_AGENT_HTTP_PORT", 8000),
		AuthMode:                          readString("API_AUTH_MODE", "bearer"),
		BearerToken:                       strings.TrimSpace(os.Getenv("API_BEARER_TOKEN")),
		WorkerSharedSecret:                strings.TrimSpace(os.Getenv("API_WORKER_SHARED_SECRET")),
		DefaultActorID:                    readString("API_DEFAULT_ACTOR_ID", ""),
		DefaultActorRoles:                 readStringList("API_DEFAULT_ACTOR_ROLES"),
		BridgeBaseURL:                     strings.TrimRight(readString("SUPERVISOR_CORE_WORKER_BASE_URL", ""), "/"),
		BridgeSharedSecret:                strings.TrimSpace(os.Getenv("SUPERVISOR_CORE_WORKER_SHARED_SECRET")),
		BridgeBreakerFailureThreshold:     readPositiveInt("SUPERVISOR_API_BRIDGE_BREAKER_FAILURE_THRESHOLD", 5),
		BridgeBreakerOpenMS:               readPositiveInt("SUPERVISOR_API_BRIDGE_BREAKER_OPEN_MS", 10_000),
		MaxConcurrentAnswers:              globalMaxConcurrent,
		QueueCapacity:                     globalQueueCapacity,
		QueueTimeoutMS:                    globalQueueTimeout,
		RequestTimeoutMS:                  readPositiveInt("SUPERVISOR_API_REQUEST_TIMEOUT_MS", 45_000),
		RequestBodyLimitBytes:             int64(readPositiveInt("SUPERVISOR_API_REQUEST_BODY_LIMIT_BYTES", 1_048_576)),
		BridgeTimeoutMS:                   readPositiveInt("SUPERVISOR_CORE_WORKER_TIMEOUT_MS", 35_000),
		BridgeCancelTimeoutMS:             readPositiveInt("SUPERVISOR_CORE_WORKER_CANCEL_TIMEOUT_MS", 500),
		ShutdownGraceMS:                   readPositiveInt("SUPERVISOR_API_SHUTDOWN_GRACE_MS", 45_000),
		MetricsBearerToken:                strings.TrimSpace(os.Getenv("SUPERVISOR_API_METRICS_BEARER_TOKEN")),
		LaneBudgets:                       readLaneBudgets(globalMaxConcurrent, globalQueueCapacity, globalQueueTimeout),
		OTelEnabled:                       readBool("SUPERVISOR_API_OTEL_ENABLED", false),
		OTelEndpoint:                      strings.TrimSpace(os.Getenv("SUPERVISOR_API_OTEL_EXPORTER_OTLP_ENDPOINT")),
		OTelHeaders:                       strings.TrimSpace(os.Getenv("SUPERVISOR_API_OTEL_EXPORTER_OTLP_HEADERS")),
		OTelServiceName:                   readString("SUPERVISOR_API_OTEL_SERVICE_NAME", "campus-supervisor-api"),
		OTelExportTimeoutMS:               readPositiveInt("SUPERVISOR_API_OTEL_EXPORT_TIMEOUT_MS", 1_000),
		OTelSampleRatio:                   readRatio("SUPERVISOR_API_OTEL_SAMPLE_RATIO", 1.0),
		OTelAllowedAttributesVersion:      readString("SUPERVISOR_API_OTEL_ALLOWED_ATTRIBUTES_VERSION", "supervisor-api-otel-attrs-v1"),
		ExecutionAuditEnabled:             readBool("SUPERVISOR_API_EXECUTION_AUDIT_ENABLED", false),
		ExecutionAuditURL:                 strings.TrimSpace(os.Getenv("SUPERVISOR_API_EXECUTION_AUDIT_URL")),
		ExecutionAuditSharedSecret:        strings.TrimSpace(os.Getenv("SUPERVISOR_API_EXECUTION_AUDIT_SHARED_SECRET")),
		ExecutionAuditTimeoutMS:           readPositiveInt("SUPERVISOR_API_EXECUTION_AUDIT_TIMEOUT_MS", 500),
		ExecutionAuditQueueCapacity:       readPositiveInt("SUPERVISOR_API_EXECUTION_AUDIT_QUEUE_CAPACITY", 128),
		ExecutionAuditBatchSize:           readPositiveInt("SUPERVISOR_API_EXECUTION_AUDIT_BATCH_SIZE", 10),
		ExecutionAuditFlushMS:             readPositiveInt("SUPERVISOR_API_EXECUTION_AUDIT_FLUSH_MS", 1_000),
		ExecutionAuditRetryMaxAttempts:    readPositiveInt("SUPERVISOR_API_EXECUTION_AUDIT_RETRY_MAX_ATTEMPTS", 3),
		ExecutionAuditRetryBaseMS:         readPositiveInt("SUPERVISOR_API_EXECUTION_AUDIT_RETRY_BASE_MS", 100),
		ExecutionAuditSpoolDir:            strings.TrimSpace(os.Getenv("SUPERVISOR_API_EXECUTION_AUDIT_SPOOL_DIR")),
		ExecutionAuditSpoolMaxBytes:       readPositiveInt("SUPERVISOR_API_EXECUTION_AUDIT_SPOOL_MAX_BYTES", 10_485_760),
		OpenCapabilities:                  readStringList("SUPERVISOR_API_OPEN_CAPABILITIES"),
		StructuredQuerySharedSecret:       strings.TrimSpace(os.Getenv("SUPERVISOR_STRUCTURED_QUERY_SHARED_SECRET")),
		StructuredQueryProjectionPath:     strings.TrimSpace(os.Getenv("SUPERVISOR_STRUCTURED_QUERY_PROJECTION_PATH")),
		StructuredQueryTrustedTimeRFC3339: strings.TrimSpace(os.Getenv("SUPERVISOR_STRUCTURED_QUERY_TRUSTED_TIME_RFC3339")),
		StructuredQueryTimeoutMS:          readPositiveInt("SUPERVISOR_STRUCTURED_QUERY_TIMEOUT_MS", 1_000),
		PromptRuntimeProvider:             readFirstString("PROMPT_RUNTIME_PROVIDER", "AGENT_RUNTIME_PROVIDER"),
		SupervisorPromptModel:             readPromptModel("SUPERVISOR_PROMPT_MODEL"),
		SpecialistPromptModel:             readPromptModel("SPECIALIST_PROMPT_MODEL"),
		PromptRuntimeAPIKey:               readFirstString("PROMPT_RUNTIME_API_KEY", "LLM_API_KEY"),
		PromptRuntimeTransport:            readString("PROMPT_RUNTIME_TRANSPORT", "responses"),
		PromptRuntimeBaseURL:              readString("PROMPT_RUNTIME_BASE_URL", readString("LLM_BASE_URL", "https://api.openai.com/v1")),
		PromptStrictStructuredOutputs:     readBool("PROMPT_STRICT_STRUCTURED_OUTPUTS", true),
		NoticeReadModelDatabaseURL:        readNoticeReadModelDatabaseURL(),
		NoticeReadModelTable:              readString("INTERNAL_NOTICE_READ_MODEL_TABLE", "ingestion_projection.internal_notice_read_model"),
		NoticeObjectStoreEndpoint:         strings.TrimSpace(os.Getenv("OBJECT_STORE_ENDPOINT")),
		NoticeObjectStoreAccessKey:        readFirstString("OBJECT_STORE_DERIVED_ACCESS_KEY", "OBJECT_STORE_ACCESS_KEY"),
		NoticeObjectStoreSecretKey:        readFirstString("OBJECT_STORE_DERIVED_SECRET_KEY", "OBJECT_STORE_SECRET_KEY"),
		NoticeObjectStoreRegion:           readString("OBJECT_STORE_REGION", "us-east-1"),
		NoticeObjectStoreBucketDerived:    readString("OBJECT_STORE_BUCKET_DERIVED", "campus-rag-derived"),
	}
}

func LoadFromEnv() (Config, error) {
	port, err := readPositiveIntStrict("CAMPUS_AGENT_HTTP_PORT", 8000)
	if err != nil {
		return Config{}, err
	}
	maxConcurrent, err := readPositiveIntStrict("SUPERVISOR_API_MAX_CONCURRENT_ANSWERS", 8)
	if err != nil {
		return Config{}, err
	}
	queueCapacity, err := readNonNegativeIntStrict("SUPERVISOR_API_QUEUE_CAPACITY", 24)
	if err != nil {
		return Config{}, err
	}
	queueTimeout, err := readPositiveIntStrict("SUPERVISOR_API_QUEUE_TIMEOUT_MS", 3_000)
	if err != nil {
		return Config{}, err
	}
	requestTimeout, err := readPositiveIntStrict("SUPERVISOR_API_REQUEST_TIMEOUT_MS", 45_000)
	if err != nil {
		return Config{}, err
	}
	bodyLimit, err := readPositiveIntStrict("SUPERVISOR_API_REQUEST_BODY_LIMIT_BYTES", 1_048_576)
	if err != nil {
		return Config{}, err
	}
	bridgeTimeout, err := readPositiveIntStrict("SUPERVISOR_CORE_WORKER_TIMEOUT_MS", 35_000)
	if err != nil {
		return Config{}, err
	}
	bridgeCancelTimeout, err := readPositiveIntStrict("SUPERVISOR_CORE_WORKER_CANCEL_TIMEOUT_MS", 500)
	if err != nil {
		return Config{}, err
	}
	bridgeBreakerFailureThreshold, err := readPositiveIntStrict("SUPERVISOR_API_BRIDGE_BREAKER_FAILURE_THRESHOLD", 5)
	if err != nil {
		return Config{}, err
	}
	bridgeBreakerOpenMS, err := readPositiveIntStrict("SUPERVISOR_API_BRIDGE_BREAKER_OPEN_MS", 10_000)
	if err != nil {
		return Config{}, err
	}
	shutdownGrace, err := readPositiveIntStrict("SUPERVISOR_API_SHUTDOWN_GRACE_MS", 45_000)
	if err != nil {
		return Config{}, err
	}
	laneBudgets, err := readLaneBudgetsStrict(maxConcurrent, queueCapacity, queueTimeout)
	if err != nil {
		return Config{}, err
	}
	otelEnabled, err := readBoolStrict("SUPERVISOR_API_OTEL_ENABLED", false)
	if err != nil {
		return Config{}, err
	}
	otelExportTimeout, err := readPositiveIntStrict("SUPERVISOR_API_OTEL_EXPORT_TIMEOUT_MS", 1_000)
	if err != nil {
		return Config{}, err
	}
	otelSampleRatio, err := readRatioStrict("SUPERVISOR_API_OTEL_SAMPLE_RATIO", 1.0)
	if err != nil {
		return Config{}, err
	}
	executionAuditEnabled, err := readBoolStrict("SUPERVISOR_API_EXECUTION_AUDIT_ENABLED", false)
	if err != nil {
		return Config{}, err
	}
	executionAuditTimeout, err := readPositiveIntStrict("SUPERVISOR_API_EXECUTION_AUDIT_TIMEOUT_MS", 500)
	if err != nil {
		return Config{}, err
	}
	executionAuditQueueCapacity, err := readPositiveIntStrict(
		"SUPERVISOR_API_EXECUTION_AUDIT_QUEUE_CAPACITY",
		128,
	)
	if err != nil {
		return Config{}, err
	}
	executionAuditBatchSize, err := readPositiveIntStrict("SUPERVISOR_API_EXECUTION_AUDIT_BATCH_SIZE", 10)
	if err != nil {
		return Config{}, err
	}
	executionAuditFlushMS, err := readPositiveIntStrict("SUPERVISOR_API_EXECUTION_AUDIT_FLUSH_MS", 1_000)
	if err != nil {
		return Config{}, err
	}
	executionAuditRetryMaxAttempts, err := readPositiveIntStrict(
		"SUPERVISOR_API_EXECUTION_AUDIT_RETRY_MAX_ATTEMPTS",
		3,
	)
	if err != nil {
		return Config{}, err
	}
	executionAuditRetryBaseMS, err := readPositiveIntStrict("SUPERVISOR_API_EXECUTION_AUDIT_RETRY_BASE_MS", 100)
	if err != nil {
		return Config{}, err
	}
	executionAuditSpoolMaxBytes, err := readPositiveIntStrict(
		"SUPERVISOR_API_EXECUTION_AUDIT_SPOOL_MAX_BYTES",
		10_485_760,
	)
	if err != nil {
		return Config{}, err
	}
	structuredQueryTimeout, err := readPositiveIntStrict("SUPERVISOR_STRUCTURED_QUERY_TIMEOUT_MS", 1_000)
	if err != nil {
		return Config{}, err
	}
	promptStrictStructuredOutputs, err := readBoolStrict("PROMPT_STRICT_STRUCTURED_OUTPUTS", true)
	if err != nil {
		return Config{}, err
	}

	return Config{
		AppName:                           readString("CAMPUS_AGENT_APP_NAME", "campus-agent"),
		Host:                              readString("CAMPUS_AGENT_HTTP_HOST", "127.0.0.1"),
		Port:                              port,
		AuthMode:                          readString("API_AUTH_MODE", "bearer"),
		BearerToken:                       strings.TrimSpace(os.Getenv("API_BEARER_TOKEN")),
		WorkerSharedSecret:                strings.TrimSpace(os.Getenv("API_WORKER_SHARED_SECRET")),
		DefaultActorID:                    readString("API_DEFAULT_ACTOR_ID", ""),
		DefaultActorRoles:                 readStringList("API_DEFAULT_ACTOR_ROLES"),
		BridgeBaseURL:                     strings.TrimRight(readString("SUPERVISOR_CORE_WORKER_BASE_URL", ""), "/"),
		BridgeSharedSecret:                strings.TrimSpace(os.Getenv("SUPERVISOR_CORE_WORKER_SHARED_SECRET")),
		BridgeBreakerFailureThreshold:     bridgeBreakerFailureThreshold,
		BridgeBreakerOpenMS:               bridgeBreakerOpenMS,
		MaxConcurrentAnswers:              maxConcurrent,
		QueueCapacity:                     queueCapacity,
		QueueTimeoutMS:                    queueTimeout,
		RequestTimeoutMS:                  requestTimeout,
		RequestBodyLimitBytes:             int64(bodyLimit),
		BridgeTimeoutMS:                   bridgeTimeout,
		BridgeCancelTimeoutMS:             bridgeCancelTimeout,
		ShutdownGraceMS:                   shutdownGrace,
		MetricsBearerToken:                strings.TrimSpace(os.Getenv("SUPERVISOR_API_METRICS_BEARER_TOKEN")),
		LaneBudgets:                       laneBudgets,
		OTelEnabled:                       otelEnabled,
		OTelEndpoint:                      strings.TrimSpace(os.Getenv("SUPERVISOR_API_OTEL_EXPORTER_OTLP_ENDPOINT")),
		OTelHeaders:                       strings.TrimSpace(os.Getenv("SUPERVISOR_API_OTEL_EXPORTER_OTLP_HEADERS")),
		OTelServiceName:                   readString("SUPERVISOR_API_OTEL_SERVICE_NAME", "campus-supervisor-api"),
		OTelExportTimeoutMS:               otelExportTimeout,
		OTelSampleRatio:                   otelSampleRatio,
		OTelAllowedAttributesVersion:      readString("SUPERVISOR_API_OTEL_ALLOWED_ATTRIBUTES_VERSION", "supervisor-api-otel-attrs-v1"),
		ExecutionAuditEnabled:             executionAuditEnabled,
		ExecutionAuditURL:                 strings.TrimSpace(os.Getenv("SUPERVISOR_API_EXECUTION_AUDIT_URL")),
		ExecutionAuditSharedSecret:        strings.TrimSpace(os.Getenv("SUPERVISOR_API_EXECUTION_AUDIT_SHARED_SECRET")),
		ExecutionAuditTimeoutMS:           executionAuditTimeout,
		ExecutionAuditQueueCapacity:       executionAuditQueueCapacity,
		ExecutionAuditBatchSize:           executionAuditBatchSize,
		ExecutionAuditFlushMS:             executionAuditFlushMS,
		ExecutionAuditRetryMaxAttempts:    executionAuditRetryMaxAttempts,
		ExecutionAuditRetryBaseMS:         executionAuditRetryBaseMS,
		ExecutionAuditSpoolDir:            strings.TrimSpace(os.Getenv("SUPERVISOR_API_EXECUTION_AUDIT_SPOOL_DIR")),
		ExecutionAuditSpoolMaxBytes:       executionAuditSpoolMaxBytes,
		OpenCapabilities:                  readStringList("SUPERVISOR_API_OPEN_CAPABILITIES"),
		StructuredQuerySharedSecret:       strings.TrimSpace(os.Getenv("SUPERVISOR_STRUCTURED_QUERY_SHARED_SECRET")),
		StructuredQueryProjectionPath:     strings.TrimSpace(os.Getenv("SUPERVISOR_STRUCTURED_QUERY_PROJECTION_PATH")),
		StructuredQueryTrustedTimeRFC3339: strings.TrimSpace(os.Getenv("SUPERVISOR_STRUCTURED_QUERY_TRUSTED_TIME_RFC3339")),
		StructuredQueryTimeoutMS:          structuredQueryTimeout,
		PromptRuntimeProvider:             readFirstString("PROMPT_RUNTIME_PROVIDER", "AGENT_RUNTIME_PROVIDER"),
		SupervisorPromptModel:             readPromptModel("SUPERVISOR_PROMPT_MODEL"),
		SpecialistPromptModel:             readPromptModel("SPECIALIST_PROMPT_MODEL"),
		PromptRuntimeAPIKey:               readFirstString("PROMPT_RUNTIME_API_KEY", "LLM_API_KEY"),
		PromptRuntimeTransport:            readString("PROMPT_RUNTIME_TRANSPORT", "responses"),
		PromptRuntimeBaseURL:              readString("PROMPT_RUNTIME_BASE_URL", readString("LLM_BASE_URL", "https://api.openai.com/v1")),
		PromptStrictStructuredOutputs:     promptStrictStructuredOutputs,
		NoticeReadModelDatabaseURL:        readNoticeReadModelDatabaseURL(),
		NoticeReadModelTable:              readString("INTERNAL_NOTICE_READ_MODEL_TABLE", "ingestion_projection.internal_notice_read_model"),
		NoticeObjectStoreEndpoint:         strings.TrimSpace(os.Getenv("OBJECT_STORE_ENDPOINT")),
		NoticeObjectStoreAccessKey:        readFirstString("OBJECT_STORE_DERIVED_ACCESS_KEY", "OBJECT_STORE_ACCESS_KEY"),
		NoticeObjectStoreSecretKey:        readFirstString("OBJECT_STORE_DERIVED_SECRET_KEY", "OBJECT_STORE_SECRET_KEY"),
		NoticeObjectStoreRegion:           readString("OBJECT_STORE_REGION", "us-east-1"),
		NoticeObjectStoreBucketDerived:    readString("OBJECT_STORE_BUCKET_DERIVED", "campus-rag-derived"),
	}, nil
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
	if strings.HasPrefix(databaseURL, "postgres://") {
		return "postgresql://" + strings.TrimPrefix(databaseURL, "postgres://")
	}
	return databaseURL
}

func readPositiveInt(name string, fallback int) int {
	value := strings.TrimSpace(os.Getenv(name))
	if value == "" {
		return fallback
	}

	parsed, err := strconv.Atoi(value)
	if err != nil || parsed <= 0 {
		return fallback
	}
	return parsed
}

func readPositiveIntAllowZero(name string, fallback int) int {
	value := strings.TrimSpace(os.Getenv(name))
	if value == "" {
		return fallback
	}

	parsed, err := strconv.Atoi(value)
	if err != nil || parsed < 0 {
		return fallback
	}
	return parsed
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

func readBool(name string, fallback bool) bool {
	value := strings.ToLower(strings.TrimSpace(os.Getenv(name)))
	if value == "" {
		return fallback
	}
	switch value {
	case "1", "true", "yes", "on":
		return true
	case "0", "false", "no", "off":
		return false
	default:
		return fallback
	}
}

func readBoolStrict(name string, fallback bool) (bool, error) {
	value := strings.ToLower(strings.TrimSpace(os.Getenv(name)))
	if value == "" {
		return fallback, nil
	}
	switch value {
	case "1", "true", "yes", "on":
		return true, nil
	case "0", "false", "no", "off":
		return false, nil
	default:
		return false, fmt.Errorf("%s must be a boolean", name)
	}
}

func readRatio(name string, fallback float64) float64 {
	value := strings.TrimSpace(os.Getenv(name))
	if value == "" {
		return fallback
	}
	parsed, err := strconv.ParseFloat(value, 64)
	if err != nil || parsed < 0 || parsed > 1 {
		return fallback
	}
	return parsed
}

func readRatioStrict(name string, fallback float64) (float64, error) {
	value := strings.TrimSpace(os.Getenv(name))
	if value == "" {
		return fallback, nil
	}
	parsed, err := strconv.ParseFloat(value, 64)
	if err != nil || parsed < 0 || parsed > 1 {
		return 0, fmt.Errorf("%s must be a number between 0 and 1", name)
	}
	return parsed, nil
}

func readLaneBudgets(
	globalMaxConcurrent int,
	globalQueueCapacity int,
	globalQueueTimeoutMS int,
) map[string]LaneBudget {
	budgets := make(map[string]LaneBudget, len(laneNames()))
	for _, lane := range laneNames() {
		prefix := "SUPERVISOR_API_LANE_" + strings.ToUpper(lane) + "_"
		budgets[lane] = LaneBudget{
			MaxConcurrent: readPositiveInt(
				prefix+"MAX_CONCURRENT",
				globalMaxConcurrent,
			),
			QueueCapacity: readPositiveIntAllowZero(
				prefix+"QUEUE_CAPACITY",
				globalQueueCapacity,
			),
			QueueTimeoutMS: readPositiveInt(
				prefix+"QUEUE_TIMEOUT_MS",
				globalQueueTimeoutMS,
			),
		}
	}
	return budgets
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
