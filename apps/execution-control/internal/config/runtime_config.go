package config

import (
	"encoding/json"
	"fmt"
	"os"
	"strings"
)

const MaxKnowledgeSearches = 3

const runtimeConfigFileSchemaVersion = "campus_execution_control_runtime_config.v1"

type runtimeConfigFile struct {
	SchemaVersion           string                        `json:"schema_version"`
	MaxConcurrentAnswers    *int                          `json:"max_concurrent_answers,omitempty"`
	QueueCapacity           *int                          `json:"queue_capacity,omitempty"`
	QueueTimeoutMS          *int                          `json:"queue_timeout_ms,omitempty"`
	RequestTimeoutMS        *int                          `json:"request_timeout_ms,omitempty"`
	RequestBodyLimitBytes   *int64                        `json:"request_body_limit_bytes,omitempty"`
	ShutdownGraceMS         *int                          `json:"shutdown_grace_ms,omitempty"`
	QueryServingTargetsPath *string                       `json:"query_serving_targets_path,omitempty"`
	ToolReadModelTimeoutMS  *int                          `json:"tool_read_model_timeout_ms,omitempty"`
	AgentRuntime            *runtimeConfigAgentRuntime    `json:"agent_runtime,omitempty"`
	OTel                    *runtimeConfigFileOTel        `json:"otel,omitempty"`
	KnowledgeSearch         *runtimeConfigKnowledgeSearch `json:"knowledge_search,omitempty"`
	PersonalMemory          *runtimeConfigFileMemory      `json:"personal_memory,omitempty"`
	WorkerProfiles          map[string]runtimeModeWorker  `json:"worker_profiles,omitempty"`
}

type runtimeConfigAgentRuntime struct {
	DeadlineMS                 *int `json:"deadline_ms,omitempty"`
	MaxOutputTokens            *int `json:"max_output_tokens,omitempty"`
	MaxTurns                   *int `json:"max_turns,omitempty"`
	MaxKnowledgeSearches       *int `json:"max_knowledge_searches,omitempty"`
	CurrentInputCharLimit      *int `json:"current_input_char_limit,omitempty"`
	FinalModelContextCharLimit *int `json:"final_model_context_char_limit,omitempty"`
}

type runtimeConfigFileOTel struct {
	Enabled                  *bool    `json:"enabled,omitempty"`
	Endpoint                 *string  `json:"endpoint,omitempty"`
	MetricsEnabled           *bool    `json:"metrics_enabled,omitempty"`
	MetricsEndpoint          *string  `json:"metrics_endpoint,omitempty"`
	ServiceName              *string  `json:"service_name,omitempty"`
	ExportTimeoutMS          *int     `json:"export_timeout_ms,omitempty"`
	ExportIntervalMS         *int     `json:"export_interval_ms,omitempty"`
	SampleRatio              *float64 `json:"sample_ratio,omitempty"`
	AllowedAttributesVersion *string  `json:"allowed_attributes_version,omitempty"`
	TemporalTracingEnabled   *bool    `json:"temporal_tracing_enabled,omitempty"`
}

type runtimeConfigKnowledgeSearch struct {
	TopKMax            *int `json:"top_k_max,omitempty"`
	EmbeddingTimeoutMS *int `json:"embedding_timeout_ms,omitempty"`
	QdrantTimeoutMS    *int `json:"qdrant_timeout_ms,omitempty"`
}

type runtimeConfigFileMemory struct {
	Runtime           *string  `json:"runtime,omitempty"`
	TimeoutSeconds    *float64 `json:"timeout_seconds,omitempty"`
	RecallLimit       *int     `json:"recall_limit,omitempty"`
	RecallMaxTokens   *int     `json:"recall_max_tokens,omitempty"`
	ContextCharBudget *int     `json:"context_char_budget,omitempty"`
}

type runtimeModeWorker struct {
	ActivitySlots                *int     `json:"activity_slots,omitempty"`
	ActivityTaskPollers          *int     `json:"activity_task_pollers,omitempty"`
	TaskQueueActivitiesPerSecond *float64 `json:"task_queue_activities_per_second,omitempty"`
	WorkerActivitiesPerSecond    *float64 `json:"worker_activities_per_second,omitempty"`
	WorkflowTaskSlots            *int     `json:"workflow_task_slots,omitempty"`
	WorkflowTaskPollers          *int     `json:"workflow_task_pollers,omitempty"`
}

