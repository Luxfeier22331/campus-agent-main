package config

import (
	"fmt"
	"strings"
)

func normalizeDeploymentEnvironment(value string) (string, error) {
	environment := strings.ToLower(strings.TrimSpace(value))
	if environment == "" {
		environment = "local"
	}
	switch environment {
	case "local", "development", "test", "staging", "production":
		return environment, nil
	default:
		return "", fmt.Errorf("DEPLOYMENT_ENVIRONMENT contains unsupported value %q", value)
	}
}

func isDeployedEnvironment(environment string) bool {
	return environment == "staging" || environment == "production"
}

func defaultString(value string, defaultValue string) string {
	if value == "" {
		return defaultValue
	}
	return value
}

// normalizeAnswerTransport defaults to buffered unless explicitly set to stream.
// Any value other than "stream" resolves to buffered so a misconfigured
// deployment never re-enables the defective provider streaming path.
func normalizeAnswerTransport(value string) string {
	if strings.ToLower(strings.TrimSpace(value)) == AnswerTransportStream {
		return AnswerTransportStream
	}
	return AnswerTransportBuffered
}

func firstString(values ...string) string {
	for _, value := range values {
		if normalized := strings.TrimSpace(value); normalized != "" {
			return normalized
		}
	}
	return ""
}

func normalizePostgresDatabaseURL(databaseURL string) string {
	normalized := strings.TrimSpace(databaseURL)
	if strings.HasPrefix(normalized, "postgres://") {
		return "postgresql://" + strings.TrimPrefix(normalized, "postgres://")
	}
	return normalized
}
