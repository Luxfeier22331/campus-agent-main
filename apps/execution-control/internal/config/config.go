package config

import (
	"fmt"
	"strings"

	env "github.com/caarlos0/env/v11"
)

const (
	defaultTemporalTaskQueue          = "campus-agent.workflow.v3"
	defaultAgentRuntimeDeadlineMS     = 240_000
	defaultAgentRuntimeInputCharLimit = 8_000
	defaultMaxConcurrentAnswers       = 8
	defaultMemoryContextCharBudget    = 2_500
	defaultMemoryRecallLimit          = 8
	defaultMemoryRecallMaxTokens      = 2_500
	defaultMemoryTimeoutSeconds       = 90
	defaultQueueCapacity              = 24
	defaultQueueTimeoutMS             = 3_000
	defaultProductCallbackTimeoutMS   = 5_000
	defaultRequestBodyLimitBytes      = 1_048_576
	defaultRequestTimeoutMS           = 95_000
	defaultShutdownGraceMS            = 95_000
	fixedHTTPHost                     = "0.0.0.0"
	fixedHTTPPort                     = 8000
	fixedTemporalWorkflowTimeoutSec   = 900
	maxGatewayPort                    = 65_533
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
	AgentRuntimeInputCharLimit              int
	AgentRuntimeContextCharLimit            int
	ProductCallbackBaseURL                  string
	ProductCallbackTimeoutMS                int
	ModelConfigBaseURL                      string
	QdrantURL                               string
	QdrantReadOnlyAPIKey                    string
	QdrantTLSCACertPath                     string
	WorkerProfiles                          map[string]WorkerProfile
	PersonalMemoryBaseURL                   string
	PersonalMemoryAPISecret                 string
	PersonalMemoryOwnerSalt                 string
	PersonalMemoryTimeoutSeconds            float64
	PersonalMemoryRecallLimit               int
	PersonalMemoryRecallMaxTokens           int
	PersonalMemoryContextCharBudget         int
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
	DeploymentEnvironment       string `env:"DEPLOYMENT_ENVIRONMENT" envDefault:"local"`
	DeploymentRelease           string `env:"DEPLOYMENT_RELEASE"`
	Host                        string `env:"HOST"`
	Port                        int    `env:"PORT"`
	AppAPIExecutionSharedSecret string `env:"APP_API_EXECUTION_SHARED_SECRET"`
	OpsWebInternalToken         string `env:"OPS_WEB_INTERNAL_TOKEN"`
	DatabaseURL                 string `env:"EXECUTION_CONTROL_DATABASE_URL"`
	TemporalAddress             string `env:"EXECUTION_CONTROL_TEMPORAL_ADDRESS"`
	TemporalNamespace           string `env:"EXECUTION_CONTROL_TEMPORAL_NAMESPACE"`
	TemporalWorkerIdentity      string `env:"EXECUTION_CONTROL_TEMPORAL_WORKER_IDENTITY"`
	AgentRuntimeBaseURL         string `env:"EXECUTION_CONTROL_AGENT_RUNTIME_BASE_URL"`
	AgentRuntimeSharedSecret    string `env:"EXECUTION_AGENT_RUNTIME_SHARED_SECRET"`
	ModelConfigBaseURL          string `env:"MODEL_CONFIG_URL"`
	ProductCallbackBaseURL      string `env:"EXECUTION_CONTROL_PRODUCT_CALLBACK_BASE_URL"`
	QdrantURL                   string `env:"QDRANT_URL"`
	QdrantReadOnlyAPIKey        string `env:"QDRANT_READ_ONLY_API_KEY"`
	QdrantTLSCACertPath         string `env:"QDRANT_TLS_CA_CERT_PATH"`
	PersonalMemoryBaseURL       string `env:"HINDSIGHT_API_BASE_URL"`
	PersonalMemoryAPISecret     string `env:"HINDSIGHT_API_TENANT_API_KEY"`
	PersonalMemoryOwnerSalt     string `env:"HINDSIGHT_OWNER_SALT"`
}

func LoadRuntimeFromEnv() (Config, error) {
	return loadFromEnv()
}

