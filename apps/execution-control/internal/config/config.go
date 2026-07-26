package config

import (
	"fmt"
	"net/url"
	"os"
	"strings"

	env "github.com/caarlos0/env/v11"
)

const (
	MaxKnowledgeSearches = 3

	defaultAgentRuntimeDeadlineMS      = 90_000
	defaultAgentRuntimeInputCharLimit  = 8_000
	defaultAgentRuntimeMaxOutputTokens = 2_048
	defaultAgentRuntimeMaxTurns        = 6
	defaultMaxConcurrentAnswers        = 8
	defaultMemoryContextCharBudget     = 2_500
	defaultMemoryRecallLimit           = 8
	defaultMemoryRecallMaxTokens       = 2_500
	defaultMemoryTimeoutSeconds        = 90
	defaultQueueCapacity               = 24
	defaultQueueTimeoutMS              = 3_000
	defaultRAGEmbeddingTimeoutMS       = 10_000
	defaultRAGQdrantTimeoutMS          = 60_000
	defaultRAGTopKMax                  = 8
	defaultRequestBodyLimitBytes       = 1_048_576
	defaultRequestTimeoutMS            = 95_000
	defaultShutdownGraceMS             = 95_000
	defaultToolReadModelTimeoutMS      = 1_000
	packagedQueryServingTargetsPath    = "/etc/campus-agent/query-serving-targets.v1.json"
)

type Config struct {
	AppName                         string
	DeploymentEnvironment           string
	DeploymentRelease               string
	Host                            string
	Port                            int
	AppAPIExecutionSharedSecret     string
	MaxConcurrentAnswers            int
	QueueCapacity                   int
	QueueTimeoutMS                  int
	RequestTimeoutMS                int
	RequestBodyLimitBytes           int64
	ShutdownGraceMS                 int
	OpsWebInternalToken             string
	OTelEnabled                     bool
	OTelEndpoint                    string
	OTelMetricsEnabled              bool
	OTelMetricsEndpoint             string
	OTelServiceName                 string
	OTelExportTimeoutMS             int
	OTelExportIntervalMS            int
	OTelSampleRatio                 float64
	OTelAllowedAttributesVersion    string
	TemporalTracingEnabled          bool
	RunProjectionDatabaseURL        string
	TemporalAddress                 string
	TemporalNamespace               string
	TemporalTaskQueue               string
	TemporalWorkerIdentity          string
	TemporalStartTimeoutMS          int
	AgentRuntimeBaseURL             string
	AgentRuntimeSharedSecret        string
	AgentRuntimeDeadlineMS          int
	AgentRuntimeMaxOutputTokens     int
	AgentRuntimeMaxTurns            int
	AgentRuntimeSearchLimit         int
	AgentRuntimeInputCharLimit      int
	AgentRuntimeContextCharLimit    int
	ProductCallbackBaseURL          string
	ProductCallbackTimeoutMS        int
	ProviderConfigReaderDatabaseURL string
	ProviderConfigAdminDatabaseURL  string
	ProviderConfigKeyringPath       string
	QueryServingTargetsPath         string
	ToolReadModelTimeoutMS          int
	StructuredProjectionDatabaseURL string
	QdrantURL                       string
	QdrantQueryAPIKey               string
	QdrantTLSCACertPath             string
	RAGTopKMax                      int
	RAGEmbeddingTimeoutMS           int
	RAGQdrantTimeoutMS              int
	WorkerProfiles                  map[string]WorkerProfile
	PersonalMemoryRuntime           string
	PersonalMemoryBaseURL           string
	PersonalMemoryAPISecret         string
	PersonalMemoryOwnerSalt         string
	PersonalMemoryTimeoutSeconds    float64
	PersonalMemoryRecallLimit       int
	PersonalMemoryRecallMaxTokens   int
	PersonalMemoryContextCharBudget int
	LangfuseMaintenanceBaseURL      string
	LangfuseMaintenancePublicKey    string
	LangfuseMaintenanceSecretKey    string
}