func loadRuntimeConfigFromEnv() (runtimeConfigFile, error) {
	path := strings.TrimSpace(os.Getenv("EXECUTION_CONTROL_RUNTIME_CONFIG_PATH"))
	if path == "" {
		return runtimeConfigFile{}, fmt.Errorf("EXECUTION_CONTROL_RUNTIME_CONFIG_PATH is required")
	}
	file, err := os.Open(path)
	if err != nil {
		return runtimeConfigFile{}, fmt.Errorf("open EXECUTION_CONTROL_RUNTIME_CONFIG_PATH: %w", err)
	}
	defer func() { _ = file.Close() }()
	decoder := json.NewDecoder(file)
	decoder.DisallowUnknownFields()
	profile := runtimeConfigFile{}
	if err := decoder.Decode(&profile); err != nil {
		return runtimeConfigFile{}, fmt.Errorf("decode execution-control runtime config: %w", err)
	}
	if strings.TrimSpace(profile.SchemaVersion) != runtimeConfigFileSchemaVersion {
		return runtimeConfigFile{}, fmt.Errorf(
			"execution-control runtime config schema_version must be %s",
			runtimeConfigFileSchemaVersion,
		)
	}
	if err := validateRuntimeConfigCompleteness(profile); err != nil {
		return runtimeConfigFile{}, err
	}
	return profile, nil
}

func validateRuntimeConfigCompleteness(profile runtimeConfigFile) error {
	requiredInts := []struct {
		name  string
		value *int
	}{
		{"max_concurrent_answers", profile.MaxConcurrentAnswers},
		{"queue_capacity", profile.QueueCapacity},
		{"queue_timeout_ms", profile.QueueTimeoutMS},
		{"request_timeout_ms", profile.RequestTimeoutMS},
		{"shutdown_grace_ms", profile.ShutdownGraceMS},
		{"tool_read_model_timeout_ms", profile.ToolReadModelTimeoutMS},
	}
	for _, item := range requiredInts {
		if item.value == nil {
			return fmt.Errorf("execution-control runtime config missing required field %s", item.name)
		}
	}
	if profile.RequestBodyLimitBytes == nil {
		return fmt.Errorf("execution-control runtime config missing required field request_body_limit_bytes")
	}
	requiredStrings := []struct {
		name  string
		value *string
	}{
		{"query_serving_targets_path", profile.QueryServingTargetsPath},
	}
	for _, item := range requiredStrings {
		if item.value == nil || strings.TrimSpace(*item.value) == "" {
			return fmt.Errorf("execution-control runtime config missing required field %s", item.name)
		}
	}
	if err := validateRuntimeConfigOTelCompleteness(profile.OTel); err != nil {
		return err
	}
	if err := validateRuntimeConfigAgentRuntimeCompleteness(profile.AgentRuntime); err != nil {
		return err
	}
	if err := validateRuntimeConfigKnowledgeSearchCompleteness(profile.KnowledgeSearch); err != nil {
		return err
	}
	if err := validateRuntimeConfigMemoryCompleteness(profile.PersonalMemory); err != nil {
		return err
	}
	return nil
}

func validateRuntimeConfigAgentRuntimeCompleteness(value *runtimeConfigAgentRuntime) error {
	if value == nil {
		return fmt.Errorf("execution-control runtime config missing required field agent_runtime")
	}
	required := []struct {
		name  string
		value *int
	}{
		{"deadline_ms", value.DeadlineMS},
		{"max_output_tokens", value.MaxOutputTokens},
		{"max_turns", value.MaxTurns},
		{"max_knowledge_searches", value.MaxKnowledgeSearches},
		{"current_input_char_limit", value.CurrentInputCharLimit},
		{"final_model_context_char_limit", value.FinalModelContextCharLimit},
	}
	for _, item := range required {
		if item.value == nil {
			return fmt.Errorf("execution-control runtime config missing required agent_runtime.%s", item.name)
		}
	}
	if *value.MaxKnowledgeSearches > MaxKnowledgeSearches {
		return fmt.Errorf(
			"execution-control runtime config agent_runtime.max_knowledge_searches must not exceed %d",
			MaxKnowledgeSearches,
		)
	}
	return nil
}

