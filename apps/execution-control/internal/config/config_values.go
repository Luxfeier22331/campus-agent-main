package config

import (
	"fmt"
	"os"
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

func firstString(values ...string) string {
	for _, value := range values {
		if normalized := strings.TrimSpace(value); normalized != "" {
			return normalized
		}
	}
	return ""
}

func readStructuredProjectionDatabaseURL() string {
	return normalizePostgresDatabaseURL(os.Getenv("CAMPUS_SHARED_POSTGRES_URL"))
}

func normalizePostgresDatabaseURL(databaseURL string) string {
	normalized := strings.TrimSpace(databaseURL)
	if strings.HasPrefix(normalized, "postgres://") {
		return "postgresql://" + strings.TrimPrefix(normalized, "postgres://")
	}
	return normalized
}