type WorkerProfile struct {
	ActivitySlots                int
	ActivityTaskPollers          int
	TaskQueueActivitiesPerSecond float64
	WorkerActivitiesPerSecond    float64
	WorkflowTaskSlots            int
	WorkflowTaskPollers          int
}

type runtimeRole string

const (
	roleGateway               runtimeRole = "gateway"
	roleWorkflowWorker        runtimeRole = "workflow"
	roleCoreActivityWorker    runtimeRole = "activity-core"
	roleAgentActivityWorker   runtimeRole = "activity-agent"
	roleProviderConfigAdmin   runtimeRole = "provider-config-admin"
	rolePersonalMemoryCommand runtimeRole = "personal-memory-command"
)

type envValues struct {
	DeploymentEnvironment           string `env:"DEPLOYMENT_ENVIRONMENT" envDefault:"local"`
	DeploymentRelease               string `env:"DEPLOYMENT_RELEASE"`
	Host                            string `env:"CAMPUS_AGENT_HTTP_HOST" envDefault:"127.0.0.1"`
	Port                            int    `env:"CAMPUS_AGENT_HTTP_PORT" envDefault:"8000"`
	AppAPIExecutionSharedSecret     string `env:"APP_API_EXECUTION_SHARED_SECRET"`
	OpsWebInternalToken             string `env:"OPS_WEB_INTERNAL_TOKEN"`
	RunProjectionDatabaseURL        string `env:"EXECUTION_CONTROL_RUN_PROJECTION_DATABASE_URL"`
	TemporalAddress                 string `env:"EXECUTION_CONTROL_TEMPORAL_ADDRESS"`
	TemporalNamespace               string `env:"EXECUTION_CONTROL_TEMPORAL_NAMESPACE"`
	TemporalWorkerIdentity          string `env:"EXECUTION_CONTROL_TEMPORAL_WORKER_IDENTITY"`
	AgentRuntimeBaseURL             string `env:"EXECUTION_CONTROL_AGENT_RUNTIME_BASE_URL"`
	AgentRuntimeSharedSecret        string `env:"EXECUTION_AGENT_RUNTIME_SHARED_SECRET"`
	ProductCallbackBaseURL          string `env:"EXECUTION_CONTROL_PRODUCT_CALLBACK_BASE_URL"`
	ProviderConfigReaderDatabaseURL string `env:"EXECUTION_CONTROL_PROVIDER_CONFIG_READER_DATABASE_URL"`
	ProviderConfigAdminDatabaseURL  string `env:"EXECUTION_CONTROL_PROVIDER_CONFIG_ADMIN_DATABASE_URL"`
	ProviderConfigKeyringPath       string `env:"EXECUTION_CONTROL_PROVIDER_CONFIG_KEYRING_PATH"`
	ToolReadDatabaseURL             string `env:"EXECUTION_CONTROL_TOOL_READ_DATABASE_URL"`
	QdrantURL                       string `env:"QDRANT_URL"`
	QdrantQueryAPIKey               string `env:"QDRANT_QUERY_API_KEY"`
	QdrantTLSCACertPath             string `env:"QDRANT_TLS_CA_CERT_PATH"`
	PersonalMemoryBaseURL           string `env:"PERSONAL_MEMORY_BASE_URL"`
	PersonalMemoryAPISecret         string `env:"PERSONAL_MEMORY_API_SECRET"`
	PersonalMemoryOwnerSalt         string `env:"PERSONAL_MEMORY_OWNER_SALT"`
	LangfuseMaintenanceBaseURL      string `env:"LANGFUSE_MAINTENANCE_BASE_URL"`
	LangfuseMaintenancePublicKey    string `env:"LANGFUSE_MAINTENANCE_PUBLIC_KEY"`
	LangfuseMaintenanceSecretKey    string `env:"LANGFUSE_MAINTENANCE_SECRET_KEY"`
}

func LoadGatewayFromEnv() (Config, error) {
	return loadFromEnv(roleGateway)
}

func LoadWorkflowWorkerFromEnv() (Config, error) {
	return loadFromEnv(roleWorkflowWorker)
}

func LoadCoreActivityWorkerFromEnv() (Config, error) {
	return loadFromEnv(roleCoreActivityWorker)
}