func validateRuntimeConfigOTelCompleteness(value *runtimeConfigFileOTel) error {
	if value == nil {
		return fmt.Errorf("execution-control runtime config missing required field otel")
	}
	requiredBools := []struct {
		name  string
		value *bool
	}{
		{"otel.enabled", value.Enabled},
		{"otel.metrics_enabled", value.MetricsEnabled},
		{"otel.temporal_tracing_enabled", value.TemporalTracingEnabled},
	}
	for _, item := range requiredBools {
		if item.value == nil {
			return fmt.Errorf("execution-control runtime config missing required field %s", item.name)
		}
	}
	requiredStrings := []struct {
		name  string
		value *string
	}{
		{"otel.endpoint", value.Endpoint},
		{"otel.metrics_endpoint", value.MetricsEndpoint},
		{"otel.service_name", value.ServiceName},
		{"otel.allowed_attributes_version", value.AllowedAttributesVersion},
	}
	for _, item := range requiredStrings {
		if item.value == nil || strings.TrimSpace(*item.value) == "" {
			return fmt.Errorf("execution-control runtime config missing required field %s", item.name)
		}
	}
	requiredInts := []struct {
		name  string
		value *int
	}{
		{"otel.export_timeout_ms", value.ExportTimeoutMS},
		{"otel.export_interval_ms", value.ExportIntervalMS},
	}
	for _, item := range requiredInts {
		if item.value == nil {
			return fmt.Errorf("execution-control runtime config missing required field %s", item.name)
		}
	}
	if value.SampleRatio == nil {
		return fmt.Errorf("execution-control runtime config missing required field otel.sample_ratio")
	}
	return nil
}

func validateRuntimeConfigKnowledgeSearchCompleteness(value *runtimeConfigKnowledgeSearch) error {
	if value == nil {
		return fmt.Errorf("execution-control runtime config missing required field knowledge_search")
	}
	required := []struct {
		name  string
		value *int
	}{
		{"top_k_max", value.TopKMax},
		{"embedding_timeout_ms", value.EmbeddingTimeoutMS},
		{"qdrant_timeout_ms", value.QdrantTimeoutMS},
	}
	for _, item := range required {
		if item.value == nil {
			return fmt.Errorf("execution-control runtime config missing required knowledge_search.%s", item.name)
		}
	}
	return nil
}

func validateRuntimeConfigMemoryCompleteness(value *runtimeConfigFileMemory) error {
	if value == nil {
		return fmt.Errorf("execution-control runtime config missing required field personal_memory")
	}
	if value.Runtime == nil || strings.TrimSpace(*value.Runtime) == "" {
		return fmt.Errorf("execution-control runtime config missing required personal_memory.runtime")
	}
	if strings.TrimSpace(*value.Runtime) != "hindsight" {
		return fmt.Errorf("execution-control runtime config personal_memory.runtime must be hindsight")
	}
	requiredInts := []struct {
		name  string
		value *int
	}{
		{"recall_limit", value.RecallLimit},
		{"recall_max_tokens", value.RecallMaxTokens},
		{"context_char_budget", value.ContextCharBudget},
	}
	for _, item := range requiredInts {
		if item.value == nil {
			return fmt.Errorf("execution-control runtime config missing required personal_memory.%s", item.name)
		}
	}
	if value.TimeoutSeconds == nil {
		return fmt.Errorf("execution-control runtime config missing required personal_memory.timeout_seconds")
	}
	return nil
}