func loadFromEnv() (Config, error) {
	values := envValues{}
	if err := env.Parse(&values); err != nil {
		return Config{}, fmt.Errorf("parse execution-control env: %w", err)
	}
	environment, err := normalizeDeploymentEnvironment(values.DeploymentEnvironment)
	if err != nil {
		return Config{}, err
	}
	if isDeployedEnvironment(environment) {
		if err := validateDeployedRuntime(values); err != nil {
			return Config{}, err
		}
	}
	if values.AgentRuntimeSharedSecret != strings.TrimSpace(values.AgentRuntimeSharedSecret) {
		return Config{}, fmt.Errorf("EXECUTION_AGENT_RUNTIME_SHARED_SECRET must not contain surrounding whitespace")
	}
	host := defaultString(strings.TrimSpace(values.Host), fixedHTTPHost)
	port := values.Port
	if port == 0 {
		port = fixedHTTPPort
	}
	if port < 1 || port > maxGatewayPort {
		return Config{}, fmt.Errorf("PORT must be between 1 and %d", maxGatewayPort)
	}
	return Config{
		AppName:                                 "campus-agent",
		DeploymentEnvironment:                   environment,
		DeploymentRelease:                       strings.TrimSpace(values.DeploymentRelease),
		Host:                                    host,
		Port:                                    port,
		AppAPIExecutionSharedSecret:             strings.TrimSpace(values.AppAPIExecutionSharedSecret),
		MaxConcurrentAnswers:                    defaultMaxConcurrentAnswers,
		QueueCapacity:                           defaultQueueCapacity,
		QueueTimeoutMS:                          defaultQueueTimeoutMS,
		RequestTimeoutMS:                        defaultRequestTimeoutMS,
		RequestBodyLimitBytes:                   defaultRequestBodyLimitBytes,
		ShutdownGraceMS:                         defaultShutdownGraceMS,
		OpsWebInternalToken:                     strings.TrimSpace(values.OpsWebInternalToken),
		DatabaseURL:                             normalizePostgresDatabaseURL(values.DatabaseURL),
		TemporalAddress:                         strings.TrimSpace(values.TemporalAddress),
		TemporalNamespace:                       strings.TrimSpace(values.TemporalNamespace),
		TemporalTaskQueue:                       defaultTemporalTaskQueue,
		TemporalWorkerIdentity:                  strings.TrimSpace(values.TemporalWorkerIdentity),
		TemporalStartTimeoutMS:                  5_000,
		TemporalWorkflowExecutionTimeoutSeconds: fixedTemporalWorkflowTimeoutSec,
		AgentRuntimeBaseURL:                     strings.TrimRight(strings.TrimSpace(values.AgentRuntimeBaseURL), "/"),
		AgentRuntimeSharedSecret:                values.AgentRuntimeSharedSecret,
		AgentRuntimeDeadlineMS:                  defaultAgentRuntimeDeadlineMS,
		// Zero means no application-imposed output-token limit. Provider defaults
		// remain authoritative until a model-specific limit is configured.
		AgentRuntimeMaxOutputTokens:     0,
		AgentRuntimeInputCharLimit:      defaultAgentRuntimeInputCharLimit,
		AgentRuntimeContextCharLimit:    16_000,
		ProductCallbackBaseURL:          strings.TrimRight(strings.TrimSpace(values.ProductCallbackBaseURL), "/"),
		ProductCallbackTimeoutMS:        defaultProductCallbackTimeoutMS,
		ModelConfigBaseURL:              strings.TrimRight(strings.TrimSpace(values.ModelConfigBaseURL), "/"),
		QdrantURL:                       strings.TrimRight(strings.TrimSpace(values.QdrantURL), "/"),
		QdrantReadOnlyAPIKey:            strings.TrimSpace(values.QdrantReadOnlyAPIKey),
		QdrantTLSCACertPath:             strings.TrimSpace(values.QdrantTLSCACertPath),
		WorkerProfiles:                  defaultWorkerProfiles(),
		PersonalMemoryBaseURL:           strings.TrimRight(strings.TrimSpace(values.PersonalMemoryBaseURL), "/"),
		PersonalMemoryAPISecret:         strings.TrimSpace(values.PersonalMemoryAPISecret),
		PersonalMemoryOwnerSalt:         strings.TrimSpace(values.PersonalMemoryOwnerSalt),
		PersonalMemoryTimeoutSeconds:    defaultMemoryTimeoutSeconds,
		PersonalMemoryRecallLimit:       defaultMemoryRecallLimit,
		PersonalMemoryRecallMaxTokens:   defaultMemoryRecallMaxTokens,
		PersonalMemoryContextCharBudget: defaultMemoryContextCharBudget,
	}, nil
}

func validateDeployedRuntime(values envValues) error {
	required := []struct {
		name  string
		value string
	}{
		{
			"DEPLOYMENT_RELEASE",
			values.DeploymentRelease,
		},
		{"EXECUTION_CONTROL_TEMPORAL_ADDRESS", values.TemporalAddress},
		{"EXECUTION_CONTROL_TEMPORAL_NAMESPACE", values.TemporalNamespace},
		{"EXECUTION_CONTROL_TEMPORAL_WORKER_IDENTITY", values.TemporalWorkerIdentity},
		{"EXECUTION_CONTROL_DATABASE_URL", values.DatabaseURL},
		{"APP_API_EXECUTION_SHARED_SECRET", values.AppAPIExecutionSharedSecret},
		{"EXECUTION_CONTROL_PRODUCT_CALLBACK_BASE_URL", values.ProductCallbackBaseURL},
		{"EXECUTION_CONTROL_AGENT_RUNTIME_BASE_URL", values.AgentRuntimeBaseURL},
		{"EXECUTION_AGENT_RUNTIME_SHARED_SECRET", values.AgentRuntimeSharedSecret},
		{"OPS_WEB_INTERNAL_TOKEN", values.OpsWebInternalToken},
		{"MODEL_CONFIG_URL", values.ModelConfigBaseURL},
		{"QDRANT_URL", values.QdrantURL},
		{"QDRANT_READ_ONLY_API_KEY", values.QdrantReadOnlyAPIKey},
		{"QDRANT_TLS_CA_CERT_PATH", values.QdrantTLSCACertPath},
	}
	for _, item := range required {
		if strings.TrimSpace(item.value) == "" {
			return fmt.Errorf("%s is required for runtime", item.name)
		}
	}
	return nil
}
