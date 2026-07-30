package config

import (
	"fmt"
	"net/url"
	"os"
	"strings"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/temporalruntime"
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
	fixedHTTPHost                      = "0.0.0.0"
	fixedHTTPPort                      = 8000
	fixedProviderConfigKeyringPath     = "/run/campus-agent/provider-config/keyring.json"
	fixedTemporalWorkflowTimeoutSec    = 900
	packagedQueryServingTargetsPath    = "/etc/campus-agent/query-serving-targets.v3.json"
)

type Config struct {
	AppName                                 string
	DeploymentEnvironment                   string
	DeploymentRelease                       string
	Host                                    string
	Port                                    int
	AppAPIExecutionSharedSecret             string
	MaxConcurrentAnswers                    int
	QueueCapacity                           int
	QueueTimeoutMS                          int
	RequestTimeoutMS                        int
	RequestBodyLimitBytes                   int64
	ShutdownGraceMS                         int
	OpsWebInternalToken                     string
	OTelEnabled                             bool
	OTelEndpoint                            string
	OTelMetricsEnabled                      bool
	OTelMetricsEndpoint                     string
	OTelServiceName                         string
	OTelExportTimeoutMS                     int
	OTelExportIntervalMS                    int
	OTelSampleRatio                         float64
	OTelAllowedAttributesVersion            string
	TemporalTracingEnabled                  bool
	DatabaseURL                             string
	TemporalAddress                         string
	TemporalNamespace                       string
	TemporalTaskQueue                       string
	TemporalWorkerIdentity                  string
	TemporalStartTimeoutMS                  int
	TemporalWorkflowExecutionTimeoutSeconds int
	AgentRuntimeBaseURL                     string
	AgentRuntimeSharedSecret                string
	AgentRuntimeDeadlineMS                  int
	AgentRuntimeMaxOutputTokens             int
	AgentRuntimeMaxTurns                    int
	AgentRuntimeSearchLimit                 int
	AgentRuntimeInputCharLimit              int
	AgentRuntimeContextCharLimit            int
	ProductCallbackBaseURL                  string
	ProductCallbackTimeoutMS                int
	ProviderConfigKeyringPath               string
	QueryServingTargetsPath                 string
	ToolReadModelTimeoutMS                  int
	QdrantURL                               string
	QdrantReadOnlyAPIKey                    string
	QdrantTLSCACertPath                     string
	RAGTopKMax                              int
	RAGEmbeddingTimeoutMS                   int
	RAGQdrantTimeoutMS                      int
	WorkerProfiles                          map[string]WorkerProfile
	PersonalMemoryRuntime                   string
	PersonalMemoryBaseURL                   string
	PersonalMemoryAPISecret                 string
	PersonalMemoryOwnerSalt                 string
	PersonalMemoryTimeoutSeconds            float64
	PersonalMemoryRecallLimit               int
	PersonalMemoryRecallMaxTokens           int
	PersonalMemoryContextCharBudget         int
	LangfuseBaseURL                         string
	LangfusePublicKey                       string
	LangfuseSecretKey                       string
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
	roleRuntime               runtimeRole = "runtime"
	rolePersonalMemoryCommand runtimeRole = "personal-memory-command"
)