func applyRuntimeConfigValues(values envValues, profile runtimeConfigFile) envValues {
	applyInt(&values.MaxConcurrentAnswers, profile.MaxConcurrentAnswers)
	applyInt(&values.QueueCapacity, profile.QueueCapacity)
	applyInt(&values.QueueTimeoutMS, profile.QueueTimeoutMS)
	applyInt(&values.RequestTimeoutMS, profile.RequestTimeoutMS)
	applyInt64(&values.RequestBodyLimitBytes, profile.RequestBodyLimitBytes)
	applyInt(&values.ShutdownGraceMS, profile.ShutdownGraceMS)
	applyString(&values.QueryServingTargetsPath, profile.QueryServingTargetsPath)
	applyInt(&values.ToolReadModelTimeoutMS, profile.ToolReadModelTimeoutMS)
	if profile.AgentRuntime != nil {
		applyInt(&values.AgentRuntimeDeadlineMS, profile.AgentRuntime.DeadlineMS)
		applyInt(&values.AgentRuntimeMaxOutputTokens, profile.AgentRuntime.MaxOutputTokens)
		applyInt(&values.AgentRuntimeMaxTurns, profile.AgentRuntime.MaxTurns)
		applyInt(&values.AgentRuntimeSearchLimit, profile.AgentRuntime.MaxKnowledgeSearches)
		applyInt(&values.AgentRuntimeInputCharLimit, profile.AgentRuntime.CurrentInputCharLimit)
		applyInt(&values.AgentRuntimeContextCharLimit, profile.AgentRuntime.FinalModelContextCharLimit)
	}
	if profile.OTel != nil {
		applyString(&values.OTelEndpoint, profile.OTel.Endpoint)
		applyString(&values.OTelMetricsEndpoint, profile.OTel.MetricsEndpoint)
		applyString(&values.OTelServiceName, profile.OTel.ServiceName)
		applyInt(&values.OTelExportTimeoutMS, profile.OTel.ExportTimeoutMS)
		applyInt(&values.OTelExportIntervalMS, profile.OTel.ExportIntervalMS)
		applyFloat64(&values.OTelSampleRatio, profile.OTel.SampleRatio)
		applyString(&values.OTelAllowedAttributesVersion, profile.OTel.AllowedAttributesVersion)
		values.TemporalTracingEnabled = boolFromRuntimeConfig(
			profile.OTel.TemporalTracingEnabled,
			values.TemporalTracingEnabled,
		)
	}
	if profile.KnowledgeSearch != nil {
		applyInt(&values.RAGTopKMax, profile.KnowledgeSearch.TopKMax)
		applyInt(&values.RAGEmbeddingTimeoutMS, profile.KnowledgeSearch.EmbeddingTimeoutMS)
		applyInt(&values.RAGQdrantTimeoutMS, profile.KnowledgeSearch.QdrantTimeoutMS)
	}
	if profile.PersonalMemory != nil {
		applyString(&values.PersonalMemoryRuntime, profile.PersonalMemory.Runtime)
		applyFloat64(&values.PersonalMemoryTimeoutSeconds, profile.PersonalMemory.TimeoutSeconds)
		applyInt(&values.PersonalMemoryRecallLimit, profile.PersonalMemory.RecallLimit)
		applyInt(&values.PersonalMemoryRecallMaxTokens, profile.PersonalMemory.RecallMaxTokens)
		applyInt(&values.PersonalMemoryContextCharBudget, profile.PersonalMemory.ContextCharBudget)
	}
	return values
}

func applyRuntimeConfigWorkerProfiles(
	profiles map[string]WorkerProfile,
	profile runtimeConfigFile,
) (map[string]WorkerProfile, error) {
	for role, override := range profile.WorkerProfiles {
		current, ok := profiles[role]
		if !ok {
			return nil, fmt.Errorf("runtime config worker_profiles contains unsupported role %q", role)
		}
		applyInt(&current.ActivitySlots, override.ActivitySlots)
		applyInt(&current.ActivityTaskPollers, override.ActivityTaskPollers)
		applyFloat64(&current.TaskQueueActivitiesPerSecond, override.TaskQueueActivitiesPerSecond)
		applyFloat64(&current.WorkerActivitiesPerSecond, override.WorkerActivitiesPerSecond)
		applyInt(&current.WorkflowTaskSlots, override.WorkflowTaskSlots)
		applyInt(&current.WorkflowTaskPollers, override.WorkflowTaskPollers)
		if current.ActivityTaskPollers > 0 && current.ActivitySlots <= 0 {
			return nil, fmt.Errorf("runtime config worker %s activity_slots must be positive when pollers are configured", role)
		}
		if current.WorkflowTaskPollers > 0 && current.WorkflowTaskSlots <= 0 {
			return nil, fmt.Errorf("runtime config worker %s workflow_task_slots must be positive when pollers are configured", role)
		}
		profiles[role] = current
	}
	return profiles, nil
}

