package config

import (
	"fmt"
	"os"
	"strconv"
	"strings"
)

func normalizeRuntimeProfile(value string) (string, error) {
	profile := strings.ToLower(strings.TrimSpace(value))
	if profile == "" {
		profile = "local"
	}
	switch profile {
	case "local", "staging", "production":
		return profile, nil
	default:
		return "", fmt.Errorf("EXECUTION_CONTROL_RUNTIME_PROFILE contains unsupported profile %q", value)
	}
}

func defaultString(value string, defaultValue string) string {
	if value == "" {
		return defaultValue
	}
	return value
}

func readString(name string, defaultValue string) string {
	value := strings.TrimSpace(os.Getenv(name))
	if value == "" {
		return defaultValue
	}
	return value
}

func readFirstString(names ...string) string {
	for _, name := range names {
		value := strings.TrimSpace(os.Getenv(name))
		if value != "" {
			return value
		}
	}
	return ""
}

func readNoticeReadModelDatabaseURL() string {
	databaseURL := readFirstString(
		"INTERNAL_NOTICE_READ_MODEL_DATABASE_URL",
		"CAMPUS_SHARED_POSTGRES_URL",
	)
	return normalizePostgresDatabaseURL(databaseURL)
}

func readStructuredProjectionDatabaseURL() string {
	databaseURL := readFirstString("CAMPUS_SHARED_POSTGRES_URL")
	return normalizePostgresDatabaseURL(databaseURL)
}

func readWorkflowRunDatabaseURL(values envValues) string {
	databaseURL := strings.TrimSpace(values.WorkflowRunDatabaseURL)
	if databaseURL == "" {
		databaseURL = readFirstString("CAMPUS_SHARED_POSTGRES_URL")
	}
	return normalizePostgresDatabaseURL(databaseURL)
}

func readRunProjectionDatabaseURL(values envValues) string {
	return normalizePostgresDatabaseURL(strings.TrimSpace(values.RunProjectionDatabaseURL))
}

func normalizePostgresDatabaseURL(databaseURL string) string {
	if strings.HasPrefix(databaseURL, "postgres://") {
		return "postgresql://" + strings.TrimPrefix(databaseURL, "postgres://")
	}
	return databaseURL
}

func readPositiveIntStrict(name string, defaultValue int) (int, error) {
	value := strings.TrimSpace(os.Getenv(name))
	if value == "" {
		return defaultValue, nil
	}

	parsed, err := strconv.Atoi(value)
	if err != nil || parsed <= 0 {
		return 0, fmt.Errorf("%s must be a positive integer", name)
	}
	return parsed, nil
}

func readNonNegativeIntStrict(name string, defaultValue int) (int, error) {
	value := strings.TrimSpace(os.Getenv(name))
	if value == "" {
		return defaultValue, nil
	}

	parsed, err := strconv.Atoi(value)
	if err != nil || parsed < 0 {
		return 0, fmt.Errorf("%s must be a non-negative integer", name)
	}
	return parsed, nil
}

func readNonNegativeFloatStrict(name string, defaultValue float64) (float64, error) {
	value := strings.TrimSpace(os.Getenv(name))
	if value == "" {
		return defaultValue, nil
	}

	parsed, err := strconv.ParseFloat(value, 64)
	if err != nil || parsed < 0 {
		return 0, fmt.Errorf("%s must be a non-negative number", name)
	}
	return parsed, nil
}

func readBoolStrict(name string, defaultValue bool) (bool, error) {
	value := strings.ToLower(strings.TrimSpace(os.Getenv(name)))
	if value == "" {
		return defaultValue, nil
	}
	return parseBoolStrict(name, value)
}

func parseBoolStrict(name string, value string) (bool, error) {
	normalized := strings.ToLower(strings.TrimSpace(value))
	if normalized == "" {
		return false, fmt.Errorf("%s must be a boolean", name)
	}
	switch normalized {
	case "1", "true", "yes", "on":
		return true, nil
	case "0", "false", "no", "off":
		return false, nil
	default:
		return false, fmt.Errorf("%s must be a boolean", name)
	}
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

func validateOpenTools(values []string) ([]string, error) {
	for _, value := range values {
		switch strings.TrimSpace(value) {
		case "knowledge_query",
			"transport_schedule_lookup",
			"campus_notice_change_set_lookup",
			"campus_notice_discover",
			"campus_notice_period_summary":
		case "*", "all":
			return nil, fmt.Errorf("runtime profile open_tools does not support wildcard value %q", value)
		default:
			return nil, fmt.Errorf("runtime profile open_tools contains unsupported tool %q", value)
		}
	}
	return values, nil
}