func LoadAgentActivityWorkerFromEnv() (Config, error) {
	return loadFromEnv(roleAgentActivityWorker)
}

func LoadProviderConfigAdminFromEnv() (Config, error) {
	return loadFromEnv(roleProviderConfigAdmin)
}

func LoadPersonalMemoryCommandFromEnv() (Config, error) {
	return loadFromEnv(rolePersonalMemoryCommand)
}

func loadFromEnv(role runtimeRole) (Config, error) {
	values := envValues{}
	if err := env.Parse(&values); err != nil {
		return Config{}, fmt.Errorf("parse execution-control env: %w", err)
	}
	environment, err := normalizeDeploymentEnvironment(values.DeploymentEnvironment)
	if err != nil {
		return Config{}, err
	}
	if values.Port <= 0 || values.Port > 65_535 {
		return Config{}, fmt.Errorf("CAMPUS_AGENT_HTTP_PORT must be a valid TCP port")
	}
	if isDeployedEnvironment(environment) {
		if err := validateDeployedRole(values, role); err != nil {
			return Config{}, err
		}
	}
	commonOTLPEndpoint := os.Getenv("OTEL_EXPORTER_OTLP_ENDPOINT")
	traceEndpoint := otlpSignalEndpoint(
		os.Getenv("OTEL_EXPORTER_OTLP_TRACES_ENDPOINT"),
		commonOTLPEndpoint,
		"/v1/traces",
	)
	metricsEndpoint := otlpSignalEndpoint(
		os.Getenv("OTEL_EXPORTER_OTLP_METRICS_ENDPOINT"),
		commonOTLPEndpoint,
		"/v1/metrics",
	)
	telemetryDisabled := strings.EqualFold(strings.TrimSpace(os.Getenv("OTEL_SDK_DISABLED")), "true")
	tracesEnabled := !telemetryDisabled && traceEndpoint != "" && !exporterDisabled("OTEL_TRACES_EXPORTER")
	metricsEnabled := !telemetryDisabled && metricsEndpoint != "" && !exporterDisabled("OTEL_METRICS_EXPORTER")

	return Config{
		AppName:                         "campus-agent",
		DeploymentEnvironment:           environment,
		DeploymentRelease:               strings.TrimSpace(values.DeploymentRelease),
		Host:                            strings.TrimSpace(values.Host),
		Port:                            values.Port,
		AppAPIExecutionSharedSecret:     strings.TrimSpace(values.AppAPIExecutionSharedSecret),
		MaxConcurrentAnswers:            defaultMaxConcurrentAnswers,
		QueueCapacity:                   defaultQueueCapacity,
		QueueTimeoutMS:                  defaultQueueTimeoutMS,
		RequestTimeoutMS:                defaultRequestTimeoutMS,
		RequestBodyLimitBytes:           defaultRequestBodyLimitBytes,
		ShutdownGraceMS:                 defaultShutdownGraceMS,
		OpsWebInternalToken:             strings.TrimSpace(values.OpsWebInternalToken),
		OTelEnabled:                     tracesEnabled,
		OTelEndpoint:                    traceEndpoint,
		OTelMetricsEnabled:              metricsEnabled,
		OTelMetricsEndpoint:             metricsEndpoint,
		OTelServiceName:                 defaultString(strings.TrimSpace(os.Getenv("OTEL_SERVICE_NAME")), "campus-execution-control"),
		OTelExportTimeoutMS:             1_000,
		OTelExportIntervalMS:            15_000,
		OTelSampleRatio:                 1,
		OTelAllowedAttributesVersion:    "execution-control-otel-attrs-v1",
		TemporalTracingEnabled:          tracesEnabled,
		RunProjectionDatabaseURL:        normalizePostgresDatabaseURL(values.RunProjectionDatabaseURL),
		TemporalAddress:                 strings.TrimSpace(values.TemporalAddress),
		TemporalNamespace:               strings.TrimSpace(values.TemporalNamespace),
		TemporalTaskQueue:               "campus-agent.workflow",
		TemporalWorkerIdentity:          strings.TrimSpace(values.TemporalWorkerIdentity),
		TemporalStartTimeoutMS:          5_000,
		AgentRuntimeBaseURL:             strings.TrimRight(strings.TrimSpace(values.AgentRuntimeBaseURL), "/"),
		AgentRuntimeSharedSecret:        strings.TrimSpace(values.AgentRuntimeSharedSecret),
		AgentRuntimeDeadlineMS:          defaultAgentRuntimeDeadlineMS,
		AgentRuntimeMaxOutputTokens:     defaultAgentRuntimeMaxOutputTokens,
		AgentRuntimeMaxTurns:            defaultAgentRuntimeMaxTurns,
		AgentRuntimeSearchLimit:         MaxKnowledgeSearches,
		AgentRuntimeInputCharLimit:      defaultAgentRuntimeInputCharLimit,
		AgentRuntimeContextCharLimit:    16_000,
		ProductCallbackBaseURL:          strings.TrimRight(strings.TrimSpace(values.ProductCallbackBaseURL), "/"),
		ProductCallbackTimeoutMS:        1_000,
		ProviderConfigReaderDatabaseURL: strings.TrimSpace(values.ProviderConfigReaderDatabaseURL),
		ProviderConfigAdminDatabaseURL:  strings.TrimSpace(values.ProviderConfigAdminDatabaseURL),
		ProviderConfigKeyringPath:       strings.TrimSpace(values.ProviderConfigKeyringPath),
		QueryServingTargetsPath:         packagedQueryServingTargetsPath,
		ToolReadModelTimeoutMS:          defaultToolReadModelTimeoutMS,
		StructuredProjectionDatabaseURL: normalizePostgresDatabaseURL(values.ToolReadDatabaseURL),
		QdrantURL:                       strings.TrimRight(strings.TrimSpace(values.QdrantURL), "/"),
		QdrantQueryAPIKey:               strings.TrimSpace(values.QdrantQueryAPIKey),
		QdrantTLSCACertPath:             strings.TrimSpace(values.QdrantTLSCACertPath),
		RAGTopKMax:                      defaultRAGTopKMax,
		RAGEmbeddingTimeoutMS:           defaultRAGEmbeddingTimeoutMS,
		RAGQdrantTimeoutMS:              defaultRAGQdrantTimeoutMS,
		WorkerProfiles:                  defaultWorkerProfiles(),
		PersonalMemoryRuntime:           "hindsight",
		PersonalMemoryBaseURL:           strings.TrimRight(strings.TrimSpace(values.PersonalMemoryBaseURL), "/"),
		PersonalMemoryAPISecret:         strings.TrimSpace(values.PersonalMemoryAPISecret),
		PersonalMemoryOwnerSalt:         strings.TrimSpace(values.PersonalMemoryOwnerSalt),
		PersonalMemoryTimeoutSeconds:    defaultMemoryTimeoutSeconds,
		PersonalMemoryRecallLimit:       defaultMemoryRecallLimit,
		PersonalMemoryRecallMaxTokens:   defaultMemoryRecallMaxTokens,
		PersonalMemoryContextCharBudget: defaultMemoryContextCharBudget,
		LangfuseMaintenanceBaseURL:      strings.TrimRight(strings.TrimSpace(values.LangfuseMaintenanceBaseURL), "/"),
		LangfuseMaintenancePublicKey:    strings.TrimSpace(values.LangfuseMaintenancePublicKey),
		LangfuseMaintenanceSecretKey:    strings.TrimSpace(values.LangfuseMaintenanceSecretKey),
	}, nil
}