func applyInt(target *int, value *int) {
	if value != nil {
		*target = *value
	}
}

func applyInt64(target *int64, value *int64) {
	if value != nil {
		*target = *value
	}
}

func applyFloat64(target *float64, value *float64) {
	if value != nil {
		*target = *value
	}
}

func applyString(target *string, value *string) {
	if value != nil {
		*target = strings.TrimSpace(*value)
	}
}

func boolFromRuntimeConfig(value *bool, defaultValue bool) bool {
	if value != nil {
		return *value
	}
	return defaultValue
}

func rejectRuntimeConfigOwnedEnvSettings() error {
	retired := []string{
		"EXECUTION_CONTROL_MAX_CONCURRENT_ANSWERS",
		"EXECUTION_CONTROL_QUEUE_CAPACITY",
		"EXECUTION_CONTROL_QUEUE_TIMEOUT_MS",
		"EXECUTION_CONTROL_REQUEST_TIMEOUT_MS",
		"EXECUTION_CONTROL_REQUEST_BODY_LIMIT_BYTES",
		"EXECUTION_CONTROL_SHUTDOWN_GRACE_MS",
		"EXECUTION_CONTROL_QUERY_SERVING_SCOPES_PATH",
		"EXECUTION_CONTROL_OPEN_TOOLS",
		"EXECUTION_CONTROL_MULTI_STEP_WORKFLOW_ENABLED",
		"EXECUTION_CONTROL_OTEL_ENABLED",
		"EXECUTION_CONTROL_OTEL_EXPORTER_OTLP_ENDPOINT",
		"EXECUTION_CONTROL_OTEL_METRICS_ENABLED",
		"EXECUTION_CONTROL_OTEL_EXPORTER_OTLP_METRICS_ENDPOINT",
		"EXECUTION_CONTROL_OTEL_SERVICE_NAME",
		"EXECUTION_CONTROL_OTEL_EXPORT_TIMEOUT_MS",
		"EXECUTION_CONTROL_OTEL_EXPORT_INTERVAL_MS",
		"EXECUTION_CONTROL_OTEL_SAMPLE_RATIO",
		"EXECUTION_CONTROL_OTEL_ALLOWED_ATTRIBUTES_VERSION",
		"PERSONAL_MEMORY_COLLECTION",
		"PERSONAL_MEMORY_TOP_K",
		"PERSONAL_MEMORY_MAX_CHARS",
		"PERSONAL_MEMORY_SCORE_THRESHOLD",
		"PERSONAL_MEMORY_RUNTIME",
		"PERSONAL_MEMORY_TIMEOUT_SECONDS",
		"PERSONAL_MEMORY_RECALL_LIMIT",
		"PERSONAL_MEMORY_RECALL_MAX_CHARS",
		"PERSONAL_MEMORY_RECALL_MAX_TOKENS",
		"PERSONAL_MEMORY_CONTEXT_CHAR_BUDGET",
	}
	for _, name := range retired {
		if strings.TrimSpace(os.Getenv(name)) != "" {
			return fmt.Errorf("%s is retired; use EXECUTION_CONTROL_RUNTIME_CONFIG_PATH", name)
		}
	}
	if err := rejectEnvPrefix("EXECUTION_CONTROL_LANE_"); err != nil {
		return err
	}
	for _, role := range []string{
		"WORKFLOW",
		"ACTIVITY_CONTEXT",
		"ACTIVITY_AGENT",
		"ACTIVITY_CAMPUS_SERVICES",
		"ACTIVITY_NOTICE",
		"ACTIVITY_NAVIGATION",
		"ACTIVITY_FINALIZATION",
	} {
		if err := rejectEnvPrefix("EXECUTION_CONTROL_WORKER_" + role + "_"); err != nil {
			return err
		}
	}
	return nil
}

func rejectEnvPrefix(prefix string) error {
	for _, item := range os.Environ() {
		key, _, _ := strings.Cut(item, "=")
		if strings.HasPrefix(key, prefix) && strings.TrimSpace(os.Getenv(key)) != "" {
			return fmt.Errorf("%s is retired; use EXECUTION_CONTROL_RUNTIME_CONFIG_PATH", key)
		}
	}
	return nil
}
