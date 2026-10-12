package config

import (
	"fmt"
	"strings"

	env "github.com/caarlos0/env/v11"
)

const (
	defaultTemporalTaskQueue          = "campus-agent.agent.workflow.v1"
	defaultAgentRuntimeDeadlineMS     = 240_000
	defaultAgentRuntimeInputCharLimit = 8_000
	defaultMemoryTimeoutSeconds       = 90
	defaultProductCallbackTimeoutMS   = 5_000
	defaultRequestBodyLimitBytes      = 1_048_576
	defaultRequestTimeoutMS           = 95_000
	defaultShutdownGraceMS            = 95_000
	fixedHTTPHost                     = "0.0.0.0"
	fixedHTTPPort                     = 8000
	fixedTemporalWorkflowTimeoutSec   = 900
	maxGatewayPort                    = 65_533
	// AnswerTransportStream streams model answer deltas to the browser;
	// AnswerTransportBuffered buffers the full model answer and projects it once.
	// Buffered is the safe default while the provider gateway rejects streaming
	// requests that declare function tools. Re-evaluate streaming once the
	// gateway fixes streamGenerateContent with functionDeclarations.
	AnswerTransportStream   = "stream"
	AnswerTransportBuffered = "buffered"
)

type Config struct {
	AppName                                 string
	DeploymentEnvironment                   string
	DeploymentRelease                       string
	Host                                    string
	Port                                    int
	AppAPIExecutionSharedSecret             string
	IngressSharedSecret                     string
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
	AgentRuntimeSharedSecret                string
	AgentRuntimeDeadlineMS                  int
	AgentRuntimeMaxOutputTokens             int
	AgentRuntimeInputCharLimit              int
	AgentRuntimeContextCharLimit            int
	AnswerTransport                         string
	ProductCallbackBaseURL                  string
	ProductCallbackTimeoutMS                int
	ModelConfigBaseURL                      string
	MemoryServiceBaseURL                    string
	MemoryServiceSecret                     string

	PersonalMemoryTimeoutSeconds float64
}

type envValues struct {
	DeploymentEnvironment       string `env:"DEPLOYMENT_ENVIRONMENT" envDefault:"local"`
	DeploymentRelease           string `env:"DEPLOYMENT_RELEASE"`
	Host                        string `env:"HOST"`
	Port                        int    `env:"PORT"`
	IngressSharedSecret         string `env:"EXECUTION_CONTROL_INGRESS_SHARED_SECRET"`
	AppAPIExecutionSharedSecret string `env:"APP_API_EXECUTION_SHARED_SECRET"`
	OpsWebInternalToken         string `env:"OPS_WEB_INTERNAL_TOKEN"`
	DatabaseURL                 string `env:"EXECUTION_CONTROL_DATABASE_URL"`
	TemporalAddress             string `env:"EXECUTION_CONTROL_TEMPORAL_ADDRESS"`
	TemporalNamespace           string `env:"EXECUTION_CONTROL_TEMPORAL_NAMESPACE"`
	TemporalWorkerIdentity      string `env:"EXECUTION_CONTROL_TEMPORAL_WORKER_IDENTITY"`
	AgentRuntimeSharedSecret    string `env:"AGENT_CONTROL_RUNTIME_SHARED_SECRET"`
	ModelConfigBaseURL          string `env:"MODEL_CONFIG_URL"`
	AnswerTransport             string `env:"EXECUTION_CONTROL_ANSWER_TRANSPORT"`
	ProductCallbackBaseURL      string `env:"EXECUTION_CONTROL_PRODUCT_CALLBACK_BASE_URL"`
	MemoryServiceBaseURL        string `env:"MEMORY_SERVICE_BASE_URL"`
	MemoryServiceSecret         string `env:"MEMORY_INTERNAL_SHARED_SECRET"`
}

func LoadAPIFromEnv() (Config, error) { return loadFromEnv() }

func loadFromEnv() (Config, error) {
	values := envValues{}
	if err := env.Parse(&values); err != nil {
		return Config{}, fmt.Errorf("parse agent-control env: %w", err)
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
		return Config{}, fmt.Errorf("AGENT_CONTROL_RUNTIME_SHARED_SECRET must not contain surrounding whitespace")
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
		IngressSharedSecret:                     strings.TrimSpace(values.IngressSharedSecret),
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
		AgentRuntimeSharedSecret:                values.AgentRuntimeSharedSecret,
		AgentRuntimeDeadlineMS:                  defaultAgentRuntimeDeadlineMS,
		// Zero means no application-imposed output-token limit. Provider defaults
		// remain authoritative until a model-specific limit is configured.
		AgentRuntimeMaxOutputTokens:  0,
		AgentRuntimeInputCharLimit:   defaultAgentRuntimeInputCharLimit,
		AgentRuntimeContextCharLimit: 16_000,
		AnswerTransport:              normalizeAnswerTransport(values.AnswerTransport),
		ProductCallbackBaseURL:       strings.TrimRight(strings.TrimSpace(values.ProductCallbackBaseURL), "/"),
		ProductCallbackTimeoutMS:     defaultProductCallbackTimeoutMS,
		ModelConfigBaseURL:           strings.TrimRight(strings.TrimSpace(values.ModelConfigBaseURL), "/"),
		MemoryServiceBaseURL:         strings.TrimRight(strings.TrimSpace(values.MemoryServiceBaseURL), "/"),
		MemoryServiceSecret:          values.MemoryServiceSecret,
		PersonalMemoryTimeoutSeconds: defaultMemoryTimeoutSeconds,
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
		{"AGENT_CONTROL_RUNTIME_SHARED_SECRET", values.AgentRuntimeSharedSecret},
	}
	{
		required = append(required, []struct {
			name  string
			value string
		}{
			{"EXECUTION_CONTROL_INGRESS_SHARED_SECRET", values.IngressSharedSecret},
			{"OPS_WEB_INTERNAL_TOKEN", values.OpsWebInternalToken},
			{"MODEL_CONFIG_URL", values.ModelConfigBaseURL},
		}...)
	}
	for _, item := range required {
		if strings.TrimSpace(item.value) == "" {
			return fmt.Errorf("%s is required for runtime", item.name)
		}
	}
	return nil
}
