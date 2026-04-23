package config

import (
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
	RequestBodyLimitBytes int64
	BridgeTimeoutMS       int
}

func FromEnv() Config {
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
		RequestBodyLimitBytes: int64(readPositiveInt("SUPERVISOR_API_REQUEST_BODY_LIMIT_BYTES", 1_048_576)),
		BridgeTimeoutMS:       readPositiveInt("SUPERVISOR_PY_BRIDGE_TIMEOUT_MS", 35_000),
	}
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