func validateDeployedRole(values envValues, role runtimeRole) error {
	required := []struct {
		name  string
		value string
	}{}
	if roleNeedsTemporal(role) {
		required = append(required,
			struct{ name, value string }{"EXECUTION_CONTROL_TEMPORAL_ADDRESS", values.TemporalAddress},
			struct{ name, value string }{"EXECUTION_CONTROL_TEMPORAL_NAMESPACE", values.TemporalNamespace},
			struct{ name, value string }{"EXECUTION_CONTROL_TEMPORAL_WORKER_IDENTITY", values.TemporalWorkerIdentity},
		)
	}
	switch role {
	case roleGateway:
		required = append(required,
			struct{ name, value string }{"EXECUTION_CONTROL_RUN_PROJECTION_DATABASE_URL", values.RunProjectionDatabaseURL},
			struct{ name, value string }{"APP_API_EXECUTION_SHARED_SECRET", values.AppAPIExecutionSharedSecret},
			struct{ name, value string }{"EXECUTION_CONTROL_AGENT_RUNTIME_BASE_URL", values.AgentRuntimeBaseURL},
			struct{ name, value string }{"EXECUTION_CONTROL_TOOL_READ_DATABASE_URL", values.ToolReadDatabaseURL},
		)
	case roleCoreActivityWorker:
		required = append(required,
			struct{ name, value string }{"EXECUTION_CONTROL_RUN_PROJECTION_DATABASE_URL", values.RunProjectionDatabaseURL},
			struct{ name, value string }{"EXECUTION_CONTROL_PRODUCT_CALLBACK_BASE_URL", values.ProductCallbackBaseURL},
			struct{ name, value string }{"APP_API_EXECUTION_SHARED_SECRET", values.AppAPIExecutionSharedSecret},
		)
	case roleAgentActivityWorker:
		required = append(required,
			struct{ name, value string }{"EXECUTION_CONTROL_RUN_PROJECTION_DATABASE_URL", values.RunProjectionDatabaseURL},
			struct{ name, value string }{"EXECUTION_CONTROL_AGENT_RUNTIME_BASE_URL", values.AgentRuntimeBaseURL},
			struct{ name, value string }{"EXECUTION_AGENT_RUNTIME_SHARED_SECRET", values.AgentRuntimeSharedSecret},
			struct{ name, value string }{"EXECUTION_CONTROL_PROVIDER_CONFIG_READER_DATABASE_URL", values.ProviderConfigReaderDatabaseURL},
			struct{ name, value string }{"EXECUTION_CONTROL_PROVIDER_CONFIG_KEYRING_PATH", values.ProviderConfigKeyringPath},
		)
	case roleProviderConfigAdmin:
		required = append(required,
			struct{ name, value string }{"EXECUTION_CONTROL_PROVIDER_CONFIG_ADMIN_DATABASE_URL", values.ProviderConfigAdminDatabaseURL},
			struct{ name, value string }{"EXECUTION_CONTROL_PROVIDER_CONFIG_KEYRING_PATH", values.ProviderConfigKeyringPath},
			struct{ name, value string }{"OPS_WEB_INTERNAL_TOKEN", values.OpsWebInternalToken},
		)
	case rolePersonalMemoryCommand:
		required = append(required,
			struct{ name, value string }{"PERSONAL_MEMORY_BASE_URL", values.PersonalMemoryBaseURL},
			struct{ name, value string }{"PERSONAL_MEMORY_API_SECRET", values.PersonalMemoryAPISecret},
			struct{ name, value string }{"PERSONAL_MEMORY_OWNER_SALT", values.PersonalMemoryOwnerSalt},
		)
	}
	for _, item := range required {
		if strings.TrimSpace(item.value) == "" {
			return fmt.Errorf("%s is required for %s", item.name, role)
		}
	}
	return nil
}

func roleNeedsTemporal(role runtimeRole) bool {
	return role == roleGateway || role == roleWorkflowWorker || role == roleCoreActivityWorker || role == roleAgentActivityWorker
}

func exporterDisabled(name string) bool {
	return strings.EqualFold(strings.TrimSpace(os.Getenv(name)), "none")
}

func otlpSignalEndpoint(specificEndpoint string, commonEndpoint string, signalPath string) string {
	if endpoint := strings.TrimSpace(specificEndpoint); endpoint != "" {
		return endpoint
	}
	endpoint := strings.TrimSpace(commonEndpoint)
	if endpoint == "" {
		return ""
	}
	parsed, err := url.Parse(endpoint)
	if err != nil {
		return endpoint
	}
	parsed.Path = strings.TrimRight(parsed.Path, "/") + signalPath
	return parsed.String()
}