type envValues struct {
	DeploymentEnvironment       string `env:"DEPLOYMENT_ENVIRONMENT" envDefault:"local"`
	DeploymentRelease           string `env:"DEPLOYMENT_RELEASE"`
	AppAPIExecutionSharedSecret string `env:"APP_API_EXECUTION_SHARED_SECRET"`
	OpsWebInternalToken         string `env:"OPS_WEB_INTERNAL_TOKEN"`
	DatabaseURL                 string `env:"EXECUTION_CONTROL_DATABASE_URL"`
	TemporalAddress             string `env:"EXECUTION_CONTROL_TEMPORAL_ADDRESS"`
	TemporalNamespace           string `env:"EXECUTION_CONTROL_TEMPORAL_NAMESPACE"`
	TemporalWorkerIdentity      string `env:"EXECUTION_CONTROL_TEMPORAL_WORKER_IDENTITY"`
	AgentRuntimeBaseURL         string `env:"EXECUTION_CONTROL_AGENT_RUNTIME_BASE_URL"`
	AgentRuntimeSharedSecret    string `env:"EXECUTION_AGENT_RUNTIME_SHARED_SECRET"`
	ProductCallbackBaseURL      string `env:"EXECUTION_CONTROL_PRODUCT_CALLBACK_BASE_URL"`
	QdrantURL                   string `env:"QDRANT_URL"`
	QdrantReadOnlyAPIKey        string `env:"QDRANT_READ_ONLY_API_KEY"`
	QdrantTLSCACertPath         string `env:"QDRANT_TLS_CA_CERT_PATH"`
	PersonalMemoryBaseURL       string `env:"HINDSIGHT_API_BASE_URL"`
	PersonalMemoryAPISecret     string `env:"HINDSIGHT_API_TENANT_API_KEY"`
	PersonalMemoryOwnerSalt     string `env:"HINDSIGHT_OWNER_SALT"`
	LangfuseBaseURL             string `env:"LANGFUSE_BASE_URL"`
	LangfusePublicKey           string `env:"LANGFUSE_PUBLIC_KEY"`
	LangfuseSecretKey           string `env:"LANGFUSE_SECRET_KEY"`
}

func LoadRuntimeFromEnv() (Config, error) {
	return loadFromEnv(roleRuntime)
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
		AppName:                                 "campus-agent",
		DeploymentEnvironment:                   environment,
		DeploymentRelease:                       strings.TrimSpace(values.DeploymentRelease),
		Host:                                    fixedHTTPHost,
		Port:                                    fixedHTTPPort,
		AppAPIExecutionSharedSecret:             strings.TrimSpace(values.AppAPIExecutionSharedSecret),
		MaxConcurrentAnswers:                    defaultMaxConcurrentAnswers,
		QueueCapacity:                           defaultQueueCapacity,
		QueueTimeoutMS:                          defaultQueueTimeoutMS,
		RequestTimeoutMS:                        defaultRequestTimeoutMS,
		RequestBodyLimitBytes:                   defaultRequestBodyLimitBytes,
		ShutdownGraceMS:                         defaultShutdownGraceMS,
		OpsWebInternalToken:                     strings.TrimSpace(values.OpsWebInternalToken),
		OTelEnabled:                             tracesEnabled,
		OTelEndpoint:                            traceEndpoint,
		OTelMetricsEnabled:                      metricsEnabled,
		OTelMetricsEndpoint:                     metricsEndpoint,
		OTelServiceName:                         defaultString(strings.TrimSpace(os.Getenv("OTEL_SERVICE_NAME")), "campus-execution-control"),
		OTelExportTimeoutMS:                     1_000,
		OTelExportIntervalMS:                    15_000,
		OTelSampleRatio:                         1,
		OTelAllowedAttributesVersion:            "execution-control-otel-attrs-v1",
		TemporalTracingEnabled:                  tracesEnabled,
		DatabaseURL:                             normalizePostgresDatabaseURL(values.DatabaseURL),
		TemporalAddress:                         strings.TrimSpace(values.TemporalAddress),
		TemporalNamespace:                       strings.TrimSpace(values.TemporalNamespace),
		TemporalTaskQueue:                       temporalruntime.WorkflowTaskQueue,
		TemporalWorkerIdentity:                  strings.TrimSpace(values.TemporalWorkerIdentity),
		TemporalStartTimeoutMS:                  5_000,
		TemporalWorkflowExecutionTimeoutSeconds: fixedTemporalWorkflowTimeoutSec,
		AgentRuntimeBaseURL:                     strings.TrimRight(strings.TrimSpace(values.AgentRuntimeBaseURL), "/"),
		AgentRuntimeSharedSecret:                strings.TrimSpace(values.AgentRuntimeSharedSecret),
		AgentRuntimeDeadlineMS:                  defaultAgentRuntimeDeadlineMS,
		AgentRuntimeMaxOutputTokens:             defaultAgentRuntimeMaxOutputTokens,
		AgentRuntimeMaxTurns:                    defaultAgentRuntimeMaxTurns,
		AgentRuntimeSearchLimit:                 MaxKnowledgeSearches,
		AgentRuntimeInputCharLimit:              defaultAgentRuntimeInputCharLimit,
		AgentRuntimeContextCharLimit:            16_000,
		ProductCallbackBaseURL:                  strings.TrimRight(strings.TrimSpace(values.ProductCallbackBaseURL), "/"),
		ProductCallbackTimeoutMS:                1_000,
		ProviderConfigKeyringPath:               fixedProviderConfigKeyringPath,
		QueryServingTargetsPath:                 packagedQueryServingTargetsPath,
		ToolReadModelTimeoutMS:                  defaultToolReadModelTimeoutMS,
		QdrantURL:                               strings.TrimRight(strings.TrimSpace(values.QdrantURL), "/"),
		QdrantReadOnlyAPIKey:                    strings.TrimSpace(values.QdrantReadOnlyAPIKey),
		QdrantTLSCACertPath:                     strings.TrimSpace(values.QdrantTLSCACertPath),
		RAGTopKMax:                              defaultRAGTopKMax,
		RAGEmbeddingTimeoutMS:                   defaultRAGEmbeddingTimeoutMS,
		RAGQdrantTimeoutMS:                      defaultRAGQdrantTimeoutMS,
		WorkerProfiles:                          defaultWorkerProfiles(),
		PersonalMemoryRuntime:                   "hindsight",
		PersonalMemoryBaseURL:                   strings.TrimRight(strings.TrimSpace(values.PersonalMemoryBaseURL), "/"),
		PersonalMemoryAPISecret:                 strings.TrimSpace(values.PersonalMemoryAPISecret),
		PersonalMemoryOwnerSalt:                 strings.TrimSpace(values.PersonalMemoryOwnerSalt),
		PersonalMemoryTimeoutSeconds:            defaultMemoryTimeoutSeconds,
		PersonalMemoryRecallLimit:               defaultMemoryRecallLimit,
		PersonalMemoryRecallMaxTokens:           defaultMemoryRecallMaxTokens,
		PersonalMemoryContextCharBudget:         defaultMemoryContextCharBudget,
		LangfuseBaseURL:                         strings.TrimRight(strings.TrimSpace(values.LangfuseBaseURL), "/"),
		LangfusePublicKey:                       strings.TrimSpace(values.LangfusePublicKey),
		LangfuseSecretKey:                       strings.TrimSpace(values.LangfuseSecretKey),
	}, nil
}

