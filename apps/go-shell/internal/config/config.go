package config

import (
	"fmt"
	"os"
	"strconv"
	"strings"
)

type Config struct {
	AppName               string
	Host                  string
	Port                  int
	AuthMode              string
	BearerToken           string
	WorkerSharedSecret    string
	DefaultActorID        string
	DefaultActorRoles     []string
	BridgeBaseURL         string
	BridgeSharedSecret    string
	MaxConcurrentAnswers  int
	QueueCapacity         int
	QueueTimeoutMS        int
	RequestTimeoutMS      int
	RequestBodyLimitBytes int64
	BridgeTimeoutMS       int
	ShutdownGraceMS       int
	MetricsBearerToken    string
}

func FromEnv() Config {
	cfg, err := LoadFromEnv()
	if err == nil {
		return cfg
	}

	return Config{
		AppName:               readString("CAMPUS_AGENT_APP_NAME", "campus-agent"),
		Host:                  readString("CAMPUS_AGENT_HTTP_HOST", "127.0.0.1"),
		Port:                  readPositiveInt("CAMPUS_AGENT_HTTP_PORT", 8000),
		AuthMode:              readString("API_AUTH_MODE", "bearer"),
		BearerToken:           strings.TrimSpace(os.Getenv("API_BEARER_TOKEN")),
		WorkerSharedSecret:    strings.TrimSpace(os.Getenv("API_WORKER_SHARED_SECRET")),
		DefaultActorID:        readString("API_DEFAULT_ACTOR_ID", ""),
		DefaultActorRoles:     readStringList("API_DEFAULT_ACTOR_ROLES"),
		BridgeBaseURL:         strings.TrimRight(readString("SUPERVISOR_PY_BRIDGE_BASE_URL", ""), "/"),
		BridgeSharedSecret:    strings.TrimSpace(os.Getenv("SUPERVISOR_PY_BRIDGE_SHARED_SECRET")),
		MaxConcurrentAnswers:  readPositiveInt("SUPERVISOR_API_MAX_CONCURRENT_ANSWERS", 8),
		QueueCapacity:         readPositiveIntAllowZero("SUPERVISOR_API_QUEUE_CAPACITY", 24),
		QueueTimeoutMS:        readPositiveInt("SUPERVISOR_API_QUEUE_TIMEOUT_MS", 3_000),
		RequestTimeoutMS:      readPositiveInt("SUPERVISOR_API_REQUEST_TIMEOUT_MS", 45_000),
		RequestBodyLimitBytes: int64(readPositiveInt("SUPERVISOR_API_REQUEST_BODY_LIMIT_BYTES", 1_048_576)),
		BridgeTimeoutMS:       readPositiveInt("SUPERVISOR_PY_BRIDGE_TIMEOUT_MS", 35_000),
		ShutdownGraceMS:       readPositiveInt("SUPERVISOR_API_SHUTDOWN_GRACE_MS", 45_000),
		MetricsBearerToken:    strings.TrimSpace(os.Getenv("SUPERVISOR_API_METRICS_BEARER_TOKEN")),
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
	bridgeTimeout, err := readPositiveIntStrict("SUPERVISOR_PY_BRIDGE_TIMEOUT_MS", 35_000)
	if err != nil {
		return Config{}, err
	}
	shutdownGrace, err := readPositiveIntStrict("SUPERVISOR_API_SHUTDOWN_GRACE_MS", 45_000)
	if err != nil {
		return Config{}, err
	}

	return Config{
		AppName:               readString("CAMPUS_AGENT_APP_NAME", "campus-agent"),
		Host:                  readString("CAMPUS_AGENT_HTTP_HOST", "127.0.0.1"),
		Port:                  port,
		AuthMode:              readString("API_AUTH_MODE", "bearer"),
		BearerToken:           strings.TrimSpace(os.Getenv("API_BEARER_TOKEN")),
		WorkerSharedSecret:    strings.TrimSpace(os.Getenv("API_WORKER_SHARED_SECRET")),
		DefaultActorID:        readString("API_DEFAULT_ACTOR_ID", ""),
		DefaultActorRoles:     readStringList("API_DEFAULT_ACTOR_ROLES"),
		BridgeBaseURL:         strings.TrimRight(readString("SUPERVISOR_PY_BRIDGE_BASE_URL", ""), "/"),
		BridgeSharedSecret:    strings.TrimSpace(os.Getenv("SUPERVISOR_PY_BRIDGE_SHARED_SECRET")),
		MaxConcurrentAnswers:  maxConcurrent,
		QueueCapacity:         queueCapacity,
		QueueTimeoutMS:        queueTimeout,
		RequestTimeoutMS:      requestTimeout,
		RequestBodyLimitBytes: int64(bodyLimit),
		BridgeTimeoutMS:       bridgeTimeout,
		ShutdownGraceMS:       shutdownGrace,
		MetricsBearerToken:    strings.TrimSpace(os.Getenv("SUPERVISOR_API_METRICS_BEARER_TOKEN")),
	}, nil
}

func readString(name string, fallback string) string {
	value := strings.TrimSpace(os.Getenv(name))
	if value == "" {
		return fallback
	}
	return value
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
