package config

import (
	"fmt"
	"os"
	"strings"

	env "github.com/caarlos0/env/v11"
)

type Config struct {
	AppName                          string
	DeploymentEnvironment            string
	Host                             string
	Port                             int
	RuntimeMode                      string
	RuntimeRelease                   string
	AuthMode                         string
	BearerToken                      string
	AppAPIExecutionSharedSecret      string
	DefaultActorID                   string
	DefaultActorRoles                []string
	ExecutionResponseLimitBytes      int64
	ExecutionBreakerFailureThreshold int
	ExecutionBreakerOpenMS           int
	ExecutionRetryMaxAttempts        int
	ExecutionRetryBaseMS             int
	MaxConcurrentAnswers             int
	QueueCapacity                    int
	QueueTimeoutMS                   int
	RequestTimeoutMS                 int
	RequestBodyLimitBytes            int64
	ExecutionTimeoutMS               int
	ExecutionCancelTimeoutMS         int
	ShutdownGraceMS                  int
	OpsWebInternalToken              string
	OTelEnabled                      bool
	OTelEndpoint                     string
	OTelMetricsEnabled               bool
	OTelMetricsEndpoint              string
	OTelServiceName                  string
	OTelExportTimeoutMS              int
	OTelExportIntervalMS             int
	OTelSampleRatio                  float64
	OTelAllowedAttributesVersion     string
	TemporalTracingEnabled           bool
	RunProjectionDatabaseURL         string
	RunProjectionAutoMigrate         bool
	TemporalAddress                  string
	TemporalNamespace                string
	TemporalTaskQueue                string
	TemporalWorkerIdentity           string
	TemporalWorkflowIDSalt           string
	TemporalStartTimeoutMS           int
	AgentRuntimeBaseURL              string
	AgentRuntimeSharedSecret         string
	AgentRuntimeDeadlineMS           int
	AgentRuntimeMaxOutputTokens      int
	AgentRuntimeMaxTurns             int
	AgentRuntimeSearchLimit          int
	AgentRuntimeInputCharLimit       int
	AgentRuntimeContextCharLimit     int
	ProductCallbackBaseURL           string
	ProductCallbackTimeoutMS         int
	ProviderConfigReaderDatabaseURL  string
	ProviderConfigAdminDatabaseURL   string
	ProviderConfigKeyringPath        string
	QueryServingTargetsPath          string
	ToolReadModelTrustedTimeRFC3339  string
	ToolReadModelTimeoutMS           int
	StructuredProjectionDatabaseURL  string
	QdrantURL                        string
	QdrantQueryAPIKey                string
	QdrantTLSCACertPath              string
	QdrantTimeoutSeconds             float64
	RAGTopKMax                       int
	RAGEmbeddingTimeoutMS            int
	RAGQdrantTimeoutMS               int
	WorkerProfiles                   map[string]WorkerProfile
	PersonalMemoryRuntime            string
	PersonalMemoryBaseURL            string
	PersonalMemoryAPISecret          string
	PersonalMemoryOwnerSalt          string
	PersonalMemoryTimeoutSeconds     float64
	PersonalMemoryRecallLimit        int
	PersonalMemoryRecallMaxTokens    int
	PersonalMemoryContextCharBudget  int
	LangfuseMaintenanceBaseURL       string
	LangfuseMaintenancePublicKey     string
	LangfuseMaintenanceSecretKey     string
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
	AppName                         string `env:"CAMPUS_AGENT_APP_NAME" envDefault:"campus-agent"`
	DeploymentEnvironment           string `env:"DEPLOYMENT_ENVIRONMENT"`
	Host                            string `env:"CAMPUS_AGENT_HTTP_HOST" envDefault:"127.0.0.1"`
	Port                            int    `env:"CAMPUS_AGENT_HTTP_PORT" envDefault:"8000"`
	RuntimeMode                     string `env:"EXECUTION_CONTROL_RUNTIME_MODE" envDefault:"local"`
	RuntimeRelease                  string `env:"EXECUTION_CONTROL_RUNTIME_RELEASE"`
	AuthMode                        string `env:"API_AUTH_MODE" envDefault:"bearer"`
	BearerToken                     string `env:"API_BEARER_TOKEN"`
	AppAPIExecutionSharedSecret     string `env:"APP_API_EXECUTION_SHARED_SECRET"`
	DefaultActorID                  string `env:"API_DEFAULT_ACTOR_ID"`
	MaxConcurrentAnswers            int
	QueueCapacity                   int
	QueueTimeoutMS                  int
	RequestTimeoutMS                int
	RequestBodyLimitBytes           int64
	ShutdownGraceMS                 int
	OpsWebInternalToken             string `env:"OPS_WEB_INTERNAL_TOKEN"`
	OTelEndpoint                    string
	OTelMetricsEndpoint             string
	OTelServiceName                 string
	OTelExportTimeoutMS             int
	OTelExportIntervalMS            int
	OTelSampleRatio                 float64
	OTelAllowedAttributesVersion    string
	TemporalTracingEnabled          bool
	RunProjectionDatabaseURL        string `env:"EXECUTION_CONTROL_RUN_PROJECTION_DATABASE_URL"`
	TemporalAddress                 string `env:"EXECUTION_CONTROL_TEMPORAL_ADDRESS"`
	TemporalNamespace               string `env:"EXECUTION_CONTROL_TEMPORAL_NAMESPACE"`
	TemporalTaskQueue               string `env:"EXECUTION_CONTROL_TEMPORAL_TASK_QUEUE" envDefault:"campus-agent.workflow"`
	TemporalWorkerIdentity          string `env:"EXECUTION_CONTROL_TEMPORAL_WORKER_IDENTITY"`
	TemporalWorkflowIDSalt          string `env:"EXECUTION_CONTROL_TEMPORAL_WORKFLOW_ID_SALT"`
	TemporalStartTimeoutMS          int    `env:"EXECUTION_CONTROL_TEMPORAL_START_TIMEOUT_MS" envDefault:"5000"`
	AgentRuntimeBaseURL             string `env:"EXECUTION_CONTROL_AGENT_RUNTIME_BASE_URL"`
	AgentRuntimeSharedSecret        string `env:"EXECUTION_AGENT_RUNTIME_SHARED_SECRET"`
	AgentRuntimeDeadlineMS          int
	AgentRuntimeMaxOutputTokens     int
	AgentRuntimeMaxTurns            int
	AgentRuntimeSearchLimit         int
	AgentRuntimeInputCharLimit      int
	AgentRuntimeContextCharLimit    int
	ProductCallbackBaseURL          string `env:"EXECUTION_CONTROL_PRODUCT_CALLBACK_BASE_URL"`
	ProductCallbackTimeoutMS        int    `env:"EXECUTION_CONTROL_PRODUCT_CALLBACK_TIMEOUT_MS" envDefault:"1000"`
	ProviderConfigReaderDatabaseURL string `env:"EXECUTION_CONTROL_PROVIDER_CONFIG_READER_DATABASE_URL"`
	ProviderConfigAdminDatabaseURL  string `env:"EXECUTION_CONTROL_PROVIDER_CONFIG_ADMIN_DATABASE_URL"`
	ProviderConfigKeyringPath       string `env:"EXECUTION_CONTROL_PROVIDER_CONFIG_KEYRING_PATH"`
	QueryServingTargetsPath         string
	ToolReadModelTrustedTimeRFC3339 string `env:"EXECUTION_CONTROL_TOOL_READ_MODEL_TRUSTED_TIME_RFC3339"`
	ToolReadModelTimeoutMS          int
	QdrantURL                       string  `env:"QDRANT_URL"`
	QdrantQueryAPIKey               string  `env:"QDRANT_QUERY_API_KEY"`
	QdrantTLSCACertPath             string  `env:"QDRANT_TLS_CA_CERT_PATH"`
	QdrantTimeoutSeconds            float64 `env:"QDRANT_TIMEOUT_SECONDS" envDefault:"10"`
	RAGTopKMax                      int
	RAGEmbeddingTimeoutMS           int
	RAGQdrantTimeoutMS              int
	PersonalMemoryRuntime           string
	PersonalMemoryBaseURL           string `env:"PERSONAL_MEMORY_BASE_URL"`
	PersonalMemoryAPISecret         string `env:"PERSONAL_MEMORY_API_SECRET"`
	PersonalMemoryOwnerSalt         string `env:"PERSONAL_MEMORY_OWNER_SALT"`
	PersonalMemoryTimeoutSeconds    float64
	PersonalMemoryRecallLimit       int
	PersonalMemoryRecallMaxTokens   int
	PersonalMemoryContextCharBudget int
	LangfuseMaintenanceBaseURL      string `env:"LANGFUSE_MAINTENANCE_BASE_URL"`
	LangfuseMaintenancePublicKey    string `env:"LANGFUSE_MAINTENANCE_PUBLIC_KEY"`
	LangfuseMaintenanceSecretKey    string `env:"LANGFUSE_MAINTENANCE_SECRET_KEY"`
}