func validateDeployedRole(values envValues, role runtimeRole) error {
	required := []struct {
		name  string
		value string
	}{}
	if role == roleRuntime {
		required = append(required, struct{ name, value string }{
			"DEPLOYMENT_RELEASE",
			values.DeploymentRelease,
		})
	}
	if roleNeedsTemporal(role) {
		required = append(required,
			struct{ name, value string }{"EXECUTION_CONTROL_TEMPORAL_ADDRESS", values.TemporalAddress},
			struct{ name, value string }{"EXECUTION_CONTROL_TEMPORAL_NAMESPACE", values.TemporalNamespace},
			struct{ name, value string }{"EXECUTION_CONTROL_TEMPORAL_WORKER_IDENTITY", values.TemporalWorkerIdentity},
		)
	}
	switch role {
	case roleRuntime:
		required = append(required,
			struct{ name, value string }{"EXECUTION_CONTROL_DATABASE_URL", values.DatabaseURL},
			struct{ name, value string }{"APP_API_EXECUTION_SHARED_SECRET", values.AppAPIExecutionSharedSecret},
			struct{ name, value string }{"EXECUTION_CONTROL_PRODUCT_CALLBACK_BASE_URL", values.ProductCallbackBaseURL},
			struct{ name, value string }{"EXECUTION_CONTROL_AGENT_RUNTIME_BASE_URL", values.AgentRuntimeBaseURL},
			struct{ name, value string }{"EXECUTION_AGENT_RUNTIME_SHARED_SECRET", values.AgentRuntimeSharedSecret},
			struct{ name, value string }{"OPS_WEB_INTERNAL_TOKEN", values.OpsWebInternalToken},
		)
	case rolePersonalMemoryCommand:
		required = append(required,
			struct{ name, value string }{"HINDSIGHT_API_BASE_URL", values.PersonalMemoryBaseURL},
			struct{ name, value string }{"HINDSIGHT_API_TENANT_API_KEY", values.PersonalMemoryAPISecret},
			struct{ name, value string }{"HINDSIGHT_OWNER_SALT", values.PersonalMemoryOwnerSalt},
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
	return role == roleRuntime
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
