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
	defaultMemoryContextCharBudget    = 2_500
	defaultMemoryRecallLimit          = 8
	defaultMemoryRecallMaxTokens      = 2_500
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
	AgentRuntimePercent                     int
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
	AgentRuntimeBaseURL                     string
	AgentRuntimeSharedSecret                string
	RetrievalBaseURL                        string
	RetrievalInternalToken                  string
	CampusSearchTimeoutMS                   int
	AgentRuntimeDeadlineMS                  int
	AgentRuntimeMaxOutputTokens             int
	AgentRuntimeInputCharLimit              int
	AgentRuntimeContextCharLimit            int
	AnswerTransport                         string
	ProductCallbackBaseURL                  string
	ProductCallbackTimeoutMS                int
	ModelConfigBaseURL                      string
	WorkerProfiles                          map[string]WorkerProfile
	MemoryServiceBaseURL                    string
	MemoryServiceSecret                     string
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
	AgentRuntimePercent         int    `env:"AGENT_RUNTIME_ROLLOUT_PERCENT" envDefault:"0"`
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
	AgentRuntimeBaseURL         string `env:"EXECUTION_CONTROL_AGENT_RUNTIME_BASE_URL"`
	AgentRuntimeSharedSecret    string `env:"EXECUTION_AGENT_RUNTIME_SHARED_SECRET"`
	RetrievalBaseURL            string `env:"RETRIEVAL_BASE_URL"`
	RetrievalInternalToken      string `env:"RETRIEVAL_INTERNAL_TOKEN"`
	ModelConfigBaseURL          string `env:"MODEL_CONFIG_URL"`
	AnswerTransport             string `env:"EXECUTION_CONTROL_ANSWER_TRANSPORT"`
	ProductCallbackBaseURL      string `env:"EXECUTION_CONTROL_PRODUCT_CALLBACK_BASE_URL"`
	MemoryServiceBaseURL        string `env:"MEMORY_SERVICE_BASE_URL"`
	MemoryServiceSecret         string `env:"MEMORY_INTERNAL_SHARED_SECRET"`
	PersonalMemoryBaseURL       string `env:"HINDSIGHT_API_BASE_URL"`
	PersonalMemoryAPISecret     string `env:"HINDSIGHT_API_TENANT_API_KEY"`
	PersonalMemoryOwnerSalt     string `env:"HINDSIGHT_OWNER_SALT"`
}

func LoadAPIFromEnv() (Config, error)    { return loadFromEnv(false) }
func LoadWorkerFromEnv() (Config, error) { return loadFromEnv(true) }

func loadFromEnv(workerRole bool) (Config, error) {
	values := envValues{}
	if err := env.Parse(&values); err != nil {
		return Config{}, fmt.Errorf("parse execution-control env: %w", err)
	}
	if values.AgentRuntimePercent < 0 || values.AgentRuntimePercent > 100 {
		return Config{}, fmt.Errorf("AGENT_RUNTIME_ROLLOUT_PERCENT must be 0..100")
	}
	environment, err := normalizeDeploymentEnvironment(values.DeploymentEnvironment)
	if err != nil {
		return Config{}, err
	}
	if isDeployedEnvironment(environment) {
		if err := validateDeployedRuntime(values, workerRole); err != nil {
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
	workerProfiles := map[string]WorkerProfile(nil)
	if workerRole {
		workerProfiles = defaultWorkerProfiles()
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
		AgentRuntimeBaseURL:                     strings.TrimRight(strings.TrimSpace(values.AgentRuntimeBaseURL), "/"),
		AgentRuntimeSharedSecret:                values.AgentRuntimeSharedSecret,
		RetrievalBaseURL:                        strings.TrimRight(strings.TrimSpace(values.RetrievalBaseURL), "/"),
		RetrievalInternalToken:                  strings.TrimSpace(values.RetrievalInternalToken),
		CampusSearchTimeoutMS:                   60_000,
		AgentRuntimeDeadlineMS:                  defaultAgentRuntimeDeadlineMS,
		// Zero means no application-imposed output-token limit. Provider defaults
		// remain authoritative until a model-specific limit is configured.
		AgentRuntimeMaxOutputTokens:     0,
		AgentRuntimeInputCharLimit:      defaultAgentRuntimeInputCharLimit,
		AgentRuntimeContextCharLimit:    16_000,
		AnswerTransport:                 normalizeAnswerTransport(values.AnswerTransport),
		ProductCallbackBaseURL:          strings.TrimRight(strings.TrimSpace(values.ProductCallbackBaseURL), "/"),
		ProductCallbackTimeoutMS:        defaultProductCallbackTimeoutMS,
		ModelConfigBaseURL:              strings.TrimRight(strings.TrimSpace(values.ModelConfigBaseURL), "/"),
		WorkerProfiles:                  workerProfiles,
		MemoryServiceBaseURL:            strings.TrimRight(strings.TrimSpace(values.MemoryServiceBaseURL), "/"),
		MemoryServiceSecret:             values.MemoryServiceSecret,
		AgentRuntimePercent:             values.AgentRuntimePercent,
		PersonalMemoryBaseURL:           strings.TrimRight(strings.TrimSpace(values.PersonalMemoryBaseURL), "/"),
		PersonalMemoryAPISecret:         strings.TrimSpace(values.PersonalMemoryAPISecret),
		PersonalMemoryOwnerSalt:         strings.TrimSpace(values.PersonalMemoryOwnerSalt),
		PersonalMemoryTimeoutSeconds:    defaultMemoryTimeoutSeconds,
		PersonalMemoryRecallLimit:       defaultMemoryRecallLimit,
		PersonalMemoryRecallMaxTokens:   defaultMemoryRecallMaxTokens,
		PersonalMemoryContextCharBudget: defaultMemoryContextCharBudget,
	}, nil
}

func validateDeployedRuntime(values envValues, workerRole bool) error {
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
	}
	if !workerRole {
		required = append(required, []struct {
			name  string
			value string
		}{
			{"EXECUTION_CONTROL_INGRESS_SHARED_SECRET", values.IngressSharedSecret},
			{"OPS_WEB_INTERNAL_TOKEN", values.OpsWebInternalToken},
			{"MODEL_CONFIG_URL", values.ModelConfigBaseURL},
			{"RETRIEVAL_BASE_URL", values.RetrievalBaseURL},
			{"RETRIEVAL_INTERNAL_TOKEN", values.RetrievalInternalToken},
		}...)
	}
	for _, item := range required {
		if strings.TrimSpace(item.value) == "" {
			return fmt.Errorf("%s is required for runtime", item.name)
		}
	}
	return nil
}