func LoadFromEnv() (Config, error) {
	return LoadFromEnvForRole("")
}

func LoadFromEnvForRole(runtimeRole string) (Config, error) {
	if strings.TrimSpace(os.Getenv("EXECUTION_CONTROL_PROVIDER_CONFIG_DATABASE_URL")) != "" {
		return Config{}, fmt.Errorf("EXECUTION_CONTROL_PROVIDER_CONFIG_DATABASE_URL is retired; use the role-specific provider config reader or admin database URL")
	}
	if err := rejectRuntimeConfigOwnedEnvSettings(); err != nil {
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
	runtimeConfigFile, err := loadRuntimeConfigFromEnv()
	if err != nil {
		return Config{}, err
	}
	values = applyRuntimeConfigValues(values, runtimeConfigFile)
	otelEnabled := false
	if runtimeConfigFile.OTel != nil {
		otelEnabled = boolFromRuntimeConfig(runtimeConfigFile.OTel.Enabled, otelEnabled)
	}
	otelMetricsEnabled := false
	if runtimeConfigFile.OTel != nil {
		otelMetricsEnabled = boolFromRuntimeConfig(runtimeConfigFile.OTel.MetricsEnabled, otelMetricsEnabled)
	}
	runtimeMode, err := normalizeRuntimeMode(values.RuntimeMode)
	if err != nil {
		return Config{}, err
	}
	if err := validateEnvValues(values, runtimeMode, runtimeRole, otelEnabled); err != nil {
		return Config{}, err
	}
	workerProfiles, err := readWorkerProfilesStrict()
	if err != nil {
		return Config{}, err
	}
	workerProfiles, err = applyRuntimeConfigWorkerProfiles(workerProfiles, runtimeConfigFile)
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
	if err := validateTemporalSettings(values, runtimeMode, runtimeRole); err != nil {
		return Config{}, err
	}
	if err := validatePersonalMemorySettings(values, runtimeMode, runtimeRole); err != nil {
		return Config{}, err
	}

	return Config{
		AppName:                         defaultString(strings.TrimSpace(values.AppName), "campus-agent"),
		DeploymentEnvironment:           defaultString(strings.TrimSpace(values.DeploymentEnvironment), runtimeMode),
		Host:                            defaultString(strings.TrimSpace(values.Host), "127.0.0.1"),
		Port:                            values.Port,
		RuntimeMode:                     runtimeMode,
		RuntimeRelease:                  strings.TrimSpace(values.RuntimeRelease),
		AuthMode:                        defaultString(strings.TrimSpace(values.AuthMode), "bearer"),
		BearerToken:                     strings.TrimSpace(values.BearerToken),
		AppAPIExecutionSharedSecret:     strings.TrimSpace(values.AppAPIExecutionSharedSecret),
		DefaultActorID:                  strings.TrimSpace(values.DefaultActorID),
		DefaultActorRoles:               readStringList("API_DEFAULT_ACTOR_ROLES"),
		MaxConcurrentAnswers:            values.MaxConcurrentAnswers,
		QueueCapacity:                   values.QueueCapacity,
		QueueTimeoutMS:                  values.QueueTimeoutMS,
		RequestTimeoutMS:                values.RequestTimeoutMS,
		RequestBodyLimitBytes:           values.RequestBodyLimitBytes,
		ShutdownGraceMS:                 values.ShutdownGraceMS,
		OpsWebInternalToken:             strings.TrimSpace(values.OpsWebInternalToken),
		OTelEnabled:                     otelEnabled,
		OTelEndpoint:                    strings.TrimSpace(values.OTelEndpoint),
		OTelMetricsEnabled:              otelMetricsEnabled,
		OTelMetricsEndpoint:             strings.TrimSpace(values.OTelMetricsEndpoint),
		OTelServiceName:                 defaultString(strings.TrimSpace(values.OTelServiceName), "campus-execution-control"),
		OTelExportTimeoutMS:             values.OTelExportTimeoutMS,
		OTelExportIntervalMS:            values.OTelExportIntervalMS,
		OTelSampleRatio:                 values.OTelSampleRatio,
		OTelAllowedAttributesVersion:    defaultString(strings.TrimSpace(values.OTelAllowedAttributesVersion), "execution-control-otel-attrs-v1"),
		TemporalTracingEnabled:          values.TemporalTracingEnabled,
		RunProjectionDatabaseURL:        readRunProjectionDatabaseURL(values),
		RunProjectionAutoMigrate:        runProjectionAutoMigrate,
		TemporalAddress:                 strings.TrimSpace(values.TemporalAddress),
		TemporalNamespace:               strings.TrimSpace(values.TemporalNamespace),
		TemporalTaskQueue:               defaultString(strings.TrimSpace(values.TemporalTaskQueue), "campus-agent.workflow"),
		TemporalWorkerIdentity:          strings.TrimSpace(values.TemporalWorkerIdentity),
		TemporalWorkflowIDSalt:          strings.TrimSpace(values.TemporalWorkflowIDSalt),
		TemporalStartTimeoutMS:          values.TemporalStartTimeoutMS,
		AgentRuntimeBaseURL:             strings.TrimRight(strings.TrimSpace(values.AgentRuntimeBaseURL), "/"),
		AgentRuntimeSharedSecret:        strings.TrimSpace(values.AgentRuntimeSharedSecret),
		AgentRuntimeDeadlineMS:          values.AgentRuntimeDeadlineMS,
		AgentRuntimeMaxOutputTokens:     values.AgentRuntimeMaxOutputTokens,
		AgentRuntimeMaxTurns:            values.AgentRuntimeMaxTurns,
		AgentRuntimeSearchLimit:         values.AgentRuntimeSearchLimit,
		AgentRuntimeInputCharLimit:      values.AgentRuntimeInputCharLimit,
		AgentRuntimeContextCharLimit:    values.AgentRuntimeContextCharLimit,
		ProductCallbackBaseURL:          strings.TrimRight(strings.TrimSpace(values.ProductCallbackBaseURL), "/"),
		ProductCallbackTimeoutMS:        values.ProductCallbackTimeoutMS,
		ProviderConfigReaderDatabaseURL: strings.TrimSpace(values.ProviderConfigReaderDatabaseURL),
		ProviderConfigAdminDatabaseURL:  strings.TrimSpace(values.ProviderConfigAdminDatabaseURL),
		ProviderConfigKeyringPath:       strings.TrimSpace(values.ProviderConfigKeyringPath),
		QueryServingTargetsPath:         strings.TrimSpace(values.QueryServingTargetsPath),
		ToolReadModelTrustedTimeRFC3339: strings.TrimSpace(values.ToolReadModelTrustedTimeRFC3339),
		ToolReadModelTimeoutMS:          values.ToolReadModelTimeoutMS,
		StructuredProjectionDatabaseURL: readStructuredProjectionDatabaseURL(),
		QdrantURL:                       strings.TrimRight(strings.TrimSpace(values.QdrantURL), "/"),
		QdrantQueryAPIKey:               strings.TrimSpace(values.QdrantQueryAPIKey),
		QdrantTLSCACertPath:             strings.TrimSpace(values.QdrantTLSCACertPath),
		QdrantTimeoutSeconds:            values.QdrantTimeoutSeconds,
		RAGTopKMax:                      values.RAGTopKMax,
		RAGEmbeddingTimeoutMS:           values.RAGEmbeddingTimeoutMS,
		RAGQdrantTimeoutMS:              values.RAGQdrantTimeoutMS,
		WorkerProfiles:                  workerProfiles,
		PersonalMemoryRuntime:           defaultString(strings.TrimSpace(values.PersonalMemoryRuntime), "hindsight"),
		PersonalMemoryBaseURL:           strings.TrimRight(strings.TrimSpace(values.PersonalMemoryBaseURL), "/"),
		PersonalMemoryAPISecret:         strings.TrimSpace(values.PersonalMemoryAPISecret),
		PersonalMemoryOwnerSalt:         strings.TrimSpace(values.PersonalMemoryOwnerSalt),
		PersonalMemoryTimeoutSeconds:    values.PersonalMemoryTimeoutSeconds,
		PersonalMemoryRecallLimit:       values.PersonalMemoryRecallLimit,
		PersonalMemoryRecallMaxTokens:   values.PersonalMemoryRecallMaxTokens,
		PersonalMemoryContextCharBudget: values.PersonalMemoryContextCharBudget,
		LangfuseMaintenanceBaseURL:      strings.TrimRight(strings.TrimSpace(values.LangfuseMaintenanceBaseURL), "/"),
		LangfuseMaintenancePublicKey:    strings.TrimSpace(values.LangfuseMaintenancePublicKey),
		LangfuseMaintenanceSecretKey:    strings.TrimSpace(values.LangfuseMaintenanceSecretKey),
	}, nil
}

func parseEnvValues() (envValues, error) {
	values := envValues{}
	if err := env.Parse(&values); err != nil {
		return envValues{}, fmt.Errorf("parse execution-control env: %w", err)
	}
	return values, nil
}

func validateEnvValues(values envValues, runtimeMode string, runtimeRole string, otelEnabled bool) error {
	checks := []struct {
		name  string
		value int
	}{
		{"CAMPUS_AGENT_HTTP_PORT", values.Port},
		{"runtime config max_concurrent_answers", values.MaxConcurrentAnswers},
		{"runtime config queue_timeout_ms", values.QueueTimeoutMS},
		{"runtime config request_timeout_ms", values.RequestTimeoutMS},
		{"runtime config shutdown_grace_ms", values.ShutdownGraceMS},
		{"runtime config otel.export_timeout_ms", values.OTelExportTimeoutMS},
		{"runtime config otel.export_interval_ms", values.OTelExportIntervalMS},
		{"runtime config tool_read_model_timeout_ms", values.ToolReadModelTimeoutMS},
		{"EXECUTION_CONTROL_TEMPORAL_START_TIMEOUT_MS", values.TemporalStartTimeoutMS},
		{"runtime config agent_runtime.deadline_ms", values.AgentRuntimeDeadlineMS},
		{"runtime config agent_runtime.max_output_tokens", values.AgentRuntimeMaxOutputTokens},
		{"runtime config agent_runtime.max_turns", values.AgentRuntimeMaxTurns},
		{"runtime config agent_runtime.max_knowledge_searches", values.AgentRuntimeSearchLimit},
		{"runtime config agent_runtime.current_input_char_limit", values.AgentRuntimeInputCharLimit},
		{"runtime config agent_runtime.final_model_context_char_limit", values.AgentRuntimeContextCharLimit},
		{"runtime config knowledge_search.top_k_max", values.RAGTopKMax},
		{"runtime config knowledge_search.embedding_timeout_ms", values.RAGEmbeddingTimeoutMS},
		{"runtime config knowledge_search.qdrant_timeout_ms", values.RAGQdrantTimeoutMS},
		{"EXECUTION_CONTROL_PRODUCT_CALLBACK_TIMEOUT_MS", values.ProductCallbackTimeoutMS},
	}
	for _, check := range checks {
		if check.value <= 0 {
			return fmt.Errorf("%s must be a positive integer", check.name)
		}
	}
	if values.AgentRuntimeSearchLimit > MaxKnowledgeSearches {
		return fmt.Errorf(
			"runtime config agent_runtime.max_knowledge_searches must not exceed %d",
			MaxKnowledgeSearches,
		)
	}
	if values.QueueCapacity < 0 {
		return fmt.Errorf("runtime config queue_capacity must be a non-negative integer")
	}
	if values.RequestBodyLimitBytes <= 0 {
		return fmt.Errorf("runtime config request_body_limit_bytes must be a positive integer")
	}
	if values.QdrantTimeoutSeconds <= 0 {
		return fmt.Errorf("QDRANT_TIMEOUT_SECONDS must be greater than zero")
	}
	if values.PersonalMemoryTimeoutSeconds <= 0 {
		return fmt.Errorf("runtime config personal_memory.timeout_seconds must be greater than zero")
	}
	if values.PersonalMemoryRecallLimit <= 0 {
		return fmt.Errorf("runtime config personal_memory.recall_limit must be a positive integer")
	}
	if values.PersonalMemoryRecallMaxTokens <= 0 {
		return fmt.Errorf("runtime config personal_memory.recall_max_tokens must be a positive integer")
	}
	if values.PersonalMemoryContextCharBudget <= 0 {
		return fmt.Errorf("runtime config personal_memory.context_char_budget must be a positive integer")
	}
	if values.OTelSampleRatio < 0 || values.OTelSampleRatio > 1 {
		return fmt.Errorf("runtime config otel.sample_ratio must be a number between 0 and 1")
	}
	if values.TemporalTracingEnabled && !otelEnabled {
		return fmt.Errorf("runtime config otel.enabled=true is required when otel.temporal_tracing_enabled=true")
	}
	if otelEnabled && strings.TrimSpace(values.RuntimeRelease) == "" {
		return fmt.Errorf("EXECUTION_CONTROL_RUNTIME_RELEASE is required when runtime config otel.enabled=true")
	}
	if runtimeMode != "local" &&
		roleRequiresOpsWebInternalToken(runtimeRole) &&
		strings.TrimSpace(values.OpsWebInternalToken) == "" {
		return fmt.Errorf(
			"OPS_WEB_INTERNAL_TOKEN is required when EXECUTION_CONTROL_RUNTIME_MODE=%s",
			runtimeMode,
		)
	}
	if runtimeMode != "local" &&
		roleRequiresRunProjectionDatabaseURL(runtimeRole) &&
		strings.TrimSpace(values.RunProjectionDatabaseURL) == "" {
		return fmt.Errorf(
			"EXECUTION_CONTROL_RUN_PROJECTION_DATABASE_URL is required when EXECUTION_CONTROL_RUNTIME_MODE=%s",
			runtimeMode,
		)
	}
	if runtimeMode != "local" &&
		roleRequiresAgentRuntimeClient(runtimeRole) &&
		(strings.TrimSpace(values.AgentRuntimeBaseURL) == "" ||
			strings.TrimSpace(values.AgentRuntimeSharedSecret) == "") {
		return fmt.Errorf(
			"EXECUTION_CONTROL_AGENT_RUNTIME_BASE_URL and EXECUTION_AGENT_RUNTIME_SHARED_SECRET are required when EXECUTION_CONTROL_RUNTIME_MODE=%s",
			runtimeMode,
		)
	}
	if runtimeMode != "local" &&
		roleRequiresProductCallback(runtimeRole) &&
		(strings.TrimSpace(values.ProductCallbackBaseURL) == "" ||
			strings.TrimSpace(values.AppAPIExecutionSharedSecret) == "") {
		return fmt.Errorf(
			"EXECUTION_CONTROL_PRODUCT_CALLBACK_BASE_URL and APP_API_EXECUTION_SHARED_SECRET are required for role %s",
			runtimeRole,
		)
	}
	if runtimeMode != "local" && roleRequiresProviderConfigReader(runtimeRole) &&
		(strings.TrimSpace(values.ProviderConfigReaderDatabaseURL) == "" ||
			strings.TrimSpace(values.ProviderConfigKeyringPath) == "") {
		return fmt.Errorf("EXECUTION_CONTROL_PROVIDER_CONFIG_READER_DATABASE_URL and EXECUTION_CONTROL_PROVIDER_CONFIG_KEYRING_PATH are required for role %s", runtimeRole)
	}
	if runtimeMode != "local" && roleRequiresProviderConfigAdmin(runtimeRole) &&
		(strings.TrimSpace(values.ProviderConfigAdminDatabaseURL) == "" ||
			strings.TrimSpace(values.ProviderConfigKeyringPath) == "") {
		return fmt.Errorf("EXECUTION_CONTROL_PROVIDER_CONFIG_ADMIN_DATABASE_URL and EXECUTION_CONTROL_PROVIDER_CONFIG_KEYRING_PATH are required for role %s", runtimeRole)
	}
	return nil
}

func roleRequiresProviderConfigReader(runtimeRole string) bool {
	switch normalizeRuntimeRole(runtimeRole) {
	case "", "execution-control", "activity-agent":
		return true
	default:
		return false
	}
}

func roleRequiresProviderConfigAdmin(runtimeRole string) bool {
	return normalizeRuntimeRole(runtimeRole) == "provider-config-admin"
}

func roleRequiresProductCallback(runtimeRole string) bool {
	switch normalizeRuntimeRole(runtimeRole) {
	case "", "execution-control", "activity-core":
		return true
	default:
		return false
	}
}

func roleRequiresOpsWebInternalToken(runtimeRole string) bool {
	switch normalizeRuntimeRole(runtimeRole) {
	case "", "execution-control", "provider-config-admin":
		return true
	default:
		return false
	}
}

func roleRequiresRunProjectionDatabaseURL(runtimeRole string) bool {
	switch normalizeRuntimeRole(runtimeRole) {
	case "workflow", "personal-memory-runtime", "provider-config-admin":
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

func validateTemporalSettings(values envValues, runtimeMode string, runtimeRole string) error {
	if normalizeRuntimeRole(runtimeRole) == "provider-config-admin" {
		return nil
	}
	if runtimeMode == "local" &&
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
	runtimeMode string,
	runtimeRole string,
) error {
	role := normalizeRuntimeRole(runtimeRole)
	if runtimeMode == "local" {
		return nil
	}
	switch role {
	case "workflow",
		"activity-agent",
		"provider-config-admin":
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
	if role == "activity-core" {
		maintenanceRequired := []struct {
			name  string
			value string
		}{
			{"LANGFUSE_MAINTENANCE_BASE_URL", values.LangfuseMaintenanceBaseURL},
			{"LANGFUSE_MAINTENANCE_PUBLIC_KEY", values.LangfuseMaintenancePublicKey},
			{"LANGFUSE_MAINTENANCE_SECRET_KEY", values.LangfuseMaintenanceSecretKey},
		}
		for _, item := range maintenanceRequired {
			if strings.TrimSpace(item.value) == "" {
				return fmt.Errorf("%s is required for deployed Langfuse trace maintenance", item.name)
			}
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
	case "workflow":
		return "workflow"
	case "execution-control":
		return "execution-control"
	case "personal-memory-runtime":
		return "personal-memory-runtime"
	case "provider-config-admin":
		return "provider-config-admin"
	default:
		return strings.TrimSpace(value)
	}
}
